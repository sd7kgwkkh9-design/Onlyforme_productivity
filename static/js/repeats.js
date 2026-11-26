// 반복하는 일 (0.15.3) — 상단 '챙기기' → '🔁 반복' (서버는 repeats.py)
//
//   매주   요일을 고른다 (격주도 된다)          🗑️ 분리수거 · 매주 월
//   매달   며칠인지 고른다 (마지막 날도 된다)   💸 월세 · 매달 25일, 💳 카드값 · 매달 마지막 날
// 날짜를 저장하지 않고 규칙만 저장해서 끝없이 돌아온다 (일정의 '반복'은 날짜를 하나하나 넣어서 1년까지).
// 달력 칸과 하루 화면 위쪽에 '🔁 분리수거'처럼 보이고, 누르면 이 창이 열린다.

import { api } from './api.js';
import { emojiPicker } from './routines.js';
import { ask, el, formatShort, toast, todayStr, WEEKDAYS } from './utils.js';

const CHOICES = ['🔁', '🗑️', '♻️', '💸', '💳', '🏠', '🧺', '🧹', '💊', '🪴', '📚', '📞'];
const FREQS = [['weekly', '매주'], ['biweekly', '격주'], ['monthly', '매달']];

/** 한 줄 설명: '매주 월·수 · 9:00 · 다음 12/1' */
function summary(r) {
  const parts = [r.label];
  if (r.time) parts.push(r.time);
  if (r.next) parts.push(r.next === todayStr() ? '오늘' : `다음 ${formatShort(r.next)}`);
  else parts.push('끝남');
  if (r.end) parts.push(`${formatShort(r.end)}까지`);
  return parts.join(' · ');
}

/** sheet.showView('repeats', repeatManager({...}))로 연다. editId를 주면 그 반복을 바로 고치는 창으로 */
export function repeatManager({ onChanged, editId = null }) {
  let editing = editId ? { id: editId } : null; // null | {new: true} | 반복 | {id} (불러온 뒤 채운다)

  async function render(sheet) {
    sheet.setHead('반복하는 일', '매주·매달 돌아오는 일을 적어 두면 달력에 알아서 보여요.', { back: false });
    if (!sheet.bodyEl.querySelector('.repeat-list, .repeat-form')) sheet.loading();
    let list;
    try { list = await api.repeats(todayStr()); } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'repeats') return;
    const changed = async () => { await onChanged(); await render(sheet); };

    if (editing?.id && !editing.title) editing = list.find((r) => r.id === editing.id) || null;
    if (editing) {
      sheet.setBody(form(sheet, editing.new ? null : editing, changed));
      sheet.setFoot();
      return;
    }
    sheet.setBody(
      list.length
        ? el('ul', { class: 'routine-list repeat-list' }, list.map((r) => el('li', { class: 'routine-row' },
            el('span', { class: 'routine-row-emoji', 'aria-hidden': 'true' }, r.emoji),
            el('span', { class: 'routine-row-main' },
              el('span', { class: 'routine-row-name' }, r.title),
              el('span', { class: 'routine-row-last' }, summary(r))),
            el('span', { class: 'cat-actions' },
              el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { editing = r; render(sheet); } }, '수정'),
              el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => remove(r, changed) }, '삭제')))))
        : el('div', { class: 'empty repeat-empty' },
            el('p', {}, '매주 월요일 분리수거, 매달 25일 월세처럼'),
            el('p', {}, '일정하게 돌아오는 일을 넣어 두세요.')),
    );
    sheet.setFoot(el('button', { type: 'button', class: 'btn primary wide', onclick: () => { editing = { new: true }; render(sheet); } }, '반복 추가'));
  }

  function form(sheet, r, changed) {
    let freq = r ? (r.freq === 'monthly' ? 'monthly' : r.interval === 2 ? 'biweekly' : 'weekly') : 'weekly';
    const days = new Set(r?.weekdays ?? [new Date().getDay()]);
    const title = el('input', { type: 'text', class: 'input', maxlength: '40', value: r?.title || '', placeholder: '예: 분리수거, 월세, 동아리 회의', 'aria-label': '이름' });
    const picker = emojiPicker(r?.emoji || '🔁', `${sheet.kind}-repeat`, CHOICES);
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': '주기' });
    const dayBox = el('div', { class: 'repeat-days', role: 'group', 'aria-label': '요일' });
    const monthDay = el('select', { class: 'input repeat-monthday', 'aria-label': '매달 며칠' },
      [...Array.from({ length: 31 }, (_, i) => el('option', { value: String(i + 1) }, `${i + 1}일`)), el('option', { value: '0' }, '마지막 날')]);
    monthDay.value = String(r?.freq === 'monthly' ? r.month_day : new Date().getDate());
    const time = el('input', { type: 'time', class: 'input repeat-time-input', value: r?.time || '', 'aria-label': '시간 (선택)' });
    const start = el('input', { type: 'date', class: 'input', value: r?.start || todayStr(), 'aria-label': '시작 날짜' });
    const end = el('input', { type: 'date', class: 'input', value: r?.end || '', 'aria-label': '끝 날짜 (선택)' });
    const memo = el('input', { type: 'text', class: 'input', maxlength: '200', value: r?.memo || '', placeholder: '예: 재활용은 목요일에 같이', 'aria-label': '메모 (선택)' });
    const dayField = el('div', { class: 'field' }, el('label', { class: 'label' }, '요일'), dayBox);
    const monthField = el('div', { class: 'field' }, el('label', { class: 'label' }, '매달'), monthDay,
      el('p', { class: 'field-hint' }, '31일처럼 그달에 없는 날이면 그달 마지막 날에 보여요.'));
    const draw = () => {
      seg.replaceChildren(...FREQS.map(([k, label]) => el('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(k === freq), onclick: () => { freq = k; draw(); },
      }, label)));
      dayBox.replaceChildren(...WEEKDAYS.map((name, i) => el('button', {
        type: 'button', class: `repeat-day wd-${i}`, 'aria-pressed': String(days.has(i)), 'aria-label': `${name}요일`,
        onclick: () => { if (days.has(i)) days.delete(i); else days.add(i); draw(); },
      }, name)));
      dayField.hidden = freq === 'monthly';
      monthField.hidden = freq !== 'monthly';
    };
    draw();
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const node = el('form', { class: 'form repeat-form', novalidate: true },
      el('div', { class: 'field' }, el('label', { class: 'label' }, '이름'), title),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '얼마나 자주'), seg),
      dayField, monthField,
      el('div', { class: 'field' }, el('label', { class: 'label' }, '시간 (선택)'), time),
      el('div', { class: 'field repeat-range' },
        el('label', { class: 'label' }, '기간'),
        el('div', { class: 'repeat-range-row' }, start, el('span', { 'aria-hidden': 'true' }, '~'), end),
        el('p', { class: 'field-hint' }, '끝 날짜를 비워 두면 계속 돌아와요.')),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '메모 (선택)'), memo),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '이모지'), picker.node),
      errorEl,
      el('div', { class: 'form-buttons' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { editing = null; render(sheet); } }, '취소'),
        el('button', { type: 'submit', class: 'btn primary' }, r ? '저장' : '추가')));
    node.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        title: title.value, emoji: picker.value,
        freq: freq === 'monthly' ? 'monthly' : 'weekly', interval: freq === 'biweekly' ? 2 : 1,
        weekdays: [...days].sort(), month_day: Number(monthDay.value),
        time: time.value || null, start: start.value, end: end.value || null, memo: memo.value,
      };
      try {
        if (r) await api.updateRepeat(r.id, payload);
        else await api.createRepeat(payload);
        toast(r ? '반복을 바꿨어요' : '반복을 넣었어요');
        editing = null;
        await changed();
      } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; }
    });
    setTimeout(() => title.focus());
    return node;
  }

  async function remove(r, changed) {
    const ok = await ask(`'${r.emoji} ${r.title}' 반복을 지울까요? 달력에서도 모두 사라져요.`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try { await api.deleteRepeat(r.id); toast('지웠어요'); await changed(); } catch (e) { toast(e.message, 'error'); }
  }

  return { render, refresh: (sheet) => { if (!editing) render(sheet); }, returnTo: null };
}
