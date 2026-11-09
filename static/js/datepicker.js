// 여러 날짜를 고르는 작은 달력 (직접 구현).
//
//  - '하루씩' 모드: 누를 때마다 그 날짜를 넣었다 뺐다 (불연속 날짜용)
//  - '기간' 모드 : 시작 날짜와 끝 날짜를 차례로 누르면 그 사이가 모두 들어감 (연속 일정용)
//  - '반복' 모드 : 요일 + 매주/격주 + 기간을 고르면 해당하는 날짜가 한꺼번에 들어감 (0.9.0)
//                  끝 날짜는 처음에 시작 날짜가 있는 달의 말일로 채워 둔다 (빠른 입력과 같은 규칙)
//  - 아래에 고른 날짜 목록이 보이고, 각각 ×로 뺄 수 있다.

import { WEEKDAYS, addDays, datesBetween, el, formatShort, icon, parseDateStr, toDateStr, todayStr } from './utils.js';

const pad = (n) => String(n).padStart(2, '0');
const MAX_CHIPS = 12;
const MAX_REPEAT_DAYS = 366;

const monthEnd = (date) => {
  const d = parseDateStr(date);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};
// 그 날짜가 속한 주의 월요일 (격주 계산용, 서버와 같은 기준)
const mondayOf = (date) => addDays(date, -((parseDateStr(date).getDay() + 6) % 7));

/**
 * start~end(포함) 중 요일이 weekdays(일=0 … 토=6)인 날짜들. interval=2면 첫 날이 있는 주부터 한 주 건너 한 주.
 * (quickadd.py의 repeat_dates와 같은 계산)
 */
export function repeatDates(start, end, weekdays, interval = 1) {
  if (!start || !end || end < start) return [];
  const last = addDays(start, MAX_REPEAT_DAYS - 1) < end ? addDays(start, MAX_REPEAT_DAYS - 1) : end;
  let days = datesBetween(start, last).filter((d) => weekdays.has(parseDateStr(d).getDay()));
  if (interval === 2 && days.length) {
    const week0 = mondayOf(days[0]);
    days = days.filter((d) => Math.round((parseDateStr(mondayOf(d)) - parseDateStr(week0)) / (7 * 86400000)) % 2 === 0);
  }
  return days;
}

export class MultiDatePicker {
  /**
   * @param {object}   opts
   * @param {string[]} opts.selected   처음에 골라져 있을 날짜들
   * @param {string}   [opts.anchor]   편집을 시작한 날짜 (테두리로 표시)
   * @param {Function} [opts.onChange] 선택이 바뀔 때 호출, 인자는 정렬된 날짜 배열
   */
  constructor({ selected = [], anchor = null, onChange = () => {} }) {
    this.selected = new Set(selected);
    this.anchor = anchor;
    this.onChange = onChange;
    this.mode = 'single';
    this.rangeStart = null;

    // 반복 모드의 설정
    const base = anchor || [...this.selected].sort()[0] || todayStr();
    this.repeat = { weekdays: new Set([parseDateStr(base).getDay()]), interval: 1, start: base, end: monthEnd(base) };

    const first = parseDateStr(anchor || [...this.selected].sort()[0] || todayStr());
    this.year = first.getFullYear();
    this.month = first.getMonth(); // 0~11

    this.root = el('div', { class: 'picker' });
    this.render();
  }

  get dates() {
    return [...this.selected].sort();
  }

  // ---------------------------------------------------------------- 조작
  setMode(mode) {
    this.mode = mode;
    this.rangeStart = null;
    this.render();
  }

  moveMonth(delta) {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }

  clickDay(date) {
    if (this.mode === 'repeat') { // 반복 모드에서 날짜를 누르면 그날부터 시작
      this.repeat.start = date;
      if (this.repeat.end < date) this.repeat.end = monthEnd(date);
      this.render();
      this.root.querySelector(`[data-date="${date}"]`)?.focus();
      return;
    }
    if (this.mode === 'single') {
      if (this.selected.has(date)) this.selected.delete(date);
      else this.selected.add(date);
    } else if (this.rangeStart === null) {
      this.rangeStart = date; // 기간의 첫 번째 클릭: 시작점만 기억
    } else {
      for (const d of datesBetween(this.rangeStart, date)) this.selected.add(d);
      this.rangeStart = null;
    }
    this.changed(date);
  }

  remove(date) {
    this.selected.delete(date);
    this.changed();
  }

  clear() {
    this.selected.clear();
    this.rangeStart = null;
    this.changed();
  }

  get repeatPreview() {
    const r = this.repeat;
    return repeatDates(r.start, r.end, r.weekdays, r.interval);
  }

  // 반복 모드의 '날짜 넣기': 해당하는 날짜를 모두 넣고 '하루씩' 모드로 돌아가 결과를 보여 준다
  applyRepeat() {
    const days = this.repeatPreview;
    if (!days.length) return;
    for (const d of days) this.selected.add(d);
    this.mode = 'single';
    this.jumpTo(days[0]);
    this.onChange(this.dates);
    this.root.querySelector('.picker-summary-head strong')?.focus?.();
  }

  changed(focusDate) {
    this.render();
    this.onChange(this.dates);
    // 다시 그리면 포커스가 사라지므로, 키보드 사용자를 위해 같은 날짜에 포커스를 돌려준다.
    if (focusDate) this.root.querySelector(`[data-date="${focusDate}"]`)?.focus();
  }

  // ---------------------------------------------------------------- 그리기
  render() {
    const modeBtn = (mode, label) =>
      el('button', {
        type: 'button',
        class: 'seg-btn',
        'aria-pressed': String(this.mode === mode),
        onclick: () => this.setMode(mode),
      }, label);

    const hint =
      this.mode === 'single'
        ? '날짜를 누를 때마다 넣거나 뺄 수 있어요.'
        : this.mode === 'repeat'
          ? '요일과 기간을 고르고 아래 버튼을 누르세요. 달력의 날짜를 누르면 그날부터 시작해요.'
          : this.rangeStart
            ? `${formatShort(this.rangeStart)}부터 어디까지인지 끝 날짜를 누르세요.`
            : '시작 날짜를 누르세요.';

    this.root.replaceChildren(
      el('div', { class: 'picker-top' },
        el('div', { class: 'seg', role: 'group', 'aria-label': '날짜 선택 방식' },
          modeBtn('single', '하루씩'),
          modeBtn('range', '기간'),
          modeBtn('repeat', '반복'),
        ),
        el('div', { class: 'picker-nav' },
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '이전 달', onclick: () => this.moveMonth(-1) }, icon('M15 6l-6 6 6 6')),
          el('span', { class: 'picker-month' }, `${this.year}년 ${this.month + 1}월`),
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '다음 달', onclick: () => this.moveMonth(1) }, icon('M9 6l6 6-6 6')),
        ),
      ),
      el('p', { class: 'picker-hint' }, hint),
      this.mode === 'repeat' ? this.renderRepeat() : null,
      this.renderGrid(),
      this.renderSummary(),
    );
  }

  // 반복 설정: [일 월 화 수 목 금 토] [매주|격주] 시작 ~ 끝 [N개 날짜 넣기]
  renderRepeat() {
    const r = this.repeat;
    const preview = this.repeatPreview;
    const dayBtn = (i) => el('button', {
      type: 'button', class: `repeat-wd wd-${i}`, 'aria-pressed': String(r.weekdays.has(i)), 'aria-label': `${WEEKDAYS[i]}요일`,
      onclick: () => { if (r.weekdays.has(i)) r.weekdays.delete(i); else r.weekdays.add(i); this.render(); },
    }, WEEKDAYS[i]);
    const intervalBtn = (n, label) => el('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(r.interval === n), onclick: () => { r.interval = n; this.render(); },
    }, label);
    const dateInput = (key, label) => {
      const input = el('input', { type: 'date', class: 'input repeat-date', value: r[key], 'aria-label': label });
      input.addEventListener('change', () => {
        if (!input.value) return;
        r[key] = input.value;
        if (key === 'start' && r.end < r.start) r.end = monthEnd(r.start);
        this.render();
      });
      return input;
    };
    return el('div', { class: 'repeat-box' },
      el('div', { class: 'repeat-row' },
        el('div', { class: 'repeat-wds', role: 'group', 'aria-label': '요일' }, [1, 2, 3, 4, 5, 6, 0].map(dayBtn)),
        el('div', { class: 'seg', role: 'group', 'aria-label': '간격' }, intervalBtn(1, '매주'), intervalBtn(2, '격주')),
      ),
      el('div', { class: 'repeat-row' },
        dateInput('start', '시작 날짜'), el('span', { class: 'time-tilde' }, '~'), dateInput('end', '끝 날짜'),
      ),
      el('button', {
        type: 'button', class: 'btn primary wide repeat-apply', disabled: !preview.length, onclick: () => this.applyRepeat(),
      }, preview.length ? `${preview.length}개 날짜 넣기` : (r.weekdays.size ? '그 기간에 해당하는 날이 없어요' : '요일을 골라 주세요')),
    );
  }

  renderGrid() {
    const grid = el('div', { class: 'picker-grid' });
    WEEKDAYS.forEach((w, i) => grid.append(el('span', { class: `picker-wd wd-${i}` }, w)));

    const firstDow = new Date(this.year, this.month, 1).getDay();
    const lastDay = new Date(this.year, this.month + 1, 0).getDate();
    const today = todayStr();
    const preview = new Set(this.mode === 'repeat' ? this.repeatPreview : []); // 반복으로 들어갈 날짜 미리 보기

    for (let i = 0; i < firstDow; i++) grid.append(el('span'));
    for (let day = 1; day <= lastDay; day++) {
      const date = `${this.year}-${pad(this.month + 1)}-${pad(day)}`;
      const dow = (firstDow + day - 1) % 7;
      const classes = ['picker-day', `wd-${dow}`];
      if (date === today) classes.push('is-today');
      if (date === this.anchor) classes.push('is-anchor');
      if (date === this.rangeStart || (this.mode === 'repeat' && date === this.repeat.start)) classes.push('is-range-start');
      if (preview.has(date)) classes.push('is-preview');
      grid.append(
        el('button', {
          type: 'button',
          class: classes.join(' '),
          dataset: { date },
          'aria-pressed': String(this.selected.has(date)),
          'aria-label': formatShort(date),
          onclick: () => this.clickDay(date),
        }, String(day)),
      );
    }
    return grid;
  }

  renderSummary() {
    const dates = this.dates;
    if (dates.length === 0) {
      return el('div', { class: 'picker-summary empty' },
        el('span', {}, '날짜를 비워 두면 기록지의 할 일로 들어가요.'));
    }
    const chips = dates.slice(0, MAX_CHIPS).map((d) =>
      el('span', { class: 'date-chip' },
        el('button', { type: 'button', class: 'date-chip-label', title: '이 날짜가 있는 달로 이동', onclick: () => this.jumpTo(d) }, formatShort(d)),
        el('button', { type: 'button', class: 'date-chip-x', 'aria-label': `${formatShort(d)} 빼기`, onclick: () => this.remove(d) }, '×'),
      ),
    );
    if (dates.length > MAX_CHIPS) chips.push(el('span', { class: 'date-more' }, `외 ${dates.length - MAX_CHIPS}일`));

    return el('div', { class: 'picker-summary' },
      el('div', { class: 'picker-summary-head' },
        el('strong', {}, `${dates.length}일 선택됨`),
        el('button', { type: 'button', class: 'link-btn', onclick: () => this.clear() }, '모두 지우기'),
      ),
      el('div', { class: 'date-chips' }, chips),
    );
  }

  jumpTo(date) {
    const d = parseDateStr(date);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }
}
