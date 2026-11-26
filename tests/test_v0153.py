"""0.15.3 — 카테고리 색 12가지, 일정 창의 메모 자리, 메모장 '나중에', 연도 고르기, 일기 기분 18가지, 반복하는 일"""

import itertools
import math
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


# ================================================================ 반복하는 일
def add(client, **payload):
    res = client.post("/api/repeats", json={"title": "분리수거", **payload})
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def dates(client, start, end):
    return [(r["date"], r["title"]) for r in client.get(f"/api/calendar?start={start}&end={end}").get_json()["repeats"]]


def test_weekly_repeat_shows_on_its_weekdays(client):
    r = add(client, freq="weekly", weekdays=[1, 4], start="2026-11-01", time="09:00", emoji="🗑️")
    assert r["label"] == "매주 월·목" and r["time"] == "09:00"
    got = dates(client, "2026-11-01", "2026-11-15")
    assert [d for d, _ in got] == ["2026-11-02", "2026-11-05", "2026-11-09", "2026-11-12"]   # 월·목
    day = client.get("/api/day/2026-11-09").get_json()
    assert day["repeats"][0]["title"] == "분리수거" and day["repeats"][0]["emoji"] == "🗑️"


def test_biweekly_counts_from_the_start_week(client):
    add(client, title="동아리", freq="weekly", weekdays=[2], interval=2, start="2026-11-03")   # 11/3(화)부터 격주
    got = [d for d, _ in dates(client, "2026-11-01", "2026-12-15")]
    assert got == ["2026-11-03", "2026-11-17", "2026-12-01", "2026-12-15"][:3]


def test_monthly_repeat_clamps_to_short_months_and_last_day(client):
    add(client, title="월세", freq="monthly", month_day=31, start="2026-01-01")
    add(client, title="카드값", freq="monthly", month_day=0, start="2026-01-01")
    got = dates(client, "2026-02-01", "2026-05-01")
    rent = [d for d, t in got if t == "월세"]
    card = [d for d, t in got if t == "카드값"]
    assert rent == ["2026-02-28", "2026-03-31", "2026-04-30"]      # 그달에 없는 31일은 마지막 날로
    assert card == ["2026-02-28", "2026-03-31", "2026-04-30"]
    labels = {r["title"]: r["label"] for r in client.get("/api/repeats?today=2026-11-26").get_json()}
    assert labels == {"월세": "매달 31일", "카드값": "매달 마지막 날"}


def test_repeat_has_no_end_unless_given(client):
    r = add(client, title="월세", freq="monthly", month_day=25, start="2026-11-01")
    assert dates(client, "2031-03-01", "2031-04-01") == [("2031-03-25", "월세")]            # 몇 년 뒤에도 (날짜를 저장하지 않으니 끝이 없다)
    client.put(f"/api/repeats/{r['id']}", json={"end": "2026-12-31"})
    assert dates(client, "2027-01-01", "2027-03-01") == []
    listed = client.get("/api/repeats?today=2027-01-05").get_json()[0]
    assert listed["next"] is None and listed["end"] == "2026-12-31"


def test_repeat_validation(client):
    bad = [
        {"title": "", "freq": "weekly", "weekdays": [1]},
        {"title": "x", "freq": "weekly", "weekdays": []},
        {"title": "x", "freq": "daily"},
        {"title": "x", "freq": "weekly", "weekdays": [7]},
        {"title": "x", "freq": "weekly", "weekdays": [1], "interval": 3},
        {"title": "x", "freq": "monthly", "month_day": 32},
        {"title": "x", "freq": "weekly", "weekdays": [1], "time": "25:00"},
        {"title": "x", "freq": "weekly", "weekdays": [1], "start": "2026-11-10", "end": "2026-11-01"},
        {"title": "x", "freq": "weekly", "weekdays": [1], "emoji": "글자"},
    ]
    for payload in bad:
        assert client.post("/api/repeats", json=payload).status_code == 400, payload
    assert client.put("/api/repeats/999", json={"title": "x"}).status_code == 404


def test_repeat_edit_delete_search_and_backup(client):
    r = add(client, freq="weekly", weekdays=[1], start="2026-11-01", memo="재활용은 목요일")
    assert client.put(f"/api/repeats/{r['id']}", json={"freq": "monthly", "month_day": 10}).get_json()["label"] == "매달 10일"
    groups = {g["kind"]: g for g in client.get("/api/search?q=재활용").get_json()["groups"]}
    assert groups["repeat"]["results"][0]["sub"] == "매달 10일"
    data = client.get("/api/backup").get_json()
    assert data["tables"]["repeats"][0]["title"] == "분리수거"
    # 반복 표가 없던 예전 백업을 되살려도 지금 반복은 남는다
    old = {k: v for k, v in data.items() if k != "tables"} | {"tables": {k: v for k, v in data["tables"].items() if k != "repeats"}}
    assert client.post("/api/backup/restore", json=old).status_code == 200
    assert len(client.get("/api/repeats").get_json()) == 1
    assert client.delete(f"/api/repeats/{r['id']}").status_code == 200
    assert client.get("/api/repeats").get_json() == []


def test_repeats_client_is_wired():
    main = read("static", "js", "main.js")
    assert "repeats: () => import('./repeats.js')" in main and "item('🔁', '반복'" in main
    assert "...repeats.map(toRepeatEvent)," in main and "kind === 'repeat'" in main
    assert "repeatLine" in read("static", "js", "sheet.js") and "repeatsOf" in read("static", "js", "week.js")
    assert "'repeats.js']" in read("templates", "index.html")                       # 누를 때만 받는다


# ================================================================ 카테고리 색
def _oklab(h):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))
    l, m, s = (x ** (1 / 3) for x in (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
                                      0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
                                      0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b))
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def test_category_palette_is_twelve_distinct_colors():
    js = read("static", "js", "sheet.js")
    palette = re.findall(r"#[0-9A-F]{6}", re.search(r"const PALETTE = \[(.*?)\];", js).group(1))
    spread = re.findall(r"#[0-9A-F]{6}", re.search(r"const SPREAD = \[(.*?)\];", js).group(1))
    assert len(palette) == 12 and sorted(spread) == sorted(palette)                   # 골고루 나누기도 같은 12색
    closest = min(math.dist(_oklab(a), _oklab(b)) for a, b in itertools.combinations(palette, 2))
    assert closest > 0.1                                                              # 예전 8색은 0.074 (주황·노랑)
    assert "spreadColors()" in js and "'🎨 색 골고루 나누기'" in js
    css = read("static", "css", "style.css")
    assert "background: color-mix(in srgb, var(--cat, #9AA0AA) 19%, var(--surface));" in css   # 달력 칸이 더 진하게


# ================================================================ 작은 다듬기
def test_item_form_memo_sits_under_the_title():
    js = read("static", "js", "sheet.js")
    form = js[js.index("const form = el('form', { id: ids.form"):]
    assert form.index("field('제목'") < form.index("field('메모'") < form.index("fieldset('카테고리'")


def test_notes_todo_tab_is_called_later_and_sits_next_to_all():
    html = read("templates", "index.html")
    tabs = re.findall(r'data-tab="(\w+)"', html)
    assert tabs[:2] == ["all", "todo"] and ">나중에</button>" in html and ">할 일</button>" not in html
    assert "todo: '나중에'" in read("static", "js", "notes.js")


def test_jump_menu_can_pick_a_year():
    js = read("static", "js", "jump.js")
    assert "function renderYears()" in js and "openYears" in js and "'올해로'" in js
    assert "yearsFrom -= 12" in js and "yearsFrom += 12" in js


def test_diary_has_eighteen_named_moods():
    js = read("static", "js", "diary.js")
    pairs = re.findall(r"\['(.+?)', '(.+?)'\]", js[js.index("const MOOD_LIST"):js.index("export const MOODS")])
    assert len(pairs) == 18 and len({m for m, _ in pairs}) == 18
    for old in ["😊", "😆", "🥰", "😌", "😐", "😔", "😢", "😡", "😴", "🤒"]:          # 예전 기분도 그대로 있다
        assert old in {m for m, _ in pairs}
    assert "title: MOOD_NAME[m]" in js
