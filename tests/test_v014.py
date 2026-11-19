"""0.14.0 — 챙기기, 테마, 일기, 검색, 백업 · 되살리기 / 뺀 것: 이번 주 한 걸음, 형광펜, 시간 돌아보기"""

import json
import os
import sqlite3

from app import create_app

TODAY = "2026-11-20"


def version(c):
    return c.get("/api/version").get_json()["version"]


def put(c, url, body, status=200):
    res = c.put(url, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


# ================================================================ 일기
def test_diary_write_read_and_delete_when_empty(client):
    v = version(client)
    d = put(client, "/api/diaries/2026-11-20", {"body": "텀프로젝트 0.14.0을 만들었다.", "mood": "😊"})
    assert (d["date"], d["body"], d["mood"]) == ("2026-11-20", "텀프로젝트 0.14.0을 만들었다.", "😊") and d["updated_at"]
    assert version(client) == v + 1                                         # 다른 기기에도 알린다

    # 보낸 칸만 바뀐다
    assert put(client, "/api/diaries/2026-11-20", {"body": "고침"})["mood"] == "😊"
    assert put(client, "/api/diaries/2026-11-20", {"mood": ""})["body"] == "고침"
    assert client.get("/api/diaries/2026-11-20").get_json()["body"] == "고침"
    # 없는 날은 빈 칸으로 (404가 아니라)
    assert client.get("/api/diaries/2026-11-21").get_json() == {"date": "2026-11-21", "body": "", "mood": "", "updated_at": None}

    # 내용도 기분도 비우면 지워진다 (공백만 있어도)
    assert put(client, "/api/diaries/2026-11-20", {"body": "   \n "})["updated_at"] is None
    assert client.get("/api/diaries").get_json()["total"] == 0

    put(client, "/api/diaries/2026-11-20", {"mood": "생일"}, status=400)        # 기분은 이모지 하나
    put(client, "/api/diaries/2026-11-20", {"body": "가" * 20001}, status=400)
    put(client, "/api/diaries/2026-02-30", {"body": "x"}, status=400)
    put(client, "/api/diaries/2026-11-19", {"mood": "🥰"})                    # 기분만 남겨도 된다
    assert client.delete("/api/diaries/2026-11-19").status_code == 204
    assert client.get("/api/diaries").get_json()["total"] == 0


def test_diary_on_calendar_day_and_list(client):
    for day, body in [("2026-10-31", "할로윈"), ("2026-11-03", "첫 줄\n둘째 줄"), ("2026-11-20", "가" * 300)]:
        put(client, f"/api/diaries/{day}", {"body": body, "mood": "😊" if day == "2026-11-03" else ""})
    cal = client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()
    assert cal["diaries"] == [{"date": "2026-11-03", "mood": "😊"}, {"date": "2026-11-20", "mood": ""}]   # 날짜·기분만 (내용은 없다)
    assert client.get("/api/day/2026-11-03").get_json()["diary"]["body"] == "첫 줄\n둘째 줄"
    assert client.get("/api/day/2026-11-04").get_json()["diary"] is None

    res = client.get("/api/diaries?limit=2").get_json()
    assert res["total"] == 3 and res["more"] is True
    assert [e["date"] for e in res["entries"]] == ["2026-11-20", "2026-11-03"]   # 최신순
    assert res["entries"][0]["chars"] == 300 and res["entries"][0]["preview"].endswith("…") and len(res["entries"][0]["preview"]) <= 141
    assert res["entries"][1]["preview"] == "첫 줄 둘째 줄"
    more = client.get("/api/diaries?limit=2&before=2026-11-03").get_json()
    assert [e["date"] for e in more["entries"]] == ["2026-10-31"] and more["more"] is False


def test_diary_never_leaves_through_links(client):
    from icalendar import Calendar
    client.post("/api/items", json={"title": "공개 일정", "dates": ["2026-11-20"]})
    put(client, "/api/diaries/2026-11-20", {"body": "아무도 보면 안 되는 일기", "mood": "😢"})
    ics = client.post("/api/links", json={"kind": "ics", "label": "폰"}).get_json()
    data = client.get(ics["url"].split("localhost")[-1]).data
    assert "아무도 보면".encode() not in data and "공개 일정".encode() in data
    assert all("일기" not in str(e.get("summary")) for e in Calendar.from_ical(data).walk("VEVENT"))
    share = client.post("/api/links", json={"kind": "share", "label": "가족", "options": {"memo": True}}).get_json()
    path = share["url"].split("localhost")[-1]
    page = client.get(path).get_data(as_text=True) + client.get(f"{path}/events?start=2026-11-01&end=2026-12-01").get_data(as_text=True)
    assert "아무도 보면" not in page and "공개 일정" in page
    widget = client.post("/api/links", json={"kind": "widget", "label": "위젯"}).get_json()
    assert "아무도 보면" not in client.get(widget["url"].split("localhost")[-1]).get_data(as_text=True)


# ================================================================ 검색
def make_world(c):
    cat = c.post("/api/categories", json={"name": "과제", "color": "#E5534B"}).get_json()
    c.post("/api/items", json={"title": "회로이론 과제 제출", "dates": ["2026-11-10"], "category_id": cat["id"], "memo": "4장 연습문제"})
    c.post("/api/items", json={"title": "회로이론 기말고사", "dates": ["2026-12-15", "2026-12-16"], "start_time": "13:00"})
    c.post("/api/items", json={"title": "회로이론 2주차 복습", "dates": ["2026-11-25"]})
    c.post("/api/items", json={"title": "회로 책 반납"})                                        # 할 일
    c.post("/api/notes", json={"title": "시험 범위", "body": "- [ ] **회로이론** 4장\n- [x] 선대 1장"})
    c.post("/api/goals", json={"title": "회로 A+ 받기", "kind": "year", "year": 2026})
    c.post("/api/projects", json={"title": "회로 스터디", "when": "~12/15"})
    put(c, "/api/diaries/2026-11-19", {"body": "오늘 회로이론 과제를 겨우 끝냈다. 100% 만족!"})
    tt = c.post("/api/timetables", json={"name": "2학기 수업"}).get_json()
    c.post(f"/api/timetables/{tt['id']}/blocks", json={"title": "회로이론2", "weekdays": [2], "start_time": "13:30", "end_time": "14:45", "place": "공학관 405"})
    r = c.post("/api/routines", json={"name": "운동", "emoji": "🏃"}).get_json()
    c.post("/api/routine-logs", json={"routine_id": r["id"], "date": "2026-11-18", "memo": "회로 공부 끝나고 5km"})
    c.post("/api/anniversaries", json={"title": "회로 동아리 창립", "emoji": "🎉", "kind": "yearly", "date": "2020-03-02"})


def test_search_everything_grouped(client):
    make_world(client)
    res = client.get(f"/api/search?q=회로&today={TODAY}").get_json()
    kinds = {g["kind"]: g for g in res["groups"]}
    assert set(kinds) == {"event", "todo", "diary", "note", "goal", "project", "class", "log", "anniv"}
    # 일정: 다가오는 것 먼저(가까운 순) → 지난 것(최근 순). 반복·여러 날 일정은 하나로, 가장 가까운 날짜를 대표로
    assert [(e["title"], e["date"]) for e in kinds["event"]["results"]] == [
        ("회로이론 2주차 복습", "2026-11-25"), ("회로이론 기말고사", "2026-12-15"), ("회로이론 과제 제출", "2026-11-10")]
    assert kinds["event"]["results"][1]["date_count"] == 2 and kinds["event"]["results"][2]["upcoming"] is False
    assert kinds["event"]["results"][2]["color"] == "#E5534B"
    assert "회로이론" in kinds["diary"]["results"][0]["snippet"]
    assert "**" not in kinds["note"]["results"][0]["snippet"] and "[ ]" not in kinds["note"]["results"][0]["snippet"]   # 마크다운 기호는 빼고
    assert kinds["class"]["results"][0]["place"] == "공학관 405"
    assert res["total"] == sum(len(g["results"]) for g in res["groups"])


def test_search_and_terms_and_special_characters(client):
    make_world(client)
    def titles(q):
        groups = client.get(f"/api/search?q={q}&today={TODAY}").get_json()["groups"]
        return [r.get("title", r.get("snippet")) for g in groups for r in g["results"]]
    assert titles("회로이론 기말") == ["회로이론 기말고사"]                       # 낱말은 모두 들어 있어야 (AND)
    assert titles("4장 연습") == ["회로이론 과제 제출"]                          # 메모에서도 찾는다
    assert titles("공학관") == ["회로이론2"]                                     # 시간표의 장소
    assert len(titles("100%")) == 1 and titles("%") != titles("회로") and titles("_") == []   # %·_ 는 글자 그대로
    assert client.get("/api/search?q=").get_json() == {"q": "", "total": 0, "groups": []}
    assert client.get("/api/search?q=" + "가" * 61).status_code == 400


# ================================================================ 백업 · 되살리기
def test_backup_download_has_my_data_but_no_keys(client):
    make_world(client)
    client.post("/api/links", json={"kind": "share", "label": "가족"})
    res = client.get("/api/backup")
    assert res.status_code == 200 and "attachment" in res.headers["Content-Disposition"] and ".json" in res.headers["Content-Disposition"]
    data = json.loads(res.data)
    from app import APP_VERSION
    assert data["app"] == "my-calendar" and data["format"] == 1 and data["version"] == APP_VERSION
    tables = data["tables"]
    assert {"items", "notes", "diaries", "timetable_blocks", "habits", "anniversaries", "projects"} <= set(tables)
    assert "links" not in tables and "passkeys" not in tables and "meta" not in tables   # 열쇠는 들어가지 않는다
    assert any(r["body"].startswith("오늘 회로이론") for r in tables["diaries"])


def test_backup_restore_round_trip(client, tmp_path):
    make_world(client)
    backup = json.loads(client.get("/api/backup").data)
    # 다 지우고 다른 걸 넣은 뒤 되살리면 백업 때로 돌아간다
    for it in client.get("/api/inbox").get_json()["todos"]:
        client.delete(f"/api/items/{it['id']}")
    put(client, "/api/diaries/2026-11-19", {"body": "덮어쓴 일기"})
    client.post("/api/items", json={"title": "백업 뒤에 넣은 일정", "dates": ["2026-11-21"]})
    v = version(client)
    res = client.post("/api/backup/restore", json=backup)
    assert res.status_code == 200, res.get_json()
    out = res.get_json()
    assert out["ok"] and out["safety"].startswith("before-restore-") and out["counts"]["diaries"] == 1
    assert version(client) > v                                                     # 다른 기기도 새로 불러온다
    assert client.get("/api/diaries/2026-11-19").get_json()["body"].startswith("오늘 회로이론")
    assert [t["title"] for t in client.get("/api/inbox").get_json()["todos"]] == ["회로 책 반납"]
    assert client.get(f"/api/search?q=백업 뒤에&today={TODAY}").get_json()["total"] == 0
    assert client.get(f"/api/search?q=회로&today={TODAY}").get_json()["total"] == client.get(f"/api/search?q=회로&today={TODAY}").get_json()["total"]
    # 되살리기 전 데이터는 서버에 한 벌 남는다
    folder = tmp_path / "backups"
    saved = json.loads((folder / out["safety"]).read_text(encoding="utf-8"))
    assert any(r["body"] == "덮어쓴 일기" for r in saved["tables"]["diaries"])


def test_backup_restore_rejects_bad_files_and_keeps_data(client):
    make_world(client)
    before = client.get(f"/api/search?q=회로&today={TODAY}").get_json()["total"]
    assert client.post("/api/backup/restore", json={"hello": 1}).status_code == 400
    assert client.post("/api/backup/restore", json={"app": "my-calendar", "format": 99, "tables": {}}).status_code == 400
    assert client.post("/api/backup/restore", json={"app": "my-calendar", "format": 1, "tables": {"items": "x"}}).status_code == 400
    # 연결이 맞지 않는 파일 (없는 일정의 날짜) → 통째로 취소
    bad = {"app": "my-calendar", "format": 1, "tables": {"item_dates": [{"item_id": 999, "date": "2026-11-20", "position": 1}]}}
    res = client.post("/api/backup/restore", json=bad)
    assert res.status_code == 400 and "그대로" in res.get_json()["error"]
    assert client.get(f"/api/search?q=회로&today={TODAY}").get_json()["total"] == before


def test_restore_old_backup_without_new_tables(client):
    """예전 버전에서 받은 파일(일기 표 없음, 형광펜 색 있음, 모르는 칸 있음)도 되살린다"""
    old = {
        "app": "my-calendar", "format": 1, "version": "0.13.0",
        "tables": {
            "categories": [{"id": 1, "name": "미분류", "color": "#9AA0AA", "is_default": 1, "future_column": "?"}],
            "items": [{"id": 5, "title": "예전 일정", "memo": "", "category_id": 1}],
            "item_dates": [{"item_id": 5, "date": "2026-11-20", "position": 1}],
            "day_marks": [{"date": "2026-11-20", "sticker": "", "color": "pink"}, {"date": "2026-11-21", "sticker": "⭐", "color": "blue"}],
        },
    }
    put(client, "/api/diaries/2026-11-20", {"body": "지금 일기"})
    assert client.post("/api/backup/restore", json=old).status_code == 200
    cal = client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()
    assert [i["title"] for i in cal["items"]] == ["예전 일정"]
    assert cal["marks"] == [{"date": "2026-11-21", "sticker": "⭐"}]               # 형광펜만 있던 날은 사라진다
    assert cal["diaries"] == []                                                    # 파일에 없던 표는 비어 있게


# ================================================================ 형광펜을 뺀 뒤 예전 DB 이어 쓰기
def test_old_database_highlights_are_cleared(tmp_path):
    path = tmp_path / "old.db"
    create_app(str(path))
    conn = sqlite3.connect(path)
    conn.executescript("""
        INSERT INTO day_marks (date, sticker, color) VALUES ('2026-11-01', '', 'yellow'), ('2026-11-02', '🎂', 'pink');
        DROP TABLE diaries;
    """)
    conn.commit()
    conn.close()
    c = create_app(str(path)).test_client()
    assert c.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()["marks"] == [{"date": "2026-11-02", "sticker": "🎂"}]
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT COUNT(*) FROM day_marks WHERE color != ''").fetchone()[0] == 0
    assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'diaries'").fetchone()   # 일기 표가 새로 생긴다
    conn.close()


# ================================================================ 화면
def test_top_bar_has_care_diary_search_and_removed_features_are_gone(client):
    html = client.get("/").get_data(as_text=True)
    for needle in ('id="btn-care"', 'popovertarget="care-menu"', 'id="care-menu"', 'id="btn-diary"', 'id="btn-search"', 'id="btn-categories"'):
        assert needle in html
    assert 'id="btn-stats"' not in html and '>돌아보기<' not in html                   # 시간 돌아보기는 뺐다
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    def js(name):
        with open(os.path.join(root, "static", "js", name), encoding="utf-8") as f:
            return f.read()
    assert not os.path.exists(os.path.join(root, "static", "js", "weekly.js"))
    assert not os.path.exists(os.path.join(root, "static", "js", "stats.js"))
    settings = js("settings.js")
    assert "'생활'" not in settings and "onOpenHabits" not in settings and "주마다 한 걸음" not in settings   # 습관·기념일은 '챙기기'로
    assert "'백업 · 되살리기…'" in settings and "openThemePicker" in settings
    main = js("main.js")
    assert "'루틴'" in main and "'습관'" in main and "'기념일'" in main and "e.code === 'Slash'" in main
    assert "형광펜" not in js("decor.js").split("0.14.0에서 뺐다")[1]
    assert client.get("/api/stats?start=2026-11-01&end=2026-11-08").status_code == 404


def test_demo_has_diaries_and_search_finds_them(tmp_path):
    from datetime import date

    import demo
    app = create_app(str(tmp_path / "demo.db"), demo_mode=True)
    demo.seed_demo(app, today=date(2026, 11, 20))
    c = app.test_client()
    assert c.get("/api/diaries").get_json()["total"] >= 2
    res = c.get("/api/search?q=텀프로젝트&today=2026-11-20").get_json()
    assert {g["kind"] for g in res["groups"]} >= {"event", "project", "diary"}


# ================================================================ 0.14.1: 창을 다시 그려도 알림 상자가 사라지지 않게
def test_dialogs_keep_the_toast_when_redrawn():
    """0.14.0: 테마 창에서 화면 모드를 바꾸면 알림(#toast)이 그 창 안으로 옮겨진 채 창이 다시 그려져서 함께 지워졌고,
    그 뒤로 알림을 띄우는 모든 곳(목표 저장 등)에서 'box.parentElement' 오류가 났다."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    folder = os.path.join(root, "static", "js")
    for name in os.listdir(folder):
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            code = f.read()
        if name != "utils.js":                                       # fillDialog 자기 자신은 빼고
            assert "dialog.replaceChildren(" not in code, name       # 창은 fillDialog()로 다시 그린다
    with open(os.path.join(folder, "utils.js"), encoding="utf-8") as f:
        utils = f.read()
    assert "export function fillDialog" in utils and "querySelector(':scope > #toast')" in utils
    assert "if (!box) {" in utils[utils.index("export function toast"):]   # 그래도 없으면 새로 만든다
