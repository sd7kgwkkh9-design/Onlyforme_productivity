"""
0.13.0 생활 도구 API — 습관, 프로젝트, 기념일. api.py와 같은 /api 묶음(blueprint)에 붙는다.
(시간표는 timetable.py, 급한 할 일은 api.py의 /api/items/<id>/urgent)

습관 (하루에 몇 번 하는 생활 습관. 루틴과 달리 시간·메모 없이 '횟수'만 센다)
  GET    /api/habits?today=               습관 목록 + 오늘 한 횟수 + 연속 기록(🔥) + 최근 7일
  POST   /api/habits                      추가 {name, emoji, target}
  PUT    /api/habits/<id>                 수정 (보낸 칸만)
  DELETE /api/habits/<id>                 삭제 (기록도 함께)
  PUT    /api/habits/order                순서 {ids: [...]}
  POST   /api/habits/<id>/step            {date, delta: 1 | -1} 그날 횟수 +1 / −1

프로젝트 (몇 월까지 진행하는 일. 세부 할 일과 일정은 items.project_id로 잇는다)
  GET    /api/projects?today=             목록 + 진행률(세부 할 일 체크 수) + 다음 일정
  GET    /api/projects/<id>?today=        하나: 세부 할 일 + 연결한 일정(다가오는 것 먼저)
  POST   /api/projects                    추가 {title, when | start_date, end_date, period, memo, color, status}
                                           when: '~12/6', '1월 중', '겨울방학' 같은 글 → 서버가 기간을 읽는다 (periods.py)
  PUT    /api/projects/<id>               수정 (보낸 칸만)
  DELETE /api/projects/<id>?tasks=keep|delete   세부 할 일은 기본으로 남기고(일반 할 일로) 연결만 푼다
  PUT    /api/projects/order              순서 {ids: [...]}

기념일 (생일·기념일은 매년, 음력 가능 / 날짜 세기는 100일마다 + 해마다)
  GET    /api/anniversaries?today=        목록 + 다음에 오는 날 + (날짜 세기) 오늘이 며칠째인지
  POST   /api/anniversaries               추가 {title, emoji, kind, date, lunar, leap, from_one, dday_days}
                                            dday_days: 며칠 전부터 첫 화면 띠에 D-day로 (0 = 안 띄움, 7·14·30·60·100. 0.14.2)
                                            예전처럼 dday(true/false)만 보내면 true → 30, false → 0
  PUT    /api/anniversaries/<id>          수정 (보낸 칸만)
  DELETE /api/anniversaries/<id>          삭제
  달력에 보이는 날짜는 /api/calendar, /api/day의 annivs에 같이 실린다.
"""

import re
import unicodedata
from datetime import date as Date
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from flask import jsonify, request

import periods
from api import COLOR_RE, ApiError, bp, item_dict, json_body, parse_date
from api_tools import MAX_EMOJI_LEN, id_list, today_arg
from db import get_db

# 음력 ↔ 양력 (오픈소스 korean_lunar_calendar, MIT). 없어도 나머지는 돈다 (음력 기념일만 안 보임).
try:
    from korean_lunar_calendar import KoreanLunarCalendar
except ImportError:  # pip install -r requirements.txt
    KoreanLunarCalendar = None

KST = ZoneInfo("Asia/Seoul")


def kst_today():
    """요청에 '오늘'이 없을 때 쓰는 한국 날짜 (인터넷 서버의 시계는 한국이 아닐 수 있다)"""
    return datetime.now(KST).date()


def check_emoji(value, label, default=None):
    emoji = str(value or "").strip() or default
    if not emoji:
        raise ApiError(f"{label} 이모지를 골라 주세요.")
    if len(emoji) > MAX_EMOJI_LEN or any(ch.isspace() or unicodedata.category(ch).startswith("L") for ch in emoji):
        raise ApiError("이모지는 하나만 골라 주세요.")
    return emoji


def text_field(data, key, label, max_len, required=False, default=""):
    value = str(data.get(key) if data.get(key) is not None else default).strip()
    if required and not value:
        raise ApiError(f"{label}을(를) 입력해 주세요.")
    if len(value) > max_len:
        raise ApiError(f"{label}은(는) {max_len}자 이하로 적어 주세요.")
    return value


# ======================================================================== 습관
MAX_HABITS = 12
MAX_HABIT_NAME = 20
MAX_HABIT_TARGET = 50
STREAK_LOOKBACK = 400


def habit_list(db, today):
    """습관마다 오늘 횟수, 연속 기록, 최근 7일 (오래된 것 → 오늘)"""
    habits = db.execute("SELECT * FROM habits ORDER BY position, id").fetchall()
    if not habits:
        return []
    since = (today - timedelta(days=STREAK_LOOKBACK)).isoformat()
    counts = {}
    for r in db.execute("SELECT habit_id, date, count FROM habit_logs WHERE date >= ? AND date <= ?", (since, today.isoformat())):
        counts[(r["habit_id"], r["date"])] = r["count"]
    out = []
    for h in habits:
        def count_on(d, hid=h["id"]):
            return counts.get((hid, d.isoformat()), 0)
        # 연속 기록: 오늘 채웠으면 오늘부터, 아직이면 어제부터 거꾸로 센다 (오늘 아직 안 했다고 끊기지 않게)
        day = today if count_on(today) >= h["target"] else today - timedelta(days=1)
        streak = 0
        while streak < STREAK_LOOKBACK and count_on(day) >= h["target"]:
            streak += 1
            day -= timedelta(days=1)
        out.append({
            "id": h["id"],
            "name": h["name"],
            "emoji": h["emoji"],
            "target": h["target"],
            "position": h["position"],
            "count": count_on(today),
            "done": count_on(today) >= h["target"],
            "streak": streak,
            "week": [count_on(today - timedelta(days=i)) for i in range(6, -1, -1)],
        })
    return out


def habit_payload(data, db, existing=None):
    out = {}
    if existing is None or "name" in data:
        name = text_field(data, "name", "습관 이름", MAX_HABIT_NAME, required=True)
        if db.execute("SELECT 1 FROM habits WHERE name = ? AND id IS NOT ?", (name, existing)).fetchone():
            raise ApiError(f"'{name}' 습관이 이미 있어요.")
        out["name"] = name
    if existing is None or "emoji" in data:
        out["emoji"] = check_emoji(data.get("emoji"), "습관", default="✅")
    if existing is None or "target" in data:
        try:
            target = int(data["target"]) if data.get("target") not in (None, "") else 1
        except (TypeError, ValueError):
            raise ApiError("하루 목표 횟수는 숫자로 적어 주세요.") from None
        if not 1 <= target <= MAX_HABIT_TARGET:
            raise ApiError(f"하루 목표 횟수는 1~{MAX_HABIT_TARGET}번으로 정해 주세요.")
        out["target"] = target
    return out


def one_habit(db, habit_id, today):
    found = next((h for h in habit_list(db, today) if h["id"] == habit_id), None)
    if found is None:
        raise ApiError("습관을 찾을 수 없어요.", 404)
    return found


@bp.get("/habits")
def list_habits():
    return jsonify(habit_list(get_db(), today_arg()))


@bp.post("/habits")
def create_habit():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM habits").fetchone()["n"] >= MAX_HABITS:
        raise ApiError(f"습관은 {MAX_HABITS}개까지 만들 수 있어요.")
    fields = habit_payload(json_body(), db)
    position = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM habits").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO habits (name, emoji, target, position) VALUES (?, ?, ?, ?)",
        (fields["name"], fields["emoji"], fields["target"], position),
    )
    db.commit()
    return jsonify(one_habit(db, cur.lastrowid, today_arg())), 201


@bp.put("/habits/order")
def reorder_habits():
    db = get_db()
    ids = id_list(json_body(), "habits", "습관")
    db.executemany("UPDATE habits SET position = ? WHERE id = ?", [(i + 1, hid) for i, hid in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


@bp.put("/habits/<int:habit_id>")
def update_habit(habit_id):
    db = get_db()
    one_habit(db, habit_id, today_arg())
    fields = habit_payload(json_body(), db, existing=habit_id)
    if fields:
        db.execute(
            f"UPDATE habits SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
            (*fields.values(), habit_id),
        )
        db.commit()
    return jsonify(one_habit(db, habit_id, today_arg()))


@bp.delete("/habits/<int:habit_id>")
def delete_habit(habit_id):
    db = get_db()
    if db.execute("DELETE FROM habits WHERE id = ?", (habit_id,)).rowcount == 0:
        raise ApiError("습관을 찾을 수 없어요.", 404)
    db.execute("DELETE FROM habit_logs WHERE habit_id = ?", (habit_id,))
    db.commit()
    return jsonify(deleted=habit_id)


@bp.post("/habits/<int:habit_id>/step")
def step_habit(habit_id):
    """그날 횟수 +1 / −1. 0보다 작아지지 않고, 목표의 두 배(최대 99)를 넘지 않는다."""
    db = get_db()
    data = json_body()
    day = parse_date(data.get("date") or kst_today().isoformat())
    delta = data.get("delta", 1)
    if delta not in (1, -1):
        raise ApiError("delta는 1 또는 -1이어야 해요.")
    habit = db.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    if habit is None:
        raise ApiError("습관을 찾을 수 없어요.", 404)
    row = db.execute("SELECT count FROM habit_logs WHERE habit_id = ? AND date = ?", (habit_id, day)).fetchone()
    count = max(0, min((row["count"] if row else 0) + delta, max(habit["target"] * 2, 1), 99))
    if count:
        db.execute(
            "INSERT INTO habit_logs (habit_id, date, count) VALUES (?, ?, ?) "
            "ON CONFLICT(habit_id, date) DO UPDATE SET count = excluded.count",
            (habit_id, day, count),
        )
    else:
        db.execute("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?", (habit_id, day))
    db.commit()
    return jsonify(one_habit(db, habit_id, Date.fromisoformat(day)))


# ======================================================================== 프로젝트
MAX_PROJECTS = 100
MAX_PROJECT_TITLE = 60
MAX_PROJECT_MEMO = 2000
MAX_PERIOD_LABEL = 30
PROJECT_STATUS = ("active", "paused", "done")
PROJECT_COLORS = ("#7C5CD6", "#3D6FD9", "#2BA5B5", "#3FA66B", "#D9A514", "#F08C2E", "#E5534B", "#D45A9A")


def project_rows(db, where="", params=()):
    return db.execute(
        f"""
        SELECT p.*,
          (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id
             AND NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = i.id)) AS tasks_total,
          (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.done_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = i.id)) AS tasks_done,
          (SELECT COUNT(DISTINCT i.id) FROM items i JOIN item_dates d ON d.item_id = i.id WHERE i.project_id = p.id) AS event_count
        FROM projects p {where}
        ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.position, p.id
        """,
        params,
    ).fetchall()


def next_event(db, project_id, today):
    r = db.execute(
        """
        SELECT i.id, i.title, d.date, i.start_time FROM items i JOIN item_dates d ON d.item_id = i.id
        WHERE i.project_id = ? AND d.date >= ? ORDER BY d.date, i.start_time IS NULL, i.start_time LIMIT 1
        """,
        (project_id, today.isoformat()),
    ).fetchone()
    return {"id": r["id"], "title": r["title"], "date": r["date"], "start_time": r["start_time"]} if r else None


def project_dict(db, r, today):
    total, done = r["tasks_total"], r["tasks_done"]
    end = r["end_date"]
    return {
        "id": r["id"],
        "title": r["title"],
        "status": r["status"],
        "start_date": r["start_date"],
        "end_date": end,
        "period": r["period"],
        "memo": r["memo"],
        "color": r["color"],
        "position": r["position"],
        "done_at": r["done_at"],
        "created_at": r["created_at"],
        "tasks_total": total,
        "tasks_done": done,
        "progress": round(done * 100 / total) if total else None,
        "event_count": r["event_count"],
        "next_event": next_event(db, r["id"], today),
        "days_left": (Date.fromisoformat(end) - today).days if end else None,
    }


def project_list(db, today):
    return [project_dict(db, r, today) for r in project_rows(db)]


def get_project_or_404(db, project_id):
    rows = project_rows(db, "WHERE p.id = ?", (project_id,))
    if not rows:
        raise ApiError("프로젝트를 찾을 수 없어요.", 404)
    return rows[0]


def project_payload(data, db, today, existing=None):
    out = {}
    if existing is None or "title" in data:
        out["title"] = text_field(data, "title", "프로젝트 이름", MAX_PROJECT_TITLE, required=True)
    if "memo" in data or existing is None:
        out["memo"] = text_field(data, "memo", "메모", MAX_PROJECT_MEMO)
    if "status" in data or existing is None:
        status = data.get("status") or "active"
        if status not in PROJECT_STATUS:
            raise ApiError("상태는 active, paused, done 중 하나예요.")
        out["status"] = status
    if "color" in data or existing is None:
        color = str(data.get("color") or "").strip().upper()
        if existing is None and not color:
            n = db.execute("SELECT COUNT(*) AS n FROM projects").fetchone()["n"]
            color = PROJECT_COLORS[n % len(PROJECT_COLORS)]
        if not COLOR_RE.match(color):
            raise ApiError("색상 형식이 올바르지 않아요. (#RRGGBB)")
        out["color"] = color

    # 기간: when(글)을 보내면 서버가 읽고, 아니면 start_date·end_date·period를 그대로
    if data.get("when") not in (None, ""):
        text = str(data["when"]).strip()
        found = periods.parse_period(text, today)
        if not found:
            raise ApiError(f"'{text}'에서 기간을 읽지 못했어요. 예: ~12/6, 11/20~12/6, 1월 중, 겨울방학")
        out.update(start_date=found["start"], end_date=found["end"], period=found["label"][:MAX_PERIOD_LABEL])
    elif any(k in data for k in ("start_date", "end_date", "period")) or existing is None:
        start = parse_date(data["start_date"], "시작 날짜") if data.get("start_date") else None
        end = parse_date(data["end_date"], "끝 날짜") if data.get("end_date") else None
        if start and end and end < start:
            raise ApiError("끝 날짜는 시작 날짜와 같거나 뒤여야 해요.")
        out.update(start_date=start, end_date=end, period=text_field(data, "period", "기간", MAX_PERIOD_LABEL))
    return out


@bp.get("/projects")
def list_projects():
    return jsonify(project_list(get_db(), today_arg()))


@bp.get("/projects/<int:project_id>")
def project_detail(project_id):
    """프로젝트 하나 + 세부 할 일(안 한 것 먼저) + 연결한 일정 (다가오는 것 → 지난 것)"""
    db = get_db()
    today = today_arg()
    data = project_dict(db, get_project_or_404(db, project_id), today)
    tasks = db.execute(
        """
        SELECT i.*, c.name AS c_name, c.color AS c_color, c.is_default AS c_default
        FROM items i JOIN categories c ON c.id = i.category_id
        WHERE i.project_id = ? AND NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = i.id)
        ORDER BY i.done_at IS NOT NULL, i.urgent DESC, i.id
        """,
        (project_id,),
    ).fetchall()
    events = db.execute(
        """
        SELECT i.id, i.title, i.start_time, i.end_time, d.date, c.color AS c_color
        FROM items i JOIN item_dates d ON d.item_id = i.id JOIN categories c ON c.id = i.category_id
        WHERE i.project_id = ?
        ORDER BY d.date, i.start_time
        """,
        (project_id,),
    ).fetchall()
    upcoming = [e for e in events if e["date"] >= today.isoformat()]
    past = [e for e in events if e["date"] < today.isoformat()]
    past.sort(key=lambda e: e["date"], reverse=True)

    def event(e):
        return {"id": e["id"], "title": e["title"], "date": e["date"], "start_time": e["start_time"],
                "end_time": e["end_time"], "color": e["c_color"]}
    data.update(
        tasks=[item_dict(db, r) for r in tasks],
        upcoming=[event(e) for e in upcoming[:30]],
        past=[event(e) for e in past[:30]],
        past_count=len(past),
    )
    return jsonify(data)


@bp.post("/projects")
def create_project():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM projects").fetchone()["n"] >= MAX_PROJECTS:
        raise ApiError(f"프로젝트는 {MAX_PROJECTS}개까지 만들 수 있어요. 끝난 것을 정리해 주세요.")
    today = today_arg()
    f = project_payload(json_body(), db, today)
    position = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM projects").fetchone()["p"]
    cur = db.execute(
        "INSERT INTO projects (title, status, start_date, end_date, period, memo, color, position, done_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'done' THEN datetime('now', 'localtime') END)",
        (f["title"], f["status"], f["start_date"], f["end_date"], f["period"], f["memo"], f["color"], position, f["status"]),
    )
    db.commit()
    return jsonify(project_dict(db, get_project_or_404(db, cur.lastrowid), today)), 201


@bp.put("/projects/order")
def reorder_projects():
    db = get_db()
    ids = id_list(json_body(), "projects", "프로젝트")
    db.executemany("UPDATE projects SET position = ? WHERE id = ?", [(i + 1, pid) for i, pid in enumerate(ids)])
    db.commit()
    return jsonify(ids=ids)


@bp.put("/projects/<int:project_id>")
def update_project(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    today = today_arg()
    fields = project_payload(json_body(), db, today, existing=project_id)
    if fields:
        db.execute(
            f"UPDATE projects SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
            (*fields.values(), project_id),
        )
        if "status" in fields:
            db.execute(
                "UPDATE projects SET done_at = CASE WHEN status = 'done' THEN COALESCE(done_at, datetime('now', 'localtime')) END"
                " WHERE id = ?",
                (project_id,),
            )
        db.commit()
    return jsonify(project_dict(db, get_project_or_404(db, project_id), today))


@bp.delete("/projects/<int:project_id>")
def delete_project(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    if request.args.get("tasks") == "delete":
        # 세부 할 일(날짜 없는 것)만 지운다. 달력의 일정은 그대로 두고 연결만 푼다.
        db.execute(
            "DELETE FROM items WHERE project_id = ? AND NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = items.id)",
            (project_id,),
        )
    db.execute("UPDATE items SET project_id = NULL WHERE project_id = ?", (project_id,))
    db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    db.commit()
    return jsonify(deleted=project_id)


# ======================================================================== 기념일
MAX_ANNIVS = 100
MAX_ANNIV_TITLE = 40
ANNIV_KINDS = ("birthday", "yearly", "days")
LUNAR_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
DAY_STEP = 100          # 날짜 세기: 100일마다
MAX_DAY_COUNT = 20000


def lunar_to_solar(year, month, day, leap=False):
    """음력 → 양력 date. 그해에 윤달이 없으면 평달로, 30일이 없는 달이면 29일로. 바꿀 수 없으면 None"""
    if KoreanLunarCalendar is None:
        return None
    cal = KoreanLunarCalendar()
    for lp, d in ((leap, day), (False, day), (False, min(day, 29))):
        if cal.setLunarDate(year, month, d, lp):
            return Date.fromisoformat(cal.SolarIsoFormat())
    return None


def _yearly_on(a, year):
    """그 해에 돌아오는 날 (양력). 2월 29일은 평년에 28일로"""
    _, m, d = (int(x) for x in a["date"].split("-"))
    if a["lunar"]:
        return lunar_to_solar(year, m, d, bool(a["leap"]))
    try:
        return Date(year, m, d)
    except ValueError:
        return Date(year, 2, 28)


def _base_date(a):
    """처음 그날 (양력)"""
    y, m, d = (int(x) for x in a["date"].split("-"))
    if a["lunar"]:
        return lunar_to_solar(y, m, d, bool(a["leap"]))
    return Date(y, m, d)


def anniv_occurrences(db, start, end, rows=None):
    """
    [start, end) 안에 오는 기념일 → [{id, date, title, emoji, kind, label}]
      birthday : 매년 그날 (음력이면 그해의 양력 날짜로)
      yearly   : 매년 그날 + 'N주년'
      days     : 100일마다 'N일' + 해마다 'N주년'
    """
    start_d, end_d = Date.fromisoformat(start), Date.fromisoformat(end)
    rows = rows if rows is not None else db.execute("SELECT * FROM anniversaries ORDER BY id").fetchall()
    out = []
    for a in rows:
        base = _base_date(a)
        if base is None:
            continue

        def add(day, label, a=a):
            if start_d <= day < end_d:
                out.append({"id": a["id"], "date": day.isoformat(), "title": a["title"], "emoji": a["emoji"],
                            "kind": a["kind"], "label": label})

        for year in range(start_d.year - 1, end_d.year + 1):
            if a["kind"] == "days":
                if year <= base.year:
                    continue
                try:
                    day = base.replace(year=year)
                except ValueError:
                    day = Date(year, 2, 28)
                add(day, f"{year - base.year}주년")
            else:
                day = _yearly_on(a, year)
                if day is None or day < base:
                    continue
                n = day.year - base.year
                add(day, f"{n}주년" if a["kind"] == "yearly" and n > 0 else "")
        if a["kind"] == "days":
            offset = 1 if a["from_one"] else 0      # 그날을 1일로 세면 100일째 = 그날 + 99일
            first_n = max(DAY_STEP, ((start_d - base).days + offset) // DAY_STEP * DAY_STEP)
            n = first_n
            while n <= MAX_DAY_COUNT:
                day = base + timedelta(days=n - offset)
                if day >= end_d:
                    break
                add(day, f"{n:,}일")
                n += DAY_STEP
    out.sort(key=lambda o: (o["date"], o["id"]))
    return out


def anniv_dict(a, today):
    base = _base_date(a)
    soon = anniv_occurrences(None, today.isoformat(), (today + timedelta(days=400)).isoformat(), rows=[a])
    nxt = soon[0] if soon else None
    data = {
        "id": a["id"],
        "title": a["title"],
        "emoji": a["emoji"],
        "kind": a["kind"],
        "date": a["date"],
        "lunar": bool(a["lunar"]),
        "leap": bool(a["leap"]),
        "from_one": bool(a["from_one"]),
        "dday": bool(a["dday_days"]),
        "dday_days": a["dday_days"],
        "solar_date": base.isoformat() if base else None,
        "next": {"date": nxt["date"], "label": nxt["label"], "days_left": (Date.fromisoformat(nxt["date"]) - today).days} if nxt else None,
        "day_count": None,
    }
    if a["kind"] == "days" and base and base <= today:
        data["day_count"] = (today - base).days + (1 if a["from_one"] else 0)   # 오늘이 며칠째
    return data


def anniv_payload(data, existing=None):
    out = {}
    if existing is None or "title" in data:
        out["title"] = text_field(data, "title", "기념일 이름", MAX_ANNIV_TITLE, required=True)
    if existing is None or "emoji" in data:
        out["emoji"] = check_emoji(data.get("emoji"), "기념일", default="🎉")
    if existing is None or "kind" in data:
        kind = data.get("kind") or "yearly"
        if kind not in ANNIV_KINDS:
            raise ApiError("종류는 birthday(생일), yearly(기념일), days(날짜 세기) 중 하나예요.")
        out["kind"] = kind
    for key in ("lunar", "leap", "from_one"):
        if key in data or existing is None:
            value = data.get(key, key == "from_one")
            if not isinstance(value, bool):
                raise ApiError(f"{key}는 true/false여야 해요.")
            out[key] = int(value)
    if "dday_days" in data:
        days = data["dday_days"]
        if isinstance(days, bool) or days not in ANNIV_DDAY_CHOICES:
            raise ApiError("D-day는 0(안 띄움), 7, 14, 30, 60, 100일 전부터 중에서 골라 주세요.")
        out["dday_days"] = days
    elif "dday" in data:
        if not isinstance(data["dday"], bool):
            raise ApiError("dday는 true/false여야 해요.")
        out["dday_days"] = ANNIV_DDAY_DAYS if data["dday"] else 0
    elif existing is None:
        out["dday_days"] = ANNIV_DDAY_DAYS
    if "dday_days" in out:
        out["dday"] = int(out["dday_days"] > 0)
    if existing is None or "date" in data or "lunar" in data:
        lunar = out.get("lunar", existing["lunar"] if existing else 0)
        raw = data.get("date", existing["date"] if existing else None)
        if lunar:
            m = LUNAR_RE.match(str(raw or ""))
            if not m or not (1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 30 and 1000 < int(m.group(1)) < 2050):
                raise ApiError("음력 날짜를 확인해 주세요. (YYYY-MM-DD, 일은 1~30)")
            if KoreanLunarCalendar is None:
                raise ApiError("서버에 음력 계산 패키지가 없어요. pip install -r requirements.txt 를 실행해 주세요.", 503)
            out["date"] = raw
        else:
            out["date"] = parse_date(raw, "날짜")
    kind = out.get("kind", existing["kind"] if existing else "yearly")
    if kind == "days" and out.get("lunar", existing["lunar"] if existing else 0):
        raise ApiError("날짜 세기는 양력 날짜로만 정할 수 있어요.")
    return out


def get_anniv_or_404(db, anniv_id):
    row = db.execute("SELECT * FROM anniversaries WHERE id = ?", (anniv_id,)).fetchone()
    if row is None:
        raise ApiError("기념일을 찾을 수 없어요.", 404)
    return row


def anniv_list(db, today):
    items = [anniv_dict(a, today) for a in db.execute("SELECT * FROM anniversaries ORDER BY id")]
    items.sort(key=lambda a: (a["next"]["days_left"] if a["next"] else 99999, a["id"]))
    return items


@bp.get("/anniversaries")
def list_anniversaries():
    return jsonify(anniv_list(get_db(), today_arg()))


@bp.post("/anniversaries")
def create_anniversary():
    db = get_db()
    if db.execute("SELECT COUNT(*) AS n FROM anniversaries").fetchone()["n"] >= MAX_ANNIVS:
        raise ApiError(f"기념일은 {MAX_ANNIVS}개까지 넣을 수 있어요.")
    f = anniv_payload(json_body())
    cur = db.execute(
        "INSERT INTO anniversaries (title, emoji, kind, date, lunar, leap, from_one, dday, dday_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (f["title"], f["emoji"], f["kind"], f["date"], f["lunar"], f["leap"], f["from_one"], f["dday"], f["dday_days"]),
    )
    db.commit()
    return jsonify(anniv_dict(get_anniv_or_404(db, cur.lastrowid), today_arg())), 201


@bp.put("/anniversaries/<int:anniv_id>")
def update_anniversary(anniv_id):
    db = get_db()
    row = get_anniv_or_404(db, anniv_id)
    fields = anniv_payload(json_body(), existing=row)
    if fields:
        db.execute(
            f"UPDATE anniversaries SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
            (*fields.values(), anniv_id),
        )
        db.commit()
    return jsonify(anniv_dict(get_anniv_or_404(db, anniv_id), today_arg()))


@bp.delete("/anniversaries/<int:anniv_id>")
def delete_anniversary(anniv_id):
    db = get_db()
    get_anniv_or_404(db, anniv_id)
    db.execute("DELETE FROM anniversaries WHERE id = ?", (anniv_id,))
    db.commit()
    return jsonify(deleted=anniv_id)


# ======================================================================== 첫 화면 띠에 더할 것
ANNIV_DDAY_DAYS = 30     # 기념일 D-day 기본값: 30일 안으로 다가오면 띠에 (기념일마다 바꿀 수 있다)
ANNIV_DDAY_CHOICES = (0, 7, 14, 30, 60, 100)
MAX_URGENT = 8


def overview_extras(db, today):
    """
    /api/overview에 더하는 0.13.0 내용 (api_tools.overview_data가 부른다)
      urgent   : 급한 할 일 (안 한 것) — '오늘 챙길 것' 줄
      habits   : 습관과 오늘 횟수
      projects : 진행 중인 프로젝트 (기간이 오늘을 지나는 것, 또는 기간 없는 것)
      annivs   : 30일 안으로 다가온 기념일 (D-day 띠)
    """
    urgent = db.execute(
        """
        SELECT i.id, i.title, p.title AS p_title, p.color AS p_color FROM items i LEFT JOIN projects p ON p.id = i.project_id
        WHERE i.urgent = 1 AND i.done_at IS NULL AND NOT EXISTS (SELECT 1 FROM item_dates d WHERE d.item_id = i.id)
        ORDER BY i.id DESC LIMIT ?
        """,
        (MAX_URGENT,),
    ).fetchall()
    projects = [
        {k: p[k] for k in ("id", "title", "color", "end_date", "period", "progress", "days_left")}
        for p in project_list(db, today)
        if p["status"] == "active"
        and (not p["start_date"] or p["start_date"] <= (today + timedelta(days=7)).isoformat())
        and (not p["end_date"] or p["end_date"] >= today.isoformat())
    ]
    # 기념일마다 정한 날(dday_days)만큼 전부터 띄운다 (0.14.2)
    rows = db.execute("SELECT * FROM anniversaries WHERE dday_days > 0").fetchall()
    lead = {r["id"]: r["dday_days"] for r in rows}
    annivs = [
        {**o, "days_left": (Date.fromisoformat(o["date"]) - today).days}
        for o in anniv_occurrences(db, today.isoformat(), (today + timedelta(days=max(lead.values(), default=0) + 1)).isoformat(), rows=rows)
    ]
    annivs = [a for a in annivs if a["days_left"] <= lead[a["id"]]]
    return {
        "urgent": [{"id": r["id"], "title": r["title"], "project": {"title": r["p_title"], "color": r["p_color"]} if r["p_title"] else None} for r in urgent],
        "habits": habit_list(db, today),
        "projects": projects[:4],
        "annivs": annivs[:4],
    }
