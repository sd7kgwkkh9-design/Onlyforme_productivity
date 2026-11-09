// 날짜 하나 고르기 창 (0.9.0, 직접 구현)
//
//   const date = await pickDate({ title: '어느 날로 옮길까요?', from: '2026-11-09' });
//   → 고른 날짜('YYYY-MM-DD') 또는 취소하면 null
//
// 쓰는 곳: 일정 메뉴의 '다른 날로 옮기기·복사', 기록지 할 일의 '날짜 정하기'.
// 키보드: 화살표로 하루·한 주씩 움직이고 Enter로 고른다. Esc나 바깥을 누르면 취소.

import { WEEKDAYS, addDays, el, formatShort, icon, parseDateStr, todayStr } from './utils.js';

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {object} o
 * @param {string} o.title       창 제목
 * @param {string} [o.from]      지금 날짜 (테두리로 표시, 처음 보여 줄 달)
 * @param {string} [o.hint]      제목 아래 작은 설명
 */
export function pickDate({ title, from = null, hint = '' } = {}) {
  const dialog = document.getElementById('datepop');
  const today = todayStr();
  let focus = from || today;           // 키보드로 움직이는 칸
  let view = parseDateStr(focus);      // 보여 주는 달
  view.setDate(1);

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      resolve(value);
    };

    const quick = (label, date) =>
      el('button', { type: 'button', class: 'btn sm datepop-quick', onclick: () => finish(date) },
        label, el('span', { class: 'muted' }, formatShort(date)));

    function render(focusAfter = false) {
      const year = view.getFullYear();
      const month = view.getMonth();
      const firstDow = new Date(year, month, 1).getDay();
      const lastDay = new Date(year, month + 1, 0).getDate();

      const grid = el('div', { class: 'picker-grid datepop-grid', role: 'grid', 'aria-label': `${year}년 ${month + 1}월` });
      WEEKDAYS.forEach((w, i) => grid.append(el('span', { class: `picker-wd wd-${i}`, 'aria-hidden': 'true' }, w)));
      for (let i = 0; i < firstDow; i++) grid.append(el('span'));
      for (let day = 1; day <= lastDay; day++) {
        const date = `${year}-${pad(month + 1)}-${pad(day)}`;
        const classes = ['picker-day', `wd-${(firstDow + day - 1) % 7}`];
        if (date === today) classes.push('is-today');
        if (date === from) classes.push('is-anchor');
        grid.append(el('button', {
          type: 'button',
          class: classes.join(' '),
          dataset: { date },
          tabindex: date === focus ? '0' : '-1',
          'aria-label': `${formatShort(date)}${date === from ? ' (지금 날짜)' : ''}`,
          onclick: () => finish(date),
        }, String(day)));
      }
      // 이번 달에 focus 날짜가 없으면 1일에 포커스가 가도록
      if (!grid.querySelector('[tabindex="0"]')) grid.querySelector('.picker-day')?.setAttribute('tabindex', '0');

      dialog.replaceChildren(
        el('div', { class: 'datepop-head' },
          el('h2', { id: 'datepop-title' }, title),
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '닫기', onclick: () => finish(null) }, icon('M6 6l12 12M18 6L6 18')),
        ),
        hint ? el('p', { class: 'datepop-hint' }, hint) : null,
        el('div', { class: 'datepop-quicks' },
          quick('오늘', today),
          quick('내일', addDays(today, 1)),
          from && from !== today ? quick('다음 날', addDays(from, 1)) : null,
        ),
        el('div', { class: 'picker-nav datepop-nav' },
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '이전 달', onclick: () => moveMonth(-1) }, icon('M15 6l-6 6 6 6')),
          el('span', { class: 'picker-month', 'aria-live': 'polite' }, `${year}년 ${month + 1}월`),
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '다음 달', onclick: () => moveMonth(1) }, icon('M9 6l6 6-6 6')),
        ),
        grid,
        el('div', { class: 'datepop-foot' },
          el('button', { type: 'button', class: 'btn ghost', onclick: () => finish(null) }, '취소')),
      );
      if (focusAfter) grid.querySelector('[tabindex="0"]')?.focus();
    }

    function moveMonth(delta) {
      view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
      render();
    }

    // 화살표: ← → 하루, ↑ ↓ 한 주. 다른 달로 넘어가면 그 달을 보여 준다.
    dialog.onkeydown = (e) => {
      const cell = e.target.closest?.('.picker-day');
      if (!cell) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      focus = addDays(cell.dataset.date, step);
      const d = parseDateStr(focus);
      if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) view = new Date(d.getFullYear(), d.getMonth(), 1);
      render(true);
    };
    dialog.onclick = (e) => { if (e.target === dialog) finish(null); }; // 바깥(배경) 클릭
    dialog.addEventListener('close', () => finish(null), { once: true });

    render();
    dialog.showModal();
    dialog.querySelector('.datepop-grid [tabindex="0"]')?.focus();
  });
}
