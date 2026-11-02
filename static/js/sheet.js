// 편집 창(sheet) — 창 하나 안에서 4가지 화면이 바뀌며 나온다.
//
//   day        : 선택한 날짜의 일정 목록  ─┐
//   undated    : 기한 미정 목록            ─┼─ 일정을 누르거나 추가 → form
//   form       : 일정 추가/수정            ─┘   저장/취소하면 원래 화면으로 돌아감
//   categories : 카테고리 관리

import { api } from './api.js';
import { MultiDatePicker } from './datepicker.js';
import { makeSortable } from './reorder.js';
import { addDays, ask, el, formatLong, formatShort, formatTimeRange, icon, todayStr, toast } from './utils.js';

export const PALETTE = ['#E5534B', '#F08C2E', '#D9A514', '#3FA66B', '#2BA5B5', '#3D6FD9', '#7C5CD6', '#D45A9A'];

const $ = (id) => document.getElementById(id);
const sheet = $('sheet');
const titleEl = $('sheet-title');
const subEl = $('sheet-sub');
const bodyEl = $('sheet-body');
const footEl = $('sheet-foot');
const backBtn = $('sheet-back');

const state = {
  view: null,        // 'day' | 'undated' | 'form' | 'categories'
  day: null,         // day 화면의 날짜 'YYYY-MM-DD'
  form: null,        // { mode, item, scope, ctxDate, returnTo }
  categories: [],
  lastCategoryId: null, // 새 일정을 만들 때 직전에 고른 카테고리를 기본값으로
  onDataChanged: async () => {},
};

// ======================================================================= 공통
export function initSheet({ onDataChanged, loginEnabled = false }) {
  state.onDataChanged = onDataChanged;
  state.loginEnabled = loginEnabled;
  $('sheet-close').addEventListener('click', () => sheet.close());
  backBtn.addEventListener('click', () => goBack());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); }); // 배경 클릭
  sheet.addEventListener('close', () => { state.view = null; });
}

function open() {
  if (!sheet.open) {
    sheet.showModal();
    titleEl.focus(); // 닫기 버튼 대신 제목에 포커스 (화면 읽기 프로그램이 제목부터 읽도록)
  }
  bodyEl.scrollTop = 0;
}

function setHead(title, sub = '', { back = false } = {}) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  subEl.hidden = !sub;
  backBtn.hidden = !back;
}

function setBody(...nodes) { bodyEl.replaceChildren(...nodes.filter(Boolean)); }
function setFoot(...nodes) {
  const real = nodes.filter(Boolean); // null(예: 새 일정에는 없는 삭제 버튼)은 빼고
  footEl.replaceChildren(...real);
  footEl.hidden = real.length === 0;
}

async function loadCategories() {
  state.categories = await api.categories();
  return state.categories;
}

// 다른 기기에서 바뀐 내용이 들어왔을 때: 목록 화면이면 다시 그린다.
// (일정을 입력하는 중이거나 순서를 끌고 있을 때는 방해하지 않도록 건드리지 않는다)
export function refreshOpenSheet() {
  if (!sheet.open || document.querySelector('.item-list.is-sorting')) return;
  if (state.view === 'day') renderDay();
  else if (state.view === 'undated') renderUndated();
}

async function dataChanged() {
  try { await state.onDataChanged(); } catch (e) { toast(e.message, 'error'); }
}

function loading() { setBody(el('p', { class: 'muted pad' }, '불러오는 중…')); setFoot(); }

function failed(err) {
  setBody(el('p', { class: 'form-error', role: 'alert' }, err.message));
}

// 일정 한 줄 (day / undated 목록에서 공통으로 사용)
//   showTime=false : 시간 칸을 아예 빼서 제목을 왼쪽에 붙인다 (시간 있는 일정이 하나도 없는 목록용)
//   sortable=true  : 오른쪽에 순서 바꾸기 손잡이(≡)를 붙인다 (하루 목록용)
function itemRow({ id, title, memo, start_time, end_time, category, badge, onclick, showTime = true, sortable = false }) {
  return el('li', { class: 'item-li', dataset: { id: String(id) }, style: { '--cat': category.color } },
    el('button', { type: 'button', class: showTime ? 'item-row' : 'item-row no-time', onclick },
      showTime ? timeCell(start_time, end_time) : null,
      el('span', { class: 'item-main' },
        el('span', { class: 'item-title' }, title),
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

// 시간 칸: 시작 시간을 크게, 끝 시간을 그 아래 작게 (시간 없는 일정은 빈칸)
function timeCell(start, end) {
  return el('span', { class: 'item-time' },
    start ? el('span', { class: 't-start' }, start) : null,
    end ? el('span', { class: 't-end' }, `~${end}`) : null,
  );
}

// ======================================================================= day
export async function openDay(date) {
  state.view = 'day';
  state.day = date;
  open();
  await renderDay();
}

async function renderDay() {
  const date = state.day;
  setHead(formatLong(date), date === todayStr() ? '오늘' : '');
  loading();

  let list;
  try {
    list = await api.occurrences(date, addDays(date, 1));
  } catch (e) { return failed(e); }
  if (state.view !== 'day' || state.day !== date) return; // 그 사이 다른 화면으로 바뀌었으면 무시

  if (!list.length) {
    setBody(el('p', { class: 'empty' }, '이 날은 아직 비어 있어요.'));
  } else {
    const sortable = list.length > 1;
    const ul = el('ul', { class: 'item-list' },
      list.map((o) => itemRow({
        ...o,
        sortable,
        badge: o.date_count > 1 ? `${o.date_count}일` : null,
        onclick: () => editFromDay(o),
      })));
    if (sortable) makeSortable(ul, { scroller: bodyEl, onChange: (ids) => saveOrder(date, ids) });
    setBody(ul, sortable ? el('p', { class: 'list-hint' }, '오른쪽 ≡를 끌어서 순서를 바꿀 수 있어요.') : null);
  }
  setFoot(
    el('button', { type: 'button', class: 'btn primary wide', onclick: () =>
      openForm({ mode: 'create', ctxDate: date, returnTo: 'day' }) }, '일정 추가'),
  );
}

async function saveOrder(date, ids) {
  try {
    await api.reorderDay(date, ids);
    await dataChanged(); // 월간·주간 화면에도 같은 순서로 반영
  } catch (e) {
    toast(e.message, 'error');
    if (state.view === 'day' && state.day === date) renderDay(); // 서버 기준 순서로 되돌리기
  }
}

async function editFromDay(occ) {
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
    await openForm({ mode: 'edit', item, scope, ctxDate: occ.date, returnTo: 'day' });
  } catch (e) { toast(e.message, 'error'); }
}

// ======================================================================= undated
export async function openUndated() {
  state.view = 'undated';
  open();
  await renderUndated();
}

async function renderUndated() {
  setHead('기한 미정');
  loading();
  let list;
  try { list = await api.undated(); } catch (e) { return failed(e); }
  if (state.view !== 'undated') return;

  subEl.textContent = list.length ? `날짜가 정해지지 않은 일정 ${list.length}개` : '';
  subEl.hidden = !list.length;
  setBody(
    list.length
      ? el('ul', { class: 'item-list' },
          list.map((item) => itemRow({
            ...item,
            showTime: list.some((i) => i.start_time || i.end_time),
            onclick: () => openForm({ mode: 'edit', item, scope: 'all', ctxDate: null, returnTo: 'undated' }),
          })))
      : el('p', { class: 'empty' }, '날짜를 아직 못 정한 일은 여기에 모아 두세요.'),
  );
  setFoot(
    el('button', { type: 'button', class: 'btn primary wide', onclick: () =>
      openForm({ mode: 'create', ctxDate: null, returnTo: 'undated' }) }, '할 일 추가'),
  );
}

// ======================================================================= form
// 사이드 패널(기한 미정)에서 바로 여는 편집 창: 저장하면 창이 닫힌다.
export function openItemForm(item) {
  return openForm({ mode: 'edit', item, scope: 'all', ctxDate: null, returnTo: null });
}

export function openNewItem() {
  return openForm({ mode: 'create', ctxDate: null, returnTo: null });
}

async function openForm(form) {
  state.view = 'form';
  state.form = form;
  open();
  try { await loadCategories(); } catch (e) { return failed(e); }
  renderForm();
}

function goBack() {
  const to = state.form?.returnTo;
  state.form = null;
  if (to === 'day') openDay(state.day);
  else if (to === 'undated') openUndated();
  else sheet.close();
}

function renderForm() {
  const { mode, item, scope, ctxDate } = state.form;
  const isEdit = mode === 'edit';
  const multi = isEdit && item.dates.length > 1;

  let sub = '';
  if (isEdit && scope === 'single') sub = `${formatShort(ctxDate)} 하루만 바뀌어요`;
  else if (multi) sub = `${item.dates.length}개 날짜 모두에 적용돼요`;
  setHead(isEdit ? '일정 수정' : '새 일정', sub, { back: Boolean(state.form.returnTo) });

  // 처음 값 정하기
  const defaultCat = state.categories.find((c) => c.is_default);
  const initialCat = item?.category.id
    ?? (state.categories.some((c) => c.id === state.lastCategoryId) ? state.lastCategoryId : defaultCat.id);
  const initialDates = !isEdit
    ? (ctxDate ? [ctxDate] : [])
    : scope === 'single' ? [ctxDate] : item.dates;

  // --- 제목
  const titleInput = el('input', {
    type: 'text', id: 'f-title', class: 'input', maxlength: '100', required: true,
    placeholder: '무엇을 해야 하나요?', autocomplete: 'off', value: item?.title ?? '',
  });

  // --- 카테고리 (색 칩 라디오)
  const catGroup = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': '카테고리' },
    state.categories.map((c) =>
      el('label', { class: 'chip', style: { '--cat': c.color } },
        el('input', { type: 'radio', name: 'category', value: String(c.id), checked: c.id === initialCat }),
        el('span', { class: 'dot' }),
        c.name,
      )),
  );

  // --- 시간 (선택): 시작·끝 중 하나만 골라도 된다. 24시간 표기.
  const hadTime = Boolean(item?.start_time || item?.end_time);
  const hasTime = el('input', { type: 'checkbox', id: 'f-has-time', checked: hadTime });
  const startField = timeSelect('시작', 'f-start', item?.start_time);
  const endField = timeSelect('끝', 'f-end', item?.end_time);
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
    id: 'f-memo', class: 'input', rows: '3', maxlength: '2000', placeholder: '메모 (선택)', value: item?.memo ?? '',
  });

  const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const form = el('form', { id: 'item-form', class: 'form', novalidate: true },
    field('제목', titleInput, 'f-title'),
    fieldset('카테고리', catGroup),
    el('div', { class: 'field' },
      el('div', { class: 'time-row' },
        el('label', { class: 'switch', for: 'f-has-time' }, hasTime, el('span', { class: 'switch-ui' }), '시간 지정'),
        timeFields,
      ),
    ),
    fieldset('날짜', picker.root),
    field('메모', memoInput, 'f-memo'),
    errorEl,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: titleInput.value.trim(),
      memo: memoInput.value.trim(),
      category_id: Number(form.elements.category.value),
      start_time: hasTime.checked ? startField.value : null,
      end_time: hasTime.checked ? endField.value : null,
      dates: picker.dates,
    };
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
      state.lastCategoryId = payload.category_id;
      toast(payload.dates.length ? '저장했어요' : '기한 미정 목록에 저장했어요');
      await dataChanged();
      goBack();
    } catch (err) {
      showError(errorEl, err.message);
      saveBtn.disabled = false;
    }
  });

  const saveBtn = el('button', { type: 'submit', form: 'item-form', class: 'btn primary' }, '저장');
  const deleteBtn = isEdit
    ? el('button', { type: 'button', class: 'btn danger', onclick: () => deleteItem(errorEl) }, '삭제')
    : null;

  setBody(form);
  setFoot(
    deleteBtn,
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', class: 'btn ghost', onclick: () => goBack() }, '취소'),
    saveBtn,
  );
  if (!isEdit) titleInput.focus();
}

async function deleteItem(errorEl) {
  const { item, scope, ctxDate } = state.form;
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
    goBack();
  } catch (e) { showError(errorEl, e.message); }
}

// 24시간 시간 고르기: [시 ▾] : [분 ▾]
// 브라우저 기본 시간 입력(<input type=time>)은 맥·아이폰 설정에 따라 오전/오후로 나와서 직접 만든다.
function timeSelect(label, id, initial) {
  const pad = (n) => String(n).padStart(2, '0');
  const [h0, m0] = initial ? initial.split(':') : ['', '00'];

  const minutes = Array.from({ length: 12 }, (_, i) => pad(i * 5)); // 00, 05, … 55
  if (!minutes.includes(m0)) minutes.push(m0); // 예전에 5분 단위가 아닌 시간을 넣었던 경우
  minutes.sort();

  const hourEl = el('select', { id, class: 'input sel', 'aria-label': `${label} 시` },
    el('option', { value: '' }, '--'),
    Array.from({ length: 24 }, (_, i) => el('option', { value: pad(i) }, pad(i))),
  );
  const minuteEl = el('select', { class: 'input sel', 'aria-label': `${label} 분` },
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

// ======================================================================= categories
export async function openCategories() {
  state.view = 'categories';
  open();
  await renderCategories();
}

async function renderCategories(editingId = null) {
  setHead('카테고리', '카테고리를 지우면 그 안의 일정은 미분류로 옮겨져요.');
  if (!state.categories.length) loading();
  try { await loadCategories(); } catch (e) { return failed(e); }
  if (state.view !== 'categories') return;

  const rows = state.categories.map((c) =>
    c.id === editingId ? categoryEditRow(c) : categoryRow(c, editingId));

  // 새 카테고리 추가 폼
  const nameInput = el('input', { type: 'text', class: 'input', maxlength: '20', placeholder: '예: 수업, 알바, 운동', 'aria-label': '새 카테고리 이름' });
  const unused = PALETTE.find((p) => !state.categories.some((c) => c.color === p)) || PALETTE[0];
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
      await renderCategories();
    } catch (err) { showError(errorEl, err.message, nameInput); }
  });

  // 로그인을 쓰는 경우에만 로그아웃 버튼 (자주 쓰지 않으므로 카테고리 화면 맨 아래에 둔다)
  const logout = state.loginEnabled
    ? el('form', { class: 'logout-form', method: 'post', action: '/logout' },
        el('button', { type: 'submit', class: 'btn ghost sm' }, '이 기기에서 로그아웃'))
    : null;

  setBody(el('ul', { class: 'cat-list' }, rows), addForm, logout);
  setFoot();
}

function categoryRow(c, editingId) {
  return el('li', { class: 'cat-row', style: { '--cat': c.color } },
    el('span', { class: 'dot lg' }),
    el('span', { class: 'cat-name' }, c.name),
    el('span', { class: 'cat-count' }, `일정 ${c.item_count}개`),
    c.is_default
      ? el('span', { class: 'cat-lock', title: '기본 카테고리는 지울 수 없어요' }, '기본')
      : el('span', { class: 'cat-actions' },
          el('button', { type: 'button', class: 'btn sm ghost', disabled: editingId !== null, onclick: () => renderCategories(c.id) }, '수정'),
          el('button', { type: 'button', class: 'btn sm ghost danger', disabled: editingId !== null, onclick: () => deleteCategory(c) }, '삭제'),
        ),
  );
}

function categoryEditRow(c) {
  const nameInput = el('input', { type: 'text', class: 'input', maxlength: '20', value: c.name, 'aria-label': '카테고리 이름' });
  const colors = colorPicker(c.color, `edit-${c.id}`);
  const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const form = el('form', { class: 'cat-edit', novalidate: true },
    el('div', { class: 'cat-add-row' },
      nameInput,
      el('button', { type: 'button', class: 'btn ghost', onclick: () => renderCategories() }, '취소'),
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
      await renderCategories();
    } catch (err) { showError(errorEl, err.message, nameInput); }
  });
  setTimeout(() => nameInput.focus());
  return el('li', { class: 'cat-row editing' }, form);
}

async function deleteCategory(c) {
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
    await renderCategories();
  } catch (e) { toast(e.message, 'error'); }
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

