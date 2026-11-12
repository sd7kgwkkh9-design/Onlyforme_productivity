// 달력 위 띠 (7차, 0.11.0에서 인생·올해 목표와 비 소식을 더함)
//
//   [ 메인 메모의 배너 글귀 ]                 [☂ 18시쯤 비 70%] [2026 ▓▓▓▓░ 87% · 🏃 운동 63/100] [D-2 레포트] [🎯 D-52 풀업 15개]
//   [ 🧭 건강한 몸 만들기 ]  ← 인생 목표 (날마다 하나씩 돌아가며)
//
// - 글귀를 누르면 기록지(메인 메모)가 열린다. 인생 목표를 누르면 기록지의 목표 탭이 열린다.
// - '올해' 칩: 올해가 얼마나 지났는지 + 올해 목표 하나(날마다 돌아가며)와 그 진행도. 누르면 그 목표가 열린다.
// - D-day 칩을 누르면 그 날짜가 열린다. 🎯 목표 칩(0.9.0)을 누르면 기록지의 그 목표가 열린다.
// - 오늘 비 소식(강수확률 50% 이상인 시간)이 있으면 ☂ 칩으로 알려 준다 (weather.js).
// - 아무것도 없으면 띠 전체를 숨긴다.

import { api } from './api.js';
import { ddayLabel, el, formatShort, todayStr } from './utils.js';
import { rainAlert } from './weather.js';

// 날마다 바뀌는 순번: 목록에서 오늘 보여 줄 하나를 고른다
function pickToday(list) {
  if (!list.length) return null;
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  return list[dayOfYear % list.length];
}

export function goalProgressText(g) {
  return g.measure === 'check' ? '' : `${g.current}/${g.target}`;
}

export class TopStrip {
  /**
   * @param {HTMLElement} root  <section id="top-strip">
   * @param {object} opts
   * @param {(noteId: number) => void} opts.onOpenNote
   * @param {(date: string) => void}   opts.onOpenDate
   * @param {(goalId: number) => void} opts.onOpenGoal
   * @param {() => void} opts.onOpenGoals   기록지의 목표 탭 열기
   */
  constructor(root, { onOpenNote, onOpenDate, onOpenGoal, onOpenGoals }) {
    this.root = root;
    this.onOpenNote = onOpenNote;
    this.onOpenDate = onOpenDate;
    this.onOpenGoal = onOpenGoal;
    this.onOpenGoals = onOpenGoals;
    this.data = null; // 마지막으로 받은 /api/overview (날씨만 바뀌었을 때 다시 그리려고)
  }

  async refresh() {
    this.data = await api.overview(todayStr());
    this.render();
    return this.data;
  }

  render() {
    if (!this.data) return;
    const { banner, ddays, year, life = [] } = this.data;

    const quote = banner
      ? el('button', {
          type: 'button',
          class: 'banner-quote',
          title: '기록지 열기',
          onclick: () => this.onOpenNote(banner.note_id),
        },
          el('span', { class: 'banner-text' }, banner.text),
        )
      : null;

    // 인생 목표: 날마다 하나씩
    const lifeGoal = pickToday(life);
    const lifeLine = lifeGoal
      ? el('button', {
          type: 'button', class: 'life-line', title: `인생 목표${life.length > 1 ? ` ${life.length}개 중 하나 (날마다 바뀌어요)` : ''} — 눌러서 목표 보기`,
          onclick: () => this.onOpenGoals(),
        },
          el('span', { class: 'life-mark', 'aria-hidden': 'true' }, '🧭'),
          el('span', { class: 'life-text' }, el('span', { class: 'sr-only' }, '인생 목표: '), lifeGoal.title),
        )
      : null;
    const lead = quote || lifeLine
      ? el('div', { class: 'strip-lead' }, quote, lifeLine)
      : null;

    const chips = [];

    // 오늘 비 소식
    const rain = rainAlert();
    if (rain) {
      chips.push(el('button', {
        type: 'button', role: 'listitem', class: 'dday-chip is-rain',
        title: `오늘 ${rain.hour}시쯤 비 올 확률 ${rain.prob}% (서울, Open-Meteo) — 눌러서 오늘 보기`,
        onclick: () => this.onOpenDate(todayStr()),
      },
        el('span', { 'aria-hidden': 'true' }, '☂'),
        el('span', { class: 'dday-left' }, rain.now ? '지금' : `${rain.hour}시쯤`),
        el('span', { class: 'dday-title' }, `비 ${rain.prob}%`),
      ));
    }

    // 올해: 진행률 + 올해 목표 하나
    if (year && (year.total > 0 || year.nudge)) {
      const goal = pickToday(year.goals);
      const label = [
        `${year.year}년이 ${year.percent}% 지났어요 (남은 ${year.days_left}일).`,
        year.total ? `올해 목표 ${year.total}개 중 ${year.done}개 이룸.` : '',
      ].join(' ');
      chips.push(el('button', {
        type: 'button', role: 'listitem', class: 'dday-chip is-year', title: `${label} 눌러서 목표 보기`,
        onclick: () => (goal ? this.onOpenGoal(goal.id) : this.onOpenGoals()),
      },
        el('span', { class: 'year-name' }, String(year.year)),
        el('span', { class: 'year-bar', 'aria-hidden': 'true' }, el('span', { style: { width: `${year.percent}%` } })),
        el('span', { class: 'dday-left' }, `${year.percent}%`),
        goal
          ? el('span', { class: 'dday-title year-goal' }, goal.routine ? `${goal.routine.emoji} ` : '', goal.title)
          : el('span', { class: 'dday-title year-goal' },
              year.nudge ? `${year.year} 목표 세우기` : `목표 ${year.total}개 모두 이룸 🎉`),
        goal && goal.measure !== 'check' ? el('span', { class: 'year-num' }, goalProgressText(goal)) : null,
      ));
    }

    for (const d of ddays) {
      const goal = d.kind === 'goal';
      chips.push(el('button', {
        type: 'button',
        role: 'listitem',
        class: ['dday-chip', goal ? 'is-goal' : '', d.days_left === 0 ? 'is-today' : ''].join(' ').trim(),
        style: goal ? {} : { '--cat': d.color },
        title: goal ? `목표 · 기한 ${formatShort(d.date)} — 눌러서 기록지에서 보기` : `${formatShort(d.date)} — 눌러서 그 날짜 보기`,
        onclick: () => (goal ? this.onOpenGoal(d.id) : this.onOpenDate(d.date)),
      },
        goal ? el('span', { class: 'dday-goal', 'aria-label': '목표' }, '🎯') : null,
        el('span', { class: 'dday-left' }, ddayLabel(d.days_left)),
        el('span', { class: 'dday-title' }, d.title),
      ));
    }

    const list = chips.length
      ? el('div', { class: 'dday-list', role: 'list', 'aria-label': '올해 목표와 다가오는 D-day' }, chips)
      : null;

    this.root.replaceChildren(...[lead, list].filter(Boolean));
    this.root.hidden = !lead && !list;
    this.root.classList.toggle('has-quote', Boolean(lead));
  }
}
