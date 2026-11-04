"""로그인과 동기화(변경 번호) 테스트"""

import pytest

import auth
from app import create_app


@pytest.fixture(autouse=True)
def reset_lockout():
    auth._fails.clear()
    yield
    auth._fails.clear()


def make_client(tmp_path, production=False, password=None):
    if password:
        auth.save_password(str(tmp_path), password)
    return create_app(str(tmp_path / "t.db"), production=production).test_client()


# ---------------------------------------------------------------- 로그인
def test_local_without_password_is_open(tmp_path):
    c = make_client(tmp_path)
    assert c.get("/").status_code == 200
    assert c.get("/api/categories").status_code == 200


def test_server_without_password_stays_closed(tmp_path):
    """인터넷 서버 모드에서 비밀번호를 안 정했으면 아무도 못 연다."""
    c = make_client(tmp_path, production=True)
    assert c.get("/").status_code == 503
    assert c.get("/api/categories").status_code == 503
    assert c.post("/api/items", json={"title": "x"}).status_code == 503
    assert c.get("/static/css/style.css").status_code == 200  # 안내 화면 디자인용


def test_login_and_logout(tmp_path):
    c = make_client(tmp_path, password="secret1")

    assert c.get("/api/categories").status_code == 401
    res = c.get("/")
    assert res.status_code == 302 and res.headers["Location"].endswith("/login")

    assert c.post("/login", data={"password": "wrong"}).status_code == 401
    res = c.post("/login", data={"password": "secret1"})
    assert res.status_code == 302
    assert c.get("/api/categories").status_code == 200
    assert c.get("/").status_code == 200

    c.post("/logout")
    assert c.get("/api/categories").status_code == 401


def test_login_cookie_lasts_and_is_https_only_on_server(tmp_path):
    c = make_client(tmp_path, production=True, password="secret1")
    res = c.post("/login", data={"password": "secret1"}, base_url="https://localhost")
    cookie = res.headers["Set-Cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie and "Expires=" in cookie


def test_too_many_wrong_passwords_locks_for_a_while(tmp_path):
    c = make_client(tmp_path, password="secret1")
    for _ in range(auth.MAX_FAILS):
        c.post("/login", data={"password": "nope"})
    # 맞는 비밀번호여도 잠시 막힘
    res = c.post("/login", data={"password": "secret1"})
    assert res.status_code == 429
    assert c.get("/api/categories").status_code == 401


def test_password_is_stored_as_hash(tmp_path):
    auth.save_password(str(tmp_path), "secret1")
    content = (tmp_path / "auth.json").read_text()
    assert "secret1" not in content
    with pytest.raises(ValueError):
        auth.save_password(str(tmp_path), "123")  # 너무 짧음


def test_secret_key_is_kept_between_restarts(tmp_path):
    """서버를 다시 시작해도 이미 로그인한 기기가 풀리지 않아야 한다."""
    c1 = make_client(tmp_path, password="secret1")
    c1.post("/login", data={"password": "secret1"})
    cookie = c1.get_cookie("session").value

    c2 = create_app(str(tmp_path / "t.db")).test_client()  # 재시작
    c2.set_cookie("session", cookie)
    assert c2.get("/api/categories").status_code == 200


# ---------------------------------------------------------------- 동기화
def version(c):
    return c.get("/api/version").get_json()["version"]


def test_version_changes_only_when_data_changes(client):
    v0 = version(client)

    client.get("/api/categories")
    client.get("/api/occurrences?start=2026-11-01&end=2026-12-01")
    assert version(client) == v0  # 읽기만 하면 그대로

    client.post("/api/items", json={"title": "a", "dates": ["2026-11-05"]})
    assert version(client) == v0 + 1

    client.post("/api/items", json={"title": ""})  # 실패한 요청
    assert version(client) == v0 + 1

    client.post("/api/categories", json={"name": "수업", "color": "#3D6FD9"})
    assert version(client) == v0 + 2


def test_saves_report_new_version(client):
    """저장 응답에 새 변경 번호가 실려 온다 (화면이 다른 기기의 변경이 끼어 있었는지 판단하는 데 쓴다)"""
    v0 = version(client)
    res = client.post("/api/notes", json={"title": "메모"})
    assert res.headers["X-Data-Version"] == str(v0 + 1)
    assert "X-Data-Version" not in client.get("/api/notes").headers


def test_api_responses_are_not_cached(client):
    assert client.get("/api/version").headers["Cache-Control"] == "no-store"


# ---------------------------------------------------------------- 시연용 (--demo)
def test_demo_calendar_is_filled_around_today(tmp_path):
    from datetime import date, timedelta

    import demo

    demo.reset_demo_folder(str(tmp_path))
    app = create_app(demo.demo_database_path(str(tmp_path)), demo_mode=True)
    today = date(2027, 3, 10)
    demo.seed_demo(app, today=today)
    c = app.test_client()

    assert [x["name"] for x in c.get("/api/categories").get_json()] == ["미분류", "수업", "과제", "알바", "개인"]
    # 실행한 날짜가 속한 달에 일정이 보인다
    month = c.get("/api/occurrences?start=2027-03-01&end=2027-04-01").get_json()
    assert len(month) > 20
    titles_today = [o["title"] for o in month if o["date"] == today.isoformat()]
    assert "오늘 할 일 정리" in titles_today and "스터디" in titles_today
    assert len(c.get("/api/items/undated").get_json()) == 2
    assert b"demo-banner" in c.get("/").data

    # 실제 데이터 폴더와 분리돼 있다
    assert "demo" in demo.demo_database_path(str(tmp_path))


def test_normal_app_has_no_demo_banner(client):
    assert b"demo-banner" not in client.get("/").data


# ---------------------------------------------------------------- 앱 이름 / 설정 메뉴 (6차)
def test_app_name_and_settings_menu(tmp_path):
    c = make_client(tmp_path)
    html = c.get("/").get_data(as_text=True)
    assert "<title>극한캘린더</title>" in html
    assert 'content="극한캘린더"' in html             # 홈 화면 아이콘 아래 이름 (아이폰)
    assert 'id="settings-menu"' in html and 'id="btn-settings"' in html
    assert 'id="boot-error"' in html                  # 화면 코드를 못 불러왔을 때 안내

    manifest = c.get("/static/manifest.webmanifest").get_json()
    assert manifest["short_name"] == "극한캘린더"
    assert manifest["name"].startswith("극한 생산성 캘린더")


def test_login_page_shows_app_name(tmp_path):
    c = make_client(tmp_path, password="secret1")
    html = c.get("/login").get_data(as_text=True)
    assert "극한 생산성 캘린더" in html and "일정 관리의 종결" in html


def test_font_files_are_served(client):
    for name in ["gowun-dodum", "gowun-batang", "jua", "noto-sans-kr"]:
        css = client.get(f"/static/vendor/fonts/{name}/font.css")
        assert css.status_code == 200
        first = css.get_data(as_text=True).split("url(./files/")[1].split(")")[0]
        assert client.get(f"/static/vendor/fonts/{name}/files/{first}").status_code == 200
