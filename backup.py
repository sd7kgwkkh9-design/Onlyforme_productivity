"""
내 데이터 백업 · 되살리기 (0.14.0) — ⚙ 설정 → '백업 · 되살리기…'. api.py와 같은 /api 묶음(blueprint)에 붙는다.

모든 데이터가 서버의 SQLite 파일 하나(instance/calendar.db)에만 있어서, 실수로 지우거나 서버에 문제가 생기면 되돌릴 방법이 없었다.
그래서 내용 전부를 JSON 파일 하나로 내려받고, 그 파일로 통째로 되살릴 수 있게 했다. (서버를 옮길 때도 쓸 수 있다)

  GET  /api/backup                파일 내려받기: my-calendar-backup-YYYY-MM-DD.json
  POST /api/backup/restore        파일 내용(JSON)으로 지금 데이터를 통째로 바꾼다.
                                  바꾸기 전에 지금 데이터를 instance/backups/에 자동으로 한 벌 남겨 둔다 (최근 5개).
  GET  /api/backup/auto           서버에 남아 있는 자동 백업 목록 + 마지막으로 내려받은 때 (0.15.2)
  GET  /api/backup/auto/<이름>    그 자동 백업 파일 내려받기

자동 백업 (0.15.2): 그날 처음 캘린더를 쓸 때(성공한 /api 요청 뒤) 서버가 스스로 instance/backups/auto-YYYY-MM-DD.json을 만든다.
  PythonAnywhere 무료 계정에는 '매일 몇 시에 실행' 같은 예약 작업을 마음대로 쓰기 어려워서, '그날 첫 사용'을 신호로 삼았다.
  최근 KEEP_DAILY개는 날마다, 그보다 오래된 것은 주마다 가장 늦은 것 하나씩 KEEP_WEEKLY주까지 남긴다 (대략 두 달 반).
  서버 일꾼이 여럿이어도 같은 날 파일은 하나만 생긴다 (O_EXCL: 이미 있으면 만들지 않는다).

- 들어가는 것: 일정·할 일, 카테고리, 루틴·루틴 기록, 노트, 목표, 스티커, 습관, 시간표, 기념일, 프로젝트, 일기, 메모장의 '나'·'살 것'(0.14.2)
- 들어가지 않는 것: 비밀번호·PIN(auth.json), 패스키, 공유 링크·구독 주소(links) — 열쇠 같은 것들이라 파일로 돌아다니면 안 된다.
- 예전 버전에서 받은 파일도 되살릴 수 있다 (파일에 없는 칸은 기본값, 없는 표는 비운다 — '나'·'살 것'만은 지금 것을 그대로 둔다). 모르는 칸은 버린다.
- 0.15.0까지 받은 파일의 시각은 서버 시간대로 적혀 있어서, 되살릴 때 한국 시간으로 옮긴다 (0.15.1)
"""

import json
import os
import re
import sqlite3
from datetime import date, datetime

from flask import Response, current_app, jsonify, request, send_file

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
    "about_sections", "wishlist", "repeats",
]
KEEP_IF_MISSING = {"about_sections", "wishlist", "repeats"}   # 이 표가 없던 예전 파일을 되살려도 지금 것은 그대로 둔다
MAX_BYTES = 20 * 1024 * 1024   # 20MB (일기·노트를 아주 많이 써도 넉넉하다)
KEEP_SAFETY = 5
KEEP_DAILY = 14    # 자동 백업: 최근 14개는 날마다
KEEP_WEEKLY = 8    #            그 전은 주마다 하나씩 8주
AUTO_NAME = re.compile(r"^auto-(\d{4}-\d{2}-\d{2})\.json$")
SAFETY_NAME = re.compile(r"^before-restore-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}\.json$")
_checked = {}      # 이 서버 일꾼이 오늘 자동 백업을 이미 확인했는지 (DB 경로 → 날짜). 하루 한 번만 폴더를 본다


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


def backup_folder():
    return os.path.join(os.path.dirname(os.path.abspath(current_app.config["DATABASE"])), "backups")


def auto_backup(db, today):
    """오늘 날짜 자동 백업이 없으면 만들고 오래된 것을 정리한다. 만들었으면 파일 이름, 이미 있으면 None"""
    folder = backup_folder()
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"auto-{today:%Y-%m-%d}.json")
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return None
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(export_data(db), f, ensure_ascii=False)
    except BaseException:
        os.remove(path)
        raise
    prune_auto(folder)
    return os.path.basename(path)


def prune_auto(folder):
    """최근 KEEP_DAILY개 + 그 전은 주(월~일)마다 가장 늦은 것 하나씩 KEEP_WEEKLY주. 나머지는 지운다"""
    names = sorted((n for n in os.listdir(folder) if AUTO_NAME.match(n)), reverse=True)   # 새것부터
    keep = set(names[:KEEP_DAILY])
    weeks = set()
    for name in names[KEEP_DAILY:]:
        week = date.fromisoformat(AUTO_NAME.match(name).group(1)).isocalendar()[:2]
        if week not in weeks and len(weeks) < KEEP_WEEKLY:
            weeks.add(week)
            keep.add(name)
    for name in names:
        if name not in keep:
            os.remove(os.path.join(folder, name))


@bp.after_request
def daily_backup(response):
    """그날 처음 성공한 /api 요청 뒤에 자동 백업 (로그인해서 쓰고 있다는 뜻). 실패해도 응답에는 영향이 없다"""
    if response.status_code >= 400 or not current_app.config.get("AUTO_BACKUP", True):
        return response
    key = current_app.config["DATABASE"]
    today = datetime.now(KST).date()
    if _checked.get(key) != today:
        _checked[key] = today
        try:
            auto_backup(get_db(), today)
        except (OSError, sqlite3.Error, ValueError, TypeError):
            current_app.logger.exception("자동 백업을 만들지 못했어요")
    return response


def describe(name, folder):
    """목록에 보여 줄 한 줄: 종류·날짜·크기"""
    size = os.path.getsize(os.path.join(folder, name))
    m = AUTO_NAME.match(name)
    if m:
        return {"name": name, "kind": "auto", "date": m.group(1), "time": None, "size": size}
    m = SAFETY_NAME.match(name)
    return {"name": name, "kind": "before-restore", "date": f"{m.group(1)}-{m.group(2)}-{m.group(3)}", "time": f"{m.group(4)}:{m.group(5)}", "size": size}


@bp.get("/backup/auto")
def list_auto_backups():
    folder = backup_folder()
    names = [n for n in os.listdir(folder) if AUTO_NAME.match(n) or SAFETY_NAME.match(n)] if os.path.isdir(folder) else []
    files = sorted((describe(n, folder) for n in names), key=lambda f: (f["date"], f["time"] or "99:99"), reverse=True)
    row = get_db().execute("SELECT value FROM meta WHERE key = 'last_download'").fetchone()
    last = datetime.fromtimestamp(row[0], KST).strftime("%Y-%m-%d %H:%M:%S") if row else None
    return jsonify(files=files, last_download=last, keep={"daily": KEEP_DAILY, "weekly": KEEP_WEEKLY})


@bp.get("/backup/auto/<name>")
def download_auto_backup(name):
    # 이름 모양을 정확히 검사해서 backups 폴더 밖의 파일은 절대 열지 않는다
    if not (AUTO_NAME.match(name) or SAFETY_NAME.match(name)):
        raise ApiError("없는 백업이에요.", 404)
    path = os.path.join(backup_folder(), name)
    if not os.path.isfile(path):
        raise ApiError("없는 백업이에요.", 404)
    response = send_file(path, mimetype="application/json", as_attachment=True, download_name=f"my-calendar-{name}")
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.get("/backup")
def download_backup():
    db = get_db()
    data = export_data(db)
    # 마지막으로 내 컴퓨터에 받은 때를 기억한다 (자동 백업은 같은 서버에 있어서, 가끔은 밖으로 받아 둬야 한다)
    db.execute(
        "INSERT INTO meta (key, value) VALUES ('last_download', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (int(datetime.now(KST).timestamp()),),
    )
    db.commit()
    name = f"my-calendar-backup-{datetime.now(KST):%Y-%m-%d}.json"
    return Response(
        json.dumps(data, ensure_ascii=False, indent=1),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


def save_safety_copy(db):
    """되살리기 전의 데이터를 instance/backups/에 한 벌 남긴다 (최근 KEEP_SAFETY개만)"""
    folder = backup_folder()
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
