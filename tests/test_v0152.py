"""0.15.2 — 자동 백업, 앱 이름 '나를 위한 캘린더', 속도·부드러움"""

import json
import os
import re
from datetime import date, timedelta

import backup
import db
from app import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def make_client(tmp_path):
    path = tmp_path / "calendar.db"
    db.init_db(str(path))
    app = create_app(str(path))
    app.config["TESTING"] = True
    return app, app.test_client(), tmp_path / "backups"


# ================================================================ 자동 백업
def test_first_use_of_the_day_makes_one_auto_backup(tmp_path):
    app, c, folder = make_client(tmp_path)
    assert c.post("/api/items", json={"title": "치과", "date": "2026-11-25"}).status_code in (200, 201)
    names = [n for n in os.listdir(folder) if n.startswith("auto-")]
    assert len(names) == 1 and re.fullmatch(r"auto-\d{4}-\d{2}-\d{2}\.json", names[0])
    data = json.loads((folder / names[0]).read_text(encoding="utf-8"))
    assert data["app"] == "my-calendar" and data["times"] == "kst"
    assert any(r["title"] == "치과" for r in data["tables"]["items"])
    assert "auth" not in data["tables"] and "passkeys" not in data["tables"] and "links" not in data["tables"]   # 열쇠는 들어가지 않는다
    c.get("/api/inbox")                               # 같은 날 또 써도 하나뿐
    with app.app_context():
        assert backup.auto_backup(db.get_db(), date.fromisoformat(names[0][5:15])) is None
    assert len([n for n in os.listdir(folder) if n.startswith("auto-")]) == 1


def test_failed_requests_do_not_back_up(tmp_path):
    _app, c, folder = make_client(tmp_path)
    backup._checked.clear()
    assert c.get("/api/items/99999").status_code == 404
    assert not folder.exists() or not [n for n in os.listdir(folder) if n.startswith("auto-")]


def test_old_auto_backups_thin_out_to_daily_then_weekly(tmp_path):
    folder = tmp_path / "backups"
    folder.mkdir()
    start = date(2026, 6, 1)
    for i in range(120):                              # 120일 동안 매일 하나씩 있었다고 치자
        (folder / f"auto-{start + timedelta(days=i):%Y-%m-%d}.json").write_text("{}")
    (folder / "before-restore-20260901-101010.json").write_text("{}")   # 되살리기 전 보관은 따로 (건드리지 않는다)
    backup.prune_auto(str(folder))
    left = sorted(n for n in os.listdir(folder) if n.startswith("auto-"))
    days = [date.fromisoformat(n[5:15]) for n in left]
    assert len(left) == backup.KEEP_DAILY + backup.KEEP_WEEKLY
    newest = start + timedelta(days=119)
    assert days[-backup.KEEP_DAILY:] == [newest - timedelta(days=i) for i in range(backup.KEEP_DAILY)][::-1]
    weekly = days[: -backup.KEEP_DAILY]
    assert len({d.isocalendar()[:2] for d in weekly}) == backup.KEEP_WEEKLY    # 주마다 하나씩
    assert (folder / "before-restore-20260901-101010.json").exists()


def test_auto_backup_list_download_and_last_download(tmp_path):
    _app, c, _folder = make_client(tmp_path)
    c.get("/api/inbox")
    res = c.get("/api/backup/auto").get_json()
    assert res["last_download"] is None and res["keep"] == {"daily": 14, "weekly": 8}
    auto = [f for f in res["files"] if f["kind"] == "auto"]
    assert len(auto) == 1 and auto[0]["size"] > 0
    got = c.get(f"/api/backup/auto/{auto[0]['name']}")
    assert got.status_code == 200 and got.get_json()["app"] == "my-calendar"
    assert "attachment" in got.headers["Content-Disposition"] and got.headers["Cache-Control"] == "no-store"
    c.get("/api/backup")                              # 내 컴퓨터로 받으면 그 때를 기억한다
    assert c.get("/api/backup/auto").get_json()["last_download"][:4].isdigit()
    # 되살리면 '되살리기 전 보관'도 목록에 나온다
    c.post("/api/backup/restore", json=got.get_json())
    kinds = {f["kind"] for f in c.get("/api/backup/auto").get_json()["files"]}
    assert kinds == {"auto", "before-restore"}


def test_auto_backup_download_only_opens_backup_files(tmp_path):
    _app, c, _folder = make_client(tmp_path)
    c.get("/api/inbox")
    for bad in ["calendar.db", "..%2Fcalendar.db", "auto-2026-11-25.json.bak", "auth.json", "auto-../../x.json"]:
        assert c.get(f"/api/backup/auto/{bad}").status_code == 404, bad
    assert c.get("/api/backup/auto/auto-1999-01-01.json").status_code == 404


def test_backup_dialog_shows_auto_backups():
    js = read("static", "js", "backup.js")
    assert "api.autoBackups()" in js and "restoreAuto" in js and "confirmAndRestore" in js
    assert "'자동 백업'" in js and "마지막으로 받은 날" in js


# ================================================================ 앱 이름
def test_app_is_called_for_me_calendar(client):
    html = client.get("/").get_data(as_text=True)
    assert "<title>나를 위한 캘린더</title>" in html and "오직 나를" not in html
    manifest = json.loads(read("static", "manifest.webmanifest"))
    assert manifest["name"] == "나를 위한 캘린더"
    assert '"나를 위한 캘린더"' in read("static", "widget", "scriptable-widget.js")


# ================================================================ 부드럽게 (애플 느낌)
def test_motion_curves_and_springs():
    css = read("static", "css", "style.css")
    for token in ("--ease-out: cubic-bezier(.22, 1, .36, 1)", "--ease-sheet: cubic-bezier(.32, .72, 0, 1)", "--spring: linear("):
        assert token in css
    spring = re.search(r"--spring: linear\(([^)]*)\)", css).group(1)
    values = [float(p.split()[0]) for p in spring.split(",")]
    assert values[0] == 0 and values[-1] == 1 and 1.0 < max(values) < 1.06          # 살짝(6% 미만)만 지나친다
    assert "translate: 0 100%" in css                                               # 휴대폰 시트는 아래에서 올라온다
    assert "backdrop-filter: blur(24px)" in css                                     # 반투명 메뉴
    assert "*, *::before, *::after { animation: none !important; transition: none !important; }" in css   # '동작 줄이기'는 그대로 존중


def test_view_switch_thumb_slides_and_is_measured_after_the_transition():
    js = read("static", "js", "main.js")
    css = read("static", "css", "style.css")
    assert "function moveViewThumb()" in js and "requestAnimationFrame(moveViewThumb);" in js
    assert "transition.ready.catch(() => {});" in js
    assert ".seg-thumb {" in css and ".view-switch.has-thumb .seg-btn { font-weight: 500; }" in css
