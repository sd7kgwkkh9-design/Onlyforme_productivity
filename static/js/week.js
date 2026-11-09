// 주간 화면 (직접 구현)
//
// 배치는 두 가지이고, 오른쪽 위 버튼으로 바꿀 수 있다 (기기마다 기억).
//   row (가로, 기본): 일~토 7칸을 왼쪽에서 오른쪽으로 나란히, 각 칸 아래로 그날 일정
//                     휴대폰처럼 좁은 화면에서는 한 화면에 3일씩 보이고 좌우로 밀어서 본다.
//   col (세로)      : 7일을 위에서 아래로, 날짜 옆에 그날 일정
// 날짜를 누르면 월간 화면과 똑같이 그 날짜의 일정이 열린다.
// 일정·루틴 기록을 두 손가락 클릭(오른쪽 클릭)하면 메뉴가 뜬다 (0.9.0, 메뉴 내용은 main.js).

import { api } from './api.js';
import { slideIn } from './gestures.js';
import { holidaysBetween } from './holidays.js';
import { WEEKDAYS, addDays, el, formatLong, formatTimeRange, parseDateStr, toDateStr, todayStr } from './utils.js';

const LAYOUT_KEY = 'my-calendar:week-layout';

// 그 날짜가 속한 주의 일요일
export function startOfWeek(dateStr) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return toDateStr(d);
}

// '11월 1일 – 7일' 또는 달이 바뀌면 '10월 26일 – 11월 1일'
// compact(휴대폰 상단 바): '11.1–7' / '10.26–11.1'
export function weekTitle(start, { compact = false } = {}) {
  const a = parseDateStr(start);
  const b = parseDateStr(addDays(start, 6));
  const sameMonth = a.getMonth() === b.getMonth();
  if (compact) {
    const right = sameMonth ? `${b.getDate()}` : `${b.getMonth() + 1}.${b.getDate()}`;
    return { main: `${a.getMonth() + 1}.${a.getDate()}–${right}`, year: String(b.getFullYear()) };
  }
  const right = sameMonth ? `${b.getDate()}일` : `${b.getMonth() + 1}월 ${b.getDate()}일`;
  return { main: `${a.getMonth() + 1}월 ${a.getDate()}일 – ${right}`, year: String(b.getFullYear()) };
}

export class WeekView {
  /**
   * @param {HTMLElement} root  스크롤되는 <section>
   * @param {object} opts
   * @param {(date: string) => void} opts.onDayClick
   * @param {(e: MouseEvent, occ) => void} [opts.onItemMenu]  일정 오른쪽 클릭
   * @param {(e: MouseEvent, log) => void} [opts.onLogMenu]   루틴 기록 오른쪽 클릭
   */
  constructor(root, { onDayClick, onItemMenu = () => {}, onLogMenu = () => {} }) {
    this.root = root;
    this.onDayClick = onDayClick;
    this.onItemMenu = onItemMenu;
    this.onLogMenu = onLogMenu;
    this.start = null;
    this.selected = null;  // 넓은 화면에서 오른쪽 칸에 열려 있는 날짜
    this.token = 0;        // 빠르게 넘길 때 늦게 도착한 옛 응답을 버리기 위한 번호
    this.layout = readLayout();
    this.root.dataset.layout = this.layout;
  }

  setLayout(layout) {
    this.layout = layout;
    this.root.dataset.layout = layout;
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* 이번 화면에만 적용 */ }
    return this.refresh({ scrollTo: 'selected' });
  }

  /**
   * @param {string} start  그 주의 일요일
   * @param {number} direction  1 = 다음 주로, -1 = 지난주로, 0 = 그대로 (넘어가는 효과 방향)
   * @param {'start'|'end'|'today'|'selected'} scrollTo  가로 배치에서 처음 보여 줄 위치
   */
  async show(start, direction = 0, scrollTo = 'today') {
    this.start = start;
    await this.load(direction, scrollTo);
  }

  async refresh({ scrollTo = 'keep' } = {}) {
    if (this.start) await this.load(0, scrollTo);
  }

  select(date) {
    this.selected = date;
    this.root.querySelectorAll('[data-date]').forEach((d) => d.classList.toggle('is-selected', d.dataset.date === date));
  }

  async load(direction, scrollTo) {
    const start = this.start;
    const end = addDays(start, 7);
    const token = ++this.token;
    const keepLeft = this.root.scrollLeft;

    const [{ items, logs }, holidays] = await Promise.all([
      api.calendar(start, end), // 일정 + 루틴 기록을 한 번에
      holidaysBetween(start, end),
    ]);
    if (token !== this.token) return;

    const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
    const itemsOf = new Map();
    for (const o of items) {
      if (!itemsOf.has(o.date)) itemsOf.set(o.date, []);
      itemsOf.get(o.date).push(o); // 서버가 이미 그날의 순서대로 정렬해 줌
    }
    const logsOf = new Map();
    for (const l of logs) {
      if (!logsOf.has(l.date)) logsOf.set(l.date, []);
      logsOf.get(l.date).push(l);
    }

    const today = todayStr();
    const render = this.layout === 'row' ? this.renderColumn : this.renderRow;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const node = render.call(this, date, i, itemsOf.get(date) || [], holidayOf.get(date), date === today, logsOf.get(date) || []);
      if (date === this.selected) node.classList.add('is-selected');
      days.push(node);
    }

    const track = el('div', { class: `week-track ${this.layout}` }, days);
    this.root.replaceChildren(track);
    this.scrollTo(scrollTo, keepLeft);
    slideIn(track, direction);
  }

  // 가로 배치에서 어느 날짜부터 보여 줄지 (좁은 화면에서 좌우로 스크롤될 때만 의미가 있다)
  scrollTo(where, keepLeft) {
    const r = this.root;
    if (this.layout !== 'row') { r.scrollLeft = 0; return; }
    const colOf = (date) => r.querySelector(`[data-date="${date}"]`);
    let target = null;
    if (where === 'end') r.scrollLeft = r.scrollWidth;
    else if (where === 'start') r.scrollLeft = 0;
    else if (where === 'keep') r.scrollLeft = keepLeft;
    else if (where === 'today') target = colOf(todayStr());
    else if (where === 'selected') target = colOf(this.selected) || colOf(todayStr());
    if (target) r.scrollLeft = target.offsetLeft - r.querySelector('.week-track').offsetLeft;
  }

  // ---------------------------------------------------------------- 가로 배치: 하루 = 세로 칸 하나
  renderColumn(date, dow, items, holiday, isToday, logs) {
    return el('button', {
      type: 'button',
      class: dayClasses('wk-col', date, dow, holiday, isToday),
      dataset: { date },
      onclick: () => this.onDayClick(date),
    },
      el('span', { class: 'sr-only' }, formatLong(date)),
      el('span', { class: 'wk-col-head', 'aria-hidden': 'true' },
        el('span', { class: 'wk-name' }, WEEKDAYS[dow]),
        el('span', { class: 'wk-num' }, String(parseDateStr(date).getDate())),
      ),
      holiday ? el('span', { class: 'wk-holiday' }, holiday) : null,
      el('span', { class: 'wk-col-body' },
        items.map((o) =>
          el('span', { class: o.dday ? 'wk-chip is-dday' : 'wk-chip', style: { '--cat': o.category.color }, oncontextmenu: (e) => this.onItemMenu(e, o) },
            o.start_time || o.end_time ? el('span', { class: 'wk-time' }, formatTimeRange(o.start_time, o.end_time)) : null,
            el('span', { class: 'wk-title' }, o.title),
          )),
        // 루틴 기록은 그날 일정 아래에 '🏃 운동'처럼
        logs.map((l) =>
          el('span', { class: 'wk-chip is-routine', oncontextmenu: (e) => this.onLogMenu(e, l) },
            l.start_time || l.end_time ? el('span', { class: 'wk-time' }, formatTimeRange(l.start_time, l.end_time)) : null,
            el('span', { class: 'wk-title' }, `${l.routine.emoji} ${l.routine.name}`),
          )),
        items.length || logs.length ? null : el('span', { class: 'wk-empty' }, '일정 없음'),
      ),
    );
  }

  // ---------------------------------------------------------------- 세로 배치: 하루 = 가로 줄 하나
  renderRow(date, dow, items, holiday, isToday, logs) {
    return el('button', {
      type: 'button',
      class: dayClasses('wk-day', date, dow, holiday, isToday),
      dataset: { date },
      onclick: () => this.onDayClick(date),
    },
      el('span', { class: 'sr-only' }, formatLong(date)), // 화면 읽기 프로그램용 전체 날짜
      el('span', { class: 'wk-date', 'aria-hidden': 'true' },
        el('span', { class: 'wk-num' }, String(parseDateStr(date).getDate())),
        el('span', { class: 'wk-name' }, `${WEEKDAYS[dow]}요일`),
      ),
      el('span', { class: 'wk-body' },
        holiday ? el('span', { class: 'wk-holiday' }, holiday) : null,
        items.map((o) =>
          el('span', { class: o.dday ? 'wk-item is-dday' : 'wk-item', style: { '--cat': o.category.color }, oncontextmenu: (e) => this.onItemMenu(e, o) },
            el('span', { class: 'wk-time' }, formatTimeRange(o.start_time, o.end_time)),
            el('span', { class: 'wk-title' }, o.title),
            o.memo ? el('span', { class: 'wk-memo' }, o.memo.split('\n')[0]) : null,
          )),
        logs.map((l) =>
          el('span', { class: 'wk-item is-routine', oncontextmenu: (e) => this.onLogMenu(e, l) },
            el('span', { class: 'wk-time' }, formatTimeRange(l.start_time, l.end_time)),
            el('span', { class: 'wk-title' }, `${l.routine.emoji} ${l.routine.name}`),
            l.memo ? el('span', { class: 'wk-memo' }, l.memo) : null,
          )),
        items.length || logs.length ? null : el('span', { class: 'wk-empty' }, '일정 없음'),
      ),
    );
  }
}

function dayClasses(base, date, dow, holiday, isToday) {
  const classes = [base, `wd-${dow}`];
  if (isToday) classes.push('is-today');
  if (holiday) classes.push('is-holiday');
  if (date < todayStr()) classes.push('is-past');
  return classes.join(' ');
}

function readLayout() {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'col' ? 'col' : 'row';
  } catch {
    return 'row';
  }
}
