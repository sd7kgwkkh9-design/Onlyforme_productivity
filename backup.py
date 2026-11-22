"""
내 데이터 백업 · 되살리기 (0.14.0) — ⚙ 설정 → '백업 · 되살리기…'. api.py와 같은 /api 묶음(blueprint)에 붙는다.

모든 데이터가 서버의 SQLite 파일 하나(instance/calendar.db)에만 있어서, 실수로 지우거나 서버에 문제가 생기면 되돌릴 방법이 없었다.
그래서 내용 전부를 JSON 파일 하나로 내려받고, 그 파일로 통째로 되살릴 수 있게 했다. (서버를 옮길 때도 쓸 수 있다)

  GET  /api/backup                파일 내려받기: my-calendar-backup-YYYY-MM-DD.json
  POST /api/backup/restore        파일 내용(JSON)으로 지금 데이터를 통째로 바꾼다.
                                  바꾸기 전에 지금 데이터를 instance/backups/에 자동으로 한 벌 남겨 둔다 (최근 5개).

- 들어가는 것: 일정·할 일, 카테고리, 루틴·루틴 기록, 노트, 목표, 스티커, 습관, 시간표, 기념일, 프로젝트, 일기, 메모장의 '나'·'살 것'(0.14.2)
- 들어가지 않는 것: 비밀번호·PIN(auth.json), 패스키, 공유 링크·구독 주소(links) — 열쇠 같은 것들이라 파일로 돌아다니면 안 된다.
- 예전 버전에서 받은 파일도 되살릴 수 있다 (파일에 없는 칸은 기본값, 없는 표는 비운다 — '나'·'살 것'만은 지금 것을 그대로 둔다). 모르는 칸은 버린다.
- 0.15.0까지 받은 파일의 시각은 서버 시간대로 적혀 있어서, 되살릴 때 한국 시간으로 옮긴다 (0.15.1)
"""

import json
import os
import sqlite3
from datetime import datetime

from flask import Response, current_app, jsonify, request

from api import ApiError, bp
from api_plans import KST
from db import (
    DEFAULT_CATEGORY_COLOR,
    DEFAULT_CATEGORY_NAME,
    column_names,
    get_db,
    kst_shift,
    migrate,
    shift_times,
)

FORMAT = 1
APP_ID = "my-calendar"
# 부모 표가 먼저 (되살릴 때 이 순서로 넣고, 지울 때는 거꾸로)
TABLES = [
    "categories", "routines", "projects", "timetables",
    "items", "item_dates", "routine_logs", "notes", "goals", "day_marks",
    "habits", "habit_logs", "timetable_blocks", "timetable_skips", "anniversaries", "diaries",
    "about_sections", "wishlist",
]
KEEP_IF_MISSING = {"about_sections", "wishlist"}
MAX_BYTES = 20 * 1024 * 1024   # 20MB (일기·노트를 아주 많이 써도 넉넉하다)
KEEP_SAFETY = 5


def export_data(db):
    from app import APP_VERSION
    return {
        "app": APP_ID,
        "format": FORMAT,
        "version": APP_VERSION,
        "exported_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
        "times": "kst",   # 0.15.1부터: 안의 시각이 모두 한국 시간이라는 표시
        "tables": {t: [dict(r) for r in db.execute(f"SELECT * FROM {t}")] for t in TABLES},
    }


def counts_of(tables):
    return {
        "items": len(tables.get("items", [])),
        "notes": len(tables.get("notes", [])),
        "goals": len(tables.get("goals", [])),
        "diaries": len(tables.get("diaries", [])),
        "routine_logs": len(tables.get("routine_logs", [])),
        "projects": len(tables.get("projects", [])),
    }


@bp.get("/backup")
def download_backup():
    data = export_data(get_db())
    name = f"my-calendar-backup-{datetime.now(KST):%Y-%m-%d}.json"
    return Response(
        json.dumps(data, ensure_ascii=False, indent=1),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


def save_safety_copy(db):
    """되살리기 전의 데이터를 instance/backups/에 한 벌 남긴다 (최근 KEEP_SAFETY개만)"""
    folder = os.path.join(os.path.dirname(os.path.abspath(current_app.config["DATABASE"])), "backups")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"before-restore-{datetime.now(KST):%Y%m%d-%H%M%S}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(export_data(db), f, ensure_ascii=False)
    old = sorted(n for n in os.listdir(folder) if n.startswith("before-restore-"))
    for name in old[:-KEEP_SAFETY]:
        os.remove(os.path.join(folder, name))
    return os.path.basename(path)


def check_file(data):
    if not isinstance(data, dict) or data.get("app") != APP_ID or not isinstance(data.get("tables"), dict):
        raise ApiError("이 캘린더에서 내려받은 백업 파일이 아니에요.")
    if not isinstance(data.get("format"), int) or data["format"] > FORMAT:
        raise ApiError("더 새 버전에서 만든 백업 파일이에요. 서버를 먼저 업데이트해 주세요.")
    tables = data["tables"]
    for name, rows in tables.items():
        if name in TABLES and (not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows)):
            raise ApiError(f"백업 파일이 손상되었어요. ({name})")
    return tables


@bp.post("/backup/restore")
def restore_backup():
    if (request.content_length or 0) > MAX_BYTES:
        raise ApiError("백업 파일이 너무 커요. (20MB까지)", 413)
    data = request.get_json(silent=True)
    tables = check_file(data)
    db = get_db()
    safety = save_safety_copy(db)

    db.commit()
    db.execute("PRAGMA foreign_keys = OFF")   # 표를 통째로 바꾸는 동안만 (끝나고 한꺼번에 검사한다)
    try:
        db.execute("BEGIN")
        # 0.14.2의 '나'·'살 것'은 예전 버전 파일에 없으면 지금 것을 그대로 둔다 (다른 표와 이어지지 않아서 섞여도 안전하다)
        for name in reversed(TABLES):
            if name in tables or name not in KEEP_IF_MISSING:
                db.execute(f"DELETE FROM {name}")
        for name in TABLES:
            cols = column_names(db, name)
            for row in tables.get(name, []):
                keep = {k: v for k, v in row.items() if k in cols and (v is None or isinstance(v, (str, int, float)))}
                if not keep:
                    continue
                names = ", ".join(keep)
                marks = ", ".join("?" for _ in keep)
                db.execute(f"INSERT INTO {name} ({names}) VALUES ({marks})", list(keep.values()))
        # '미분류'가 없는 파일이면 새로 만든다 (일정은 카테고리가 꼭 있어야 한다)
        db.execute(
            "INSERT INTO categories (name, color, is_default) SELECT ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE is_default = 1)",
            (DEFAULT_CATEGORY_NAME, DEFAULT_CATEGORY_COLOR),
        )
        # 0.15.0까지 받은 파일은 시각이 서버 시간대(PythonAnywhere는 UTC)로 적혀 있다 → 이 서버가 예전 기록을 옮긴 만큼 똑같이 옮긴다
        if data.get("times") != "kst":
            shift_times(db, kst_shift(db), [t for t in TABLES if t in tables])
        broken = db.execute("PRAGMA foreign_key_check").fetchall()
        if broken:
            raise ApiError(f"백업 파일 안의 연결이 맞지 않아요. ({broken[0][0]}) 지금 데이터는 그대로예요.")
        migrate(db)   # 예전 버전의 파일이면 지금 모양으로 (예: 0.14.0에서 뺀 형광펜 비우기)
        db.commit()
    except ApiError:
        db.rollback()
        raise
    except (sqlite3.Error, ValueError, TypeError) as e:
        db.rollback()
        raise ApiError(f"백업 파일을 되살리지 못했어요. 지금 데이터는 그대로예요. ({e})") from None
    finally:
        db.execute("PRAGMA foreign_keys = ON")
    return jsonify(ok=True, safety=safety, counts=counts_of(tables), exported_at=data.get("exported_at"), version=data.get("version"))
