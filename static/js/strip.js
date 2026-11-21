// 달력 위 띠 (7차, 0.11.0에서 인생·올해 목표와 비 소식을 더함)
//
//   [ 메인 메모의 배너 글귀 ]                 [☂ 18시쯤 비 70%] [2026 ▓▓▓▓░ 87% · 🏃 운동 63/100] [D-2 레포트] [🎯 D-52 풀업 15개]
//   [ 🧭 건강한 몸 만들기 ]  ← 인생 목표 (날마다 하나씩 돌아가며)
//
// - 글귀를 누르면 메모장(메인 메모)가 열린다. 인생 목표를 누르면 메모장의 목표 탭이 열린다.
// - '올해' 칩: 올해가 얼마나 지났는지 + 올해 목표 하나(날마다 돌아가며)와 그 진행도. 누르면 그 목표가 열린다.
// - D-day 칩을 누르면 그 날짜가 열린다. 🎯 목표 칩(0.9.0)을 누르면 메모장의 그 목표가 열린다.
// - 오늘 비 소식(강수확률 50% 이상인 시간)이 있으면 ☂ 칩으로 알려 준다 (weather.js).
// - 아무것도 없으면 띠 전체를 숨긴다.
// - 0.12.1: 마지막으로 받은 띠 내용을 이 기기에 기억해 두었다가, 앱을 열면 서버 응답을 기다리지 않고 먼저 그린다.
//   (예전에는 응답이 온 뒤에 띠가 생기면서 달력이 아래로 밀렸다 → 화면이 덜컹거림) 그다음 새 내용으로 조용히 바꾼다.
//   로그아웃하면 지운다 (settings.js). 공용 PC 모드(0.13.0)에서는 기억하지 않는다.
// - 0.13.0: 둘째 줄 '오늘 챙길 것' — ⚡ 급한 할 일 · 습관(💧 3/8, 누르면 +1) · 📁 진행 중인 프로젝트.
//   기념일이 30일 안으로 다가오면 D-day 칩으로 (🎂 D-3 엄마 생신).
//   습관은 저녁 6시가 넘도록 못 채웠으면 살짝 강조한다. 자정이 지나면 0부터.

import { api } from './api.js';
import { openMenu } from './ctxmenu.js';
import { ddayLabel, el, formatShort, toast, todayStr } from './utils.js';
import { rainAlert } from './weather.js';

const EVENING_HOUR = 18;           // 이 시각이 지나도 못 채운 습관은 강조
const publicPc = () => {           // 공용 PC 모드: 이 기기에 띠 내용을 남기지 않는다 (0.13.0)
  try { return JSON.parse(document.body.dataset.lock || '{}').public === true; } catch { return false; }
};

export const STRIP_KEY = 'my-calendar:strip';

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

// D-day 강조 (0.14.2): 7일 이내는 꽉 찬 색, 14일 이내는 테두리·숫자 강조, 그보다 멀면 차분하게
const near = (days) => (days <= 7 ? 'is-near' : days <= 14 ? 'is-soon' : '');

export class TopStrip {
  /**
   * @param {HTMLElement} root  <section id="top-strip">
   * @param {object} opts
   * @param {(noteId: number) => void} opts.onOpenNote
   * @param {(date: string) => void}   opts.onOpenDate
   * @param {(goalId: number) => void} opts.onOpenGoal
   * @param {() => void} opts.onOpenGoals   메모장의 목표 탭 열기
   * @param {(opts) => void} opts.onOpenNotes  메모장 열기 (급한 할 일 → 할 일 탭, 프로젝트 → 그 프로젝트) (0.13.0)
   * @param {() => void} opts.onTodosChanged   급한 할 일을 체크했을 때 (메모장 다시 그리기)
   * @param {() => void} opts.onManageHabits   습관 관리 창 열기
   */
  constructor(root, { onOpenNote, onOpenDate, onOpenGoal, onOpenGoals, onOpenNotes = () => {}, onTodosChanged = () => {}, onManageHabits = () => {} }) {
    this.root = root;
    this.onOpenNote = onOpenNote;
    this.onOpenDate = onOpenDate;
    this.onOpenGoal = onOpenGoal;
    this.onOpenGoals = onOpenGoals;
    this.onOpenNotes = onOpenNotes;
    this.onTodosChanged = onTodosChanged;
    this.onManageHabits = onManageHabits;
    this.data = null; // 마지막으로 받은 /api/overview (날씨만 바뀌었을 때 다시 그리려고)
    this.saving = 0;  // 습관을 누르는 중 (그사이 다시 받아 온 옛 내용으로 덮지 않게)
    // 저녁이 되면 못 채운 습관을 강조하도록, 정각마다 한 번 다시 그린다
    setInterval(() => { if (new Date().getMinutes() === 0) this.render(); }, 60_000);
    try {
      if (publicPc()) { localStorage.removeItem(STRIP_KEY); throw new Error('공용 PC'); }
      const saved = JSON.parse(localStorage.getItem(STRIP_KEY) || 'null');
      if (saved?.today === todayStr()) {
        this.data = saved.data;
        this.render();
      }
    } catch { /* 기억한 게 없거나 못 읽으면 서버 응답을 기다린다 */ }
  }

  async refresh() {
    const data = await api.overview(todayStr());
    if (this.saving) return this.data;
    this.data = data;
    this.render();
    if (!publicPc()) {
      try { localStorage.setItem(STRIP_KEY, JSON.stringify({ today: todayStr(), data: this.data })); } catch { /* 무시 */ }
    }
    return this.data;
  }

  render() {
    if (!this.data) return;
    const { banner, ddays, year, life = [] } = this.data;

    const quote = banner
      ? el('button', {
          type: 'button',
          class: 'banner-quote',
          title: '메모장 열기',
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

    // 올해 목표 하나 (0.14.2: '올해가 몇 % 지났는지' 막대·숫자는 뺐다 — 누구나 아는 것이라서. 0.15.0: 모양을 D-day와 다르게)
    if (year && (year.total > 0 || year.nudge)) {
      const goal = pickToday(year.goals);
      const label = year.total ? `올해 목표 ${year.total}개 중 ${year.done}개 이룸.` : `${year.year} 목표가 아직 없어요.`;
      chips.push(el('button', {
        type: 'button', role: 'listitem', class: 'dday-chip is-year', title: `${label} 눌러서 목표 보기`,
        onclick: () => (goal ? this.onOpenGoal(goal.id) : this.onOpenGoals()),
      },
        // 0.15.0: D-day(둥근 알약)와 섞여 보이지 않게, 올해 목표는 왼쪽에 포인트 색 띠가 있는 네모 카드로
        el('span', { class: 'year-name' }, el('span', { 'aria-hidden': 'true' }, '🎯 '), `${year.year} 목표`),
        goal
          ? el('span', { class: 'dday-title year-goal' }, goal.routine ? `${goal.routine.emoji} ` : '', goal.title)
          : el('span', { class: 'dday-title year-goal' },
              year.nudge ? `${year.year} 목표 세우기` : `목표 ${year.total}개 모두 이룸 🎉`),
        goal && goal.measure !== 'check' ? el('span', { class: 'year-num' }, goalProgressText(goal)) : null,
      ));
    }

    for (const d of ddays) {
      if (d.kind === 'anniv') { // 기념일 (0.13.0): 🎂 D-3 엄마 생신
        chips.push(el('button', {
          type: 'button', role: 'listitem', class: ['dday-chip is-anniv', d.days_left === 0 ? 'is-today' : '', near(d.days_left)].join(' ').trim(),
          title: `${formatShort(d.date)} — 눌러서 그 날짜 보기`, onclick: () => this.onOpenDate(d.date),
        },
          el('span', { class: 'dday-goal', 'aria-hidden': 'true' }, d.emoji || '🎉'),
          el('span', { class: 'dday-left' }, ddayLabel(d.days_left)),
          el('span', { class: 'dday-title' }, d.title)));
        continue;
      }
      const goal = d.kind === 'goal';
      chips.push(el('button', {
        type: 'button',
        role: 'listitem',
        class: ['dday-chip', goal ? 'is-goal' : '', d.days_left === 0 ? 'is-today' : '', near(d.days_left)].join(' ').trim(),
        style: goal ? {} : { '--cat': d.color },
        title: goal ? `목표 · 기한 ${formatShort(d.date)} — 눌러서 메모장에서 보기` : `${formatShort(d.date)} — 눌러서 그 날짜 보기`,
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
    const today = this.todayRow();

    this.root.replaceChildren(...[lead, list, today].filter(Boolean));
    this.root.hidden = !lead && !list && !today;
    this.root.classList.toggle('has-quote', Boolean(lead));
  }

  // ---------------------------------------------------------------- 오늘 챙길 것 (0.13.0)
  todayRow() {
    const { urgent = [], habits = [], projects = [] } = this.data;
    if (!urgent.length && !habits.length && !projects.length) return null;
    const evening = new Date().getHours() >= EVENING_HOUR;

    // 0.14.2: 체크(완료) 동그라미는 뺐다 — 할 일은 적어 두었다가 지우는 식으로 쓴다. 누르면 메모장의 할 일로
    const urgentChips = urgent.map((u) => el('span', { role: 'listitem', class: 'today-chip is-urgent' },
      el('button', {
        type: 'button', class: 'today-text', title: `⚡ 급한 할 일${u.project ? ` · ${u.project.title}` : ''} — 눌러서 메모장에서 보기`,
        onclick: () => this.onOpenNotes({ tab: 'todo' }),
      }, el('span', { 'aria-hidden': 'true' }, '⚡'), u.title)));

    const habitChips = habits.map((h) => {
      const chip = el('button', {
        type: 'button', role: 'listitem',
        class: ['today-chip is-habit', h.done ? 'is-done' : '', evening && !h.done ? 'is-due' : ''].join(' ').trim(),
        style: { '--fill': `${Math.min(100, (h.count / h.target) * 100)}%` },
        'aria-label': `${h.name} 오늘 ${h.count}/${h.target}${h.streak > 1 ? `, ${h.streak}일 연속` : ''} — 누르면 하나 더`,
        title: `${h.name} — 누르면 +1, 오른쪽 클릭하면 −1`,
        onclick: () => this.stepHabit(h, 1),
      },
        el('span', { class: 'habit-emoji', 'aria-hidden': 'true' }, h.emoji),
        el('span', { class: 'habit-name' }, h.name),   // 0.14.2: 이모지만으로는 무슨 습관인지 헷갈려서 이름도
        el('span', { class: 'habit-num' }, h.target > 1 ? `${h.count}/${h.target}` : h.done ? '✓' : ''),
        h.streak > 1 ? el('span', { class: 'habit-streak', 'aria-hidden': 'true' }, `🔥${h.streak}`) : null);
      chip.addEventListener('contextmenu', (e) => openMenu(e, [
        { label: '+1', run: () => this.stepHabit(h, 1) },
        h.count > 0 ? { label: '−1 (잘못 눌렀을 때)', run: () => this.stepHabit(h, -1) } : null,
        { label: '습관 관리…', run: () => this.onManageHabits() },
      ], { title: `${h.emoji} ${h.name} · 오늘 ${h.count}/${h.target}` }));
      return chip;
    });

    const projectChips = projects.map((p) => el('button', {
      type: 'button', role: 'listitem', class: 'today-chip is-project', style: { '--pj': p.color },
      title: `프로젝트 — 눌러서 메모장에서 보기`, onclick: () => this.onOpenNotes({ projectId: p.id }),
    },
      el('span', { class: 'pj-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'today-title' }, p.title),
      p.days_left != null ? el('span', { class: 'today-sub' }, p.days_left < 0 ? '기간 지남' : ddayLabel(p.days_left)) : p.period ? el('span', { class: 'today-sub' }, p.period) : null,
      p.progress != null ? el('span', { class: 'today-pct' }, `${p.progress}%`) : null));

    const group = (label, nodes) => (nodes.length ? [el('span', { class: 'today-label', 'aria-hidden': 'true' }, label), ...nodes] : []);
    return el('div', { class: 'today-row', role: 'list', 'aria-label': '오늘 챙길 것' },
      ...group('먼저', urgentChips), ...group('습관', habitChips), ...group('진행 중', projectChips));
  }

  // 습관 +1 / −1: 화면부터 바꾸고 저장은 뒤에서 (0.12.1의 '먼저 바꾸고 나중에 저장')
  async stepHabit(h, delta) {
    const local = this.data?.habits?.find((x) => x.id === h.id);
    if (!local || (delta < 0 && local.count <= 0)) return;
    const before = { ...local };
    local.count = Math.max(0, local.count + delta);
    local.done = local.count >= local.target;
    this.render();
    this.saving += 1;
    try {
      const saved = await api.stepHabit(h.id, todayStr(), delta);
      Object.assign(local, saved);
      this.render();
      if (delta > 0 && saved.done && !before.done) toast(`${saved.emoji} ${saved.name} 오늘 목표 달성!${saved.streak > 1 ? ` 🔥 ${saved.streak}일 연속` : ''}`);
    } catch (e) {
      Object.assign(local, before);
      this.render();
      toast(e.message, 'error');
    } finally {
      this.saving -= 1;
    }
  }
}
