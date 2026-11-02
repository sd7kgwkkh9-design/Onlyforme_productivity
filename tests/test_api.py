"""API 동작 테스트 — 실행: python -m pytest"""


def make_category(client, name="수업", color="#3D6FD9"):
    res = client.post("/api/categories", json={"name": name, "color": color})
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def make_item(client, **overrides):
    payload = {"title": "할 일", "dates": ["2026-11-05"], **overrides}
    res = client.post("/api/items", json=payload)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def occurrences(client, start="2026-11-01", end="2026-12-01"):
    res = client.get(f"/api/occurrences?start={start}&end={end}")
    assert res.status_code == 200, res.get_json()
    return res.get_json()


# ---------------------------------------------------------------- 카테고리
def test_default_category_exists_and_is_protected(client):
    cats = client.get("/api/categories").get_json()
    assert len(cats) == 1
    default = cats[0]
    assert default["name"] == "미분류" and default["is_default"] is True

    assert client.delete(f"/api/categories/{default['id']}").status_code == 403
    res = client.put(f"/api/categories/{default['id']}", json={"name": "x", "color": "#000000"})
    assert res.status_code == 403


def test_category_crud_and_validation(client):
    cat = make_category(client, "과제", "#e5534b")
    assert cat["color"] == "#E5534B"  # 대문자로 통일

    assert client.post("/api/categories", json={"name": "과제", "color": "#000000"}).status_code == 400
    assert client.post("/api/categories", json={"name": "", "color": "#000000"}).status_code == 400
    assert client.post("/api/categories", json={"name": "a", "color": "red"}).status_code == 400

    res = client.put(f"/api/categories/{cat['id']}", json={"name": "레포트", "color": "#3FA66B"})
    assert res.status_code == 200 and res.get_json()["name"] == "레포트"


def test_deleting_category_moves_items_to_default(client):
    cat = make_category(client)
    item = make_item(client, category_id=cat["id"])

    res = client.delete(f"/api/categories/{cat['id']}")
    assert res.status_code == 200 and res.get_json()["moved"] == 1

    moved = client.get(f"/api/items/{item['id']}").get_json()
    assert moved["category"]["name"] == "미분류"


# ---------------------------------------------------------------- 일정
def test_create_item_with_start_end_or_no_time(client):
    both = make_item(client, title="컴구 수업", start_time="09:00", end_time="10:30")
    start_only = make_item(client, title="회의", start_time="14:00")
    end_only = make_item(client, title="과제 마감", end_time="23:59")
    none = make_item(client, title="장보기")

    assert (both["start_time"], both["end_time"]) == ("09:00", "10:30")
    assert (start_only["start_time"], start_only["end_time"]) == ("14:00", None)
    assert (end_only["start_time"], end_only["end_time"]) == (None, "23:59")
    assert (none["start_time"], none["end_time"]) == (None, None)
    assert none["category"]["name"] == "미분류"

    # 같은 날 안에서는 '올린 순서' 그대로
    day = occurrences(client, "2026-11-05", "2026-11-06")
    assert [o["title"] for o in day] == ["컴구 수업", "회의", "과제 마감", "장보기"]
    assert day[0]["end_time"] == "10:30"


def test_end_time_must_be_after_start(client):
    res = client.post("/api/items", json={"title": "a", "start_time": "10:00", "end_time": "09:00"})
    assert res.status_code == 400
    res = client.post("/api/items", json={"title": "a", "start_time": "10:00", "end_time": "10:00"})
    assert res.status_code == 400
    assert client.post("/api/items", json={"title": "a", "end_time": "24:00"}).status_code == 400


def test_item_validation(client):
    assert client.post("/api/items", json={"title": "  "}).status_code == 400
    assert client.post("/api/items", json={"title": "a", "start_time": "25:00"}).status_code == 400
    assert client.post("/api/items", json={"title": "a", "dates": ["2026-02-30"]}).status_code == 400
    assert client.post("/api/items", json={"title": "a", "category_id": 999}).status_code == 404
    assert client.post("/api/items", data="not json").status_code == 400


def test_multi_date_item_shows_on_each_date(client):
    item = make_item(client, title="알바", dates=["2026-11-19", "2026-11-05", "2026-11-12", "2026-11-05"])
    assert item["dates"] == ["2026-11-05", "2026-11-12", "2026-11-19"]  # 중복 제거 + 정렬

    occ = occurrences(client)
    assert [o["date"] for o in occ] == ["2026-11-05", "2026-11-12", "2026-11-19"]
    assert all(o["date_count"] == 3 for o in occ)


def test_undated_items(client):
    undated = make_item(client, title="언젠가 읽을 책", dates=[])
    make_item(client, title="날짜 있음")

    lst = client.get("/api/items/undated").get_json()
    assert [i["title"] for i in lst] == ["언젠가 읽을 책"]

    # 날짜를 정해 주면 기한 미정 목록에서 빠진다.
    client.put(f"/api/items/{undated['id']}", json={"title": "언젠가 읽을 책", "dates": ["2026-11-20"]})
    assert client.get("/api/items/undated").get_json() == []


def test_update_scope_all(client):
    item = make_item(client, title="알바", dates=["2026-11-05", "2026-11-12"])
    res = client.put(
        f"/api/items/{item['id']}",
        json={"title": "알바(시급 인상)", "dates": ["2026-11-05", "2026-11-12"], "scope": "all", "date": "2026-11-05"},
    )
    assert res.status_code == 200
    assert {o["title"] for o in occurrences(client)} == {"알바(시급 인상)"}


def test_update_scope_single_splits_item(client):
    item = make_item(client, title="알바", dates=["2026-11-05", "2026-11-12", "2026-11-19"])
    res = client.put(
        f"/api/items/{item['id']}",
        json={"title": "알바 대타", "start_time": "18:00", "dates": ["2026-11-12"], "scope": "single", "date": "2026-11-12"},
    )
    assert res.status_code == 200
    new = res.get_json()
    assert new["id"] != item["id"] and new["dates"] == ["2026-11-12"]

    original = client.get(f"/api/items/{item['id']}").get_json()
    assert original["dates"] == ["2026-11-05", "2026-11-19"] and original["title"] == "알바"

    by_date = {o["date"]: o["title"] for o in occurrences(client)}
    assert by_date == {"2026-11-05": "알바", "2026-11-12": "알바 대타", "2026-11-19": "알바"}


def test_update_scope_single_requires_matching_date(client):
    item = make_item(client, dates=["2026-11-05", "2026-11-12"])
    res = client.put(
        f"/api/items/{item['id']}",
        json={"title": "x", "dates": ["2026-11-06"], "scope": "single", "date": "2026-11-06"},
    )
    assert res.status_code == 400


def test_delete_scope_single_and_all(client):
    item = make_item(client, dates=["2026-11-05", "2026-11-12"])

    res = client.delete(f"/api/items/{item['id']}?scope=single&date=2026-11-05")
    assert res.status_code == 200
    assert client.get(f"/api/items/{item['id']}").get_json()["dates"] == ["2026-11-12"]

    # 마지막 남은 날짜를 '이 날만' 지우면 일정 자체가 지워진다.
    client.delete(f"/api/items/{item['id']}?scope=single&date=2026-11-12")
    assert client.get(f"/api/items/{item['id']}").status_code == 404

    other = make_item(client, dates=["2026-11-05", "2026-11-12"])
    client.delete(f"/api/items/{other['id']}")
    assert occurrences(client) == []


def test_occurrence_range_validation(client):
    assert client.get("/api/occurrences?start=2026-11-10&end=2026-11-01").status_code == 400
    assert client.get("/api/occurrences?start=bad&end=2026-11-01").status_code == 400
    # FullCalendar가 보내는 시간대 포함 형식도 받아야 한다.
    res = client.get("/api/occurrences?start=2026-11-01T00:00:00%2B09:00&end=2026-12-01T00:00:00%2B09:00")
    assert res.status_code == 200


# ---------------------------------------------------------------- 공휴일
def test_holidays(client):
    res = client.get("/api/holidays?start=2026-09-01&end=2026-10-01")
    assert res.status_code == 200
    by_date = {h["date"]: h["name"] for h in res.get_json()}
    assert "2026-09-25" in by_date and "추석" in by_date["2026-09-25"]  # 음력 명절
    assert all("2026-09-01" <= d < "2026-10-01" for d in by_date)

    # 연도가 걸친 기간
    res = client.get("/api/holidays?start=2026-12-20&end=2027-01-10")
    dates = [h["date"] for h in res.get_json()]
    assert "2026-12-25" in dates and "2027-01-01" in dates


# ---------------------------------------------------------------- 하루 안의 순서
def titles_on(client, day):
    nxt = f"{day[:8]}{int(day[8:]) + 1:02d}"
    return [o["title"] for o in occurrences(client, day, nxt)]


def test_reorder_day(client):
    a = make_item(client, title="A")
    b = make_item(client, title="B")
    c = make_item(client, title="C")
    assert titles_on(client, "2026-11-05") == ["A", "B", "C"]

    res = client.put("/api/days/2026-11-05/order", json={"item_ids": [c["id"], a["id"], b["id"]]})
    assert res.status_code == 200
    assert titles_on(client, "2026-11-05") == ["C", "A", "B"]

    # 새로 추가한 일정은 맨 아래로
    make_item(client, title="D")
    assert titles_on(client, "2026-11-05") == ["C", "A", "B", "D"]


def test_reorder_rejects_wrong_list(client):
    a = make_item(client, title="A")
    make_item(client, title="B")
    res = client.put("/api/days/2026-11-05/order", json={"item_ids": [a["id"]]})  # B가 빠짐
    assert res.status_code == 409
    res = client.put("/api/days/2026-11-05/order", json={"item_ids": "x"})
    assert res.status_code == 400


def test_order_is_per_day_and_kept_on_edit(client):
    multi = make_item(client, title="알바", dates=["2026-11-05", "2026-11-12"])
    other = make_item(client, title="수업", dates=["2026-11-05", "2026-11-12"])
    client.put("/api/days/2026-11-05/order", json={"item_ids": [other["id"], multi["id"]]})

    # 11/5만 순서가 바뀌고 11/12는 그대로
    assert titles_on(client, "2026-11-05") == ["수업", "알바"]
    assert titles_on(client, "2026-11-12") == ["알바", "수업"]

    # '모든 날짜' 수정: 날짜가 그대로면 순서도 그대로
    client.put(f"/api/items/{multi['id']}", json={
        "title": "알바(수정)", "dates": ["2026-11-05", "2026-11-12"], "scope": "all"})
    assert titles_on(client, "2026-11-05") == ["수업", "알바(수정)"]

    # '이 날만' 수정: 떼어 낸 새 일정이 원래 자리를 이어받음
    client.put(f"/api/items/{multi['id']}", json={
        "title": "알바 대타", "dates": ["2026-11-12"], "scope": "single", "date": "2026-11-12"})
    assert titles_on(client, "2026-11-12") == ["알바 대타", "수업"]


# ---------------------------------------------------------------- 예전 DB 변환
def test_old_database_is_migrated(tmp_path):
    """1차 버전(end_time, position 칸이 없던 때)으로 만든 DB도 그대로 열리고 데이터가 남아야 한다."""
    import sqlite3

    from app import create_app

    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                                 color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
                            memo TEXT NOT NULL DEFAULT '', category_id INTEGER NOT NULL,
                            start_time TEXT, created_at TEXT NOT NULL DEFAULT '');
        CREATE TABLE item_dates (item_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (item_id, date));
        INSERT INTO categories (name, color, is_default) VALUES ('미분류', '#9AA0AA', 1);
        INSERT INTO items (title, category_id, start_time) VALUES ('먼저 올린 것', 1, '15:00');
        INSERT INTO items (title, category_id, start_time) VALUES ('나중에 올린 것', 1, NULL);
        INSERT INTO item_dates VALUES (1, '2026-11-05'), (2, '2026-11-05');
    """)
    conn.commit()
    conn.close()

    client = create_app(str(path)).test_client()
    day = occurrences(client, "2026-11-05", "2026-11-06")
    assert [o["title"] for o in day] == ["먼저 올린 것", "나중에 올린 것"]
    assert day[0]["start_time"] == "15:00" and day[0]["end_time"] is None

    # 새 기능도 바로 동작
    make_item(client, title="새 일정", end_time="18:00")
    assert titles_on(client, "2026-11-05")[-1] == "새 일정"
