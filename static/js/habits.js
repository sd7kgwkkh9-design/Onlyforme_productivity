// 습관 관리 창 (0.13.0) — ⚙ 설정의 '습관…', 또는 첫 화면 습관 칩을 오른쪽 클릭 → '습관 관리…'
//
// 습관은 루틴과 다르다:
//   루틴 = 한 번 할 때마다 시간·메모를 남기는 활동 (🏃 운동 7시~8시 5km) → 달력에 기록이 쌓인다
//   습관 = 하루에 몇 번 했는지만 세는 생활 습관 (💧 물 3/8잔) → 첫 화면 '오늘 챙길 것' 줄에서 누를 때마다 +1, 자정에 0부터
// 매일 목표를 채우면 🔥 연속 기록이 이어진다. 저녁 6시가 넘도록 못 채웠으면 칩이 살짝 강조된다.

import { api } from './api.js';
import { makeSortable } from './reorder.js';
import { emojiPicker } from './routines.js';
import { WEEKDAYS, addDays, ask, el, parseDateStr, toast, todayStr } from './utils.js';

const CHOICES = ['💧', '🏃', '📖', '💊', '🧘', '🦷', '🥗', '😴', '🚶', '🤸', '📵', '🧴', '☀️', '🙏', '✍️', '🍎'];

/** sheet.showView('habits', habitManager({...}))로 연다 */
export function habitManager({ onChanged }) {
  let editingId = null;

  async function render(sheet) {
    sheet.setHead('습관', '하루에 몇 번 하는지만 세요. 첫 화면에서 누를 때마다 +1, 자정이 지나면 0부터 다시.', { back: false });
    if (!sheet.bodyEl.querySelector('.habit-list, .routine-add')) sheet.loading();
    let habits;
    try { habits = await api.habits(todayStr()); } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'habits') return;

    const changed = async () => { await onChanged(); await render(sheet); };
    const list = el('ul', { class: 'routine-list habit-list' }, habits.map((h) => (h.id === editingId ? editRow(h) : row(h))));
    if (habits.length > 1 && editingId === null) {
      makeSortable(list, {
        scroller: sheet.bodyEl,
        onChange: async (ids) => { try { await api.reorderHabits(ids); await onChanged(); } catch (e) { toast(e.message, 'error'); await render(sheet); } },
      });
    }

    const nameInput = el('input', { type: 'text', class: 'input', maxlength: '20', placeholder: '예: 물 마시기, 스트레칭, 영양제', 'aria-label': '새 습관 이름' });
    const target = el('input', { type: 'number', class: 'input habit-target', min: '1', max: '50', value: '1', inputmode: 'numeric', 'aria-label': '하루 목표 횟수' });
    const picker = emojiPicker('💧', `${sheet.kind}-habit-new`, CHOICES);
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const addForm = el('form', { class: 'routine-add', novalidate: true },
      el('h3', { class: 'label' }, '새 습관'),
      el('div', { class: 'cat-add-row' },
        el('span', { class: 'routine-preview', 'aria-hidden': 'true' }, picker.value),
        nameInput,
        el('label', { class: 'habit-target-label' }, '하루', target, '번'),
        el('button', { type: 'submit', class: 'btn primary' }, '추가')),
      picker.node,
      errorEl);
    picker.onChange((v) => { addForm.querySelector('.routine-preview').textContent = v || '?'; });
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.createHabit({ name: nameInput.value, emoji: picker.value, target: Number(target.value) || 1 });
        toast('습관을 추가했어요. 첫 화면에서 누를 때마다 하나씩 채워져요.');
        await changed();
        sheet.bodyEl.querySelector('.routine-add input[type=text]')?.focus();
      } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; }
    });

    sheet.setBody(
      habits.length ? list : el('p', { class: 'empty' }, '아직 습관이 없어요. 물 8잔, 스트레칭 1번처럼 하루에 챙길 것을 만들어 보세요.'),
      habits.length > 1 && editingId === null ? el('p', { class: 'list-hint' }, '오른쪽 ≡를 끌어서 순서를 바꿀 수 있어요.') : null,
      addForm);
    sheet.setFoot();

    function week(h) {
      // 최근 7일: 채운 날은 진하게, 조금 한 날은 연하게
      const today = todayStr();
      return el('span', { class: 'habit-week', 'aria-label': `최근 7일: ${h.week.join(', ')}` },
        h.week.map((n, i) => {
          const day = addDays(today, i - 6);
          return el('span', {
            class: n >= h.target ? 'is-full' : n > 0 ? 'is-some' : '',
            title: `${WEEKDAYS[parseDateStr(day).getDay()]} ${n}/${h.target}`,
          });
        }));
    }

    function row(h) {
      return el('li', { class: 'routine-row', dataset: { id: String(h.id) } },
        el('span', { class: 'routine-row-emoji', 'aria-hidden': 'true' }, h.emoji),
        el('span', { class: 'routine-row-main' },
          el('span', { class: 'routine-row-name' }, h.name),
          el('span', { class: 'routine-row-last' }, `하루 ${h.target}번 · 오늘 ${h.count}`, h.streak > 1 ? ` · 🔥 ${h.streak}일 연속` : ''),
        ),
        week(h),
        el('span', { class: 'cat-actions' },
          el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { editingId = h.id; render(sheet); } }, '수정'),
          el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => remove(h) }, '삭제')),
        habits.length > 1 ? el('button', { type: 'button', class: 'drag-handle', 'aria-label': `순서 바꾸기: ${h.name}` }, '≡') : null,
      );
    }

    function editRow(h) {
      const name = el('input', { type: 'text', class: 'input', maxlength: '20', value: h.name, 'aria-label': '습관 이름' });
      const tg = el('input', { type: 'number', class: 'input habit-target', min: '1', max: '50', value: String(h.target), inputmode: 'numeric', 'aria-label': '하루 목표 횟수' });
      const pk = emojiPicker(h.emoji, `${sheet.kind}-habit-${h.id}`, CHOICES);
      const err = el('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = el('form', { class: 'cat-edit', novalidate: true },
        el('div', { class: 'cat-add-row' }, name, el('label', { class: 'habit-target-label' }, '하루', tg, '번'),
          el('button', { type: 'button', class: 'btn ghost', onclick: () => { editingId = null; render(sheet); } }, '취소'),
          el('button', { type: 'submit', class: 'btn primary' }, '저장')),
        pk.node, err);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.updateHabit(h.id, { name: name.value, emoji: pk.value, target: Number(tg.value) || 1 });
          editingId = null;
          toast('습관을 바꿨어요');
          await changed();
        } catch (er) { err.textContent = er.message; err.hidden = false; }
      });
      setTimeout(() => name.focus());
      return el('li', { class: 'routine-row editing' }, form);
    }

    async function remove(h) {
      const ok = await ask(`'${h.emoji} ${h.name}' 습관을 지울까요? 지금까지의 기록도 함께 지워져요.`, [
        { label: '지우기', value: true, kind: 'danger-fill' },
        { label: '취소', value: null, kind: 'ghost' },
      ]);
      if (!ok) return;
      try { await api.deleteHabit(h.id); toast('습관을 지웠어요'); await changed(); } catch (e) { toast(e.message, 'error'); }
    }
  }

  return { render, refresh: render, returnTo: null };
}
