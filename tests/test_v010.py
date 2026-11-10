"""0.10.0 테스트: 보던 화면 주소로 로그인 뒤 돌아가기, 새로 넣은 오픈소스 파일·라이선스, 화면에 필요한 장치"""

import os
import re

import auth
from app import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_client(tmp_path, password=None):
    if password:
        auth.save_password(str(tmp_path), password)
    return create_app(str(tmp_path / "t.db")).test_client()


# ---------------------------------------------------------------- 주소에 보던 화면 남기기
def test_login_returns_to_bookmarked_view(tmp_path):
    c = make_client(tmp_path, password="secret1")
    res = c.get("/?week=2026-11-08&day=2026-11-11")
    assert res.status_code == 302
    login_url = res.headers["Location"]
    assert "/login?next=" in login_url and "week%3D2026-11-08" in login_url

    page = c.get(login_url).get_data(as_text=True)
    action = re.search(r'<form method="post" action="([^"]+)"', page).group(1)
    assert "next=" in action                           # 비밀번호를 보낼 때도 돌아갈 주소를 들고 간다

    res = c.post(action.replace("&amp;", "&"), data={"password": "secret1"})
    assert res.status_code == 302 and res.headers["Location"] == "/?week=2026-11-08&day=2026-11-11"


def test_login_next_cannot_leave_the_app(tmp_path):
    c = make_client(tmp_path, password="secret1")
    for bad in ("https://evil.example/", "//evil.example/", "/api/items", "/\\evil"):
        res = c.post("/login", query_string={"next": bad}, data={"password": "secret1"})
        assert res.headers["Location"] == "/", bad
        c.post("/logout")
    assert c.get("/").status_code == 302                  # 주소에 아무것도 없으면 그냥 로그인 화면으로
    assert "next=" not in c.get("/").headers["Location"]


# ---------------------------------------------------------------- 화면 장치
def test_index_has_share_menu_markdown_and_version(tmp_path):
    from app import APP_VERSION

    html = make_client(tmp_path).get("/").get_data(as_text=True)
    assert APP_VERSION == "0.10.0" and 'data-version="0.10.0"' in html
    assert 'id="btn-share"' in html and 'id="share-menu"' in html
    # 마크다운 라이브러리는 지문 붙은 주소로 (처음 메모를 볼 때만 불러온다)
    assert re.search(r'data-marked="/static/vendor/marked/marked\.esm\.js\?v=[0-9a-f]{10}"', html)
    assert re.search(r'data-purify="/static/vendor/dompurify/purify\.es\.js\?v=[0-9a-f]{10}"', html)
    # 글자 크기는 화면을 그리기 전에 적용 (번쩍임 방지)
    assert "my-calendar:font-size" in html


def test_vendored_open_source_files_have_licenses(tmp_path):
    for folder, files in (
        ("marked", ["marked.esm.js", "LICENSE"]),
        ("dompurify", ["purify.es.js", "LICENSE"]),
    ):
        for name in files:
            assert os.path.isfile(os.path.join(ROOT, "static", "vendor", folder, name)), (folder, name)
    c = make_client(tmp_path)
    js = c.get("/static/vendor/marked/marked.esm.js")
    assert js.status_code == 200 and js.mimetype == "text/javascript"
    assert c.get("/static/vendor/dompurify/purify.es.js").mimetype == "text/javascript"


def test_font_size_scales_text_but_not_tap_heights():
    with open(os.path.join(ROOT, "static", "css", "style.css"), encoding="utf-8") as f:
        css = f.read()
    for step in ("95", "90", "85", "80"):
        assert f':root[data-fs="{step}"]' in css
    assert "font-size: calc(14px * var(--fs))" in css
    # 버튼 높이(height)에는 배율을 쓰지 않는다 → 글씨를 줄여도 누르는 칸은 그대로
    assert not re.search(r"(?<![-\w])height:\s*calc\([^;]*var\(--fs\)", css)


def test_weather_uses_seoul_and_open_meteo():
    with open(os.path.join(ROOT, "static", "js", "weather.js"), encoding="utf-8") as f:
        js = f.read()
    assert "api.open-meteo.com" in js and "name: '서울'" in js
    assert "Asia%2FSeoul" in js
