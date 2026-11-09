"""0.9.0 기록지 테스트: 할 일(날짜 없는 일정) 체크, 목표, 한 번에 받기, 반복 일정 저장, 0.8 DB 이어 쓰기"""

import sqlite3

from app import create_app


def post(client, path, body, status=201):
    res = client.post(path, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def put(client, path, body, status=200):
    res = client.put(path, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


# ---------------------------------------------------------------- 할 일 = 날짜 없는 일정 (0.8까지의 '기한 미정')
def test_todo_done_order_and_clear(client):
    a = post(client, "/api/items", {"title": "메일 보내기", "dates": []})
    b = post(client, "/api/items", {"title": "책 반납", "dates": []})
    c = post(client, "/api/items", {"title": "택배 반품", "dates": []})
    assert a["done"] is False and a["done_at"] is None

    done = put(client, f"/api/items/{a['id']}/done", {"done": True})
    assert done["done"] is True and done["done_at"]
    # 안 한 것(새로 넣은 것이 위) → 완료한 것
    assert [t["title"] for t in client.get("/api/items/undated").get_json()] == ["택배 반품", "책 반납", "메일 보내기"]

    # 다시 체크해도 완료 시각은 그대로, 체크 풀기
    assert put(client, f"/api/items/{a['id']}/done", {"done": True})["done_at"] == done["done_at"]
    assert put(client, f"/api/items/{a['id']}/done", {"done": False})["done"] is False
    put(client, f"/api/items/{a['id']}/done", {"done": "yes"}, status=400)

    put(client, f"/api/items/{b['id']}/done", {"done": True})
    put(client, f"/api/items/{c['id']}/done", {"done": True})
    dated = post(client, "/api/items", {"title": "수업", "dates": ["2026-11-10"]})
    put(client, f"/api/items/{dated['id']}/done", {"done": True}, status=400)   # 날짜가 있는 일정은 체크 안 함

    res = client.delete("/api/items/done").get_json()                           # 완료한 할 일 비우기
    assert res["deleted"] == 2
    assert [t["title"] for t in client.get("/api/items/undated").get_json()] == ["메일 보내기"]
    assert client.get(f"/api/items/{dated['id']}").status_code == 200           # 일정은 그대로


def test_giving_a_todo_a_date_makes_it_a_schedule(client):
    t = post(client, "/api/items", {"title": "레포트", "dates": []})
    put(client, f"/api/items/{t['id']}/done", {"done": True})
    item = put(client, f"/api/items/{t['id']}", {"title": "레포트", "dates": ["2026-11-12"]})
    assert item["dates"] == ["2026-11-12"] and item["done"] is False             # 날짜가 생기면 체크는 지워진다
    assert client.get("/api/items/undated").get_json() == []
    assert [o["title"] for o in client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()["items"]] == ["레포트"]


def test_repeat_is_saved_as_one_item_with_many_dates(client):
    """반복 일정은 따로 표를 두지 않고 '날짜 여러 개짜리 일정'으로 저장 → 이 날만/모든 날짜 수정·삭제가 그대로 된다"""
    parsed = client.get("/api/parse?text=매주 월수 9시 컴구 ~11/30&today=2026-11-09").get_json()
    assert parsed["kind"] == "schedule" and len(parsed["dates"]) == 7
    item = post(client, "/api/items", {"title": parsed["title"], "dates": parsed["dates"], "start_time": parsed["start_time"]})
    assert item["dates"][0] == "2026-11-09" and item["dates"][-1] == "2026-11-30"
    client.delete(f"/api/items/{item['id']}?scope=single&date=2026-11-18")       # 하루만 빼기
    assert len(client.get(f"/api/items/{item['id']}").get_json()["dates"]) == 6


# ---------------------------------------------------------------- 목표
def test_goals_crud_done_and_order(client):
    a = post(client, "/api/goals", {"title": "풀업 15개", "due": "2026-12-31", "memo": "주 3회"})
    b = post(client, "/api/goals", {"title": "토익 900점"})
    c = post(client, "/api/goals", {"title": "책 10권", "due": ""})
    assert a["due"] == "2026-12-31" and b["due"] is None and c["due"] is None and a["done"] is False
    post(client, "/api/goals", {"title": "  "}, status=400)
    post(client, "/api/goals", {"title": "x", "due": "2026-02-30"}, status=400)

    # 보낸 칸만 바꾼다
    edited = put(client, f"/api/goals/{b['id']}", {"due": "2027-01-31"})
    assert edited["title"] == "토익 900점" and edited["due"] == "2027-01-31"
    assert put(client, f"/api/goals/{b['id']}", {"due": None})["due"] is None

    put(client, f"/api/goals/{a['id']}", {"done": True})
    titles = [g["title"] for g in client.get("/api/goals").get_json()]
    assert titles == ["토익 900점", "책 10권", "풀업 15개"]                      # 이룬 목표는 뒤로

    # 순서는 아직인 목표들끼리만
    put(client, "/api/goals/order", {"ids": [c["id"], b["id"]]})
    assert [g["title"] for g in client.get("/api/goals").get_json()][:2] == ["책 10권", "토익 900점"]
    put(client, "/api/goals/order", {"ids": [a["id"], b["id"], c["id"]]}, status=409)

    assert client.delete(f"/api/goals/{c['id']}").status_code == 200
    assert client.delete(f"/api/goals/{c['id']}").status_code == 404


def test_goal_due_shows_in_dday_strip(client):
    post(client, "/api/items", {"title": "기말고사", "dates": ["2026-12-10"], "dday": True})
    g = post(client, "/api/goals", {"title": "풀업 15개", "due": "2026-11-30"})
    post(client, "/api/goals", {"title": "기한 없는 목표"})
    post(client, "/api/goals", {"title": "지난 목표", "due": "2026-11-01"})
    ddays = client.get("/api/overview?today=2026-11-09").get_json()["ddays"]
    assert [(d["kind"], d["title"], d["days_left"]) for d in ddays] == [("goal", "풀업 15개", 21), ("item", "기말고사", 31)]
    put(client, f"/api/goals/{g['id']}", {"done": True})                        # 이루면 띠에서 빠진다
    assert [d["title"] for d in client.get("/api/overview?today=2026-11-09").get_json()["ddays"]] == ["기말고사"]


def test_inbox_returns_notes_goals_and_todos_at_once(client):
    post(client, "/api/notes", {"body": "한 줄 메모"})
    post(client, "/api/goals", {"title": "목표"})
    post(client, "/api/items", {"title": "할 일", "dates": []})
    post(client, "/api/items", {"title": "일정", "dates": ["2026-11-10"]})
    inbox = client.get("/api/inbox").get_json()
    assert [n["body"] for n in inbox["notes"]] == ["한 줄 메모"] and inbox["notes"][0]["is_main"] is True
    assert [g["title"] for g in inbox["goals"]] == ["목표"]
    assert [t["title"] for t in inbox["todos"]] == ["할 일"]


def test_parse_endpoint_returns_kind(client):
    get = lambda text: client.get("/api/parse", query_string={"text": text, "today": "2026-11-09"}).get_json()
    assert get("- 생각")["kind"] == "memo"
    goal = get("* 12월까지 풀업 15개")
    assert goal["kind"] == "goal" and goal["due"] == "2026-12-31" and goal["title"] == "풀업 15개"
    assert get("[] 메일")["kind"] == "todo"
    assert get("내일 3시 회의")["kind"] == "schedule"


# ---------------------------------------------------------------- 0.8 DB 이어 쓰기
def test_v8_database_gets_done_column_and_goals_table(tmp_path):
    path = tmp_path / "v8.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
                            category_id INTEGER NOT NULL REFERENCES categories(id), start_time TEXT, end_time TEXT,
                            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), dday INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE item_dates (item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, date TEXT NOT NULL,
                                 position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (item_id, date));
        CREATE TABLE routines (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '⭐', position INTEGER NOT NULL DEFAULT 0);
        INSERT INTO categories (name, color, is_default) VALUES ('미분류', '#9AA0AA', 1);
        INSERT INTO items (title, category_id) VALUES ('기한 미정이던 일', 1);
        INSERT INTO items (title, category_id) VALUES ('날짜 있는 일', 1);
        INSERT INTO item_dates (item_id, date, position) VALUES (2, '2026-11-05', 1);
    """)
    conn.commit()
    conn.close()

    c = create_app(str(path)).test_client()
    todos = c.get("/api/items/undated").get_json()
    assert [(t["title"], t["done"]) for t in todos] == [("기한 미정이던 일", False)]   # 0.8의 기한 미정 = 할 일
    put(c, f"/api/items/{todos[0]['id']}/done", {"done": True})
    assert c.get("/api/goals").get_json() == []
    post(c, "/api/goals", {"title": "새 목표"})
