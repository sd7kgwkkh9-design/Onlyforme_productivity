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
def test_create_item_with_and_without_time(client):
    timed = make_item(client, title="컴구 수업", start_time="09:00")
    untimed = make_item(client, title="장보기")
    assert timed["start_time"] == "09:00"
    assert untimed["start_time"] is None
    assert untimed["category"]["name"] == "미분류"

    day = occurrences(client, "2026-11-05", "2026-11-06")
    # 시간 없는 일정이 먼저, 그다음 시간순
    assert [o["title"] for o in day] == ["장보기", "컴구 수업"]


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
