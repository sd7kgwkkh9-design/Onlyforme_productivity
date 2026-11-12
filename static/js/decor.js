// 달력 꾸미기 (0.11.0): 날짜에 스티커(이모지)를 붙이고 형광펜으로 칠한다.
//
// - 날짜마다 스티커 하나 + 형광펜 색 하나. 서버(day_marks 표)에 저장되어 다른 기기에도 똑같이 보인다.
// - 월간 칸·주간 화면에는 스티커가 날짜 숫자 옆에, 형광펜은 칸 배경에 은은하게 보인다.
// - 여는 곳: 하루 화면 위쪽의 '꾸미기' 버튼, 월간 화면에서 날짜를 두 손가락 클릭(오른쪽 클릭).
// - 색 테마·나만의 테마·배경 사진은 기기마다 따로라서 settings.js에 있다.

import { api } from './api.js';
import { el, formatLong, toast } from './utils.js';

export const MARK_COLORS = [
  ['yellow', '노랑'], ['pink', '분홍'], ['green', '초록'], ['blue', '파랑'], ['purple', '보라'], ['orange', '주황'],
];
const STICKERS = [
  '⭐', '❤️', '🎂', '🎉', '✈️', '📚', '📝', '💪',
  '🏃', '🍽️', '☕', '🎬', '🎵', '🏥', '💰', '🎓',
  '🏠', '🌸', '🔥', '😊', '😴', '😭', '🚫', '✅',
];

// 'YYYY-MM-DD' → { sticker, color }
const marks = new Map();

export const markOf = (date) => marks.get(date) || null;

/** 서버에서 받은 [start, end) 기간의 꾸밈으로 바꿔 넣는다 (그 기간에서 없어진 것은 지운다) */
export function setMarks(list, start, end) {
  for (const date of [...marks.keys()]) if (date >= start && date < end) marks.delete(date);
  for (const m of list || []) marks.set(m.date, { sticker: m.sticker, color: m.color });
}

/** 날짜 칸 하나에 꾸밈을 입힌다: 형광펜은 칸의 class, 스티커는 날짜 숫자 옆 */
export function applyMark(cell) {
  const date = cell.dataset.date;
  if (!date) return;
  const mark = markOf(date);
  for (const [name] of MARK_COLORS) cell.classList.toggle(`mark-${name}`, mark?.color === name);
  cell.classList.toggle('has-mark', Boolean(mark?.color));
  const head = cell.querySelector('.fc-daygrid-day-top, .wk-col-head, .wk-date');
  if (!head) return;
  head.querySelector(':scope > .day-sticker')?.remove();
  if (mark?.sticker) head.append(el('span', { class: 'day-sticker', 'aria-label': `스티커 ${mark.sticker}` }, mark.sticker));
}

export function decorateMarks(root) {
  root?.querySelectorAll('td.fc-daygrid-day[data-date], .wk-col[data-date], .wk-day[data-date]').forEach(applyMark);
}

// ---------------------------------------------------------------- 꾸미기 창
let dialog = null;

/**
 * 그 날짜의 스티커·형광펜을 고르는 창. 누르는 대로 바로 저장된다.
 * @param {string} date
 * @param {() => void} onChanged  저장된 뒤 (달력 다시 그리기)
 */
export function openDecor(date, onChanged = () => {}) {
  if (!dialog) {
    dialog = el('dialog', { class: 'ask decor', 'aria-labelledby': 'decor-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // 바깥을 누르면 닫기
    document.body.append(dialog);
  }
  let mark = { sticker: '', color: '', ...(markOf(date) || {}) };

  const save = async (change) => {
    const next = { ...mark, ...change };
    try {
      const saved = await api.setMark(date, change);
      mark = { sticker: saved.sticker, color: saved.color };
      if (mark.sticker || mark.color) marks.set(date, mark); else marks.delete(date);
      draw();
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
      mark = { ...mark }; // 실패하면 고르기 전 그대로
      void next;
    }
  };

  function draw() {
    const custom = el('input', {
      type: 'text', class: 'input decor-custom', maxlength: '16', placeholder: '다른 이모지', 'aria-label': '다른 이모지 직접 넣기',
      value: mark.sticker && !STICKERS.includes(mark.sticker) ? mark.sticker : '',
    });
    const customForm = el('form', { class: 'decor-custom-row', novalidate: true }, custom,
      el('button', { type: 'submit', class: 'btn sm' }, '붙이기'));
    customForm.addEventListener('submit', (e) => { e.preventDefault(); if (custom.value.trim()) save({ sticker: custom.value.trim() }); });

    dialog.replaceChildren(
      el('h2', { class: 'decor-title', id: 'decor-title' }, `${formatLong(date)} 꾸미기`),
      el('p', { class: 'menu-label' }, '스티커'),
      el('div', { class: 'decor-stickers', role: 'group', 'aria-label': '스티커' },
        STICKERS.map((s) => el('button', {
          type: 'button', class: 'decor-sticker', 'aria-pressed': String(mark.sticker === s), 'aria-label': `스티커 ${s}`,
          onclick: () => save({ sticker: mark.sticker === s ? '' : s }), // 다시 누르면 뗀다
        }, s))),
      customForm,
      el('p', { class: 'menu-label' }, '형광펜'),
      el('div', { class: 'decor-colors', role: 'group', 'aria-label': '형광펜 색' },
        el('button', { type: 'button', class: 'decor-color is-none', 'aria-pressed': String(!mark.color), 'aria-label': '형광펜 없음', title: '없음', onclick: () => save({ color: '' }) }),
        MARK_COLORS.map(([name, label]) => el('button', {
          type: 'button', class: `decor-color mark-${name}`, 'aria-pressed': String(mark.color === name), 'aria-label': `형광펜 ${label}`, title: label,
          onclick: () => save({ color: mark.color === name ? '' : name }),
        }))),
      el('div', { class: 'decor-foot' },
        mark.sticker || mark.color
          ? el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => save({ sticker: '', color: '' }) }, '꾸밈 지우기')
          : null,
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn sm primary', onclick: () => dialog.close() }, '완료')),
    );
  }

  draw();
  if (!dialog.open) dialog.showModal();
}
