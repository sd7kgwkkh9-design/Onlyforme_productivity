"""0.14.3 — 카테고리 순서 바꾸기, 할 일은 체크 대신 지우기, 고침: 카테고리 색 칸이 빈 상자로 보이던 것"""

import os
import re
import sqlite3

from app import create_app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def put(c, url, body, status=200):
    res = c.put(url, json=body)
    assert res.status_code == status, res.get_json()
    return res.get_json()


def names(c):
    return [x["name"] for x in c.get("/api/categories").get_json()]


# ================================================================ 카테고리 순서
def test_category_order_keeps_default_on_top(client):
    ids = {}
    for n in ("수업", "과제", "알바"):
        ids[n] = client.post("/api/categories", json={"name": n, "color": "#3366CC"}).get_json()["id"]
    assert names(client) == ["미분류", "수업", "과제", "알바"]                    # 새로 만든 건 맨 아래
    put(client, "/api/categories/order", {"ids": [ids["알바"], ids["수업"], ids["과제"]]})
    assert names(client) == ["미분류", "알바", "수업", "과제"]
    new = client.post("/api/categories", json={"name": "운동", "color": "#33AA66"}).get_json()
    assert names(client)[-1] == "운동"
    # 미분류를 넣거나 빠뜨리면 거절
    default_id = client.get("/api/categories").get_json()[0]["id"]
    put(client, "/api/categories/order", {"ids": [default_id, ids["알바"], ids["수업"], ids["과제"], new["id"]]}, status=409)
    put(client, "/api/categories/order", {"ids": [ids["알바"], ids["수업"]]}, status=409)
    put(client, "/api/categories/order", {"ids": "x"}, status=400)


def test_old_database_categories_keep_creation_order(tmp_path):
    path = tmp_path / "old.db"
    create_app(str(path))
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE c2 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
        INSERT INTO c2 SELECT id, name, color, is_default FROM categories;
        DROP TABLE categories;
        ALTER TABLE c2 RENAME TO categories;
        INSERT INTO categories (id, name, color, is_default) VALUES (5, '나중', '#111111', 0), (3, '먼저', '#222222', 0);
    """)
    conn.commit()
    conn.close()
    c = create_app(str(path)).test_client()
    assert names(c) == ["미분류", "먼저", "나중"]


def test_category_dialog_is_sortable():
    sheet = read("static", "js", "sheet.js")
    assert "api.reorderCategories(ids)" in sheet and "cat-sortable" in sheet


# ================================================================ 고침: 카테고리 색 칸이 빈 상자로 보이던 것 (0.14.0 테마 미리보기와 이름이 겹침)
def test_theme_preview_class_does_not_clash_with_category_swatches():
    css = read("static", "css", "style.css")
    rules = re.findall(r"^\.swatch\s*\{[^}]*\}", css, re.MULTILINE)
    assert rules and all("width: 100%" not in r and "height: 64px" not in r for r in rules)
    assert "class: 'theme-swatch'" in read("static", "js", "themes.js")
    assert "class: 'swatch'" in read("static", "js", "sheet.js")                  # 카테고리 색 고르기는 그대로


# ================================================================ 할 일은 체크하지 않고 지운다
def test_todos_have_no_check_but_project_tasks_do():
    notes = read("static", "js", "notes.js")
    assert "const canCheck = Boolean(onToggle) || item.done;" in notes and "removeTodo(item)" in notes
    strip = read("static", "js", "strip.js")
    assert "today-check" not in strip and "completeTodo" not in strip               # 첫 화면 '먼저'에도 체크 없음
    assert "onToggle: toggleTask(t)" in read("static", "js", "projects.js")       # 프로젝트 세부 할 일은 진행률 때문에 체크
