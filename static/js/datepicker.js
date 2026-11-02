// 여러 날짜를 고르는 작은 달력 (직접 구현).
//
//  - '하루씩' 모드: 누를 때마다 그 날짜를 넣었다 뺐다 (불연속 날짜용)
//  - '기간' 모드 : 시작 날짜와 끝 날짜를 차례로 누르면 그 사이가 모두 들어감 (연속 일정용)
//  - 아래에 고른 날짜 목록이 보이고, 각각 ×로 뺄 수 있다.

import { WEEKDAYS, datesBetween, el, formatShort, icon, parseDateStr, todayStr } from './utils.js';

const pad = (n) => String(n).padStart(2, '0');
const MAX_CHIPS = 12;

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
        : this.rangeStart
          ? `${formatShort(this.rangeStart)}부터 어디까지인지 끝 날짜를 누르세요.`
          : '시작 날짜를 누르세요.';

    this.root.replaceChildren(
      el('div', { class: 'picker-top' },
        el('div', { class: 'seg', role: 'group', 'aria-label': '날짜 선택 방식' },
          modeBtn('single', '하루씩'),
          modeBtn('range', '기간'),
        ),
        el('div', { class: 'picker-nav' },
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '이전 달', onclick: () => this.moveMonth(-1) }, icon('M15 6l-6 6 6 6')),
          el('span', { class: 'picker-month' }, `${this.year}년 ${this.month + 1}월`),
          el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': '다음 달', onclick: () => this.moveMonth(1) }, icon('M9 6l6 6-6 6')),
        ),
      ),
      el('p', { class: 'picker-hint' }, hint),
      this.renderGrid(),
      this.renderSummary(),
    );
  }

  renderGrid() {
    const grid = el('div', { class: 'picker-grid' });
    WEEKDAYS.forEach((w, i) => grid.append(el('span', { class: `picker-wd wd-${i}` }, w)));

    const firstDow = new Date(this.year, this.month, 1).getDay();
    const lastDay = new Date(this.year, this.month + 1, 0).getDate();
    const today = todayStr();

    for (let i = 0; i < firstDow; i++) grid.append(el('span'));
    for (let day = 1; day <= lastDay; day++) {
      const date = `${this.year}-${pad(this.month + 1)}-${pad(day)}`;
      const dow = (firstDow + day - 1) % 7;
      const classes = ['picker-day', `wd-${dow}`];
      if (date === today) classes.push('is-today');
      if (date === this.anchor) classes.push('is-anchor');
      if (date === this.rangeStart) classes.push('is-range-start');
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
        el('span', {}, '날짜를 비워 두면 기한 미정 목록에 들어가요.'));
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
