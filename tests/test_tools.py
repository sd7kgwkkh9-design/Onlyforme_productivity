"""7·8차 기능 API 테스트: 루틴·루틴 기록, 기록지, D-day, 옮기기/복사, 시간 돌아보기, 빠른 입력, 예전 DB 이어 쓰기"""

import sqlite3

from app import create_app


def post(client, path, body, status=201):
    res = client.post(path, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def make_item(client, **kw):
    return post(client, "/api/items", {"title": "할 일", "dates": ["2026-11-05"], **kw})


def make_category(client, name="운동", color="#3FA66B"):
    return post(client, "/api/categories", {"name": name, "color": color})


# ---------------------------------------------------------------- 루틴 (8차: 이모지 + 루틴 기록)
def make_routine(client, name="운동", emoji="🏃"):
    return post(client, "/api/routines", {"name": name, "emoji": emoji})


def make_log(client, routine_id, date="2026-11-05", **kw):
    return post(client, "/api/routine-logs", {"routine_id": routine_id, "date": date, **kw})


def test_routine_needs_one_emoji(client):
    r = make_routine(client, "운동", "🏃‍♀️")            # 여러 글자로 된 이모지도 하나로 인정
    assert r["emoji"] == "🏃‍♀️" and r["last_date"] is None and r["log_count"] == 0
    post(client, "/api/routines", {"name": "독서", "emoji": ""}, status=400)
    post(client, "/api/routines", {"name": "독서", "emoji": "책"}, status=400)    # 글자는 안 됨
    post(client, "/api/routines", {"name": "독서", "emoji": "📖 📖"}, status=400)
    post(client, "/api/routines", {"name": "운동", "emoji": "💪"}, status=400)   # 같은 이름


def test_routine_logs_crud_order_and_last_date(client):
    run = make_routine(client)
    a = make_log(client, run["id"], "2026-11-02", start_time="07:00", end_time="07:40", memo="풀업 5세트")
    make_log(client, run["id"], "2026-10-28")
    assert a["routine"] == {"id": run["id"], "name": "운동", "emoji": "🏃"} and a["memo"] == "풀업 5세트"
    post(client, "/api/routine-logs", {"routine_id": run["id"], "date": "2026-11-03", "start_time": "09:00", "end_time": "08:00"}, status=400)
    post(client, "/api/routine-logs", {"routine_id": 999, "date": "2026-11-03"}, status=404)

    def last(day):
        return client.get(f"/api/routines?date={day}").get_json()[0]["last_date"]

    assert last("2026-11-04") == "2026-11-02"
    assert last("2026-11-01") == "2026-10-28"   # 보고 있는 날짜 기준
    assert last("2026-10-01") is None

    # 같은 날 안에서는 시간 있는 기록 → 시간순, 시간 없는 기록은 뒤로
    read = make_routine(client, "독서", "📖")
    make_log(client, read["id"], "2026-11-02", memo="시간 없음")
    make_log(client, read["id"], "2026-11-02", start_time="06:00")
    day = client.get("/api/routine-logs?start=2026-11-02&end=2026-11-03").get_json()
    assert [(x["routine"]["name"], x["start_time"]) for x in day] == [("독서", "06:00"), ("운동", "07:00"), ("독서", None)]

    # 끌어서 날짜만 옮기기 (보낸 칸만 바뀜)
    res = client.put(f"/api/routine-logs/{a['id']}", json={"date": "2026-11-06"})
    moved = res.get_json()
    assert moved["date"] == "2026-11-06" and moved["start_time"] == "07:00" and moved["memo"] == "풀업 5세트"
    res = client.put(f"/api/routine-logs/{a['id']}", json={"start_time": None, "end_time": None, "memo": ""})
    assert res.get_json()["start_time"] is None

    assert client.delete(f"/api/routine-logs/{a['id']}").status_code == 200
    assert client.get(f"/api/routines?date=2026-11-30").get_json()[0]["log_count"] == 1


def test_routine_logs_are_separate_from_schedules(client):
    run = make_routine(client)
    make_log(client, run["id"], "2026-11-05", start_time="07:00", end_time="08:00")
    assert client.get("/api/occurrences?start=2026-11-01&end=2026-12-01").get_json() == []   # 일정 목록에는 없음
    assert client.post("/api/items", json={"title": "운동", "routine_id": run["id"], "dates": ["2026-11-05"]}).get_json().get("routine_id") is None


def test_routine_order_rename_and_delete_with_logs(client):
    a = make_routine(client, "독서", "📖")
    b = make_routine(client, "게임", "🎮")
    assert client.put("/api/routines/order", json={"ids": [b["id"], a["id"]]}).status_code == 200
    assert [x["name"] for x in client.get("/api/routines").get_json()] == ["게임", "독서"]
    assert client.put("/api/routines/order", json={"ids": [a["id"]]}).status_code == 409

    make_log(client, a["id"])
    make_log(client, a["id"], "2026-11-06")
    res = client.put(f"/api/routines/{a['id']}", json={"name": "책 읽기", "emoji": "📚"})
    assert res.get_json()["name"] == "책 읽기"
    logs = client.get("/api/routine-logs?start=2026-11-01&end=2026-12-01").get_json()
    assert {x["routine"]["name"] for x in logs} == {"책 읽기"} and logs[0]["routine"]["emoji"] == "📚"  # 이름이 바뀌어도 기록 유지

    res = client.delete(f"/api/routines/{a['id']}")
    assert res.get_json()["logs_deleted"] == 2
    assert client.get("/api/routine-logs?start=2026-11-01&end=2026-12-01").get_json() == []


# ---------------------------------------------------------------- 기록지
def test_notes_main_banner_and_order(client):
    first = post(client, "/api/notes", {"title": "힘들 때", "body": "천천히 가도 괜찮아", "banner": "오늘도 한 걸음"})
    second = post(client, "/api/notes", {"title": "잊지 말 것"})
    assert first["is_main"] is True and second["is_main"] is False   # 첫 메모가 메인

    ov = client.get("/api/overview?today=2026-11-04").get_json()
    assert ov["banner"] == {"note_id": first["id"], "text": "오늘도 한 걸음"}

    # 부분 저장 (자동 저장)
    res = client.put(f"/api/notes/{second['id']}", json={"body": "가족에게 전화"})
    assert res.get_json()["body"] == "가족에게 전화" and res.get_json()["title"] == "잊지 말 것"

    # 메인 바꾸기 → 배너는 새 메인의 글귀 (비어 있으면 없음)
    client.put(f"/api/notes/{second['id']}/main")
    assert client.get("/api/overview").get_json()["banner"] is None
    client.put(f"/api/notes/{second['id']}", json={"banner": "끝까지\n해 보자"})
    assert client.get("/api/overview").get_json()["banner"]["text"] == "끝까지\n해 보자"

    client.put("/api/notes/order", json={"ids": [second["id"], first["id"]]})
    assert [n["id"] for n in client.get("/api/notes").get_json()] == [second["id"], first["id"]]

    # 메인을 지우면 맨 위 메모가 메인
    client.delete(f"/api/notes/{second['id']}")
    notes = client.get("/api/notes").get_json()
    assert len(notes) == 1 and notes[0]["is_main"] is True


def test_note_limits(client):
    post(client, "/api/notes", {"banner": "가" * 201}, status=400)
    post(client, "/api/notes", {"title": 3}, status=400)


# ---------------------------------------------------------------- D-day
def test_dday_overview_and_keep_on_edit(client):
    exam = make_item(client, title="선형대수 기말", dates=["2026-11-02", "2026-12-10"], dday=True)
    make_item(client, title="레포트", dates=["2026-11-06"], dday=True)
    make_item(client, title="지난 일", dates=["2026-10-01"], dday=True)
    make_item(client, title="보통 일정", dates=["2026-11-05"])

    ddays = client.get("/api/overview?today=2026-11-04").get_json()["ddays"]
    assert [(d["title"], d["date"], d["days_left"]) for d in ddays] == [
        ("레포트", "2026-11-06", 2), ("선형대수 기말", "2026-12-10", 36),
    ]

    # dday를 안 보내고 수정하면 그대로 유지 (예전 화면에서 저장해도 표시가 사라지지 않게)
    client.put(f"/api/items/{exam['id']}", json={"title": "기말고사", "dates": ["2026-12-10"]})
    assert client.get(f"/api/items/{exam['id']}").get_json()["dday"] is True
    client.put(f"/api/items/{exam['id']}", json={"title": "기말고사", "dates": ["2026-12-10"], "dday": False})
    assert client.get(f"/api/items/{exam['id']}").get_json()["dday"] is False


def test_single_date_edit_keeps_dday(client):
    item = make_item(client, title="시험", dates=["2026-11-05", "2026-11-06"], dday=True)
    res = client.put(f"/api/items/{item['id']}", json={"title": "시험(1일차)", "dates": ["2026-11-05"], "scope": "single", "date": "2026-11-05"})
    split = res.get_json()
    assert split["id"] != item["id"] and split["dday"] is True


# ---------------------------------------------------------------- 옮기기 / 복사
def test_move_one_date(client):
    item = make_item(client, title="스터디", dates=["2026-11-05", "2026-11-12"])
    res = client.post(f"/api/items/{item['id']}/move", json={"from": "2026-11-05", "to": "2026-11-07"})
    assert res.status_code == 200 and res.get_json()["dates"] == ["2026-11-07", "2026-11-12"]

    assert client.post(f"/api/items/{item['id']}/move", json={"from": "2026-11-07", "to": "2026-11-12"}).status_code == 409
    assert client.post(f"/api/items/{item['id']}/move", json={"from": "2026-11-01", "to": "2026-11-02"}).status_code == 400


def test_copy_item(client):
    cat = make_category(client, "과제", "#E5534B")
    item = make_item(client, title="레포트", category_id=cat["id"], start_time="10:00", end_time="12:00", memo="3장", dday=True)
    copy = post(client, f"/api/items/{item['id']}/copy", {"dates": ["2026-11-20"]})
    assert copy["id"] != item["id"]
    assert (copy["title"], copy["memo"], copy["category"]["id"], copy["start_time"], copy["end_time"], copy["dday"], copy["dates"]) == (
        "레포트", "3장", cat["id"], "10:00", "12:00", True, ["2026-11-20"])
    assert client.get(f"/api/items/{item['id']}").get_json()["dates"] == ["2026-11-05"]  # 원래 일정은 그대로


# ---------------------------------------------------------------- 시간 돌아보기
def test_stats(client):
    study = make_category(client, "공부", "#3D6FD9")
    work = make_category(client, "알바", "#3FA66B")
    run = make_routine(client)
    make_item(client, title="회로 공부", category_id=study["id"], dates=["2026-11-02", "2026-11-03"], start_time="09:00", end_time="10:30")
    make_item(client, title="카페", category_id=work["id"], dates=["2026-11-06"], start_time="18:00", end_time="22:00")
    make_item(client, title="다음 주", category_id=study["id"], dates=["2026-11-09"], start_time="09:00", end_time="10:00")
    make_log(client, run["id"], "2026-11-03", start_time="07:00", end_time="07:40")
    make_log(client, run["id"], "2026-11-05")                        # 시간 없음 → 횟수만

    s = client.get("/api/stats?start=2026-11-01&end=2026-11-08").get_json()
    assert s["schedule_minutes"] == 90 * 2 + 240 and s["routine_minutes"] == 40
    assert s["total_minutes"] == 90 * 2 + 240 + 40
    assert s["item_count"] == 3 and s["timed_count"] == 3 and s["log_count"] == 2
    by_name = {c["name"]: c for c in s["categories"]}
    assert by_name["알바"]["minutes"] == 240 and by_name["공부"]["minutes"] == 180 and by_name["공부"]["count"] == 2
    assert s["categories"][0]["name"] == "알바"                       # 시간 많은 순
    assert s["routines"] == [{"id": run["id"], "name": "운동", "emoji": "🏃", "count": 2, "minutes": 40}]
    assert s["days"][1] == {"date": "2026-11-03", "by_category": {str(study["id"]): 90}, "routine": 40}


# ---------------------------------------------------------------- 빠른 입력
def test_parse_endpoint_uses_categories_and_device_today(client):
    make_category(client, "과제", "#E5534B")
    res = client.get("/api/parse", query_string={"text": "내일 3시 레포트 #과제 !", "today": "2026-11-04"})
    r = res.get_json()
    assert r["dates"] == ["2026-11-05"] and r["start_time"] == "15:00" and r["category"]["name"] == "과제" and r["dday"]

    v = client.get("/api/version").get_json()["version"]
    client.get("/api/parse", query_string={"text": "아무거나", "today": "2026-11-04"})
    assert client.get("/api/version").get_json()["version"] == v   # 해석만 하면 저장된 것이 없으니 그대로
    assert client.get("/api/parse", query_string={"text": "x" * 301}).status_code == 400


# ---------------------------------------------------------------- 예전 DB 이어 쓰기
OLD_V6 = """
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
                        category_id INTEGER NOT NULL REFERENCES categories(id), start_time TEXT, end_time TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')));
    CREATE TABLE item_dates (item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, date TEXT NOT NULL,
                             position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (item_id, date));
    INSERT INTO categories (name, color, is_default) VALUES ('미분류', '#9AA0AA', 1);
    INSERT INTO items (title, category_id) VALUES ('6차 때 넣은 일정', 1);
    INSERT INTO item_dates (item_id, date, position) VALUES (1, '2026-11-05', 1);
"""


def test_v6_database_gets_new_columns_and_keeps_items(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(OLD_V6)
    conn.commit()
    conn.close()

    c = create_app(str(path)).test_client()
    item = c.get("/api/items/1").get_json()
    assert item["title"] == "6차 때 넣은 일정" and item["dday"] is False and "routine_id" not in item
    assert c.get("/api/routines").get_json() == [] and c.get("/api/notes").get_json() == []
    make_routine(c)  # 새 모양의 루틴 표가 만들어져 있다


def test_v7_routine_schedules_move_to_routine_logs(tmp_path):
    """7차에서 루틴 버튼으로 넣은 일정은 8차에서 루틴 기록으로 옮겨지고, 일정 목록에서는 빠진다."""
    path = tmp_path / "v7.db"
    conn = sqlite3.connect(path)
    conn.executescript(OLD_V6 + """
        ALTER TABLE items ADD COLUMN dday INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE routines (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                               category_id INTEGER NOT NULL REFERENCES categories(id), position INTEGER NOT NULL DEFAULT 0);
        ALTER TABLE items ADD COLUMN routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL;
        INSERT INTO routines (name, category_id, position) VALUES ('운동', 1, 1), ('영어 단어', 1, 2), ('뜨개질', 1, 3);
        INSERT INTO items (title, memo, category_id, start_time, end_time, routine_id) VALUES ('운동', '5km', 1, '07:00', '08:00', 1);
        INSERT INTO item_dates (item_id, date, position) VALUES (2, '2026-11-03', 1), (2, '2026-11-04', 1);
        INSERT INTO items (title, category_id, routine_id) VALUES ('단어 30개', 1, 2);
        INSERT INTO item_dates (item_id, date, position) VALUES (3, '2026-11-04', 2);
        INSERT INTO items (title, category_id, dday) VALUES ('기말고사', 1, 1);
        INSERT INTO item_dates (item_id, date, position) VALUES (4, '2026-12-10', 1);
    """)
    conn.commit()
    conn.close()

    c = create_app(str(path)).test_client()
    routines = c.get("/api/routines").get_json()
    assert [(r["name"], r["emoji"], r["log_count"]) for r in routines] == [("운동", "🏃", 2), ("영어 단어", "🔤", 1), ("뜨개질", "⭐", 0)]
    logs = c.get("/api/routine-logs?start=2026-11-01&end=2026-12-01").get_json()
    assert [(x["date"], x["routine"]["name"], x["start_time"], x["memo"]) for x in logs] == [
        ("2026-11-03", "운동", "07:00", "5km"), ("2026-11-04", "운동", "07:00", "5km"), ("2026-11-04", "영어 단어", None, ""),
    ]
    titles = [o["title"] for o in c.get("/api/occurrences?start=2026-11-01&end=2027-01-01").get_json()]
    assert titles == ["6차 때 넣은 일정", "기말고사"]           # 루틴 일정은 빠지고 나머지는 그대로
    assert c.get("/api/items/4").get_json()["dday"] is True
    make_log(c, routines[2]["id"], "2026-11-05")                  # 새 기록도 잘 들어간다
