"""
검색 (0.14.0) — 상단의 🔍(단축키 /). api.py와 같은 /api 묶음(blueprint)에 붙는다.

  GET /api/search?q=&today=   일정·할 일·노트·목표·프로젝트·일기·루틴 기록 메모·시간표 칸·나·살 것(0.14.2)·기념일에서 찾는다.

- 띄어 쓴 낱말은 모두 들어 있어야 찾는다 (AND). 대소문자는 가리지 않는다.
- 종류마다 묶어서 돌려준다. 일정은 다가오는 날짜 먼저(가까운 순), 그다음 지난 날짜(최근 순).
  반복 일정은 하나로 묶고, 오늘 이후 가장 가까운 날짜(없으면 마지막 날짜)를 대표로 보여 준다.
- 본문이 긴 것(노트·일기·메모)은 찾은 낱말 근처만 잘라서 snippet으로 준다. 화면이 낱말을 표시한다.
"""

import re

from flask import jsonify, request

from api import ApiError, bp
from api_plans import kst_today
from api_tools import today_arg
from db import get_db

MAX_QUERY = 60
PER_KIND = 20
SNIPPET = 70


def like_terms(q):
    terms = [t for t in q.split() if t][:6]
    escaped = [t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") for t in terms]
    return terms, [f"%{t}%" for t in escaped]


def where(columns, patterns):
    """낱말마다 '어느 칸에든 들어 있다'를 AND로 묶는다"""
    one = "(" + " OR ".join(f"{c} LIKE ? ESCAPE '\\'" for c in columns) + ")"
    sql = " AND ".join([one] * len(patterns))
    args = [p for p in patterns for _ in columns]
    return sql, args


MD_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
MD_MARKS = re.compile(r"\[[ xX]\]|~~|[*`#>]+|^\s*[-+]\s+", re.MULTILINE)   # ~ 하나(1~3장)·_는 글에서도 쓰니 그대로 둔다


def plain(text):
    """노트의 마크다운 기호(**, - [ ], # …, [글](주소))는 빼고 글자만"""
    return MD_MARKS.sub("", MD_LINK.sub(r"\1", text or ""))


def snippet(text, terms):
    """긴 글에서 처음 찾은 낱말 근처만 (앞뒤 '…')"""
    flat = " ".join((text or "").split())
    if not flat:
        return ""
    low = flat.lower()
    hits = [low.find(t.lower()) for t in terms if low.find(t.lower()) >= 0]
    at = min(hits) if hits else 0
    start = max(0, at - SNIPPET // 3)
    end = min(len(flat), start + SNIPPET)
    return ("…" if start else "") + flat[start:end] + ("…" if end < len(flat) else "")


@bp.get("/search")
def search():
    q = " ".join(request.args.get("q", "").split())
    if len(q) > MAX_QUERY:
        raise ApiError(f"검색어는 {MAX_QUERY}자까지 쓸 수 있어요.")
    if not q:
        return jsonify(q="", total=0, groups=[])
    today = (today_arg() if request.args.get("today") else kst_today()).isoformat()
    terms, pats = like_terms(q)
    db = get_db()
    groups = []

    def add(kind, label, results):
        if results:
            groups.append({"kind": kind, "label": label, "results": results[:PER_KIND], "more": max(0, len(results) - PER_KIND)})

    # ---- 일정 (날짜가 있는 것) + 할 일 (날짜가 없는 것)
    sql, args = where(["i.title", "i.memo"], pats)
    rows = db.execute(
        f"""
        SELECT i.id, i.title, i.memo, i.start_time, i.done_at, i.urgent, c.color AS color, c.name AS c_name,
               (SELECT MIN(d.date) FROM item_dates d WHERE d.item_id = i.id AND d.date >= ?) AS next_date,
               (SELECT MAX(d.date) FROM item_dates d WHERE d.item_id = i.id) AS last_date,
               (SELECT COUNT(*) FROM item_dates d WHERE d.item_id = i.id) AS date_count
        FROM items i JOIN categories c ON c.id = i.category_id
        WHERE {sql}
        """,
        [today, *args],
    ).fetchall()
    events, todos = [], []
    for r in rows:
        base = {"id": r["id"], "title": r["title"], "snippet": snippet(r["memo"], terms) if r["memo"] else "", "color": r["color"]}
        if r["date_count"]:
            date = r["next_date"] or r["last_date"]
            events.append({**base, "date": date, "upcoming": bool(r["next_date"]), "date_count": r["date_count"], "start_time": r["start_time"]})
        else:
            todos.append({**base, "done": bool(r["done_at"]), "urgent": bool(r["urgent"])})
    upcoming = sorted((e for e in events if e["upcoming"]), key=lambda e: e["date"])
    past = sorted((e for e in events if not e["upcoming"]), key=lambda e: e["date"], reverse=True)
    add("event", "일정", upcoming + past)
    add("todo", "할 일", sorted(todos, key=lambda t: (t["done"], not t["urgent"])))

    # ---- 일기 (최근 순)
    sql, args = where(["body"], pats)
    rows = db.execute(f"SELECT date, body, mood FROM diaries WHERE {sql} ORDER BY date DESC", args).fetchall()
    add("diary", "일기", [{"date": r["date"], "mood": r["mood"], "snippet": snippet(r["body"], terms)} for r in rows])

    # ---- 노트
    sql, args = where(["title", "body", "banner"], pats)
    rows = db.execute(f"SELECT id, title, body FROM notes WHERE {sql} ORDER BY updated_at DESC", args).fetchall()
    add("note", "노트", [{"id": r["id"], "title": r["title"] or snippet(plain(r["body"]), [])[:40], "snippet": snippet(plain(r["body"]), terms)} for r in rows])

    # ---- 목표
    sql, args = where(["title", "memo"], pats)
    rows = db.execute(f"SELECT id, title, memo, kind, year, due, done_at FROM goals WHERE {sql} ORDER BY done_at IS NOT NULL, id DESC", args).fetchall()
    kinds = {"life": "인생 목표", "year": "올해 목표", "due": "기한 목표"}
    add("goal", "목표", [{
        "id": r["id"], "title": r["title"], "snippet": snippet(r["memo"], terms) if r["memo"] else "",
        "sub": f"{r['year']} 목표" if r["kind"] == "year" else kinds.get(r["kind"], ""), "done": bool(r["done_at"]), "due": r["due"],
    } for r in rows])

    # ---- 프로젝트
    sql, args = where(["title", "memo", "period"], pats)
    rows = db.execute(f"SELECT id, title, memo, status, start_date, end_date, period FROM projects WHERE {sql} ORDER BY status = 'done', id DESC", args).fetchall()
    add("project", "프로젝트", [{
        "id": r["id"], "title": r["title"], "snippet": snippet(r["memo"], terms) if r["memo"] else "", "status": r["status"],
        "period": r["period"], "start_date": r["start_date"], "end_date": r["end_date"],
    } for r in rows])

    # ---- 시간표 칸 (강의실이 어디였지?)
    sql, args = where(["b.title", "b.place", "b.memo"], pats)
    rows = db.execute(
        f"""SELECT b.id, b.title, b.place, b.weekday, b.start_time, b.end_time, t.name AS t_name, COALESCE(NULLIF(b.color, ''), t.color) AS color
            FROM timetable_blocks b JOIN timetables t ON t.id = b.timetable_id WHERE {sql}
            ORDER BY b.weekday, b.start_time""",
        args,
    ).fetchall()
    add("class", "시간표", [dict(r) for r in rows])

    # ---- 루틴 기록 메모 ('5km' 같은 것)
    sql, args = where(["l.memo"], pats)
    rows = db.execute(
        f"""SELECT l.id, l.date, l.memo, r.name, r.emoji FROM routine_logs l JOIN routines r ON r.id = l.routine_id
            WHERE l.memo != '' AND {sql} ORDER BY l.date DESC""",
        args,
    ).fetchall()
    add("log", "루틴 기록", [{"id": r["id"], "date": r["date"], "title": f"{r['emoji']} {r['name']}", "snippet": snippet(r["memo"], terms)} for r in rows])

    # ---- 나 (0.14.2): 칸이 몇 개뿐이라 글로 풀어서 파이썬에서 찾는다 (JSON 속 "label" 같은 글자에 걸리지 않게)
    from about import about_text
    found = []
    for r in db.execute("SELECT * FROM about_sections ORDER BY position, id"):
        body = about_text(r)
        hay = f"{r['title']} {body}".lower()
        if all(t.lower() in hay for t in terms):
            found.append({"id": r["id"], "title": r["title"], "snippet": snippet(body, terms)})
    add("about", "나", found)

    # ---- 살 것 (0.14.2)
    sql, args = where(["title", "when_text", "url"], pats)
    rows = db.execute(f"SELECT id, title, price, when_text, starred FROM wishlist WHERE {sql} ORDER BY starred DESC, position", args).fetchall()
    add("wish", "살 것", [{"id": r["id"], "title": r["title"], "price": r["price"], "when": r["when_text"], "starred": bool(r["starred"])} for r in rows])

    # ---- 기념일
    sql, args = where(["title"], pats)
    rows = db.execute(f"SELECT id, title, emoji, kind FROM anniversaries WHERE {sql} ORDER BY id", args).fetchall()
    add("anniv", "기념일", [{"id": r["id"], "title": f"{r['emoji']} {r['title']}"} for r in rows])

    return jsonify(q=q, terms=terms, total=sum(len(g["results"]) + g["more"] for g in groups), groups=groups)
