// 이번 주 한 걸음 (0.11.0): 한 주에 한 번, 올해 목표를 다시 떠올리게 하는 작은 카드
//
// - 그 주(월요일 시작)에 앱을 처음 열었을 때 한 번만 뜬다. 닫거나 할 일을 넣으면 그 주에는 다시 뜨지 않는다.
// - 올해 목표들의 진행도를 보여 주고, "이번 주에 이 목표에 다가갈 일 하나"를 적으면 기록지의 할 일로 들어간다.
// - 아직 못 이룬 올해 목표가 없으면 뜨지 않는다. ⚙ 설정에서 끌 수 있다 (기기마다 따로).

import { api } from './api.js';
import { addDays, el, toast, todayStr } from './utils.js';

const SEEN_KEY = 'my-calendar:weekly-seen';   // 마지막으로 카드를 본 주의 월요일
export const WEEKLY_KEY = 'my-calendar:weekly-card'; // 'off'면 끔

/** 그 날짜가 든 주의 월요일 */
export function mondayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=일 … 6=토
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function weeklyEnabled() {
  try { return localStorage.getItem(WEEKLY_KEY) !== 'off'; } catch { return true; }
}

function seenThisWeek() {
  try { return localStorage.getItem(SEEN_KEY) === mondayOf(todayStr()); } catch { return true; } // 저장을 못 하는 환경이면 띄우지 않는다
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, mondayOf(todayStr())); } catch { /* 무시 */ }
}

/**
 * @param {object} o
 * @param {object} o.overview  /api/overview 결과 (year.goals: 아직 못 이룬 올해 목표)
 * @param {() => Promise} o.onAdded      할 일을 넣은 뒤 (기록지 다시 불러오기)
 * @param {() => void} o.onOpenGoals     '목표 보기'
 * @param {boolean} [o.force]            설정에서 '지금 보기'를 눌렀을 때: 이번 주에 봤어도 띄운다
 */
export function maybeShowWeekly({ overview, onAdded, onOpenGoals, force = false }) {
  const goals = overview?.year?.goals || [];
  if (!goals.length) return false;
  if (!force && (!weeklyEnabled() || seenThisWeek())) return false;
  if (document.querySelector('dialog[open]')) return false; // 다른 창이 떠 있으면 다음에
  const year = overview.year;

  const dialog = el('dialog', { class: 'ask weekly', 'aria-labelledby': 'weekly-title' });
  const close = () => { markSeen(); dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', markSeen); // Esc
  dialog.addEventListener('close', () => dialog.remove());

  let picked = goals[0].id;
  const input = el('input', {
    type: 'text', class: 'input', maxlength: '100', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: '예: 수요일 저녁에 30분 달리기', 'aria-label': '이번 주에 할 일 하나',
  });
  const list = el('ul', { class: 'weekly-goals', role: 'radiogroup', 'aria-label': '어느 목표를 위한 일인가요?' });
  const drawGoals = () => list.replaceChildren(...goals.slice(0, 6).map((g) => {
    const counted = g.measure !== 'check';
    return el('li', {},
      el('button', { type: 'button', role: 'radio', class: 'weekly-goal', 'aria-checked': String(g.id === picked), onclick: () => { picked = g.id; drawGoals(); input.focus(); } },
        el('span', { class: 'weekly-goal-title' }, g.routine ? `${g.routine.emoji} ` : '', g.title),
        counted
          ? el('span', { class: 'goal-progress' },
              el('span', { class: 'goal-bar', 'aria-hidden': 'true' }, el('span', { style: { width: `${Math.min(100, (g.current / (g.target || 1)) * 100)}%` } })),
              el('span', { class: 'goal-num' }, `${g.current}/${g.target}`))
          : null,
      ));
  }));
  drawGoals();

  const form = el('form', { class: 'weekly-form', novalidate: true },
    el('h2', { class: 'decor-title', id: 'weekly-title' }, '이번 주 한 걸음'),
    el('p', { class: 'weekly-sub' }, `${year.year}년이 ${year.percent}% 지났어요 · 남은 ${year.days_left}일`),
    list,
    el('label', { class: 'label', for: 'weekly-input' }, '이번 주, 이 목표에 다가갈 일 하나'),
    Object.assign(input, { id: 'weekly-input' }),
    el('div', { class: 'decor-foot' },
      el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { close(); onOpenGoals(); } }, '목표 보기'),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn sm ghost', onclick: close }, '이번 주는 넘기기'),
      el('button', { type: 'submit', class: 'btn sm primary' }, '할 일에 넣기')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    const goal = goals.find((g) => g.id === picked);
    try {
      await api.createItem({ title, dates: [], memo: `🎯 ${year.year} 목표: ${goal.title}` });
      close();
      await onAdded();
      toast('할 일에 넣었어요. 이번 주도 한 걸음!');
    } catch (err) { toast(err.message, 'error'); }
  });

  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  return true;
}
