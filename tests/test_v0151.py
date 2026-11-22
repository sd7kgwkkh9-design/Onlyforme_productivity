"""0.15.1 — 일기 저장 시각이 9시간 늦게 보이던 오류(서버 시간대 UTC), 글꼴 정리(7개 빼고 5개 넣기)"""

import os
import re
import sqlite3
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import db
from app import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KST = ZoneInfo("Asia/Seoul")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


# ================================================================ 한국 시간
def test_diary_saved_time_is_korea_time(client):
    """서버 컴퓨터가 어느 시간대든, 일기 '마지막 저장' 시각은 한국 시간이어야 한다"""
    if hasattr(time, "tzset"):
        assert time.localtime().tm_gmtoff == 9 * 3600
    saved = client.put("/api/diaries/2026-11-22", json={"body": "시간 확인"}).get_json()
    stamp = datetime.strptime(saved["updated_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST)
    assert abs(stamp - datetime.now(KST)) < timedelta(minutes=2)


def old_database(path):
    """0.15.0까지 UTC 서버(PythonAnywhere)에서 쓰던 DB를 흉내 낸다: 시각이 9시간 늦게 적혀 있고, kst_shift 표시가 없다"""
    db.init_db(str(path))
    conn = sqlite3.connect(path)
    conn.execute("DELETE FROM meta WHERE key = 'kst_shift'")
    conn.execute("INSERT INTO diaries (date, body, created_at, updated_at) VALUES ('2026-11-20', '일기', '2026-11-20 11:00:00', '2026-11-20 12:30:00')")
    conn.execute("INSERT INTO notes (title, updated_at) VALUES ('메모', '2026-11-19 23:10:00')")
    conn.execute("INSERT INTO links (kind, token, created_at, last_used_at) VALUES ('ics', 'tok', '2026-11-18 01:00:00', '2026-11-20 21:00:00')")
    conn.commit()
    conn.close()


def times(path):
    conn = sqlite3.connect(path)
    try:
        return {
            "diary": conn.execute("SELECT created_at, updated_at FROM diaries").fetchone(),
            "note": conn.execute("SELECT updated_at FROM notes WHERE title = '메모'").fetchone()[0],
            "link": conn.execute("SELECT created_at, last_used_at FROM links").fetchone(),
            "shift": conn.execute("SELECT value FROM meta WHERE key = 'kst_shift'").fetchone()[0],
        }
    finally:
        conn.close()


def test_old_utc_records_move_to_korea_time_once(tmp_path):
    path = tmp_path / "old.db"
    old_database(path)
    db.init_db(str(path), server_offset=0)          # UTC 서버에서 0.15.1로 처음 켜짐
    t = times(path)
    assert t["diary"] == ("2026-11-20 20:00:00", "2026-11-20 21:30:00")
    assert t["note"] == "2026-11-20 08:10:00"                   # 날짜도 하루 넘어간다
    assert t["link"] == ("2026-11-18 10:00:00", "2026-11-20 21:00:00")   # 처음부터 한국 시간이던 칸은 그대로
    assert t["shift"] == 9 * 3600
    db.init_db(str(path), server_offset=0)          # 다시 켜져도 또 옮기지 않는다
    assert times(path) == t


def test_korea_server_records_stay(tmp_path):
    """맥(이미 한국 시간)에서 돌리던 DB는 그대로 둔다"""
    path = tmp_path / "mac.db"
    old_database(path)
    db.init_db(str(path), server_offset=9 * 3600)
    t = times(path)
    assert t["diary"] == ("2026-11-20 11:00:00", "2026-11-20 12:30:00") and t["shift"] == 0


def test_restore_old_backup_moves_times_like_the_server(tmp_path):
    path = tmp_path / "pa.db"
    db.init_db(str(path), server_offset=0)          # PythonAnywhere: 예전 기록을 +9시간 옮긴 서버
    app = create_app(str(path))
    app.config["TESTING"] = True
    c = app.test_client()
    c.put("/api/about/1", json={"title": "지금 칸"})
    about_before = c.get("/api/about").get_json()

    old = {"app": "my-calendar", "format": 1, "version": "0.15.0",
           "tables": {"diaries": [{"date": "2026-11-20", "body": "예전", "mood": "", "created_at": "2026-11-20 03:00:00", "updated_at": "2026-11-20 03:00:00"}]}}
    assert c.post("/api/backup/restore", json=old).status_code == 200
    assert c.get("/api/diaries/2026-11-20").get_json()["updated_at"] == "2026-11-20 12:00:00"
    assert c.get("/api/about").get_json() == about_before         # 파일에 없어서 남겨 둔 '나'는 옮기지 않는다

    new = c.get("/api/backup").get_json()
    assert new["times"] == "kst"
    assert c.post("/api/backup/restore", json=new).status_code == 200
    assert c.get("/api/diaries/2026-11-20").get_json()["updated_at"] == "2026-11-20 12:00:00"   # 새 파일은 그대로


def test_restore_old_backup_on_korea_server_keeps_times(tmp_path):
    path = tmp_path / "mac.db"
    db.init_db(str(path), server_offset=9 * 3600)   # 맥: 예전 기록도 원래 한국 시간
    app = create_app(str(path))
    app.config["TESTING"] = True
    client = app.test_client()
    old = {"app": "my-calendar", "format": 1, "version": "0.15.0",
           "tables": {"diaries": [{"date": "2026-11-20", "body": "예전", "mood": "", "updated_at": "2026-11-20 21:00:00"}]}}
    assert client.post("/api/backup/restore", json=old).status_code == 200
    assert client.get("/api/diaries/2026-11-20").get_json()["updated_at"] == "2026-11-20 21:00:00"


# ================================================================ 글꼴
NEW_FONTS = {
    "suit": "'SUIT Variable'",
    "wanted-sans": "'Wanted Sans Variable'",
    "spoqa-han-sans-neo": "'Spoqa Han Sans Neo'",
    "nanum-square-round": "'NanumSquareRound'",
    "do-hyeon": "'Do Hyeon'",
}
REMOVED = ["gowun-dodum", "gowun-batang", "noto-sans-kr", "ibm-plex-sans-kr", "hahmlet", "gaegu", "nanum-pen-script"]


def test_fonts_are_pretendard_jua_and_five_new():
    settings = read("static", "js", "settings.js")
    keys = re.findall(r"^  \['([a-z-]+)', '", settings.split("const FONTS = [")[1].split("];")[0], re.MULTILINE)
    assert keys == ["pretendard", "suit", "wanted-sans", "spoqa-han-sans-neo", "nanum-square-round", "jua", "do-hyeon"]
    head = read("templates", "_head.html")
    css = read("static", "css", "style.css")
    assert re.search(r"/\^\((.+?)\)\$/\.test\(f\)", head).group(1).split("|") == keys[1:]   # 그리기 전에 적용하는 목록도 같다
    for key, family in NEW_FONTS.items():
        assert f"['{key}', " in settings and family in settings
        assert f':root[data-font="{key}"]' in css and family in css
        font_css = read("static", "vendor", "fonts", key, "font.css")
        assert f"font-family: {family};" in font_css and ".woff)" not in font_css and "font-display: swap" in font_css
        assert "Open Font License" in read("static", "vendor", "fonts", key, "LICENSE")
        files = set(re.findall(r"url\(\./files/([^)]+)\)", font_css))
        assert files == set(os.listdir(os.path.join(ROOT, "static", "vendor", "fonts", key, "files")))   # 쓰지 않는 파일이 없다
    for key in REMOVED:
        assert not os.path.exists(os.path.join(ROOT, "static", "vendor", "fonts", key))
        assert key not in settings and key not in head and f'data-font="{key}"' not in css


def test_removed_font_falls_back_to_pretendard():
    settings = read("static", "js", "settings.js")
    assert "font = read(FONT_KEY, FONTS.map(([v]) => v), 'pretendard');" in settings
    assert "save(FONT_KEY, font, 'pretendard');" in settings          # 남아 있던 옛 글꼴 이름은 지운다


def test_diary_status_sits_in_the_button_row():
    """'마지막 저장' 글자를 글 상자 밑(화면이 낮으면 스크롤해야 보임)에서 아래 버튼 줄로 옮겼다"""
    js = read("static", "js", "diary.js")
    assert "        textarea));" in js and "        statusEl,\n        el('button', { type: 'button', class: 'btn primary'" in js
    assert ".diary-status { flex: 1;" in read("static", "css", "style.css")
