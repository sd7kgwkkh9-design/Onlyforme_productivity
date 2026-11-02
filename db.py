"""
데이터베이스(SQLite) 연결과 테이블 생성을 담당하는 모듈.

테이블 구조
-----------
categories  : 카테고리 (이름, 색상, 기본 카테고리 여부)
items       : 일정/할 일 본체 (제목, 메모, 카테고리, 시작·끝 시각)
item_dates  : 일정이 들어간 날짜들 (일정 하나에 날짜 여러 개 가능)
              + 그 날짜 안에서의 표시 순서(position)

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
    start_time  TEXT,                         -- 'HH:MM' 또는 NULL
    end_time    TEXT,                         -- 'HH:MM' 또는 NULL (둘 다 NULL이면 시간 없는 할 일)
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS item_dates (
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    date        TEXT    NOT NULL,             -- 'YYYY-MM-DD'
    position    INTEGER NOT NULL DEFAULT 0,   -- 같은 날 안에서의 순서 (작을수록 위)
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


def column_names(conn, table):
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def migrate(conn):
    """
    예전 버전으로 만든 DB 파일에 새 칸을 추가한다 (입력해 둔 일정은 그대로 유지).
      - items.end_time       : 끝 시간 (2차 수정에서 추가)
      - item_dates.position  : 하루 안의 표시 순서 (2차 수정에서 추가)
    """
    if "end_time" not in column_names(conn, "items"):
        conn.execute("ALTER TABLE items ADD COLUMN end_time TEXT")
    if "position" not in column_names(conn, "item_dates"):
        conn.execute("ALTER TABLE item_dates ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
        # 기존 일정은 '올린 순서'(id 순)로 줄 세운다.
        conn.execute("UPDATE item_dates SET position = item_id")


def init_db(path):
    """테이블이 없으면 만들고, 기본 카테고리 '미분류'가 없으면 넣는다."""
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        migrate(conn)
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
