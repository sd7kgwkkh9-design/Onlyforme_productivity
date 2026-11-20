"""
데이터베이스(SQLite) 연결과 테이블 생성을 담당하는 모듈.

테이블 구조
-----------
categories  : 카테고리 (이름, 색상, 기본 카테고리 여부)
items       : 일정/할 일 본체 (제목, 메모, 카테고리, 시작·끝 시각, 할 일 완료 시각)
item_dates  : 일정이 들어간 날짜들 (일정 하나에 날짜 여러 개 가능)
              + 그 날짜 안에서의 표시 순서(position)

routines     : 루틴 — 자주 하는 활동(🏃 운동, 📖 독서 …). 카테고리 대신 이모지 하나 (8차에서 바뀜)
routine_logs : 루틴 기록 — 그날 그 루틴을 했다는 기록 (시간·메모는 선택). 일정(items)과는 따로 둔다 (8차)
notes        : 메모장의 '노트'(0.12까지 '메모') — 여러 개. 그중 하나(is_main)의 banner가 달력 위 배너에 보인다 (7차)
goals        : 메모장의 '목표' — 제목 + 기한(선택). 기한이 있으면 달력 위 D-day 띠에 보인다 (0.9.0)
               0.11.0부터 세 단계: 인생 목표(life) → 올해 목표(year) → 기한 목표(due). parent_id로 위 단계와 잇는다.
               올해 목표는 진행 방식(measure)이 셋: 체크(check) / 숫자(count: current/target) / 루틴 연결(routine: 그 해의 루틴 기록 수)
day_marks    : 달력 꾸미기 — 날짜에 붙인 스티커(이모지) (0.11.0. color 칸은 0.14.0에서 뺀 형광펜의 흔적)
links        : 밖에서 여는 주소 (0.12.0) — 보기 전용 공유 링크(share), 캘린더 구독(ics), 홈 화면 위젯(widget).
               주소에 들어가는 무작위 토큰이 곧 열쇠다. 지우면 그 주소는 바로 막힌다.
passkeys     : 패스키 (0.12.0) — Face ID·지문으로 로그인. 공개 키만 저장한다 (비밀 키는 기기 밖으로 나오지 않는다).

0.13.0에서 늘어난 표
habits / habit_logs   : 습관 — 하루에 몇 번 하는 생활 습관(💧 물 8잔). 날짜마다 한 횟수만 저장한다 (자정이 지나면 0부터)
timetables            : 시간표 — '2학기 수업', '학원', '알바'처럼 매주 반복되는 틀. 기간(시작~끝)과 '공휴일엔 쉬기'
timetable_blocks      : 시간표 칸 — 요일 하나 + 시작·끝 시간 + 이름·장소. 날짜마다 저장하지 않고 '규칙'으로 둔다
timetable_skips       : 시간표의 '이날만 쉬기' (칸 하나 또는 그 시간표 전체)
anniversaries         : 기념일 — 생일·기념일(매년, 음력 가능), 날짜 세기(만난 지 100일, 500일 …)
projects              : 프로젝트 — 몇 월까지 진행하는 일. 기간(정확한 날짜 또는 '1월 중'처럼 대략), 상태.
                        세부 할 일과 연결한 일정은 items.project_id로 잇는다
items.urgent          : 급한 할 일(⚡) — 첫 화면 '오늘 챙길 것' 줄에 보인다

0.14.0에서 늘어난 표
diaries               : 일기 — 날짜마다 하나(쓰고 싶은 날만). 본문 + 기분 이모지(선택). 공유 링크·구독·위젯에는 나가지 않는다

meta        : 변경 번호(version) — 일정·카테고리·루틴·메모가 바뀔 때마다 1씩 커진다.
              다른 기기는 이 번호만 가끔 확인해서, 바뀌었을 때만 새로 불러온다 (기기 간 동기화).

item_dates에 줄이 하나도 없는 일정 = 메모장의 "할 일"이다 (0.8까지는 '기한 미정'이라고 불렀다).
할 일은 체크하면 done_at에 완료 시각이 들어가고, 날짜를 정해 주면 그대로 달력의 일정이 된다.
반복 일정(매주·격주)도 따로 표를 두지 않고 '날짜 여러 개짜리 일정'으로 저장한다 (0.9.0).
"""

import json
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
    dday        INTEGER NOT NULL DEFAULT 0,   -- 1이면 달력 위 D-day 띠에 표시 (7차)
    done_at     TEXT,                         -- 할 일(날짜 없는 일정)을 체크한 시각, 안 했으면 NULL (0.9.0)
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

CREATE TABLE IF NOT EXISTS goals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    due         TEXT,                         -- 기한 'YYYY-MM-DD' 또는 NULL (기한 없음)
    memo        TEXT    NOT NULL DEFAULT '',
    done_at     TEXT,                         -- 이룬 시각, 아직이면 NULL
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    kind        TEXT    NOT NULL DEFAULT 'due',   -- 'life'(인생) | 'year'(올해) | 'due'(기한 목표) (0.11.0)
    year        INTEGER,                          -- 올해 목표의 연도 (kind='year'일 때만)
    parent_id   INTEGER,                          -- 위 단계 목표 (올해 → 인생, 기한 → 올해). 없으면 NULL
    measure     TEXT    NOT NULL DEFAULT 'check', -- 올해 목표의 진행 방식: 'check' | 'count' | 'routine'
    target      INTEGER,                          -- 목표 숫자 (count·routine)
    current     INTEGER NOT NULL DEFAULT 0,       -- 지금까지 (count만. routine은 루틴 기록에서 센다)
    routine_id  INTEGER                           -- 연결한 루틴 (routine)
);

CREATE TABLE IF NOT EXISTS day_marks (
    date        TEXT PRIMARY KEY,                 -- 'YYYY-MM-DD'
    sticker     TEXT NOT NULL DEFAULT '',         -- 이모지 하나 (없으면 '')
    color       TEXT NOT NULL DEFAULT ''          -- 0.11.0~0.13.0의 형광펜 색 (0.14.0에서 뺐다 — 늘 '')
);

CREATE TABLE IF NOT EXISTS links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL,                 -- 'share' | 'ics' | 'widget'
    token       TEXT    NOT NULL UNIQUE,          -- 주소에 들어가는 무작위 열쇠
    label       TEXT    NOT NULL DEFAULT '',      -- 내가 알아보기 위한 이름 (예: 가족용)
    options     TEXT    NOT NULL DEFAULT '{}',    -- JSON: 보여 줄 카테고리, 메모 공개, 알림 등
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_used_at TEXT                             -- 마지막으로 누가 열어 본 때 (대략)
);

CREATE TABLE IF NOT EXISTS passkeys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id TEXT    NOT NULL UNIQUE,        -- base64url
    public_key    BLOB    NOT NULL,
    sign_count    INTEGER NOT NULL DEFAULT 0,
    label         TEXT    NOT NULL DEFAULT '',    -- 예: 'iPhone', 'MacBook'
    transports    TEXT    NOT NULL DEFAULT '[]',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS habits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    emoji       TEXT    NOT NULL DEFAULT '✅',
    target      INTEGER NOT NULL DEFAULT 1,       -- 하루 목표 횟수 (물 8잔이면 8)
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id    INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date        TEXT    NOT NULL,                 -- 'YYYY-MM-DD'
    count       INTEGER NOT NULL DEFAULT 0,       -- 그날 한 횟수
    PRIMARY KEY (habit_id, date)
);

CREATE TABLE IF NOT EXISTS timetables (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    color         TEXT    NOT NULL DEFAULT '#3D6FD9',
    start_date    TEXT,                           -- 이 날부터 (없으면 처음부터)
    end_date      TEXT,                           -- 이 날까지 (포함, 없으면 계속)
    skip_holidays INTEGER NOT NULL DEFAULT 1,     -- 1이면 공휴일에는 쉰다
    position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timetable_blocks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timetable_id  INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    title         TEXT    NOT NULL,
    weekday       INTEGER NOT NULL,               -- 0=일 1=월 … 6=토 (화면의 요일 번호와 같다)
    start_time    TEXT    NOT NULL,               -- 'HH:MM'
    end_time      TEXT    NOT NULL,
    place         TEXT    NOT NULL DEFAULT '',    -- 강의실·장소
    memo          TEXT    NOT NULL DEFAULT '',
    color         TEXT                            -- 없으면 시간표의 색
);
CREATE INDEX IF NOT EXISTS idx_blocks_timetable ON timetable_blocks(timetable_id);

CREATE TABLE IF NOT EXISTS timetable_skips (
    timetable_id  INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    block_id      INTEGER NOT NULL DEFAULT 0,     -- 0이면 그 시간표 전체를 쉰다
    date          TEXT    NOT NULL,
    PRIMARY KEY (timetable_id, block_id, date)
);

CREATE TABLE IF NOT EXISTS anniversaries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    emoji       TEXT    NOT NULL DEFAULT '🎉',
    kind        TEXT    NOT NULL DEFAULT 'yearly', -- 'birthday'(생일) | 'yearly'(기념일, N주년) | 'days'(날짜 세기)
    date        TEXT    NOT NULL,                  -- 처음 그날. 음력이면 음력 날짜 그대로 'YYYY-MM-DD'
    lunar       INTEGER NOT NULL DEFAULT 0,        -- 1이면 음력 (생일·기념일만)
    leap        INTEGER NOT NULL DEFAULT 0,        -- 1이면 윤달
    from_one    INTEGER NOT NULL DEFAULT 1,        -- 날짜 세기: 1이면 그날을 1일로 센다 (사귄 날 = 1일)
    dday        INTEGER NOT NULL DEFAULT 1,        -- 1이면 다가올 때 달력 위 띠에 D-day로 (dday_days > 0과 늘 같게 둔다)
    dday_days   INTEGER NOT NULL DEFAULT 30,       -- 0.14.2: 며칠 전부터 띠에 띄울지 (0 = 안 띄움, 7·14·30·60·100)
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'active', -- 'active'(진행 중) | 'paused'(잠시 멈춤) | 'done'(끝남)
    start_date  TEXT,                              -- 기간 (타임라인에 그릴 때 쓴다)
    end_date    TEXT,
    period      TEXT    NOT NULL DEFAULT '',       -- '1월 중', '겨울방학'처럼 대략 적은 기간 (정확한 날짜면 '')
    memo        TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT '#7C5CD6',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    done_at     TEXT
);

CREATE TABLE IF NOT EXISTS diaries (
    date        TEXT PRIMARY KEY,                  -- 'YYYY-MM-DD' (하루에 하나)
    body        TEXT    NOT NULL DEFAULT '',
    mood        TEXT    NOT NULL DEFAULT '',       -- 기분 이모지 하나 (고르지 않으면 '')
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 0.14.2: 메모장의 '나' 탭 — 나를 적어 두는 칸들. 칸마다 종류가 있다:
--   fields(이름: 내용 줄), lists(분류마다 칩 — 좋아하는 운동: 수영, 러닝), text(긴 글)
CREATE TABLE IF NOT EXISTS about_sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    kind        TEXT    NOT NULL DEFAULT 'lists',  -- 'fields' | 'lists' | 'text'
    data        TEXT    NOT NULL DEFAULT '[]',     -- JSON. fields: [{label, value}], lists: [{label, items: [..]}], text: "글"
    position    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 0.14.2: 메모장의 '살 것' — 구매 예정 목록
CREATE TABLE IF NOT EXISTS wishlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    price       INTEGER,                           -- 원. 모르면 NULL
    url         TEXT    NOT NULL DEFAULT '',       -- 상품 페이지 (http/https만)
    starred     INTEGER NOT NULL DEFAULT 0,        -- 1이면 ⭐ 꼭 살 것 (맨 위로)
    when_text   TEXT    NOT NULL DEFAULT '',       -- 언제쯤: '12월', '세일하면'
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
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
      - items.done_at        : 할 일 완료 시각 (0.9.0)
      - goals                : 목표 표 (0.9.0) — SCHEMA의 CREATE TABLE IF NOT EXISTS가 새로 만들어 준다
      - goals.kind 등 7칸     : 인생·올해 목표 (0.11.0). 예전 목표는 모두 '기한 목표'(due)로 남는다
      - day_marks            : 달력 꾸미기 표 (0.11.0) — SCHEMA가 새로 만들어 준다
      - links, passkeys      : 공유 링크·구독·위젯, 패스키 (0.12.0) — SCHEMA가 새로 만들어 준다
      - items.urgent, items.project_id : 급한 할 일, 프로젝트 (0.13.0). 습관·시간표·기념일·프로젝트 표는 SCHEMA가 만든다
      - day_marks.color      : 형광펜을 0.14.0에서 뺐다 → 칠해 둔 색을 비우고, 스티커 없이 색만 있던 날은 지운다
      - diaries              : 일기 (0.14.0) — SCHEMA가 새로 만들어 준다
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
    if "done_at" not in column_names(conn, "items"):
        conn.execute("ALTER TABLE items ADD COLUMN done_at TEXT")
    item_cols = column_names(conn, "items")
    if "urgent" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0")
    if "project_id" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN project_id INTEGER")
    goal_cols = column_names(conn, "goals")
    for name, definition in GOAL_COLUMNS_V11:
        if name not in goal_cols:
            conn.execute(f"ALTER TABLE goals ADD COLUMN {name} {definition}")
    # 0.14.2: 기념일마다 'D-day를 며칠 전부터 띄울지'. 예전 켬(1) → 30일 전부터, 끔(0) → 안 띄움.
    # 예전 백업 파일을 되살린 경우(dday_days 칸이 없어서 기본값 30이 들어감)도 이 두 줄로 맞춰진다.
    if "dday_days" not in column_names(conn, "anniversaries"):
        conn.execute("ALTER TABLE anniversaries ADD COLUMN dday_days INTEGER NOT NULL DEFAULT 30")
    conn.execute("UPDATE anniversaries SET dday_days = 0 WHERE dday = 0 AND dday_days != 0")
    conn.execute("UPDATE anniversaries SET dday_days = 30 WHERE dday = 1 AND dday_days = 0")
    conn.execute("DELETE FROM day_marks WHERE sticker = ''")
    conn.execute("UPDATE day_marks SET color = '' WHERE color != ''")


GOAL_COLUMNS_V11 = [
    ("kind", "TEXT NOT NULL DEFAULT 'due'"),
    ("year", "INTEGER"),
    ("parent_id", "INTEGER"),
    ("measure", "TEXT NOT NULL DEFAULT 'check'"),
    ("target", "INTEGER"),
    ("current", "INTEGER NOT NULL DEFAULT 0"),
    ("routine_id", "INTEGER"),
]


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


# '나' 탭을 처음 열면 보이는 칸들 (0.14.2) — 비워 둔 채로 시작하고, 이름·순서·칸은 마음대로 바꿀 수 있다
ABOUT_DEFAULT = [
    ("기본 정보", "fields", [{"label": k, "value": ""} for k in ("이름", "생일", "사는 곳", "학교 · 일", "MBTI")]),
    ("좋아하는 것", "lists", [{"label": k, "items": []} for k in ("운동", "브랜드", "음식", "음악", "영화 · 드라마", "책", "장소", "캐릭터")]),
    ("싫어하는 것", "lists", [{"label": k, "items": []} for k in ("음식", "그 밖에")]),
    ("요즘 빠진 것", "lists", [{"label": k, "items": []} for k in ("노래", "보는 것", "하는 것")]),
    ("자유롭게", "text", ""),
]


def seed_about(conn):
    """'나' 탭의 기본 칸을 한 번만 넣는다 (다 지운 뒤에 다시 생기지 않게 meta에 표시)"""
    if conn.execute("SELECT 1 FROM meta WHERE key = 'about_seeded'").fetchone():
        return
    if not conn.execute("SELECT 1 FROM about_sections").fetchone():
        for i, (title, kind, data) in enumerate(ABOUT_DEFAULT):
            conn.execute(
                "INSERT INTO about_sections (title, kind, data, position) VALUES (?, ?, ?, ?)",
                (title, kind, json.dumps(data, ensure_ascii=False), i),
            )
    conn.execute("INSERT INTO meta (key, value) VALUES ('about_seeded', 1)")


def init_db(path):
    """테이블이 없으면 만들고, 기본 카테고리 '미분류'가 없으면 넣는다."""
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        migrate(conn)
        seed_about(conn)
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
