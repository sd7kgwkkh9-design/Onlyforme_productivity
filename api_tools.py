"""
생산성 도구 API (7차) — api.py와 같은 /api 주소 묶음(blueprint)에 붙는다.

루틴 (자주 하는 활동. 이모지 하나 + 이름)
  GET    /api/routines?date=              루틴 목록 + 그 날짜 기준으로 마지막으로 기록한 날(last_date)
  POST   /api/routines                    루틴 추가 {name, emoji}
  PUT    /api/routines/<id>               이름·이모지 수정
  DELETE /api/routines/<id>               삭제 (그 루틴의 기록도 함께)
  PUT    /api/routines/order              버튼 순서 {ids: [...]}

루틴 기록 (일정과 따로 저장)
  GET    /api/routine-logs?start=&end=    기간의 루틴 기록
  POST   /api/routine-logs                기록 추가 {routine_id, date, start_time, end_time, memo}
  PUT    /api/routine-logs/<id>           수정 (보낸 칸만 — 끌어서 날짜만 옮길 때는 {date})
  DELETE /api/routine-logs/<id>           삭제

기록지 — 메모
  GET    /api/notes                       메모 목록
  POST   /api/notes                       메모 추가 (첫 메모는 자동으로 메인)
  PUT    /api/notes/<id>                  제목·내용·배너 글귀 수정 (자동 저장)
  PUT    /api/notes/<id>/main             메인 메모로 지정
  DELETE /api/notes/<id>                  삭제 (메인을 지우면 맨 위 메모가 메인이 된다)
  PUT    /api/notes/order                 순서 {ids: [...]}

기록지 — 목표 (0.9.0)
  GET    /api/goals                       목표 목록 (아직인 것 먼저, 이룬 것은 뒤에)
  POST   /api/goals                       목표 추가 {title, due, memo}
  PUT    /api/goals/<id>                  수정 (보낸 칸만) {title, due, memo, done}
  DELETE /api/goals/<id>                  삭제
  PUT    /api/goals/order                 같은 묶음(인생 / 같은 해의 올해 / 잇지 않은 기한 목표) 안의 순서 {ids: [...]}
  POST   /api/goals/<id>/step             숫자 목표 +1 {delta}
  0.11.0: 목표가 세 단계가 됐다 — kind: life(인생) | year(올해) | due(기한). parent_id로 위 단계와 잇는다.
          올해 목표의 진행 방식 measure: check | count(current/target) | routine(routine_id의 그 해 기록 수)

달력 꾸미기 (0.11.0)
  PUT    /api/days/<date>/mark            날짜 스티커·형광펜 {sticker, color} (읽기는 /api/calendar의 marks)
  (기록지의 '할 일'은 날짜 없는 일정이라 api.py의 /api/items/undated 등을 쓴다)

화면 한 번에 필요한 것 묶어 받기 (최적화: 요청 수 줄이기)
  GET    /api/calendar?start=&end=        월간·주간 화면: 일정 + 루틴 기록 (요청 2번 → 1번)
  GET    /api/day/<date>                  하루 화면: 일정 + 루틴 기록 + 루틴 버튼 (요청 3번 → 1번)
  GET    /api/inbox                       기록지: 메모 + 목표 + 할 일 (요청 3번 → 1번, 0.9.0)

달력 위 띠
  GET    /api/overview?today=             메인 메모의 배너 글귀 + 다가오는 D-day 일정 + 기한 있는 목표 + 올해 진행률·올해 목표 + 인생 목표

시간 돌아보기
  GET    /api/stats?start=&end=           기간 안의 카테고리별·날짜별 시간, 루틴 횟수·시간

빠른 입력
  GET    /api/parse?text=&today=          한 줄 입력을 해석만 한다 (저장은 POST /api/items 또는 /api/routine-logs)
"""

import unicodedata
from datetime import date as Date
from datetime import timedelta

from flask import jsonify, request

import quickadd
from api import ApiError, bp, json_body, occurrence_list, parse_date, parse_range, parse_time, undated_items
from db import get_db

MAX_ROUTINES = 30
MAX_ROUTINE_NAME = 30
MAX_NOTES = 500        # 0.9.0부터 한 줄 메모도 여기 쌓이므로 넉넉하게
MAX_NOTE_TITLE = 60
MAX_NOTE_BODY = 20000
MAX_BANNER = 200
MAX_DDAYS = 6
MAX_GOALS = 200
MAX_GOAL_TITLE = 100
MAX_GOAL_MEMO = 2000
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
# 루틴 = 이모지 하나 + 이름 (카테고리 없음). 루틴 버튼으로 남긴 건 일정이 아니라 '루틴 기록'으로 따로 저장한다.
MAX_EMOJI_LEN = 16   # 이모지 하나가 여러 글자(코드 포인트)로 이루어진 경우도 있어서 넉넉하게 (👨‍💻, 🏃‍♀️)
MAX_LOG_MEMO = 500


def routine_payload(data, db, exclude_id=None):
    name = str(data.get("name") or "").strip()
    if not name:
        raise ApiError("루틴 이름을 입력해 주세요.")
    if len(name) > MAX_ROUTINE_NAME:
        raise ApiError(f"루틴 이름은 {MAX_ROUTINE_NAME}자 이하로 적어 주세요.")
    if db.execute("SELECT 1 FROM routines WHERE name = ? AND id IS NOT ?", (name, exclude_id)).fetchone():
        raise ApiError(f"'{name}' 루틴이 이미 있어요.")

    emoji = str(data.get("emoji") or "").strip()
    if not emoji:
        raise ApiError("루틴 이모지를 골라 주세요.")
    # 글자(한글·영어 등)나 띄어쓰기가 섞이면 이모지가 아닌 것으로 본다
    if len(emoji) > MAX_EMOJI_LEN or any(ch.isspace() or unicodedata.category(ch).startswith("L") for ch in emoji):
        raise ApiError("이모지는 하나만 골라 주세요.")
    return {"name": name, "emoji": emoji}


def routine_rows(db, until=None):
    """
    루틴 목록. until(날짜)이 있으면 그 날짜까지 중 마지막으로 기록한 날(last_date)도 함께.
    log_count = 지금까지 남긴 기록 수 (삭제할 때 '기록 N개도 함께 지워져요' 안내용)
    """
    return db.execute(
        """
        SELECT r.*,
               (SELECT MAX(l.date) FROM routine_logs l WHERE l.routine_id = r.id AND l.date <= ?) AS last_date,
               (SELECT COUNT(*) FROM routine_logs l WHERE l.routine_id = r.id) AS log_count
        FROM routines r
        ORDER BY r.position, r.id
        """,
        (until or "9999-12-31",),
    ).fetchall()


def routine_dict(r):
    return {
        "id": r["id"],
        "name": r["name"],
        "emoji": r["emoji"],
        "position": r["position"],
        "last_date": r["last_date"],
        "log_count": r["log_count"],
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
        "INSERT INTO routines (name, emoji, position) VALUES (?, ?, ?)", (fields["name"], fields["emoji"], position)
    )
    db.commit()
    row = next(r for r in routine_rows(db) if r["id"] == cur.lastrowid)
    return jsonify(routine_dict(row)), 201


def get_routine_or_404(db, routine_id):
    row = db.execute("SELECT * FROM routines WHERE id = ?", (routine_id,)).fetchone()
    if row is None:
        raise ApiError("루틴을 찾을 수 없어요.", 404)
    return row


@bp.put("/routines/<int:routine_id>")
def update_routine(routine_id):
    db = get_db()
    get_routine_or_404(db, routine_id)
    fields = routine_payload(json_body(), db, exclude_id=routine_id)
    db.execute("UPDATE routines SET name = ?, emoji = ? WHERE id = ?", (fields["name"], fields["emoji"], routine_id))
    db.commit()
    row = next(r for r in routine_rows(db) if r["id"] == routine_id)
    return jsonify(routine_dict(row))


@bp.delete("/routines/<int:routine_id>")
def delete_routine(routine_id):
    """루틴을 지우면 그 루틴의 기록도 함께 지워진다 (화면에서 개수를 알려 주고 묻는다)."""
    db = get_db()
    get_routine_or_404(db, routine_id)
    # 이 루틴에 연결해 둔 올해 목표는 지금까지 센 숫자를 들고 '숫자 목표'로 바뀐다 (진행도를 잃지 않게)
    counts = routine_counts(db)
    for g in db.execute("SELECT id, year FROM goals WHERE routine_id = ?", (routine_id,)).fetchall():
        db.execute(
            "UPDATE goals SET measure = 'count', current = ?, routine_id = NULL WHERE id = ?",
            (counts.get((routine_id, g["year"]), 0), g["id"]),
        )
    removed = db.execute("DELETE FROM routine_logs WHERE routine_id = ?", (routine_id,)).rowcount
    db.execute("DELETE FROM routines WHERE id = ?", (routine_id,))
    db.commit()
    return jsonify(deleted=routine_id, logs_deleted=removed)


@bp.put("/routines/order")
def reorder_routines():
    ids = id_list(json_body(), "routines", "루틴")
    db = get_db()
    db.executemany("UPDATE routines SET position = ? WHERE id = ?", [(n + 1, i) for n, i in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


# ------------------------------------------------------------------------ 루틴 기록
def log_payload(data, partial=False):
    """루틴 기록의 날짜·시간·메모. partial이면 보낸 칸만 (끌어서 날짜만 옮길 때)."""
    out = {}
    if "date" in data or not partial:
        out["date"] = parse_date(data.get("date"))
    if "start_time" in data or "end_time" in data or not partial:
        start = parse_time(data.get("start_time"), "시작 시간")
        end = parse_time(data.get("end_time"), "끝 시간")
        if start and end and end <= start:
            raise ApiError("끝 시간은 시작 시간보다 늦어야 해요.")
        out["start_time"], out["end_time"] = start, end
    if "memo" in data or not partial:
        memo = str(data.get("memo") or "").strip()
        if len(memo) > MAX_LOG_MEMO:
            raise ApiError(f"메모는 {MAX_LOG_MEMO}자 이하로 적어 주세요.")
        out["memo"] = memo
    return out


def log_rows(db, where="", params=()):
    return db.execute(
        f"""
        SELECT l.*, r.name AS r_name, r.emoji AS r_emoji
        FROM routine_logs l JOIN routines r ON r.id = l.routine_id
        {where}
        ORDER BY l.date, l.start_time IS NULL, l.start_time, r.position, l.id
        """,
        params,
    ).fetchall()


def log_dict(r):
    return {
        "id": r["id"],
        "date": r["date"],
        "start_time": r["start_time"],
        "end_time": r["end_time"],
        "memo": r["memo"],
        "routine": {"id": r["routine_id"], "name": r["r_name"], "emoji": r["r_emoji"]},
    }


def get_log_or_404(db, log_id):
    rows = log_rows(db, "WHERE l.id = ?", (log_id,))
    if not rows:
        raise ApiError("루틴 기록을 찾을 수 없어요.", 404)
    return rows[0]


@bp.get("/routine-logs")
def list_routine_logs():
    """[start, end) 기간의 루틴 기록. 같은 날 안에서는 시간 있는 것 → 시간순, 시간 없는 것은 뒤로."""
    start, end = parse_range()
    return jsonify([log_dict(r) for r in log_rows(get_db(), "WHERE l.date >= ? AND l.date < ?", (start, end))])


@bp.post("/routine-logs")
def create_routine_log():
    db = get_db()
    data = json_body()
    routine_id = data.get("routine_id")
    if not isinstance(routine_id, int):
        raise ApiError("어떤 루틴인지 골라 주세요.")
    get_routine_or_404(db, routine_id)
    fields = log_payload(data)
    cur = db.execute(
        "INSERT INTO routine_logs (routine_id, date, start_time, end_time, memo) VALUES (?, ?, ?, ?, ?)",
        (routine_id, fields["date"], fields["start_time"], fields["end_time"], fields["memo"]),
    )
    db.commit()
    return jsonify(log_dict(get_log_or_404(db, cur.lastrowid))), 201


@bp.put("/routine-logs/<int:log_id>")
def update_routine_log(log_id):
    db = get_db()
    get_log_or_404(db, log_id)
    fields = log_payload(json_body(), partial=True)
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE routine_logs SET {sets} WHERE id = ?", (*fields.values(), log_id))
        db.commit()
    return jsonify(log_dict(get_log_or_404(db, log_id)))


@bp.delete("/routine-logs/<int:log_id>")
def delete_routine_log(log_id):
    db = get_db()
    get_log_or_404(db, log_id)
    db.execute("DELETE FROM routine_logs WHERE id = ?", (log_id,))
    db.commit()
    return jsonify(deleted=log_id)


# ======================================================================== 화면별로 묶어 받기
# 인터넷 서버는 멀리 있어서 요청 하나마다 왕복 시간이 든다. 한 화면에 필요한 것을 한 번에 돌려준다.
def logs_between(db, start, end):
    return [log_dict(r) for r in log_rows(db, "WHERE l.date >= ? AND l.date < ?", (start, end))]


@bp.get("/calendar")
def calendar_range():
    """월간·주간 화면: [start, end) 기간의 일정(날짜별) + 루틴 기록 + 날짜 꾸밈(스티커·형광펜)"""
    db = get_db()
    start, end = parse_range()
    return jsonify(items=occurrence_list(db, start, end), logs=logs_between(db, start, end), marks=marks_between(db, start, end))


@bp.get("/day/<day>")
def day_detail(day):
    """하루 화면: 그날 일정 + 루틴 기록 + 루틴 버튼(그날 기준 마지막으로 기록한 날) + 그날의 꾸밈(스티커·형광펜)"""
    db = get_db()
    day = parse_date(day)
    nxt = (Date.fromisoformat(day) + timedelta(days=1)).isoformat()
    return jsonify(
        items=occurrence_list(db, day, nxt),
        logs=logs_between(db, day, nxt),
        routines=[routine_dict(r) for r in routine_rows(db, day)],
        mark=next(iter(marks_between(db, day, nxt)), None),
    )


@bp.get("/inbox")
def inbox():
    """기록지 한 번에: 메모(notes) + 목표(goals) + 할 일(날짜 없는 일정)"""
    db = get_db()
    return jsonify(
        notes=[note_dict(r) for r in db.execute("SELECT * FROM notes ORDER BY position, id")],
        goals=goal_list(db),
        todos=undated_items(db),
    )


# ======================================================================== 기록지
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


# ======================================================================== 기록지: 목표 (0.9.0, 0.11.0에서 세 단계로)
# 인생 목표(life)  : 기한 없는 큰 방향
# 올해 목표(year)  : 연도 + 진행 방식 — 체크(check) / 숫자(count: current/target) / 루틴 연결(routine: 그 해의 루틴 기록 수)
# 기한 목표(due)   : 0.9.0의 목표. 제목 + 기한(선택). 기한이 있으면 달력 위 D-day 띠에 보인다
# parent_id로 위 단계와 잇는다 (올해 → 인생, 기한 → 올해).
GOAL_KINDS = ("life", "year", "due")
GOAL_MEASURES = ("check", "count", "routine")
MAX_GOAL_TARGET = 100000


def routine_counts(db):
    """(루틴, 연도)별 루틴 기록 수 — 루틴 연결 목표의 진행도"""
    rows = db.execute(
        "SELECT routine_id, substr(date, 1, 4) AS y, COUNT(*) AS n FROM routine_logs GROUP BY routine_id, y"
    )
    return {(r["routine_id"], int(r["y"])): r["n"] for r in rows}


def goal_dict(r, counts=None, routines=None):
    measure = r["measure"]
    current = r["current"]
    routine = None
    if measure == "routine":
        current = (counts or {}).get((r["routine_id"], r["year"]), 0)
        routine = (routines or {}).get(r["routine_id"])
    # 숫자·루틴 목표는 숫자를 채우면 이룬 것, 체크 목표는 체크하면 이룬 것
    done = current >= (r["target"] or 1) if measure != "check" else r["done_at"] is not None
    return {
        "id": r["id"],
        "title": r["title"],
        "due": r["due"],
        "memo": r["memo"],
        "done": done,
        "done_at": r["done_at"],
        "position": r["position"],
        "kind": r["kind"],
        "year": r["year"],
        "parent_id": r["parent_id"],
        "measure": measure,
        "target": r["target"],
        "current": current,
        "routine_id": r["routine_id"],
        "routine": routine,
    }


def goal_list(db):
    """모든 목표 (아직인 것 먼저, 이룬 것은 뒤에). 루틴 연결 목표의 진행도까지 채워서."""
    counts = routine_counts(db)
    routines = {r["id"]: {"name": r["name"], "emoji": r["emoji"]} for r in db.execute("SELECT * FROM routines")}
    goals = [goal_dict(r, counts, routines) for r in db.execute(GOALS_SQL)]
    goals.sort(key=lambda g: g["done"])  # 안정 정렬: 그 안의 순서는 GOALS_SQL 그대로
    return goals


def one_goal(db, goal_id):
    return next(g for g in goal_list(db) if g["id"] == goal_id)


def goal_payload(data, db, existing=None):
    """
    목표 저장 내용 검사. existing이 있으면 수정(보낸 칸만), 없으면 새로 만들기.
    단계(kind)는 만든 뒤에는 바꾸지 않는다.
    """
    partial = existing is not None
    out = {}
    if "title" in data or not partial:
        title = str(data.get("title") or "").strip()
        if not title:
            raise ApiError("목표를 적어 주세요.")
        if len(title) > MAX_GOAL_TITLE:
            raise ApiError(f"목표는 {MAX_GOAL_TITLE}자 이하로 적어 주세요.")
        out["title"] = title
    if "memo" in data or not partial:
        memo = str(data.get("memo") or "").strip()
        if len(memo) > MAX_GOAL_MEMO:
            raise ApiError(f"메모는 {MAX_GOAL_MEMO}자 이하로 적어 주세요.")
        out["memo"] = memo

    kind = existing["kind"] if partial else (data.get("kind") or "due")
    if kind not in GOAL_KINDS:
        raise ApiError("목표의 단계는 life, year, due 중 하나여야 해요.")
    if not partial:
        out["kind"] = kind

    # 기한: 기한 목표만
    if kind == "due":
        if "due" in data or not partial:
            due = data.get("due")
            out["due"] = parse_date(due, "기한") if due not in (None, "") else None
    elif not partial:
        out["due"] = None

    # 위 단계와 잇기: 올해 → 인생, 기한 → 올해
    if "parent_id" in data and kind != "life":
        parent_id = data.get("parent_id")
        if parent_id in (None, "", 0):
            out["parent_id"] = None
        else:
            parent = db.execute("SELECT kind FROM goals WHERE id = ?", (parent_id,)).fetchone() if isinstance(parent_id, int) else None
            want = "life" if kind == "year" else "year"
            if parent is None or parent["kind"] != want:
                raise ApiError("이을 수 있는 목표가 아니에요. (올해 목표 → 인생 목표, 기한 목표 → 올해 목표)")
            out["parent_id"] = parent_id

    if kind == "year":
        if "year" in data or not partial:
            year = data.get("year") or Date.today().year
            if not isinstance(year, int) or isinstance(year, bool) or not 2000 <= year <= 2100:
                raise ApiError("연도를 확인해 주세요.")
            out["year"] = year
        touches = any(k in data for k in ("measure", "target", "routine_id"))
        if touches or not partial:
            measure = data.get("measure") or (existing["measure"] if partial else "check")
            if measure not in GOAL_MEASURES:
                raise ApiError("진행 방식은 check, count, routine 중 하나여야 해요.")
            out["measure"] = measure
            if measure == "check":
                out.update(target=None, routine_id=None)
            else:
                target = data.get("target", existing["target"] if partial else None)
                if not isinstance(target, int) or isinstance(target, bool) or not 1 <= target <= MAX_GOAL_TARGET:
                    raise ApiError("목표 숫자를 1 이상으로 적어 주세요. (예: 100번이면 100)")
                out["target"] = target
                if measure == "routine":
                    routine_id = data.get("routine_id", existing["routine_id"] if partial else None)
                    if not isinstance(routine_id, int) or not db.execute("SELECT 1 FROM routines WHERE id = ?", (routine_id,)).fetchone():
                        raise ApiError("연결할 루틴을 골라 주세요.")
                    out["routine_id"] = routine_id
                else:
                    out["routine_id"] = None
        if "current" in data:
            current = data["current"]
            if not isinstance(current, int) or isinstance(current, bool) or not 0 <= current <= MAX_GOAL_TARGET * 10:
                raise ApiError("지금까지 한 숫자를 0 이상으로 적어 주세요.")
            out["current"] = current
    return out


def get_goal_or_404(db, goal_id):
    row = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if row is None:
        raise ApiError("목표를 찾을 수 없어요.", 404)
    return row


GOALS_SQL = "SELECT * FROM goals ORDER BY done_at IS NOT NULL, done_at DESC, position, id"


@bp.get("/goals")
def list_goals():
    return jsonify(goal_list(get_db()))


@bp.post("/goals")
def create_goal():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM goals").fetchone()["n"] >= MAX_GOALS:
        raise ApiError(f"목표는 {MAX_GOALS}개까지 만들 수 있어요. 이룬 목표를 정리해 주세요.")
    fields = goal_payload(json_body(), db)
    fields["position"] = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM goals").fetchone()["p"]
    cols = ", ".join(fields)
    cur = db.execute(f"INSERT INTO goals ({cols}) VALUES ({', '.join('?' * len(fields))})", tuple(fields.values()))
    db.commit()
    return jsonify(one_goal(db, cur.lastrowid)), 201


@bp.put("/goals/<int:goal_id>")
def update_goal(goal_id):
    db = get_db()
    row = get_goal_or_404(db, goal_id)
    data = json_body()
    fields = goal_payload(data, db, existing=row)
    if "done" in data:
        if not isinstance(data["done"], bool):
            raise ApiError("done은 true/false여야 해요.")
        db.execute(
            "UPDATE goals SET done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now', 'localtime')) END WHERE id = ?",
            (int(data["done"]), goal_id),
        )
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        db.execute(f"UPDATE goals SET {sets} WHERE id = ?", (*fields.values(), goal_id))
    db.commit()
    return jsonify(one_goal(db, goal_id))


@bp.post("/goals/<int:goal_id>/step")
def step_goal(goal_id):
    """숫자 목표의 '+1' (delta: 더할 숫자, 음수면 빼기). 0 아래로는 내려가지 않는다."""
    db = get_db()
    row = get_goal_or_404(db, goal_id)
    if row["measure"] != "count":
        raise ApiError("숫자로 세는 목표만 +1을 할 수 있어요.")
    delta = json_body().get("delta", 1)
    if not isinstance(delta, int) or isinstance(delta, bool) or not -1000 <= delta <= 1000:
        raise ApiError("더할 숫자를 확인해 주세요.")
    db.execute("UPDATE goals SET current = MAX(0, current + ?) WHERE id = ?", (delta, goal_id))
    db.commit()
    return jsonify(one_goal(db, goal_id))


@bp.delete("/goals/<int:goal_id>")
def delete_goal(goal_id):
    """목표를 지워도 그 아래에 이어 둔 목표는 지워지지 않고 연결만 풀린다."""
    db = get_db()
    get_goal_or_404(db, goal_id)
    db.execute("UPDATE goals SET parent_id = NULL WHERE parent_id = ?", (goal_id,))
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()
    return jsonify(deleted=goal_id)


@bp.put("/goals/order")
def reorder_goals():
    """
    같은 묶음 안에서의 순서. 묶음 = 아직 이루지 않은 목표 중
    인생 목표 전부 / 같은 해의 올해 목표 / 올해 목표에 잇지 않은 기한 목표.
    """
    db = get_db()
    ids = json_body().get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids):
        raise ApiError("ids는 번호(정수)의 목록이어야 해요.")
    goals = {g["id"]: g for g in goal_list(db)}
    first = goals.get(ids[0])
    if first is None:
        raise ApiError("목표 목록이 바뀌었어요. 다시 열어 주세요.", 409)

    def same_group(g):
        if g["done"] or g["kind"] != first["kind"]:
            return False
        if g["kind"] == "year":
            return g["year"] == first["year"]
        return g["kind"] == "life" or g["parent_id"] is None

    group = {g["id"] for g in goals.values() if same_group(g)}
    if len(ids) != len(set(ids)) or set(ids) != group:
        raise ApiError("목표 목록이 바뀌었어요. 다시 열어 주세요.", 409)
    db.executemany("UPDATE goals SET position = ? WHERE id = ?", [(n + 1, i) for n, i in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


# ======================================================================== 달력 위 띠: 배너 + D-day + 올해 목표
@bp.get("/overview")
def overview():
    """
    banner : 메인 메모의 배너 글귀 (비어 있으면 null → 화면에서 배너를 숨긴다)
    ddays  : D-day로 표시한 일정 중 오늘 이후 날짜가 남은 것 + 기한이 남은 목표(아직 못 이룬 것), 가까운 순서로.
             여러 날짜에 들어간 일정은 오늘부터 가장 가까운 날짜 기준.
             kind = 'item'(일정) | 'goal'(목표)
    year   : 올해가 얼마나 지났는지 + 올해 목표들 (0.11.0) — 화면이 날마다 하나씩 돌아가며 보여 준다
    life   : 인생 목표들 (0.11.0)
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
    goals = db.execute(
        "SELECT id, title, due FROM goals WHERE kind = 'due' AND done_at IS NULL AND due >= ? ORDER BY due, position LIMIT ?",
        (today.isoformat(), MAX_DDAYS),
    ).fetchall()
    ddays = [
        {"kind": "item", "id": r["id"], "title": r["title"], "date": r["next_date"], "color": r["c_color"]}
        for r in rows
    ] + [
        {"kind": "goal", "id": g["id"], "title": g["title"], "date": g["due"], "color": None}
        for g in goals
    ]
    ddays.sort(key=lambda d: (d["date"], d["kind"] != "item"))  # 같은 날이면 일정 먼저
    for d in ddays:
        d["days_left"] = (Date.fromisoformat(d["date"]) - today).days

    every = goal_list(db)
    year_goals = [g for g in every if g["kind"] == "year" and g["year"] == today.year]
    first, last = Date(today.year, 1, 1), Date(today.year, 12, 31)
    total_days = (last - first).days + 1
    passed = (today - first).days + 1
    year = {
        "year": today.year,
        "percent": round(passed * 100 / total_days),
        "days_left": (last - today).days,
        "total": len(year_goals),
        "done": sum(g["done"] for g in year_goals),
        "goals": [
            {k: g[k] for k in ("id", "title", "measure", "current", "target", "routine")}
            for g in year_goals if not g["done"]
        ],
    }
    # 해가 바뀌었는데 새해 목표가 아직 없으면 화면이 '목표 세우기'를 권한다
    year["nudge"] = not year_goals and any(g["kind"] == "year" and g["year"] == today.year - 1 for g in every)
    life = [{"id": g["id"], "title": g["title"]} for g in every if g["kind"] == "life" and not g["done"]]
    return jsonify(banner=banner, ddays=ddays[:MAX_DDAYS], year=year, life=life)


# ======================================================================== 달력 꾸미기: 날짜 스티커·형광펜 (0.11.0)
MARK_COLORS = ("yellow", "pink", "green", "blue", "purple", "orange")


def marks_between(db, start, end):
    rows = db.execute("SELECT * FROM day_marks WHERE date >= ? AND date < ? ORDER BY date", (start, end))
    return [{"date": r["date"], "sticker": r["sticker"], "color": r["color"]} for r in rows]


@bp.put("/days/<day>/mark")
def set_day_mark(day):
    """그 날짜의 스티커(이모지 하나)와 형광펜 색. 둘 다 비우면 꾸밈이 지워진다. 보낸 칸만 바꾼다."""
    db = get_db()
    day = parse_date(day)
    data = json_body()
    row = db.execute("SELECT * FROM day_marks WHERE date = ?", (day,)).fetchone()
    sticker = row["sticker"] if row else ""
    color = row["color"] if row else ""
    if "sticker" in data:
        sticker = str(data.get("sticker") or "").strip()
        if len(sticker) > MAX_EMOJI_LEN or any(ch.isspace() or unicodedata.category(ch).startswith("L") for ch in sticker):
            raise ApiError("스티커는 이모지 하나만 붙일 수 있어요.")
    if "color" in data:
        color = str(data.get("color") or "")
        if color and color not in MARK_COLORS:
            raise ApiError("형광펜 색을 확인해 주세요.")
    if sticker or color:
        db.execute(
            "INSERT INTO day_marks (date, sticker, color) VALUES (?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET sticker = excluded.sticker, color = excluded.color",
            (day, sticker, color),
        )
    else:
        db.execute("DELETE FROM day_marks WHERE date = ?", (day,))
    db.commit()
    return jsonify(date=day, sticker=sticker, color=color)


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
      - 시간: 시작·끝이 모두 있는 것만 (끝 - 시작). 여러 날짜 일정은 날짜마다 따로 더한다.
      - 일정은 카테고리별로, 루틴 기록은 루틴별로 따로 모은다.
      - 개수: 시간이 없는 것도 센다.
    """
    db = get_db()
    start, end = parse_range()
    rows = db.execute(
        """
        SELECT d.date, i.start_time, i.end_time, c.id AS c_id, c.name AS c_name, c.color AS c_color
        FROM item_dates d
        JOIN items i ON i.id = d.item_id
        JOIN categories c ON c.id = i.category_id
        WHERE d.date >= ? AND d.date < ?
        """,
        (start, end),
    ).fetchall()
    logs = log_rows(db, "WHERE l.date >= ? AND l.date < ?", (start, end))

    categories, routines, days = {}, {}, {}
    schedule_total = routine_total = timed = 0

    def day(date):
        return days.setdefault(date, {"by_category": {}, "routine": 0})

    for r in rows:
        minutes = minutes_between(r["start_time"], r["end_time"])
        cat = categories.setdefault(
            r["c_id"], {"id": r["c_id"], "name": r["c_name"], "color": r["c_color"], "minutes": 0, "count": 0}
        )
        cat["count"] += 1
        cat["minutes"] += minutes
        if minutes:
            timed += 1
            schedule_total += minutes
            bucket = day(r["date"])["by_category"]
            bucket[str(r["c_id"])] = bucket.get(str(r["c_id"]), 0) + minutes

    for log in logs:
        minutes = minutes_between(log["start_time"], log["end_time"])
        rt = routines.setdefault(
            log["routine_id"],
            {"id": log["routine_id"], "name": log["r_name"], "emoji": log["r_emoji"], "count": 0, "minutes": 0},
        )
        rt["count"] += 1
        rt["minutes"] += minutes
        if minutes:
            routine_total += minutes
            day(log["date"])["routine"] += minutes

    return jsonify(
        start=start,
        end=end,
        total_minutes=schedule_total + routine_total,
        schedule_minutes=schedule_total,
        routine_minutes=routine_total,
        item_count=len(rows),
        timed_count=timed,
        log_count=len(logs),
        categories=sorted(categories.values(), key=lambda c: (-c["minutes"], -c["count"])),
        routines=sorted(routines.values(), key=lambda r: (-r["count"], -r["minutes"])),
        days=[{"date": d, **v} for d, v in sorted(days.items())],
    )


# ======================================================================== 빠른 입력
@bp.get("/parse")
def parse_quick():
    """한 줄 입력을 해석해서 돌려준다. 저장은 하지 않는다 (화면이 미리 보여 준 뒤 일정 또는 루틴 기록으로 저장)."""
    text = request.args.get("text", "")
    if len(text) > MAX_PARSE_TEXT:
        raise ApiError(f"빠른 입력은 {MAX_PARSE_TEXT}자까지 쓸 수 있어요.")
    today = today_arg()
    db = get_db()
    categories = [dict(r) for r in db.execute("SELECT id, name, color FROM categories ORDER BY is_default DESC, id")]
    routines = [dict(r) for r in db.execute("SELECT id, name, emoji FROM routines ORDER BY position, id")]
    return jsonify(quickadd.parse(text, today, categories, routines))
