// 시간표 (0.13.0) — 상단의 [월간 | 이번 주 | 시간표] 중 '시간표'
//
// 학교 수업뿐 아니라 학원, 알바, 운동처럼 매주 반복되는 틀을 시간표처럼 정해 둔다.
// 일정처럼 날짜마다 저장하지 않고 '규칙'(요일 + 시간)으로 두어서, 강의실이 바뀌면 칸 하나만 고치면 된다 (서버: timetable.py).
//
//   - 시간표 여러 개: '2학기 수업'(9/1~12/20, 공휴일엔 쉬기), '학원', '알바'처럼. 시간표마다 기간과 색이 있다.
//   - 격자(요일 × 시간)의 빈 곳을 누르면 그 시간에, 끌면 끈 만큼의 칸을 만든다. 칸을 누르면 고친다.
//   - 시간이 겹치는 칸은 빨간 테두리로 알려 준다 (다른 시간표끼리도).
//   - '이날만 쉬기'는 하루 화면의 수업을 오른쪽 클릭 (휴강, 시험 기간).
//   - 달력에 어떻게 보일지 기기마다 고른다 (보기 설정):
//       같이   월간·주간·하루 화면에 일정과 같이
//       아래   하루 화면에서 일정 아래에 따로 (기본) — 월간 칸이 수업으로 꽉 차지 않게
//       따로   시간표 화면에서만
//   - '반복 일정에서 가져오기': 빠른 입력의 '매주 월수 9시 컴구'로 만든 반복 일정을 시간표 칸으로 옮긴다.
//   - 아래쪽에 한 주에 몇 시간인지(시간표마다) 보여 준다.

import { api } from './api.js';
import { openMenu } from './ctxmenu.js';
import { timeSelect } from './timepicker.js';
import { addDays, ask, el, formatShort, parseDateStr, toDateStr, toast, todayStr } from './utils.js';

const DISPLAY_KEY = 'my-calendar:tt-display';
const FILTER_KEY = 'my-calendar:tt-filter';
const DISPLAYS = [['with', '같이', '월간·주간·하루 화면에 일정과 같이'], ['below', '아래', '하루 화면에서 일정 아래에 따로'], ['only', '따로', '시간표 화면에서만']];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월요일부터
const COLORS = ['#3D6FD9', '#3FA66B', '#F08C2E', '#7C5CD6', '#2BA5B5', '#D45A9A', '#D9A514', '#E5534B'];
const SNAP = 10; // 끌어서 만들 때 10분 단위

// ---------------------------------------------------------------- 보기 설정 (기기마다)
export function displayMode() {
  try {
    const v = localStorage.getItem(DISPLAY_KEY);
    return DISPLAYS.some(([k]) => k === v) ? v : 'below';
  } catch { return 'below'; }
}

function setDisplayMode(v) {
  try { localStorage.setItem(DISPLAY_KEY, v); } catch { /* 이번 화면에만 */ }
  window.dispatchEvent(new CustomEvent('tt-display-change', { detail: v }));
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const minutesText = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

const SKIP_TEXT = { skip: '쉼', all: '쉼', holiday: '공휴일' };

/** 하루 화면·주간 화면에 쓰는 수업 한 줄 이름표 */
export function classLabel(c) {
  return `${c.title}${c.place ? ` · ${c.place}` : ''}`;
}

/** 하루 화면(sheet.js)의 '시간표' 묶음. 쉬는 수업도 흐리게 보여 주고, 오른쪽 클릭으로 이날만 쉬기·다시 하기 */
export function classSection({ date, classes, onChanged, onOpenTimetable }) {
  if (!classes.length) return null;
  const row = (c) => {
    const li = el('li', {
      class: ['tt-day-row', c.skipped ? 'is-skipped' : ''].join(' ').trim(), style: { '--cat': c.color },
      title: c.skipped ? '쉬는 날 — 오른쪽 클릭으로 다시 하기' : '오른쪽 클릭: 이날만 쉬기',
    },
      el('span', { class: 'item-time' }, el('span', { class: 't-start' }, `${c.start_time}~`), el('span', { class: 't-end' }, c.end_time)),
      el('span', { class: 'item-main' },
        el('span', { class: 'item-title' }, c.title, c.skipped ? el('span', { class: 'tt-skip-badge' }, c.holiday || SKIP_TEXT[c.skipped]) : null),
        el('span', { class: 'item-meta' }, el('span', { class: 'item-cat' }, c.timetable), c.place ? el('span', { class: 'item-memo' }, c.place) : null)),
    );
    const menu = (e) => openMenu(e, [
      c.skipped === 'skip' || c.skipped === 'all'
        ? { label: '다시 하기 (쉬는 날 취소)', run: () => skip(c, false, c.skipped === 'all' ? 0 : c.block_id) }
        : { label: '이날만 쉬기', run: () => skip(c, true, c.block_id) },
      c.skipped ? null : { label: `이날 '${c.timetable}' 전부 쉬기`, run: () => skip(c, true, 0) },
      { label: '시간표에서 고치기', run: () => onOpenTimetable(c.block_id) },
    ], { title: `${formatShort(date)} ${c.title}` });
    li.addEventListener('contextmenu', menu);
    li.addEventListener('click', menu);
    return li;
  };
  async function skip(c, on, blockId) {
    try {
      await api.setSkip({ timetable_id: c.timetable_id, block_id: blockId, date, skip: on });
      await onChanged();
      toast(on ? `${formatShort(date)} ${blockId ? c.title : c.timetable} 쉬어요` : '다시 해요', 'info', on ? {
        action: { label: '되돌리기', run: async () => { await api.setSkip({ timetable_id: c.timetable_id, block_id: blockId, date, skip: false }); await onChanged(); } },
      } : {});
    } catch (e) { toast(e.message, 'error'); }
  }
  return el('section', { class: 'tt-day' },
    el('h3', { class: 'routine-day-head' }, '시간표'),
    el('ul', { class: 'item-list tt-day-list' }, classes.map(row)));
}

// ================================================================ 시간표 화면
export class TimetableView {
  /**
   * @param {HTMLElement} root   <section id="timetable">
   * @param {object} o
   * @param {() => import('./sheet.js').Sheet} o.sheet   폼을 띄울 팝업 창
   * @param {() => Promise} o.onChanged   시간표가 바뀌었을 때 (달력·주간·하루 화면 다시 그리기)
   */
  constructor(root, { sheet, onChanged }) {
    this.root = root;
    this.sheet = sheet;
    this.onChanged = onChanged;
    this.data = { timetables: [], skips: [] };
    this.filter = 'all';
    try { this.filter = localStorage.getItem(FILTER_KEY) || 'all'; } catch { /* 무시 */ }
    this.drag = null;
    this.clock = null;
  }

  async show() {
    if (!this.root.childElementCount) this.root.replaceChildren(el('p', { class: 'muted pad' }, '불러오는 중…'));
    await this.load();
    clearInterval(this.clock);
    this.clock = setInterval(() => { if (!this.root.hidden) this.placeNow(); }, 60_000);
  }

  async load() {
    try {
      this.data = await api.timetables();
    } catch (e) {
      this.root.replaceChildren(el('p', { class: 'form-error pad' }, e.message));
      return;
    }
    this.render();
  }

  async changed() {
    await this.load();
    await this.onChanged();
  }

  tables() {
    const all = this.data.timetables;
    if (this.filter !== 'all' && !all.some((t) => String(t.id) === String(this.filter))) this.filter = 'all';
    return this.filter === 'all' ? all : all.filter((t) => String(t.id) === String(this.filter));
  }

  setFilter(f) {
    this.filter = f;
    try { localStorage.setItem(FILTER_KEY, String(f)); } catch { /* 무시 */ }
    this.render();
  }

  // ---------------------------------------------------------------- 그리기
  render() {
    const all = this.data.timetables;
    const bar = el('div', { class: 'tt-bar' },
      el('div', { class: 'tt-chips', role: 'group', 'aria-label': '시간표 고르기' },
        all.length > 1 ? el('button', { type: 'button', class: 'tt-chip', 'aria-pressed': String(this.filter === 'all'), onclick: () => this.setFilter('all') }, '전체') : null,
        all.map((t) => {
          const chip = el('button', {
            type: 'button', class: 'tt-chip', style: { '--cat': t.color }, 'aria-pressed': String(String(this.filter) === String(t.id) || all.length === 1),
            title: `${t.name} — 한 번 더 누르면 설정`,
            onclick: () => (String(this.filter) === String(t.id) || all.length === 1 ? this.openTimetableForm(t) : this.setFilter(t.id)),
          }, el('span', { class: 'dot' }), t.name, periodBadge(t));
          chip.addEventListener('contextmenu', (e) => openMenu(e, [
            { label: '설정 (이름·기간·색)', run: () => this.openTimetableForm(t) },
            { label: '이 시간표만 보기', run: () => this.setFilter(t.id) },
            { label: '삭제', danger: true, run: () => this.removeTimetable(t) },
          ], { title: t.name }));
          return chip;
        }),
        el('button', { type: 'button', class: 'tt-chip is-add', onclick: () => this.openTimetableForm(null) }, '+ 시간표')),
      el('div', { class: 'tt-tools' },
        el('button', { type: 'button', class: 'btn sm ghost', onclick: () => this.openImport() }, '반복 일정 가져오기'),
        this.displaySeg()));

    if (!all.length) {
      this.root.replaceChildren(bar, el('div', { class: 'tt-empty' },
        el('p', { class: 'tt-empty-title' }, '매주 반복되는 틀을 시간표로 정해 두세요'),
        el('p', { class: 'muted' }, '학교 수업, 학원, 알바, 운동처럼요. 시간표마다 기간(학기)과 색을 정하고, 빈 칸을 눌러 수업을 넣어요.'),
        el('div', { class: 'tt-empty-buttons' },
          el('button', { type: 'button', class: 'btn primary', onclick: () => this.openTimetableForm(null) }, '시간표 만들기'),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => this.openImport() }, '반복 일정에서 가져오기'))));
      return;
    }
    this.root.replaceChildren(bar, this.grid(), this.summary());
    this.placeNow();
    this.root.querySelector('.tt-scroll')?.scrollTo({ top: Math.max(0, (this.firstMin() - this.startHour * 60) * this.ppm - 12) });
  }

  displaySeg() {
    const mode = displayMode();
    return el('div', { class: 'seg tt-display', role: 'group', 'aria-label': '달력에 보이기 (이 기기)' },
      el('span', { class: 'tt-display-label' }, '달력에'),
      DISPLAYS.map(([k, label, hint]) => el('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(mode === k), title: hint,
        onclick: () => { setDisplayMode(k); this.render(); toast(`시간표: ${hint} (이 기기)`); },
      }, label)));
  }

  blocks() {
    return this.tables().flatMap((t) => t.blocks.map((b) => ({ ...b, table: t })));
  }

  firstMin() {
    const bs = this.blocks();
    return bs.length ? Math.min(...bs.map((b) => toMin(b.start_time))) : 9 * 60;
  }

  grid() {
    const blocks = this.blocks();
    const days = ORDER.filter((w) => w >= 1 && w <= 5 || blocks.some((b) => b.weekday === w));
    const startHour = Math.min(9, ...blocks.map((b) => Math.floor(toMin(b.start_time) / 60)));
    const endHour = Math.max(18, ...blocks.map((b) => Math.ceil(toMin(b.end_time) / 60)));
    this.startHour = startHour;
    this.endHour = endHour;
    this.days = days;
    this.ppm = 0.9; // 1분 = 0.9px (1시간 54px)
    const height = (endHour - startHour) * 60 * this.ppm;
    const todayWd = new Date().getDay();
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

    const cols = days.map((w) => {
      const mine = blocks.filter((b) => b.weekday === w).sort((a, b) => a.start_time.localeCompare(b.start_time));
      const lanes = layout(mine);
      const col = el('div', { class: ['tt-col', w === todayWd ? 'is-today' : ''].join(' ').trim(), dataset: { wd: String(w) }, style: { height: `${height}px` } },
        hours.slice(0, -1).map((h) => el('span', { class: 'tt-hline', style: { top: `${(h - startHour) * 60 * this.ppm}px` } })),
        mine.map((b) => this.blockNode(b, lanes.get(b.id))));
      col.addEventListener('pointerdown', (e) => this.startDrag(e, col, w));
      return col;
    });
    const head = el('div', { class: 'tt-head' }, el('span', { class: 'tt-corner' }),
      days.map((w) => el('span', { class: ['tt-day-name', w === todayWd ? 'is-today' : '', w === 0 ? 'is-sun' : w === 6 ? 'is-sat' : ''].join(' ').trim() }, WD[w])));
    const axis = el('div', { class: 'tt-axis', style: { height: `${height}px` } },
      hours.map((h) => el('span', { style: { top: `${(h - startHour) * 60 * this.ppm}px` } }, `${h}`)));
    return el('div', { class: 'tt-grid', style: { '--days': String(days.length) } },
      head,
      el('div', { class: 'tt-scroll' }, el('div', { class: 'tt-body' }, axis, el('div', { class: 'tt-cols' }, cols))),
      el('p', { class: 'tt-hint' }, '빈 곳을 누르거나 끌어서 칸을 넣고, 칸을 누르면 고쳐요. 쉬는 날은 하루 화면의 수업을 오른쪽 클릭.'));
  }

  blockNode(b, lane) {
    const top = (toMin(b.start_time) - this.startHour * 60) * this.ppm;
    const h = Math.max(18, (toMin(b.end_time) - toMin(b.start_time)) * this.ppm - 2);
    const { index = 0, count = 1, conflict = false } = lane || {};
    const node = el('button', {
      type: 'button', class: ['tt-block', conflict ? 'is-conflict' : '', h < 40 ? 'is-short' : ''].join(' ').trim(),
      style: { top: `${top}px`, height: `${h}px`, left: `calc(${(index / count) * 100}% + 2px)`, width: `calc(${100 / count}% - 4px)`, '--cat': b.color },
      title: `${b.title} ${b.start_time}~${b.end_time}${b.place ? ` · ${b.place}` : ''} (${b.table.name})${conflict ? ' — 다른 칸과 시간이 겹쳐요' : ''}`,
      dataset: { id: String(b.id) },
      onclick: (e) => { e.stopPropagation(); this.openBlockForm({ block: b }); },
    },
      el('span', { class: 'tt-block-title' }, b.title),
      el('span', { class: 'tt-block-time' }, `${b.start_time}~${b.end_time}`),
      b.place ? el('span', { class: 'tt-block-place' }, b.place) : null);
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('contextmenu', (e) => openMenu(e, [
      { label: '고치기', run: () => this.openBlockForm({ block: b }) },
      { label: '같은 내용으로 다른 요일에 복사', run: () => this.openBlockForm({ copy: b }) },
      { label: '삭제', danger: true, run: () => this.removeBlock(b) },
    ], { title: `${WD[b.weekday]} ${b.title}` }));
    return node;
  }

  summary() {
    // 한 주에 몇 시간: 시간표마다 (기간이 지금을 지나는 것만 '이번 주'로 센다)
    const today = todayStr();
    const per = this.tables().map((t) => ({
      t, min: t.blocks.reduce((s, b) => s + toMin(b.end_time) - toMin(b.start_time), 0),
      active: (!t.start_date || t.start_date <= today) && (!t.end_date || t.end_date >= today),
    })).filter((x) => x.min);
    if (!per.length) return el('p', { class: 'tt-sum muted' }, '아직 칸이 없어요. 위의 빈 곳을 눌러 넣어 보세요.');
    const total = per.filter((x) => x.active).reduce((s, x) => s + x.min, 0);
    return el('p', { class: 'tt-sum' },
      el('b', {}, `이번 주 ${minutesText(total)}`),
      per.map((x) => el('span', { class: x.active ? '' : 'is-off', style: { '--cat': x.t.color } },
        el('span', { class: 'dot' }), `${x.t.name} ${minutesText(x.min)}${x.active ? '' : ' (기간 밖)'}`)));
  }

  placeNow() {
    const cols = this.root.querySelector('.tt-cols');
    this.root.querySelector('.tt-now')?.remove();
    const col = cols?.querySelector(`.tt-col[data-wd="${new Date().getDay()}"]`);
    if (!col) return;
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    if (min < this.startHour * 60 || min > this.endHour * 60) return;
    col.append(el('span', { class: 'tt-now', style: { top: `${(min - this.startHour * 60) * this.ppm}px` }, 'aria-hidden': 'true' }));
  }

  // ---------------------------------------------------------------- 빈 곳을 누르거나 끌어서 칸 만들기
  startDrag(e, col, weekday) {
    if (e.button !== 0) return;
    const rect = col.getBoundingClientRect();
    const minAt = (y) => Math.max(this.startHour * 60, Math.min(this.endHour * 60,
      this.startHour * 60 + Math.round((y - rect.top) / this.ppm / SNAP) * SNAP));
    const from = minAt(e.clientY);
    const ghost = el('span', { class: 'tt-ghost' });
    col.append(ghost);
    let to = from;
    let moved = false;
    const draw = () => {
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      ghost.style.top = `${(a - this.startHour * 60) * this.ppm}px`;
      ghost.style.height = `${Math.max(SNAP, b - a) * this.ppm}px`;
      ghost.textContent = moved ? `${toTime(a)}~${toTime(b)}` : '';
    };
    draw();
    col.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const m = minAt(ev.clientY);
      if (Math.abs(m - from) >= SNAP) moved = true;
      to = m;
      draw();
    };
    const up = () => {
      col.removeEventListener('pointermove', move);
      col.removeEventListener('pointerup', up);
      col.removeEventListener('pointercancel', cancel);
      ghost.remove();
      let a = Math.min(from, to);
      let b = Math.max(from, to);
      if (!moved || b - a < 20) { a = Math.floor(from / 30) * 30; b = a + 60; } // 그냥 누르면 1시간짜리
      this.openBlockForm({ weekday, start: toTime(a), end: toTime(Math.min(b, 24 * 60 - 1)) });
    };
    const cancel = () => { ghost.remove(); col.removeEventListener('pointermove', move); col.removeEventListener('pointerup', up); };
    col.addEventListener('pointermove', move);
    col.addEventListener('pointerup', up);
    col.addEventListener('pointercancel', cancel);
  }

  // ---------------------------------------------------------------- 칸 넣기·고치기
  openBlockForm({ block = null, copy = null, weekday = null, start = '09:00', end = '10:00' }) {
    const sheet = this.sheet();
    if (!sheet) return;
    const tables = this.data.timetables;
    if (!tables.length) { this.openTimetableForm(null); return; }
    const src = block || copy;
    sheet.showView('tt-block', {
      render: (s) => {
        s.setHead(block ? '시간표 칸 고치기' : '시간표 칸 넣기', block ? `${block.table.name} · ${WD[block.weekday]}요일` : '요일을 여러 개 고르면 요일마다 하나씩 들어가요.');
        const uid = `${s.kind}-tt`;
        const title = el('input', { type: 'text', class: 'input', maxlength: '40', value: src?.title || '', placeholder: '예: 컴퓨터구조, 수학 학원, 카페 알바', 'aria-label': '이름' });
        const place = el('input', { type: 'text', class: 'input', maxlength: '40', value: src?.place || '', placeholder: '예: 공학관 301 (선택)', 'aria-label': '장소' });
        const memo = el('textarea', { class: 'input', rows: '2', maxlength: '500', value: src?.memo || '', placeholder: '교수님, 준비물 등 (선택)', 'aria-label': '메모' });
        const preferred = String(this.filter) !== 'all' ? Number(this.filter) : tables[0].id;
        const tableSel = el('select', { class: 'input', 'aria-label': '시간표' },
          tables.map((t) => el('option', { value: String(t.id), selected: t.id === (src?.table?.id ?? preferred) }, t.name)));
        const days = new Set(block ? [block.weekday] : copy ? [] : [weekday ?? 1]);
        const daySeg = el('div', { class: 'seg tt-days', role: 'group', 'aria-label': '요일' });
        const drawDays = () => daySeg.replaceChildren(...ORDER.map((w) => el('button', {
          type: 'button', class: 'seg-btn', 'aria-pressed': String(days.has(w)),
          onclick: () => { if (block) { days.clear(); days.add(w); } else if (days.has(w)) days.delete(w); else days.add(w); drawDays(); },
        }, WD[w])));
        drawDays();
        const st = timeSelect('시작', `${uid}-start`, src?.start_time || start, 'f-start');
        const et = timeSelect('끝', `${uid}-end`, src?.end_time || end, 'f-end');
        const own = el('input', { type: 'checkbox', checked: Boolean(src?.own_color) });
        const color = el('input', { type: 'color', class: 'swatch-custom', value: (src?.color || tables[0].color).toLowerCase(), 'aria-label': '이 칸만의 색' });
        const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
        const form = el('form', { class: 'form', id: `${uid}-form`, novalidate: true },
          el('div', { class: 'field' }, el('label', { class: 'label' }, '이름'), title),
          el('div', { class: 'field' }, el('label', { class: 'label' }, '요일'), daySeg),
          el('div', { class: 'field' }, el('div', { class: 'time-fields' }, st.node, el('span', { class: 'time-tilde' }, '~'), et.node)),
          el('div', { class: 'field' }, el('label', { class: 'label' }, '장소'), place),
          el('div', { class: 'field' }, el('label', { class: 'label' }, '시간표'), tableSel),
          el('div', { class: 'field' }, el('label', { class: 'anniv-check' }, own, '이 칸만 다른 색', color)),
          el('div', { class: 'field' }, el('label', { class: 'label' }, '메모'), memo),
          errorEl);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!days.size) { errorEl.textContent = '요일을 하나 이상 골라 주세요.'; errorEl.hidden = false; return; }
          const payload = {
            title: title.value, place: place.value, memo: memo.value, start_time: st.value, end_time: et.value,
            color: own.checked ? color.value : null,
          };
          try {
            let res;
            if (block) {
              const tid = Number(tableSel.value);
              if (tid !== block.timetable_id) {
                // 다른 시간표로 옮기기 = 그 시간표에 새로 만들고 원래 칸 지우기
                res = await api.createBlocks(tid, { ...payload, weekdays: [...days] });
                await api.deleteBlock(block.id);
              } else {
                res = await api.updateBlock(block.id, { ...payload, weekday: [...days][0] });
              }
            } else {
              res = await api.createBlocks(Number(tableSel.value), { ...payload, weekdays: [...days] });
            }
            const conflicts = res.conflicts || [];
            if (conflicts.length) {
              const c = conflicts[0];
              toast(`저장했어요. ${WD[c.weekday]} ${c.start_time}~${c.end_time} '${c.title}'(${c.timetable})과 시간이 겹쳐요.`, 'error');
            } else toast(block ? '고쳤어요' : `${days.size > 1 ? `${days.size}개 요일에 ` : ''}넣었어요`);
            s.root.close?.();
            await this.changed();
          } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; }
        });
        s.setBody(form);
        s.setFoot(
          block ? el('button', { type: 'button', class: 'btn danger', onclick: async () => { if (await this.removeBlock(block)) s.root.close?.(); } }, '삭제') : null,
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => s.root.close?.() }, '취소'),
          el('button', { type: 'submit', form: `${uid}-form`, class: 'btn primary' }, '저장'));
        if (!block) setTimeout(() => title.focus());
      },
    });
  }

  async removeBlock(b) {
    const ok = await ask(`${WD[b.weekday]}요일 '${b.title}' 칸을 지울까요?`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return false;
    try { await api.deleteBlock(b.id); toast('지웠어요'); await this.changed(); return true; } catch (e) { toast(e.message, 'error'); return false; }
  }

  // ---------------------------------------------------------------- 시간표 만들기·설정
  openTimetableForm(t) {
    const sheet = this.sheet();
    if (!sheet) return;
    sheet.showView('tt-table', {
      render: (s) => {
        s.setHead(t ? '시간표 설정' : '새 시간표', '학기·방학처럼 기간을 정해 두면 그 기간에만 달력에 보여요.');
        const used = new Set(this.data.timetables.map((x) => x.color));
        const name = el('input', { type: 'text', class: 'input', maxlength: '30', value: t?.name || '', placeholder: '예: 2학기 수업, 영어 학원, 알바', 'aria-label': '이름' });
        const start = el('input', { type: 'date', class: 'input', value: t?.start_date || '', 'aria-label': '시작' });
        const end = el('input', { type: 'date', class: 'input', value: t?.end_date || '', 'aria-label': '끝' });
        const holidays = el('input', { type: 'checkbox', checked: t ? t.skip_holidays : true });
        let color = t?.color || COLORS.find((c) => !used.has(c)) || COLORS[0];
        const swatches = el('div', { class: 'pj-colors', role: 'radiogroup', 'aria-label': '색' });
        const drawColors = () => swatches.replaceChildren(...COLORS.map((c) => el('button', {
          type: 'button', class: 'pj-color', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c, style: { '--pj': c },
          onclick: () => { color = c; drawColors(); },
        })));
        drawColors();
        const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
        const id = `${s.kind}-ttt-form`;
        const form = el('form', { class: 'form', id, novalidate: true },
          el('div', { class: 'field' }, el('label', { class: 'label' }, '이름'), name),
          el('div', { class: 'field' }, el('label', { class: 'label' }, '기간 (비워 두면 계속)'),
            el('div', { class: 'tt-period' }, start, el('span', {}, '~'), end),
            el('div', { class: 'tt-presets' }, presetButtons((a, b) => { start.value = a; end.value = b; }))),
          el('div', { class: 'field' }, el('label', { class: 'anniv-check' }, holidays, '공휴일엔 쉬기'),
            el('p', { class: 'field-hint' }, '켜 두면 공휴일(대체 공휴일 포함)에는 이 시간표의 칸이 달력에 안 보여요.')),
          el('div', { class: 'field' }, el('label', { class: 'label' }, '색'), swatches),
          errorEl);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const payload = { name: name.value, color, start_date: start.value || null, end_date: end.value || null, skip_holidays: holidays.checked };
          try {
            const saved = t ? await api.updateTimetable(t.id, payload) : await api.createTimetable(payload);
            toast(t ? '시간표를 바꿨어요' : '시간표를 만들었어요. 빈 곳을 눌러 칸을 넣어 보세요.');
            if (!t) this.setFilter(saved.id);
            s.root.close?.();
            await this.changed();
          } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; }
        });
        s.setBody(form);
        s.setFoot(
          t ? el('button', { type: 'button', class: 'btn danger', onclick: async () => { if (await this.removeTimetable(t)) s.root.close?.(); } }, '삭제') : null,
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => s.root.close?.() }, '취소'),
          el('button', { type: 'submit', form: id, class: 'btn primary' }, t ? '저장' : '만들기'));
        if (!t) setTimeout(() => name.focus());
      },
    });
  }

  async removeTimetable(t) {
    const ok = await ask(`'${t.name}' 시간표를 지울까요? 칸 ${t.blocks.length}개와 쉬는 날도 함께 지워져요.`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return false;
    try { await api.deleteTimetable(t.id); toast('시간표를 지웠어요'); await this.changed(); return true; } catch (e) { toast(e.message, 'error'); return false; }
  }

  // ---------------------------------------------------------------- 반복 일정 → 시간표
  openImport() {
    const sheet = this.sheet();
    if (!sheet) return;
    sheet.showView('tt-import', {
      render: async (s) => {
        s.setHead('반복 일정 가져오기', "'매주 월수 9시 컴구'처럼 매주 같은 요일·시간에 들어간 일정을 시간표 칸으로 옮겨요.");
        s.loading();
        let list;
        try { list = await api.importCandidates(); } catch (e) { return s.failed(e); }
        if (!list.length) {
          s.setBody(el('p', { class: 'empty' }, '옮길 만한 반복 일정이 없어요. (시작·끝 시간이 있고, 같은 요일에 매주 두 번 넘게 들어간 일정)'));
          s.setFoot();
          return;
        }
        const picked = new Set(list.map((c) => c.item_id));
        const rows = list.map((c) => {
          const box = el('input', { type: 'checkbox', checked: true, onchange: (e) => (e.target.checked ? picked.add(c.item_id) : picked.delete(c.item_id)) });
          return el('li', { class: 'tt-import-row', style: { '--cat': c.category.color } },
            el('label', {}, box,
              el('span', { class: 'item-main' },
                el('span', { class: 'item-title' }, c.title),
                el('span', { class: 'item-meta' }, `${c.label} · ${formatShort(c.first)}~${formatShort(c.last)} · ${c.count}번`))));
        });
        const target = el('select', { class: 'input', 'aria-label': '옮길 시간표' },
          el('option', { value: 'new' }, '새 시간표 만들기 (기간은 일정에 맞춰서)'),
          this.data.timetables.map((t) => el('option', { value: String(t.id) }, t.name)));
        const newName = el('input', { type: 'text', class: 'input', maxlength: '30', value: '수업', 'aria-label': '새 시간표 이름' });
        target.addEventListener('change', () => { newName.hidden = target.value !== 'new'; });
        const del = el('input', { type: 'checkbox', checked: true });
        const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
        s.setBody(
          el('ul', { class: 'tt-import-list' }, rows),
          el('div', { class: 'form' },
            el('div', { class: 'field' }, el('label', { class: 'label' }, '어디로'), target, newName),
            el('div', { class: 'field' }, el('label', { class: 'anniv-check' }, del, '옮긴 뒤 원래 반복 일정은 지우기'),
              el('p', { class: 'field-hint' }, '같은 수업이 두 번 보이지 않게 지우는 걸 권해요. 빠진 주(시험 기간 등)는 \'이날만 쉬기\'로 그대로 옮겨져요.')),
            errorEl));
        s.setFoot(
          el('span', { class: 'spacer' }),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => s.root.close?.() }, '취소'),
          el('button', {
            type: 'button', class: 'btn primary', onclick: async () => {
              if (!picked.size) { errorEl.textContent = '옮길 일정을 골라 주세요.'; errorEl.hidden = false; return; }
              try {
                const res = await api.importItems({
                  item_ids: [...picked], delete_items: del.checked,
                  ...(target.value === 'new' ? { new_name: newName.value || '수업' } : { timetable_id: Number(target.value) }),
                });
                toast(`시간표 칸 ${res.blocks}개로 옮겼어요${res.deleted ? ` · 원래 일정 ${res.deleted}개는 지웠어요` : ''}`);
                this.setFilter(res.timetable.id);
                s.root.close?.();
                await this.changed();
              } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; }
            },
          }, '옮기기'));
      },
    });
  }

  /** 하루 화면의 '시간표에서 고치기' */
  editBlock(blockId) {
    const b = this.data.timetables.flatMap((t) => t.blocks.map((x) => ({ ...x, table: t }))).find((x) => x.id === blockId);
    if (b) this.openBlockForm({ block: b });
  }
}

// 같은 요일 안에서 시간이 겹치는 칸을 나란히 놓는다 (겹치는 묶음마다 몇 줄로 나눌지)
function layout(blocks) {
  const out = new Map();
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const b of group) {
      let i = lanes.findIndex((endMin) => endMin <= toMin(b.start_time));
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = toMin(b.end_time);
      out.set(b.id, { index: i, count: 0, conflict: group.length > 1 });
    }
    for (const b of group) out.get(b.id).count = lanes.length;
    group = [];
  };
  for (const b of blocks) {
    if (group.length && toMin(b.start_time) >= groupEnd) flush();
    group.push(b);
    groupEnd = Math.max(groupEnd, toMin(b.end_time));
  }
  if (group.length) flush();
  return out;
}

function periodBadge(t) {
  const today = todayStr();
  if (t.end_date && t.end_date < today) return el('span', { class: 'tt-chip-sub' }, '끝남');
  if (t.start_date && t.start_date > today) return el('span', { class: 'tt-chip-sub' }, `${formatShort(t.start_date)}부터`);
  if (t.end_date) return el('span', { class: 'tt-chip-sub' }, `~${formatShort(t.end_date)}`);
  return null;
}

// 기간 빠르게 채우기: 이번 학기, 다음 학기, 방학
function presetButtons(set) {
  const today = parseDateStr(todayStr());
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const iso = (yy, mm, dd) => toDateStr(new Date(yy, mm - 1, dd));
  const presets = [];
  if (m >= 3 && m <= 6) presets.push(['이번 학기', iso(y, 3, 1), iso(y, 6, 20)]);
  if (m >= 9) presets.push(['이번 학기', iso(y, 9, 1), iso(y, 12, 20)]);
  if (m >= 7 || m <= 2) presets.push(['다음 학기', iso(m >= 7 ? y + 1 : y, 3, 1), iso(m >= 7 ? y + 1 : y, 6, 20)]);
  else presets.push(['다음 학기', iso(y, 9, 1), iso(y, 12, 20)]);
  const winterStart = m <= 2 ? iso(y - 1, 12, 21) : iso(y, 12, 21);
  presets.push(['겨울방학', winterStart, addDays(iso(m <= 2 ? y : y + 1, 3, 1), -1)]);
  presets.push(['계속 (기간 없음)', '', '']);
  return presets.map(([label, a, b]) => el('button', { type: 'button', class: 'btn sm ghost', onclick: () => set(a, b) }, label));
}
