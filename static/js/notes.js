// 마음 노트 (7차) — 화면 왼쪽에 열리는 메모장
//
//   - 메모를 여러 개 만들 수 있다 (힘들 때 볼 글귀, 잊지 말아야 할 것 …)
//   - 그중 하나가 ★메인 메모. 메인 메모의 '배너 글귀' 칸에 쓴 문장이 달력 위 배너에 늘 보인다.
//   - 쓰는 대로 자동 저장된다 (잠깐 멈추면 저장, 창을 닫거나 뒤로 가도 저장).
//
// 넓은 화면(1100px 이상)에서는 달력 왼쪽에 칸으로 붙어 있어서 달력을 쓰면서 계속 볼 수 있고,
// 그보다 좁은 화면에서는 왼쪽에서 밀려 나오는 창으로 뜬다. 어느 쪽인지는 style.css가 정한다.

import { api } from './api.js';
import { makeSortable } from './reorder.js';
import { ask, el, icon, toast } from './utils.js';

const OPEN_KEY = 'my-calendar:notes-open';
const SAVE_DELAY_MS = 600;
const pushQuery = window.matchMedia('(min-width: 1100px)'); // style.css의 같은 값과 맞춰야 한다

export class NotesPanel {
  /**
   * @param {HTMLElement} root      <aside id="notes">
   * @param {object} opts
   * @param {HTMLElement} opts.toggle     상단의 '마음 노트' 버튼
   * @param {HTMLElement} opts.backdrop   좁은 화면에서 뒤를 어둡게 덮는 막
   * @param {() => void} opts.onBannerChanged   배너 글귀·메인이 바뀌었을 때 (달력 위 띠 다시 그리기)
   * @param {() => void} opts.onLayoutChanged   칸이 열리고 닫혀서 달력 너비가 바뀔 때
   */
  constructor(root, { toggle, backdrop, onBannerChanged, onLayoutChanged }) {
    this.root = root;
    this.toggleBtn = toggle;
    this.backdrop = backdrop;
    this.onBannerChanged = onBannerChanged;
    this.onLayoutChanged = onLayoutChanged;
    this.titleEl = root.querySelector('.notes-title');
    this.backBtn = root.querySelector('.notes-back');
    this.bodyEl = root.querySelector('.notes-body');
    this.footEl = root.querySelector('.notes-foot');

    this.notes = [];
    this.view = 'list';     // 'list' | 'edit'
    this.editingId = null;
    this.pending = null;    // 저장 대기 중인 { id, fields }
    this.timer = null;

    this.backBtn.addEventListener('click', () => this.showList());
    root.querySelector('.notes-close').addEventListener('click', () => this.close());
    toggle.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    backdrop.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pushQuery.matches) this.close(); });
    pushQuery.addEventListener('change', () => this.syncLayout());
    window.addEventListener('pagehide', () => this.flush()); // 앱을 닫기 직전에도 저장

    // 넓은 화면에서는 지난번에 열어 두었으면 다시 열어 둔다
    let remembered = false;
    try { remembered = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* 무시 */ }
    if (remembered && pushQuery.matches) this.open({ focus: false });
  }

  get isOpen() { return document.body.classList.contains('notes-open'); }

  async open({ noteId = null, focus = true } = {}) {
    document.body.classList.add('notes-open');
    this.root.hidden = false;
    this.syncLayout();
    this.remember(true);
    await this.load();
    if (noteId && this.notes.some((n) => n.id === noteId)) this.showEdit(noteId);
    else if (this.view === 'edit' && this.notes.some((n) => n.id === this.editingId)) this.showEdit(this.editingId);
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

  async load() {
    try {
      this.notes = await api.notes();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // 다른 기기에서 바뀐 내용이 들어왔을 때: 쓰고 있는 칸은 건드리지 않는다
  async refresh() {
    if (!this.isOpen) return;
    await this.load();
    if (this.view === 'list') {
      if (!this.bodyEl.querySelector('.is-sorting')) this.showList();
    } else if (!this.notes.some((n) => n.id === this.editingId)) {
      this.showList(); // 다른 기기에서 지운 메모
    } else if (!this.pending && !this.root.contains(document.activeElement)) {
      this.showEdit(this.editingId);
    } else {
      this.renderEditFoot(this.notes.find((n) => n.id === this.editingId));
    }
  }

  // ---------------------------------------------------------------- 목록
  showList() {
    this.flush();
    this.view = 'list';
    this.editingId = null;
    this.titleEl.textContent = '마음 노트';
    this.backBtn.hidden = true;

    if (!this.notes.length) {
      this.bodyEl.replaceChildren(
        el('div', { class: 'notes-empty' },
          el('p', {}, '힘들 때 꺼내 볼 글귀, 잊지 말아야 할 것을 적어 두세요.'),
          el('p', { class: 'muted' }, '첫 메모는 메인 메모가 되고, 메인 메모의 배너 글귀는 달력 위에 늘 보여요.'),
        ),
      );
    } else {
      const list = el('ul', { class: 'note-list' }, this.notes.map((n) => this.card(n)));
      if (this.notes.length > 1) {
        makeSortable(list, {
          scroller: this.bodyEl,
          onChange: async (ids) => {
            try {
              await api.reorderNotes(ids);
              this.notes = ids.map((id) => this.notes.find((n) => n.id === id));
            } catch (e) { toast(e.message, 'error'); await this.load(); this.showList(); }
          },
        });
      }
      this.bodyEl.replaceChildren(list);
    }
    this.footEl.replaceChildren(
      el('button', { type: 'button', class: 'btn primary wide', onclick: () => this.create() }, '새 메모'),
    );
  }

  card(n) {
    const preview = (n.body || '').trim().split('\n').filter(Boolean).slice(0, 2).join(' · ');
    return el('li', { class: 'note-li', dataset: { id: String(n.id) } },
      el('button', { type: 'button', class: 'note-card', onclick: () => this.showEdit(n.id) },
        el('span', { class: 'note-card-title' },
          n.is_main ? el('span', { class: 'note-main', title: '메인 메모' }, '★') : null,
          n.title || '제목 없음'),
        n.is_main && n.banner ? el('span', { class: 'note-card-banner' }, n.banner) : null,
        preview ? el('span', { class: 'note-card-preview' }, preview) : null,
      ),
      this.notes.length > 1
        ? el('button', { type: 'button', class: 'drag-handle', 'aria-label': `순서 바꾸기: ${n.title || '제목 없음'} (위아래 화살표로 이동)`, title: '끌어서 순서 바꾸기' }, icon('M5 9h14M5 15h14'))
        : null,
    );
  }

  async create() {
    try {
      const note = await api.createNote({ title: '' });
      this.notes.push(note);
      this.showEdit(note.id);
      this.bodyEl.querySelector('.note-title-input')?.focus();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------------------------------------------------------------- 메모 쓰기
  showEdit(id) {
    if (this.editingId !== id) this.flush();
    const n = this.notes.find((x) => x.id === id);
    if (!n) return this.showList();
    this.view = 'edit';
    this.editingId = id;
    this.titleEl.textContent = n.is_main ? '★ 메인 메모' : '메모';
    this.backBtn.hidden = false;

    const title = el('input', {
      type: 'text', class: 'input note-title-input', maxlength: '60', placeholder: '제목 (예: 힘들 때 읽을 것)',
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
    this.renderEditFoot(n);
  }

  renderEditFoot(n) {
    const parts = [
      el('span', { class: 'note-status', 'aria-live': 'polite' }, this.pending ? '저장 중…' : ''),
      el('span', { class: 'spacer' }),
      n.is_main
        ? null // 이미 메인이면 버튼 없음
        : el('button', { type: 'button', class: 'btn sm ghost', title: '이 메모의 배너 글귀가 달력 위에 보이게 돼요', onclick: () => this.makeMain(n.id) }, '★ 메인으로'),
      el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => this.remove(n) }, '삭제'),
    ];
    this.footEl.replaceChildren(...parts.filter(Boolean)); // replaceChildren은 null을 'null' 글자로 넣어 버리므로 빼고 넘긴다
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
      const i = this.notes.findIndex((n) => n.id === job.id);
      if (i >= 0) this.notes[i] = saved;
      if (!this.pending) this.setStatus('저장됨');
      if ('banner' in job.fields) this.onBannerChanged();
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
      this.showEdit(id);
      this.onBannerChanged();
      toast('메인 메모로 정했어요. 배너 글귀를 적어 보세요.');
      this.bodyEl.querySelector('.note-banner-input')?.focus();
    } catch (e) { toast(e.message, 'error'); }
  }

  async remove(n) {
    const ok = await ask(`'${n.title || '제목 없음'}' 메모를 삭제할까요?${n.is_main ? ' 메인 메모를 지우면 맨 위 메모가 메인이 돼요.' : ''}`, [
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
      this.onBannerChanged();
      toast('메모를 삭제했어요');
    } catch (e) { toast(e.message, 'error'); }
  }
}
