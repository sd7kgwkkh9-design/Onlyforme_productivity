"""최적화 테스트: 지문 붙은 주소·저장 기간·압축, 화면별로 묶어 받기"""

import gzip
import hashlib
import os
import re

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


def digest(rel):
    with open(os.path.join(STATIC, rel), "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


def test_index_uses_fingerprinted_urls_and_import_map(client):
    html = client.get("/").get_data(as_text=True)
    assert f"/static/css/style.css?v={digest('css/style.css')}" in html
    assert f"/static/js/main.js?v={digest('js/main.js')}" in html
    assert '<script type="importmap">' in html
    # 모든 JS 모듈이 import map과 미리 불러오기에 들어 있다
    for name in os.listdir(os.path.join(STATIC, "js")):
        assert f'"/static/js/{name}": "/static/js/{name}?v={digest("js/" + name)}"' in html
        assert f'rel="modulepreload" href="/static/js/{name}?v=' in html


def test_cache_headers(client):
    v = digest("css/style.css")
    assert client.get(f"/static/css/style.css?v={v}").headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert client.get("/static/css/style.css").headers["Cache-Control"] == "no-cache"   # 지문 없는 주소는 매번 확인
    assert client.get("/").headers["Cache-Control"] == "no-cache"
    assert client.get("/api/version").headers["Cache-Control"] == "no-store"
    font = next(n for n in os.listdir(os.path.join(STATIC, "vendor/fonts/jua/files")) if n.endswith(".woff2"))
    assert client.get(f"/static/vendor/fonts/jua/files/{font}").headers["Cache-Control"] == "public, max-age=2592000"


def test_text_responses_are_gzipped(client):
    with open(os.path.join(STATIC, "vendor/fullcalendar/fullcalendar.min.js"), "rb") as f:
        original = f.read()
    res = client.get("/static/vendor/fullcalendar/fullcalendar.min.js", headers={"Accept-Encoding": "gzip, br"})
    assert res.headers["Content-Encoding"] == "gzip" and "Accept-Encoding" in res.headers["Vary"]
    body = res.get_data()
    assert gzip.decompress(body) == original and len(body) < len(original) / 2
    again = client.get("/static/vendor/fullcalendar/fullcalendar.min.js", headers={"Accept-Encoding": "gzip"})
    assert again.get_data() == body                                   # 두 번째는 기억해 둔 압축본

    plain = client.get("/static/vendor/fullcalendar/fullcalendar.min.js")  # gzip을 모르는 브라우저
    assert "Content-Encoding" not in plain.headers and plain.get_data() == original

    # API(JSON)도 크면 압축, 작으면 그대로
    for i in range(40):
        client.post("/api/items", json={"title": f"일정 {i}", "dates": ["2026-11-05"], "memo": "메모" * 10})
    big = client.get("/api/calendar?start=2026-11-01&end=2026-12-01", headers={"Accept-Encoding": "gzip"})
    assert big.headers["Content-Encoding"] == "gzip"
    small = client.get("/api/version", headers={"Accept-Encoding": "gzip"})
    assert "Content-Encoding" not in small.headers

    # 이미지(woff2·png)는 이미 압축된 형식이라 건드리지 않는다
    png = client.get("/static/icons/apple-touch-icon.png", headers={"Accept-Encoding": "gzip"})
    assert "Content-Encoding" not in png.headers


def test_calendar_and_day_endpoints_bundle_requests(client):
    run = client.post("/api/routines", json={"name": "운동", "emoji": "🏃"}).get_json()
    client.post("/api/items", json={"title": "수업", "dates": ["2026-11-05", "2026-11-07"]})
    client.post("/api/routine-logs", json={"routine_id": run["id"], "date": "2026-11-05", "memo": "5km"})
    client.post("/api/routine-logs", json={"routine_id": run["id"], "date": "2026-11-03"})

    cal = client.get("/api/calendar?start=2026-11-01&end=2026-12-01").get_json()
    assert [o["date"] for o in cal["items"]] == ["2026-11-05", "2026-11-07"]
    assert [l["date"] for l in cal["logs"]] == ["2026-11-03", "2026-11-05"]
    # 따로 받던 것과 같은 내용
    assert cal["items"] == client.get("/api/occurrences?start=2026-11-01&end=2026-12-01").get_json()
    assert cal["logs"] == client.get("/api/routine-logs?start=2026-11-01&end=2026-12-01").get_json()

    day = client.get("/api/day/2026-11-05").get_json()
    assert [o["title"] for o in day["items"]] == ["수업"] and day["items"][0]["date_count"] == 2
    assert [l["memo"] for l in day["logs"]] == ["5km"]
    assert day["routines"][0]["last_date"] == "2026-11-05"
    assert client.get("/api/day/2026-11-04").get_json()["routines"][0]["last_date"] == "2026-11-03"
    assert client.get("/api/day/2026-13-01").status_code == 400


def test_login_page_also_uses_fingerprints(tmp_path):
    import auth
    from app import create_app
    auth.save_password(str(tmp_path), "secret1")
    html = create_app(str(tmp_path / "t.db")).test_client().get("/login").get_data(as_text=True)
    assert re.search(r"/static/css/style\.css\?v=[0-9a-f]{10}", html)
