"""
데이터베이스(SQLite) 연결과 테이블 생성을 담당하는 모듈.

테이블 구조
-----------
categories  : 카테고리 (이름, 색상, 기본 카테고리 여부)
items       : 일정/할 일 본체 (제목, 메모, 카테고리, 시작·끝 시각)
item_dates  : 일정이 들어간 날짜들 (일정 하나에 날짜 여러 개 가능)
              + 그 날짜 안에서의 표시 순서(position)

routines     : 루틴 — 자주 하는 활동(🏃 운동, 📖 독서 …). 카테고리 대신 이모지 하나 (8차에서 바뀜)
routine_logs : 루틴 기록 — 그날 그 루틴을 했다는 기록 (시간·메모는 선택). 일정(items)과는 따로 둔다 (8차)
notes        : 기록지 — 메모 여러 개. 그중 하나(is_main)의 banner가 달력 위 배너에 보인다 (7차)

meta        : 변경 번호(version) — 일정·카테고리·루틴·메모가 바뀔 때마다 1씩 커진다.
              다른 기기는 이 번호만 가끔 확인해서, 바뀌었을 때만 새로 불러온다 (기기 간 동기화).

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

CREATE TABLE IF NOT EXISTS routines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    emoji       TEXT    NOT NULL DEFAULT '⭐', -- 루틴을 나타내는 이모지 하나
    position    INTEGER NOT NULL DEFAULT 0    -- 버튼 순서 (작을수록 앞)
);

CREATE TABLE IF NOT EXISTS routine_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id  INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    date        TEXT    NOT NULL,             -- 'YYYY-MM-DD'
    start_time  TEXT,                         -- 'HH:MM' 또는 NULL
    end_time    TEXT,
    memo        TEXT    NOT NULL DEFAULT '',  -- '5km', '30쪽' 같은 자유 메모
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_routine_logs_date ON routine_logs(date);
-- 루틴 버튼의 '마지막으로 한 날'(루틴별 가장 늦은 날짜)을 빨리 찾도록
CREATE INDEX IF NOT EXISTS idx_routine_logs_routine ON routine_logs(routine_id, date);

CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL DEFAULT '',
    body        TEXT    NOT NULL DEFAULT '',
    banner      TEXT    NOT NULL DEFAULT '',  -- 배너 글귀 (메인 메모의 것만 화면에 보인다)
    is_main     INTEGER NOT NULL DEFAULT 0,   -- 1이면 메인 메모 (최대 하나)
    position    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('version', 0);
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
      - items.dday           : D-day 표시 여부 (7차 수정에서 추가)
      - routines             : 카테고리 → 이모지, 7차의 '루틴으로 넣은 일정'을 루틴 기록으로 옮김 (8차 수정)
    """
    if "end_time" not in column_names(conn, "items"):
        conn.execute("ALTER TABLE items ADD COLUMN end_time TEXT")
    if "position" not in column_names(conn, "item_dates"):
        conn.execute("ALTER TABLE item_dates ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
        # 기존 일정은 '올린 순서'(id 순)로 줄 세운다.
        conn.execute("UPDATE item_dates SET position = item_id")
    if "dday" not in column_names(conn, "items"):
        conn.execute("ALTER TABLE items ADD COLUMN dday INTEGER NOT NULL DEFAULT 0")
    if "emoji" not in column_names(conn, "routines"):
        migrate_routines_v8(conn)


# 7차 루틴 이름으로 이모지 짐작하기 (나중에 루틴 편집에서 바꿀 수 있다)
EMOJI_GUESS = [
    (("운동", "헬스", "러닝", "달리기", "조깅"), "🏃"), (("독서", "책"), "📖"), (("영어", "단어", "외국어"), "🔤"),
    (("공부", "복습", "예습"), "✏️"), (("명상",), "🧘"), (("스트레칭", "요가"), "🤸"), (("게임",), "🎮"),
    (("산책", "걷기"), "🚶"), (("물",), "💧"), (("일기", "기록"), "📝"), (("코딩", "개발"), "💻"), (("청소",), "🧹"),
]


def guess_emoji(name):
    for words, emoji in EMOJI_GUESS:
        if any(w in name for w in words):
            return emoji
    return "⭐"


def migrate_routines_v8(conn):
    """
    7차 → 8차: 루틴을 일정과 분리한다.
      1) routines 표를 '카테고리' 대신 '이모지'를 가진 모양으로 다시 만든다 (번호는 그대로).
      2) 7차에서 루틴 버튼으로 넣은 일정(items.routine_id가 있는 것)을 루틴 기록(routine_logs)으로 옮기고,
         일정 목록에서는 지운다. 날짜·시간·메모는 그대로 옮겨진다.
    SQLite는 칸을 지우거나 바꾸는 기능이 약해서 '새 표 만들기 → 옮겨 담기 → 옛 표 지우기 → 이름 바꾸기' 순서로 한다.
    """
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")  # 표를 바꿔 끼우는 동안만 잠시 끈다
    has_link = "routine_id" in column_names(conn, "items")
    move_logs = """
        INSERT INTO routine_logs (routine_id, date, start_time, end_time, memo)
        SELECT i.routine_id, d.date, i.start_time, i.end_time, i.memo
        FROM items i JOIN item_dates d ON d.item_id = i.id
        WHERE i.routine_id IN (SELECT id FROM routines);
        DELETE FROM item_dates WHERE item_id IN (SELECT id FROM items WHERE routine_id IN (SELECT id FROM routines));
        DELETE FROM items WHERE routine_id IN (SELECT id FROM routines);
        UPDATE items SET routine_id = NULL;
    """ if has_link else ""
    conn.executescript(f"""
        BEGIN;
        CREATE TABLE routines_new (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT    NOT NULL,
            emoji    TEXT    NOT NULL DEFAULT '⭐',
            position INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO routines_new (id, name, position) SELECT id, name, position FROM routines;
        DROP TABLE routines;
        ALTER TABLE routines_new RENAME TO routines;
        {move_logs}
        COMMIT;
    """)
    for row in conn.execute("SELECT id, name FROM routines").fetchall():
        conn.execute("UPDATE routines SET emoji = ? WHERE id = ?", (guess_emoji(row["name"]), row["id"]))
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")


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


def current_version(db):
    return db.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()["value"]


def bump_version(db):
    db.execute("UPDATE meta SET value = value + 1 WHERE key = 'version'")
    db.commit()
