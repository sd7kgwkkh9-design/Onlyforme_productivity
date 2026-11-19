"""0.12.1 — 첫 화면에 실어 보내기(boot) · 읽기 응답의 변경 번호"""

import json
import re
from datetime import date, datetime, timedelta

import pytest

import app as app_module
from api_tools import month_range

BOOT_RE = re.compile(r'<script type="application/json" id="boot">(.*?)</script>', re.DOTALL)


def boot_of(client, url="/"):
    html = client.get(url).get_data(as_text=True)
    m = BOOT_RE.search(html)
    assert m, "첫 화면에 boot 내용이 없다"
    return json.loads(m.group(1))


def kst_today():
    return datetime.now(app_module.KST).date()


@pytest.fixture
def filled(client):
    client.post("/api/items", json={"title": "스터디", "dates": [kst_today().isoformat()]})
    client.post("/api/items", json={"title": "할 일 하나"})
    client.post("/api/notes", json={"title": "메모", "content": "내용"})
    return client


def test_month_range_matches_screen():
    """화면(main.js monthRange, fixedWeekCount: false)과 같은 기간 — 일요일 시작"""
    assert month_range(date(2026, 11, 1)) == (date(2026, 11, 1), date(2026, 12, 6))    # 1일이 일요일
    assert month_range(date(2026, 12, 1)) == (date(2026, 11, 29), date(2027, 1, 3))   # 해를 넘김
    assert month_range(date(2026, 2, 1)) == (date(2026, 2, 1), date(2026, 3, 1))      # 4주짜리 달
    for start, end in (month_range(date(y, m, 1)) for y in (2026, 2027) for m in range(1, 13)):
        assert start.weekday() == 6 and end.weekday() == 6 and (end - start).days in (28, 35, 42)


def test_boot_payload_is_exactly_what_the_api_returns(filled):
    """페이지에 실린 내용 = 같은 주소의 API 응답 (화면은 둘을 구별하지 않고 쓴다)"""
    boot = boot_of(filled)
    today = kst_today()
    start, end = month_range(today.replace(day=1))
    expected = [
        f"/api/calendar?start={start}&end={end}",
        f"/api/day/{today}",
        f"/api/overview?today={today}",
        "/api/inbox",
        f"/api/holidays?start={start.year}-01-01&end={start.year + 1}-01-01",
    ]
    for url in expected:
        assert url in boot["get"], url
        assert boot["get"][url] == filled.get(url).get_json(), url
    assert boot["v"] == filled.get("/api/version").get_json()["version"]
    assert any(i["title"] == "스터디" for i in boot["get"][f"/api/day/{today}"]["items"])


def test_boot_follows_the_address(client):
    """?month= ?week= ?day= 로 연 화면에 맞는 기간을 싣는다. 해를 넘기면 공휴일도 두 해"""
    get = boot_of(client, "/?month=2026-12&day=2026-12-24")["get"]
    assert "/api/calendar?start=2026-11-29&end=2027-01-03" in get
    assert "/api/day/2026-12-24" in get
    assert "/api/holidays?start=2027-01-01&end=2028-01-01" in get
    assert {"date": "2027-01-01", "name": get["/api/holidays?start=2027-01-01&end=2028-01-01"][0]["name"]} in \
        get["/api/holidays?start=2027-01-01&end=2028-01-01"]

    get = boot_of(client, "/?week=2026-11-18")["get"]   # 수요일 → 그 주 일요일부터
    assert "/api/calendar?start=2026-11-15&end=2026-11-22" in get

    get = boot_of(client, "/?day=2027-03-10")["get"]    # 날짜만 있으면 그 달
    assert "/api/calendar?start=2027-02-28&end=2027-04-04" in get


def test_boot_ignores_broken_addresses(client):
    today = kst_today()
    get = boot_of(client, "/?month=abc&day=2026-13-45&week=x")["get"]
    start, end = month_range(today.replace(day=1))
    assert f"/api/calendar?start={start}&end={end}" in get
    assert f"/api/day/{today}" in get


def test_boot_cannot_break_out_of_the_script_tag(client):
    """메모 내용에 </script>가 있어도 페이지 안에서 코드로 실행되지 않는다"""
    evil = "</script><script>alert(1)</script><!--"
    client.post("/api/notes", json={"title": evil, "content": evil})
    html = client.get("/").get_data(as_text=True)
    assert "<script>alert(1)" not in html
    boot = boot_of(client)
    assert any(n["title"] == evil for n in boot["get"]["/api/inbox"]["notes"])


def test_page_with_data_is_not_stored_and_still_opens_when_boot_fails(client, monkeypatch):
    assert client.get("/").headers["Cache-Control"] == "no-store"

    def broken(*args):
        raise RuntimeError("boom")
    monkeypatch.setattr(app_module.api_tools, "boot_data", broken)
    res = client.get("/")
    assert res.status_code == 200 and 'id="boot"' not in res.get_data(as_text=True)


def test_locked_out_visitor_gets_no_boot(tmp_path):
    import auth
    from app import create_app
    auth._fails.clear()
    auth.save_password(str(tmp_path), "secret1")
    c = create_app(str(tmp_path / "t.db")).test_client()
    res = c.get("/")
    assert res.status_code == 302 and b'id="boot"' not in res.data


def test_holidays_endpoint_unchanged(client):
    """공휴일 목록을 함수로 뺀 뒤에도 응답은 그대로 (해를 넘는 기간 포함)"""
    res = client.get("/api/holidays?start=2026-12-20&end=2027-01-10").get_json()
    assert [h["date"] for h in res] == ["2026-12-25", "2027-01-01"]
    assert client.get("/api/holidays?start=2026-12-20&end=2027-01-10").headers["Cache-Control"] == "private, max-age=86400"


def test_day_endpoint_unchanged(filled):
    today = kst_today()
    data = filled.get(f"/api/day/{today}").get_json()
    assert set(data) == {"items", "logs", "routines", "mark", "classes", "annivs"}   # 0.13.0: 시간표·기념일
    assert filled.get(f"/api/day/{today + timedelta(days=400)}").get_json()["items"] == []
