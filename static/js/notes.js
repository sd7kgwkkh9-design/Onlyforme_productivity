// 메모장 — 화면 왼쪽에 열리는 '적어 두는 곳' (7차, 0.9.0에서 메모·목표·할 일로 넓힘)
// 0.13.0: '기록지' → '메모장', 그 안의 '메모' → '노트'로 이름을 바꾸고, 급한 할 일(⚡)과 프로젝트 탭을 더했다.
//         (코드 안의 이름은 예전 그대로 notes·memo를 쓴다 — 서버 주소·표 이름과 맞추려고)
//
//   [전체 | 노트 | 나 | 목표 | 할 일 | 살 것 | 프로젝트]
//   전체  : 한눈에 — 안 한 할 일(급한 것 먼저), 아직인 목표, 진행 중인 프로젝트, 최근 노트
//   노트  : 다시 보고 싶은 글, 그때그때 드는 생각. 위 칸에 한 줄로 바로 적거나 '새 노트'로 길게 쓴다.
//           ★메인 노트의 '배너 글귀'는 달력 위 배너에 늘 보인다. 쓰는 대로 자동 저장.
//           마크다운(0.10.0): [보기 | 쓰기]. 보기에서는 **굵게**, 체크리스트, 링크가 꾸며져 보이고 체크리스트를 바로 누를 수 있다.
//   나    : 자기소개 (0.14.2) — 기본 정보, 좋아하는 것·싫어하는 것·요즘 빠진 것(칩), 자유롭게(글). aboutme.js
//   목표  : 세 단계(0.11.0) — 인생 목표 → 올해 목표(체크·숫자·루틴 연결로 진행도) → 기한 목표(기한이 있으면 달력 위 D-day 띠에).
//           체크하면 '이룬 목표'로.
//   할 일 : 날짜를 아직 안 정한 일정 (0.8까지의 '기한 미정'). 다 하면 ×로 지운다(0.14.2, 그전에는 체크하면 '완료'로 접혔다),
//           날짜를 정하면(📅 버튼, 또는 달력으로 끌어다 놓기) 그날의 일정이 된다.
//           ⚡ 급한 할 일(0.13.0): 맨 앞에 !를 붙여 적거나 ⚡를 누르면 맨 위로 올라오고, 첫 화면 '오늘 챙길 것'에도 보인다.
//   살 것 (0.14.2): 구매 예정 목록 — 가격·언제쯤·링크, ⭐ 꼭 살 것, 합계. wishlist.js
//   프로젝트 (0.13.0): 몇 월까지 진행하는 일 — 기간(정확히 또는 '1월 중'처럼 대략), 상태, 세부 할 일과 진행률,
//           연결한 일정. [목록 | 타임라인]으로 본다 (projects.js).
//
// 넓은 화면(1100px 이상)에서는 달력 왼쪽에 칸으로 붙어 있어서 달력을 쓰면서 계속 볼 수 있고,
// 그보다 좁은 화면에서는 왼쪽에서 밀려 나오는 창으로 뜬다. 어느 쪽인지는 style.css가 정한다.

import { api } from './api.js';
import { openMenu } from './ctxmenu.js';
import { pickDate } from './datepop.js';
import { renderMarkdown, stripMarkdown } from './markdown.js';
import { makeSortable } from './reorder.js';
import { ask, daysBetween, ddayLabel, el, formatShort, formatTimeRange, icon, todayStr, toast } from './utils.js';
import { addProject, projectRowsForAll, renderProjects, showProject } from './projects.js';
import { flushAbout, refreshAbout, renderAbout } from './aboutme.js';
import { refreshWishlist, renderWishlist } from './wishlist.js';

// 할 일 카드를 달력의 날짜로 끌고 있을 때, 어떤 일정인지 (놓는 처리는 main.js)
export const dragState = { itemId: null };

const OPEN_KEY = 'my-calendar:notes-open';
const TAB_KEY = 'my-calendar:notes-tab';
const TABS = ['all', 'memo', 'me', 'goal', 'todo', 'buy', 'project'];
const TAB_NAME = { all: '전체', memo: '노트', me: '나', goal: '목표', todo: '할 일', buy: '살 것', project: '프로젝트' };
const SAVE_DELAY_MS = 600;
const ALL_LIMIT = 5;         // '전체' 탭에서 종류마다 보여 줄 개수
const pushQuery = window.matchMedia('(min-width: 1100px)'); // style.css의 같은 값과 맞춰야 한다
const canDrag = window.matchMedia('(hover: hover) and (pointer: fine)');

const CAPTURE = {
  memo: { label: '노트', max: 300, placeholder: '생각난 것을 적고 Enter' },
  goal: { label: '목표', max: 100, placeholder: '예: 12월까지 풀업 15개' },
  todo: { label: '할 일', max: 100, placeholder: '예: 교수님께 메일 보내기 (급하면 맨 앞에 !)' },
  project: { label: '프로젝트', max: 100, placeholder: '예: 텀프로젝트 ~12/6, 자취방 구하기 1~2월' },
};
// 목표 탭의 입력칸: 어느 단계에 넣을지 (0.11.0)
const GOAL_CAPTURE = {
  year: { label: '올해', placeholder: '예: 운동 100번, 책 12권' },
  due: { label: '기한', placeholder: '예: 12월까지 풀업 15개' },
  life: { label: '인생', placeholder: '예: 건강한 몸 만들기' },
};
// 맨 앞 기호로 종류 고르기 (빠른 입력 창과 같은 규칙). ! = 급한 할 일, # = 프로젝트 (0.13.0)
const PREFIX = [[/^-\s+/, 'memo'], [/^\*\s+/, 'goal'], [/^\[\s*\]\s*/, 'todo'], [/^!\s*/, 'urgent'], [/^#\s+/, 'project']];
const URGENT_RE = /^!\s*/;

const ICON = {
  plus: 'M12 5v14M5 12h14',
  calendar: 'M8 3v3M16 3v3M4.5 9h15M6 5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 6 5z',
  handle: 'M5 9h14M5 15h14',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  x: 'M7 7l10 10M17 7L7 17',
};

export class NotesPanel {
  /**
   * @param {HTMLElement} root      <aside id="notes">
   * @param {object} opts
   * @param {HTMLElement} opts.toggle     상단의 '메모장' 버튼
   * @param {HTMLElement} opts.badge      '메모장' 버튼의 숫자 (안 한 할 일 수)
   * @param {HTMLElement} opts.backdrop   좁은 화면에서 뒤를 어둡게 덮는 막
   * @param {() => void} opts.onStripChanged    배너 글귀·메인·목표 기한이 바뀌었을 때 (달력 위 띠 다시 그리기)
   * @param {() => void} opts.onLayoutChanged   칸이 열리고 닫혀서 달력 너비가 바뀔 때
   * @param {() => Promise} opts.onCalendarChanged  할 일에 날짜를 정해 달력이 바뀌었을 때 (전체 새로 고침)
   * @param {(item) => void} opts.onOpenItem    할 일을 눌렀을 때 (일정 입력 창으로 수정)
   * @param {(date: string) => void} opts.onOpenDate  알림의 '보기'
   * @param {(prefill) => void} opts.onAddEvent  프로젝트에서 '일정 추가' (일정 입력 창, 0.13.0)
   */
  constructor(root, { toggle, badge, backdrop, onStripChanged, onLayoutChanged, onCalendarChanged, onOpenItem, onOpenDate, onAddEvent = () => {} }) {
    this.root = root;
    this.toggleBtn = toggle;
    this.badge = badge;
    this.backdrop = backdrop;
    this.onStripChanged = onStripChanged;
    this.onLayoutChanged = onLayoutChanged;
    this.onCalendarChanged = onCalendarChanged;
    this.onOpenItem = onOpenItem;
    this.onOpenDate = onOpenDate;
    this.onAddEvent = onAddEvent;
    this.titleEl = root.querySelector('.notes-title');
    this.backBtn = root.querySelector('.notes-back');
    this.tabsEl = root.querySelector('.notes-tabs');
    this.bodyEl = root.querySelector('.notes-body');
    this.footEl = root.querySelector('.notes-foot');

    this.data = { notes: [], goals: [], todos: [], projects: [] };
    this.loaded = false;
    this.tab = readTab();
    this.view = 'list';        // 'list' | 'memo'(노트 쓰기) | 'goal'(목표 수정) | 'project'(프로젝트 하나, 0.13.0)
    this.editingId = null;
    this.pending = null;       // 저장 대기 중인 메모 { id, fields }
    this.timer = null;
    this.captureKind = 'memo'; // '전체' 탭의 입력칸이 넣을 종류
    this.goalKind = 'year';    // '목표' 탭의 입력칸이 넣을 단계: 'year' | 'due' | 'life'
    this.memoMode = 'view';    // 메모 화면: 'view'(꾸며진 보기) | 'edit'(글 고치기)
    this.openDone = { todo: false, goal: false, project: false };
    this.projectMode = 'list'; // 프로젝트 탭: 'list' | 'timeline' (0.13.0)

    this.backBtn.addEventListener('click', () => this.showList());
    root.querySelector('.notes-close').addEventListener('click', () => this.close());
    toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    backdrop.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pushQuery.matches && !e.defaultPrevented) this.close(); });
    pushQuery.addEventListener('change', () => this.syncLayout());
    window.addEventListener('pagehide', () => { flushAbout({ keepalive: true }); this.flush(); }); // 앱을 닫기 직전에도 저장
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAbout({ keepalive: true }); });

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

  /** @param {{tab?: string, noteId?: number, goalId?: number, projectId?: number, focus?: boolean}} o */
  async open({ tab = null, noteId = null, goalId = null, projectId = null, focus = true } = {}) {
    document.body.classList.add('notes-open');
    this.root.hidden = false;
    this.syncLayout();
    this.remember(true);
    if (tab) this.tab = tab;
    await this.load();
    if (noteId && this.note(noteId)) { this.tab = 'memo'; this.showMemo(noteId); }
    else if (goalId && this.goal(goalId)) { this.tab = 'goal'; this.showGoal(goalId); }
    else if (projectId) { this.tab = 'project'; await showProject(this, projectId); }
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
  project(id) { return (this.data.projects || []).find((p) => p.id === id); }
  goal(id) { return this.data.goals.find((g) => g.id === id); }

  // 메모 + 목표 + 할 일을 한 번에 받는다 (/api/inbox). 메모장이 닫혀 있어도 버튼의 숫자를 위해 부른다.
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
    this.toggleBtn.setAttribute('aria-label', open ? `메모장 (안 한 할 일 ${open}개)` : '메모장');
    const urgent = this.data.todos.some((t) => t.urgent && !t.done);
    this.toggleBtn.classList.toggle('has-urgent', urgent); // 급한 할 일이 있으면 숫자를 주황색으로
  }

  // 다른 기기·다른 화면에서 바뀐 내용이 들어왔을 때: 쓰고 있는 칸은 건드리지 않는다
  async refresh() {
    await this.load();
    if (!this.isOpen) return;
    if (this.view === 'list' && this.tab === 'me') {
      await refreshAbout();
    } else if (this.view === 'list' && this.tab === 'buy') {
      await refreshWishlist();
    } else if (this.view === 'list') {
      if (!this.bodyEl.querySelector('.is-sorting')) this.showList({ keepCapture: true });
    } else if (this.view === 'memo') {
      if (!this.note(this.editingId)) this.showList();             // 다른 기기에서 지운 메모
      else if (!this.pending && !this.root.contains(document.activeElement)) this.showMemo(this.editingId);
      else this.renderMemoFoot(this.note(this.editingId));
    } else if (this.view === 'goal' && this.editingId && !this.goal(this.editingId)) {
      this.showList();
    } else if (this.view === 'project') {
      if (!this.project(this.editingId)) this.showList();
      else if (!this.root.contains(document.activeElement)) await showProject(this, this.editingId, { keepScroll: true });
    }
  }

  async reload() {
    await this.load();
    this.redrawList();
  }

  redrawList() {
    if (this.isOpen && this.view === 'list') this.showList({ keepCapture: true });
  }

  // 누르는 즉시 화면부터 바꾸고(낙관적 갱신), 저장은 뒤에서 한다 (0.12.1).
  // 서버가 멀어서 응답이 0.3~0.5초 걸려도 체크·+1이 바로 보인다. 저장이 실패하면 원래대로 되돌리고 알려 준다.
  //   change(): this.data를 바로 고친다 / undo(): 되돌린다 / save(): 서버에 저장 (Promise)
  async optimistic({ change, undo, save }) {
    change();
    this.updateBadge();
    this.redrawList();
    this.saving = (this.saving || 0) + 1;
    try {
      const result = await save();
      this.saving -= 1;
      // 서버가 정한 순서·시각으로 맞춘다 (기다리지 않음). 그사이 또 누른 것이 저장 중이면 그 결과를 덮지 않게 건너뛴다.
      if (!this.saving) {
        api.inbox().then((data) => {
          if (this.saving) return;
          this.data = data;
          this.updateBadge();
          this.redrawList();
        }).catch(() => {});
      }
      return result;
    } catch (e) {
      this.saving -= 1;
      undo();
      this.updateBadge();
      this.redrawList();
      toast(e.message, 'error');
      return undefined;
    }
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
    this.titleEl.textContent = '메모장';
    this.backBtn.hidden = true;
    this.tabsEl.hidden = false;
    this.tabsEl.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.bodyEl.setAttribute('aria-label', TAB_NAME[this.tab]);

    // '나'는 쓰는 칸이 많아서, 다른 탭 때문에 다시 그릴 때(keepCapture)는 건드리지 않는다 (쓰던 글자·포커스 그대로)
    // '살 것'(0.14.2)도 자기 입력칸·목록을 스스로 그린다
    if (this.tab === 'me' || this.tab === 'buy') {
      const [cls, render] = this.tab === 'me' ? ['.about-wrap', renderAbout] : ['.wish-wrap', renderWishlist];
      if (!(keepCapture && this.bodyEl.querySelector(cls))) this.bodyEl.replaceChildren(...render());
      this.setFoot(null);
      return;
    }
    const content = {
      all: () => this.renderAll(), memo: () => this.renderMemos(), goal: () => this.renderGoals(),
      todo: () => this.renderTodos(), project: () => renderProjects(this),
    }[this.tab]();
    const kind = this.tab === 'all' ? this.captureKind : this.tab;
    this.bodyEl.replaceChildren(this.capture(kind, this.tab === 'all'), ...content);
    this.setFoot(this.tab === 'memo'
      ? el('button', { type: 'button', class: 'btn wide', onclick: () => this.createMemo() }, '새 노트 (길게 쓰기)')
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
    let kinds = null;
    if (switchable) {
      kinds = el('div', { class: 'seg capture-kinds', role: 'group', 'aria-label': '넣을 곳' },
        Object.entries(CAPTURE).map(([k, c]) => el('button', {
          type: 'button', class: 'seg-btn', 'aria-pressed': String(k === kind),
          onclick: () => { this.captureKind = k; this.showList({ keepCapture: true }); this.bodyEl.querySelector('.capture-input')?.focus(); },
        }, c.label)));
    } else if (kind === 'goal') {
      // 목표 탭: 어느 단계에 넣을지 (0.11.0)
      input.placeholder = GOAL_CAPTURE[this.goalKind].placeholder;
      kinds = el('div', { class: 'seg capture-kinds', role: 'group', 'aria-label': '목표의 단계' },
        Object.entries(GOAL_CAPTURE).map(([k, c]) => el('button', {
          type: 'button', class: 'seg-btn', 'aria-pressed': String(k === this.goalKind),
          onclick: () => { this.goalKind = k; this.showList({ keepCapture: true }); this.bodyEl.querySelector('.capture-input')?.focus(); },
        }, c.label)));
    }
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
      let urgent = false;
      if (switchable) {
        for (const [re, k] of PREFIX) if (re.test(text)) { target = k; text = text.replace(re, '').trim(); break; }
      }
      if (target === 'urgent') { target = 'todo'; urgent = true; }
      else if (target === 'todo' && URGENT_RE.test(text)) { urgent = true; text = text.replace(URGENT_RE, '').trim(); }
      if (!text) return;
      const typed = input.value;
      input.value = ''; // 저장하는 동안 목록을 다시 그려도 쓴 글자가 되살아나지 않게 먼저 비운다
      try {
        await this.add(target, text, { urgent });
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

  async add(kind, text, { urgent = false } = {}) {
    if (kind === 'project') {
      await addProject(this, text);
    } else if (kind === 'memo') {
      await api.createNote({ body: text });
      await this.reload();
      toast(this.tab === 'memo' ? '노트에 적었어요' : '노트에 넣었어요');
    } else if (kind === 'goal' && this.tab === 'goal' && this.goalKind !== 'due') {
      await this.addBigGoal(this.goalKind, text);
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
      await api.createItem({ title: text, dates: [], urgent });
      await this.reload();
      if (urgent) this.onStripChanged(); // 첫 화면 '오늘 챙길 것'
      toast(urgent ? '⚡ 급한 할 일로 넣었어요' : '할 일에 넣었어요');
    }
  }

  // 인생·올해 목표를 한 줄로 넣기. 올해 목표는 숫자를 읽어서 진행 방식을 알아서 정한다:
  //   '책 12권'    → 숫자 목표 0/12
  //   '운동 100번' → '운동' 루틴이 있으면 루틴 연결 (루틴 기록에서 자동으로 셈), 없으면 숫자 목표
  //   '토익 800'   → 점수는 세는 게 아니라서 체크 목표 (단위가 없는 숫자)
  async addBigGoal(kind, text) {
    if (kind === 'life') {
      await api.createGoal({ kind, title: text });
      await this.reload();
      this.onStripChanged();
      toast('인생 목표를 넣었어요');
      return;
    }
    const year = new Date().getFullYear();
    const payload = { kind, year, title: text, measure: 'check' };
    let note = '';
    const m = text.match(/(\d{1,6})\s*(번|회|권|개|편|일|시간|장|곡|바퀴|km|킬로|키로)/i);
    if (m && Number(m[1]) > 0) {
      payload.target = Number(m[1]);
      payload.measure = 'count';
      let routines = [];
      try { routines = await api.routines(); } catch { /* 루틴을 못 받으면 숫자 목표로 */ }
      const linked = /번|회|일/.test(m[2]) ? routines.find((r) => text.includes(r.name)) : null;
      if (linked) {
        payload.measure = 'routine';
        payload.routine_id = linked.id;
        note = ` · ${linked.emoji} ${linked.name} 기록에서 자동으로 세요`;
      }
    }
    const made = await api.createGoal(payload);
    await this.reload();
    this.onStripChanged();
    toast(`${year} 목표를 넣었어요${note}`, 'info', { action: { label: '고치기', run: () => this.showGoal(made.id) } });
  }

  // ---------------------------------------------------------------- 전체
  renderAll() {
    const todos = this.data.todos.filter((t) => !t.done);
    // 목표: 올해 목표 먼저, 그다음 기한 목표 (인생 목표는 목표 탭에서)
    const thisYear = new Date().getFullYear();
    const open = this.data.goals.filter((g) => !g.done);
    const goals = [...open.filter((g) => g.kind === 'year' && g.year === thisYear), ...open.filter((g) => g.kind === 'due')];
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
      projectRowsForAll(this, section),
      section('memo', notes.length,
        notes.length ? el('ul', { class: 'note-list compact' }, notes.slice(0, ALL_LIMIT - 1).map((n) => this.memoCard(n, false))) : null,
        '그때그때 드는 생각을 적어 두세요.'),
    ].filter(Boolean);
  }

  // ================================================================ 할 일
  renderTodos() {
    const open = this.data.todos.filter((t) => !t.done);
    const done = this.data.todos.filter((t) => t.done);
    const parts = [];
    if (!open.length) {
      parts.push(el('div', { class: 'notes-empty' },
        el('p', {}, '날짜를 아직 못 정한 일을 모아 두세요. 다 하면 ×로 지워요.'),
        el('p', { class: 'muted' }, '📅를 눌러 날짜를 정하면 그날의 일정이 돼요.'),
      ));
    } else {
      parts.push(el('ul', { class: 'todo-list' }, open.map((t) => this.todoRow(t))));
      parts.push(el('p', { class: 'list-hint' }, canDrag.matches
        ? '📅로 날짜를 정하거나, 달력의 날짜로 끌어다 놓으면 일정이 돼요.'
        : '📅로 날짜를 정하면 그날의 일정이 돼요.'));
    }
    if (done.length) parts.push(this.doneGroup('todo', `예전에 완료한 할 일 ${done.length}개`, done.map((t) => this.todoRow(t)),
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

  todoRow(item, { onToggle = null } = {}) {
    const time = formatTimeRange(item.start_time, item.end_time);
    const meta = [
      item.category.is_default ? null : el('span', { class: 'todo-cat' }, el('span', { class: 'dot' }), item.category.name),
      time ? el('span', { class: 'todo-time' }, time) : null,
      item.memo ? el('span', { class: 'todo-memo' }, item.memo.split('\n')[0]) : null,
    ].filter(Boolean);
    const toggle = onToggle || (() => this.toggleTodo(item));
    // 0.14.2: 할 일은 체크(완료)하지 않고 다 하면 지운다 (×). 프로젝트의 세부 할 일은 진행률 때문에 체크가 그대로 있고,
    // 예전에 완료한 할 일은 '완료' 묶음에 그대로 보인다 (체크를 풀거나 비울 수 있게).
    const canCheck = Boolean(onToggle) || item.done;
    const li = el('li', {
      class: ['todo-li', item.done ? 'is-done' : '', item.urgent && !item.done ? 'is-urgent' : '', canCheck ? '' : 'no-check'].join(' ').trim(),
      style: { '--cat': item.category.color },
      dataset: { id: String(item.id) },
    },
      canCheck ? checkbox(item.done, `'${item.title}' ${item.done ? '완료 취소' : '완료'}`, toggle) : null,
      el('button', { type: 'button', class: 'todo-main', onclick: () => this.onOpenItem(item) },
        el('span', { class: 'todo-title' }, item.title),
        meta.length ? el('span', { class: 'todo-meta' }, meta) : null,
      ),
      // ⚡ 급한 할 일 (0.13.0): 켜져 있으면 늘 보이고, 꺼져 있으면 마우스를 올렸을 때만 보인다
      item.done ? null : el('button', {
        type: 'button', class: item.urgent ? 'icon-btn sm todo-urgent is-on' : 'icon-btn sm todo-urgent', 'aria-pressed': String(item.urgent),
        'aria-label': `'${item.title}' ${item.urgent ? '급한 일 해제' : '급한 일로'}`, title: item.urgent ? '급한 일 해제' : '⚡ 급한 일로 (맨 위, 첫 화면에도)',
        onclick: () => this.toggleUrgent(item),
      }, icon(ICON.bolt)),
      item.done ? null : el('button', {
        type: 'button', class: 'icon-btn sm todo-date', 'aria-label': `'${item.title}' 날짜 정하기`, title: '날짜 정하기',
        onclick: () => this.pickTodoDate(item),
      }, icon(ICON.calendar)),
      canCheck ? null : el('button', {
        type: 'button', class: 'icon-btn sm todo-delete', 'aria-label': `'${item.title}' 지우기`, title: '지우기 (되돌리기 가능)',
        onclick: () => this.removeTodo(item),
      }, icon(ICON.x)),
    );
    li.addEventListener('contextmenu', (e) => openMenu(e, [
      { label: '수정', run: () => this.onOpenItem(item) },
      item.done ? null : { label: item.urgent ? '급한 일 해제' : '⚡ 급한 일로', run: () => this.toggleUrgent(item) },
      item.done ? null : { label: '날짜 정하기…', run: () => this.pickTodoDate(item) },
      canCheck ? { label: item.done ? '완료 취소' : '완료', run: toggle } : null,
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
    const next = !item.done;
    const local = this.data.todos.find((t) => t.id === item.id) || item;
    const before = { done: local.done, done_at: local.done_at };
    const saved = await this.optimistic({
      change: () => Object.assign(local, { done: next, done_at: next ? new Date().toISOString() : null }),
      undo: () => Object.assign(local, before),
      save: () => api.setDone(item.id, next),
    });
    if (saved !== undefined && next) toast(`'${item.title}' 완료!`, 'info', { action: { label: '되돌리기', run: () => this.undoDone(item) } });
  }

  // ⚡ 급한 할 일 켜고 끄기 (0.13.0) — 화면부터 바꾸고 저장은 뒤에서
  async toggleUrgent(item) {
    const next = !item.urgent;
    const local = this.data.todos.find((t) => t.id === item.id) || item;
    const saved = await this.optimistic({
      change: () => { local.urgent = next; },
      undo: () => { local.urgent = !next; },
      save: () => api.setUrgent(item.id, next),
    });
    if (saved === undefined) return;
    this.onStripChanged();
    if (this.view === 'project') await showProject(this, this.editingId, { keepScroll: true });
    toast(next ? `⚡ '${item.title}'을(를) 먼저 할 일로` : '급한 일에서 뺐어요');
  }

  async undoDone(item) {
    const local = this.data.todos.find((t) => t.id === item.id);
    if (local && local.done) await this.toggleTodo(local);
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
    try {
      await api.deleteItem(item.id);
      toast('삭제했어요');
      await this.reload();
      if (this.view === 'project') await showProject(this, this.editingId, { keepScroll: true });
      if (item.urgent) this.onStripChanged();
    } catch (e) { toast(e.message, 'error'); }
  }

  // × 지우기 (0.14.2): 묻지 않고 바로 지우고, 알림의 '되돌리기'로 같은 내용을 다시 만든다
  async removeTodo(item) {
    try {
      await api.deleteItem(item.id);
      await this.reload();
      if (item.urgent) this.onStripChanged();
      toast(`'${item.title}' 지웠어요`, 'info', {
        action: {
          label: '되돌리기',
          run: async () => {
            try {
              await api.createItem({
                title: item.title, memo: item.memo || '', category_id: item.category.id, dates: [], urgent: Boolean(item.urgent),
                start_time: item.start_time || null, end_time: item.end_time || null, ...(item.project ? { project_id: item.project.id } : {}),
              });
              await this.reload();
              if (item.urgent) this.onStripChanged();
            } catch (e) { toast(e.message, 'error'); }
          },
        },
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  async clearDone(count) {
    const ok = await ask(`완료한 할 일 ${count}개를 모두 지울까요?`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try { await api.clearDone(); toast('완료한 할 일을 비웠어요'); await this.reload(); } catch (e) { toast(e.message, 'error'); }
  }

  // ================================================================ 목표 (0.11.0: 인생 → 올해 → 기한, 세 단계)
  //
  //   인생 목표                     기한 없는 큰 방향
  //   2026 목표   남은 50일          올해 안에 이룰 것. 진행 방식: 체크 / 숫자(+1) / 루틴 연결(루틴 기록에서 자동으로 셈)
  //     └ 기한 목표                 올해 목표 아래에 묶은 기한 목표
  //   기한 목표                     어디에도 묶지 않은 것 (0.9.0의 목표)
  renderGoals() {
    const goals = this.data.goals;
    const thisYear = new Date().getFullYear();
    const life = goals.filter((g) => g.kind === 'life');
    const dueOpen = goals.filter((g) => g.kind === 'due' && !g.done);
    const dueDone = goals.filter((g) => g.kind === 'due' && g.done);
    const years = [...new Set(goals.filter((g) => g.kind === 'year').map((g) => g.year))];
    const parts = [];

    // 1) 인생 목표
    parts.push(this.goalSection({
      title: '인생 목표',
      add: () => this.showGoalForm({ kind: 'life' }),
      addLabel: '인생 목표 추가',
      rows: life.map((g) => this.lifeRow(g)),
      empty: '어떤 사람이 되고 싶은지, 큰 방향을 적어 두세요.',
    }));

    // 2) 올해 목표 (11월부터는 내년 목표도 미리 세울 수 있다)
    const showYears = [thisYear];
    if (new Date().getMonth() >= 10 || years.includes(thisYear + 1)) showYears.push(thisYear + 1);
    for (const y of showYears) {
      const list = goals.filter((g) => g.kind === 'year' && g.year === y);
      const left = daysBetween(todayStr(), `${y}-12-31`);
      parts.push(this.goalSection({
        title: `${y} 목표`,
        side: y === thisYear ? `남은 ${left}일` : '미리 세우기',
        add: () => this.showGoalForm({ kind: 'year', year: y }),
        addLabel: `${y} 목표 추가`,
        rows: list.flatMap((g) => [this.yearRow(g), ...dueOpen.filter((d) => d.parent_id === g.id).map((d) => this.goalRow(d, false, true))]),
        empty: y === thisYear ? "올해 안에 이루고 싶은 것. '운동 100번'처럼 숫자를 쓰면 진행도가 보여요." : '내년에 이루고 싶은 것을 미리 적어 두세요.',
      }));
    }

    // 3) 어디에도 묶지 않은 기한 목표
    const loose = dueOpen.filter((d) => !d.parent_id || !goals.some((g) => g.id === d.parent_id && showYears.includes(g.year)));
    const list = el('ul', { class: 'goal-list' }, loose.map((g) => this.goalRow(g, loose.length > 1)));
    const sortable = loose.length > 1 && loose.every((g) => !g.parent_id);
    if (sortable) {
      makeSortable(list, {
        scroller: this.bodyEl,
        onChange: async (ids) => {
          try { await api.reorderGoals(ids); await this.load(); } catch (e) { toast(e.message, 'error'); await this.reload(); }
        },
      });
    }
    parts.push(this.goalSection({
      title: '기한 목표',
      add: () => this.showGoalForm({ kind: 'due' }),
      addLabel: '기한 목표 추가',
      list: loose.length ? list : null,
      empty: "'12월까지 풀업 15개'처럼 기한을 쓰면 달력 위에 D-day로 보여요.",
    }));

    if (dueDone.length) parts.push(this.doneGroup('goal', `이룬 목표 ${dueDone.length}개`, dueDone.map((g) => this.goalRow(g, false))));

    // 4) 지난 해의 목표: 결과와 함께 접어 둔다
    for (const y of years.filter((v) => v < thisYear).sort((a, b) => b - a)) {
      const past = goals.filter((g) => g.kind === 'year' && g.year === y);
      parts.push(el('details', { class: 'done-group' },
        el('summary', {}, `${y} 목표 · ${past.length}개 중 ${past.filter((g) => g.done).length}개 이룸`),
        el('ul', { class: 'goal-list' }, past.map((g) => this.yearRow(g))),
      ));
    }
    return parts;
  }

  goalSection({ title, side = null, add, addLabel, rows = [], list = null, empty }) {
    const body = list ?? (rows.length ? el('ul', { class: 'goal-list' }, rows) : null);
    return el('section', { class: 'goal-sec' },
      el('header', { class: 'all-head' },
        el('h3', {}, title, side ? el('span', { class: 'goal-sec-side' }, side) : null),
        el('button', { type: 'button', class: 'icon-btn sm goal-add', 'aria-label': addLabel, title: addLabel, onclick: add }, icon(ICON.plus)),
      ),
      body ?? el('p', { class: 'all-empty' }, empty),
    );
  }

  lifeRow(g) {
    const kids = this.data.goals.filter((y) => y.kind === 'year' && y.parent_id === g.id && !y.done).length;
    const li = el('li', { class: 'goal-li is-life', dataset: { id: String(g.id) } },
      el('button', { type: 'button', class: 'goal-main', onclick: () => this.showGoal(g.id) },
        el('span', { class: 'goal-title' }, g.title),
        kids || g.memo ? el('span', { class: 'goal-meta' },
          kids ? el('span', { class: 'goal-due' }, `올해 목표 ${kids}개`) : null,
          g.memo ? el('span', { class: 'goal-memo' }, g.memo.split('\n')[0]) : null) : null,
      ),
    );
    li.addEventListener('contextmenu', (e) => openMenu(e, [
      { label: '수정', run: () => this.showGoal(g.id) },
      { label: '이 목표를 위한 올해 목표 추가', run: () => this.showGoalForm({ kind: 'year', year: new Date().getFullYear(), parentId: g.id }) },
      { label: '삭제', danger: true, run: () => this.deleteGoal(g) },
    ], { title: g.title }));
    return li;
  }

  // 올해 목표 한 줄: 체크형은 체크 버튼, 숫자·루틴형은 진행 막대
  yearRow(g) {
    const parent = g.parent_id ? this.goal(g.parent_id) : null;
    const counted = g.measure !== 'check';
    const ratio = counted ? Math.min(1, g.current / (g.target || 1)) : 0;
    const li = el('li', { class: ['goal-li is-year', g.done ? 'is-done' : '', counted ? 'is-counted' : ''].join(' ').trim(), dataset: { id: String(g.id) } },
      counted
        ? el('span', { class: 'goal-emoji', 'aria-hidden': 'true' }, g.done ? '🏅' : (g.routine?.emoji || '🔢'))
        : checkbox(g.done, `'${g.title}' ${g.done ? '이룸 취소' : '이뤘어요'}`, () => this.toggleGoal(g)),
      el('button', { type: 'button', class: 'goal-main', onclick: () => this.showGoal(g.id) },
        el('span', { class: 'goal-title' }, g.title),
        counted
          ? el('span', { class: 'goal-progress' },
              el('span', { class: 'goal-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(g.target), 'aria-valuenow': String(g.current), 'aria-label': `${g.current} / ${g.target}` },
                el('span', { style: { width: `${ratio * 100}%` } })),
              el('span', { class: 'goal-num' }, `${g.current}/${g.target}`))
          : null,
        parent || g.measure === 'routine'
          ? el('span', { class: 'goal-meta' },
              g.measure === 'routine' ? el('span', { class: 'goal-due' }, g.routine ? `${g.routine.name} 기록에서 자동` : '루틴 기록에서 자동') : null,
              parent ? el('span', { class: 'goal-memo' }, `🧭 ${parent.title}`) : null)
          : null,
      ),
      g.measure === 'count' && !g.done
        ? el('button', { type: 'button', class: 'goal-step', 'aria-label': `'${g.title}' 하나 더 (지금 ${g.current})`, title: '하나 더', onclick: () => this.stepGoal(g, 1) }, '+1')
        : null,
    );
    li.addEventListener('contextmenu', (e) => openMenu(e, [
      { label: '수정', run: () => this.showGoal(g.id) },
      g.measure === 'count' ? { label: '+1', run: () => this.stepGoal(g, 1) } : null,
      g.measure === 'count' && g.current > 0 ? { label: '−1 (잘못 눌렀을 때)', run: () => this.stepGoal(g, -1) } : null,
      g.measure === 'check' ? { label: g.done ? '이룸 취소' : '이뤘어요', run: () => this.toggleGoal(g) } : null,
      { label: '이 목표를 위한 기한 목표 추가', run: () => this.showGoalForm({ kind: 'due', parentId: g.id }) },
      { label: '삭제', danger: true, run: () => this.deleteGoal(g) },
    ], { title: g.title }));
    return li;
  }

  async stepGoal(g, delta) {
    const local = this.goal(g.id) || g;
    const before = { current: local.current, done: local.done };
    const next = await this.optimistic({
      change: () => {
        local.current = Math.max(0, local.current + delta);
        local.done = local.current >= (local.target || 1);
      },
      undo: () => Object.assign(local, before),
      save: () => api.stepGoal(g.id, delta),
    });
    if (next === undefined) return;
    if (delta > 0 && next.done) toast(`🎉 '${g.title}' ${next.target}개를 다 채웠어요!`);
    else if (delta > 0) toast(`${g.title} ${next.current}/${next.target}`, 'info', { action: { label: '되돌리기', run: () => this.stepGoal(next, -1) } });
    this.onStripChanged();
  }

  goalRow(g, sortable, nested = false) {
    if (g.kind === 'year') return this.yearRow(g);
    if (g.kind === 'life') return this.lifeRow(g);
    const today = todayStr();
    let due = null;
    if (g.due) {
      const left = daysBetween(today, g.due);
      due = el('span', { class: !g.done && left < 0 ? 'goal-due is-over' : 'goal-due' },
        `~${formatShort(g.due)}`, g.done ? null : ` · ${left < 0 ? '기한 지남' : ddayLabel(left)}`);
    }
    const li = el('li', { class: ['goal-li', g.done ? 'is-done' : '', nested ? 'is-nested' : ''].join(' ').trim(), dataset: { id: String(g.id) } },
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
    const local = this.goal(g.id) || g;
    const next = !local.done;
    const before = { done: local.done, done_at: local.done_at };
    const saved = await this.optimistic({
      change: () => Object.assign(local, { done: next, done_at: next ? new Date().toISOString() : null }),
      undo: () => Object.assign(local, before),
      save: () => api.updateGoal(g.id, { done: next }),
    });
    if (saved === undefined) return;
    if (next) toast(`🎉 '${g.title}' 이뤘어요!`, 'info', { action: { label: '되돌리기', run: () => this.undoGoal(g) } });
    this.onStripChanged();
  }

  async undoGoal(g) {
    const local = this.goal(g.id);
    if (local && local.done) await this.toggleGoal(local);
  }

  async deleteGoal(g) {
    const kids = this.data.goals.filter((c) => c.parent_id === g.id).length;
    const ok = await ask(`'${g.title}' 목표를 삭제할까요?${kids ? ` 아래에 이어 둔 목표 ${kids}개는 지워지지 않고 연결만 풀려요.` : ''}`, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return false;
    try {
      await api.deleteGoal(g.id);
      toast('목표를 삭제했어요');
      await this.load();
      if (this.view === 'list') this.showList({ keepCapture: true });
      this.onStripChanged();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  // ---------------------------------------------------------------- 목표 만들기·수정 (저장 버튼으로)
  showGoal(id) {
    const g = this.goal(id);
    if (!g) return this.showList();
    this.showGoalForm({ goal: g });
  }

  /** @param {{goal?: object, kind?: string, year?: number, parentId?: number}} o  goal이 없으면 새로 만들기 */
  async showGoalForm({ goal = null, kind = goal?.kind || 'due', year = goal?.year || new Date().getFullYear(), parentId = goal?.parent_id || null }) {
    this.flush();
    this.tab = 'goal';
    this.view = 'goal';
    this.editingId = goal?.id ?? null;
    const KIND_NAME = { life: '인생 목표', year: `${year} 목표`, due: '기한 목표' };
    this.titleEl.textContent = goal ? KIND_NAME[kind] : `새 ${KIND_NAME[kind]}`;
    this.backBtn.hidden = false;
    this.tabsEl.hidden = true;
    const g = goal || { title: '', memo: '', due: null, measure: 'check', target: null, current: 0, routine_id: null };

    const title = el('input', {
      type: 'text', class: 'input note-title-input', maxlength: '100', value: g.title, 'aria-label': '목표',
      placeholder: { life: '예: 건강한 몸 만들기', year: '예: 운동 100번', due: '이루고 싶은 것' }[kind],
    });
    const memo = el('textarea', { class: 'input', rows: '3', maxlength: '2000', value: g.memo, placeholder: '왜 이루고 싶은지, 어떻게 할지 (선택)', 'aria-label': '메모' });
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const fields = [title];
    let collect = () => ({});

    const parentSelect = (label, candidates, hint, none) => {
      if (!candidates.length) return { node: null, value: () => null };
      const select = el('select', { class: 'input', 'aria-label': label },
        el('option', { value: '' }, none),
        candidates.map((c) => el('option', { value: String(c.id), selected: c.id === parentId }, c.title)));
      return { node: el('div', { class: 'field' }, el('label', { class: 'label' }, label), select, el('p', { class: 'field-hint' }, hint)), value: () => (select.value ? Number(select.value) : null) };
    };

    if (kind === 'due') {
      const due = el('input', { type: 'date', class: 'input goal-due-input', value: g.due || '', 'aria-label': '기한' });
      const dueHint = el('p', { class: 'field-hint' });
      const showHint = () => {
        dueHint.textContent = due.value
          ? `${ddayLabel(daysBetween(todayStr(), due.value))} — 기한이 지나기 전까지 달력 위 띠에 보여요.`
          : '기한을 정하면 달력 위 띠에 D-day로 보여요.';
      };
      due.addEventListener('input', showHint);
      showHint();
      const parent = parentSelect('올해 목표에 묶기', this.data.goals.filter((y) => y.kind === 'year' && (!y.done || y.id === parentId)).map((y) => ({ id: y.id, title: `${y.year} · ${y.title}` })),
        '묶으면 그 올해 목표 아래에 보여요.', '연결되는 올해 목표 없음');
      fields.push(
        el('div', { class: 'field' },
          el('label', { class: 'label' }, '기한'),
          el('div', { class: 'goal-due-row' }, due,
            el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { due.value = ''; showHint(); } }, '기한 없음')),
          dueHint),
        parent.node,
      );
      collect = () => ({ due: due.value || null, parent_id: parent.value() });
    } else if (kind === 'year') {
      let routines = [];
      try { routines = await api.routines(); } catch { /* 루틴을 못 받아도 체크·숫자 목표는 만들 수 있다 */ }
      if (this.view !== 'goal') return; // 그 사이 다른 화면으로 바뀜
      let measure = g.measure;
      const target = el('input', { type: 'number', class: 'input goal-num-input', min: '1', max: '100000', inputmode: 'numeric', value: g.target ?? '', placeholder: '100', 'aria-label': '목표 숫자' });
      const current = el('input', { type: 'number', class: 'input goal-num-input', min: '0', inputmode: 'numeric', value: String(g.current || 0), 'aria-label': '지금까지' });
      const routine = el('select', { class: 'input', 'aria-label': '연결할 루틴' },
        routines.map((r) => el('option', { value: String(r.id), selected: r.id === g.routine_id }, `${r.emoji} ${r.name}`)));
      const countBox = el('div', { class: 'goal-count-row' },
        el('label', { class: 'goal-inline' }, '목표', target),
        el('label', { class: 'goal-inline goal-current' }, '지금까지', current));
      const routineBox = el('div', { class: 'field goal-routine-box' }, routine,
        el('p', { class: 'field-hint' }, `${year}년에 남긴 이 루틴의 기록 수를 알아서 세요. 루틴 버튼을 누를 때마다 목표가 채워져요.`));
      const measureHint = el('p', { class: 'field-hint' });
      const seg = el('div', { class: 'seg goal-measure', role: 'group', 'aria-label': '진행 방식' });
      const MEASURES = [['check', '체크'], ['count', '숫자'], ['routine', '루틴 연결']];
      const drawMeasure = () => {
        seg.replaceChildren(...MEASURES.map(([m, label]) => el('button', {
          type: 'button', class: 'seg-btn', 'aria-pressed': String(m === measure),
          disabled: m === 'routine' && !routines.length,
          title: m === 'routine' && !routines.length ? '먼저 루틴을 만들어 주세요 (하루 화면의 루틴 버튼)' : '',
          onclick: () => { measure = m; drawMeasure(); },
        }, label)));
        countBox.hidden = measure === 'check';
        countBox.querySelector('.goal-current').hidden = measure !== 'count';
        routineBox.hidden = measure !== 'routine';
        measureHint.textContent = {
          check: '이뤘을 때 체크해요.',
          count: "'+1' 버튼으로 하나씩 채워요.",
          routine: '루틴 기록이 목표를 알아서 채워 줘요.',
        }[measure];
      };
      drawMeasure();
      const parent = parentSelect('어떤 인생 목표를 위한 건가요?', this.data.goals.filter((l) => l.kind === 'life'), '이어 두면 큰 방향과 함께 보여요.', '연결되는 인생 목표 없음');
      fields.push(
        el('div', { class: 'field' }, el('label', { class: 'label' }, '진행 방식'), seg, measureHint, countBox, routineBox),
        parent.node,
      );
      collect = () => ({
        year, parent_id: parent.value(), measure,
        ...(measure !== 'check' ? { target: Number(target.value) || 0 } : {}),
        ...(measure === 'count' ? { current: Number(current.value) || 0 } : {}),
        ...(measure === 'routine' ? { routine_id: Number(routine.value) || 0 } : {}),
      });
    } else if (goal) {
      const kids = this.data.goals.filter((y) => y.kind === 'year' && y.parent_id === goal.id);
      if (kids.length) fields.push(el('div', { class: 'field' }, el('label', { class: 'label' }, '이 목표를 위한 올해 목표'), el('ul', { class: 'goal-list' }, kids.map((y) => this.yearRow(y)))));
    }
    fields.push(el('div', { class: 'field' }, el('label', { class: 'label' }, '메모'), memo), errorEl);

    const form = el('form', { id: 'goal-form', class: 'note-edit', novalidate: true }, fields.filter(Boolean));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = { title: title.value, memo: memo.value, ...collect() };
      try {
        if (goal) await api.updateGoal(goal.id, payload);
        else await api.createGoal({ kind, ...payload });
        toast(goal ? '목표를 저장했어요' : '목표를 넣었어요');
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
      goal ? el('button', { type: 'button', class: 'btn sm ghost danger', onclick: async () => { if (await this.deleteGoal(goal)) this.showList(); } }, '삭제') : null,
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn sm ghost', onclick: () => this.showList() }, '취소'),
      el('button', { type: 'submit', form: 'goal-form', class: 'btn sm primary' }, goal ? '저장' : '추가'),
    );
    if (!goal) title.focus();
  }

  // ================================================================ 메모
  renderMemos() {
    if (!this.data.notes.length) {
      return [el('div', { class: 'notes-empty' },
        el('p', {}, '다시 보고 싶은 글, 잊지 말아야 할 것을 적어두세요.'),
        el('p', { class: 'muted' }, '첫 노트는 메인 노트가 되고, 메인 노트의 배너 글귀는 달력 위에 늘 보여요.'),
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
    // 제목이 없는 한 줄 메모는 첫 줄을 제목처럼 보여 준다 (마크다운 기호는 걷어 내고)
    const lines = stripMarkdown((n.body || '').trim()).split('\n').map((l) => l.trim()).filter(Boolean);
    const headline = n.title || lines.shift() || '빈 노트';
    const preview = lines.slice(0, 2).join(' · ');
    return el('li', { class: 'note-li', dataset: { id: String(n.id) } },
      el('button', { type: 'button', class: 'note-card', onclick: () => { this.tab = this.tab === 'all' ? 'memo' : this.tab; this.showMemo(n.id); } },
        el('span', { class: n.title ? 'note-card-title' : 'note-card-title is-line' },
          n.is_main ? el('span', { class: 'note-main', title: '메인 노트' }, '★') : null,
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
  showMemo(id, { mode = null } = {}) {
    const fresh = this.editingId !== id || this.view !== 'memo';
    if (this.editingId !== id) this.flush();
    const n = this.note(id);
    if (!n) return this.showList();
    // 처음 열 때: 내용이 있으면 '보기', 비어 있으면 바로 '쓰기'
    if (mode) this.memoMode = mode;
    else if (fresh) this.memoMode = (n.body || '').trim() ? 'view' : 'edit';
    this.view = 'memo';
    this.editingId = id;
    this.titleEl.textContent = n.is_main ? '★ 메인 노트' : '노트';
    this.backBtn.hidden = false;
    this.tabsEl.hidden = true;

    const title = el('input', {
      type: 'text', class: 'input note-title-input', maxlength: '60', placeholder: '제목 (예: 다시 읽을 글)',
      'aria-label': '노트 제목', value: n.title,
    });
    const banner = n.is_main
      ? el('textarea', {
          class: 'input note-banner-input', rows: '2', maxlength: '200', placeholder: '예: 오늘 걷는 한 걸음이 내일을 바꾼다',
          'aria-label': '배너 글귀', value: n.banner,
        })
      : null;
    let text = this.pending?.id === id ? this.pending.fields.body : n.body; // 아직 저장 전인 글이 있으면 그것
    const editing = this.memoMode === 'edit';
    const body = editing
      ? el('textarea', {
          class: 'input note-body-input', placeholder: '자유롭게 적어 두세요.\n\n- [ ] 체크리스트\n**굵게**  # 제목  [링크](주소)', 'aria-label': '노트 내용', value: text,
        })
      : el('div', { class: 'md-view', tabindex: '0', 'aria-label': '노트 내용 (보기)' });

    const fields = () => ({
      title: title.value,
      body: editing ? body.value : text,
      ...(banner ? { banner: banner.value } : {}),
    });
    const onInput = () => this.schedule(id, fields());
    [title, editing ? body : null, banner].forEach((input) => input?.addEventListener('input', onInput));
    [title, editing ? body : null, banner].forEach((input) => input?.addEventListener('blur', () => this.flush()));

    if (!editing) {
      const draw = () => renderMarkdown(body, text, {
        onToggle: (next) => { text = next; this.schedule(id, fields()); draw(); }, // 체크리스트를 누르면 그 줄만 바뀌어 저장
      });
      if ((text || '').trim()) draw();
      else body.append(el('p', { class: 'muted' }, "아직 내용이 없어요. '쓰기'를 눌러 적어 보세요."));
      // 빈 곳을 두 번 누르면 쓰기로 (링크·체크 칸은 그대로 동작)
      body.addEventListener('dblclick', (e) => { if (!e.target.closest('a, input')) this.switchMemoMode(id, 'edit'); });
    }

    const modeBtn = (m, label) => el('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(this.memoMode === m), onclick: () => this.switchMemoMode(id, m),
    }, label);
    const modeBar = el('div', { class: 'note-mode-row' },
      el('div', { class: 'seg note-mode', role: 'group', 'aria-label': '노트 보기 방식' }, modeBtn('view', '보기'), modeBtn('edit', '쓰기')),
      editing ? el('span', { class: 'note-md-hint' }, '마크다운: **굵게**, - [ ] 체크리스트, # 제목') : null,
    );

    this.bodyEl.replaceChildren(
      el('div', { class: 'note-edit' },
        title,
        banner
          ? el('div', { class: 'note-banner-field' },
              el('label', { class: 'label' }, '배너 글귀'),
              banner,
              el('p', { class: 'field-hint' }, '여기 쓴 문장이 달력 위 배너에 늘 보여요. 비워 두면 배너가 숨겨져요.'))
          : null,
        modeBar,
        body,
      ),
    );
    this.renderMemoFoot(n);
  }

  // 보기 ↔ 쓰기: 쓰던 글은 먼저 저장(대기열)에 넣어 두고 화면만 바꾼다
  switchMemoMode(id, mode) {
    const area = this.bodyEl.querySelector('.note-body-input');
    if (area && this.note(id)) {
      const n = this.note(id);
      const title = this.bodyEl.querySelector('.note-title-input');
      const banner = this.bodyEl.querySelector('.note-banner-input');
      if (area.value !== n.body || this.pending) {
        this.schedule(id, { title: title.value, body: area.value, ...(banner ? { banner: banner.value } : {}) });
      }
    }
    this.showMemo(id, { mode });
    if (mode === 'edit') {
      const area2 = this.bodyEl.querySelector('.note-body-input');
      area2?.focus();
      area2?.setSelectionRange(area2.value.length, area2.value.length);
    }
  }

  renderMemoFoot(n) {
    this.setFoot(
      el('span', { class: 'note-status', 'aria-live': 'polite' }, this.pending ? '저장 중…' : ''),
      el('span', { class: 'spacer' }),
      n.is_main
        ? null // 이미 메인이면 버튼 없음
        : el('button', { type: 'button', class: 'btn sm ghost', title: '이 노트의 배너 글귀가 달력 위에 보이게 돼요', onclick: () => this.makeMain(n.id) }, '★ 메인으로'),
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
    flushAbout(); // '나' 탭에 쓰던 것도 (0.14.2)
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
      toast('메인 노트로 정했어요. 배너 글귀를 적어 보세요.');
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
    if (!title) { toast('빈 노트는 옮길 수 없어요.', 'error'); return; }
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
    const name = n.title || (n.body || '').trim().split('\n')[0] || '빈 노트';
    const ok = await ask(`'${name.slice(0, 30)}' 노트를 삭제할까요?${n.is_main ? ' 메인 노트를 지우면 맨 위 노트가 메인이 돼요.' : ''}`, [
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
      toast('노트를 삭제했어요');
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
