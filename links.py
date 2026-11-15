"""
밖에서 여는 주소 (0.12.0)

비밀번호 없이 열 수 있는 주소 세 가지. 주소 안의 무작위 토큰(열쇠)이 곧 허락이고, 지우면 그 주소는 바로 막힌다.

  share   보기 전용 공유 링크   /v/<토큰>          가족·친구가 내 일정을 볼 수 있는 읽기 전용 달력 (고치기 불가)
  ics     캘린더 구독          /ical/<토큰>.ics   아이폰·맥 기본 캘린더, 구글 캘린더에서 '구독'해 두면 알아서 새로 받아 간다
                                                  → 아이폰 기본 캘린더 위젯·잠금 화면·시리에도 일정이 보인다
  widget  홈 화면 위젯         /w/<토큰>.json     아이폰 앱 Scriptable의 위젯 스크립트가 읽어 가는 오늘 요약
                                                  (오늘 일정, 다음 일정, D-day, 올해 목표 진행도)

- 링크마다 보여 줄 카테고리를 고를 수 있다 (예: '수업'과 '약속'만 가족에게).
- 메모는 기본으로 숨긴다. 공유 링크에서 '메모도 보여 주기'를 켜야 보인다.
- 루틴 기록, 기록지(메모·목표·할 일)는 공유 링크·구독에 나가지 않는다. 위젯에만 올해 목표 진행도가 나간다(나만 보는 화면이라서).
- 토큰은 secrets.token_urlsafe(24) — 32글자, 경우의 수 2^192라서 맞혀서 들어오는 것은 사실상 불가능하다.

관리 API (로그인 필요)
  GET    /api/links                   내 링크 목록 (주소 포함)
  POST   /api/links                   새 링크 {kind, label, options}
  PUT    /api/links/<id>              이름·옵션 바꾸기 (주소는 그대로)
  DELETE /api/links/<id>              링크 끊기 (그 주소는 바로 막힌다)
  GET    /api/links/<id>/script       위젯 링크의 Scriptable 스크립트 (주소가 채워진 채로)
"""

import json
import os
import secrets
from datetime import date as Date, datetime, time as Time, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Blueprint, Response, abort, current_app, jsonify, render_template, request

from api import ApiError, bp as api_bp, json_body, korean_holidays, holidays_lib, occurrence_list, parse_range
from api_tools import overview_data
from db import get_db

public = Blueprint("public", __name__)

KST = ZoneInfo("Asia/Seoul")
KINDS = ("share", "ics", "widget")
KIND_NAME = {"share": "공유 링크", "ics": "캘린더 구독", "widget": "홈 화면 위젯"}
MAX_LINKS = 30
MAX_LABEL = 30
ALARMS = (None, 0, 10, 30, 60, 1440)        # 구독 캘린더의 알림: 없음 / 정각 / 10분·30분·1시간 전 / 하루 전
ICS_PAST_DAYS = 60                          # 구독 캘린더에 넣는 기간: 두 달 전 ~ 1년 뒤
ICS_FUTURE_DAYS = 366
TOUCH_EVERY = timedelta(minutes=10)         # '마지막으로 열린 때'는 10분에 한 번만 적는다 (구독 캘린더가 자주 물어봐서)


# ======================================================================== 공통
def now_kst():
    return datetime.now(KST)


def today_kst():
    return now_kst().date()


def link_options(kind, data, db, old=None):
    """옵션 검사. 보낸 것만 바꾸고 나머지는 old 그대로."""
    opts = dict(old or {})
    if "categories" in data or old is None:
        cats = data.get("categories")
        if cats in (None, "all", []):
            opts["categories"] = None                 # 모든 카테고리
        else:
            if not isinstance(cats, list) or not all(isinstance(c, int) for c in cats):
                raise ApiError("카테고리는 번호 목록이어야 해요.")
            known = {r["id"] for r in db.execute("SELECT id FROM categories")}
            if not set(cats) <= known:
                raise ApiError("없는 카테고리가 들어 있어요.")
            opts["categories"] = sorted(set(cats))
    if kind == "share" and ("memo" in data or old is None):
        opts["memo"] = bool(data.get("memo", False))
    if kind == "ics":
        if "alarm" in data or old is None:
            alarm = data.get("alarm", None)
            if alarm not in ALARMS:
                raise ApiError("알림은 없음, 정각, 10분·30분·1시간·하루 전 중에서 골라 주세요.")
            opts["alarm"] = alarm
        if "goals" in data or old is None:
            opts["goals"] = bool(data.get("goals", True))
    return opts


def link_dict(row):
    base = request.host_url.rstrip("/")
    token = row["token"]
    urls = {
        "share": {"url": f"{base}/v/{token}"},
        "ics": {"url": f"{base}/ical/{token}.ics", "webcal": f"webcal://{request.host}/ical/{token}.ics"},
        "widget": {"url": f"{base}/w/{token}.json"},
    }[row["kind"]]
    return {
        "id": row["id"],
        "kind": row["kind"],
        "label": row["label"],
        "options": json.loads(row["options"] or "{}"),
        "created_at": row["created_at"],
        "last_used_at": row["last_used_at"],
        **urls,
    }


def get_link_or_404(db, link_id):
    row = db.execute("SELECT * FROM links WHERE id = ?", (link_id,)).fetchone()
    if row is None:
        raise ApiError("링크를 찾을 수 없어요.", 404)
    return row


# ======================================================================== 관리 API (로그인 필요 — /api 아래라서 auth.py가 지킨다)
@api_bp.get("/links")
def list_links():
    rows = get_db().execute("SELECT * FROM links ORDER BY kind, id DESC")
    return jsonify([link_dict(r) for r in rows])


@api_bp.post("/links")
def create_link():
    db = get_db()
    data = json_body()
    kind = data.get("kind")
    if kind not in KINDS:
        raise ApiError("링크 종류는 share, ics, widget 중 하나예요.")
    if db.execute("SELECT COUNT(*) AS n FROM links").fetchone()["n"] >= MAX_LINKS:
        raise ApiError(f"링크는 {MAX_LINKS}개까지 만들 수 있어요. 안 쓰는 링크를 끊어 주세요.")
    label = str(data.get("label") or "").strip()[:MAX_LABEL] or KIND_NAME[kind]
    opts = link_options(kind, data.get("options") or {}, db)
    cur = db.execute(
        "INSERT INTO links (kind, token, label, options) VALUES (?, ?, ?, ?)",
        (kind, secrets.token_urlsafe(24), label, json.dumps(opts, ensure_ascii=False)),
    )
    db.commit()
    return jsonify(link_dict(get_link_or_404(db, cur.lastrowid))), 201


@api_bp.put("/links/<int:link_id>")
def update_link(link_id):
    db = get_db()
    row = get_link_or_404(db, link_id)
    data = json_body()
    label = row["label"]
    if "label" in data:
        label = str(data.get("label") or "").strip()[:MAX_LABEL] or KIND_NAME[row["kind"]]
    opts = link_options(row["kind"], data.get("options") or {}, db, old=json.loads(row["options"] or "{}"))
    db.execute("UPDATE links SET label = ?, options = ? WHERE id = ?", (label, json.dumps(opts, ensure_ascii=False), link_id))
    db.commit()
    return jsonify(link_dict(get_link_or_404(db, link_id)))


@api_bp.delete("/links/<int:link_id>")
def delete_link(link_id):
    db = get_db()
    get_link_or_404(db, link_id)
    db.execute("DELETE FROM links WHERE id = ?", (link_id,))
    db.commit()
    return jsonify(deleted=link_id)


SCRIPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "widget", "scriptable-widget.js")


@api_bp.get("/links/<int:link_id>/script")
def widget_script(link_id):
    """
    위젯 링크의 Scriptable 스크립트. 맨 위 설정 줄(DATA_URL, APP_URL, ACCENT)만 채워서 돌려준다.
    ?accent=#2347C8 : 화면에서 고른 색 테마의 포인트 색 (위젯도 같은 색으로)
    """
    db = get_db()
    row = get_link_or_404(db, link_id)
    if row["kind"] != "widget":
        raise ApiError("위젯 링크가 아니에요.")
    link = link_dict(row)
    accent = request.args.get("accent", "")
    if not (len(accent) == 7 and accent.startswith("#") and all(c in "0123456789abcdefABCDEF" for c in accent[1:])):
        accent = "#2347C8"
    with open(SCRIPT_PATH, encoding="utf-8") as f:
        code = f.read()
    code = (
        code.replace("__DATA_URL__", link["url"])
        .replace("__APP_URL__", request.host_url)
        .replace("__ACCENT__", accent)
    )
    res = Response(code, mimetype="text/javascript")
    res.headers["Content-Disposition"] = "attachment; filename=onlyforme-widget.js"
    return res


# ======================================================================== 공개 주소 (토큰이 열쇠)
def find_link(kind, token):
    """토큰으로 링크 찾기. 없으면 404. 열린 때를 가끔 적어 둔다."""
    db = get_db()
    row = db.execute("SELECT * FROM links WHERE token = ? AND kind = ?", (token, kind)).fetchone()
    if row is None:
        abort(404)
    stamp = now_kst().replace(tzinfo=None)
    last = row["last_used_at"]
    if not last or stamp - datetime.fromisoformat(last) > TOUCH_EVERY:
        db.execute("UPDATE links SET last_used_at = ? WHERE id = ?", (stamp.isoformat(" ", "seconds"), row["id"]))
        db.commit()
    return row, json.loads(row["options"] or "{}")


def visible_items(db, opts, start, end):
    """링크 옵션(카테고리)에 맞는 일정만"""
    items = occurrence_list(db, start, end)
    cats = opts.get("categories")
    if cats is not None:
        items = [o for o in items if o["category"]["id"] in cats]
    return items


def private_headers(res):
    """공유 화면은 검색 엔진에 안 걸리게, 다른 사이트로 주소가 새지 않게"""
    res.headers["X-Robots-Tag"] = "noindex, nofollow"
    res.headers["Referrer-Policy"] = "no-referrer"
    res.headers["Cache-Control"] = "no-store"
    return res


@public.app_errorhandler(404)
def not_found(err):
    if request.path.startswith(("/v/", "/w/", "/ical/")):
        if request.path.startswith("/v/") and not request.path.endswith("/events"):
            return private_headers(Response(render_template("shared_gone.html"), status=404))
        return private_headers(jsonify(error="링크가 없거나 끊겼어요.")), 404
    return err


# ---------------------------------------------------------------- 보기 전용 공유 링크
@public.get("/v/<token>")
def shared_page(token):
    row, opts = find_link("share", token)
    return private_headers(Response(render_template("shared.html", label=row["label"], token=token)))


@public.get("/v/<token>/events")
def shared_events(token):
    """공유 화면의 달력이 부른다: 기간의 일정(옵션에 맞게) + 공휴일. 메모는 옵션을 켰을 때만."""
    row, opts = find_link("share", token)
    try:
        start, end = parse_range()
    except ApiError as e:
        return private_headers(jsonify(error=e.message)), 400
    items = []
    for o in visible_items(get_db(), opts, start, end):
        items.append({
            "date": o["date"],
            "title": o["title"],
            "memo": o["memo"] if opts.get("memo") else "",
            "start_time": o["start_time"],
            "end_time": o["end_time"],
            "category": {"name": o["category"]["name"], "color": o["category"]["color"]},
            "dday": o["dday"],
        })
    holidays = []
    if holidays_lib is not None:
        for year in range(int(start[:4]), int(end[:4]) + 1):
            holidays += [{"date": d, "name": n} for d, n in korean_holidays(year).items() if start <= d < end]
    return private_headers(jsonify(items=items, holidays=holidays))


# ---------------------------------------------------------------- 캘린더 구독 (.ics)
@public.get("/ical/<token>.ics")
def ical_feed(token):
    from icalendar import Alarm, Calendar, Event

    row, opts = find_link("ics", token)
    db = get_db()
    today = today_kst()
    start = (today - timedelta(days=ICS_PAST_DAYS)).isoformat()
    end = (today + timedelta(days=ICS_FUTURE_DAYS)).isoformat()
    host = request.host.split(":")[0]
    stamp = datetime.now(timezone.utc)

    cal = Calendar()
    cal.add("prodid", f"-//{current_app.config.get('APP_NAME', 'Onlyforme')}//0.12//KO")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", row["label"])
    cal.add("x-wr-timezone", "Asia/Seoul")
    # 구독한 앱에게 '1시간마다 새로 받아 가세요'라고 알려 준다 (실제 간격은 앱이 정한다)
    cal.add("refresh-interval", timedelta(hours=1), parameters={"VALUE": "DURATION"})
    cal.add("x-published-ttl", "PT1H")

    alarm = opts.get("alarm")
    for o in visible_items(db, opts, start, end):
        ev = Event()
        ev.add("uid", f"item-{o['id']}-{o['date']}@{host}")
        ev.add("dtstamp", stamp)
        ev.add("summary", ("⭐ " if o["dday"] else "") + o["title"])
        day = Date.fromisoformat(o["date"])
        st, et = o["start_time"], o["end_time"]
        if st:
            begin = datetime.combine(day, Time.fromisoformat(st), KST)
            ev.add("dtstart", begin)
            if et and et > st:
                ev.add("dtend", datetime.combine(day, Time.fromisoformat(et), KST))
            else:
                ev.add("dtend", begin + timedelta(hours=1))   # 끝 시간이 없으면 1시간짜리로 보이게
        else:
            ev.add("dtstart", day)                             # 시간 없는 일정 = 하루 종일
            ev.add("dtend", day + timedelta(days=1))
            ev.add("transp", "TRANSPARENT")                    # 하루 종일 일정은 '바쁨'으로 잡지 않는다
        notes = []
        if et and not st:
            notes.append(f"~{et}까지")
        if o["memo"]:
            notes.append(o["memo"])
        if notes:
            ev.add("description", "\n".join(notes))
        ev.add("categories", [o["category"]["name"]])
        if alarm is not None and st:
            al = Alarm()
            al.add("action", "DISPLAY")
            al.add("description", o["title"])
            al.add("trigger", timedelta(minutes=-alarm))
            ev.add_component(al)
        cal.add_component(ev)

    if opts.get("goals", True):
        # 기한이 있는 목표(아직 못 이룬 것)를 그날의 하루 종일 일정으로
        for g in db.execute("SELECT id, title, due FROM goals WHERE kind = 'due' AND done_at IS NULL AND due >= ?", (today.isoformat(),)):
            ev = Event()
            ev.add("uid", f"goal-{g['id']}@{host}")
            ev.add("dtstamp", stamp)
            ev.add("summary", f"🎯 {g['title']} (목표 기한)")
            day = Date.fromisoformat(g["due"])
            ev.add("dtstart", day)
            ev.add("dtend", day + timedelta(days=1))
            ev.add("transp", "TRANSPARENT")
            cal.add_component(ev)

    cal.add_missing_timezones()
    res = Response(cal.to_ical(), mimetype="text/calendar")
    res.headers["Content-Disposition"] = f'inline; filename="onlyforme.ics"'
    res.headers["Cache-Control"] = "no-cache"
    res.headers["X-Robots-Tag"] = "noindex, nofollow"
    return res


# ---------------------------------------------------------------- 홈 화면 위젯
WEEKDAYS = "월화수목금토일"


def widget_item(o):
    return {
        "title": o["title"],
        "start": o["start_time"],
        "end": o["end_time"],
        "color": o["category"]["color"],
        "category": o["category"]["name"],
    }


@public.get("/w/<token>.json")
def widget_data(token):
    """
    Scriptable 위젯이 읽어 가는 오늘 요약. 위젯 크기마다 필요한 만큼만 골라 쓴다.
      today    : 오늘 일정 전부 (하루 순서대로)
      next     : 지금 이후 가장 먼저 시작하는 일정 (오늘 안에서, 없으면 내일 첫 일정)
      tomorrow : 내일 일정 (앞의 몇 개)
      ddays    : 다가오는 D-day (일정·목표)
      year     : 올해 진행률 + 아직 못 이룬 올해 목표 (진행도 포함)
      life     : 오늘의 인생 목표 (날마다 하나씩 돌아가며)
      todos    : 아직 안 한 할 일 수
    """
    row, opts = find_link("widget", token)
    db = get_db()
    now = now_kst()
    today = now.date()
    tomorrow = today + timedelta(days=1)
    items = visible_items(db, opts, today.isoformat(), (tomorrow + timedelta(days=1)).isoformat())
    today_items = [o for o in items if o["date"] == today.isoformat()]
    tomorrow_items = [o for o in items if o["date"] == tomorrow.isoformat()]

    hhmm = now.strftime("%H:%M")
    upcoming = sorted((o for o in today_items if o["start_time"] and o["start_time"] >= hhmm), key=lambda o: o["start_time"])
    nxt, nxt_day = (upcoming[0], "today") if upcoming else (None, None)
    if nxt is None:
        timed = sorted((o for o in tomorrow_items if o["start_time"]), key=lambda o: o["start_time"])
        if timed:
            nxt, nxt_day = timed[0], "tomorrow"

    ov = overview_data(db, today)
    life = ov["life"]
    day_of_year = today.timetuple().tm_yday
    todos = db.execute(
        "SELECT COUNT(*) AS n FROM items i WHERE i.done_at IS NULL AND NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = i.id)"
    ).fetchone()["n"]

    data = {
        "app": current_app.config.get("APP_NAME", ""),
        "label": row["label"],
        "date": today.isoformat(),
        "weekday": WEEKDAYS[today.weekday()],
        "updated": hhmm,
        "today": [widget_item(o) for o in today_items],
        "next": {**widget_item(nxt), "day": nxt_day} if nxt else None,
        "tomorrow": [widget_item(o) for o in tomorrow_items[:4]],
        "ddays": [{"title": d["title"], "days_left": d["days_left"], "kind": d["kind"], "color": d["color"]} for d in ov["ddays"][:3]],
        "year": {
            "year": ov["year"]["year"],
            "percent": ov["year"]["percent"],
            "days_left": ov["year"]["days_left"],
            "goals": [
                {
                    "title": g["title"],
                    "measure": g["measure"],
                    "current": g["current"],
                    "target": g["target"],
                    "emoji": (g["routine"] or {}).get("emoji"),
                }
                for g in ov["year"]["goals"][:3]
            ],
        },
        "life": life[day_of_year % len(life)]["title"] if life else None,
        "todos": todos,
    }
    res = jsonify(data)
    res.headers["Cache-Control"] = "no-store"
    res.headers["X-Robots-Tag"] = "noindex, nofollow"
    return res
