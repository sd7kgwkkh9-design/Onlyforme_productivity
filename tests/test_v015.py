"""0.15.0 — 끌어서 놓기(옮기기·복사 고르기, 오른쪽 칸 ↔ 달력), 체크 빼기, 단축키 목록, 글꼴 4개, 테마 대비 2차, 윈도우 점검"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


# ================================================================ 할 일 숫자 · 체크 빼기
def test_no_todo_badge(client):
    html = client.get("/").get_data(as_text=True)
    assert 'id="todo-count"' not in html and "tool-count" not in html
    assert 'data-tab="todo" aria-selected="false">할 일</button>' in html
    notes = read("static", "js", "notes.js")
    assert "updateBadge() {}" in notes and "has-urgent" not in notes
    assert "has-urgent" not in read("static", "css", "style.css")


def test_goals_and_wishlist_have_no_check():
    notes = read("static", "js", "notes.js")
    assert "checkbox(g.done" not in notes                                   # 목표에는 체크가 없다
    assert "['check', '적어 두기']" in notes
    assert "g.done ? { label: '이룸 취소'" in notes                          # 예전에 체크해 둔 것만 되돌릴 수 있다
    wish = read("static", "js", "wishlist.js")
    assert "wish-bought" not in wish and "async function bought" not in wish
    assert "li.addEventListener('contextmenu'" in wish and "{ label: '삭제', danger: true, run: () => remove(w) }" in wish


# ================================================================ 단축키
def test_shortcuts_dialog_and_question_mark(client):
    js = read("static", "js", "shortcuts.js")
    assert "export function openShortcuts" in js
    assert "isMac ? k('⌥ Option') : k('Alt')" in js                         # 윈도우는 Alt
    main = read("static", "js", "main.js")
    assert "if (e.code === 'Slash') { e.preventDefault(); openShortcuts(); }" in main   # Shift + / = ?
    assert "if (e.code === 'Slash') { e.preventDefault(); openSearchBox(); return; }" in main
    assert "menu-shortcuts" in read("static", "js", "settings.js")
    css = read("static", "css", "style.css")
    assert "@media (hover: none), (max-width: 640px) { .menu-shortcuts { display: none !important; } }" in css
    html = client.get("/").get_data(as_text=True)
    assert 'rel="modulepreload"' in html and "shortcuts" not in "".join(re.findall(r'<link rel="modulepreload" href="([^"]+)"', html))


# ================================================================ 끌어서 놓기
def test_drop_choice_menu_and_pane_drag():
    ctx = read("static", "js", "ctxmenu.js")
    assert "export function chooseAt(" in ctx and ".ctx-item[data-key=" in ctx            # 고르기 메뉴의 글자 단축키 (C)
    main = read("static", "js", "main.js")
    assert "{ label: '옮기기', value: 'move', hint: 'Enter' }" in main
    assert "{ label: '복사', value: 'copy', key: 'KeyC', hint: 'C' }" in main
    assert "if (!action) { info.revert(); return; }" in main               # 취소하면 제자리로
    assert "const action = copyKey ? 'copy' : await chooseDrop(" in main     # Option·Alt 끌기는 묻지 않고 복사
    assert "paneDrop.finish(info)" in main and "paneDrag.current" in main   # 달력 → 오른쪽 칸, 오른쪽 칸 → 달력
    assert "dragToCalendar(li, { type: 'item'" in read("static", "js", "sheet.js")
    assert "dragToCalendar(li, { type: 'log'" in read("static", "js", "routines.js")
    utils = read("static", "js", "utils.js")
    assert "if (fromHandle) { e.preventDefault(); return; }" in utils       # ≡ 손잡이(순서 바꾸기)는 끌지 않는다


# ================================================================ 띠 · 윈도우
def test_year_goal_chip_looks_different_from_ddays():
    strip = read("static", "js", "strip.js")
    assert "`${year.year} 목표`" in strip
    css = read("static", "css", "style.css")
    assert "border-radius: 9px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line)); border-left: 4px solid var(--accent);" in css


def test_windows_marker_and_thin_scrollbars():
    assert "root.dataset.os = 'win'" in read("templates", "_head.html")
    assert ':root[data-os="win"] * { scrollbar-width: thin;' in read("static", "css", "style.css")


def test_no_stray_files_in_repo_root():
    for name in ("bk_confirm.png", "func14_backup.json"):
        assert not os.path.exists(os.path.join(ROOT, name)), name


# ================================================================ 테마 대비 2차
def _lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def _cr(a, b):
    x, y = sorted((_lum(a), _lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def _blocks(css):
    out = re.findall(r':root\[data-palette="([\w-]+)"\], \[data-swatch="[\w-]+"\] \{(.*?)\}', css, re.DOTALL)
    out.append(("light", css.split(":root {", 1)[1].split("\n}", 1)[0]))
    out.append(("dark", css.split(':root[data-theme="dark"] {', 1)[1].split("\n}", 1)[0]))
    return out


def test_theme_contrast_round_two():
    css = read("static", "css", "style.css")
    blocks = _blocks(css)
    assert len(blocks) == 11
    for name, body in blocks:
        v = {k: h for k, h in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", body)}
        for bg in ("surface", "paper"):
            assert _cr(v["ink"], v[bg]) >= 9, (name, "ink", bg)
            assert _cr(v["muted"], v[bg]) >= 6, (name, "muted", bg)
            assert _cr(v["faint"], v[bg]) >= 3.8, (name, "faint", bg)
            assert _cr(v["line"], v[bg]) >= 1.5, (name, "line", bg)
            for key in ("accent", "sun", "danger"):
                assert _cr(v[key], v[bg]) >= 5, (name, key, bg)
        assert _cr(v["accent"], v["on-accent"]) >= 4.5, (name, "on-accent")
