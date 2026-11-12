"""0.11.0 테스트: 인생·올해 목표(세 단계, 진행 방식 셋), 달력 위 띠의 올해 정보, 날짜 꾸미기, 0.10 DB 이어 쓰기, 화면 장치"""

import os
import sqlite3

from app import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def post(client, path, body, status=201):
    res = client.post(path, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def put(client, path, body, status=200):
    res = client.put(path, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- 목표 세 단계
def test_goal_levels_link_upwards_only(client):
    life = post(client, "/api/goals", {"kind": "life", "title": "건강한 몸"})
    year = post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "풀마라톤", "parent_id": life["id"]})
    due = post(client, "/api/goals", {"title": "10km 50분", "due": "2026-12-31", "parent_id": year["id"]})
    assert (life["kind"], year["kind"], due["kind"]) == ("life", "year", "due")      # 단계를 안 쓰면 기한 목표
    assert year["parent_id"] == life["id"] and due["parent_id"] == year["id"]
    assert life["due"] is None and year["measure"] == "check"

    # 올해 → 인생, 기한 → 올해로만 이을 수 있다
    post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "x", "parent_id": due["id"]}, status=400)
    post(client, "/api/goals", {"title": "x", "parent_id": life["id"]}, status=400)
    post(client, "/api/goals", {"kind": "week", "title": "x"}, status=400)
    post(client, "/api/goals", {"kind": "year", "year": 1800, "title": "x"}, status=400)

    # 위 목표를 지우면 아래 목표는 남고 연결만 풀린다
    assert client.delete(f"/api/goals/{year['id']}").status_code == 200
    goals = {g["title"]: g for g in client.get("/api/goals").get_json()}
    assert goals["10km 50분"]["parent_id"] is None and "건강한 몸" in goals

    # 단계는 만든 뒤에 바뀌지 않는다
    assert put(client, f"/api/goals/{life['id']}", {"kind": "due", "title": "건강한 몸과 마음"})["kind"] == "life"


def test_year_goal_count_fills_with_steps(client):
    g = post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "책 3권", "measure": "count", "target": 3})
    assert (g["current"], g["target"], g["done"]) == (0, 3, False)
    assert post(client, f"/api/goals/{g['id']}/step", {}, status=200)["current"] == 1
    post(client, f"/api/goals/{g['id']}/step", {"delta": 1}, status=200)
    full = post(client, f"/api/goals/{g['id']}/step", {"delta": 1}, status=200)
    assert full["current"] == 3 and full["done"] is True                             # 숫자를 채우면 이룬 것
    assert post(client, f"/api/goals/{g['id']}/step", {"delta": -5}, status=200)["current"] == 0   # 0 아래로는 안 내려간다

    post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "x", "measure": "count"}, status=400)             # 목표 숫자 없음
    post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "x", "measure": "count", "target": 0}, status=400)
    check = post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "토익 800"})
    post(client, f"/api/goals/{check['id']}/step", {}, status=400)                                                         # 체크 목표는 +1이 없다
    assert put(client, f"/api/goals/{check['id']}", {"done": True})["done"] is True


def test_year_goal_linked_to_routine_counts_that_years_logs(client):
    run = post(client, "/api/routines", {"name": "운동", "emoji": "🏃"})
    read_ = post(client, "/api/routines", {"name": "독서", "emoji": "📖"})
    g = post(client, "/api/goals", {
        "kind": "year", "year": 2026, "title": "운동 3번", "measure": "routine", "target": 3, "routine_id": run["id"],
    })
    assert g["current"] == 0 and g["routine"] == {"name": "운동", "emoji": "🏃"}
    for day in ("2026-01-05", "2026-11-10", "2025-12-31"):                           # 작년 기록은 세지 않는다
        post(client, "/api/routine-logs", {"routine_id": run["id"], "date": day})
    post(client, "/api/routine-logs", {"routine_id": read_["id"], "date": "2026-11-10"})   # 다른 루틴도 세지 않는다
    now = next(x for x in client.get("/api/goals").get_json() if x["id"] == g["id"])
    assert (now["current"], now["done"]) == (2, False)
    post(client, "/api/routine-logs", {"routine_id": run["id"], "date": "2026-11-12"})
    assert next(x for x in client.get("/api/inbox").get_json()["goals"] if x["id"] == g["id"])["done"] is True

    post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "x", "measure": "routine", "target": 5}, status=400)
    post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "x", "measure": "routine", "target": 5, "routine_id": 999}, status=400)

    # 루틴을 지우면 목표는 그때까지 센 숫자를 들고 '숫자 목표'가 된다
    assert client.delete(f"/api/routines/{run['id']}").status_code == 200
    kept = next(x for x in client.get("/api/goals").get_json() if x["id"] == g["id"])
    assert (kept["measure"], kept["current"], kept["routine_id"]) == ("count", 3, None)


def test_goal_order_is_per_group(client):
    l1 = post(client, "/api/goals", {"kind": "life", "title": "L1"})
    l2 = post(client, "/api/goals", {"kind": "life", "title": "L2"})
    y1 = post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "Y1"})
    y2 = post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "Y2"})
    post(client, "/api/goals", {"kind": "year", "year": 2027, "title": "내년"})
    d1 = post(client, "/api/goals", {"title": "D1"})
    post(client, "/api/goals", {"title": "묶인 목표", "parent_id": y1["id"]})
    put(client, "/api/goals/order", {"ids": [l2["id"], l1["id"]]})
    put(client, "/api/goals/order", {"ids": [y2["id"], y1["id"]]})                   # 같은 해끼리, 내년 목표는 빼고
    put(client, "/api/goals/order", {"ids": [d1["id"]]})                             # 묶지 않은 기한 목표끼리
    put(client, "/api/goals/order", {"ids": [l1["id"], y1["id"]]}, status=409)       # 다른 묶음을 섞으면 안 된다
    titles = [g["title"] for g in client.get("/api/goals").get_json()]
    assert titles.index("L2") < titles.index("L1") and titles.index("Y2") < titles.index("Y1")


def test_overview_has_year_progress_goals_and_life(client):
    run = post(client, "/api/routines", {"name": "운동", "emoji": "🏃"})
    post(client, "/api/goals", {"kind": "life", "title": "건강한 몸"})
    post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "운동 100번", "measure": "routine", "target": 100, "routine_id": run["id"]})
    done = post(client, "/api/goals", {"kind": "year", "year": 2026, "title": "이룬 것"})
    put(client, f"/api/goals/{done['id']}", {"done": True})
    post(client, "/api/goals", {"kind": "year", "year": 2027, "title": "내년 것"})
    post(client, "/api/routine-logs", {"routine_id": run["id"], "date": "2026-03-01"})

    o = client.get("/api/overview?today=2026-07-02").get_json()
    assert o["year"]["year"] == 2026 and o["year"]["percent"] == 50 and o["year"]["days_left"] == 182
    assert (o["year"]["total"], o["year"]["done"]) == (2, 1)
    assert [(g["title"], g["current"], g["target"]) for g in o["year"]["goals"]] == [("운동 100번", 1, 100)]
    assert o["year"]["goals"][0]["routine"]["emoji"] == "🏃" and o["year"]["nudge"] is False
    assert [g["title"] for g in o["life"]] == ["건강한 몸"]
    assert o["ddays"] == []                                                          # 올해·인생 목표는 D-day 칩이 아니다

    # 해가 바뀌었는데 새해 목표가 없으면 '목표 세우기'를 권한다
    assert client.get("/api/overview?today=2028-01-03").get_json()["year"]["nudge"] is True
    assert client.get("/api/overview?today=2027-01-03").get_json()["year"]["nudge"] is False   # 2027 목표가 이미 있다


# ---------------------------------------------------------------- 달력 꾸미기
def test_day_marks_sticker_and_highlight(client):
    put(client, "/api/days/2026-11-14/mark", {"sticker": "🎂", "color": "pink"})
    put(client, "/api/days/2026-11-20/mark", {"color": "yellow"})
    month = client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()
    assert month["marks"] == [
        {"date": "2026-11-14", "sticker": "🎂", "color": "pink"},
        {"date": "2026-11-20", "sticker": "", "color": "yellow"},
    ]
    assert client.get("/api/day/2026-11-14").get_json()["mark"]["sticker"] == "🎂"
    assert client.get("/api/day/2026-11-15").get_json()["mark"] is None

    # 보낸 칸만 바뀐다. 둘 다 비우면 꾸밈이 사라진다
    assert put(client, "/api/days/2026-11-14/mark", {"sticker": "✈️"}) == {"date": "2026-11-14", "sticker": "✈️", "color": "pink"}
    put(client, "/api/days/2026-11-14/mark", {"sticker": "", "color": ""})
    assert [m["date"] for m in client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()["marks"]] == ["2026-11-20"]

    put(client, "/api/days/2026-11-14/mark", {"sticker": "생일"}, status=400)          # 글자는 스티커가 아니다
    put(client, "/api/days/2026-11-14/mark", {"color": "#ff0000"}, status=400)
    put(client, "/api/days/2026-02-30/mark", {"color": "pink"}, status=400)


def test_marks_change_bumps_sync_version(client):
    before = client.get("/api/version").get_json()["version"]
    put(client, "/api/days/2026-11-14/mark", {"color": "blue"})
    assert client.get("/api/version").get_json()["version"] == before + 1


# ---------------------------------------------------------------- 0.10 DB 이어 쓰기
def test_v10_database_keeps_goals_as_due_goals(tmp_path):
    path = tmp_path / "v10.db"
    create_app(str(path))                                   # 지금 구조로 만든 뒤, 0.10 때의 goals 표로 되돌린다
    conn = sqlite3.connect(path)
    conn.executescript("""
        DROP TABLE goals;
        DROP TABLE day_marks;
        CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, due TEXT, memo TEXT NOT NULL DEFAULT '',
                            done_at TEXT, position INTEGER NOT NULL DEFAULT 0,
                            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
        INSERT INTO goals (title, due, position) VALUES ('풀업 15개', '2026-12-31', 1);
        INSERT INTO goals (title, done_at, position) VALUES ('이룬 목표', '2026-11-01 10:00:00', 2);
    """)
    conn.commit()
    conn.close()

    c = create_app(str(path)).test_client()
    goals = c.get("/api/goals").get_json()
    assert [(g["title"], g["kind"], g["done"], g["measure"]) for g in goals] == [
        ("풀업 15개", "due", False, "check"), ("이룬 목표", "due", True, "check"),
    ]
    assert c.get("/api/overview?today=2026-11-12").get_json()["ddays"][0]["title"] == "풀업 15개"
    post(c, "/api/goals", {"kind": "life", "title": "새 인생 목표"})
    put(c, "/api/days/2026-11-14/mark", {"sticker": "⭐"})


# ---------------------------------------------------------------- 화면 장치
def test_color_themes_and_background_apply_before_paint(client):
    html = client.get("/").get_data(as_text=True)
    for key in ("my-calendar:color", "my-calendar:color-custom", "my-calendar:bg"):
        assert key in html                                   # _head.html이 화면을 그리기 전에 적용 (번쩍임 방지)
    css = read("static", "css", "style.css")
    for name in ("green", "orange", "purple", "pink", "mono"):
        assert f':root[data-color="{name}"]' in css
    assert ':root[data-color][data-theme="dark"]' in css and ":root[data-bg]" in css
    assert "background-image: none !important" in css[css.index("@media print {"):]   # 배경 사진은 인쇄하지 않는다


def test_weather_asks_hourly_forecast_for_event_times():
    js = read("static", "js", "weather.js")
    assert "&hourly=weather_code,temperature_2m,precipitation_probability" in js
    assert "forecast_days=${DAYS}" in js and "const DAYS = 7;" in js                 # 예보는 7일 그대로
    for name in ("weatherAt", "timedBadge", "rainAlert", "decorateTimed"):
        assert f"export function {name}" in js


def test_new_modules_are_in_import_map(client):
    html = client.get("/").get_data(as_text=True)
    for name in ("decor.js", "weekly.js"):
        assert f"/static/js/{name}?v=" in html
