// 단축키 목록 (0.15.0) — ⚙ 설정 → '⌨ 단축키…' 또는 키보드 ? (Shift + /)
//
// 맥과 윈도우는 키 이름이 다르다: 맥은 ⌥ Option, 윈도우는 Alt.
// 휴대폰에는 키보드가 없으니 메뉴에서도 숨긴다 (style.css의 .menu-shortcuts).

import { el, fillDialog } from './utils.js';

export const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);

// k('Shift', '/') → Shift + /   ·   each('←', '→') → ← →  (따로따로 누르는 키)
const k = (...keys) => keys.flatMap((key, i) => [i ? el('span', { class: 'kbd-plus', 'aria-hidden': 'true' }, '+') : null, el('kbd', {}, key)]);
const each = (...keys) => keys.map((key) => el('kbd', {}, key));

function groups() {
  // 윈도우의 Ctrl은 끌기 '전에' 누르면 달력이 끌기를 시작하지 않아서(FullCalendar 규칙) Alt만 적는다
  const copyKeys = isMac ? k('⌥ Option') : k('Alt');
  return [
    ['어디서나', [
      [k('N'), '빠른 입력 (한 줄로 일정 넣기)'],
      [k('/'), '검색'],
      [k('Shift', '/'), '이 단축키 목록 (?)'],
      [k('L'), '지금 잠그기 (로그인을 켰을 때)'],
      [each('←', '→'), '이전 · 다음 달 (주)'],
      [k('Esc'), '열린 창 · 메뉴 닫기'],
    ]],
    ['일정 끌어서 놓기', [
      [[...copyKeys, el('span', { class: 'kbd-or' }, ' 누르고 끌기')], '메뉴 없이 바로 복사'],
      [k('Enter'), '놓은 뒤 뜬 메뉴에서 옮기기'],
      [k('C'), '놓은 뒤 뜬 메뉴에서 복사'],
      [k('Esc'), '놓은 뒤 뜬 메뉴에서 취소 (제자리로)'],
    ]],
    ['목록 · 창 안에서', [
      [k('Enter'), '맨 위 입력칸에 적은 것 넣기 (메모장 · 살 것 · 검색)'],
      [each('↑', '↓'), '검색 결과 고르기 · ≡ 손잡이를 고른 뒤 순서 바꾸기'],
      [k('Shift', 'F10'), '오른쪽 클릭 메뉴 (고른 항목에서)'],
    ]],
  ];
}

let dialog = null;

export function openShortcuts() {
  if (!dialog) {
    dialog = el('dialog', { class: 'shortcuts', 'aria-labelledby': 'shortcuts-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  fillDialog(dialog, el('div', { class: 'shortcuts-inner' },
    el('header', { class: 'lk-head' },
      el('h2', { id: 'shortcuts-title' }, '단축키'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    el('p', { class: 'shortcuts-note' }, `${isMac ? '맥' : '윈도우'} 키보드 기준이에요. 글자 칸에 쓰는 중에는 한 글자 단축키가 동작하지 않아요. 한글 자판이어도 돼요.`),
    ...groups().map(([title, rows]) => el('section', { class: 'shortcuts-group' },
      el('h3', {}, title),
      el('dl', {}, ...rows.flatMap(([keys, what]) => [el('dt', {}, ...keys), el('dd', {}, what)])))),
  ));
  if (!dialog.open) dialog.showModal();
}
