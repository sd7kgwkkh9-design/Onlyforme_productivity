"""
반복하는 일 (0.15.3) — 상단 '챙기기' → '🔁 반복'. api.py와 같은 /api 묶음(blueprint)에 붙는다.

  GET    /api/repeats?today=     목록 (+ 다음에 돌아오는 날짜)
  POST   /api/repeats            더하기 {title, emoji, freq, weekdays, interval, month_day, time, start, end, memo}
  PUT    /api/repeats/<id>       고치기 (보낸 칸만)
  DELETE /api/repeats/<id>       빼기
  달력에 보이는 날짜는 /api/calendar, /api/day의 repeats에 같이 실린다 (기념일처럼).

매주 월요일 분리수거, 격주 화요일 동아리, 매달 25일 월세, 매달 마지막 날 카드값처럼 '끝없이 돌아오는 일'을 적어 둔다.
일정의 '반복'(0.9.0)은 날짜를 하나하나 만들어 넣어서 1년까지만 되고 매달은 없다. 이건 날짜를 저장하지 않고
규칙(매주 어느 요일 / 매달 며칠)만 저장해 두었다가, 화면이 보는 기간의 날짜를 그때그때 계산한다 — 그래서 끝이 없어도 된다.

  freq      'weekly' | 'monthly'
  weekdays  매주: 요일 번호 '1,3' (0 = 일요일 … 6 = 토요일)
  interval  매주: 1 = 매주, 2 = 격주 (시작 날짜가 있는 주부터 센다)
  month_day 매달: 1~31 (그달에 없으면 그달 마지막 날, 31일 → 11월은 30일), 0 = 매달 마지막 날
  time      'HH:MM' 또는 없음
  start/end 시작 날짜, 끝 날짜(없으면 계속)
"""

from calendar import monthrange
from datetime import date as Date
from datetime import timedelta

from flask import jsonify

from api import ApiError, bp, json_body, parse_date, parse_time
from api_plans import check_emoji, kst_today, text_field
from api_tools import today_arg
from db import get_db

MAX_REPEATS = 50
MAX_TITLE = 40
MAX_MEMO = 200
WEEKDAY_NAMES = "일월화수목금토"


# ---------------------------------------------------------------- 날짜 계산
def month_date(year, month, month_day):
    """그달의 month_day일. 그달에 없는 날(31일 등)이면 마지막 날, 0이면 마지막 날"""
    last = monthrange(year, month)[1]
    return Date(year, month, last if month_day == 0 else min(month_day, last))


def weekdays_of(row):
    return [int(x) for x in row["weekdays"].split(",") if x != ""]


def dates_between(row, start, end):
    """[start, end) 안에서 이 규칙에 맞는 날짜들 (Date)"""
    first = max(start, Date.fromisoformat(row["start_date"]))
    last = end - timedelta(days=1)
    if row["end_date"]:
        last = min(last, Date.fromisoformat(row["end_date"]))
    if first > last:
        return []
    out = []
    if row["freq"] == "weekly":
        days = set(weekdays_of(row))
        begin = Date.fromisoformat(row["start_date"])
        week0 = begin - timedelta(days=(begin.weekday() + 1) % 7)   # 시작 날짜가 있는 주의 일요일
        d = first
        while d <= last:
            if (d.weekday() + 1) % 7 in days and ((d - week0).days // 7) % row["interval"] == 0:
                out.append(d)
            d += timedelta(days=1)
    else:
        y, m = first.year, first.month
        while (y, m) <= (last.year, last.month):
            d = month_date(y, m, row["month_day"])
            if first <= d <= last:
                out.append(d)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def rule_label(row):
    """'매주 월·수', '격주 화', '매달 25일', '매달 마지막 날'"""
    if row["freq"] == "weekly":
        names = "·".join(WEEKDAY_NAMES[w] for w in sorted(weekdays_of(row)))
        return f"{'격주' if row['interval'] == 2 else '매주'} {names}"
    return "매달 마지막 날" if row["month_day"] == 0 else f"매달 {row['month_day']}일"


def repeat_dict(row, today):
    nxt = dates_between(row, today, today + timedelta(days=400))
    return {
        "id": row["id"], "title": row["title"], "emoji": row["emoji"], "freq": row["freq"],
        "weekdays": weekdays_of(row), "interval": row["interval"], "month_day": row["month_day"],
        "time": row["time"], "start": row["start_date"], "end": row["end_date"], "memo": row["memo"],
        "label": rule_label(row),
        "next": nxt[0].isoformat() if nxt else None,
    }


def repeat_occurrences(db, start, end):
    """달력·하루 화면용: [start, end) 안의 날짜마다 한 줄씩 (시간 순 → 없으면 맨 앞)"""
    start_d, end_d = Date.fromisoformat(start), Date.fromisoformat(end)
    out = []
    for row in db.execute("SELECT * FROM repeats ORDER BY position, id"):
        for d in dates_between(row, start_d, end_d):
            out.append({"id": row["id"], "date": d.isoformat(), "title": row["title"], "emoji": row["emoji"],
                        "time": row["time"], "label": rule_label(row), "memo": row["memo"]})
    out.sort(key=lambda o: (o["date"], o["time"] or ""))
    return out


# ---------------------------------------------------------------- 받은 값 검사
def repeat_payload(data, existing=None):
    """보낸 칸만 검사해서 {DB 칸: 값}. 새로 만들 때(existing=None)는 빠진 칸에 기본값"""
    cur = dict(existing) if existing else {
        "title": None, "emoji": "🔁", "freq": "weekly", "weekdays": "", "interval": 1, "month_day": 1,
        "time": None, "start_date": kst_today().isoformat(), "end_date": None, "memo": "",
    }
    f = {}
    if "title" in data or existing is None:
        f["title"] = text_field(data, "title", "이름", MAX_TITLE, required=True)
    if "emoji" in data:
        f["emoji"] = check_emoji(data.get("emoji"), "반복", default="🔁")
    if "freq" in data:
        if data["freq"] not in ("weekly", "monthly"):
            raise ApiError("매주 또는 매달 중에서 골라 주세요.")
        f["freq"] = data["freq"]
    if "weekdays" in data:
        days = data["weekdays"]
        if not isinstance(days, list) or any(not isinstance(x, int) or isinstance(x, bool) or not 0 <= x <= 6 for x in days):
            raise ApiError("요일이 올바르지 않아요.")
        f["weekdays"] = ",".join(str(x) for x in sorted(set(days)))
    if "interval" in data:
        if data["interval"] not in (1, 2):
            raise ApiError("매주(1) 또는 격주(2)만 돼요.")
        f["interval"] = data["interval"]
    if "month_day" in data:
        md = data["month_day"]
        if not isinstance(md, int) or isinstance(md, bool) or not 0 <= md <= 31:
            raise ApiError("매달 며칠인지 1~31 사이로 골라 주세요. (0 = 마지막 날)")
        f["month_day"] = md
    if "time" in data:
        f["time"] = parse_time(data.get("time"), "시간")
    if "start" in data:
        f["start_date"] = parse_date(data.get("start"), "시작 날짜")
    if "end" in data:
        f["end_date"] = parse_date(data["end"], "끝 날짜") if data.get("end") else None
    if "memo" in data:
        f["memo"] = text_field(data, "memo", "메모", MAX_MEMO)

    merged = {**cur, **f}
    if merged["freq"] == "weekly" and not merged["weekdays"]:
        raise ApiError("반복할 요일을 하나 이상 골라 주세요.")
    if merged["end_date"] and merged["end_date"] < merged["start_date"]:
        raise ApiError("끝 날짜가 시작 날짜보다 빨라요.")
    if existing is None:
        return merged
    return f


def get_repeat_or_404(db, repeat_id):
    row = db.execute("SELECT * FROM repeats WHERE id = ?", (repeat_id,)).fetchone()
    if row is None:
        raise ApiError("없는 반복이에요.", 404)
    return row


# ---------------------------------------------------------------- API
@bp.get("/repeats")
def list_repeats():
    today = today_arg()
    rows = get_db().execute("SELECT * FROM repeats ORDER BY position, id").fetchall()
    return jsonify([repeat_dict(r, today) for r in rows])


@bp.post("/repeats")
def create_repeat():
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM repeats").fetchone()[0] >= MAX_REPEATS:
        raise ApiError(f"반복은 {MAX_REPEATS}개까지 넣을 수 있어요.")
    f = repeat_payload(json_body())
    cur = db.execute(
        "INSERT INTO repeats (title, emoji, freq, weekdays, interval, month_day, time, start_date, end_date, memo, position) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM repeats))",
        (f["title"], f["emoji"], f["freq"], f["weekdays"], f["interval"], f["month_day"], f["time"], f["start_date"], f["end_date"], f["memo"]),
    )
    db.commit()
    return jsonify(repeat_dict(get_repeat_or_404(db, cur.lastrowid), today_arg())), 201


@bp.put("/repeats/<int:repeat_id>")
def update_repeat(repeat_id):
    db = get_db()
    row = get_repeat_or_404(db, repeat_id)
    fields = repeat_payload(json_body(), existing=row)
    if fields:
        db.execute(f"UPDATE repeats SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", (*fields.values(), repeat_id))
        db.commit()
    return jsonify(repeat_dict(get_repeat_or_404(db, repeat_id), today_arg()))


@bp.delete("/repeats/<int:repeat_id>")
def delete_repeat(repeat_id):
    db = get_db()
    get_repeat_or_404(db, repeat_id)
    db.execute("DELETE FROM repeats WHERE id = ?", (repeat_id,))
    db.commit()
    return jsonify(deleted=repeat_id)
