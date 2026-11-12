// ⚙ 설정 메뉴: 화면 테마 / 색 / 배경 사진 / 글꼴 / 글자 크기 / 이번 주 한 걸음 / 이 기기에서 로그아웃 / 앱 이름과 버전
//
// - 테마·색·배경 사진·글꼴·글자 크기는 기기(브라우저)마다 따로 저장된다. 폰은 다크+주아+작게, 맥은 라이트+Pretendard+보통처럼 쓸 수 있다.
// - 실제 색·글꼴·크기는 style.css가 바꾼다. 여기서는 <html data-theme data-color data-bg data-font data-fs>만 바꾼다.
// - 색 테마(0.11.0): 라이트/다크와 따로 고른다. 포인트 색(버튼·오늘 표시)뿐 아니라 바탕·선에도 그 색이 은은하게 섞인다.
//   '나만의 색'은 색 하나만 고르면 다크용 색과 그 위의 글자색(흰색/검정)을 알아서 정한다.
// - 배경 사진(0.11.0): 고른 사진을 작게 줄여서 이 기기에만 저장하고(서버로 보내지 않는다), 달력 뒤에 은은하게 깐다.
// - 글자 크기(0.10.0): '보통'(지금 크기)이 기본이자 가장 크고, 작은 쪽으로만 5단계. 글씨와 함께 여백·간격도 같이 줄어서
//   한 화면에 더 많이 보인다 (style.css의 calc(… * var(--fs))). 버튼처럼 누르는 칸의 높이는 그대로 둔다.
// - 화면이 처음 그려지기 전에 적용하는 코드는 templates/_head.html에 따로 있다 (번쩍임 방지).

import { el, icon, toast } from './utils.js';

const THEME_KEY = 'my-calendar:theme';
const FONT_KEY = 'my-calendar:font';
const SIZE_KEY = 'my-calendar:font-size';
const COLOR_KEY = 'my-calendar:color';
const CUSTOM_KEY = 'my-calendar:color-custom';
const BG_KEY = 'my-calendar:bg';
const VEIL_KEY = 'my-calendar:bg-veil';
const WEEKLY_KEY = 'my-calendar:weekly-card'; // weekly.js와 같은 값
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const THEMES = [
  ['auto', '시스템 설정 따라가기'],
  ['light', '라이트'],
  ['dark', '다크'],
];

// 색 테마: [키, 이름, 견본 색] — 실제 색은 style.css의 :root[data-color="…"]
const COLORS = [
  ['blue', '만년필 파랑 (기본)', '#2347C8'],
  ['green', '숲', '#1F7A52'],
  ['orange', '노을', '#C2571B'],
  ['purple', '라벤더', '#6B4FC8'],
  ['pink', '벚꽃', '#C7447F'],
  ['mono', '먹', '#2F3541'],
];
// 배경 사진을 얼마나 가릴지: [키, 이름]
const VEILS = [['soft', '은은하게'], ['mid', '보통'], ['strong', '진하게']];

// 글꼴: [키, 메뉴 이름, CSS font-family]. Pretendard 외에는 고를 때 그 글꼴 파일만 불러온다.
const FONTS = [
  ['pretendard', 'Pretendard (기본)', "'Pretendard Variable'"],
  ['gowun-dodum', '고운돋움', "'Gowun Dodum'"],
  ['gowun-batang', '고운바탕', "'Gowun Batang'"],
  ['jua', '주아', "'Jua'"],
  ['noto-sans-kr', 'Noto Sans KR', "'Noto Sans KR Variable'"],
];

// 글자 크기: [값(%), 이름]
const SIZES = [
  ['100', '보통'],
  ['95', '조금 작게'],
  ['90', '작게'],
  ['85', '더 작게'],
  ['80', '가장 작게'],
];

let color = 'blue';
let custom = null;   // 나만의 색 { l, d, ol, od } (라이트·다크의 포인트 색과 그 위 글자색)
let veil = 'mid';
let weekly = true;
let hooks = {};
let theme = 'auto';
let font = 'pretendard';
let size = '100';
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
  syncBarColor();
}

// 휴대폰 상태 표시줄 색을 지금 바탕색(--paper)에 맞춘다. 색 테마에 따라 바탕색이 달라지므로 그려진 색을 읽어 온다.
function syncBarColor() {
  const bar = toHex(getComputedStyle(document.body).backgroundColor) || (isDark() ? '#111419' : '#F4F6F9');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bar));
}

// 'rgb(244, 246, 249)' 또는 'color(srgb 0.95 0.96 0.97)' → '#F4F6F9'
function toHex(css) {
  let m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css);
  let rgb = m ? m.slice(1, 4).map(Number) : null;
  if (!rgb) {
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
    rgb = m ? m.slice(1, 4).map((v) => Math.round(Number(v) * 255)) : null;
  }
  return rgb ? `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}` : null;
}

// ---------------------------------------------------------------- 색 테마
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex, other, ratio) => rgbToHex(hexToRgb(hex).map((v, i) => v * (1 - ratio) + hexToRgb(other)[i] * ratio));
// 밝기(0~1, WCAG 상대 휘도): 그 색 위에 흰 글자가 좋을지 검은 글자가 좋을지 정할 때 쓴다
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const textOn = (hex) => (luminance(hex) > 0.4 ? '#10141A' : '#FFFFFF');

/** 고른 색 하나 → 라이트용(너무 밝으면 조금 어둡게)·다크용(조금 밝게) 포인트 색과 그 위 글자색 */
export function customTints(hex) {
  let l = hex;
  for (let i = 0; i < 6 && luminance(l) > 0.45; i++) l = mix(l, '#000000', 0.15); // 흰 바탕에서 보이게
  let d = hex;
  for (let i = 0; i < 6 && luminance(d) < 0.22; i++) d = mix(d, '#FFFFFF', 0.18); // 어두운 바탕에서 보이게
  return { l, d, ol: textOn(l), od: textOn(d) };
}

function applyColor() {
  const root = document.documentElement;
  for (const name of ['--tint-l', '--tint-d', '--on-l', '--on-d']) root.style.removeProperty(name);
  if (color === 'custom' && custom) {
    root.dataset.color = 'custom';
    root.style.setProperty('--tint-l', custom.l);
    root.style.setProperty('--tint-d', custom.d);
    root.style.setProperty('--on-l', custom.ol);
    root.style.setProperty('--on-d', custom.od);
  } else if (color === 'blue') delete root.dataset.color;
  else root.dataset.color = color;
  syncBarColor();
}

// ---------------------------------------------------------------- 배경 사진
function applyBackground(dataUrl) {
  const root = document.documentElement;
  let style = document.getElementById('bg-style');
  if (!dataUrl) {
    style?.remove();
    delete root.dataset.bg;
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = 'bg-style';
    document.head.append(style);
  }
  style.textContent = `:root{--bg-image:url("${dataUrl}")}`;
  root.dataset.bg = veil;
}

function readBackground() {
  try {
    const v = localStorage.getItem(BG_KEY);
    return v && v.startsWith('data:image/') ? v : null;
  } catch { return null; }
}

// 사진 파일 → 긴 쪽 1600px 이하의 JPEG (이 기기에 저장할 수 있게 작게)
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[1600, 0.8], [1280, 0.72], [960, 0.65]]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 900_000) return url; // 약 650KB 이하
  }
  throw new Error('사진이 너무 커요. 더 작은 사진을 골라 주세요.');
}

async function pickBackground(file) {
  if (!file) return;
  try {
    const url = await shrinkImage(file);
    try { localStorage.setItem(BG_KEY, url); } catch { throw new Error('이 기기에 저장할 자리가 부족해요. 더 작은 사진을 골라 주세요.'); }
    applyBackground(url);
    rerender();
    toast('배경 사진을 깔았어요 (이 기기에만 저장돼요)');
  } catch (e) {
    toast(e.message || '사진을 읽지 못했어요.', 'error');
  }
}

function clearBackground() {
  try { localStorage.removeItem(BG_KEY); } catch { /* 무시 */ }
  applyBackground(null);
  rerender();
  toast('배경 사진을 없앴어요');
}

function pickVeil(value) {
  veil = value;
  save(VEIL_KEY, value, 'mid');
  applyBackground(readBackground());
  rerender();
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

function applySize() {
  if (size === '100') delete document.documentElement.dataset.fs;
  else document.documentElement.dataset.fs = size;
  // 달력 칸 안에 일정이 몇 개 들어가는지('+n') 다시 계산하게 한다
  window.dispatchEvent(new Event('resize'));
}

// ---------------------------------------------------------------- 메뉴
function renderMenu(loginEnabled, appName, version) {
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

  const hasBg = Boolean(readBackground());
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', () => pickBackground(fileInput.files?.[0]));
  const customInput = el('input', {
    type: 'color', class: 'menu-color-custom', value: (custom?.l || '#0E8A8A').toLowerCase(),
    'aria-label': '나만의 색 고르기', title: '나만의 색',
  });
  customInput.addEventListener('input', () => pickCustom(customInput.value));

  const parts = [
    el('p', { class: 'menu-label', id: 'menu-label-theme' }, '화면 테마'),
    el('div', { role: 'group', 'aria-labelledby': 'menu-label-theme' },
      THEMES.map(([v, label]) => choice('themeChoice', v, label, theme, pickTheme))),
    // 색: 동그란 견본 6개 + 나만의 색
    el('p', { class: 'menu-label', id: 'menu-label-color' }, '색', el('span', { class: 'menu-size-name' }, colorName())),
    el('div', { class: 'menu-colors', role: 'group', 'aria-labelledby': 'menu-label-color' },
      COLORS.map(([v, label, sample]) => el('button', {
        type: 'button', role: 'menuitemradio', class: 'menu-color', dataset: { colorChoice: v },
        'aria-checked': String(v === color), 'aria-label': label, title: label,
        style: { '--sample': sample }, onclick: () => pickColor(v),
      })),
      el('label', { class: 'menu-color is-custom', 'aria-checked': String(color === 'custom'), title: '나만의 색', style: { '--sample': custom?.l || 'transparent' } }, customInput)),
    // 배경 사진
    el('p', { class: 'menu-label', id: 'menu-label-bg' }, '배경 사진', el('span', { class: 'menu-size-name' }, hasBg ? '이 기기에만' : '')),
    el('div', { class: 'menu-bg', role: 'group', 'aria-labelledby': 'menu-label-bg' },
      fileInput,
      el('button', { type: 'button', role: 'menuitem', class: 'btn sm', onclick: () => fileInput.click() }, hasBg ? '사진 바꾸기' : '사진 고르기'),
      hasBg ? el('button', { type: 'button', role: 'menuitem', class: 'btn sm ghost', onclick: clearBackground }, '없애기') : null),
    hasBg
      ? el('div', { class: 'seg menu-veil', role: 'group', 'aria-label': '사진을 얼마나 보이게 할지' },
          VEILS.map(([v, label]) => el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(v === veil), onclick: () => pickVeil(v) }, label)))
      : null,
    el('p', { class: 'menu-label', id: 'menu-label-font' }, '글꼴'),
    el('div', { role: 'group', 'aria-labelledby': 'menu-label-font' },
      FONTS.map(([v, label, family]) =>
        choice('fontChoice', v, label, font, pickFont, { 'font-family': `${family}, var(--font-fallback)` }))),
    el('p', { class: 'menu-label', id: 'menu-label-size' }, '글자 크기', el('span', { class: 'menu-size-name' }, sizeName())),
    // 다섯 칸에 '가'를 그 크기로 보여 준다
    el('div', { class: 'menu-sizes', role: 'group', 'aria-labelledby': 'menu-label-size' },
      SIZES.map(([v, label]) => el('button', {
        type: 'button',
        role: 'menuitemradio',
        class: 'menu-size',
        dataset: { sizeChoice: v },
        'aria-checked': String(v === size),
        'aria-label': `${label} (${v}%)`,
        title: `${label} (${v}%)`,
        onclick: () => pickSize(v),
      }, el('span', { style: { 'font-size': `${(18 * Number(v)) / 100}px` } }, '가')))),
    // 이번 주 한 걸음 (weekly.js): 한 주에 한 번 올해 목표를 떠올리게 하는 카드
    el('p', { class: 'menu-label', id: 'menu-label-weekly' }, '올해 목표'),
    el('button', {
      type: 'button', role: 'menuitemcheckbox', class: 'menu-choice menu-switch', 'aria-checked': String(weekly),
      title: '한 주에 한 번, 앱을 처음 열 때 올해 목표와 함께 이번 주에 할 일 하나를 물어봐요',
      onclick: () => pickWeekly(!weekly),
    }, el('span', { class: 'menu-switch-text' }, '주마다 한 걸음 카드'), el('span', { class: 'switch', 'aria-hidden': 'true' })),
    hooks.onShowWeekly
      ? el('button', { type: 'button', role: 'menuitem', class: 'menu-choice menu-sub', onclick: () => { menu.hidePopover?.(); hooks.onShowWeekly(); } }, '지금 카드 보기')
      : null,
    loginEnabled
      ? el('form', { class: 'menu-logout', method: 'post', action: '/logout' },
          el('button', { type: 'submit', role: 'menuitem', class: 'menu-choice danger' }, '이 기기에서 로그아웃'))
      : null, // 로그인을 쓰지 않으면(비밀번호 없이 내 컴퓨터에서 실행) 로그아웃은 없다
    // 맨 아래: 앱 이름과 버전 (app.py의 APP_VERSION)
    version
      ? el('p', { class: 'menu-version', role: 'note' },
          el('span', { class: 'menu-app' }, appName), el('span', {}, `버전 ${version}`))
      : null,
  ];
  menu.replaceChildren(...parts.filter(Boolean));
}

function refreshChecks() {
  menu.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme)));
  menu.querySelectorAll('[data-font-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fontChoice === font)));
  menu.querySelectorAll('[data-size-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sizeChoice === size)));
  const name = menu.querySelector('.menu-size-name');
  if (name) name.textContent = sizeName();
}

function colorName() {
  if (color === 'custom') return '나만의 색';
  return COLORS.find(([v]) => v === color)[1].replace(' (기본)', '');
}

let menuArgs = [];
function rerender() {
  renderMenu(...menuArgs);
  placeMenu();
}

function pickColor(value) {
  color = value;
  save(COLOR_KEY, value, 'blue');
  applyColor();
  rerender();
}

function pickCustom(hex) {
  custom = customTints(hex);
  color = 'custom';
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
    localStorage.setItem(COLOR_KEY, 'custom');
  } catch { /* 저장 못 해도 이번 화면에는 적용됨 */ }
  applyColor();
  // 색을 고르는 창이 열려 있는 동안에는 메뉴를 다시 그리지 않는다 (창이 닫혀 버린다) → 견본과 이름만 바꾼다
  const swatch = menu.querySelector('.menu-color.is-custom');
  if (swatch) { swatch.style.setProperty('--sample', custom.l); swatch.setAttribute('aria-checked', 'true'); }
  menu.querySelectorAll('[data-color-choice]').forEach((b) => b.setAttribute('aria-checked', 'false'));
  const name = menu.querySelector('#menu-label-color .menu-size-name');
  if (name) name.textContent = colorName();
}

function pickWeekly(on) {
  weekly = on;
  save(WEEKLY_KEY, on ? 'on' : 'off', 'on');
  rerender();
  toast(on ? '한 주에 한 번, 올해 목표를 떠올려 드릴게요' : '한 걸음 카드를 껐어요');
}

function sizeName() {
  const [v, label] = SIZES.find(([x]) => x === size);
  return v === '100' ? label : `${label} · ${v}%`;
}

function pickSize(value) {
  size = value;
  save(SIZE_KEY, value, '100');
  applySize();
  refreshChecks();
  placeMenu(); // 메뉴 글자도 작아지니 위치를 다시 맞춘다
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

export function initSettings({ loginEnabled = false, appName = '', version = '', onShowWeekly = null } = {}) {
  button = document.getElementById('btn-settings');
  menu = document.getElementById('settings-menu');
  hooks = { onShowWeekly };
  menuArgs = [loginEnabled, appName, version];
  color = read(COLOR_KEY, [...COLORS.map(([v]) => v), 'custom'], 'blue');
  try { custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null'); } catch { custom = null; }
  if (color === 'custom' && !custom) color = 'blue';
  veil = read(VEIL_KEY, VEILS.map(([v]) => v), 'mid');
  weekly = read(WEEKLY_KEY, ['off'], 'on') !== 'off';
  theme = read(THEME_KEY, ['light', 'dark'], 'auto');
  font = read(FONT_KEY, FONTS.map(([v]) => v), 'pretendard');
  size = read(SIZE_KEY, SIZES.map(([v]) => v), '100');
  applyTheme();
  applyColor();
  applyBackground(readBackground());
  applyFont();
  if (size !== '100') document.documentElement.dataset.fs = size; // _head.html이 이미 적용했지만 혹시 몰라서

  button.replaceChildren(icon(
    'M12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z' +
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ));
  renderMenu(loginEnabled, appName, version);

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
  requestAnimationFrame(syncBarColor); // 스타일이 다 적용된 뒤의 바탕색으로
}
