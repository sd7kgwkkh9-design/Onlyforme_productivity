// 제목(왼쪽 위 날짜)을 눌러 원하는 달·주로 바로 이동 (직접 구현)
//
//   월간 화면: 연도 ‹ › 와 1~12월 버튼 → 그 달로
//   주간 화면: 작은 달력에서 아무 날짜나 → 그 날짜가 속한 주로 (« » 연도, ‹ › 달 이동)

import { WEEKDAYS, addDays, el, icon, todayStr, toDateStr } from './utils.js';

/**
 * @param {object} opts
 * @param {HTMLButtonElement} opts.button  제목 버튼 (popovertarget으로 메뉴를 연다)
 * @param {HTMLElement} opts.menu          popover 요소
 * @param {() => {view: string, year: number, month: number, weekStart: string}} opts.current
 * @param {(year: number, month: number) => void} opts.gotoMonth  month: 0~11
 * @param {(date: string) => void} opts.gotoWeekOf
 */
export function initJump({ button, menu, current, gotoMonth, gotoWeekOf }) {
  // 메뉴 안에서 보고 있는 연도/달 (닫았다 열면 지금 화면 기준으로 초기화)
  let viewYear;
  let viewMonth;
  let mode;

  function close() { menu.hidePopover?.(); }

  function render() {
    if (mode === 'month') renderMonths();
    else renderDays();
  }

  // ---------------------------------------------------------------- 월간: 12개월 고르기
  function renderMonths() {
    const cur = current();
    const now = new Date();
    menu.replaceChildren(
      header(`${viewYear}년`, [
        ['이전 해', 'M15 6l-6 6 6 6', () => { viewYear -= 1; render(); }],
      ], [
        ['다음 해', 'M9 6l6 6-6 6', () => { viewYear += 1; render(); }],
      ]),
      el('div', { class: 'jump-months' },
        Array.from({ length: 12 }, (_, m) => el('button', {
          type: 'button',
          class: [
            'jump-month',
            viewYear === cur.year && m === cur.month ? 'is-current' : '',
            viewYear === now.getFullYear() && m === now.getMonth() ? 'is-now' : '',
          ].join(' '),
          'aria-current': viewYear === cur.year && m === cur.month ? 'date' : null,
          onclick: () => { gotoMonth(viewYear, m); close(); },
        }, `${m + 1}월`)),
      ),
      footer('이번 달로', () => { const n = new Date(); gotoMonth(n.getFullYear(), n.getMonth()); close(); }),
    );
  }

  // ---------------------------------------------------------------- 주간: 날짜 고르기 → 그 주
  function renderDays() {
    const cur = current();
    const today = todayStr();
    const first = new Date(viewYear, viewMonth, 1);
    const gridStart = toDateStr(new Date(viewYear, viewMonth, 1 - first.getDay()));
    const weeks = Math.ceil((first.getDay() + new Date(viewYear, viewMonth + 1, 0).getDate()) / 7);
    const move = (dy, dm) => () => {
      const d = new Date(viewYear + dy, viewMonth + dm, 1);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      render();
    };

    const rows = [];
    for (let w = 0; w < weeks; w++) {
      const rowStart = addDays(gridStart, w * 7);
      const inShownWeek = rowStart === cur.weekStart;
      rows.push(el('div', { class: `jump-week${inShownWeek ? ' is-current' : ''}` },
        Array.from({ length: 7 }, (_, i) => {
          const date = addDays(rowStart, i);
          const other = Number(date.slice(5, 7)) !== viewMonth + 1;
          return el('button', {
            type: 'button',
            class: ['jump-day', `wd-${i}`, other ? 'is-other' : '', date === today ? 'is-now' : ''].join(' '),
            'aria-label': `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일이 있는 주로`,
            onclick: () => { gotoWeekOf(date); close(); },
          }, String(Number(date.slice(8))));
        })));
    }

    menu.replaceChildren(
      header(`${viewYear}년 ${viewMonth + 1}월`, [
        ['이전 해', 'M11 6l-6 6 6 6M18 6l-6 6 6 6', move(-1, 0)],
        ['이전 달', 'M15 6l-6 6 6 6', move(0, -1)],
      ], [
        ['다음 달', 'M9 6l6 6-6 6', move(0, 1)],
        ['다음 해', 'M6 6l6 6-6 6M13 6l6 6-6 6', move(1, 0)],
      ]),
      el('div', { class: 'jump-wd' }, WEEKDAYS.map((d, i) => el('span', { class: `wd-${i}` }, d))),
      el('div', { class: 'jump-days' }, rows),
      footer('이번 주로', () => { gotoWeekOf(today); close(); }),
    );
  }

  function header(label, left, right) {
    const btn = ([name, path, fn]) =>
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': name, title: name, onclick: fn }, icon(path));
    return el('div', { class: 'jump-head' },
      el('div', { class: 'jump-nav' }, left.map(btn)),
      el('strong', { class: 'jump-label', 'aria-live': 'polite' }, label),
      el('div', { class: 'jump-nav' }, right.map(btn)),
    );
  }

  function footer(label, fn) {
    return el('div', { class: 'jump-foot' }, el('button', { type: 'button', class: 'link-btn', onclick: fn }, label));
  }

  function place() {
    const r = button.getBoundingClientRect();
    const width = menu.offsetWidth || 300;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${r.bottom + 6}px`;
  }

  if (typeof menu.showPopover !== 'function') {
    button.hidden = false; // 아주 오래된 브라우저: 제목은 그냥 글자로만 보인다
    button.disabled = true;
    return;
  }

  menu.addEventListener('beforetoggle', (e) => {
    const open = e.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const cur = current();
    mode = cur.view;
    if (mode === 'month') {
      viewYear = cur.year;
    } else {
      // 주가 두 달에 걸치면 목요일이 있는 달을 보여 준다 (그 주의 '주인' 달)
      const mid = addDays(cur.weekStart, 4);
      viewYear = Number(mid.slice(0, 4));
      viewMonth = Number(mid.slice(5, 7)) - 1;
    }
    render();
  });
  menu.addEventListener('toggle', (e) => { if (e.newState === 'open') place(); });
  window.addEventListener('resize', () => { if (menu.matches(':popover-open')) place(); });
}

