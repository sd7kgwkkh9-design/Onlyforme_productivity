// 기록지 — 화면 왼쪽에 열리는 '적어 두는 곳' (7차, 0.9.0에서 메모·목표·할 일로 넓힘)
//
//   [전체 | 메모 | 목표 | 할 일]
//   전체  : 세 가지를 한눈에 — 안 한 할 일, 아직인 목표, 최근 메모
//   메모  : 다시 보고 싶은 글, 그때그때 드는 생각. 위 칸에 한 줄로 바로 적거나 '새 메모'로 길게 쓴다.
//           ★메인 메모의 '배너 글귀'는 달력 위 배너에 늘 보인다. 쓰는 대로 자동 저장.
//   목표  : 이루고 싶은 것 + 기한(선택). 기한이 있으면 달력 위 D-day 띠에 보인다. 체크하면 '이룬 목표'로.
//   할 일 : 날짜를 아직 안 정한 일정 (0.8까지의 '기한 미정'). 체크하면 '완료'로 접히고,
//           날짜를 정하면(📅 버튼, 또는 달력으로 끌어다 놓기) 그날의 일정이 된다.
//
// 넓은 화면(1100px 이상)에서는 달력 왼쪽에 칸으로 붙어 있어서 달력을 쓰면서 계속 볼 수 있고,
// 그보다 좁은 화면에서는 왼쪽에서 밀려 나오는 창으로 뜬다. 어느 쪽인지는 style.css가 정한다.

import { api } from './api.js';
import { openMenu } from './ctxmenu.js';
import { pickDate } from './datepop.js';
import { makeSortable } from './reorder.js';
import { ask, daysBetween, ddayLabel, el, formatShort, formatTimeRange, icon, todayStr, toast } from './utils.js';

// 할 일 카드를 달력의 날짜로 끌고 있을 때, 어떤 일정인지 (놓는 처리는 main.js)
export const dragState = { itemId: null };

const OPEN_KEY = 'my-calendar:notes-open';
const TAB_KEY = 'my-calendar:notes-tab';
const TABS = ['all', 'memo', 'goal', 'todo'];
const TAB_NAME = { all: '전체', memo: '메모', goal: '목표', todo: '할 일' };
const SAVE_DELAY_MS = 600;
const ALL_LIMIT = 5;         // '전체' 탭에서 종류마다 보여 줄 개수
const pushQuery = window.matchMedia('(min-width: 1100px)'); // style.css의 같은 값과 맞춰야 한다
const canDrag = window.matchMedia('(hover: hover) and (pointer: fine)');

const CAPTURE = {
  memo: { label: '메모', max: 300, placeholder: '생각난 것을 적고 Enter' },
  goal: { label: '목표', max: 100, placeholder: '예: 12월까지 풀업 15개' },
  todo: { label: '할 일', max: 100, placeholder: '예: 교수님께 메일 보내기' },
};
// 맨 앞 기호로 종류 고르기 (빠른 입력 창과 같은 규칙)
const PREFIX = [[/^-\s+/, 'memo'], [/^\*\s+/, 'goal'], [/^\[\s*\]\s*/, 'todo']];

const ICON = {
  plus: 'M12 5v14M5 12h14',
  calendar: 'M8 3v3M16 3v3M4.5 9h15M6 5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 6 5z',
  handle: 'M5 9h14M5 15h14',
};

export class NotesPanel {
  /**
   * @param {HTMLElement} root      <aside id="notes">
   * @param {object} opts
   * @param {HTMLElement} opts.toggle     상단의 '기록지' 버튼
   * @param {HTMLElement} opts.badge      '기록지' 버튼의 숫자 (안 한 할 일 수)
   * @param {HTMLElement} opts.backdrop   좁은 화면에서 뒤를 어둡게 덮는 막
   * @param {() => void} opts.onStripChanged    배너 글귀·메인·목표 기한이 바뀌었을 때 (달력 위 띠 다시 그리기)
   * @param {() => void} opts.onLayoutChanged   칸이 열리고 닫혀서 달력 너비가 바뀔 때
   * @param {() => Promise} opts.onCalendarChanged  할 일에 날짜를 정해 달력이 바뀌었을 때 (전체 새로 고침)
   * @param {(item) => void} opts.onOpenItem    할 일을 눌렀을 때 (일정 입력 창으로 수정)
   * @param {(date: string) => void} opts.onOpenDate  알림의 '보기'
   */
  constructor(root, { toggle, badge, backdrop, onStripChanged, onLayoutChanged, onCalendarChanged, onOpenItem, onOpenDate }) {
    this.root = root;
    this.toggleBtn = toggle;
    this.badge = badge;
    this.backdrop = backdrop;
    this.onStripChanged = onStripChanged;
    this.onLayoutChanged = onLayoutChanged;
    this.onCalendarChanged = onCalendarChanged;
    this.onOpenItem = onOpenItem;
    this.onOpenDate = onOpenDate;
    this.titleEl = root.querySelector('.notes-title');
    this.backBtn = root.querySelector('.notes-back');
    this.tabsEl = root.querySelector('.notes-tabs');
    this.bodyEl = root.querySelector('.notes-body');
    this.footEl = root.querySelector('.notes-foot');

    this.data = { notes: [], goals: [], todos: [] };
    this.loaded = false;
    this.tab = readTab();
    this.view = 'list';        // 'list' | 'memo'(메모 쓰기) | 'goal'(목표 수정)
    this.editingId = null;
    this.pending = null;       // 저장 대기 중인 메모 { id, fields }
    this.timer = null;
    this.captureKind = 'memo'; // '전체' 탭의 입력칸이 넣을 종류
    this.openDone = { todo: false, goal: false };

    this.backBtn.addEventListener('click', () => this.showList());
    root.querySelector('.notes-close').addEventListener('click', () => this.close());
    toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    backdrop.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pushQuery.matches && !e.defaultPrevented) this.close(); });
    pushQuery.addEventListener('change', () => this.syncLayout());
    window.addEventListener('pagehide', () => this.flush()); // 앱을 닫기 직전에도 저장

    this.tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab) this.setTab(tab);
    });
    this.tabsEl.addEventListener('keydown', (e) => { // 탭 사이를 ← →로
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = TABS[(TABS.indexOf(this.tab) + step + TABS.length) % TABS.length];
      this.setTab(next);
      this.tabsEl.querySelector(`[data-tab="${next}"]`)?.focus();
    });

    // 넓은 화면에서는 지난번에 열어 두었으면 다시 열어 둔다
    let remembered = false;
    try { remembered = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* 무시 */ }
    if (remembered && pushQuery.matches) this.open({ focus: false });
  }

  get isOpen() { return document.body.classList.contains('notes-open'); }

  /** @param {{tab?: string, noteId?: number, goalId?: number, focus?: boolean}} o */
  async open({ tab = null, noteId = null, goalId = null, focus = true } = {}) {
    document.body.classList.add('notes-open');
    this.root.hidden = false;
    this.syncLayout();
    this.remember(true);
    if (tab) this.tab = tab;
    await this.load();
    if (noteId && this.note(noteId)) { this.tab = 'memo'; this.showMemo(noteId); }
    else if (goalId && this.goal(goalId)) { this.tab = 'goal'; this.showGoal(goalId); }
    else if (!tab && this.view === 'memo' && this.note(this.editingId)) this.showMemo(this.editingId);
    else this.showList();
    if (focus) this.titleEl.focus();
  }

  close() {
    this.flush();
    document.body.classList.remove('notes-open');
    this.root.hidden = true;
    this.syncLayout();
    this.remember(false);
    if (!pushQuery.matches) this.toggleBtn.focus();
  }

  remember(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* 무시 */ }
  }

  syncLayout() {
    const open = this.isOpen;
    this.toggleBtn.setAttribute('aria-expanded', String(open));
    this.backdrop.hidden = !open || pushQuery.matches;
    // 좁은 화면에서 창이 열려 있는 동안 뒤의 달력은 키보드로 못 가게
    document.querySelector('.layout > main')?.toggleAttribute('inert', open && !pushQuery.matches);
    this.onLayoutChanged();
  }

  note(id) { return this.data.notes.find((n) => n.id === id); }
  goal(id) { return this.data.goals.find((g) => g.id === id); }

  // 메모 + 목표 + 할 일을 한 번에 받는다 (/api/inbox). 기록지가 닫혀 있어도 버튼의 숫자를 위해 부른다.
  async load() {
    try {
      this.data = await api.inbox();
      this.loaded = true;
    } catch (e) {
      toast(e.message, 'error');
    }
    this.updateBadge();
    return this.data;
  }

  updateBadge() {
    const open = this.data.todos.filter((t) => !t.done).length;
    for (const badge of [this.badge, this.tabsEl.querySelector('[data-tab="todo"] .count')]) {
      if (!badge) continue;
      badge.textContent = open;
      badge.hidden = open === 0;
    }
    this.toggleBtn.setAttribute('aria-label', open ? `기록지 (안 한 할 일 ${open}개)` : '기록지');
  }

  // 다른 기기·다른 화면에서 바뀐 내용이 들어왔을 때: 쓰고 있는 칸은 건드리지 않는다
  async refresh() {
    await this.load();
    if (!this.isOpen) return;
    if (this.view === 'list') {
      if (!this.bodyEl.querySelector('.is-sorting')) this.showList({ keepCapture: true });
    } else if (this.view === 'memo') {
      if (!this.note(this.editingId)) this.showList();             // 다른 기기에서 지운 메모
      else if (!this.pending && !this.root.contains(document.activeElement)) this.showMemo(this.editingId);
      else this.renderMemoFoot(this.note(this.editingId));
    } else if (this.view === 'goal' && !this.goal(this.editingId)) {
      this.showList();
    }
  }

  async reload() {
    await this.load();
    if (this.isOpen && this.view === 'list') this.showList({ keepCapture: true });
  }

  setTab(tab) {
    if (!TABS.includes(tab)) return;
    this.tab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* 무시 */ }
    this.showList();
  }

  // ================================================================ 목록 (탭)
  showList({ keepCapture = false } = {}) {
    this.flush();
    // 다시 그려도 입력칸에 쓰던 글자와 포커스는 그대로
    const old = this.bodyEl.querySelector('.capture-input');
    const keep = keepCapture && old ? { value: old.value, focused: document.activeElement === old } : null;

    this.view = 'list';
    this.editingId = null;
    this.titleEl.textContent = '기록지';
    this.backBtn.hidden = true;
    this.tabsEl.hidden = false;
    this.tabsEl.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.bodyEl.setAttribute('aria-label', TAB_NAME[this.tab]);

    const content = { all: () => this.renderAll(), memo: () => this.renderMemos(), goal: () => this.renderGoals(), todo: () => this.renderTodos() }[this.tab]();
    const kind = this.tab === 'all' ? this.captureKind : this.tab;
    this.bodyEl.replaceChildren(this.capture(kind, this.tab === 'all'), ...content);
    this.setFoot(this.tab === 'memo'
      ? el('button', { type: 'button', class: 'btn wide', onclick: () => this.createMemo() }, '새 메모 (길게 쓰기)')
      : null);

    if (keep) {
      const input = this.bodyEl.querySelector('.capture-input');
      input.value = keep.value;
      if (keep.focused) input.focus({ preventScroll: true });
    }
  }

  setFoot(...nodes) {
    const real = nodes.filter(Boolean); // replaceChildren은 null을 'null' 글자로 넣어 버리므로 빼고 넘긴다
    this.footEl.replaceChildren(...real);
    this.footEl.hidden = real.length === 0;
  }

  // ---------------------------------------------------------------- 맨 위 입력칸: 적고 Enter
  capture(kind, switchable) {
    const conf = CAPTURE[kind];
    const input = el('input', {
      type: 'text', class: 'input capture-input', maxlength: String(conf.max), autocomplete: 'off', enterkeyhint: 'done',
      placeholder: conf.placeholder, 'aria-label': `${conf.label} 추가`,
    });
    const kinds = switchable
      ? el('div', { class: 'seg capture-kinds', role: 'group', 'aria-label': '넣을 곳' },
          Object.entries(CAPTURE).map(([k, c]) => el('button', {
            type: 'button', class: 'seg-btn', 'aria-pressed': String(k === kind),
            onclick: () => { this.captureKind = k; this.showList({ keepCapture: true }); this.bodyEl.querySelector('.capture-input')?.focus(); },
          }, c.label)))
      : null;
    const form = el('form', { class: 'capture', novalidate: true },
      el('div', { class: 'capture-row' },
        input,
        el('button', { type: 'submit', class: 'icon-btn capture-add', 'aria-label': `${conf.label} 추가`, title: '추가 (Enter)' }, icon(ICON.plus)),
      ),
      kinds,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let text = input.value.trim();
      let target = kind;
      if (switchable) {
        for (const [re, k] of PREFIX) if (re.test(text)) { target = k; text = text.replace(re, '').trim(); break; }
      }
      if (!text) return;
      const typed = input.value;
      input.value = ''; // 저장하는 동안 목록을 다시 그려도 쓴 글자가 되살아나지 않게 먼저 비운다
      try {
        await this.add(target, text);
      } catch (err) {
        toast(err.message, 'error');
        const now = this.bodyEl.querySelector('.capture-input');
        if (now && !now.value) now.value = typed; // 실패하면 쓴 글자를 돌려준다
      } finally {
        this.bodyEl.querySelector('.capture-input')?.focus({ preventScroll: true });
      }
    });
    return form;
  }

  async add(kind, text) {
    if (kind === 'memo') {
      await api.createNote({ body: text });
      await this.reload();
      toast(this.tab === 'memo' ? '메모했어요' : '메모에 넣었어요');
    } else if (kind === 'goal') {
      // '12월까지', '이번 달 안에' 같은 기한은 빠른 입력과 같은 규칙으로 읽는다
      let title = text;
      let due = null;
      try {
        const r = await api.parse(`* ${text}`, todayStr());
        if (r.title) title = r.title;
        due = r.due;
      } catch { /* 못 읽으면 쓴 그대로 */ }
      await api.createGoal({ title, due });
      await this.reload();
      this.onStripChanged();
      toast(due ? `목표를 넣었어요 · 기한 ${formatShort(due)}` : '목표를 넣었어요');
    } else {
      await api.createItem({ title: text, dates: [] });
      await this.reload();
      toast('할 일에 넣었어요');
    }
  }

  // ---------------------------------------------------------------- 전체
  renderAll() {
    const todos = this.data.todos.filter((t) => !t.done);
    const goals = this.data.goals.filter((g) => !g.done);
    const notes = this.data.notes;
    const section = (tab, count, list, empty) =>
      el('section', { class: 'all-sec' },
        el('header', { class: 'all-head' },
          el('h3', {}, TAB_NAME[tab], count ? el('span', { class: 'all-count' }, String(count)) : null),
          el('button', { type: 'button', class: 'link-btn', onclick: () => this.setTab(tab) }, count > ALL_LIMIT ? `${count}개 모두 보기` : '열기'),
        ),
        list ?? el('p', { class: 'all-empty' }, empty),
      );
    return [
      section('todo', todos.length,
        todos.length ? el('ul', { class: 'todo-list' }, todos.slice(0, ALL_LIMIT).map((t) => this.todoRow(t))) : null,
        '할 일이 없어요.'),
      section('goal', goals.length,
        goals.length ? el('ul', { class: 'goal-list' }, goals.slice(0, ALL_LIMIT).map((g) => this.goalRow(g, false))) : null,
        '이루고 싶은 것을 적어 두세요.'),
      section('memo', notes.length,
        notes.length ? el('ul', { class: 'note-list compact' }, notes.slice(0, ALL_LIMIT - 1).map((n) => this.memoCard(n, false))) : null,
        '그때그때 드는 생각을 적어 두세요.'),
    ];
  }

  // ================================================================ 할 일
  renderTodos() {
    const open = this.data.todos.filter((t) => !t.done);
    const done = this.data.todos.filter((t) => t.done);
    const parts = [];
    if (!open.length) {
      parts.push(el('div', { class: 'notes-empty' },
        el('p', {}, done.length ? '할 일을 다 했어요! 👏' : '날짜를 아직 못 정한 일을 모아 두세요.'),
        el('p', { class: 'muted' }, '📅를 눌러 날짜를 정하면 그날의 일정이 돼요.'),
      ));
    } else {
      parts.push(el('ul', { class: 'todo-list' }, open.map((t) => this.todoRow(t))));
      parts.push(el('p', { class: 'list-hint' }, canDrag.matches
        ? '📅로 날짜를 정하거나, 달력의 날짜로 끌어다 놓으면 일정이 돼요.'
        : '📅로 날짜를 정하면 그날의 일정이 돼요.'));
    }
    if (done.length) parts.push(this.doneGroup('todo', `완료 ${done.length}개`, done.map((t) => this.todoRow(t)),
      el('button', { type: 'button', class: 'link-btn danger', onclick: () => this.clearDone(done.length) }, '완료한 할 일 비우기')));
    return parts;
  }

  doneGroup(kind, summary, rows, extra = null) {
    const details = el('details', { class: 'done-group', open: this.openDone[kind] },
      el('summary', {}, summary),
      el('ul', { class: kind === 'todo' ? 'todo-list' : 'goal-list' }, rows),
      extra,
    );
    details.addEventListener('toggle', () => { this.openDone[kind] = details.open; });
    return details;
  }

  todoRow(item) {
    const time = formatTimeRange(item.start_time, item.end_time);
    const meta = [
      item.category.is_default ? null : el('span', { class: 'todo-cat' }, el('span', { class: 'dot' }), item.category.name),
      time ? el('span', { class: 'todo-time' }, time) : null,
      item.memo ? el('span', { class: 'todo-memo' }, item.memo.split('\n')[0]) : null,
    ].filter(Boolean);
    const li = el('li', {
      class: item.done ? 'todo-li is-done' : 'todo-li',
      style: { '--cat': item.category.color },
      dataset: { id: String(item.id) },
    },
      checkbox(item.done, `'${item.title}' ${item.done ? '완료 취소' : '완료'}`, () => this.toggleTodo(item)),
      el('button', { type: 'button', class: 'todo-main', onclick: () => this.onOpenItem(item) },
        el('span', { class: 'todo-title' }, item.title),
        meta.length ? el('span', { class: 'todo-meta' }, meta) : null,
      ),
      item.done ? null : el('button', {
        type: 'button', class: 'icon-btn sm todo-date', 'aria-label': `'${item.title}' 날짜 정하기`, title: '날짜 정하기',
        onclick: () => this.pickTodoDate(item),
      }, icon(ICON.calendar)),
    );
    li.addEventListener('contextmenu', (e) => openMenu(e, [
      { label: '수정', run: () => this.onOpenItem(item) },
      item.done ? null : { label: '날짜 정하기…', run: () => this.pickTodoDate(item) },
      { label: item.done ? '완료 취소' : '완료', run: () => this.toggleTodo(item) },
      { label: '삭제', danger: true, run: () => this.deleteTodo(item) },
    ], { title: item.title }));

    // 넓은 화면: 달력의 날짜로 끌어다 놓으면 그 날짜에 들어간다 (main.js의 drop)
    if (!item.done && canDrag.matches) {
      li.draggable = true;
      li.title = '달력의 날짜로 끌어다 놓으면 그날의 일정이 돼요';
      li.addEventListener('dragstart', (e) => {
        dragState.itemId = item.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.title); // 파이어폭스는 데이터가 있어야 드래그가 시작된다
        li.classList.add('is-dragging');
        document.body.classList.add('is-dragging-item');
      });
      li.addEventListener('dragend', () => {
        dragState.itemId = null;
        li.classList.remove('is-dragging');
        document.body.classList.remove('is-dragging-item');
      });
    }
    return li;
  }

  async toggleTodo(item) {
    try {
      await api.setDone(item.id, !item.done);
      if (!item.done) toast(`'${item.title}' 완료!`, 'info', { action: { label: '되돌리기', run: () => this.undoDone(item) } });
      await this.reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  async undoDone(item) {
    try { await api.setDone(item.id, item.done); await this.reload(); } catch (e) { toast(e.message, 'error'); }
  }

  async pickTodoDate(item) {
    const date = await pickDate({ title: '언제 할까요?', hint: `'${item.title}' — 고른 날짜의 일정이 돼요.` });
    if (date) await this.assignDate(item.id, date);
  }

  // 할 일에 날짜를 정한다 → 그날의 일정이 된다 (달력으로 끌어다 놓았을 때도 main.js가 이걸 부른다)
  async assignDate(itemId, date) {
    try {
      const item = await api.getItem(itemId);
      const fields = {
        title: item.title, memo: item.memo, category_id: item.category.id,
        start_time: item.start_time, end_time: item.end_time, dday: item.dday, scope: 'all',
      };
      await api.updateItem(itemId, { ...fields, dates: [...new Set([...item.dates, date])] });
      await this.onCalendarChanged();
      toast(`${formatShort(date)} 일정이 됐어요`, 'info', {
        action: {
          label: '되돌리기',
          run: async () => {
            try { await api.updateItem(itemId, { ...fields, dates: item.dates }); await this.onCalendarChanged(); toast('되돌렸어요'); }
            catch (e) { toast(e.message, 'error'); }
          },
        },
      });
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  async deleteTodo(item) {
    const ok = await ask(`'${item.title}'을(를) 삭제할까요?`, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try { await api.deleteItem(item.id); toast('삭제했어요'); await this.reload(); } catch (e) { toast(e.message, 'error'); }
  }

  async clearDone(count) {
    const ok = await ask(`완료한 할 일 ${count}개를 모두 지울까요?`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try { await api.clearDone(); toast('완료한 할 일을 비웠어요'); await this.reload(); } catch (e) { toast(e.message, 'error'); }
  }

  // ================================================================ 목표
  renderGoals() {
    const active = this.data.goals.filter((g) => !g.done);
    const done = this.data.goals.filter((g) => g.done);
    const parts = [];
    if (!active.length) {
      parts.push(el('div', { class: 'notes-empty' },
        el('p', {}, done.length ? '목표를 모두 이뤘어요! 🎉' : '이루고 싶은 것을 적어 두세요.'),
        el('p', { class: 'muted' }, "'12월까지'처럼 기한을 쓰면 달력 위에 D-day로 보여요."),
      ));
    } else {
      const list = el('ul', { class: 'goal-list' }, active.map((g) => this.goalRow(g, active.length > 1)));
      if (active.length > 1) {
        makeSortable(list, {
          scroller: this.bodyEl,
          onChange: async (ids) => {
            try { await api.reorderGoals(ids); await this.load(); } catch (e) { toast(e.message, 'error'); await this.reload(); }
          },
        });
      }
      parts.push(list);
    }
    if (done.length) parts.push(this.doneGroup('goal', `이룬 목표 ${done.length}개`, done.map((g) => this.goalRow(g, false))));
    return parts;
  }

  goalRow(g, sortable) {
    const today = todayStr();
    let due = null;
    if (g.due) {
      const left = daysBetween(today, g.due);
      due = el('span', { class: !g.done && left < 0 ? 'goal-due is-over' : 'goal-due' },
        `~${formatShort(g.due)}`, g.done ? null : ` · ${left < 0 ? '기한 지남' : ddayLabel(left)}`);
    }
    const li = el('li', { class: g.done ? 'goal-li is-done' : 'goal-li', dataset: { id: String(g.id) } },
      checkbox(g.done, `'${g.title}' ${g.done ? '이룸 취소' : '이뤘어요'}`, () => this.toggleGoal(g)),
      el('button', { type: 'button', class: 'goal-main', onclick: () => this.showGoal(g.id) },
        el('span', { class: 'goal-title' }, g.title),
        due || g.memo ? el('span', { class: 'goal-meta' }, due, g.memo ? el('span', { class: 'goal-memo' }, g.memo.split('\n')[0]) : null) : null,
      ),
      sortable
        ? el('button', { type: 'button', class: 'drag-handle', 'aria-label': `순서 바꾸기: ${g.title} (위아래 화살표로 이동)`, title: '끌어서 순서 바꾸기' }, icon(ICON.handle))
        : null,
    );
    li.addEventListener('contextmenu', (e) => openMenu(e, [
      { label: '수정', run: () => this.showGoal(g.id) },
      { label: g.done ? '이룸 취소' : '이뤘어요', run: () => this.toggleGoal(g) },
      { label: '삭제', danger: true, run: () => this.deleteGoal(g) },
    ], { title: g.title }));
    return li;
  }

  async toggleGoal(g) {
    try {
      await api.updateGoal(g.id, { done: !g.done });
      if (!g.done) toast(`🎉 '${g.title}' 이뤘어요!`, 'info', { action: { label: '되돌리기', run: () => this.undoGoal(g) } });
      await this.reload();
      this.onStripChanged();
    } catch (e) { toast(e.message, 'error'); }
  }

  async undoGoal(g) {
    try { await api.updateGoal(g.id, { done: g.done }); await this.reload(); this.onStripChanged(); } catch (e) { toast(e.message, 'error'); }
  }

  async deleteGoal(g) {
    const ok = await ask(`'${g.title}' 목표를 삭제할까요?`, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return false;
    try {
      await api.deleteGoal(g.id);
      toast('목표를 삭제했어요');
      await this.load();
      this.onStripChanged();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  // ---------------------------------------------------------------- 목표 수정 (저장 버튼으로)
  showGoal(id) {
    const g = this.goal(id);
    if (!g) return this.showList();
    this.flush();
    this.view = 'goal';
    this.editingId = id;
    this.titleEl.textContent = '목표';
    this.backBtn.hidden = false;
    this.tabsEl.hidden = true;

    const title = el('input', { type: 'text', class: 'input note-title-input', maxlength: '100', value: g.title, 'aria-label': '목표', placeholder: '이루고 싶은 것' });
    const due = el('input', { type: 'date', class: 'input goal-due-input', value: g.due || '', 'aria-label': '기한' });
    const dueHint = el('p', { class: 'field-hint' });
    const showHint = () => {
      dueHint.textContent = due.value
        ? `${ddayLabel(daysBetween(todayStr(), due.value))} — 기한이 지나기 전까지 달력 위 띠에 보여요.`
        : '기한을 정하면 달력 위 띠에 D-day로 보여요.';
    };
    due.addEventListener('input', showHint);
    showHint();
    const memo = el('textarea', { class: 'input', rows: '4', maxlength: '2000', value: g.memo, placeholder: '왜 이루고 싶은지, 어떻게 할지 (선택)', 'aria-label': '메모' });
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });

    const form = el('form', { id: 'goal-form', class: 'note-edit', novalidate: true },
      title,
      el('div', { class: 'field' },
        el('label', { class: 'label' }, '기한'),
        el('div', { class: 'goal-due-row' }, due,
          el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { due.value = ''; showHint(); } }, '기한 없음')),
        dueHint),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '메모'), memo),
      errorEl,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.updateGoal(id, { title: title.value, due: due.value || null, memo: memo.value });
        toast('목표를 저장했어요');
        await this.load();
        this.onStripChanged();
        this.showList();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    });
    this.bodyEl.replaceChildren(form);
    this.setFoot(
      el('button', { type: 'button', class: 'btn sm ghost danger', onclick: async () => { if (await this.deleteGoal(g)) this.showList(); } }, '삭제'),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn sm ghost', onclick: () => this.showList() }, '취소'),
      el('button', { type: 'submit', form: 'goal-form', class: 'btn sm primary' }, '저장'),
    );
  }

  // ================================================================ 메모
  renderMemos() {
    if (!this.data.notes.length) {
      return [el('div', { class: 'notes-empty' },
        el('p', {}, '다시 보고 싶은 글, 잊지 말아야 할 것을 적어두세요.'),
        el('p', { class: 'muted' }, '첫 메모는 메인 메모가 되고, 메인 메모의 배너 글귀는 달력 위에 늘 보여요.'),
      )];
    }
    const sortable = this.data.notes.length > 1;
    const list = el('ul', { class: 'note-list' }, this.data.notes.map((n) => this.memoCard(n, sortable)));
    if (sortable) {
      makeSortable(list, {
        scroller: this.bodyEl,
        onChange: async (ids) => {
          try {
            await api.reorderNotes(ids);
            this.data.notes = ids.map((id) => this.note(id));
          } catch (e) { toast(e.message, 'error'); await this.reload(); }
        },
      });
    }
    return [list];
  }

  memoCard(n, sortable) {
    // 제목이 없는 한 줄 메모는 첫 줄을 제목처럼 보여 준다
    const lines = (n.body || '').trim().split('\n').filter(Boolean);
    const headline = n.title || lines.shift() || '빈 메모';
    const preview = lines.slice(0, 2).join(' · ');
    return el('li', { class: 'note-li', dataset: { id: String(n.id) } },
      el('button', { type: 'button', class: 'note-card', onclick: () => { this.tab = this.tab === 'all' ? 'memo' : this.tab; this.showMemo(n.id); } },
        el('span', { class: n.title ? 'note-card-title' : 'note-card-title is-line' },
          n.is_main ? el('span', { class: 'note-main', title: '메인 메모' }, '★') : null,
          headline),
        n.is_main && n.banner ? el('span', { class: 'note-card-banner' }, n.banner) : null,
        preview ? el('span', { class: 'note-card-preview' }, preview) : null,
      ),
      sortable
        ? el('button', { type: 'button', class: 'drag-handle', 'aria-label': `순서 바꾸기: ${headline} (위아래 화살표로 이동)`, title: '끌어서 순서 바꾸기' }, icon(ICON.handle))
        : null,
    );
  }

  async createMemo() {
    try {
      const note = await api.createNote({ title: '' });
      this.data.notes.push(note);
      this.showMemo(note.id);
      this.bodyEl.querySelector('.note-title-input')?.focus();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------------------------------------------------------------- 메모 쓰기 (자동 저장)
  showMemo(id) {
    if (this.editingId !== id) this.flush();
    const n = this.note(id);
    if (!n) return this.showList();
    this.view = 'memo';
    this.editingId = id;
    this.titleEl.textContent = n.is_main ? '★ 메인 메모' : '메모';
    this.backBtn.hidden = false;
    this.tabsEl.hidden = true;

    const title = el('input', {
      type: 'text', class: 'input note-title-input', maxlength: '60', placeholder: '제목 (예: 다시 읽을 글)',
      'aria-label': '메모 제목', value: n.title,
    });
    const banner = n.is_main
      ? el('textarea', {
          class: 'input note-banner-input', rows: '2', maxlength: '200', placeholder: '예: 오늘 걷는 한 걸음이 내일을 바꾼다',
          'aria-label': '배너 글귀', value: n.banner,
        })
      : null;
    const body = el('textarea', {
      class: 'input note-body-input', placeholder: '자유롭게 적어 두세요.', 'aria-label': '메모 내용', value: n.body,
    });

    const onInput = () => this.schedule(id, {
      title: title.value,
      body: body.value,
      ...(banner ? { banner: banner.value } : {}),
    });
    [title, body, banner].forEach((input) => input?.addEventListener('input', onInput));
    [title, body, banner].forEach((input) => input?.addEventListener('blur', () => this.flush()));

    this.bodyEl.replaceChildren(
      el('div', { class: 'note-edit' },
        title,
        banner
          ? el('div', { class: 'note-banner-field' },
              el('label', { class: 'label' }, '배너 글귀'),
              banner,
              el('p', { class: 'field-hint' }, '여기 쓴 문장이 달력 위 배너에 늘 보여요. 비워 두면 배너가 숨겨져요.'))
          : null,
        body,
      ),
    );
    this.renderMemoFoot(n);
  }

  renderMemoFoot(n) {
    this.setFoot(
      el('span', { class: 'note-status', 'aria-live': 'polite' }, this.pending ? '저장 중…' : ''),
      el('span', { class: 'spacer' }),
      n.is_main
        ? null // 이미 메인이면 버튼 없음
        : el('button', { type: 'button', class: 'btn sm ghost', title: '이 메모의 배너 글귀가 달력 위에 보이게 돼요', onclick: () => this.makeMain(n.id) }, '★ 메인으로'),
      n.is_main
        ? null
        : el('button', { type: 'button', class: 'btn sm ghost', title: '할 일 목록으로 옮겨요 (날짜를 정하면 일정이 돼요)', onclick: () => this.memoToTodo(n.id) }, '할 일로'),
      el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => this.removeMemo(this.note(n.id) || n) }, '삭제'),
    );
  }

  setStatus(text) {
    const status = this.footEl.querySelector('.note-status');
    if (status) status.textContent = text;
  }

  // 자동 저장: 마지막 입력 후 잠깐 기다렸다가 저장한다
  schedule(id, fields) {
    this.pending = { id, fields };
    this.setStatus('저장 중…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  async flush() {
    clearTimeout(this.timer);
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    try {
      const saved = await api.updateNote(job.id, job.fields);
      const i = this.data.notes.findIndex((n) => n.id === job.id);
      if (i >= 0) this.data.notes[i] = saved;
      if (!this.pending) this.setStatus('저장됨');
      if ('banner' in job.fields) this.onStripChanged();
    } catch (e) {
      toast(e.message, 'error');
      this.setStatus('저장 못 함');
    }
  }

  async makeMain(id) {
    await this.flush();
    try {
      await api.setMainNote(id);
      await this.load();
      this.showMemo(id);
      this.onStripChanged();
      toast('메인 메모로 정했어요. 배너 글귀를 적어 보세요.');
      this.bodyEl.querySelector('.note-banner-input')?.focus();
    } catch (e) { toast(e.message, 'error'); }
  }

  // 생각 → 할 일: 메모를 할 일(날짜 없는 일정)로 옮긴다. 제목이 없으면 첫 줄이 제목, 나머지는 메모로.
  async memoToTodo(id) {
    await this.flush();
    const n = this.note(id);
    if (!n) return;
    const lines = (n.body || '').trim().split('\n');
    const title = (n.title || lines.shift() || '').trim().slice(0, 100);
    const memo = (n.title ? n.body : lines.join('\n')).trim().slice(0, 2000);
    if (!title) { toast('빈 메모는 옮길 수 없어요.', 'error'); return; }
    try {
      const item = await api.createItem({ title, memo, dates: [] });
      await api.deleteNote(id);
      this.tab = 'todo';
      await this.load();
      this.showList();
      toast('할 일로 옮겼어요', 'info', {
        action: {
          label: '되돌리기',
          run: async () => {
            try {
              await api.deleteItem(item.id);
              await api.createNote({ title: n.title, body: n.body });
              this.tab = 'memo';
              await this.reload();
              toast('되돌렸어요');
            } catch (e) { toast(e.message, 'error'); }
          },
        },
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  async removeMemo(n) {
    const name = n.title || (n.body || '').trim().split('\n')[0] || '빈 메모';
    const ok = await ask(`'${name.slice(0, 30)}' 메모를 삭제할까요?${n.is_main ? ' 메인 메모를 지우면 맨 위 메모가 메인이 돼요.' : ''}`, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    this.pending = null;
    clearTimeout(this.timer);
    try {
      await api.deleteNote(n.id);
      await this.load();
      this.showList();
      this.onStripChanged();
      toast('메모를 삭제했어요');
    } catch (e) { toast(e.message, 'error'); }
  }
}

// 동그란 체크 버튼 (할 일 완료, 목표 이룸)
function checkbox(checked, label, onToggle) {
  return el('button', {
    type: 'button', class: 'check', role: 'checkbox', 'aria-checked': String(checked), 'aria-label': label,
    onclick: (e) => { e.currentTarget.setAttribute('aria-checked', String(!checked)); onToggle(); },
  }, icon('M6 12.5l4 4 8-9'));
}

function readTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.includes(t) ? t : 'all';
  } catch {
    return 'all';
  }
}
