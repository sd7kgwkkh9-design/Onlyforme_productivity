// 루틴 (8차) — 이모지 하나 + 이름. 루틴으로 남긴 기록은 일정과 따로 저장된다.
//
//   routineBar     : 하루 화면 맨 아래(고정)의 버튼 줄  [🏃 운동 · 어제] [📖 독서 · 2일 전] …
//                    '어제'·'2일 전' = 보고 있는 날짜 기준으로 마지막으로 기록한 날
//   routineSection : 하루 화면에서 일정 목록 아래 '오늘의 루틴' 구역 (그날의 기록)
//   routineLogView : 루틴 기록 창 — 시간·메모만 적는 가벼운 창 (sheet.showView()로 연다)
//   routineManager : 루틴 편집 — 이름·이모지, 순서, 삭제 (sheet.showView()로 연다)
//
// 했다/안 했다 체크, 요일 지정, 연속 기록은 일부러 넣지 않았다. 루틴은 '빠르게 남기기'가 목적이다.

import { api } from './api.js';
import { makeSortable } from './reorder.js';
import { timeSelect } from './timepicker.js';
import { ask, el, formatLong, formatShort, formatTimeRange, icon, lastDoneLabel, todayStr, toast } from './utils.js';

// 루틴 이모지 고르기 칸에 보여 줄 것들 (이 밖의 이모지는 '직접' 칸에 키보드로 넣으면 된다)
const EMOJI_CHOICES = [
  '🏃', '💪', '🚶', '🚴', '🏊', '🧘', '🤸',
  '📖', '✏️', '📝', '🔤', '💻', '🎧', '🎸',
  '🎨', '🎮', '🧹', '🍳', '💧', '💊', '😴',
  '🌱', '🙏', '☕', '📵', '🧠', '❤️', '⭐',
];

// ---------------------------------------------------------------- 하루 화면 맨 아래: 버튼 줄
export function routineBar({ date, routines, onPick, onEdit }) {
  const head = el('div', { class: 'routine-head' },
    el('span', { class: 'label' }, '루틴 기록하기'),
    el('button', { type: 'button', class: 'link-btn', onclick: onEdit }, routines.length ? '편집' : '루틴 만들기'),
  );
  if (!routines.length) {
    return el('div', { class: 'routine-bar is-empty' }, head,
      el('p', { class: 'routine-empty' }, '운동·독서처럼 자주 하는 활동을 루틴으로 만들어 두면 눌러서 바로 기록할 수 있어요.'));
  }
  return el('div', { class: 'routine-bar' }, head,
    el('div', { class: 'routine-chips' },
      routines.map((r) => {
        const last = lastDoneLabel(r.last_date, date);
        return el('button', {
          type: 'button',
          class: 'routine-chip',
          title: r.last_date ? `마지막: ${formatShort(r.last_date)}` : '아직 기록이 없어요',
          'aria-label': `${r.name} 기록하기 (마지막: ${last})`,
          onclick: () => onPick(r),
        },
          el('span', { class: 'routine-emoji', 'aria-hidden': 'true' }, r.emoji),
          el('span', { class: 'routine-name' }, r.name),
          el('span', { class: 'routine-last' }, last),
        );
      }),
    ),
  );
}

// ---------------------------------------------------------------- 하루 화면: 그날의 루틴 기록
export function routineSection({ date, logs, onOpen, onMenu = null }) {
  return el('section', { class: 'routine-day', 'aria-label': '루틴 기록' },
    el('h3', { class: 'routine-day-title' }, date === todayStr() ? '오늘의 루틴' : '이 날의 루틴'),
    el('ul', { class: 'routine-logs' },
      logs.map((l) => {
        const time = formatTimeRange(l.start_time, l.end_time);
        return el('li', { oncontextmenu: onMenu ? (e) => onMenu(e, l) : null },
          el('button', { type: 'button', class: 'routine-log', onclick: () => onOpen(l) },
            el('span', { class: 'routine-log-emoji', 'aria-hidden': 'true' }, l.routine.emoji),
            el('span', { class: 'routine-log-main' },
              el('span', { class: 'routine-log-name' }, l.routine.name),
              l.memo ? el('span', { class: 'routine-log-memo' }, l.memo) : null,
            ),
            time ? el('span', { class: 'routine-log-time' }, time) : null,
          ));
      }),
    ),
  );
}

// ---------------------------------------------------------------- 루틴 기록 창 (시간·메모만)
/**
 * @param {object} o
 * @param {'create'|'edit'} o.mode
 * @param {object} [o.routine]  새 기록: 어떤 루틴인지 {id, name, emoji}
 * @param {object} [o.log]      수정: 기존 기록
 * @param {string} [o.date]     새 기록: 날짜
 * @param {object} [o.prefill]  새 기록: 처음 값 {start_time, end_time, memo} (빠른 입력의 '자세히')
 */
export function routineLogView({ mode, routine, log, date, prefill = {}, onChanged, returnTo }) {
  const isEdit = mode === 'edit';
  const r = isEdit ? log.routine : routine;
  const day = isEdit ? log.date : date;
  const src = isEdit ? log : prefill;

  function render(sheet) {
    sheet.setHead(`${r.emoji} ${r.name}`, `${formatLong(day)} · ${isEdit ? '기록 수정' : '기록 남기기'}`, { back: Boolean(returnTo) || sheet.kind === 'pane' });

    const uid = `${sheet.kind}-rl`;
    const hadTime = Boolean(src.start_time || src.end_time);
    const hasTime = el('input', { type: 'checkbox', id: `${uid}-has-time`, checked: hadTime });
    const startField = timeSelect('시작', `${uid}-start`, src.start_time, 'rl-start');
    const endField = timeSelect('끝', `${uid}-end`, src.end_time, 'rl-end');
    const timeFields = el('div', { class: 'time-fields' }, startField.node, el('span', { class: 'time-tilde' }, '~'), endField.node);
    timeFields.hidden = !hadTime;
    hasTime.addEventListener('change', () => {
      timeFields.hidden = !hasTime.checked;
      if (hasTime.checked && !startField.value && !endField.value) {
        startField.set(day === todayStr() ? nowTime() : '09:00'); // 오늘이면 지금 시각부터
        startField.focus();
      }
    });
    const memo = el('textarea', {
      id: `${uid}-memo`, class: 'input', rows: '2', maxlength: '500',
      placeholder: '예: 5km, 풀업 5세트, 30쪽, 단어 30개', value: src.memo ?? '',
    });
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });

    const form = el('form', { id: `${uid}-form`, class: 'form routine-log-form', novalidate: true },
      el('div', { class: 'field' },
        el('div', { class: 'time-row' },
          el('label', { class: 'switch', for: `${uid}-has-time` }, hasTime, el('span', { class: 'switch-ui' }), '시간 적기'),
          timeFields,
        ),
      ),
      el('div', { class: 'field' }, el('label', { class: 'label', for: `${uid}-memo` }, '메모'), memo),
      errorEl,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        start_time: hasTime.checked ? startField.value : null,
        end_time: hasTime.checked ? endField.value : null,
        memo: memo.value.trim(),
      };
      if (payload.start_time && payload.end_time && payload.end_time <= payload.start_time) {
        return showError(errorEl, '끝 시간은 시작 시간보다 늦어야 해요.', endField.hourEl);
      }
      saveBtn.disabled = true;
      try {
        if (isEdit) await api.updateRoutineLog(log.id, payload);
        else await api.createRoutineLog({ routine_id: r.id, date: day, ...payload });
        toast(isEdit ? '저장했어요' : `${r.emoji} ${r.name} 기록했어요`);
        await onChanged();
        sheet.goBack();
      } catch (err) {
        showError(errorEl, err.message);
        saveBtn.disabled = false;
      }
    });

    const saveBtn = el('button', { type: 'submit', form: `${uid}-form`, class: 'btn primary routine-save' }, isEdit ? '저장' : '기록');
    sheet.setBody(form);
    sheet.setFoot(
      isEdit ? el('button', { type: 'button', class: 'btn danger', onclick: () => remove(sheet, errorEl) }, '삭제') : null,
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => sheet.goBack() }, '취소'),
      saveBtn,
    );
    if (!isEdit) memo.focus({ preventScroll: true });
  }

  async function remove(sheet, errorEl) {
    const ok = await ask(`${formatShort(day)}의 '${r.name}' 기록을 삭제할까요?`, [
      { label: '삭제', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try {
      await api.deleteRoutineLog(log.id);
      toast('기록을 삭제했어요');
      await onChanged();
      sheet.goBack();
    } catch (e) { showError(errorEl, e.message); }
  }

  return { render, refresh: null, returnTo };
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- 루틴 편집 화면
export function routineManager({ onChanged, returnTo }) {
  let editingId = null;

  async function render(sheet) {
    sheet.setHead('루틴', '이모지와 이름만 정하면 돼요. 누르면 시간·메모를 적는 작은 창이 열려요.', { back: Boolean(returnTo) || sheet.kind === 'pane' });
    if (!sheet.bodyEl.querySelector('.routine-list, .routine-add')) sheet.loading();

    let routines;
    try { routines = await api.routines(); } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'routines') return;

    const changed = async () => {
      await onChanged();
      await render(sheet);
    };

    const list = el('ul', { class: 'routine-list' }, routines.map((r) => (r.id === editingId ? editRow(r) : row(r))));
    if (routines.length > 1 && editingId === null) {
      makeSortable(list, {
        scroller: sheet.bodyEl,
        onChange: async (ids) => {
          try { await api.reorderRoutines(ids); await onChanged(); } catch (e) { toast(e.message, 'error'); await render(sheet); }
        },
      });
    }

    // 새 루틴
    const nameInput = el('input', { type: 'text', class: 'input', maxlength: '30', placeholder: '예: 운동, 독서, 영어 단어', 'aria-label': '새 루틴 이름' });
    const picker = emojiPicker('⭐', `${sheet.kind}-routine-new`);
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = el('form', { class: 'routine-add', novalidate: true },
      el('h3', { class: 'label' }, '새 루틴'),
      el('div', { class: 'cat-add-row' },
        el('span', { class: 'routine-preview', 'aria-hidden': 'true' }, picker.value),
        nameInput,
        el('button', { type: 'submit', class: 'btn primary' }, '추가')),
      picker.node,
      errorEl,
    );
    picker.onChange((v) => { addForm.querySelector('.routine-preview').textContent = v || '?'; });
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.createRoutine({ name: nameInput.value, emoji: picker.value });
        toast('루틴을 추가했어요');
        await changed();
        sheet.bodyEl.querySelector('.routine-add input[type=text]')?.focus();
      } catch (err) { showError(errorEl, err.message, nameInput); }
    });

    sheet.setBody(
      routines.length ? list : el('p', { class: 'empty' }, '아직 루틴이 없어요. 아래에서 만들어 보세요.'),
      routines.length > 1 && editingId === null ? el('p', { class: 'list-hint' }, '오른쪽 ≡를 끌어서 버튼 순서를 바꿀 수 있어요.') : null,
      addForm,
    );
    sheet.setFoot();

    function row(r) {
      return el('li', { class: 'routine-row', dataset: { id: String(r.id) } },
        el('span', { class: 'routine-row-emoji', 'aria-hidden': 'true' }, r.emoji),
        el('span', { class: 'routine-row-main' },
          el('span', { class: 'cat-name' }, r.name),
          el('span', { class: 'cat-count' }, r.log_count ? `기록 ${r.log_count}개` : '기록 없음'),
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
      const editPicker = emojiPicker(r.emoji, `${sheet.kind}-routine-edit-${r.id}`);
      const err = el('p', { class: 'form-error', role: 'alert', hidden: true });
      const preview = el('span', { class: 'routine-preview', 'aria-hidden': 'true' }, r.emoji);
      editPicker.onChange((v) => { preview.textContent = v || '?'; });
      const form = el('form', { class: 'cat-edit', novalidate: true },
        el('div', { class: 'cat-add-row' },
          preview,
          input,
          el('button', { type: 'button', class: 'btn ghost', onclick: () => { editingId = null; render(sheet); } }, '취소'),
          el('button', { type: 'submit', class: 'btn primary' }, '저장'),
        ),
        editPicker.node,
        err,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.updateRoutine(r.id, { name: input.value, emoji: editPicker.value });
          editingId = null;
          toast('루틴을 바꿨어요');
          await changed();
        } catch (er) { showError(err, er.message, input); }
      });
      setTimeout(() => input.focus());
      return el('li', { class: 'routine-row editing', dataset: { id: String(r.id) } }, form);
    }

    async function remove(r) {
      const logs = r.log_count ? ` 기록 ${r.log_count}개도 함께 지워져요.` : '';
      const ok = await ask(`'${r.emoji} ${r.name}' 루틴을 삭제할까요?${logs}`, [
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

// 이모지 고르기: 자주 쓰는 이모지 칸 + '직접' 입력칸 (휴대폰 이모지 키보드로 아무거나)
function emojiPicker(initial, name) {
  let value = initial;
  let listener = () => {};
  const custom = el('input', {
    type: 'text', class: 'input emoji-custom', maxlength: '16', placeholder: '직접', 'aria-label': '이모지 직접 넣기',
    value: EMOJI_CHOICES.includes(initial) ? '' : initial,
  });
  const grid = el('div', { class: 'emoji-grid', role: 'radiogroup', 'aria-label': '이모지' },
    EMOJI_CHOICES.map((e) =>
      el('label', { class: 'emoji-choice' },
        el('input', { type: 'radio', name: `emoji-${name}`, value: e, checked: e === initial, 'aria-label': e }),
        el('span', { 'aria-hidden': 'true' }, e),
      )),
  );
  grid.addEventListener('change', (e) => {
    value = e.target.value;
    custom.value = '';
    listener(value);
  });
  custom.addEventListener('input', () => {
    value = custom.value.trim();
    grid.querySelectorAll('input').forEach((r) => { r.checked = r.value === value; });
    listener(value);
  });
  return {
    node: el('div', { class: 'emoji-picker' }, grid, custom),
    get value() { return value; },
    onChange(fn) { listener = fn; },
  };
}

function showError(errorEl, message, focusEl) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  focusEl?.focus();
}
