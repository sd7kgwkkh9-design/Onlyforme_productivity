"""0.14.2 — 기념일마다 D-day 띄울 날, 메모장의 '나', 상단 띠(올해 진행률 뺌·습관 이름·D-day 강조), 잠그기 하나로, 테마 대비"""

import json
import os
import re
import sqlite3

from app import create_app

TODAY = "2026-11-20"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def post(c, url, body, status=201):
    res = c.post(url, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def put(c, url, body, status=200):
    res = c.put(url, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def anniv_titles(c, today=TODAY):
    return [d["title"] for d in c.get(f"/api/overview?today={today}").get_json()["ddays"] if d["kind"] == "anniv"]


# ================================================================ 기념일 D-day를 며칠 전부터
def test_anniversary_dday_lead_days(client):
    # 오늘(11/20)에서 10일 뒤, 40일 뒤, 90일 뒤
    a10 = post(client, "/api/anniversaries", {"title": "열흘", "kind": "yearly", "date": "2020-11-30", "dday_days": 7})
    a40 = post(client, "/api/anniversaries", {"title": "사십", "kind": "yearly", "date": "2020-12-30"})               # 기본 30일
    a90 = post(client, "/api/anniversaries", {"title": "구십", "kind": "birthday", "date": "2001-02-18", "dday_days": 100})
    assert (a10["dday_days"], a40["dday_days"], a90["dday_days"]) == (7, 30, 100)
    assert a40["dday"] is True                                                       # 예전 칸도 같이 맞춘다
    titles = anniv_titles(client)
    assert any("구십" in t for t in titles)                                           # 100일 전부터 → 90일 남아도 보인다
    assert not any("열흘" in t for t in titles)                                       # 7일 전부터 → 10일 남으면 아직
    assert not any("사십" in t for t in titles)                                       # 30일 전부터 → 40일 남으면 아직
    assert any("열흘" in t for t in anniv_titles(client, "2026-11-23"))               # 7일 남은 날부터

    # 바꾸기 · 끄기
    assert put(client, f"/api/anniversaries/{a40['id']}", {"dday_days": 60})["dday_days"] == 60
    assert any("사십" in t for t in anniv_titles(client))
    off = put(client, f"/api/anniversaries/{a90['id']}", {"dday_days": 0})
    assert (off["dday_days"], off["dday"]) == (0, False)
    assert not any("구십" in t for t in anniv_titles(client))
    # 예전처럼 dday만 보내도 된다 (true → 30일, false → 안 띄움)
    assert put(client, f"/api/anniversaries/{a90['id']}", {"dday": True})["dday_days"] == 30
    assert put(client, f"/api/anniversaries/{a90['id']}", {"dday": False})["dday_days"] == 0
    # 고를 수 있는 값만
    for bad in (5, -1, "30", True, 365):
        res = client.put(f"/api/anniversaries/{a10['id']}", json={"dday_days": bad})
        assert res.status_code == 400 and "D-day" in res.get_json()["error"]


def test_old_anniversary_dday_flag_becomes_lead_days(tmp_path):
    path = tmp_path / "old.db"
    create_app(str(path))
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE a2 AS SELECT id, title, emoji, kind, date, lunar, leap, from_one, dday, created_at FROM anniversaries;
        DROP TABLE anniversaries;
        ALTER TABLE a2 RENAME TO anniversaries;
        INSERT INTO anniversaries (title, emoji, kind, date, lunar, leap, from_one, dday, created_at)
        VALUES ('켬', '🎉', 'yearly', '2020-12-01', 0, 0, 1, 1, '2026-01-01'), ('끔', '🎉', 'yearly', '2020-12-02', 0, 0, 1, 0, '2026-01-01');
    """)
    conn.commit()
    conn.close()
    c = create_app(str(path)).test_client()
    got = {a["title"]: a["dday_days"] for a in c.get(f"/api/anniversaries?today={TODAY}").get_json()}
    assert got == {"켬": 30, "끔": 0}


def test_anniversary_form_has_lead_choices():
    js = read("static", "js", "annivs.js")
    for label in ("'안 띄움'", "'7일 전부터'", "'14일 전부터'", "'30일 전부터'", "'60일 전부터'", "'100일 전부터'"):
        assert label in js
    assert "dday_days: Number(dday.value)" in js


# ================================================================ 메모장의 '나'
def test_about_default_sections_and_autosave(client):
    secs = client.get("/api/about").get_json()
    assert [s["title"] for s in secs] == ["기본 정보", "좋아하는 것", "싫어하는 것", "요즘 빠진 것", "자유롭게"]
    assert [s["kind"] for s in secs] == ["fields", "lists", "lists", "lists", "text"]
    likes = secs[1]
    assert "운동" in [r["label"] for r in likes["data"]] and "브랜드" in [r["label"] for r in likes["data"]]

    # 칩: 앞뒤 빈칸 다듬고, 같은 것은 한 번만, 빈 것은 버린다
    data = [{"label": "운동", "items": [" 수영 ", "러닝", "수영", ""]}, {"label": "브랜드", "items": ["뉴발란스"]}]
    saved = put(client, f"/api/about/{likes['id']}", {"data": data, "title": "좋아하는 것들"})
    assert saved["title"] == "좋아하는 것들"
    assert saved["data"] == [{"label": "운동", "items": ["수영", "러닝"]}, {"label": "브랜드", "items": ["뉴발란스"]}]
    put(client, f"/api/about/{secs[0]['id']}", {"data": [{"label": "MBTI", "value": "INFJ"}, {"label": "", "value": ""}]})
    put(client, f"/api/about/{secs[4]['id']}", {"data": "아침형 인간이 되고 싶다"})
    again = {s["id"]: s for s in client.get("/api/about").get_json()}
    assert again[secs[0]["id"]]["data"][0] == {"label": "MBTI", "value": "INFJ"}
    assert again[secs[4]["id"]]["data"] == "아침형 인간이 되고 싶다"

    # 종류에 맞지 않는 내용은 거절
    put(client, f"/api/about/{secs[4]['id']}", {"data": [{"label": "x"}]}, status=400)
    put(client, f"/api/about/{likes['id']}", {"data": "글"}, status=400)
    put(client, f"/api/about/{likes['id']}", {"data": [{"label": "x", "items": ["가" * 41]}]}, status=400)
    put(client, f"/api/about/{likes['id']}", {"title": "  "}, status=400)


def test_about_add_order_delete_and_seed_once(tmp_path):
    path = str(tmp_path / "me.db")
    c = create_app(path).test_client()
    new = post(c, "/api/about", {"title": "버킷리스트", "kind": "lists"})
    assert (new["kind"], new["data"]) == ("lists", [])
    post(c, "/api/about", {"title": "x", "kind": "table"}, status=400)
    ids = [s["id"] for s in c.get("/api/about").get_json()]
    assert ids[-1] == new["id"]
    order = [new["id"], *ids[:-1]]
    assert [s["id"] for s in put(c, "/api/about/order", {"ids": order})] == order
    put(c, "/api/about/order", {"ids": order[:-1]}, status=409)                  # 모자라면 거절
    for sid in ids:
        assert c.delete(f"/api/about/{sid}").status_code == 200
    assert c.get("/api/about").get_json() == []
    # 다 지운 뒤 서버를 다시 켜도 기본 칸이 다시 생기지 않는다
    assert create_app(path).test_client().get("/api/about").get_json() == []


def test_about_is_searchable_and_backed_up_but_never_shared(client):
    likes = client.get("/api/about").get_json()[1]
    put(client, f"/api/about/{likes['id']}", {"data": [{"label": "운동", "items": ["클라이밍"]}]})
    res = client.get(f"/api/search?q=클라이밍&today={TODAY}").get_json()
    g = next(g for g in res["groups"] if g["kind"] == "about")
    assert g["label"] == "나" and g["results"][0]["title"] == "좋아하는 것" and "클라이밍" in g["results"][0]["snippet"]
    # JSON 속 칸 이름("label", "items")으로는 걸리지 않는다
    assert not any(g["kind"] == "about" for g in client.get(f"/api/search?q=items&today={TODAY}").get_json()["groups"])

    backup = json.loads(client.get("/api/backup").get_data(as_text=True))
    assert any("클라이밍" in r["data"] for r in backup["tables"]["about_sections"])

    # 공유 링크·구독·위젯 쪽 코드는 이 표를 읽지 않는다
    assert "about" not in read("links.py") and "about_sections" not in read("links.py")


def test_restore_keeps_about_when_old_file_has_none(client):
    first = client.get("/api/about").get_json()[0]
    put(client, f"/api/about/{first['id']}", {"data": [{"label": "별명", "value": "강제"}]})
    old = {"app": "my-calendar", "format": 1, "version": "0.14.1", "tables": {"categories": [{"id": 1, "name": "미분류", "color": "#9AA0AA", "is_default": 1}]}}
    assert client.post("/api/backup/restore", json=old).status_code == 200
    kept = client.get("/api/about").get_json()
    assert kept[0]["data"] == [{"label": "별명", "value": "강제"}]
    # 0.14.2 파일이면 그 내용으로 바뀐다
    new = {**old, "tables": {**old["tables"], "about_sections": [{"id": 7, "title": "나", "kind": "text", "data": json.dumps("새 글"), "position": 0}]}}
    assert client.post("/api/backup/restore", json=new).status_code == 200
    assert [(s["title"], s["data"]) for s in client.get("/api/about").get_json()] == [("나", "새 글")]


def test_notes_have_me_tab():
    html = read("templates", "index.html")
    tabs = re.findall(r'data-tab="(\w+)"', html)
    assert tabs[:7] == ["all", "memo", "me", "goal", "todo", "buy", "project"]
    notes = read("static", "js", "notes.js")
    assert "const TABS = ['all', 'memo', 'me', 'goal', 'todo', 'buy', 'project'];" in notes
    assert "renderAbout" in notes and "flushAbout" in notes


# ================================================================ 상단 띠 · 버튼
def test_top_strip_changes():
    strip = read("static", "js", "strip.js")
    assert "year-bar" not in strip and "year.percent" not in strip                 # 올해 진행률(%)은 뺐다
    assert "habit-name" in strip                                                   # 습관 이름
    assert "days <= 7 ? 'is-near' : days <= 14 ? 'is-soon'" in strip               # D-day 강조 세 단계
    css = read("static", "css", "style.css")
    assert ".dday-chip.is-near" in css and ".dday-chip.is-soon" in css and ".year-bar" not in css


def test_care_button_is_right_of_quick_and_lock_is_single(client):
    html = client.get("/").get_data(as_text=True)
    assert html.index('id="btn-quick"') < html.index('id="btn-care"') < html.index('class="seg view-switch"')
    assert html.index('class="actions"') < html.index('id="btn-care"')
    settings = read("static", "js", "settings.js")
    assert "menu-lock-now" in settings
    css = read("static", "css", "style.css")
    assert re.search(r"@media \(min-width: 641px\) \{ \.menu-lock-now \{ display: none", css)   # 컴퓨터는 위의 🔒만
    assert re.search(r"@media \(max-width:\s*640px\)\s*\{\s*#btn-lock\s*\{\s*display:\s*none", css)  # 휴대폰은 ⚙ 메뉴만


# ================================================================ 테마 대비 (WCAG)
def _lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def _cr(a, b):
    x, y = sorted((_lum(a), _lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def test_theme_text_contrast():
    css = read("static", "css", "style.css")
    blocks = re.findall(r':root\[data-palette="([\w-]+)"\], \[data-swatch="[\w-]+"\] \{(.*?)\}', css, re.DOTALL)
    assert len(blocks) == 9
    for name, body in blocks:
        v = dict(re.findall(r"--([\w-]+): (#[0-9a-fA-F]{6});", body))
        for bg in ("surface", "paper"):
            assert _cr(v["ink"], v[bg]) >= 7, (name, bg)
            for key in ("muted", "accent", "sun", "danger"):
                assert _cr(v[key], v[bg]) >= 4.5, (name, key, bg)
            assert _cr(v["faint"], v[bg]) >= 3, (name, "faint", bg)


# ================================================================ 메모장의 '살 것'
def test_wishlist_add_star_total_and_order(client):
    assert client.get("/api/wishlist").get_json() == {"items": [], "total": 0, "priced": 0, "starred_total": 0, "starred_count": 0}
    a = post(client, "/api/wishlist", {"title": "  러닝화  ", "price": 139000, "when": "12월"})
    b = post(client, "/api/wishlist", {"title": "이어폰", "price": 259000, "url": "example.com/x"})
    post(client, "/api/wishlist", {"title": "책상 조명"})
    assert a["title"] == "러닝화" and a["when"] == "12월" and a["starred"] is False
    assert b["url"] == "https://example.com/x"                                       # 주소 앞에 https:// 붙이기
    put(client, f"/api/wishlist/{b['id']}", {"starred": True})
    d = client.get("/api/wishlist").get_json()
    assert [i["title"] for i in d["items"]] == ["이어폰", "러닝화", "책상 조명"]          # ⭐ 꼭 살 것 먼저
    assert (d["total"], d["priced"], d["starred_total"], d["starred_count"]) == (398000, 2, 259000, 1)
    # 보낸 칸만 바뀐다 · 가격 지우기
    assert put(client, f"/api/wishlist/{a['id']}", {"price": None})["when"] == "12월"
    assert client.get("/api/wishlist").get_json()["total"] == 259000
    assert client.delete(f"/api/wishlist/{a['id']}").status_code == 200
    assert len(client.get("/api/wishlist").get_json()["items"]) == 2


def test_wishlist_validation(client):
    post(client, "/api/wishlist", {"title": " "}, status=400)
    for bad in ({"price": -1}, {"price": "13만"}, {"price": True}, {"price": 1.5}):
        post(client, "/api/wishlist", {"title": "x", **bad}, status=400)
    for url in ("javascript:alert(1)", "https://", "ftp://example.com/a", "https://a b.com"):
        res = client.post("/api/wishlist", json={"title": "x", "url": url})
        assert res.status_code == 400, url
    post(client, "/api/wishlist", {"title": "x", "when": "가" * 21}, status=400)


def test_wishlist_search_backup_not_shared(client):
    post(client, "/api/wishlist", {"title": "치이카와 인형", "price": 35000, "when": "생일 선물"})
    res = client.get(f"/api/search?q=치이카와&today={TODAY}").get_json()
    g = next(g for g in res["groups"] if g["kind"] == "wish")
    assert g["label"] == "살 것" and g["results"][0]["price"] == 35000
    backup = json.loads(client.get("/api/backup").get_data(as_text=True))
    assert backup["tables"]["wishlist"][0]["title"] == "치이카와 인형"
    assert "wishlist" not in read("links.py")
    # 예전 파일로 되살려도 '살 것'은 남는다
    old = {"app": "my-calendar", "format": 1, "version": "0.14.1", "tables": {"categories": [{"id": 1, "name": "미분류", "color": "#9AA0AA", "is_default": 1}]}}
    assert client.post("/api/backup/restore", json=old).status_code == 200
    assert client.get("/api/wishlist").get_json()["items"][0]["title"] == "치이카와 인형"


def test_wishlist_quick_parse_in_js():
    js = read("static", "js", "wishlist.js")
    assert "export function parseWish" in js and "rel: 'noopener noreferrer'" in js


# ================================================================ 위젯에서도 올해 진행률을 뺐다
def test_widget_script_has_no_year_percent(client):
    script = read("static", "widget", "scriptable-widget.js")
    assert "year.percent" not in script
    # 0.14.1까지의 위젯 스크립트가 깨지지 않게 데이터에는 남겨 둔다
    link = post(client, "/api/links", {"kind": "widget"})
    data = client.get(link["url"].replace("http://localhost", "")).get_json()
    assert "percent" in data["year"]

