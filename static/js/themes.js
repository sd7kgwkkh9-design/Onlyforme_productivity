// 테마 (0.14.0) — VS Code 같은 에디터 테마의 색으로 캘린더 전체를 바꾼다.
//
// - '밝을 때 테마'와 '어두울 때 테마'를 따로 고른다 (VS Code의 선호 라이트/다크 테마처럼).
//   화면 모드가 '시스템 설정 따라가기'면 기기가 밝을 때·어두울 때 알아서 바뀐다. 예: 낮엔 Catppuccin Latte, 밤엔 Tokyo Night
// - 지금 밝은지 어두운지에 맞는 테마를 <html data-palette="…">로 붙이고, 실제 색은 style.css의 [data-palette]가 정한다.
//   기본 테마(만년필 파랑)는 data-palette가 없다. 화면이 그려지기 전에 붙이는 코드는 templates/_head.html에 따로 있다.
// - 기기(브라우저)마다 따로 저장된다. 0.11.0의 '색 테마'(포인트 색 6가지 + 나만의 색)는 이걸로 바꿨다.

import { el, fillDialog } from './utils.js';

export const LIGHT_KEY = 'my-calendar:theme-light';
export const DARK_KEY = 'my-calendar:theme-dark';

// [키, 이름, 포인트 색(홈 화면 위젯에도 쓴다)] — 'light'·'dark'는 기본 테마
export const LIGHT_THEMES = [
  ['light', '기본 (만년필 파랑)', '#2347C8'],
  ['latte', 'Catppuccin Latte', '#7F27EF'],
  ['tokyo-day', 'Tokyo Night Day', '#1658B6'],
  ['rose-dawn', 'Rosé Pine Dawn', '#A04D6C'],
  ['solarized-light', 'Solarized Light', '#256D96'],
];
export const DARK_THEMES = [
  ['dark', '기본 (만년필 파랑)', '#738BFF'],
  ['tokyo-night', 'Tokyo Night', '#7AA2F7'],
  ['tokyo-storm', 'Tokyo Night Storm', '#7AA2F7'],
  ['mocha', 'Catppuccin Mocha', '#CBA6F7'],
  ['nord', 'Nord', '#94C6D6'],
  ['dracula', 'Dracula', '#CAABF9'],
];

export const themeName = (key) => [...LIGHT_THEMES, ...DARK_THEMES].find(([k]) => k === key)?.[1].replace(' (만년필 파랑)', '') || '기본';

function stored(key, list, fallback) {
  try {
    const v = localStorage.getItem(key);
    return list.some(([k]) => k === v) ? v : fallback;
  } catch { return fallback; }
}
export const lightTheme = () => stored(LIGHT_KEY, LIGHT_THEMES, 'light');
export const darkTheme = () => stored(DARK_KEY, DARK_THEMES, 'dark');

/** 밝을 때(dark=false)·어두울 때(dark=true) 쓸 테마를 정해서 지금 화면에 붙인다 */
export function applyPalette(dark) {
  const key = dark ? darkTheme() : lightTheme();
  const root = document.documentElement;
  if (key === 'light' || key === 'dark') delete root.dataset.palette;
  else root.dataset.palette = key;
}

/** 홈 화면 위젯의 포인트 색 = 밝을 때 테마의 포인트 색 (links.js) */
export function accentHex() {
  const key = lightTheme();
  return LIGHT_THEMES.find(([k]) => k === key)[2];
}

// ---------------------------------------------------------------- 테마 고르는 창
let dialog = null;

/**
 * @param {object} o
 * @param {() => 'auto'|'light'|'dark'} o.mode   지금 화면 모드 (⚙ 설정의 '화면 테마')
 * @param {(mode) => void} o.setMode
 * @param {() => boolean} o.isDark                지금 어두운 화면인지
 * @param {() => void} o.onChanged                테마를 바꾼 뒤 (settings.js가 색을 다시 붙이고 메뉴 글자를 바꾼다)
 */
export function openThemePicker({ mode, setMode, isDark, onChanged }) {
  if (!dialog) {
    dialog = el('dialog', { class: 'themes', 'aria-labelledby': 'themes-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }

  const pick = (key, isDarkList) => {
    try { localStorage.setItem(isDarkList ? DARK_KEY : LIGHT_KEY, key); } catch { /* 저장 못 해도 이번 화면에는 */ }
    // 라이트·다크를 직접 골라 둔 상태면, 고른 테마가 보이도록 그쪽 모드로 바꾼다. '시스템'이면 기기에 맡긴다.
    if (mode() !== 'auto' && isDarkList !== isDark()) setMode(isDarkList ? 'dark' : 'light');
    onChanged();
    draw();
  };

  const card = (key, name, isDarkList) => {
    const current = isDarkList ? darkTheme() : lightTheme();
    const on = key === current;
    return el('button', {
      type: 'button', class: 'theme-card', 'aria-pressed': String(on), 'aria-label': `${isDarkList ? '어두울 때' : '밝을 때'} 테마: ${name}`,
      onclick: () => pick(key, isDarkList),
    },
      // 미리보기: 그 테마의 바탕·카드·글자·포인트 색 (style.css의 [data-swatch])
      el('span', { class: 'theme-swatch', dataset: { swatch: key }, 'aria-hidden': 'true' },
        el('span', { class: 'swatch-card' }, el('i'), el('i'), el('i', { class: 'sun' })),
        el('span', { class: 'swatch-side' }, el('span', { class: 'swatch-pill' }), el('span', { class: 'swatch-dots' }, el('i'), el('i')))),
      el('span', { class: 'theme-name' }, name, on ? el('span', { class: 'check', 'aria-hidden': 'true' }, '✓') : null));
  };

  function draw() {
    const m = mode();
    const dark = isDark();
    const note = m === 'auto'
      ? `기기 설정을 따라가요. 지금은 ${dark ? '어두운' : '밝은'} 화면이라 '${dark ? '어두울 때' : '밝을 때'}' 테마가 보여요.`
      : `지금은 ${m === 'dark' ? '다크' : '라이트'}로 고정이에요. 다른 쪽 테마를 누르면 그쪽으로 바뀌어요.`;
    fillDialog(dialog, el('div', { class: 'themes-inner' },
      el('header', { class: 'themes-head' },
        el('h2', { id: 'themes-title' }, '테마'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
      el('div', { class: 'seg themes-mode', role: 'group', 'aria-label': '화면 모드' },
        [['auto', '시스템 따라가기'], ['light', '라이트'], ['dark', '다크']].map(([v, label]) => el('button', {
          type: 'button', class: 'seg-btn', 'aria-pressed': String(m === v), onclick: () => { setMode(v); draw(); },
        }, label))),
      el('p', { class: 'themes-note' }, note),
      el('h3', { class: 'themes-label' }, '밝을 때', el('small', {}, '라이트')),
      el('div', { class: 'themes-grid' }, LIGHT_THEMES.map(([k, name]) => card(k, name, false))),
      el('h3', { class: 'themes-label' }, '어두울 때', el('small', {}, '다크')),
      el('div', { class: 'themes-grid' }, DARK_THEMES.map(([k, name]) => card(k, name, true))),
      el('p', { class: 'themes-note' }, '이 기기에만 저장돼요. 색은 각 테마의 공식 팔레트에서 가져왔어요.'),
    ));
  }

  draw();
  if (!dialog.open) dialog.showModal();
}
