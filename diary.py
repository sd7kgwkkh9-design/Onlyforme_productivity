"""
일기 (0.14.0) — 날짜마다 하나, 쓰고 싶은 날만. api.py와 같은 /api 묶음(blueprint)에 붙는다.

꾸준히 쓰는 일기가 아니라 '가끔 쓰고 싶은 날'을 위한 칸이라서, 알림·연속 기록·'안 썼어요' 같은 건 일부러 없다.
쓰는 곳은 하루 화면 아래, 모아 보기는 상단의 📔 버튼. 월간·주간 달력에는 쓴 날에 작은 표시만 보인다.
일기는 가장 사적인 기록이라 공유 링크·캘린더 구독·홈 화면 위젯에는 절대 나가지 않는다 (links.py는 이 표를 읽지 않는다).

  GET    /api/diaries?before=&limit=     모아 보기: 최신순 미리보기 {date, mood, preview, chars, updated_at} + 모두 몇 편
  GET    /api/diaries/<date>             그날 일기 (없으면 body가 빈 칸)
  PUT    /api/diaries/<date>             쓰기·고치기 {body, mood} — 보낸 칸만. 둘 다 비면 지운다 (쓰는 대로 자동 저장)
  DELETE /api/diaries/<date>             지우기
  달력에 보이는 표시는 /api/calendar의 diaries([{date, mood}]), 하루 화면은 /api/day의 diary에 같이 실린다.
"""

from flask import jsonify, request

from api import ApiError, bp, json_body, parse_date
from api_plans import check_emoji
from db import get_db

MAX_DIARY_LEN = 20000
PREVIEW_LEN = 140
MAX_LIST = 100


def diary_dict(row):
    return {"date": row["date"], "body": row["body"], "mood": row["mood"], "updated_at": row["updated_at"]}


def preview_of(body):
    text = " ".join(body.split())
    return text if len(text) <= PREVIEW_LEN else text[:PREVIEW_LEN].rstrip() + "…"


def diary_days(db, start, end):
    """[start, end) 기간에 일기를 쓴 날 (달력의 작은 표시용 — 내용은 싣지 않는다)"""
    rows = db.execute("SELECT date, mood FROM diaries WHERE date >= ? AND date < ? ORDER BY date", (start, end))
    return [{"date": r["date"], "mood": r["mood"]} for r in rows]


def diary_on(db, day):
    row = db.execute("SELECT * FROM diaries WHERE date = ?", (day,)).fetchone()
    return diary_dict(row) if row else None


@bp.get("/diaries")
def list_diaries():
    db = get_db()
    before = request.args.get("before")
    before = parse_date(before) if before else "9999-12-31"
    try:
        limit = max(1, min(MAX_LIST, int(request.args.get("limit", 40))))
    except ValueError:
        raise ApiError("limit은 숫자로 적어 주세요.") from None
    rows = db.execute("SELECT * FROM diaries WHERE date < ? ORDER BY date DESC LIMIT ?", (before, limit + 1)).fetchall()
    more = len(rows) > limit
    total = db.execute("SELECT COUNT(*) AS n FROM diaries").fetchone()["n"]
    return jsonify(
        total=total,
        more=more,
        entries=[
            {"date": r["date"], "mood": r["mood"], "preview": preview_of(r["body"]), "chars": len(r["body"]), "updated_at": r["updated_at"]}
            for r in rows[:limit]
        ],
    )


@bp.get("/diaries/<day>")
def get_diary(day):
    day = parse_date(day)
    return jsonify(diary_on(get_db(), day) or {"date": day, "body": "", "mood": "", "updated_at": None})


@bp.put("/diaries/<day>")
def put_diary(day):
    db = get_db()
    day = parse_date(day)
    data = json_body()
    old = diary_on(db, day) or {"body": "", "mood": ""}
    body = old["body"]
    mood = old["mood"]
    if "body" in data:
        body = str(data.get("body") or "")
        if len(body) > MAX_DIARY_LEN:
            raise ApiError(f"일기는 {MAX_DIARY_LEN:,}자까지 쓸 수 있어요.")
        if not body.strip():
            body = ""
    if "mood" in data:
        mood = check_emoji(data["mood"], "기분") if data.get("mood") else ""   # 기분 이모지는 고르지 않아도 된다
    if not body and not mood:
        db.execute("DELETE FROM diaries WHERE date = ?", (day,))
        db.commit()
        return jsonify(date=day, body="", mood="", updated_at=None)
    db.execute(
        "INSERT INTO diaries (date, body, mood) VALUES (?, ?, ?) "
        "ON CONFLICT(date) DO UPDATE SET body = excluded.body, mood = excluded.mood, updated_at = datetime('now', 'localtime')",
        (day, body, mood),
    )
    db.commit()
    return jsonify(diary_on(db, day))


@bp.delete("/diaries/<day>")
def delete_diary(day):
    db = get_db()
    day = parse_date(day)
    db.execute("DELETE FROM diaries WHERE date = ?", (day,))
    db.commit()
    return "", 204
