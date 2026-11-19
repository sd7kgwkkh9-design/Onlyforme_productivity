"""0.13.0 — 급한 할 일, 습관, 캘린더만 잠그기, 시간표, 기념일, 프로젝트"""

import re
import sqlite3
import time
from datetime import date, timedelta

import pytest

import auth
import passkeys
import periods
import quickadd
from app import create_app
from db import init_db

TODAY = "2026-11-18"   # 수요일


@pytest.fixture(autouse=True)
def reset_lockout():
    auth._fails.clear()
    yield
    auth._fails.clear()


def version(c):
    return c.get("/api/version").get_json()["version"]


# ================================================================ 급한 할 일
def test_urgent_todo_flag_order_and_overview(client):
    a = client.post("/api/items", json={"title": "보통 할 일"}).get_json()
    b = client.post("/api/items", json={"title": "서류 내기", "urgent": True}).get_json()
    assert b["urgent"] is True and a["urgent"] is False
    todos = client.get("/api/inbox").get_json()["todos"]
    assert [t["title"] for t in todos][:2] == ["서류 내기", "보통 할 일"]   # 급한 것이 위로

    client.put(f"/api/items/{a['id']}/urgent", json={"urgent": True})
    ov = client.get(f"/api/overview?today={TODAY}").get_json()
    assert {u["title"] for u in ov["urgent"]} == {"서류 내기", "보통 할 일"}

    # 예전 화면처럼 urgent 없이 저장해도 표시가 사라지지 않는다
    client.put(f"/api/items/{b['id']}", json={"title": "서류 내기!", "dates": []})
    assert client.get(f"/api/items/{b['id']}").get_json()["urgent"] is True
    client.put(f"/api/items/{b['id']}/done", json={"done": True})
    ov = client.get(f"/api/overview?today={TODAY}").get_json()
    assert [u["title"] for u in ov["urgent"]] == ["보통 할 일"]          # 체크하면 빠진다
    assert client.put(f"/api/items/{a['id']}/urgent", json={"urgent": "y"}).status_code == 400


def test_quick_input_urgent_project_and_tags():
    t = date(2026, 11, 18)
    projects = [{"id": 7, "title": "텀 프로젝트", "color": "#7C5CD6"}]
    r = quickadd.parse("! 서류 내기", t, [], [], projects)
    assert (r["kind"], r["title"], r["urgent"]) == ("todo", "서류 내기", True)
    r = quickadd.parse("! 내일 서류 내기", t, [], [], projects)
    assert r["kind"] == "schedule" and r["dday"] is True and r["urgent"] is False   # 날짜가 있으면 D-day 일정
    r = quickadd.parse("# 텀프로젝트 ~12/6", t, [], [], projects)
    assert r["kind"] == "project" and r["title"] == "텀프로젝트"
    assert r["period"] == {"start": "2026-11-18", "end": "2026-12-06", "label": ""}
    r = quickadd.parse("회의 자료 정리 @텀", t, [], [], projects)
    assert r["title"] == "회의 자료 정리" and r["project"]["id"] == 7
    r = quickadd.parse("금요일까지 레포트 !", t, [], [], projects)
    assert r["dday"] is True and r["dates"] == ["2026-11-20"]               # 뒤에 띄어 쓴 !는 예전처럼 D-day
    assert quickadd.parse("#과제 내일 스터디", t, [{"id": 2, "name": "과제", "color": "#000000"}])["category"]["id"] == 2


def test_period_words():
    t = date(2026, 11, 18)
    cases = {
        "~12/6": ("2026-11-18", "2026-12-06", ""),
        "11/20~12/6": ("2026-11-20", "2026-12-06", ""),
        "1월 중": ("2027-01-01", "2027-01-31", "1월 중"),
        "1~2월": ("2027-01-01", "2027-02-28", "1~2월"),
        "겨울방학": ("2026-12-21", "2027-02-28", "겨울방학"),
        "2027 상반기": ("2027-01-01", "2027-06-30", "2027 상반기"),
        "1학기": ("2027-03-01", "2027-06-20", "1학기"),
        "다음 달": ("2026-12-01", "2026-12-31", "다음 달"),
    }
    for text, (start, end, label) in cases.items():
        found = periods.parse_period(text, t)
        assert (found["start"], found["end"], found["label"]) == (start, end, label), text
    assert periods.split_title("겨울방학 계획", t)[0] == "겨울방학 계획"     # 이름 붙은 기간으로 시작하면 제목에 남긴다
    assert periods.split_title("텀프로젝트 ~12/6", t)[0] == "텀프로젝트"
    assert periods.parse_period("그냥 제목", t) is None


# ================================================================ 습관
def test_habits_count_streak_and_reset_by_day(client):
    h = client.post(f"/api/habits?today={TODAY}", json={"name": "물", "emoji": "💧", "target": 3}).get_json()
    assert (h["count"], h["target"], h["streak"]) == (0, 3, 0)
    for _ in range(3):
        h = client.post(f"/api/habits/{h['id']}/step", json={"date": TODAY, "delta": 1}).get_json()
    assert h["count"] == 3 and h["done"] and h["streak"] == 1
    # 어제·그제도 채웠으면 연속 3일
    for d in ("2026-11-16", "2026-11-17"):
        for _ in range(3):
            client.post(f"/api/habits/{h['id']}/step", json={"date": d, "delta": 1})
    habits = client.get(f"/api/habits?today={TODAY}").get_json()
    assert habits[0]["streak"] == 3 and habits[0]["week"][-3:] == [3, 3, 3]
    # 다음 날이 되면 0부터 (아직 안 해도 어제까지의 연속은 그대로)
    nxt = client.get("/api/habits?today=2026-11-19").get_json()[0]
    assert nxt["count"] == 0 and nxt["streak"] == 3
    # −1은 0 밑으로 안 내려가고, 너무 많이 눌러도 목표의 두 배까지만
    h2 = client.post(f"/api/habits/{h['id']}/step", json={"date": "2026-11-19", "delta": -1}).get_json()
    assert h2["count"] == 0
    for _ in range(10):
        h2 = client.post(f"/api/habits/{h['id']}/step", json={"date": "2026-11-19", "delta": 1}).get_json()
    assert h2["count"] == 6
    assert client.get(f"/api/overview?today={TODAY}").get_json()["habits"][0]["name"] == "물"


def test_habit_validation_and_delete(client):
    assert client.post("/api/habits", json={"name": ""}).status_code == 400
    assert client.post("/api/habits", json={"name": "물", "emoji": "물"}).status_code == 400     # 글자는 이모지가 아님
    assert client.post("/api/habits", json={"name": "물", "target": 0}).status_code == 400
    h = client.post("/api/habits", json={"name": "물"}).get_json()
    assert h["emoji"] == "✅"
    assert client.post("/api/habits", json={"name": "물"}).status_code == 400                    # 같은 이름
    client.post(f"/api/habits/{h['id']}/step", json={"date": TODAY, "delta": 1})
    assert client.put(f"/api/habits/{h['id']}", json={"target": 8}).get_json()["target"] == 8
    assert client.delete(f"/api/habits/{h['id']}").status_code == 200
    assert client.get("/api/habits").get_json() == []


# ================================================================ 프로젝트
def test_projects_period_progress_tasks_and_events(client):
    p = client.post(f"/api/projects?today={TODAY}", json={"title": "텀프로젝트", "when": "~12/6"}).get_json()
    assert (p["start_date"], p["end_date"], p["period"], p["status"]) == (TODAY, "2026-12-06", "", "active")
    assert p["progress"] is None and p["days_left"] == 18
    fuzzy = client.post(f"/api/projects?today={TODAY}", json={"title": "자취방 구하기", "when": "1~2월"}).get_json()
    assert fuzzy["period"] == "1~2월" and fuzzy["start_date"] == "2027-01-01"
    assert client.post("/api/projects", json={"title": "x", "when": "언젠가 아마도"}).status_code == 400

    t1 = client.post("/api/items", json={"title": "발표 자료", "project_id": p["id"]}).get_json()
    client.post("/api/items", json={"title": "README", "project_id": p["id"]})
    client.post("/api/items", json={"title": "중간 점검", "dates": ["2026-11-25"], "project_id": p["id"]})
    client.post("/api/items", json={"title": "그냥 할 일"})
    client.put(f"/api/items/{t1['id']}/done", json={"done": True})

    detail = client.get(f"/api/projects/{p['id']}?today={TODAY}").get_json()
    assert detail["tasks_total"] == 2 and detail["tasks_done"] == 1 and detail["progress"] == 50
    assert [t["title"] for t in detail["tasks"]] == ["README", "발표 자료"]   # 안 한 것 먼저
    assert [e["title"] for e in detail["upcoming"]] == ["중간 점검"] and detail["next_event"]["date"] == "2026-11-25"
    assert t1["project"]["title"] == "텀프로젝트" and client.get(f"/api/items/{t1['id']}").get_json()["project"]["id"] == p["id"]

    inbox = client.get("/api/inbox").get_json()
    assert [t["title"] for t in inbox["todos"]] == ["그냥 할 일"]             # 세부 할 일은 프로젝트 안에서만
    assert [x["title"] for x in inbox["projects"]] == ["텀프로젝트", "자취방 구하기"]
    ov = client.get(f"/api/overview?today={TODAY}").get_json()
    assert [x["title"] for x in ov["projects"]] == ["텀프로젝트"]              # 1월부터인 것은 아직 '진행 중' 줄에 없다

    # 끝냄 → 진행 중 줄에서 빠진다
    client.put(f"/api/projects/{p['id']}?today={TODAY}", json={"status": "done"})
    assert client.get(f"/api/overview?today={TODAY}").get_json()["projects"] == []
    assert client.get(f"/api/projects/{p['id']}").get_json()["done_at"]


def test_project_delete_keeps_or_deletes_tasks(client):
    p = client.post("/api/projects", json={"title": "A"}).get_json()
    task = client.post("/api/items", json={"title": "세부", "project_id": p["id"]}).get_json()
    ev = client.post("/api/items", json={"title": "일정", "dates": ["2026-12-01"], "project_id": p["id"]}).get_json()
    client.delete(f"/api/projects/{p['id']}")
    assert client.get(f"/api/items/{task['id']}").get_json()["project"] is None              # 일반 할 일로 남는다
    p2 = client.post("/api/projects", json={"title": "B"}).get_json()
    t2 = client.post("/api/items", json={"title": "지울 것", "project_id": p2["id"]}).get_json()
    client.put(f"/api/items/{ev['id']}", json={"title": "일정", "dates": ["2026-12-01"], "project_id": p2["id"]})
    client.delete(f"/api/projects/{p2['id']}?tasks=delete")
    assert client.get(f"/api/items/{t2['id']}").status_code == 404
    assert client.get(f"/api/items/{ev['id']}").status_code == 200                           # 달력 일정은 남는다
    assert client.post("/api/items", json={"title": "x", "project_id": 999}).status_code == 404


def test_clear_done_keeps_project_tasks(client):
    p = client.post("/api/projects", json={"title": "A"}).get_json()
    t = client.post("/api/items", json={"title": "세부", "project_id": p["id"]}).get_json()
    plain = client.post("/api/items", json={"title": "보통"}).get_json()
    for x in (t, plain):
        client.put(f"/api/items/{x['id']}/done", json={"done": True})
    assert client.delete("/api/items/done").get_json()["deleted"] == 1
    assert client.get(f"/api/items/{t['id']}").status_code == 200


# ================================================================ 기념일
def test_anniversaries_yearly_lunar_and_day_counts(client):
    wedding = client.post(f"/api/anniversaries?today={TODAY}", json={"title": "결혼기념일", "emoji": "💍", "kind": "yearly", "date": "2020-12-01"}).get_json()
    assert wedding["next"] == {"date": "2026-12-01", "label": "6주년", "days_left": 13}
    # 음력 생일: 음력 8월 15일 → 2026년은 양력 9월 25일
    mom = client.post(f"/api/anniversaries?today={TODAY}", json={"title": "엄마 생신", "emoji": "🎂", "kind": "birthday", "date": "1970-08-15", "lunar": True}).get_json()
    assert mom["next"]["date"] == "2027-09-15" and mom["next"]["label"] == ""      # 2027년 음력 8/15
    cal = client.get("/api/calendar?start=2026-09-01&end=2026-10-01").get_json()
    assert {"date": "2026-09-25", "title": "엄마 생신"}.items() <= next(a for a in cal["annivs"] if a["id"] == mom["id"]).items()
    # 날짜 세기: 사귄 날을 1일로 → 100일째 = 그날 + 99일
    love = client.post(f"/api/anniversaries?today={TODAY}", json={"title": "만난 날", "emoji": "💕", "kind": "days", "date": "2026-08-31"}).get_json()
    assert love["day_count"] == 80 and love["next"] == {"date": "2026-12-08", "label": "100일", "days_left": 20}
    day = client.get("/api/day/2026-12-08").get_json()
    assert [a["label"] for a in day["annivs"]] == ["100일"]
    # 30일 안이면 D-day 띠에
    ddays = client.get(f"/api/overview?today={TODAY}").get_json()["ddays"]
    assert any(d["kind"] == "anniv" and d["title"] == "결혼기념일 6주년" and d["days_left"] == 13 for d in ddays)
    client.put(f"/api/anniversaries/{wedding['id']}", json={"dday": False})
    assert not any(d["kind"] == "anniv" and d["id"] == wedding["id"] for d in client.get(f"/api/overview?today={TODAY}").get_json()["ddays"])


def test_anniversary_validation(client):
    assert client.post("/api/anniversaries", json={"title": "x", "date": "2026-02-30"}).status_code == 400
    assert client.post("/api/anniversaries", json={"title": "x", "date": "2026-02-30", "lunar": True}).status_code == 201   # 음력엔 30일이 있다
    assert client.post("/api/anniversaries", json={"title": "x", "date": "2026-13-01", "lunar": True}).status_code == 400
    assert client.post("/api/anniversaries", json={"title": "x", "date": "2026-01-01", "kind": "days", "lunar": True}).status_code == 400
    assert client.post("/api/anniversaries", json={"title": "x", "date": "2026-01-01", "kind": "weekly"}).status_code == 400
    leap = client.post("/api/anniversaries", json={"title": "윤 생일", "date": "2000-02-29", "kind": "birthday"}).get_json()
    cal = client.get("/api/calendar?start=2027-02-01&end=2027-03-10").get_json()
    assert [a["date"] for a in cal["annivs"] if a["id"] == leap["id"]] == ["2027-02-28"]        # 평년엔 28일


# ================================================================ 시간표
def make_timetable(client, **kw):
    body = {"name": "2학기 수업", "start_date": "2026-09-01", "end_date": "2026-12-20", **kw}
    return client.post("/api/timetables", json=body).get_json()


def test_timetable_blocks_expand_by_period_skips_and_holidays(client):
    tt = make_timetable(client)
    res = client.post(f"/api/timetables/{tt['id']}/blocks", json={
        "title": "컴퓨터구조", "weekdays": [1, 3], "start_time": "09:00", "end_time": "10:30", "place": "공학관 301",
    })
    assert res.status_code == 201
    mon, wed = res.get_json()["blocks"]
    assert (mon["weekday"], wed["weekday"], mon["color"]) == (1, 3, tt["color"])

    cal = client.get("/api/calendar?start=2026-11-15&end=2026-11-22").get_json()
    assert [(c["date"], c["title"], c["place"]) for c in cal["classes"]] == [
        ("2026-11-16", "컴퓨터구조", "공학관 301"), ("2026-11-18", "컴퓨터구조", "공학관 301")]
    # 기간 밖에는 없다
    assert client.get("/api/calendar?start=2026-12-21&end=2026-12-31").get_json()["classes"] == []
    # 공휴일엔 쉬기 (2026-10-05 월 대체공휴일 → 추석 연휴)
    holiday_week = client.get("/api/timetable/occurrences?start=2026-10-05&end=2026-10-06").get_json()
    assert holiday_week and holiday_week[0]["skipped"] == "holiday"
    # 이날만 쉬기 → 달력에서는 빠지고, 하루 화면에서는 '쉼'으로 보인다
    client.put("/api/timetable-skips", json={"timetable_id": tt["id"], "block_id": mon["id"], "date": "2026-11-16"})
    assert [c["date"] for c in client.get("/api/calendar?start=2026-11-15&end=2026-11-22").get_json()["classes"]] == ["2026-11-18"]
    assert client.get("/api/day/2026-11-16").get_json()["classes"][0]["skipped"] == "skip"
    client.put("/api/timetable-skips", json={"timetable_id": tt["id"], "block_id": 0, "date": "2026-11-18"})   # 그날 전체
    assert client.get("/api/day/2026-11-18").get_json()["classes"][0]["skipped"] == "all"
    client.put("/api/timetable-skips", json={"timetable_id": tt["id"], "block_id": mon["id"], "date": "2026-11-16", "skip": False})
    assert client.get("/api/day/2026-11-16").get_json()["classes"][0]["skipped"] is None


def test_timetable_conflicts_and_validation(client):
    school = make_timetable(client)
    job = make_timetable(client, name="알바", start_date=None, end_date=None, skip_holidays=False)
    client.post(f"/api/timetables/{school['id']}/blocks", json={"title": "회로이론", "weekdays": [2], "start_time": "13:00", "end_time": "15:00"})
    res = client.post(f"/api/timetables/{job['id']}/blocks", json={"title": "카페", "weekdays": [2, 4], "start_time": "14:00", "end_time": "18:00"}).get_json()
    assert [c["title"] for c in res["conflicts"]] == ["회로이론"] and res["conflicts"][0]["timetable"] == "2학기 수업"
    later = client.put(f"/api/timetable-blocks/{res['blocks'][0]['id']}", json={"start_time": "15:00"}).get_json()
    assert later["conflicts"] == []                                       # 끝과 시작이 맞닿는 건 겹침이 아니다
    assert client.post(f"/api/timetables/{job['id']}/blocks", json={"title": "x", "weekdays": [7], "start_time": "09:00", "end_time": "10:00"}).status_code == 400
    assert client.post(f"/api/timetables/{job['id']}/blocks", json={"title": "x", "weekdays": [1], "start_time": "10:00", "end_time": "09:00"}).status_code == 400
    assert client.post("/api/timetables", json={"name": "x", "start_date": "2026-12-01", "end_date": "2026-11-01"}).status_code == 400
    assert client.delete(f"/api/timetables/{school['id']}").status_code == 200
    assert [t["name"] for t in client.get("/api/timetables").get_json()["timetables"]] == ["알바"]


def test_import_repeated_items_into_timetable(client):
    # 빠른 입력으로 만든 '매주 월수' 반복 일정 (한 주는 빠짐)
    dates = ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-18", "2026-11-23", "2026-11-25"]
    item = client.post("/api/items", json={"title": "컴구", "dates": dates, "start_time": "09:00", "end_time": "10:30"}).get_json()
    client.post("/api/items", json={"title": "가끔", "dates": ["2026-11-02", "2026-11-05", "2026-11-11"], "start_time": "09:00", "end_time": "10:00"})
    cands = client.get("/api/timetable/import").get_json()
    assert [c["title"] for c in cands] == ["컴구"] and cands[0]["weekdays"] == [1, 3]

    res = client.post("/api/timetable/import", json={"item_ids": [item["id"]], "new_name": "수업", "delete_items": True}).get_json()
    assert res["blocks"] == 2 and res["deleted"] == 1
    assert (res["timetable"]["start_date"], res["timetable"]["end_date"]) == ("2026-11-02", "2026-11-25")
    got = [c["date"] for c in client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()["classes"]]
    assert got == dates                                                   # 빠진 주(11/16)까지 똑같이
    assert client.get(f"/api/items/{item['id']}").status_code == 404


def test_ics_has_weekly_classes_with_exdates_and_anniversaries(client):
    from icalendar import Calendar
    tt = make_timetable(client, start_date=None, end_date=None)
    b = client.post(f"/api/timetables/{tt['id']}/blocks", json={"title": "컴구", "weekdays": [1], "start_time": "09:00", "end_time": "10:30", "place": "301"}).get_json()["blocks"][0]
    from api_plans import kst_today
    d = kst_today() + timedelta(days=7)   # 구독 파일은 서버(한국) 날짜 기준
    while d.weekday() != 0:
        d += timedelta(days=1)
    skip_day = d.isoformat()
    client.put("/api/timetable-skips", json={"timetable_id": tt["id"], "block_id": b["id"], "date": skip_day})
    client.post("/api/anniversaries", json={"title": "결혼기념일", "emoji": "💍", "date": "2020-01-15"})
    link = client.post("/api/links", json={"kind": "ics", "label": "폰"}).get_json()
    cal = Calendar.from_ical(client.get(link["url"].split("localhost")[-1]).data)
    classes = [e for e in cal.walk("VEVENT") if str(e["uid"]).startswith("class-")]
    assert len(classes) == 1 and classes[0]["rrule"]["FREQ"] == ["WEEKLY"] and str(classes[0]["location"]) == "301"
    ex = [x.dt.date().isoformat() for x in classes[0]["exdate"].dts] if not isinstance(classes[0]["exdate"], list) else \
         [x.dt.date().isoformat() for e in classes[0]["exdate"] for x in e.dts]
    assert skip_day in ex
    assert any(str(e["summary"]).startswith("💍 결혼기념일") for e in cal.walk("VEVENT"))


def test_widget_shows_next_class_urgent_and_habits(client):
    tt = make_timetable(client, start_date=None, end_date=None, skip_holidays=False)
    client.post(f"/api/timetables/{tt['id']}/blocks", json={"title": "컴구", "weekdays": list(range(7)), "start_time": "00:00", "end_time": "23:59"})
    client.post("/api/items", json={"title": "서류", "urgent": True})
    client.post("/api/habits", json={"name": "물", "emoji": "💧", "target": 8})
    link = client.post("/api/links", json={"kind": "widget", "label": "폰"}).get_json()
    data = client.get(link["url"].split("localhost")[-1]).get_json()
    assert data["class"]["title"] == "컴구" and data["class"]["day"] == "today"
    assert data["urgent"] == ["서류"] and data["habits"][0]["target"] == 8


# ================================================================ 캘린더만 잠그기
def make_login(tmp_path, password="secret1"):
    auth.save_password(str(tmp_path), password)
    c = create_app(str(tmp_path / "t.db")).test_client()
    c.post("/login", data={"password": password})
    return c


def test_lock_now_blocks_everything_until_password(tmp_path):
    c = make_login(tmp_path)
    assert c.get("/api/inbox").status_code == 200
    assert c.post("/auth/lock/now").get_json()["locked"] is True
    assert c.get("/").headers["Location"] == "/unlock"                 # 새로 고침해도 잠금 화면
    res = c.get("/api/inbox")
    assert res.status_code == 401 and res.get_json()["locked"] is True
    assert "자리를 비우려고 잠갔어요" in c.get("/unlock").get_data(as_text=True)
    assert c.post("/unlock", data={"password": "nope"}).status_code == 401
    assert c.post("/unlock", data={"password": "secret1"}).status_code == 302
    assert c.get("/api/inbox").status_code == 200


def test_pin_needs_password_unlocks_and_gives_up_after_fails(tmp_path):
    c = make_login(tmp_path)
    assert c.post("/auth/lock/pin", json={"pin": "2580", "password": "wrong"}).status_code == 401
    assert c.post("/auth/lock/pin", json={"pin": "1234", "password": "secret1"}).status_code == 400   # 쉬운 PIN
    assert c.post("/auth/lock/pin", json={"pin": "12a4", "password": "secret1"}).status_code == 400
    auth._fails.clear()
    assert c.post("/auth/lock/pin", json={"pin": "2580", "password": "secret1"}).get_json()["pin"] is True
    assert "2580" not in (tmp_path / "auth.json").read_text()                                    # 해시로만
    auth.save_password(str(tmp_path), "secret2")                                                  # 비밀번호를 바꿔도 PIN은 그대로
    assert c.get("/auth/lock").get_json()["pin"] is True

    c.post("/auth/lock/now")
    page = c.get("/unlock").get_data(as_text=True)
    assert 'name="pin"' in page
    assert c.post("/unlock", data={"pin": "2580"}).status_code == 302
    assert c.get("/api/inbox").status_code == 200

    c.post("/auth/lock/now")
    for _ in range(4):
        auth._fails.clear()
        assert c.post("/unlock", data={"pin": "0000"}).status_code == 401
    auth._fails.clear()
    assert "비밀번호로만" in c.post("/unlock", data={"pin": "0000"}).get_data(as_text=True)
    auth._fails.clear()
    assert c.post("/unlock", data={"pin": "2580"}).status_code == 403                             # 맞혀도 이제 PIN은 안 됨
    assert 'name="pin"' not in c.get("/unlock").get_data(as_text=True)
    assert c.post("/unlock", data={"password": "secret2"}).status_code == 302
    c.post("/auth/lock/now")
    assert 'name="pin"' in c.get("/unlock").get_data(as_text=True)                               # 열면 PIN 다시 가능
    c.post("/unlock", data={"password": "secret2"})
    assert c.delete("/auth/lock/pin").get_json()["pin"] is False


def test_auto_lock_minutes_and_public_pc_mode(tmp_path, monkeypatch):
    c = make_login(tmp_path)
    assert 'id="btn-lock"' in c.get("/").get_data(as_text=True)
    s = c.put("/auth/lock/settings", json={"auto": True, "minutes": 3, "blur": True}).get_json()
    assert (s["auto"], s["minutes"], s["blur"]) == (True, 3, True)
    html = c.get("/").get_data(as_text=True)
    assert '"minutes": 3' in html and 'data-lock=' in html
    start = time.time()
    monkeypatch.setattr(passkeys, "now", lambda: start + 2 * 60)
    assert c.get("/api/inbox").status_code == 200                       # 2분: 아직
    monkeypatch.setattr(passkeys, "now", lambda: start + 2 * 60 + 3 * 60 + 5)
    assert c.get("/api/inbox").status_code == 401                       # 그 뒤 3분 넘게 안 씀 → 잠김
    assert c.put("/auth/lock/settings", json={"minutes": 7}).status_code == 401   # 잠긴 동안에는 설정도 못 바꾼다
    c.post("/unlock", data={"password": "secret1"})
    assert c.put("/auth/lock/settings", json={"minutes": 7}).status_code == 400

    res = c.put("/auth/lock/settings", json={"public": True})
    cookie = res.headers["Set-Cookie"]
    assert "Expires=" not in cookie                                     # 브라우저를 닫으면 사라지는 쿠키
    res = c.put("/auth/lock/settings", json={"public": False})
    assert "Expires=" in res.headers["Set-Cookie"]


def test_lock_needs_password_login(client):
    assert client.post("/auth/lock/now").status_code == 400            # 비밀번호 없이 쓰는 내 컴퓨터에서는 잠글 수 없다


# ================================================================ 이어 쓰기 / 이름
def test_old_database_gets_new_columns_and_tables(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
        INSERT INTO categories (name, color, is_default) VALUES ('미분류', '#9AA0AA', 1);
        CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
            category_id INTEGER NOT NULL, start_time TEXT, end_time TEXT, dday INTEGER NOT NULL DEFAULT 0, done_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
        INSERT INTO items (title, category_id) VALUES ('예전 할 일', 1);
    """)
    conn.commit()
    conn.close()
    init_db(str(path))
    c = create_app(str(path)).test_client()
    todo = c.get("/api/inbox").get_json()["todos"][0]
    assert todo["title"] == "예전 할 일" and todo["urgent"] is False and todo["project"] is None
    assert c.get("/api/habits").get_json() == [] and c.get("/api/timetables").get_json()["timetables"] == []


def test_notes_panel_is_renamed(client):
    html = client.get("/").get_data(as_text=True)
    assert "기록지" not in html and "메모장" in html
    assert re.search(r'data-tab="memo"[^>]*>노트<', html)
    assert 'data-tab="project"' in html and 'id="btn-view-timetable"' in html
    assert 'id="btn-lock"' not in html                    # 비밀번호 없이 쓰면 잠글 수 없으니 버튼도 없다
