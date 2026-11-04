// 루틴 (7차) — 자주 하는 활동을 빠르게 추가하는 버튼
//
//   routineBar     : 하루 화면 맨 아래(고정)에 붙는 버튼 줄 [● 운동 · 3일 전] [● 독서 · 어제] …
//                    누르면 이름·카테고리가 채워진 입력 창이 열리고, 시간·메모는 직접 적는다.
//                    '3일 전'은 보고 있는 날짜 기준으로 그 활동을 마지막으로 한 날.
//   routineManager : 루틴 편집 화면 (추가·이름/카테고리 수정·삭제·순서 바꾸기). sheet.showView()로 연다.
//
// 했다/안 했다 체크나 연속 기록은 일부러 넣지 않았다. 루틴은 '빠른 추가'가 목적이다.

import { api } from './api.js';
import { makeSortable } from './reorder.js';
import { ask, categoryChips, el, formatShort, icon, lastDoneLabel, toast } from './utils.js';

export function routineBar({ date, routines, onPick, onEdit }) {
  const head = el('div', { class: 'routine-head' },
    el('span', { class: 'label' }, '루틴'),
    el('button', { type: 'button', class: 'link-btn', onclick: onEdit }, routines.length ? '편집' : '루틴 만들기'),
  );
  if (!routines.length) {
    return el('div', { class: 'routine-bar is-empty' }, head,
      el('p', { class: 'routine-empty' }, '운동·독서처럼 자주 하는 활동을 버튼으로 만들어 두면 한 번에 추가할 수 있어요.'));
  }
  return el('div', { class: 'routine-bar' }, head,
    el('div', { class: 'routine-chips' },
      routines.map((r) => {
        const last = lastDoneLabel(r.last_date, date);
        return el('button', {
          type: 'button',
          class: 'routine-chip',
          style: { '--cat': r.category.color },
          title: r.last_date ? `마지막: ${formatShort(r.last_date)}` : '아직 기록이 없어요',
          'aria-label': `${r.name} 추가 (마지막: ${last})`,
          onclick: () => onPick(r),
        },
          el('span', { class: 'dot' }),
          el('span', { class: 'routine-name' }, r.name),
          el('span', { class: 'routine-last' }, last),
        );
      }),
    ),
  );
}

// ---------------------------------------------------------------- 루틴 편집 화면
export function routineManager({ onChanged, returnTo }) {
  let editingId = null;

  async function render(sheet) {
    sheet.setHead('루틴', '누르면 이름과 카테고리가 채워진 입력 창이 열려요. 시간·횟수는 그때그때 적으면 돼요.', { back: Boolean(returnTo) || sheet.kind === 'pane' });
    if (!sheet.bodyEl.querySelector('.routine-list, .routine-add')) sheet.loading();

    let routines;
    let categories;
    try {
      [routines, categories] = await Promise.all([api.routines(), api.categories()]);
    } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'routines') return;

    const changed = async () => {
      await onChanged();
      await render(sheet);
    };

    const rows = routines.map((r) => (r.id === editingId ? editRow(r) : row(r)));
    const list = el('ul', { class: 'routine-list' }, rows);
    if (routines.length > 1 && editingId === null) {
      makeSortable(list, {
        scroller: sheet.bodyEl,
        onChange: async (ids) => {
          try { await api.reorderRoutines(ids); await onChanged(); } catch (e) { toast(e.message, 'error'); await render(sheet); }
        },
      });
    }

    // 새 루틴
    const defaultCat = categories.find((c) => c.is_default);
    const nameInput = el('input', { type: 'text', class: 'input', maxlength: '30', placeholder: '예: 운동, 독서, 영어 단어', 'aria-label': '새 루틴 이름' });
    const chips = categoryChips(categories, defaultCat.id, `${sheet.kind}-routine-new`);
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = el('form', { class: 'routine-add', novalidate: true },
      el('h3', { class: 'label' }, '새 루틴'),
      el('div', { class: 'cat-add-row' }, nameInput, el('button', { type: 'submit', class: 'btn primary' }, '추가')),
      chips.node,
      errorEl,
    );
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.createRoutine({ name: nameInput.value, category_id: chips.value });
        toast('루틴을 추가했어요');
        await changed();
        sheet.bodyEl.querySelector('.routine-add input[type=text]')?.focus();
      } catch (err) { showError(errorEl, err.message, nameInput); }
    });

    sheet.setBody(
      routines.length ? list : el('p', { class: 'empty' }, '아직 루틴이 없어요. 아래에서 만들어 보세요.'),
      routines.length > 1 ? el('p', { class: 'list-hint' }, '오른쪽 ≡를 끌어서 버튼 순서를 바꿀 수 있어요.') : null,
      addForm,
    );
    sheet.setFoot();

    function row(r) {
      return el('li', { class: 'routine-row', dataset: { id: String(r.id) }, style: { '--cat': r.category.color } },
        el('span', { class: 'dot lg' }),
        el('span', { class: 'routine-row-main' },
          el('span', { class: 'cat-name' }, r.name),
          el('span', { class: 'cat-count' }, r.category.name),
        ),
        el('span', { class: 'cat-actions' },
          el('button', { type: 'button', class: 'btn sm ghost', disabled: editingId !== null, onclick: () => { editingId = r.id; render(sheet); } }, '수정'),
          el('button', { type: 'button', class: 'btn sm ghost danger', disabled: editingId !== null, onclick: () => remove(r) }, '삭제'),
        ),
        routines.length > 1
          ? el('button', { type: 'button', class: 'drag-handle', 'aria-label': `순서 바꾸기: ${r.name} (위아래 화살표로 이동)`, title: '끌어서 순서 바꾸기' }, icon('M5 9h14M5 15h14'))
          : null,
      );
    }

    function editRow(r) {
      const input = el('input', { type: 'text', class: 'input', maxlength: '30', value: r.name, 'aria-label': '루틴 이름' });
      const editChips = categoryChips(categories, r.category.id, `${sheet.kind}-routine-edit-${r.id}`);
      const err = el('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = el('form', { class: 'cat-edit', novalidate: true },
        el('div', { class: 'cat-add-row' },
          input,
          el('button', { type: 'button', class: 'btn ghost', onclick: () => { editingId = null; render(sheet); } }, '취소'),
          el('button', { type: 'submit', class: 'btn primary' }, '저장'),
        ),
        editChips.node,
        err,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.updateRoutine(r.id, { name: input.value, category_id: editChips.value });
          editingId = null;
          toast('루틴을 바꿨어요');
          await changed();
        } catch (er) { showError(err, er.message, input); }
      });
      setTimeout(() => input.focus());
      return el('li', { class: 'routine-row editing', dataset: { id: String(r.id) } }, form);
    }

    async function remove(r) {
      const ok = await ask(`'${r.name}' 루틴을 삭제할까요? 이미 추가한 일정은 그대로 남아요.`, [
        { label: '삭제', value: true, kind: 'danger-fill' },
        { label: '취소', value: null, kind: 'ghost' },
      ]);
      if (!ok) return;
      try {
        await api.deleteRoutine(r.id);
        toast('루틴을 삭제했어요');
        await changed();
      } catch (e) { toast(e.message, 'error'); }
    }
  }

  return {
    render,
    refresh: (sheet) => { if (editingId === null && !sheet.bodyEl.contains(document.activeElement)) render(sheet); },
    returnTo,
  };
}

function showError(errorEl, message, focusEl) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  focusEl?.focus();
}
