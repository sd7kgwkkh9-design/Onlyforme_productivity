"""
REST API (JSON) — 화면(JavaScript)이 fetch()로 호출하는 주소들.

카테고리
  GET    /api/categories                  카테고리 목록 (+ 소속 일정 수)
  POST   /api/categories                  카테고리 추가
  PUT    /api/categories/<id>             이름/색상 수정 (미분류는 불가)
  DELETE /api/categories/<id>             삭제 → 소속 일정은 미분류로 이동

일정
  GET    /api/occurrences?start=&end=     기간 안의 "날짜별 일정"
  GET    /api/calendar?start=&end=        월간·주간 화면용: 일정 + 루틴 기록을 한 번에 (api_tools.py)
  GET    /api/day/<date>                  하루 화면용: 일정 + 루틴 기록 + 루틴 버튼을 한 번에 (api_tools.py)
  GET    /api/items/undated               기한 미정 일정 목록
  GET    /api/items/<id>                  일정 하나 (모든 날짜 포함)
  POST   /api/items                       일정 추가
  PUT    /api/items/<id>                  일정 수정 (scope = all | single)
  DELETE /api/items/<id>?scope=&date=     일정 삭제 (scope = all | single)
  PUT    /api/days/<date>/order           그 날짜 안의 일정 순서 바꾸기
  POST   /api/items/<id>/move             한 날짜를 다른 날짜로 옮기기 (달력에서 끌어서 놓기)
  POST   /api/items/<id>/copy             같은 내용으로 새 일정 만들기 (Option/Alt 누르고 끌기)

루틴·루틴 기록·기록지·D-day·시간 돌아보기·빠른 입력 → api_tools.py

동기화
  GET    /api/version                     변경 번호 (저장·삭제할 때마다 1씩 커짐)

공휴일
  GET    /api/holidays?start=&end=        기간 안의 한국 공휴일 (python-holidays 사용)

scope 설명
  여러 날짜에 들어간 일정을 어느 한 날짜에서 수정/삭제할 때,
  all    → 모든 날짜에 반영
  single → 그 날짜(date)만 원래 일정에서 떼어 내서 처리
"""

import re
from datetime import date as Date
from functools import lru_cache

from flask import Blueprint, current_app, jsonify, request

from db import current_version, default_category_id, get_db

# 공휴일 라이브러리는 없어도 앱이 동작하도록 선택적으로 불러온다.
try:
    import holidays as holidays_lib
except ImportError:  # pip install -r requirements.txt 를 다시 하면 해결
    holidays_lib = None

bp = Blueprint("api", __name__, url_prefix="/api")

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")   # 00:00 ~ 23:59
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

MAX_TITLE = 100
MAX_MEMO = 2000
MAX_CATEGORY_NAME = 20
MAX_DATES_PER_ITEM = 366
MAX_RANGE_DAYS = 400


# ---------------------------------------------------------------------------
# 오류 처리: ApiError를 던지면 {"error": "메시지"} JSON으로 응답한다.
# ---------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@bp.errorhandler(ApiError)
def handle_api_error(err):
    return jsonify(error=err.message), err.status


def json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("요청 형식이 올바르지 않아요. (JSON 객체가 필요해요)")
    return data


# ---------------------------------------------------------------------------
# 입력값 검사 함수들
# ---------------------------------------------------------------------------
def parse_date(value, field="날짜"):
    """'YYYY-MM-DD' 문자열인지, 실제로 있는 날짜인지(2월 30일 X) 확인한다."""
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ApiError(f"{field} 형식이 올바르지 않아요. (YYYY-MM-DD)")
    try:
        Date.fromisoformat(value)
    except ValueError:
        raise ApiError(f"존재하지 않는 {field}예요: {value}")
    return value


def parse_range():
    """?start=&end= 쿼리를 읽는다. [start, end) — end는 포함하지 않는다."""
    # FullCalendar는 '2026-11-01T00:00:00+09:00' 형태로 보내므로 앞 10글자만 쓴다.
    start = parse_date((request.args.get("start") or "")[:10], "시작 날짜")
    end = parse_date((request.args.get("end") or "")[:10], "끝 날짜")
    span = (Date.fromisoformat(end) - Date.fromisoformat(start)).days
    if span <= 0:
        raise ApiError("끝 날짜는 시작 날짜보다 뒤여야 해요.")
    if span > MAX_RANGE_DAYS:
        raise ApiError(f"한 번에 {MAX_RANGE_DAYS}일까지만 조회할 수 있어요.")
    return start, end


def parse_item_payload(data, db):
    """일정 추가/수정 요청 본문을 검사해서 깔끔한 dict로 돌려준다."""
    title = str(data.get("title") or "").strip()
    if not title:
        raise ApiError("제목을 입력해 주세요.")
    if len(title) > MAX_TITLE:
        raise ApiError(f"제목은 {MAX_TITLE}자 이하로 적어 주세요.")

    memo = str(data.get("memo") or "").strip()
    if len(memo) > MAX_MEMO:
        raise ApiError(f"메모는 {MAX_MEMO}자 이하로 적어 주세요.")

    # 시간은 선택 사항: 시작·끝 중 하나만 있어도 되고, 둘 다 없으면 '시간 없는 할 일'
    start_time = parse_time(data.get("start_time"), "시작 시간")
    end_time = parse_time(data.get("end_time"), "끝 시간")
    if start_time and end_time and end_time <= start_time:
        raise ApiError("끝 시간은 시작 시간보다 늦어야 해요.")

    # 카테고리를 안 보내면 미분류로
    category_id = data.get("category_id")
    if category_id in (None, ""):
        category_id = default_category_id(db)
    else:
        try:
            category_id = int(category_id)
        except (TypeError, ValueError):
            raise ApiError("카테고리 값이 올바르지 않아요.")
        if not db.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone():
            raise ApiError("카테고리를 찾을 수 없어요.", 404)

    # 날짜는 여러 개 가능, 비어 있으면 '기한 미정'
    dates = data.get("dates", [])
    if not isinstance(dates, list):
        raise ApiError("dates는 날짜 문자열의 목록이어야 해요.")
    dates = sorted({parse_date(d) for d in dates})  # 중복 제거 + 정렬
    if len(dates) > MAX_DATES_PER_ITEM:
        raise ApiError(f"날짜는 한 번에 {MAX_DATES_PER_ITEM}개까지 넣을 수 있어요.")

    # D-day 표시 (7차) — 요청에 없으면 None = '안 바꿈'(수정할 때는 원래 값 유지)
    dday = data.get("dday")
    if dday is not None and not isinstance(dday, bool):
        raise ApiError("dday는 true/false여야 해요.")

    return {
        "title": title,
        "memo": memo,
        "start_time": start_time,
        "end_time": end_time,
        "category_id": category_id,
        "dates": dates,
        "dday": dday,
    }


def fill_unchanged(fields, row):
    """수정 요청에 dday가 없으면 원래 일정의 값을 그대로 쓴다 (예전 화면에서 저장해도 표시가 사라지지 않게)."""
    if fields["dday"] is None:
        fields["dday"] = bool(row["dday"]) if row is not None else False
    return fields


def parse_time(value, field):
    """'HH:MM'(24시간) 또는 빈 값 → 문자열 또는 None. 'HH:MM' 문자열은 그대로 크기 비교가 된다."""
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not TIME_RE.match(value):
        raise ApiError(f"{field} 형식이 올바르지 않아요. (00:00 ~ 23:59)")
    return value


def parse_category_payload(data, db, exclude_id=None):
    name = str(data.get("name") or "").strip()
    if not name:
        raise ApiError("카테고리 이름을 입력해 주세요.")
    if len(name) > MAX_CATEGORY_NAME:
        raise ApiError(f"카테고리 이름은 {MAX_CATEGORY_NAME}자 이하로 적어 주세요.")

    color = str(data.get("color") or "").strip()
    if not COLOR_RE.match(color):
        raise ApiError("색상 형식이 올바르지 않아요. (#RRGGBB)")

    dup = db.execute(
        "SELECT id FROM categories WHERE name = ? AND id IS NOT ?", (name, exclude_id)
    ).fetchone()
    if dup:
        raise ApiError(f"'{name}' 카테고리가 이미 있어요.")

    return {"name": name, "color": color.upper()}


# ---------------------------------------------------------------------------
# DB 행 → JSON 변환 도우미
# ---------------------------------------------------------------------------
def category_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "color": row["color"],
        "is_default": bool(row["is_default"]),
    }


def get_item_or_404(db, item_id):
    row = db.execute(
        """
        SELECT i.*, c.name AS c_name, c.color AS c_color, c.is_default AS c_default
        FROM items i JOIN categories c ON c.id = i.category_id
        WHERE i.id = ?
        """,
        (item_id,),
    ).fetchone()
    if row is None:
        raise ApiError("일정을 찾을 수 없어요.", 404)
    return row


def item_dict(db, row):
    dates = [
        r["date"]
        for r in db.execute(
            "SELECT date FROM item_dates WHERE item_id = ? ORDER BY date", (row["id"],)
        )
    ]
    return {
        "id": row["id"],
        "title": row["title"],
        "memo": row["memo"],
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "category": {
            "id": row["category_id"],
            "name": row["c_name"],
            "color": row["c_color"],
            "is_default": bool(row["c_default"]),
        },
        "dates": dates,
        "dday": bool(row["dday"]),
    }


def insert_item(db, fields, keep_positions=None):
    fill_unchanged(fields, None)
    cur = db.execute(
        "INSERT INTO items (title, memo, category_id, start_time, end_time, dday) VALUES (?, ?, ?, ?, ?, ?)",
        (fields["title"], fields["memo"], fields["category_id"], fields["start_time"], fields["end_time"],
         int(fields["dday"])),
    )
    item_id = cur.lastrowid
    add_item_dates(db, item_id, fields["dates"], keep_positions)
    return item_id


def add_item_dates(db, item_id, dates, keep_positions=None):
    """
    일정을 날짜들에 넣는다. 새로 들어가는 날짜에서는 그날 목록의 맨 아래(= 올린 순서)에 붙는다.
    keep_positions={'2026-11-05': 3} 처럼 주면 그 날짜에서는 원래 자리를 그대로 쓴다.
    """
    keep_positions = keep_positions or {}
    for d in dates:
        if d in keep_positions:
            position = keep_positions[d]
        else:
            position = db.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM item_dates WHERE date = ?", (d,)
            ).fetchone()["p"]
        db.execute(
            "INSERT INTO item_dates (item_id, date, position) VALUES (?, ?, ?)", (item_id, d, position)
        )


def item_date_count(db, item_id):
    return db.execute(
        "SELECT COUNT(*) AS n FROM item_dates WHERE item_id = ?", (item_id,)
    ).fetchone()["n"]


def require_item_date(db, item_id, raw_date):
    """scope=single일 때: 그 날짜가 정말 이 일정에 들어 있는지 확인."""
    d = parse_date(raw_date, "기준 날짜")
    exists = db.execute(
        "SELECT 1 FROM item_dates WHERE item_id = ? AND date = ?", (item_id, d)
    ).fetchone()
    if not exists:
        raise ApiError("이 일정은 그 날짜에 들어 있지 않아요.")
    return d


def parse_scope(value):
    scope = value or "all"
    if scope not in ("all", "single"):
        raise ApiError("scope는 all 또는 single이어야 해요.")
    return scope


# ---------------------------------------------------------------------------
# 카테고리 API
# ---------------------------------------------------------------------------
@bp.get("/categories")
def list_categories():
    db = get_db()
    rows = db.execute(
        """
        SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count
        FROM categories c
        ORDER BY c.is_default DESC, c.id
        """
    ).fetchall()
    return jsonify([{**category_dict(r), "item_count": r["item_count"]} for r in rows])


@bp.post("/categories")
def create_category():
    db = get_db()
    fields = parse_category_payload(json_body(), db)
    cur = db.execute(
        "INSERT INTO categories (name, color) VALUES (?, ?)", (fields["name"], fields["color"])
    )
    db.commit()
    row = db.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(category_dict(row)), 201


def get_editable_category(db, category_id):
    row = db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise ApiError("카테고리를 찾을 수 없어요.", 404)
    if row["is_default"]:
        raise ApiError("기본 카테고리(미분류)는 바꾸거나 지울 수 없어요.", 403)
    return row


@bp.put("/categories/<int:category_id>")
def update_category(category_id):
    db = get_db()
    get_editable_category(db, category_id)
    fields = parse_category_payload(json_body(), db, exclude_id=category_id)
    db.execute(
        "UPDATE categories SET name = ?, color = ? WHERE id = ?",
        (fields["name"], fields["color"], category_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    return jsonify(category_dict(row))


@bp.delete("/categories/<int:category_id>")
def delete_category(category_id):
    db = get_db()
    get_editable_category(db, category_id)
    # 지우기 전에 소속 일정을 '미분류'로 옮긴다.
    moved = db.execute(
        "UPDATE items SET category_id = ? WHERE category_id = ?",
        (default_category_id(db), category_id),
    ).rowcount
    db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    db.commit()
    return jsonify(deleted=category_id, moved=moved)


# ---------------------------------------------------------------------------
# 일정 API
# ---------------------------------------------------------------------------
def occurrence_list(db, start, end):
    """
    [start, end) 기간에 들어 있는 일정을 "날짜별로 한 줄씩" (end는 포함하지 않음).
    일정 하나가 3개 날짜에 들어 있으면 3줄이 나온다. /api/calendar, /api/day 에서도 같이 쓴다.
    """
    rows = db.execute(
        """
        SELECT d.date, i.id, i.title, i.memo, i.start_time, i.end_time, i.dday,
               c.id AS c_id, c.name AS c_name, c.color AS c_color,
               (SELECT COUNT(*) FROM item_dates d2 WHERE d2.item_id = i.id) AS date_count
        FROM item_dates d
        JOIN items i      ON i.id = d.item_id
        JOIN categories c ON c.id = i.category_id
        WHERE d.date >= ? AND d.date < ?
        -- 같은 날 안에서는 position 순서 (기본은 올린 순서, 하루 창에서 끌어서 바꿀 수 있음)
        ORDER BY d.date, d.position, i.id
        """,
        (start, end),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "date": r["date"],
            "title": r["title"],
            "memo": r["memo"],
            "start_time": r["start_time"],
            "end_time": r["end_time"],
            "category": {"id": r["c_id"], "name": r["c_name"], "color": r["c_color"]},
            "date_count": r["date_count"],
            "dday": bool(r["dday"]),
        }
        for r in rows
    ]


@bp.get("/occurrences")
def list_occurrences():
    """기간 안의 "날짜별 일정" (FullCalendar가 ?start=&end= 로 요청한다)"""
    start, end = parse_range()
    return jsonify(occurrence_list(get_db(), start, end))


@bp.get("/items/undated")
def list_undated():
    """날짜가 하나도 없는 일정 = 기한 미정."""
    db = get_db()
    rows = db.execute(
        """
        SELECT i.*, c.name AS c_name, c.color AS c_color, c.is_default AS c_default
        FROM items i JOIN categories c ON c.id = i.category_id
        WHERE NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = i.id)
        ORDER BY i.id DESC
        """
    ).fetchall()
    return jsonify([item_dict(db, r) for r in rows])


@bp.get("/items/<int:item_id>")
def get_item(item_id):
    db = get_db()
    return jsonify(item_dict(db, get_item_or_404(db, item_id)))


@bp.post("/items")
def create_item():
    db = get_db()
    fields = parse_item_payload(json_body(), db)
    item_id = insert_item(db, fields)
    db.commit()
    return jsonify(item_dict(db, get_item_or_404(db, item_id))), 201


@bp.put("/items/<int:item_id>")
def update_item(item_id):
    db = get_db()
    row = get_item_or_404(db, item_id)
    data = json_body()
    scope = parse_scope(data.get("scope"))
    fields = fill_unchanged(parse_item_payload(data, db), row)

    if scope == "single":
        ctx_date = require_item_date(db, item_id, data.get("date"))
        if item_date_count(db, item_id) > 1:
            # 이 날짜만 원래 일정에서 떼어 내고, 수정된 내용으로 새 일정을 만든다.
            # 새 일정은 그날 목록에서 원래 일정이 있던 자리를 그대로 이어받는다.
            old_position = db.execute(
                "SELECT position FROM item_dates WHERE item_id = ? AND date = ?", (item_id, ctx_date)
            ).fetchone()["position"]
            db.execute(
                "DELETE FROM item_dates WHERE item_id = ? AND date = ?", (item_id, ctx_date)
            )
            new_id = insert_item(db, fields, keep_positions={ctx_date: old_position})
            db.commit()
            return jsonify(item_dict(db, get_item_or_404(db, new_id)))
        # 날짜가 하나뿐이면 '이 날만'과 '전체'가 같으므로 아래로 진행

    db.execute(
        "UPDATE items SET title = ?, memo = ?, category_id = ?, start_time = ?, end_time = ?, dday = ? WHERE id = ?",
        (fields["title"], fields["memo"], fields["category_id"], fields["start_time"], fields["end_time"],
         int(fields["dday"]), item_id),
    )
    # 날짜는 바뀐 부분만 반영한다: 그대로 남는 날짜는 그날의 순서(position)를 유지해야 하므로
    # 전부 지우고 다시 넣지 않는다.
    current = {r["date"] for r in db.execute("SELECT date FROM item_dates WHERE item_id = ?", (item_id,))}
    wanted = set(fields["dates"])
    db.executemany(
        "DELETE FROM item_dates WHERE item_id = ? AND date = ?",
        [(item_id, d) for d in current - wanted],
    )
    add_item_dates(db, item_id, sorted(wanted - current))
    db.commit()
    return jsonify(item_dict(db, get_item_or_404(db, item_id)))


@bp.delete("/items/<int:item_id>")
def delete_item(item_id):
    db = get_db()
    get_item_or_404(db, item_id)
    scope = parse_scope(request.args.get("scope"))

    if scope == "single":
        ctx_date = require_item_date(db, item_id, request.args.get("date"))
        if item_date_count(db, item_id) > 1:
            db.execute(
                "DELETE FROM item_dates WHERE item_id = ? AND date = ?", (item_id, ctx_date)
            )
            db.commit()
            return jsonify(deleted=item_id, scope="single", date=ctx_date)

    # item_dates는 ON DELETE CASCADE로 같이 지워진다.
    db.execute("DELETE FROM items WHERE id = ?", (item_id,))
    db.commit()
    return jsonify(deleted=item_id, scope="all")


@bp.put("/days/<day>/order")
def reorder_day(day):
    """
    하루 창에서 끌어서 바꾼 순서를 저장한다.
    본문: {"item_ids": [3, 1, 7]}  ← 그날 일정 전부를 위에서부터 순서대로
    """
    db = get_db()
    day = parse_date(day)
    ids = json_body().get("item_ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        raise ApiError("item_ids는 일정 번호(정수)의 목록이어야 해요.")

    on_day = {r["item_id"] for r in db.execute("SELECT item_id FROM item_dates WHERE date = ?", (day,))}
    if len(ids) != len(set(ids)) or set(ids) != on_day:
        # 그 사이 다른 기기에서 일정이 추가/삭제된 경우 등
        raise ApiError("그날 일정 목록이 바뀌었어요. 창을 닫았다가 다시 열어 주세요.", 409)

    db.executemany(
        "UPDATE item_dates SET position = ? WHERE item_id = ? AND date = ?",
        [(index + 1, item_id, day) for index, item_id in enumerate(ids)],
    )
    db.commit()
    return jsonify(date=day, item_ids=ids)


@bp.post("/items/<int:item_id>/move")
def move_item_date(item_id):
    """
    달력에서 일정을 다른 날짜로 끌어다 놓았을 때: 그 날짜 하나만 옮긴다.
    본문: {"from": "2026-11-05", "to": "2026-11-07"}
    여러 날짜에 들어간 일정이면 나머지 날짜는 그대로 두고, 옮긴 날짜에서는 그날 목록 맨 아래에 붙는다.
    """
    db = get_db()
    get_item_or_404(db, item_id)
    data = json_body()
    src = require_item_date(db, item_id, data.get("from"))
    dst = parse_date(data.get("to"), "옮길 날짜")
    if src != dst:
        if db.execute("SELECT 1 FROM item_dates WHERE item_id = ? AND date = ?", (item_id, dst)).fetchone():
            raise ApiError("이 일정은 이미 그 날짜에 들어 있어요.", 409)
        db.execute("DELETE FROM item_dates WHERE item_id = ? AND date = ?", (item_id, src))
        add_item_dates(db, item_id, [dst])
        db.commit()
    return jsonify(item_dict(db, get_item_or_404(db, item_id)))


@bp.post("/items/<int:item_id>/copy")
def copy_item(item_id):
    """
    같은 내용(제목·메모·카테고리·시간·D-day)으로 새 일정을 만든다.
    본문: {"dates": ["2026-11-07"]}  ← 비워 두면 기한 미정으로
    """
    db = get_db()
    row = get_item_or_404(db, item_id)
    dates = json_body().get("dates", [])
    if not isinstance(dates, list):
        raise ApiError("dates는 날짜 문자열의 목록이어야 해요.")
    fields = {
        "title": row["title"], "memo": row["memo"], "category_id": row["category_id"],
        "start_time": row["start_time"], "end_time": row["end_time"],
        "dates": sorted({parse_date(d) for d in dates}),
        "dday": bool(row["dday"]),
    }
    new_id = insert_item(db, fields)
    db.commit()
    return jsonify(item_dict(db, get_item_or_404(db, new_id))), 201


# ---------------------------------------------------------------------------
# 동기화: 변경 번호
# ---------------------------------------------------------------------------
@bp.get("/version")
def get_version():
    """화면은 몇 초마다 이 번호만 확인하고, 바뀌었을 때만 일정을 다시 불러온다."""
    return jsonify(version=current_version(get_db()))


# ---------------------------------------------------------------------------
# 공휴일 API
# ---------------------------------------------------------------------------
@lru_cache(maxsize=16)
def korean_holidays(year):
    """한 해의 공휴일 {'YYYY-MM-DD': '이름'}. 설날·추석(음력)과 대체 공휴일 포함."""
    kr = holidays_lib.country_holidays("KR", years=year)
    return {d.isoformat(): name for d, name in sorted(kr.items())}


@bp.get("/holidays")
def list_holidays():
    start, end = parse_range()
    if holidays_lib is None:
        current_app.logger.warning("holidays 패키지가 없어 공휴일을 표시하지 않아요. pip install -r requirements.txt")
        return jsonify([])

    result = []
    for year in range(int(start[:4]), int(end[:4]) + 1):
        for d, name in korean_holidays(year).items():
            if start <= d < end:
                result.append({"date": d, "name": name})
    return jsonify(result)
