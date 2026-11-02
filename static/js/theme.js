// 화면 테마: 시스템 설정 / 라이트 / 다크
//
// - 고른 테마는 기기(브라우저)마다 따로 저장된다. 폰은 다크, 맥은 라이트처럼 쓸 수 있다.
// - 실제 색은 style.css의 색 변수가 바꾼다. 여기서는 <html data-theme="...">만 바꾼다.
// - 화면이 처음 그려지기 전에 적용하는 코드는 templates/_head.html에 따로 있다 (흰 화면 번쩍임 방지).

import { icon, toast } from './utils.js';

const KEY = 'my-calendar:theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const LABEL = { auto: '시스템 설정', light: '라이트', dark: '다크' };
const ICON = {
  auto: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 3v18',
  light: 'M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  dark: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
};
// 휴대폰 상태 표시줄 색 (style.css의 --paper와 같은 값)
const BAR_COLOR = { light: '#F4F6F9', dark: '#111419' };

let mode = 'auto';
let button;
let menu;

function read() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

function save(value) {
  try {
    if (value === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* 저장 못 해도 이번 화면에는 적용됨 */ }
}

function isDark() {
  return mode === 'dark' || (mode === 'auto' && darkQuery.matches);
}

function apply() {
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;

  const color = BAR_COLOR[isDark() ? 'dark' : 'light'];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));

  button.replaceChildren(icon(ICON[mode]));
  button.setAttribute('aria-label', `화면 테마: ${LABEL[mode]}`);
  button.title = `화면 테마: ${LABEL[mode]}`;
  menu.querySelectorAll('[data-theme-choice]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.themeChoice === mode));
  });
}

function choose(value) {
  mode = value;
  save(value);
  apply();
  toast(value === 'auto' ? '기기 설정에 맞춰 바뀌어요' : `${LABEL[value]} 모드`);
}

// 메뉴를 버튼 바로 아래, 오른쪽 끝을 맞춰서 띄운다.
function placeMenu() {
  const r = button.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
}

export function initTheme() {
  button = document.getElementById('btn-theme');
  menu = document.getElementById('theme-menu');
  mode = read();
  apply();

  menu.querySelectorAll('[data-theme-choice]').forEach((b) =>
    b.addEventListener('click', () => {
      choose(b.dataset.themeChoice);
      menu.hidePopover?.();
    }),
  );

  if (typeof menu.showPopover === 'function') {
    // 버튼의 popovertarget으로 열리고, 바깥을 누르거나 Esc를 누르면 저절로 닫힌다.
    menu.addEventListener('beforetoggle', (e) => {
      if (e.newState === 'open') placeMenu();
      button.setAttribute('aria-expanded', String(e.newState === 'open'));
    });
  } else {
    // 아주 오래된 브라우저: 메뉴 대신 누를 때마다 시스템 → 라이트 → 다크 순으로 바꾼다.
    button.removeAttribute('popovertarget');
    const order = ['auto', 'light', 'dark'];
    button.addEventListener('click', () => choose(order[(order.indexOf(mode) + 1) % order.length]));
  }

  // '시스템 설정'일 때 기기가 다크/라이트로 바뀌면 상태 표시줄 색도 따라 바꾼다.
  darkQuery.addEventListener('change', apply);
}
