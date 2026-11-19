// 달력 꾸미기 (0.11.0): 날짜에 스티커(이모지)를 붙인다.
//
// - 날짜마다 스티커 하나. 서버(day_marks 표)에 저장되어 다른 기기에도 똑같이 보인다.
// - 월간 칸·주간 화면에는 스티커가 날짜 숫자 옆에 보인다.
// - 여는 곳: 하루 화면 위쪽의 '스티커' 버튼, 날짜를 두 손가락 클릭(오른쪽 클릭).
// - 0.11.0의 형광펜(칸 배경 칠하기)은 0.14.0에서 뺐다. 테마·배경 사진은 기기마다 따로라서 settings.js에 있다.

import { api } from './api.js';
import { el, fillDialog, formatLong, toast } from './utils.js';

const STICKERS = [
  '⭐', '❤️', '🎂', '🎉', '✈️', '📚', '📝', '💪',
  '🏃', '🍽️', '☕', '🎬', '🎵', '🏥', '💰', '🎓',
  '🏠', '🌸', '🔥', '😊', '😴', '😭', '🚫', '✅',
];

// 'YYYY-MM-DD' → { sticker }
const marks = new Map();
// 0.14.0: 일기를 쓴 날 'YYYY-MM-DD' → 기분 이모지('' 가능). 달력에는 작은 점 하나만 보인다 (diary.js)
const diaries = new Map();

export const markOf = (date) => marks.get(date) || null;

/** 서버에서 받은 [start, end) 기간의 스티커·일기 표시로 바꿔 넣는다 (그 기간에서 없어진 것은 지운다) */
export function setMarks(list, start, end, diaryList = null) {
  for (const date of [...marks.keys()]) if (date >= start && date < end) marks.delete(date);
  for (const m of list || []) if (m.sticker) marks.set(m.date, { sticker: m.sticker });
  if (diaryList) {
    for (const date of [...diaries.keys()]) if (date >= start && date < end) diaries.delete(date);
    for (const d of diaryList) diaries.set(d.date, d.mood || '');
  }
}

/** 날짜 칸 하나에 스티커를 붙인다 (날짜 숫자 옆) */
export function applyMark(cell) {
  const date = cell.dataset.date;
  if (!date) return;
  const mark = markOf(date);
  const head = cell.querySelector('.fc-daygrid-day-top, .wk-col-head, .wk-date');
  if (!head) return;
  head.querySelector(':scope > .day-sticker')?.remove();
  if (mark?.sticker) head.append(el('span', { class: 'day-sticker', 'aria-label': `스티커 ${mark.sticker}` }, mark.sticker));
  head.querySelector(':scope > .diary-dot')?.remove();
  if (diaries.has(date)) head.append(el('span', { class: 'diary-dot', role: 'img', 'aria-label': '일기 있음', title: '일기 있음' }));
}

export function decorateMarks(root) {
  root?.querySelectorAll('td.fc-daygrid-day[data-date], .wk-col[data-date], .wk-day[data-date]').forEach(applyMark);
}

// ---------------------------------------------------------------- 꾸미기 창
let dialog = null;

/**
 * 그 날짜의 스티커를 고르는 창. 누르는 대로 바로 저장된다.
 * @param {string} date
 * @param {() => void} onChanged  저장된 뒤 (달력 다시 그리기)
 */
export function openDecor(date, onChanged = () => {}) {
  if (!dialog) {
    dialog = el('dialog', { class: 'ask decor', 'aria-labelledby': 'decor-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // 바깥을 누르면 닫기
    document.body.append(dialog);
  }
  let mark = { sticker: '', ...(markOf(date) || {}) };

  const save = async (change) => {
    try {
      const saved = await api.setMark(date, change);
      mark = { sticker: saved.sticker };
      if (mark.sticker) marks.set(date, mark); else marks.delete(date);
      draw();
      onChanged();
    } catch (e) {
      toast(e.message, 'error'); // 실패하면 고르기 전 그대로
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

    fillDialog(dialog,
      el('h2', { class: 'decor-title', id: 'decor-title' }, `${formatLong(date)} 스티커`),
      el('div', { class: 'decor-stickers', role: 'group', 'aria-label': '스티커' },
        STICKERS.map((s) => el('button', {
          type: 'button', class: 'decor-sticker', 'aria-pressed': String(mark.sticker === s), 'aria-label': `스티커 ${s}`,
          onclick: () => save({ sticker: mark.sticker === s ? '' : s }), // 다시 누르면 뗀다
        }, s))),
      customForm,
      el('div', { class: 'decor-foot' },
        mark.sticker
          ? el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => save({ sticker: '' }) }, '스티커 떼기')
          : null,
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn sm primary', onclick: () => dialog.close() }, '완료')),
    );
  }

  draw();
  if (!dialog.open) dialog.showModal();
}
