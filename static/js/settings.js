// ⚙ 설정 메뉴: 화면 테마 / 글꼴 / 이 기기에서 로그아웃
//
// - 테마와 글꼴은 기기(브라우저)마다 따로 저장된다. 폰은 다크+주아, 맥은 라이트+Pretendard처럼 쓸 수 있다.
// - 실제 색·글꼴은 style.css가 바꾼다. 여기서는 <html data-theme="..." data-font="...">만 바꾼다.
// - 화면이 처음 그려지기 전에 적용하는 코드는 templates/_head.html에 따로 있다 (번쩍임 방지).

import { el, icon, toast } from './utils.js';

const THEME_KEY = 'my-calendar:theme';
const FONT_KEY = 'my-calendar:font';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const THEMES = [
  ['auto', '시스템 설정 따라가기'],
  ['light', '라이트'],
  ['dark', '다크'],
];

// 글꼴: [키, 메뉴 이름, CSS font-family]. Pretendard 외에는 고를 때 그 글꼴 파일만 불러온다.
const FONTS = [
  ['pretendard', 'Pretendard (기본)', "'Pretendard Variable'"],
  ['gowun-dodum', '고운돋움', "'Gowun Dodum'"],
  ['gowun-batang', '고운바탕', "'Gowun Batang'"],
  ['jua', '주아', "'Jua'"],
  ['noto-sans-kr', 'Noto Sans KR', "'Noto Sans KR Variable'"],
];

// 휴대폰 상태 표시줄 색 (style.css의 --paper와 같은 값)
const BAR_COLOR = { light: '#F4F6F9', dark: '#111419' };

let theme = 'auto';
let font = 'pretendard';
let button;
let menu;

// ---------------------------------------------------------------- 저장
function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value, fallback) {
  try {
    if (value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 저장 못 해도 이번 화면에는 적용됨 */ }
}

// ---------------------------------------------------------------- 적용
function isDark() {
  return theme === 'dark' || (theme === 'auto' && darkQuery.matches);
}

function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const color = BAR_COLOR[isDark() ? 'dark' : 'light'];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

// 글꼴 파일(CSS)을 아직 안 불러왔으면 <link>를 붙인다. _head.html의 초기 코드와 같은 id를 쓴다.
function loadFontCss(key) {
  if (key === 'pretendard' || document.getElementById(`font-css-${key}`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.id = `font-css-${key}`;
  link.href = `${document.documentElement.dataset.fontBase}${key}/font.css`;
  document.head.append(link);
}

function applyFont() {
  loadFontCss(font);
  if (font === 'pretendard') delete document.documentElement.dataset.font;
  else document.documentElement.dataset.font = font;
}

// ---------------------------------------------------------------- 메뉴
function renderMenu(loginEnabled) {
  const choice = (group, value, label, current, onPick, style) =>
    el('button', {
      type: 'button',
      role: 'menuitemradio',
      class: 'menu-choice',
      dataset: { [group]: value },
      'aria-checked': String(value === current),
      style,
      onclick: () => onPick(value),
    }, label);

  const parts = [
    el('p', { class: 'menu-label', id: 'menu-label-theme' }, '화면 테마'),
    el('div', { role: 'group', 'aria-labelledby': 'menu-label-theme' },
      THEMES.map(([v, label]) => choice('themeChoice', v, label, theme, pickTheme))),
    el('p', { class: 'menu-label', id: 'menu-label-font' }, '글꼴'),
    el('div', { role: 'group', 'aria-labelledby': 'menu-label-font' },
      FONTS.map(([v, label, family]) =>
        choice('fontChoice', v, label, font, pickFont, { 'font-family': `${family}, var(--font-fallback)` }))),
    loginEnabled
      ? el('form', { class: 'menu-logout', method: 'post', action: '/logout' },
          el('button', { type: 'submit', role: 'menuitem', class: 'menu-choice danger' }, '이 기기에서 로그아웃'))
      : null, // 로그인을 쓰지 않으면(비밀번호 없이 내 컴퓨터에서 실행) 로그아웃은 없다
  ];
  menu.replaceChildren(...parts.filter(Boolean));
}

function refreshChecks() {
  menu.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme)));
  menu.querySelectorAll('[data-font-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fontChoice === font)));
}

function pickTheme(value) {
  theme = value;
  save(THEME_KEY, value, 'auto');
  applyTheme();
  refreshChecks();
  toast(value === 'auto' ? '기기 설정에 맞춰 바뀌어요' : `${THEMES.find(([v]) => v === value)[1]} 모드`);
}

function pickFont(value) {
  font = value;
  save(FONT_KEY, value, 'pretendard');
  applyFont();
  refreshChecks();
  toast(`글꼴: ${FONTS.find(([v]) => v === value)[1].replace(' (기본)', '')}`);
}

// 메뉴를 버튼 바로 아래, 오른쪽 끝을 맞춰서 띄운다.
function placeMenu() {
  const r = button.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
}

export function initSettings({ loginEnabled = false } = {}) {
  button = document.getElementById('btn-settings');
  menu = document.getElementById('settings-menu');
  theme = read(THEME_KEY, ['light', 'dark'], 'auto');
  font = read(FONT_KEY, FONTS.map(([v]) => v), 'pretendard');
  applyTheme();
  applyFont();

  button.replaceChildren(icon(
    'M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z' +
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ));
  renderMenu(loginEnabled);

  if (typeof menu.showPopover === 'function') {
    // 버튼의 popovertarget으로 열리고, 바깥을 누르거나 Esc를 누르면 저절로 닫힌다.
    menu.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      button.setAttribute('aria-expanded', String(open));
      if (!open) return;
      placeMenu();
      FONTS.forEach(([v]) => loadFontCss(v)); // 메뉴 글자를 각 글꼴로 미리 보여 주려고 (필요한 글자 조각만 받는다)
    });
  } else {
    // 아주 오래된 브라우저: 메뉴 대신 누를 때마다 테마를 시스템 → 라이트 → 다크 순으로 바꾼다.
    button.removeAttribute('popovertarget');
    const order = THEMES.map(([v]) => v);
    button.addEventListener('click', () => pickTheme(order[(order.indexOf(theme) + 1) % order.length]));
  }

  // '시스템 설정'일 때 기기가 다크/라이트로 바뀌면 상태 표시줄 색도 따라 바꾼다.
  darkQuery.addEventListener('change', applyTheme);
}
