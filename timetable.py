"""
시간표 (0.13.0) — 학교 수업, 학원, 알바처럼 매주 반복되는 틀. api.py와 같은 /api 묶음에 붙는다.

일정(items)처럼 날짜마다 한 줄씩 저장하지 않고 '규칙'으로 둔다:
  시간표(기간, 공휴일엔 쉬기) ─ 칸(요일 + 시작·끝 + 이름·장소) ─ 이날만 쉬기
달력에 보일 때 그 기간의 날짜마다 펼친다 (class_occurrences). 그래서 학기 중에 강의실이 바뀌어도 칸 하나만 고치면 된다.

  GET    /api/timetables                       시간표 목록 + 칸 + 다가오는 '이날만 쉬기'
  POST   /api/timetables                       시간표 추가 {name, color, start_date, end_date, skip_holidays}
  PUT    /api/timetables/<id>                  수정 (보낸 칸만)
  DELETE /api/timetables/<id>                  삭제 (칸과 쉬는 날도 함께)
  PUT    /api/timetables/order                 순서 {ids: [...]}
  POST   /api/timetables/<id>/blocks           칸 추가 {title, weekdays: [1, 3], start_time, end_time, place, memo, color}
                                                → 요일마다 칸 하나씩. 응답에 겹치는 칸(conflicts)을 알려 준다
  PUT    /api/timetable-blocks/<id>            칸 수정 (보낸 칸만) → {block, conflicts}
  DELETE /api/timetable-blocks/<id>            칸 삭제
  PUT    /api/timetable-skips                  이날만 쉬기 {timetable_id, block_id(0 = 그 시간표 전체), date, skip: true|false}
  GET    /api/timetable/occurrences?start=&end=  기간에 펼친 수업들 (쉬는 것 포함, skipped로 표시)
  GET    /api/timetable/import                 시간표로 옮길 만한 반복 일정 (같은 요일·같은 시간에 매주 들어간 일정)
  POST   /api/timetable/import                 {item_ids, timetable_id | new_name, delete_items} 반복 일정 → 시간표 칸

요일 번호는 화면과 같이 0=일 1=월 … 6=토.
"""

from datetime import date as Date
from datetime import timedelta
from itertools import pairwise

from flask import jsonify

from api import (
    COLOR_RE,
    ApiError,
    bp,
    holidays_lib,
    json_body,
    korean_holidays,
    parse_date,
    parse_range,
    parse_time,
)
from api_plans import kst_today
from api_tools import id_list
from db import get_db

MAX_TIMETABLES = 12
MAX_BLOCKS = 200
MAX_NAME = 30
MAX_TITLE = 40
MAX_PLACE = 40
MAX_MEMO = 500
TIMETABLE_COLORS = ("#3D6FD9", "#3FA66B", "#F08C2E", "#7C5CD6", "#2BA5B5", "#D45A9A", "#D9A514", "#E5534B")
WEEKDAY_NAMES = "일월화수목금토"


def weekday_of(d):
    """date → 0=일 … 6=토"""
    return (d.weekday() + 1) % 7


def text(data, key, label, max_len, required=False):
    value = str(data.get(key) or "").strip()
    if required and not value:
        raise ApiError(f"{label}을(를) 입력해 주세요.")
    if len(value) > max_len:
        raise ApiError(f"{label}은(는) {max_len}자 이하로 적어 주세요.")
    return value


def color_field(data, key="color", required=True, default=None):
    value = str(data.get(key) or "").strip().upper() or default
    if value is None and not required:
        return None
    if not value or not COLOR_RE.match(value):
        raise ApiError("색상 형식이 올바르지 않아요. (#RRGGBB)")
    return value


# ---------------------------------------------------------------- 표 → JSON
def timetable_dict(t, blocks):
    return {
        "id": t["id"],
        "name": t["name"],
        "color": t["color"],
        "start_date": t["start_date"],
        "end_date": t["end_date"],
        "skip_holidays": bool(t["skip_holidays"]),
        "position": t["position"],
        "blocks": [block_dict(b, t) for b in blocks],
    }


def block_dict(b, t=None):
    return {
        "id": b["id"],
        "timetable_id": b["timetable_id"],
        "title": b["title"],
        "weekday": b["weekday"],
        "start_time": b["start_time"],
        "end_time": b["end_time"],
        "place": b["place"],
        "memo": b["memo"],
        "color": b["color"] or (t["color"] if t else None),
        "own_color": b["color"],
    }


def timetable_rows(db):
    return db.execute("SELECT * FROM timetables ORDER BY position, id").fetchall()


def blocks_by_timetable(db):
    out = {}
    for b in db.execute("SELECT * FROM timetable_blocks ORDER BY weekday, start_time, id"):
        out.setdefault(b["timetable_id"], []).append(b)
    return out


def timetable_list(db):
    blocks = blocks_by_timetable(db)
    return [timetable_dict(t, blocks.get(t["id"], [])) for t in timetable_rows(db)]


def get_timetable_or_404(db, tid):
    row = db.execute("SELECT * FROM timetables WHERE id = ?", (tid,)).fetchone()
    if row is None:
        raise ApiError("시간표를 찾을 수 없어요.", 404)
    return row


def get_block_or_404(db, bid):
    row = db.execute("SELECT * FROM timetable_blocks WHERE id = ?", (bid,)).fetchone()
    if row is None:
        raise ApiError("시간표 칸을 찾을 수 없어요.", 404)
    return row


# ---------------------------------------------------------------- 날짜마다 펼치기
def _holidays_between(start, end):
    if holidays_lib is None:
        return {}
    out = {}
    for y in range(start.year, end.year + 1):
        out.update(korean_holidays(y))
    return out


def class_occurrences(db, start, end, include_skipped=True):
    """
    [start, end) 기간에 펼친 수업 → [{block_id, timetable_id, timetable, date, title, start_time, end_time, place, memo, color, skipped}]
    skipped: None | 'skip'(이 칸만 쉼) | 'all'(그 시간표 전체 쉼) | 'holiday'(공휴일이라 쉼)
    날짜·시작 시간 순서.
    """
    start_d, end_d = Date.fromisoformat(start), Date.fromisoformat(end)
    tables = {t["id"]: t for t in timetable_rows(db)}
    if not tables:
        return []
    blocks = blocks_by_timetable(db)
    skips = {
        (r["timetable_id"], r["block_id"], r["date"])
        for r in db.execute("SELECT * FROM timetable_skips WHERE date >= ? AND date < ?", (start, end))
    }
    holidays = _holidays_between(start_d, end_d) if any(t["skip_holidays"] for t in tables.values()) else {}
    by_weekday = {}
    for bl in blocks.values():
        for b in bl:
            by_weekday.setdefault(b["weekday"], []).append(b)

    out = []
    day = start_d
    while day < end_d:
        iso = day.isoformat()
        for b in by_weekday.get(weekday_of(day), []):
            t = tables.get(b["timetable_id"])
            if t is None or (t["start_date"] and iso < t["start_date"]) or (t["end_date"] and iso > t["end_date"]):
                continue
            skipped = None
            if (t["id"], b["id"], iso) in skips:
                skipped = "skip"
            elif (t["id"], 0, iso) in skips:
                skipped = "all"
            elif t["skip_holidays"] and iso in holidays:
                skipped = "holiday"
            if skipped and not include_skipped:
                continue
            out.append({
                "block_id": b["id"],
                "timetable_id": t["id"],
                "timetable": t["name"],
                "date": iso,
                "title": b["title"],
                "start_time": b["start_time"],
                "end_time": b["end_time"],
                "place": b["place"],
                "memo": b["memo"],
                "color": b["color"] or t["color"],
                "skipped": skipped,
                "holiday": holidays.get(iso) if skipped == "holiday" else None,
            })
        day += timedelta(days=1)
    out.sort(key=lambda o: (o["date"], o["start_time"], o["block_id"]))
    return out


# ---------------------------------------------------------------- 겹치는 칸 찾기
def _periods_overlap(a, b):
    a_start, a_end = a["start_date"] or "0000-01-01", a["end_date"] or "9999-12-31"
    b_start, b_end = b["start_date"] or "0000-01-01", b["end_date"] or "9999-12-31"
    return a_start <= b_end and b_start <= a_end


def conflicts_for(db, block):
    """같은 요일, 시간이 겹치고, 두 시간표의 기간도 겹치는 다른 칸들"""
    tables = {t["id"]: t for t in timetable_rows(db)}
    mine = tables[block["timetable_id"]]
    rows = db.execute(
        "SELECT * FROM timetable_blocks WHERE weekday = ? AND id != ? AND start_time < ? AND end_time > ?",
        (block["weekday"], block["id"], block["end_time"], block["start_time"]),
    ).fetchall()
    return [
        {**block_dict(r, tables[r["timetable_id"]]), "timetable": tables[r["timetable_id"]]["name"]}
        for r in rows
        if _periods_overlap(mine, tables[r["timetable_id"]])
    ]


# ---------------------------------------------------------------- 시간표
def timetable_payload(data, db, existing=None):
    out = {}
    if existing is None or "name" in data:
        out["name"] = text(data, "name", "시간표 이름", MAX_NAME, required=True)
    if existing is None or "color" in data:
        default = None
        if existing is None:
            n = db.execute("SELECT COUNT(*) AS n FROM timetables").fetchone()["n"]
            default = TIMETABLE_COLORS[n % len(TIMETABLE_COLORS)]
        out["color"] = color_field(data, default=default)
    for key, label in (("start_date", "시작 날짜"), ("end_date", "끝 날짜")):
        if existing is None or key in data:
            out[key] = parse_date(data[key], label) if data.get(key) else None
    start = out.get("start_date", existing["start_date"] if existing else None)
    end = out.get("end_date", existing["end_date"] if existing else None)
    if start and end and end < start:
        raise ApiError("끝 날짜는 시작 날짜와 같거나 뒤여야 해요.")
    if existing is None or "skip_holidays" in data:
        value = data.get("skip_holidays", True)
        if not isinstance(value, bool):
            raise ApiError("skip_holidays는 true/false여야 해요.")
        out["skip_holidays"] = int(value)
    return out


def one_timetable(db, tid):
    t = get_timetable_or_404(db, tid)
    blocks = db.execute("SELECT * FROM timetable_blocks WHERE timetable_id = ? ORDER BY weekday, start_time, id", (tid,)).fetchall()
    return timetable_dict(t, blocks)


@bp.get("/timetables")
def list_timetables():
    db = get_db()
    since = (kst_today() - timedelta(days=7)).isoformat()
    skips = [
        {"timetable_id": r["timetable_id"], "block_id": r["block_id"], "date": r["date"]}
        for r in db.execute("SELECT * FROM timetable_skips WHERE date >= ? ORDER BY date", (since,))
    ]
    return jsonify(timetables=timetable_list(db), skips=skips)


@bp.post("/timetables")
def create_timetable():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM timetables").fetchone()["n"] >= MAX_TIMETABLES:
        raise ApiError(f"시간표는 {MAX_TIMETABLES}개까지 만들 수 있어요.")
    f = timetable_payload(json_body(), db)
    position = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM timetables").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO timetables (name, color, start_date, end_date, skip_holidays, position) VALUES (?, ?, ?, ?, ?, ?)",
        (f["name"], f["color"], f["start_date"], f["end_date"], f["skip_holidays"], position),
    )
    db.commit()
    return jsonify(one_timetable(db, cur.lastrowid)), 201


@bp.put("/timetables/order")
def reorder_timetables():
    db = get_db()
    ids = id_list(json_body(), "timetables", "시간표")
    db.executemany("UPDATE timetables SET position = ? WHERE id = ?", [(i + 1, tid) for i, tid in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


@bp.put("/timetables/<int:tid>")
def update_timetable(tid):
    db = get_db()
    row = get_timetable_or_404(db, tid)
    f = timetable_payload(json_body(), db, existing=row)
    if f:
        db.execute(f"UPDATE timetables SET {', '.join(f'{k} = ?' for k in f)} WHERE id = ?", (*f.values(), tid))
        db.commit()
    return jsonify(one_timetable(db, tid))


@bp.delete("/timetables/<int:tid>")
def delete_timetable(tid):
    db = get_db()
    get_timetable_or_404(db, tid)
    db.execute("DELETE FROM timetable_blocks WHERE timetable_id = ?", (tid,))
    db.execute("DELETE FROM timetable_skips WHERE timetable_id = ?", (tid,))
    db.execute("DELETE FROM timetables WHERE id = ?", (tid,))
    db.commit()
    return jsonify(deleted=tid)


# ---------------------------------------------------------------- 칸
def block_payload(data, existing=None):
    out = {}
    if existing is None or "title" in data:
        out["title"] = text(data, "title", "이름", MAX_TITLE, required=True)
    for key, label, max_len in (("place", "장소", MAX_PLACE), ("memo", "메모", MAX_MEMO)):
        if existing is None or key in data:
            out[key] = text(data, key, label, max_len)
    if existing is None or "color" in data:
        out["color"] = color_field(data, required=False)
    for key, label in (("start_time", "시작 시간"), ("end_time", "끝 시간")):
        if existing is None or key in data:
            value = parse_time(data.get(key), label)
            if not value:
                raise ApiError(f"{label}을(를) 정해 주세요.")
            out[key] = value
    start = out.get("start_time", existing["start_time"] if existing else None)
    end = out.get("end_time", existing["end_time"] if existing else None)
    if end <= start:
        raise ApiError("끝 시간은 시작 시간보다 늦어야 해요.")
    if existing is not None and "weekday" in data:
        out["weekday"] = _weekday(data["weekday"])
    return out


def _weekday(value):
    if not isinstance(value, int) or not 0 <= value <= 6:
        raise ApiError("요일은 0(일)~6(토) 숫자로 보내 주세요.")
    return value


@bp.post("/timetables/<int:tid>/blocks")
def create_blocks(tid):
    db = get_db()
    get_timetable_or_404(db, tid)
    data = json_body()
    weekdays = data.get("weekdays")
    if weekdays is None and "weekday" in data:
        weekdays = [data["weekday"]]
    if not isinstance(weekdays, list) or not weekdays:
        raise ApiError("요일을 하나 이상 골라 주세요.")
    weekdays = sorted({_weekday(w) for w in weekdays})
    if db.execute("SELECT COUNT(*) AS n FROM timetable_blocks").fetchone()["n"] + len(weekdays) > MAX_BLOCKS:
        raise ApiError(f"시간표 칸은 모두 합쳐 {MAX_BLOCKS}개까지 만들 수 있어요.")
    f = block_payload(data)
    made = []
    for w in weekdays:
        cur = db.execute(
            "INSERT INTO timetable_blocks (timetable_id, title, weekday, start_time, end_time, place, memo, color)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, f["title"], w, f["start_time"], f["end_time"], f["place"], f["memo"], f["color"]),
        )
        made.append(cur.lastrowid)
    db.commit()
    blocks = [get_block_or_404(db, bid) for bid in made]
    conflicts = {c["id"]: c for b in blocks for c in conflicts_for(db, b) if c["id"] not in made}
    t = get_timetable_or_404(db, tid)
    return jsonify(blocks=[block_dict(b, t) for b in blocks], conflicts=list(conflicts.values())), 201


@bp.put("/timetable-blocks/<int:bid>")
def update_block(bid):
    db = get_db()
    row = get_block_or_404(db, bid)
    f = block_payload(json_body(), existing=row)
    if f:
        db.execute(f"UPDATE timetable_blocks SET {', '.join(f'{k} = ?' for k in f)} WHERE id = ?", (*f.values(), bid))
        db.commit()
    block = get_block_or_404(db, bid)
    return jsonify(block=block_dict(block, get_timetable_or_404(db, block["timetable_id"])), conflicts=conflicts_for(db, block))


@bp.delete("/timetable-blocks/<int:bid>")
def delete_block(bid):
    db = get_db()
    get_block_or_404(db, bid)
    db.execute("DELETE FROM timetable_blocks WHERE id = ?", (bid,))
    db.execute("DELETE FROM timetable_skips WHERE block_id = ?", (bid,))
    db.commit()
    return jsonify(deleted=bid)


@bp.put("/timetable-skips")
def set_skip():
    """이날만 쉬기 / 다시 하기. block_id가 0이면 그날 그 시간표 전체"""
    db = get_db()
    data = json_body()
    try:
        tid = int(data.get("timetable_id"))
        block_id = int(data.get("block_id") or 0)
    except (TypeError, ValueError):
        raise ApiError("timetable_id, block_id는 번호여야 해요.") from None
    get_timetable_or_404(db, tid)
    if block_id:
        block = get_block_or_404(db, block_id)
        if block["timetable_id"] != tid:
            raise ApiError("그 시간표의 칸이 아니에요.")
    day = parse_date(data.get("date"))
    skip = data.get("skip", True)
    if not isinstance(skip, bool):
        raise ApiError("skip은 true/false여야 해요.")
    if skip:
        db.execute("INSERT OR IGNORE INTO timetable_skips (timetable_id, block_id, date) VALUES (?, ?, ?)", (tid, block_id, day))
    else:
        db.execute("DELETE FROM timetable_skips WHERE timetable_id = ? AND block_id = ? AND date = ?", (tid, block_id, day))
    db.commit()
    return jsonify(timetable_id=tid, block_id=block_id, date=day, skip=skip)


@bp.get("/timetable/occurrences")
def list_class_occurrences():
    start, end = parse_range()
    return jsonify(class_occurrences(get_db(), start, end))


# ---------------------------------------------------------------- 반복 일정 → 시간표로 옮기기
MIN_REPEAT = 3


def import_candidates(db):
    """
    날짜가 3개 이상이고 시작·끝 시간이 있으며, 같은 요일들에 매주(또는 격주) 들어간 일정.
    빠른 입력의 '매주 월수 9시 컴구 ~12/15'로 만든 반복 일정이 여기에 해당한다.
    """
    rows = db.execute(
        """
        SELECT i.id, i.title, i.memo, i.start_time, i.end_time, c.name AS c_name, c.color AS c_color
        FROM items i JOIN categories c ON c.id = i.category_id
        WHERE i.start_time IS NOT NULL AND i.end_time IS NOT NULL
          AND (SELECT COUNT(*) FROM item_dates d WHERE d.item_id = i.id) >= ?
        ORDER BY i.id
        """,
        (MIN_REPEAT,),
    ).fetchall()
    out = []
    for r in rows:
        dates = [Date.fromisoformat(x["date"]) for x in db.execute("SELECT date FROM item_dates WHERE item_id = ? ORDER BY date", (r["id"],))]
        weekdays = sorted({weekday_of(d) for d in dates})
        if len(weekdays) > 3:
            continue
        by_wd = {}
        for d in dates:
            by_wd.setdefault(weekday_of(d), []).append(d)
        # 요일마다 두 번 이상, 7일 간격으로 (어쩌다 같은 시간에 몇 번 있었던 일정은 빼고)
        if not all(len(ds) >= 2 and all((b - a).days % 7 == 0 for a, b in pairwise(ds)) for ds in by_wd.values()):
            continue
        out.append({
            "item_id": r["id"],
            "title": r["title"],
            "memo": r["memo"],
            "start_time": r["start_time"],
            "end_time": r["end_time"],
            "weekdays": weekdays,
            "first": dates[0].isoformat(),
            "last": dates[-1].isoformat(),
            "count": len(dates),
            "category": {"name": r["c_name"], "color": r["c_color"]},
            "label": f"{'·'.join(WEEKDAY_NAMES[w] for w in weekdays)} {r['start_time']}~{r['end_time']}",
        })
    return out


@bp.get("/timetable/import")
def list_import_candidates():
    return jsonify(import_candidates(get_db()))


@bp.post("/timetable/import")
def import_items():
    """
    고른 반복 일정을 시간표 칸으로 옮긴다.
      - 새 시간표(new_name)로 옮기면 기간을 그 일정들의 첫 날짜 ~ 마지막 날짜로 맞춘다.
      - 그 기간 안에서 원래 일정에 빠져 있던 주(시험 기간 등)는 '이날만 쉬기'로 넣어서 달력에 똑같이 보이게 한다.
      - delete_items가 true면 원래 일정은 지운다 (같은 수업이 두 번 보이지 않게).
    """
    db = get_db()
    data = json_body()
    ids = data.get("item_ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids):
        raise ApiError("옮길 일정을 하나 이상 골라 주세요.")
    picked = [c for c in import_candidates(db) if c["item_id"] in ids]
    if len(picked) != len(set(ids)):
        raise ApiError("시간표로 옮길 수 없는 일정이 섞여 있어요. 목록을 다시 열어 주세요.", 409)

    if data.get("new_name"):
        f = timetable_payload({"name": data["new_name"], "start_date": min(c["first"] for c in picked),
                               "end_date": max(c["last"] for c in picked), "skip_holidays": False}, db)
        position = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM timetables").fetchone()["p"]
        tid = db.execute(
            "INSERT INTO timetables (name, color, start_date, end_date, skip_holidays, position) VALUES (?, ?, ?, ?, ?, ?)",
            (f["name"], f["color"], f["start_date"], f["end_date"], f["skip_holidays"], position),
        ).lastrowid
    else:
        try:
            tid = int(data.get("timetable_id"))
        except (TypeError, ValueError):
            raise ApiError("옮길 시간표를 골라 주세요.") from None
        get_timetable_or_404(db, tid)
    table = get_timetable_or_404(db, tid)

    made = 0
    for c in picked:
        have = {x["date"] for x in db.execute("SELECT date FROM item_dates WHERE item_id = ?", (c["item_id"],))}
        for w in c["weekdays"]:
            bid = db.execute(
                "INSERT INTO timetable_blocks (timetable_id, title, weekday, start_time, end_time, place, memo, color)"
                " VALUES (?, ?, ?, ?, ?, '', ?, ?)",
                (tid, c["title"][:MAX_TITLE], w, c["start_time"], c["end_time"], c["memo"][:MAX_MEMO], c["category"]["color"]),
            ).lastrowid
            made += 1
            # 원래 일정의 기간 안에서 그 요일인데 일정이 없던 날 → 이날만 쉬기
            day = Date.fromisoformat(c["first"])
            last = Date.fromisoformat(c["last"])
            while day <= last:
                iso = day.isoformat()
                in_table = (not table["start_date"] or iso >= table["start_date"]) and (not table["end_date"] or iso <= table["end_date"])
                if weekday_of(day) == w and iso not in have and in_table:
                    db.execute("INSERT OR IGNORE INTO timetable_skips (timetable_id, block_id, date) VALUES (?, ?, ?)", (tid, bid, iso))
                day += timedelta(days=1)
        if data.get("delete_items"):
            db.execute("DELETE FROM items WHERE id = ?", (c["item_id"],))
    db.commit()
    return jsonify(timetable=one_timetable(db, tid), blocks=made, deleted=len(picked) if data.get("delete_items") else 0), 201


def next_class(db, now_date, hhmm):
    """홈 화면 위젯의 '다음 수업': 오늘 지금 이후 → 없으면 7일 안의 첫 수업"""
    for o in class_occurrences(db, now_date.isoformat(), (now_date + timedelta(days=8)).isoformat(), include_skipped=False):
        if o["date"] > now_date.isoformat() or o["end_time"] > hhmm:
            return o
    return None
