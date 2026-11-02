"""
데이터베이스(SQLite) 연결과 테이블 생성을 담당하는 모듈.

테이블 구조
-----------
categories  : 카테고리 (이름, 색상, 기본 카테고리 여부)
items       : 일정/할 일 본체 (제목, 메모, 카테고리, 시작 시각)
item_dates  : 일정이 들어간 날짜들 (일정 하나에 날짜 여러 개 가능)

item_dates에 줄이 하나도 없는 일정 = "기한 미정" 일정이다.
"""

import sqlite3

from flask import current_app, g

DEFAULT_CATEGORY_NAME = "미분류"
DEFAULT_CATEGORY_COLOR = "#9AA0AA"

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    color       TEXT    NOT NULL,             -- '#RRGGBB'
    is_default  INTEGER NOT NULL DEFAULT 0    -- 1이면 삭제/수정 불가인 '미분류'
);

CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    memo        TEXT    NOT NULL DEFAULT '',
    category_id INTEGER NOT NULL REFERENCES categories(id),
    start_time  TEXT,                         -- 'HH:MM', 시간 없는 할 일이면 NULL
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS item_dates (
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    date        TEXT    NOT NULL,             -- 'YYYY-MM-DD'
    PRIMARY KEY (item_id, date)
);

-- 달력은 항상 "날짜 범위"로 일정을 찾으므로 date에 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_item_dates_date ON item_dates(date);
"""


def connect(path):
    """SQLite 연결을 만든다. 외래키 검사는 연결마다 켜 줘야 한다."""
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row  # row["name"]처럼 이름으로 꺼낼 수 있게
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path):
    """테이블이 없으면 만들고, 기본 카테고리 '미분류'가 없으면 넣는다."""
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.execute(
            """
            INSERT INTO categories (name, color, is_default)
            SELECT ?, ?, 1
            WHERE NOT EXISTS (SELECT 1 FROM categories WHERE is_default = 1)
            """,
            (DEFAULT_CATEGORY_NAME, DEFAULT_CATEGORY_COLOR),
        )
        conn.commit()
    finally:
        conn.close()


def get_db():
    """요청 하나 동안 같은 연결을 재사용한다 (Flask의 g 객체에 보관)."""
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_exc=None):
    """요청이 끝나면 연결을 닫는다."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def default_category_id(db):
    row = db.execute("SELECT id FROM categories WHERE is_default = 1").fetchone()
    return row["id"]
