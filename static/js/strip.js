// 달력 위 띠 (7차)
//
//   [ 메인 메모의 배너 글귀 ]            [D-2 레포트] [D-36 기말고사] [🎯 D-52 풀업 15개]
//
// - 글귀를 누르면 기록지(메인 메모)가 열린다.
// - D-day 칩을 누르면 그 날짜가 열린다. 🎯 목표 칩(0.9.0)을 누르면 기록지의 그 목표가 열린다.
// - 글귀도 D-day도 없으면 띠 전체를 숨긴다.

import { api } from './api.js';
import { ddayLabel, el, formatShort, todayStr } from './utils.js';

export class TopStrip {
  /**
   * @param {HTMLElement} root  <section id="top-strip">
   * @param {object} opts
   * @param {(noteId: number) => void} opts.onOpenNote
   * @param {(date: string) => void}   opts.onOpenDate
   * @param {(goalId: number) => void} opts.onOpenGoal
   */
  constructor(root, { onOpenNote, onOpenDate, onOpenGoal }) {
    this.root = root;
    this.onOpenNote = onOpenNote;
    this.onOpenDate = onOpenDate;
    this.onOpenGoal = onOpenGoal;
  }

  async refresh() {
    const { banner, ddays } = await api.overview(todayStr());

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

    const list = ddays.length
      ? el('div', { class: 'dday-list', role: 'list', 'aria-label': '다가오는 D-day' },
          ddays.map((d) => {
            const goal = d.kind === 'goal';
            return el('button', {
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
            );
          }))
      : null;

    this.root.replaceChildren(...[quote, list].filter(Boolean));
    this.root.hidden = !quote && !list;
    this.root.classList.toggle('has-quote', Boolean(quote));
  }
}
