// 기념일 (0.13.0) — ⚙ 설정의 '기념일…', 또는 날짜 칸 오른쪽 클릭 → '이 날을 기념일로…'
//
//   생일      매년 그날 (음력 가능 — 해마다 양력 날짜가 바뀌어도 알아서 맞춘다)      🎂 엄마 생신
//   기념일    매년 그날 + 'N주년'                                                   💍 결혼기념일 6주년
//   날짜 세기 100일마다 + 해마다 '1주년' (그날을 1일로 셀지 고를 수 있다)            💕 만난 날 500일
// 달력 칸에 이름이 작게 보이고, 30일 안으로 다가오면 첫 화면 띠에 D-day로 보인다. 캘린더 구독(.ics)에도 나간다.
// 음력 계산은 서버의 오픈소스 korean_lunar_calendar(MIT, 한국천문연구원 기준)가 한다.

import { api } from './api.js';
import { emojiPicker } from './routines.js';
import { ask, ddayLabel, el, formatShort, toast, todayStr } from './utils.js';

const KINDS = [['birthday', '생일'], ['yearly', '기념일'], ['days', '날짜 세기']];
const KIND_NAME = Object.fromEntries(KINDS);
const CHOICES = ['🎂', '💍', '💕', '🎉', '🎓', '🕯️', '🏠', '🐶', '💼', '✈️', '⭐', '🌸'];
const DDAY_CHOICES = [[0, '안 띄움'], [7, '7일 전부터'], [14, '14일 전부터'], [30, '30일 전부터'], [60, '60일 전부터'], [100, '100일 전부터']];
const DEFAULT_EMOJI = { birthday: '🎂', yearly: '💍', days: '💕' };

/** 기념일 한 줄 설명: '음력 8/15 · D-13 6주년', '오늘 80일째 · 100일까지 20일' */
export function annivSummary(a) {
  const [y, m, d] = a.date.split('-').map(Number);
  const base = a.lunar ? `음력 ${a.leap ? '윤' : ''}${m}/${d}` : a.kind === 'days' ? `${y}.${m}.${d}부터` : `${m}/${d}`;
  const parts = [base];
  if (a.day_count) parts.push(`오늘 ${a.day_count.toLocaleString()}일째`);
  if (a.next) {
    const when = a.next.days_left === 0 ? '오늘' : `${ddayLabel(a.next.days_left)} ${formatShort(a.next.date)}`;
    parts.push(`${when}${a.next.label ? ` ${a.next.label}` : ''}`);
  }
  return parts.join(' · ');
}

/** sheet.showView('annivs', annivManager({...}))로 연다. date를 주면 그 날짜로 새 기념일 창을 바로 연다 */
export function annivManager({ onChanged, date = null }) {
  let editing = date ? { new: true, date } : null; // null | {new, date} | 기념일

  async function render(sheet) {
    sheet.setHead('기념일', '생일·기념일은 매년, 날짜 세기는 100일마다 달력에 보여요.', { back: false });
    if (!sheet.bodyEl.querySelector('.anniv-list, .anniv-form')) sheet.loading();
    let list;
    try { list = await api.anniversaries(todayStr()); } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'annivs') return;
    const changed = async () => { await onChanged(); await render(sheet); };

    if (editing) {
      sheet.setBody(form(sheet, editing.new ? null : editing, editing.date, changed));
      sheet.setFoot();
      return;
    }
    sheet.setBody(
      list.length
        ? el('ul', { class: 'routine-list anniv-list' }, list.map((a) => el('li', { class: 'routine-row' },
            el('span', { class: 'routine-row-emoji', 'aria-hidden': 'true' }, a.emoji),
            el('span', { class: 'routine-row-main' },
              el('span', { class: 'routine-row-name' }, a.title, el('span', { class: 'anniv-kind' }, KIND_NAME[a.kind])),
              el('span', { class: 'routine-row-last' }, annivSummary(a), ` · ${a.dday_days ? `${a.dday_days}일 전부터 D-day` : 'D-day 안 띄움'}`)),
            el('span', { class: 'cat-actions' },
              el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { editing = a; render(sheet); } }, '수정'),
              el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => remove(a, changed) }, '삭제')))))
        : el('p', { class: 'empty' }, '가족 생일, 기념일, 만난 날처럼 챙길 날을 넣어 두세요.'),
    );
    sheet.setFoot(el('button', { type: 'button', class: 'btn primary wide', onclick: () => { editing = { new: true, date: todayStr() }; render(sheet); } }, '기념일 추가'));
  }

  function form(sheet, a, date, changed) {
    let kind = a?.kind || 'birthday';
    const title = el('input', { type: 'text', class: 'input', maxlength: '40', value: a?.title || '', placeholder: '예: 엄마 생신, 결혼기념일, 만난 날', 'aria-label': '이름' });
    const picker = emojiPicker(a?.emoji || DEFAULT_EMOJI[kind], `${sheet.kind}-anniv`, CHOICES);
    let emojiTouched = Boolean(a);
    picker.onChange(() => { emojiTouched = true; });
    const solar = el('input', { type: 'date', class: 'input', value: a && !a.lunar ? a.date : (date || ''), 'aria-label': '날짜' });
    // 음력은 2월 30일처럼 양력에 없는 날이 있어서 숫자로 받는다
    const [ly, lm, ld] = (a?.lunar ? a.date : (date || todayStr())).split('-').map(Number);
    const num = (v, min, max, label) => el('input', { type: 'number', class: 'input anniv-num', min: String(min), max: String(max), value: String(v), inputmode: 'numeric', 'aria-label': label });
    const lunarY = num(ly, 1001, 2049, '음력 연도');
    const lunarM = num(lm, 1, 12, '음력 월');
    const lunarD = num(ld, 1, 30, '음력 일');
    const leap = el('input', { type: 'checkbox', checked: Boolean(a?.leap) });
    const lunar = el('input', { type: 'checkbox', checked: Boolean(a?.lunar) });
    const fromOne = el('input', { type: 'checkbox', checked: a ? a.from_one : true });
    // 0.14.2: 기념일마다 첫 화면 띠에 D-day를 며칠 전부터 띄울지
    const dday = el('select', { class: 'input anniv-dday', 'aria-label': '첫 화면에 D-day 띄우기' },
      DDAY_CHOICES.map(([v, label]) => el('option', { value: String(v), selected: v === (a ? a.dday_days ?? (a.dday ? 30 : 0) : 30) }, label)));
    const solarBox = el('div', { class: 'field' }, el('label', { class: 'label' }, '날짜'), solar);
    const lunarBox = el('div', { class: 'field' }, el('label', { class: 'label' }, '음력 날짜'),
      el('div', { class: 'anniv-lunar' }, lunarY, '년', lunarM, '월', lunarD, '일', el('label', { class: 'anniv-check' }, leap, '윤달')));
    const lunarSwitch = el('label', { class: 'anniv-check' }, lunar, '음력');
    const oneSwitch = el('label', { class: 'anniv-check' }, fromOne, '그날을 1일로 세기 (사귄 날 = 1일)');
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': '종류' });
    const hint = el('p', { class: 'field-hint' });
    const draw = () => {
      seg.replaceChildren(...KINDS.map(([k, label]) => el('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(k === kind),
        onclick: () => {
          kind = k;
          if (!emojiTouched) { picker.node.querySelector(`input[value="${DEFAULT_EMOJI[k]}"]`)?.click(); emojiTouched = false; }
          draw();
        },
      }, label)));
      const isDays = kind === 'days';
      if (isDays) lunar.checked = false;
      lunarSwitch.hidden = isDays;
      oneSwitch.hidden = !isDays;
      lunarBox.hidden = !lunar.checked;
      solarBox.hidden = lunar.checked;
      hint.textContent = {
        birthday: '매년 그날 달력에 보여요. 음력 생일이면 음력을 켜세요 — 해마다 양력 날짜를 알아서 맞춰요.',
        yearly: "매년 그날 '3주년'처럼 보여요.",
        days: "100일마다('100일', '200일' …)와 해마다('1주년') 달력에 보여요.",
      }[kind];
    };
    lunar.addEventListener('change', draw);
    draw();
    const errorEl = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const node = el('form', { class: 'form anniv-form', novalidate: true },
      el('div', { class: 'field' }, el('label', { class: 'label' }, '이름'), title),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '종류'), seg, hint),
      solarBox, lunarBox,
      el('div', { class: 'field anniv-switches' }, lunarSwitch, oneSwitch),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '첫 화면에 D-day'), dday),
      el('div', { class: 'field' }, el('label', { class: 'label' }, '이모지'), picker.node),
      errorEl,
      el('div', { class: 'form-buttons' },
        el('button', { type: 'button', class: 'btn ghost', onclick: () => { editing = null; render(sheet); } }, '취소'),
        el('button', { type: 'submit', class: 'btn primary' }, a ? '저장' : '추가')));
    node.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pad = (n) => String(n).padStart(2, '0');
      const payload = {
        title: title.value, emoji: picker.value, kind, lunar: lunar.checked, leap: lunar.checked && leap.checked,
        from_one: fromOne.checked, dday_days: Number(dday.value),
        date: lunar.checked ? `${lunarY.value}-${pad(lunarM.value)}-${pad(lunarD.value)}` : solar.value,
      };
      try {
        if (a) await api.updateAnniversary(a.id, payload);
        else await api.createAnniversary(payload);
        toast(a ? '기념일을 바꿨어요' : '기념일을 넣었어요');
        editing = null;
        await changed();
      } catch (err) { errorEl.textContent = err.message; errorEl.hidden = false; }
    });
    setTimeout(() => title.focus());
    return node;
  }

  async function remove(a, changed) {
    const ok = await ask(`'${a.emoji} ${a.title}'을(를) 지울까요?`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    try { await api.deleteAnniversary(a.id); toast('지웠어요'); await changed(); } catch (e) { toast(e.message, 'error'); }
  }

  return { render, refresh: (sheet) => { if (!editing) render(sheet); }, returnTo: null };
}

/** 달력 칸·주간·하루 화면에 붙이는 이름표: '🎂 엄마 생신' / '💕 만난 날 100일' */
export function annivLabel(a) {
  return `${a.emoji} ${a.title}${a.label ? ` ${a.label}` : ''}`;
}
