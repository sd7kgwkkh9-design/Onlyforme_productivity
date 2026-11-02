// 주간 화면 (직접 구현)
//
// 한 주(일요일~토요일) 7일을 위에서 아래로 나열하고, 날짜마다 그날 일정을 보여 준다.
// 날짜 줄을 누르면 월간 화면과 똑같이 그 날짜의 편집 창이 열린다.

import { api } from './api.js';
import { slideIn } from './gestures.js';
import { holidaysBetween } from './holidays.js';
import { WEEKDAYS, addDays, el, formatLong, formatTimeRange, parseDateStr, toDateStr, todayStr } from './utils.js';

// 그 날짜가 속한 주의 일요일
export function startOfWeek(dateStr) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return toDateStr(d);
}

// '11월 1일 – 7일' 또는 달이 바뀌면 '10월 26일 – 11월 1일'
export function weekTitle(start) {
  const a = parseDateStr(start);
  const b = parseDateStr(addDays(start, 6));
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}일` : `${b.getMonth() + 1}월 ${b.getDate()}일`;
  return { main: `${a.getMonth() + 1}월 ${a.getDate()}일 – ${right}`, year: String(b.getFullYear()) };
}

export class WeekView {
  /**
   * @param {HTMLElement} root
   * @param {object} opts
   * @param {(date: string) => void} opts.onDayClick
   */
  constructor(root, { onDayClick }) {
    this.root = root;
    this.onDayClick = onDayClick;
    this.start = null;
    this.token = 0; // 빠르게 넘길 때 늦게 도착한 옛 응답을 버리기 위한 번호
  }

  async show(start, direction = 0) {
    this.start = start;
    await this.load(direction);
  }

  async refresh() {
    if (this.start) await this.load(0);
  }

  async load(direction) {
    const start = this.start;
    const end = addDays(start, 7);
    const token = ++this.token;

    const [items, holidays] = await Promise.all([api.occurrences(start, end), holidaysBetween(start, end)]);
    if (token !== this.token) return;

    const holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
    const itemsOf = new Map();
    for (const o of items) {
      if (!itemsOf.has(o.date)) itemsOf.set(o.date, []);
      itemsOf.get(o.date).push(o); // 서버가 이미 그날의 순서대로 정렬해 줌
    }

    const today = todayStr();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      days.push(this.renderDay(date, i, itemsOf.get(date) || [], holidayOf.get(date), date === today));
    }

    const track = el('div', { class: 'week-track' }, days);
    this.root.replaceChildren(track);
    slideIn(track, direction);
  }

  renderDay(date, dow, items, holiday, isToday) {
    const classes = ['wk-day', `wd-${dow}`];
    if (isToday) classes.push('is-today');
    if (holiday) classes.push('is-holiday');
    if (date < todayStr()) classes.push('is-past');

    return el('button', {
      type: 'button',
      class: classes.join(' '),
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
        items.length
          ? items.map((o) =>
              el('span', { class: 'wk-item', style: { '--cat': o.category.color } },
                el('span', { class: 'wk-time' }, formatTimeRange(o.start_time, o.end_time)),
                el('span', { class: 'wk-title' }, o.title),
                o.memo ? el('span', { class: 'wk-memo' }, o.memo.split('\n')[0]) : null,
              ))
          : el('span', { class: 'wk-empty' }, '일정 없음'),
      ),
    );
  }
}
