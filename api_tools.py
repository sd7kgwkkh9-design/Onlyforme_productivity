"""
생산성 도구 API (7차) — api.py와 같은 /api 주소 묶음(blueprint)에 붙는다.

루틴 (자주 하는 활동을 빠르게 추가하는 버튼)
  GET    /api/routines?date=              루틴 목록 + 그 날짜 기준으로 마지막으로 한 날(last_date)
  POST   /api/routines                    루틴 추가 {name, category_id}
  PUT    /api/routines/<id>               이름·카테고리 수정
  DELETE /api/routines/<id>               삭제 (이미 추가한 일정은 그대로 남는다)
  PUT    /api/routines/order              버튼 순서 {ids: [...]}

마음 노트
  GET    /api/notes                       메모 목록
  POST   /api/notes                       메모 추가 (첫 메모는 자동으로 메인)
  PUT    /api/notes/<id>                  제목·내용·배너 글귀 수정 (자동 저장)
  PUT    /api/notes/<id>/main             메인 메모로 지정
  DELETE /api/notes/<id>                  삭제 (메인을 지우면 맨 위 메모가 메인이 된다)
  PUT    /api/notes/order                 순서 {ids: [...]}

달력 위 띠
  GET    /api/overview?today=             메인 메모의 배너 글귀 + 다가오는 D-day 일정

시간 돌아보기
  GET    /api/stats?start=&end=           기간 안의 카테고리별·날짜별 시간, 루틴 횟수

빠른 입력
  GET    /api/parse?text=&today=&default= 한 줄 입력을 해석만 한다 (저장은 POST /api/items)
"""

from datetime import date as Date

from flask import jsonify, request

import quickadd
from api import ApiError, bp, json_body, parse_date, parse_range
from db import default_category_id, get_db

MAX_ROUTINES = 30
MAX_ROUTINE_NAME = 30
MAX_NOTES = 50
MAX_NOTE_TITLE = 60
MAX_NOTE_BODY = 20000
MAX_BANNER = 200
MAX_DDAYS = 6
MAX_PARSE_TEXT = 300


def today_arg(name="today"):
    """화면(기기)이 보낸 오늘 날짜. 인터넷 서버의 시계는 한국과 날짜가 다를 수 있어서 기기 기준을 쓴다."""
    raw = request.args.get(name)
    return Date.fromisoformat(parse_date(raw, "오늘 날짜")) if raw else Date.today()


def id_list(data, table, label):
    """순서 바꾸기 요청 {ids: [...]} 검사: 그 표의 모든 id가 정확히 한 번씩 있어야 한다."""
    ids = data.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        raise ApiError("ids는 번호(정수)의 목록이어야 해요.")
    db = get_db()
    existing = {r["id"] for r in db.execute(f"SELECT id FROM {table}")}
    if len(ids) != len(set(ids)) or set(ids) != existing:
        raise ApiError(f"{label} 목록이 바뀌었어요. 다시 열어 주세요.", 409)
    return ids


# ======================================================================== 루틴
def routine_payload(data, db, exclude_id=None):
    name = str(data.get("name") or "").strip()
    if not name:
        raise ApiError("루틴 이름을 입력해 주세요.")
    if len(name) > MAX_ROUTINE_NAME:
        raise ApiError(f"루틴 이름은 {MAX_ROUTINE_NAME}자 이하로 적어 주세요.")
    if db.execute("SELECT 1 FROM routines WHERE name = ? AND id IS NOT ?", (name, exclude_id)).fetchone():
        raise ApiError(f"'{name}' 루틴이 이미 있어요.")

    category_id = data.get("category_id")
    if category_id in (None, ""):
        category_id = default_category_id(db)
    elif not isinstance(category_id, int) or not db.execute(
        "SELECT 1 FROM categories WHERE id = ?", (category_id,)
    ).fetchone():
        raise ApiError("카테고리를 찾을 수 없어요.", 404)
    return {"name": name, "category_id": category_id}


def routine_rows(db, until=None):
    """
    루틴 목록. until(날짜)이 있으면 그 날짜까지 중 마지막으로 그 활동을 한 날(last_date)도 함께.
    '그 활동을 한 날' = 루틴 버튼으로 추가한 일정이 있는 날, 또는 제목이 루틴 이름과 똑같은 일정이 있는 날
    (루틴을 만들기 전에 손으로 적어 둔 '운동'도 기록으로 친다).
    """
    return db.execute(
        """
        SELECT r.*, c.name AS c_name, c.color AS c_color,
               (SELECT MAX(d.date) FROM item_dates d JOIN items i ON i.id = d.item_id
                 WHERE (i.routine_id = r.id OR TRIM(i.title) = r.name) AND d.date <= ?) AS last_date
        FROM routines r JOIN categories c ON c.id = r.category_id
        ORDER BY r.position, r.id
        """,
        (until or "9999-12-31",),
    ).fetchall()


def routine_dict(r):
    return {
        "id": r["id"],
        "name": r["name"],
        "position": r["position"],
        "category": {"id": r["category_id"], "name": r["c_name"], "color": r["c_color"]},
        "last_date": r["last_date"],
    }


@bp.get("/routines")
def list_routines():
    raw = request.args.get("date")
    until = parse_date(raw) if raw else None
    return jsonify([routine_dict(r) for r in routine_rows(get_db(), until)])


@bp.post("/routines")
def create_routine():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM routines").fetchone()["n"] >= MAX_ROUTINES:
        raise ApiError(f"루틴은 {MAX_ROUTINES}개까지 만들 수 있어요.")
    fields = routine_payload(json_body(), db)
    position = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM routines").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO routines (name, category_id, position) VALUES (?, ?, ?)",
        (fields["name"], fields["category_id"], position),
    )
    db.commit()
    row = next(r for r in routine_rows(db) if r["id"] == cur.lastrowid)
    return jsonify(routine_dict(row)), 201


def get_routine_or_404(db, routine_id):
    if not db.execute("SELECT 1 FROM routines WHERE id = ?", (routine_id,)).fetchone():
        raise ApiError("루틴을 찾을 수 없어요.", 404)


@bp.put("/routines/<int:routine_id>")
def update_routine(routine_id):
    db = get_db()
    get_routine_or_404(db, routine_id)
    fields = routine_payload(json_body(), db, exclude_id=routine_id)
    db.execute(
        "UPDATE routines SET name = ?, category_id = ? WHERE id = ?",
        (fields["name"], fields["category_id"], routine_id),
    )
    db.commit()
    row = next(r for r in routine_rows(db) if r["id"] == routine_id)
    return jsonify(routine_dict(row))


@bp.delete("/routines/<int:routine_id>")
def delete_routine(routine_id):
    db = get_db()
    get_routine_or_404(db, routine_id)
    db.execute("UPDATE items SET routine_id = NULL WHERE routine_id = ?", (routine_id,))  # 일정은 남긴다
    db.execute("DELETE FROM routines WHERE id = ?", (routine_id,))
    db.commit()
    return jsonify(deleted=routine_id)


@bp.put("/routines/order")
def reorder_routines():
    ids = id_list(json_body(), "routines", "루틴")
    db = get_db()
    db.executemany("UPDATE routines SET position = ? WHERE id = ?", [(n + 1, i) for n, i in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


# ======================================================================== 마음 노트
def note_dict(r):
    return {
        "id": r["id"],
        "title": r["title"],
        "body": r["body"],
        "banner": r["banner"],
        "is_main": bool(r["is_main"]),
        "position": r["position"],
        "updated_at": r["updated_at"],
    }


def note_payload(data, partial=False):
    """제목·내용·배너 글귀. partial이면 보낸 칸만 바꾼다 (자동 저장)."""
    out = {}
    for key, limit, label in (("title", MAX_NOTE_TITLE, "제목"), ("body", MAX_NOTE_BODY, "내용"), ("banner", MAX_BANNER, "배너 글귀")):
        if key not in data:
            if not partial:
                out[key] = ""
            continue
        value = data[key]
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise ApiError(f"{label}은(는) 글자여야 해요.")
        value = value.strip() if key != "body" else value.rstrip()
        if len(value) > limit:
            raise ApiError(f"{label}은(는) {limit}자 이하로 적어 주세요.")
        out[key] = value
    return out


def get_note_or_404(db, note_id):
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        raise ApiError("메모를 찾을 수 없어요.", 404)
    return row


@bp.get("/notes")
def list_notes():
    rows = get_db().execute("SELECT * FROM notes ORDER BY position, id").fetchall()
    return jsonify([note_dict(r) for r in rows])


@bp.post("/notes")
def create_note():
    db = get_db()
    count = db.execute("SELECT COUNT(*) AS n FROM notes").fetchone()["n"]
    if count >= MAX_NOTES:
        raise ApiError(f"메모는 {MAX_NOTES}개까지 만들 수 있어요.")
    fields = note_payload(json_body())
    position = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM notes").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO notes (title, body, banner, is_main, position) VALUES (?, ?, ?, ?, ?)",
        (fields["title"], fields["body"], fields["banner"], int(count == 0), position),  # 첫 메모는 메인
    )
    db.commit()
    return jsonify(note_dict(get_note_or_404(db, cur.lastrowid))), 201


@bp.put("/notes/<int:note_id>")
def update_note(note_id):
    db = get_db()
    get_note_or_404(db, note_id)
    fields = note_payload(json_body(), partial=True)
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(
            f"UPDATE notes SET {sets}, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (*fields.values(), note_id),
        )
        db.commit()
    return jsonify(note_dict(get_note_or_404(db, note_id)))


@bp.put("/notes/<int:note_id>/main")
def set_main_note(note_id):
    db = get_db()
    get_note_or_404(db, note_id)
    db.execute("UPDATE notes SET is_main = (id = ?)", (note_id,))
    db.commit()
    return jsonify(note_dict(get_note_or_404(db, note_id)))


@bp.delete("/notes/<int:note_id>")
def delete_note(note_id):
    db = get_db()
    was_main = get_note_or_404(db, note_id)["is_main"]
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    if was_main:  # 메인이 없어지면 맨 위 메모가 메인을 이어받는다
        db.execute(
            "UPDATE notes SET is_main = 1 WHERE id = (SELECT id FROM notes ORDER BY position, id LIMIT 1)"
        )
    db.commit()
    return jsonify(deleted=note_id)


@bp.put("/notes/order")
def reorder_notes():
    ids = id_list(json_body(), "notes", "메모")
    db = get_db()
    db.executemany("UPDATE notes SET position = ? WHERE id = ?", [(n + 1, i) for n, i in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


# ======================================================================== 달력 위 띠: 배너 + D-day
@bp.get("/overview")
def overview():
    """
    banner : 메인 메모의 배너 글귀 (비어 있으면 null → 화면에서 배너를 숨긴다)
    ddays  : D-day로 표시한 일정 중 오늘 이후 날짜가 남은 것, 가까운 순서로.
             여러 날짜에 들어간 일정은 오늘부터 가장 가까운 날짜 기준.
    """
    db = get_db()
    today = today_arg()
    main = db.execute("SELECT id, banner FROM notes WHERE is_main = 1").fetchone()
    banner = {"note_id": main["id"], "text": main["banner"]} if main and main["banner"] else None

    rows = db.execute(
        """
        SELECT i.id, i.title, MIN(d.date) AS next_date, c.color AS c_color
        FROM items i
        JOIN item_dates d ON d.item_id = i.id
        JOIN categories c ON c.id = i.category_id
        WHERE i.dday = 1 AND d.date >= ?
        GROUP BY i.id
        ORDER BY next_date, i.id
        LIMIT ?
        """,
        (today.isoformat(), MAX_DDAYS),
    ).fetchall()
    ddays = [
        {
            "id": r["id"],
            "title": r["title"],
            "date": r["next_date"],
            "days_left": (Date.fromisoformat(r["next_date"]) - today).days,
            "color": r["c_color"],
        }
        for r in rows
    ]
    return jsonify(banner=banner, ddays=ddays)


# ======================================================================== 시간 돌아보기
def minutes_between(start, end):
    if not start or not end:
        return 0
    (sh, sm), (eh, em) = (map(int, start.split(":")), map(int, end.split(":")))
    return max(0, (eh * 60 + em) - (sh * 60 + sm))


@bp.get("/stats")
def stats():
    """
    [start, end) 기간의 시간 사용.
      - 시간: 시작·끝이 모두 있는 일정만 (끝 - 시작). 여러 날짜 일정은 날짜마다 따로 더한다.
      - 개수: 시간이 없는 일정도 센다.
      - 루틴: 기간 안에 루틴으로 추가한 일정(또는 제목이 루틴 이름과 같은 일정)이 몇 번 있었는지.
    """
    db = get_db()
    start, end = parse_range()
    rows = db.execute(
        """
        SELECT d.date, i.title, i.start_time, i.end_time, i.routine_id,
               c.id AS c_id, c.name AS c_name, c.color AS c_color
        FROM item_dates d
        JOIN items i ON i.id = d.item_id
        JOIN categories c ON c.id = i.category_id
        WHERE d.date >= ? AND d.date < ?
        """,
        (start, end),
    ).fetchall()

    categories = {}
    days = {}
    total = timed = 0
    for r in rows:
        minutes = minutes_between(r["start_time"], r["end_time"])
        cat = categories.setdefault(
            r["c_id"], {"id": r["c_id"], "name": r["c_name"], "color": r["c_color"], "minutes": 0, "count": 0}
        )
        cat["count"] += 1
        cat["minutes"] += minutes
        if minutes:
            timed += 1
            total += minutes
            day = days.setdefault(r["date"], {})
            day[r["c_id"]] = day.get(r["c_id"], 0) + minutes

    routines = []
    for r in routine_rows(db):
        count = sum(1 for x in rows if x["routine_id"] == r["id"] or x["title"].strip() == r["name"])
        if count:
            routines.append({"id": r["id"], "name": r["name"], "color": r["c_color"], "count": count})
    routines.sort(key=lambda x: -x["count"])

    return jsonify(
        start=start,
        end=end,
        total_minutes=total,
        item_count=len(rows),
        timed_count=timed,
        categories=sorted(categories.values(), key=lambda c: (-c["minutes"], -c["count"])),
        days=[{"date": d, "by_category": {str(k): v for k, v in cats.items()}} for d, cats in sorted(days.items())],
        routines=routines,
    )


# ======================================================================== 빠른 입력
@bp.get("/parse")
def parse_quick():
    """한 줄 입력을 해석해서 돌려준다. 저장은 하지 않는다 (화면이 미리 보여 준 뒤 POST /api/items)."""
    text = request.args.get("text", "")
    if len(text) > MAX_PARSE_TEXT:
        raise ApiError(f"빠른 입력은 {MAX_PARSE_TEXT}자까지 쓸 수 있어요.")
    today = today_arg()
    raw_default = request.args.get("default")
    default = Date.fromisoformat(parse_date(raw_default, "기준 날짜")) if raw_default else None

    db = get_db()
    categories = [dict(r) for r in db.execute("SELECT id, name, color FROM categories ORDER BY is_default DESC, id")]
    routines = [dict(r) for r in db.execute("SELECT id, name, category_id FROM routines ORDER BY position, id")]
    return jsonify(quickadd.parse(text, today, categories, routines, default_date=default))
