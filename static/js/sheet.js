// 편집 화면 — 같은 화면을 두 곳에 띄울 수 있다.
//
//   팝업(modal)    : 휴대폰처럼 좁은 화면에서 날짜를 누르면 뜨는 창, 그리고 카테고리 관리
//   오른쪽 칸(pane): 넓은 화면에서 달력 오른쪽에 늘 붙어 있는 칸
//
// 한 곳 안에서 화면이 바뀌며 나온다.
//   day        : 선택한 날짜의 일정 목록  ─┐
//   undated    : 기한 미정 목록 (팝업만)   ─┼─ 일정을 누르거나 추가 → form
//   form       : 일정 추가/수정            ─┘   저장/취소하면 원래 화면으로 돌아감
//   categories : 카테고리 관리 (팝업만)
//   그 밖      : 다른 파일이 이 창에 그리는 화면 (routines.js의 루틴 편집, stats.js의 시간 돌아보기) → showView()
//
// 하루 화면 맨 아래(고정)에는 루틴 버튼 줄이 있다. 누르면 이름·카테고리가 채워진 입력 창이 열린다.

import { api } from './api.js';
import { MultiDatePicker } from './datepicker.js';
import { makeSortable } from './reorder.js';
import { routineBar, routineManager } from './routines.js';
import {
  addDays, ask, categoryChips, daysBetween, ddayLabel, el, formatLong, formatShort, icon, todayStr, toast,
} from './utils.js';

export const PALETTE = ['#E5534B', '#F08C2E', '#D9A514', '#3FA66B', '#2BA5B5', '#3D6FD9', '#7C5CD6', '#D45A9A'];

// 두 곳이 함께 쓰는 값
const shared = {
  categories: [],
  lastCategoryId: null, // 새 일정을 만들 때 직전에 고른 카테고리를 기본값으로
  onDataChanged: async () => {},
};

export function configureSheets({ onDataChanged }) {
  shared.onDataChanged = onDataChanged;
}

async function loadCategories() {
  shared.categories = await api.categories();
  return shared.categories;
}

async function dataChanged() {
  try { await shared.onDataChanged(); } catch (e) { toast(e.message, 'error'); }
}

export class Sheet {
  /**
   * @param {HTMLElement} root  .sheet-title / .sheet-sub / .sheet-body / .sheet-foot / .sheet-back 를 가진 요소
   *                            (팝업이면 <dialog> 자체)
   * @param {object} opts
   * @param {'modal'|'pane'} opts.kind
   * @param {(view: string) => void} [opts.onShow]       오른쪽 칸: 화면이 바뀔 때 (탭 표시 맞추기)
   * @param {() => void} [opts.onBackToUndated]          오른쪽 칸: 기한 미정 탭에서 연 일정을 저장/취소했을 때
   */
  constructor(root, { kind, onShow = () => {}, onBackToUndated = () => {} }) {
    this.root = root;
    this.kind = kind;
    this.onShow = onShow;
    this.onBackToUndated = onBackToUndated;
    this.titleEl = root.querySelector('.sheet-title');
    this.subEl = root.querySelector('.sheet-sub');
    this.bodyEl = root.querySelector('.sheet-body');
    this.footEl = root.querySelector('.sheet-foot');
    this.backBtn = root.querySelector('.sheet-back');

    this.view = null;   // 'day' | 'undated' | 'form' | 'categories' | showView()로 연 화면 이름
    this.day = todayStr();
    this.form = null;   // { mode, item, scope, ctxDate, returnTo, prefill, copy }
    this.custom = null; // showView()로 연 화면 { render, returnTo }

    this.backBtn.addEventListener('click', () => this.goBack());
    if (kind === 'modal') {
      root.querySelector('.sheet-close').addEventListener('click', () => root.close());
      root.addEventListener('click', (e) => { if (e.target === root) root.close(); }); // 배경 클릭
      root.addEventListener('close', () => { this.view = null; });
    }
  }

  // ---------------------------------------------------------------- 공통
  get isOpen() {
    return this.kind === 'pane' ? true : this.root.open;
  }

  open(view) {
    this.view = view;
    if (this.kind === 'modal' && !this.root.open) {
      this.root.showModal();
      this.titleEl.focus(); // 닫기 버튼 대신 제목에 포커스 (화면 읽기 프로그램이 제목부터 읽도록)
    }
    this.onShow(view);
    this.bodyEl.scrollTop = 0;
  }

  close() {
    if (this.kind === 'modal') this.root.close();
    else this.showDay(this.day); // 오른쪽 칸은 닫히지 않고 그 날짜 목록으로 돌아간다
  }

  setHead(title, sub = '', { back = false } = {}) {
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
    this.subEl.hidden = !sub;
    this.backBtn.hidden = !back;
  }

  setBody(...nodes) { this.bodyEl.replaceChildren(...nodes.filter(Boolean)); }

  setFoot(...nodes) {
    const real = nodes.filter(Boolean); // null(예: 새 일정에는 없는 삭제 버튼)은 빼고
    this.footEl.replaceChildren(...real);
    this.footEl.hidden = real.length === 0;
  }

  loading() { this.setBody(el('p', { class: 'muted pad' }, '불러오는 중…')); this.setFoot(); }

  failed(err) { this.setBody(el('p', { class: 'form-error', role: 'alert' }, err.message)); }

  // 다른 기기에서 바뀐 내용이 들어왔을 때 / 다른 곳에서 저장했을 때: 목록 화면이면 다시 그린다.
  // (일정을 입력하는 중이거나 순서를 끌고 있을 때는 방해하지 않도록 건드리지 않는다)
  refreshList() {
    if (!this.isOpen || this.bodyEl.querySelector('.is-sorting')) return;
    if (this.view === 'day') this.renderDay();
    else if (this.view === 'undated') this.renderUndated();
    else if (this.custom?.refresh) this.custom.refresh(this);
  }

  // 다른 파일이 이 창 안에 그리는 화면 (루틴 편집, 시간 돌아보기)
  //   render(sheet)   : 화면을 그린다 (sheet.setHead / setBody / setFoot 사용)
  //   refresh(sheet)  : 다른 기기에서 바뀐 내용이 들어왔을 때 (없으면 그대로 둔다)
  //   returnTo        : 뒤로(←)를 누르면 돌아갈 곳 ('day' 등). 없으면 창을 닫는다.
  async showView(name, { render, refresh = null, returnTo = null }) {
    this.form = null;
    this.custom = { render, refresh, returnTo };
    this.open(name);
    await render(this);
  }

  // ---------------------------------------------------------------- day
  async showDay(date) {
    const sameDay = this.view === 'day' && this.day === date;
    this.day = date;
    this.form = null;
    this.open('day');
    await this.renderDay({ keepContent: sameDay });
  }

  async renderDay({ keepContent = true } = {}) {
    const date = this.day;
    this.setHead(formatLong(date), date === todayStr() ? '오늘' : '');
    // 같은 날짜를 새로 고칠 때는 '불러오는 중'으로 깜빡이지 않게 기존 내용을 그대로 둔다
    if (!keepContent || !this.bodyEl.querySelector('.item-list, .empty')) this.loading();

    let list;
    let routines;
    try {
      [list, routines] = await Promise.all([
        api.occurrences(date, addDays(date, 1)),
        api.routines(date).catch(() => null), // 루틴을 못 불러와도 일정 목록은 보이게
      ]);
    } catch (e) { return this.failed(e); }
    if (this.view !== 'day' || this.day !== date) return; // 그 사이 다른 화면으로 바뀌었으면 무시

    if (!list.length) {
      this.setBody(el('p', { class: 'empty' }, '이 날은 아직 비어 있어요.'));
    } else {
      const sortable = list.length > 1;
      const ul = el('ul', { class: 'item-list' },
        list.map((o) => itemRow({
          ...o,
          sortable,
          badge: o.date_count > 1 ? `${o.date_count}일` : null,
          dday: o.dday && o.date >= todayStr() ? ddayLabel(daysBetween(todayStr(), o.date)) : null,
          onclick: () => this.editFromDay(o),
        })));
      if (sortable) makeSortable(ul, { scroller: this.bodyEl, onChange: (ids) => this.saveOrder(date, ids) });
      this.setBody(ul, sortable ? el('p', { class: 'list-hint' }, '오른쪽 ≡를 끌어서 순서를 바꿀 수 있어요.') : null);
    }
    this.setFoot(
      el('div', { class: 'day-foot' },
        routines ? routineBar({
          date,
          routines,
          onPick: (r) => this.openForm({
            mode: 'create', ctxDate: date, returnTo: 'day',
            prefill: { title: r.name, category_id: r.category.id, routine_id: r.id, routineName: r.name },
          }),
          onEdit: () => this.showRoutines(),
        }) : null,
        el('button', { type: 'button', class: 'btn primary wide', onclick: () =>
          this.openForm({ mode: 'create', ctxDate: date, returnTo: 'day' }) }, '일정 추가'),
      ),
    );
  }

  async showRoutines() {
    await this.showView('routines', routineManager({ onChanged: dataChanged, returnTo: 'day' }));
  }

  async saveOrder(date, ids) {
    try {
      await api.reorderDay(date, ids);
      await dataChanged(); // 월간·주간 화면에도 같은 순서로 반영
    } catch (e) {
      toast(e.message, 'error');
      if (this.view === 'day' && this.day === date) this.renderDay(); // 서버 기준 순서로 되돌리기
    }
  }

  async editFromDay(occ) {
    let scope = 'all';
    if (occ.date_count > 1) {
      scope = await ask(
        `이 일정은 ${occ.date_count}개 날짜에 들어 있어요. 어디에 적용할까요?`,
        [
          { label: `${formatShort(occ.date)}만`, value: 'single', kind: 'primary' },
          { label: `모든 날짜 (${occ.date_count}일)`, value: 'all' },
          { label: '취소', value: null, kind: 'ghost' },
        ],
      );
      if (!scope) return;
    }
    try {
      const item = await api.getItem(occ.id);
      await this.openForm({ mode: 'edit', item, scope, ctxDate: occ.date, returnTo: 'day' });
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------------------------------------------------------------- undated (팝업)
  async showUndated() {
    this.open('undated');
    await this.renderUndated();
  }

  async renderUndated() {
    this.setHead('기한 미정');
    this.loading();
    let list;
    try { list = await api.undated(); } catch (e) { return this.failed(e); }
    if (this.view !== 'undated') return;

    this.subEl.textContent = list.length ? `날짜가 정해지지 않은 일정 ${list.length}개` : '';
    this.subEl.hidden = !list.length;
    this.setBody(
      list.length
        ? el('ul', { class: 'item-list' },
            list.map((item) => itemRow({
              ...item,
              showTime: list.some((i) => i.start_time || i.end_time),
              onclick: () => this.openForm({ mode: 'edit', item, scope: 'all', ctxDate: null, returnTo: 'undated' }),
            })))
        : el('p', { class: 'empty' }, '날짜를 아직 못 정한 일은 여기에 모아 두세요.'),
    );
    this.setFoot(
      el('button', { type: 'button', class: 'btn primary wide', onclick: () =>
        this.openForm({ mode: 'create', ctxDate: null, returnTo: 'undated' }) }, '할 일 추가'),
    );
  }

  // ---------------------------------------------------------------- form
  async openForm(form) {
    this.form = form;
    this.open('form');
    try { await loadCategories(); } catch (e) { return this.failed(e); }
    this.renderForm();
  }

  goBack() {
    const to = this.form ? this.form.returnTo : this.custom?.returnTo;
    this.form = null;
    this.custom = null;
    if (to === 'day') this.showDay(this.day);
    else if (to === 'undated') {
      if (this.kind === 'modal') this.showUndated();
      else this.onBackToUndated();
    } else this.close();
  }

  renderForm() {
    const { mode, item, scope, ctxDate, prefill = null, copy = false } = this.form;
    const isEdit = mode === 'edit';
    const multi = isEdit && item.dates.length > 1;
    const pre = prefill || {}; // 새 일정의 처음 값 (루틴 버튼, 복사, 빠른 입력의 '자세히')

    let sub = '';
    if (isEdit && scope === 'single') sub = `${formatShort(ctxDate)} 하루만 바뀌어요`;
    else if (multi) sub = `${item.dates.length}개 날짜 모두에 적용돼요`;
    else if (copy) sub = '복사본이에요. 날짜를 바꾸고 저장하세요.';
    else if (pre.routineName) sub = `루틴 '${pre.routineName}'으로 추가해요. 시간·메모는 자유롭게 적으세요.`;
    this.setHead(isEdit ? '일정 수정' : copy ? '일정 복사' : '새 일정', sub, { back: Boolean(this.form.returnTo) || this.kind === 'pane' });

    // 처음 값 정하기
    const cats = shared.categories;
    const defaultCat = cats.find((c) => c.is_default);
    const preCat = cats.some((c) => c.id === pre.category_id) ? pre.category_id : null;
    const initialCat = item?.category.id ?? preCat
      ?? (cats.some((c) => c.id === shared.lastCategoryId) ? shared.lastCategoryId : defaultCat.id);
    const initialDates = !isEdit
      ? (pre.dates ?? (ctxDate ? [ctxDate] : []))
      : scope === 'single' ? [ctxDate] : item.dates;
    const src = isEdit ? item : pre; // 제목·시간·메모·D-day의 처음 값

    // 같은 화면에 팝업과 오른쪽 칸이 동시에 있을 수 있으므로 id가 겹치지 않게 앞에 붙인다
    const uid = this.kind;
    const ids = {
      title: `${uid}-f-title`, hasTime: `${uid}-f-has-time`, start: `${uid}-f-start`,
      end: `${uid}-f-end`, memo: `${uid}-f-memo`, form: `${uid}-item-form`,
    };

    // --- 제목
    const titleInput = el('input', {
      type: 'text', id: ids.title, class: 'input f-title', maxlength: '100', required: true,
      placeholder: '무엇을 해야 하나요?', autocomplete: 'off', value: src?.title ?? '',
    });

    // --- 카테고리 (색 칩 라디오)
    const catChips = categoryChips(cats, initialCat, `${uid}-category`);
    const catGroup = catChips.node;

    // --- 시간 (선택): 시작·끝 중 하나만 골라도 된다. 24시간 표기.
    const hadTime = Boolean(src?.start_time || src?.end_time);
    const hasTime = el('input', { type: 'checkbox', id: ids.hasTime, class: 'f-has-time', checked: hadTime });
    const startField = timeSelect('시작', ids.start, src?.start_time, 'f-start');
    const endField = timeSelect('끝', ids.end, src?.end_time, 'f-end');
    const timeFields = el('div', { class: 'time-fields' }, startField.node, el('span', { class: 'time-tilde' }, '~'), endField.node);
    timeFields.hidden = !hasTime.checked;
    hasTime.addEventListener('change', () => {
      timeFields.hidden = !hasTime.checked;
      if (hasTime.checked) {
        if (!startField.value && !endField.value) startField.set('09:00'); // 처음 켜면 9시로 시작
        startField.focus();
      }
    });

    // --- 날짜 (여러 개)
    const picker = new MultiDatePicker({ selected: initialDates, anchor: ctxDate });

    // --- 메모
    const memoInput = el('textarea', {
      id: ids.memo, class: 'input f-memo', rows: '3', maxlength: '2000', placeholder: '메모 (선택)', value: src?.memo ?? '',
    });

    // --- D-day 표시: 켜 두면 달력 위 띠에 'D-3 기말고사'처럼 남은 날이 보인다
    const ddayInput = el('input', { type: 'checkbox', id: `${uid}-f-dday`, class: 'f-dday', checked: Boolean(src?.dday) });

    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });

    const form = el('form', { id: ids.form, class: 'form item-form', novalidate: true },
      field('제목', titleInput, ids.title),
      fieldset('카테고리', catGroup),
      el('div', { class: 'field' },
        el('div', { class: 'time-row' },
          el('label', { class: 'switch', for: ids.hasTime }, hasTime, el('span', { class: 'switch-ui' }), '시간 지정'),
          timeFields,
        ),
      ),
      fieldset('날짜', picker.root),
      el('div', { class: 'field' },
        el('label', { class: 'switch', for: `${uid}-f-dday` }, ddayInput, el('span', { class: 'switch-ui' }), 'D-day로 표시'),
        el('p', { class: 'field-hint' }, '달력 위쪽에 남은 날짜가 보여요. 시험·마감처럼 꼭 챙길 일정에 켜 두세요.'),
      ),
      field('메모', memoInput, ids.memo),
      errorEl,
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: titleInput.value.trim(),
        memo: memoInput.value.trim(),
        category_id: catChips.value ?? defaultCat.id,
        start_time: hasTime.checked ? startField.value : null,
        end_time: hasTime.checked ? endField.value : null,
        dates: picker.dates,
        dday: ddayInput.checked,
      };
      if (!isEdit && pre.routine_id) payload.routine_id = pre.routine_id; // 수정할 때는 보내지 않으면 그대로 유지
      if (!payload.title) return showError(errorEl, '제목을 입력해 주세요.', titleInput);
      if (hasTime.checked && !payload.start_time && !payload.end_time) {
        return showError(errorEl, '시작이나 끝 시간 중 하나는 골라 주세요. 시간이 필요 없으면 시간 지정을 꺼 주세요.', startField.hourEl);
      }
      if (payload.start_time && payload.end_time && payload.end_time <= payload.start_time) {
        return showError(errorEl, '끝 시간은 시작 시간보다 늦어야 해요.', endField.hourEl);
      }

      saveBtn.disabled = true;
      try {
        if (isEdit) await api.updateItem(item.id, { ...payload, scope, date: ctxDate });
        else await api.createItem(payload);
        shared.lastCategoryId = payload.category_id;
        toast(payload.dates.length ? '저장했어요' : '기한 미정 목록에 저장했어요');
        await dataChanged();
        this.goBack();
      } catch (err) {
        showError(errorEl, err.message);
        saveBtn.disabled = false;
      }
    });

    const saveBtn = el('button', { type: 'submit', form: ids.form, class: 'btn primary' }, '저장');
    const deleteBtn = isEdit
      ? el('button', { type: 'button', class: 'btn danger', onclick: () => this.deleteItem(errorEl) }, '삭제')
      : null;
    // 복사: 같은 내용이 채워진 새 일정 화면 (날짜만 바꿔서 저장하면 된다)
    const copyBtn = isEdit
      ? el('button', {
          type: 'button', class: 'btn ghost', title: '같은 내용으로 새 일정 만들기',
          onclick: () => this.openForm({
            mode: 'create', ctxDate, returnTo: this.form.returnTo, copy: true,
            prefill: {
              title: titleInput.value.trim() || item.title, memo: memoInput.value, category_id: catChips.value,
              start_time: hasTime.checked ? startField.value : null, end_time: hasTime.checked ? endField.value : null,
              dday: ddayInput.checked, routine_id: item.routine_id, dates: picker.dates,
            },
          }),
        }, '복사')
      : null;

    this.setBody(form);
    this.setFoot(
      deleteBtn,
      copyBtn,
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => this.goBack() }, '취소'),
      saveBtn,
    );
    if (!isEdit) titleInput.focus();
  }

  async deleteItem(errorEl) {
    const { item, scope, ctxDate } = this.form;
    const single = scope === 'single';
    const question = single
      ? `${formatShort(ctxDate)}에서만 이 일정을 삭제할까요?`
      : item.dates.length > 1
        ? `${item.dates.length}개 날짜에서 모두 삭제할까요?`
        : `'${item.title}'을(를) 삭제할까요?`;
    const ok = await ask(question, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try {
      await api.deleteItem(item.id, scope, ctxDate || '');
      toast('삭제했어요');
      await dataChanged();
      this.goBack();
    } catch (e) { showError(errorEl, e.message); }
  }

  // ---------------------------------------------------------------- categories (팝업)
  async showCategories() {
    this.open('categories');
    await this.renderCategories();
  }

  async renderCategories(editingId = null) {
    this.setHead('카테고리', '카테고리를 지우면 그 안의 일정은 미분류로 옮겨져요.');
    if (!shared.categories.length) this.loading();
    try { await loadCategories(); } catch (e) { return this.failed(e); }
    if (this.view !== 'categories') return;

    const rows = shared.categories.map((c) =>
      c.id === editingId ? this.categoryEditRow(c) : this.categoryRow(c, editingId));

    // 새 카테고리 추가 폼
    const nameInput = el('input', { type: 'text', class: 'input', maxlength: '20', placeholder: '예: 수업, 알바, 운동', 'aria-label': '새 카테고리 이름' });
    const unused = PALETTE.find((p) => !shared.categories.some((c) => c.color === p)) || PALETTE[0];
    const colors = colorPicker(unused, 'new');
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = el('form', { class: 'cat-add', novalidate: true },
      el('h3', { class: 'label' }, '새 카테고리'),
      el('div', { class: 'cat-add-row' }, nameInput, el('button', { type: 'submit', class: 'btn primary' }, '추가')),
      colors.node,
      errorEl,
    );
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.createCategory({ name: nameInput.value, color: colors.value });
        toast('카테고리를 추가했어요');
        await this.renderCategories();
      } catch (err) { showError(errorEl, err.message, nameInput); }
    });

    this.setBody(el('ul', { class: 'cat-list' }, rows), addForm);
    this.setFoot();
  }

  categoryRow(c, editingId) {
    return el('li', { class: 'cat-row', style: { '--cat': c.color } },
      el('span', { class: 'dot lg' }),
      el('span', { class: 'cat-name' }, c.name),
      el('span', { class: 'cat-count' }, `일정 ${c.item_count}개`),
      c.is_default
        ? el('span', { class: 'cat-lock', title: '기본 카테고리는 지울 수 없어요' }, '기본')
        : el('span', { class: 'cat-actions' },
            el('button', { type: 'button', class: 'btn sm ghost', disabled: editingId !== null, onclick: () => this.renderCategories(c.id) }, '수정'),
            el('button', { type: 'button', class: 'btn sm ghost danger', disabled: editingId !== null, onclick: () => this.deleteCategory(c) }, '삭제'),
          ),
    );
  }

  categoryEditRow(c) {
    const nameInput = el('input', { type: 'text', class: 'input', maxlength: '20', value: c.name, 'aria-label': '카테고리 이름' });
    const colors = colorPicker(c.color, `edit-${c.id}`);
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = el('form', { class: 'cat-edit', novalidate: true },
      el('div', { class: 'cat-add-row' },
        nameInput,
        el('button', { type: 'button', class: 'btn ghost', onclick: () => this.renderCategories() }, '취소'),
        el('button', { type: 'submit', class: 'btn primary' }, '저장'),
      ),
      colors.node,
      errorEl,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.updateCategory(c.id, { name: nameInput.value, color: colors.value });
        toast('카테고리를 바꿨어요');
        await dataChanged();
        await this.renderCategories();
      } catch (err) { showError(errorEl, err.message, nameInput); }
    });
    setTimeout(() => nameInput.focus());
    return el('li', { class: 'cat-row editing' }, form);
  }

  async deleteCategory(c) {
    const moved = c.item_count ? ` 일정 ${c.item_count}개는 미분류로 옮겨져요.` : '';
    const ok = await ask(`'${c.name}' 카테고리를 삭제할까요?${moved}`, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try {
      await api.deleteCategory(c.id);
      toast('카테고리를 삭제했어요');
      await dataChanged();
      await this.renderCategories();
    } catch (e) { toast(e.message, 'error'); }
  }
}

// ======================================================================= 화면 조각

// 일정 한 줄 (day / undated 목록에서 공통으로 사용)
//   showTime=false : 시간 칸을 아예 빼서 제목을 왼쪽에 붙인다 (시간 있는 일정이 하나도 없는 목록용)
//   sortable=true  : 오른쪽에 순서 바꾸기 손잡이(≡)를 붙인다 (하루 목록용)
function itemRow({ id, title, memo, start_time, end_time, category, badge, dday = null, onclick, showTime = true, sortable = false }) {
  return el('li', { class: 'item-li', dataset: { id: String(id) }, style: { '--cat': category.color } },
    el('button', { type: 'button', class: showTime ? 'item-row' : 'item-row no-time', onclick },
      showTime ? timeCell(start_time, end_time) : null,
      el('span', { class: 'item-main' },
        el('span', { class: 'item-title' }, dday ? el('span', { class: 'item-dday' }, dday) : null, title),
        el('span', { class: 'item-meta' },
          el('span', { class: 'item-cat' }, category.name),
          memo ? el('span', { class: 'item-memo' }, memo.split('\n')[0]) : null,
        ),
      ),
      badge ? el('span', { class: 'item-badge' }, badge) : null,
    ),
    sortable
      ? el('button', {
          type: 'button',
          class: 'drag-handle',
          'aria-label': `순서 바꾸기: ${title} (위아래 화살표로 이동)`,
          title: '끌어서 순서 바꾸기',
        }, icon('M5 9h14M5 15h14'))
      : null,
  );
}

// 시간 칸 (시간 없는 일정은 빈칸)
//   둘 다  → 09:00~ (윗줄, 굵게) / 10:30 (아랫줄)
//   시작만 → 09:00~
//   끝만   → ~18:00
function timeCell(start, end) {
  return el('span', { class: 'item-time' },
    start ? el('span', { class: 't-start' }, `${start}~`) : null,
    end ? el('span', { class: start ? 't-end' : 't-start' }, start ? end : `~${end}`) : null,
  );
}

// 24시간 시간 고르기: [시 ▾] : [분 ▾]
// 브라우저 기본 시간 입력(<input type=time>)은 맥·아이폰 설정에 따라 오전/오후로 나와서 직접 만든다.
function timeSelect(label, id, initial, className) {
  const pad = (n) => String(n).padStart(2, '0');
  const minutes = Array.from({ length: 60 }, (_, i) => pad(i)); // 00 ~ 59 (1분 단위)

  const hourEl = el('select', { id, class: `input sel ${className}-h`, 'aria-label': `${label} 시` },
    el('option', { value: '' }, '--'),
    Array.from({ length: 24 }, (_, i) => el('option', { value: pad(i) }, pad(i))),
  );
  const minuteEl = el('select', { class: `input sel ${className}-m`, 'aria-label': `${label} 분` },
    minutes.map((m) => el('option', { value: m }, m)),
  );

  const set = (value) => {
    const [h, m] = value ? value.split(':') : ['', '00'];
    hourEl.value = h;
    minuteEl.value = m;
    minuteEl.disabled = !h; // 시를 안 고르면 분은 의미가 없으므로 잠금
  };
  set(initial);
  hourEl.addEventListener('change', () => { minuteEl.disabled = !hourEl.value; });

  return {
    node: el('div', { class: 'time-field' },
      el('span', { class: 'time-label' }, label), hourEl, el('span', { class: 'time-colon' }, ':'), minuteEl),
    hourEl,
    get value() { return hourEl.value ? `${hourEl.value}:${minuteEl.value}` : null; },
    set,
    focus: () => hourEl.focus(),
  };
}

function field(label, input, id) {
  return el('div', { class: 'field' }, el('label', { class: 'label', for: id }, label), input);
}

function fieldset(legend, content) {
  return el('fieldset', { class: 'field' }, el('legend', { class: 'label' }, legend), content);
}

function showError(errorEl, message, focusEl) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  focusEl?.focus();
}

// 색 고르기: 미리 정한 8색 + 직접 고르기(컬러 피커)
function colorPicker(initial, name) {
  let value = initial.toUpperCase();
  const custom = el('input', { type: 'color', class: 'swatch-custom', value: value.toLowerCase(), title: '직접 고르기', 'aria-label': '직접 고르기' });
  const radios = PALETTE.map((color) =>
    el('label', { class: 'swatch', style: { '--cat': color }, title: color },
      el('input', { type: 'radio', name: `color-${name}`, value: color, checked: color === value, 'aria-label': color }),
    ));
  const node = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '색상' }, radios, custom);

  node.addEventListener('change', (e) => {
    if (e.target.type === 'radio') {
      value = e.target.value;
      custom.value = value.toLowerCase();
    }
  });
  custom.addEventListener('input', () => {
    value = custom.value.toUpperCase();
    node.querySelectorAll('input[type=radio]').forEach((r) => { r.checked = r.value === value; });
  });
  return { node, get value() { return value; } };
}
