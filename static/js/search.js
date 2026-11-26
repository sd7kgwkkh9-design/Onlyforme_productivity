// 검색 (0.14.0) — 상단 🔍 또는 키보드 /
//
// 일정·할 일·일기·노트·나·살 것(0.14.2)·목표·프로젝트·시간표 칸·루틴 기록 메모·기념일에서 한 번에 찾는다 (서버는 search.py).
// 띄어 쓴 낱말은 모두 들어 있어야 찾는다. 위아래 화살표로 고르고 Enter로 연다. Esc로 닫는다.
// 지난 검색어는 남기지 않는다 (공용 컴퓨터에서 쓰는 경우를 생각해서).

import { api } from './api.js';
import { WEEKDAYS, el, formatShort, formatTimeRange, icon, todayStr } from './utils.js';

const SEARCH_ICON = 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4.2-4.2';
let dialog = null;
let hooks = {};

/**
 * @param {object} h  고른 결과를 여는 방법 (main.js가 넘겨준다)
 *   onOpenDate(date), onOpenNotes(opts), onOpenDiary(date), onOpenBlock(id), onOpenAnnivs()
 */
export function openSearch(h) {
  hooks = h;
  if (!dialog) build();
  const input = dialog.querySelector('.search-input');
  if (!dialog.open) dialog.showModal();
  input.select();
  input.focus();
}

function build() {
  dialog = el('dialog', { class: 'search', 'aria-label': '검색' });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  const input = el('input', {
    // type=search는 Esc를 누르면 글자만 지우고 창이 안 닫혀서(크롬) text + role=searchbox
    type: 'text', role: 'searchbox', inputmode: 'search', class: 'search-input', placeholder: '일정, 할 일, 일기, 노트, 목표, 프로젝트, 강의실…', 'aria-label': '검색어',
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search',
  });
  const results = el('div', { class: 'search-results', role: 'listbox', 'aria-label': '검색 결과' });
  dialog.append(
    el('div', { class: 'search-bar' }, icon(SEARCH_ICON), input,
      el('button', { type: 'button', class: 'icon-btn search-close', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    results);
  document.body.append(dialog);

  let timer = null;
  let token = 0;
  let active = -1;
  const rows = () => [...results.querySelectorAll('.search-row')];
  const setActive = (i) => {
    const list = rows();
    if (!list.length) return;
    active = (i + list.length) % list.length;
    list.forEach((r, n) => r.setAttribute('aria-selected', String(n === active)));
    list[active].scrollIntoView({ block: 'nearest' });
  };

  const run = async () => {
    const q = input.value.trim();
    const mine = ++token;
    if (!q) { results.replaceChildren(hint()); active = -1; return; }
    results.classList.add('is-busy');
    let data;
    try { data = await api.search(q, todayStr()); } catch (e) {
      if (mine === token) results.replaceChildren(el('p', { class: 'search-empty' }, e.message));
      return;
    } finally { if (mine === token) results.classList.remove('is-busy'); }
    if (mine !== token) return;
    draw(results, data);
    active = -1;
    if (rows().length) setActive(0);
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      clearTimeout(timer);
      const row = rows()[active];
      if (row) row.click(); else run();
    }
  });
  results.replaceChildren(hint());
}

function hint() {
  return el('div', { class: 'search-hint' },
    el('p', {}, '일정·할 일·일기·노트·나·목표·살 것·프로젝트·시간표·루틴 기록 메모·기념일에서 한 번에 찾아요.'),
    el('p', {}, '띄어 쓴 낱말은 모두 들어 있는 것만 · ↑↓로 고르고 Enter로 열기 · 단축키 ', el('span', { class: 'kbd' }, '/')));
}

// 찾은 낱말에 표시 (글자는 그대로 글자로만 넣는다 — HTML로 해석하지 않는다)
function marked(text, terms) {
  if (!text) return [];
  const low = text.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let best = -1;
    let len = 0;
    for (const t of terms) {
      const at = low.indexOf(t.toLowerCase(), i);
      if (at >= 0 && (best < 0 || at < best)) { best = at; len = t.length; }
    }
    if (best < 0) { parts.push(text.slice(i)); break; }
    if (best > i) parts.push(text.slice(i, best));
    parts.push(el('mark', {}, text.slice(best, best + len)));
    i = best + len;
  }
  return parts;
}

function draw(box, data) {
  const terms = data.terms || [];
  if (!data.groups.length) {
    box.replaceChildren(el('p', { class: 'search-empty' }, `'${data.q}'와(과) 맞는 게 없어요.`));
    return;
  }
  const close = () => dialog.close();
  const row = ({ lead, title, sub, snippet, done = false, onOpen }) => el('button', {
    type: 'button', class: `search-row${done ? ' is-done' : ''}`, role: 'option', 'aria-selected': 'false',
    onclick: () => { close(); onOpen(); },
  },
    el('span', { class: 'search-lead', 'aria-hidden': 'true' }, lead),
    el('span', { class: 'search-main' },
      el('span', { class: 'search-title' }, ...marked(title, terms)),
      sub ? el('span', { class: 'search-sub' }, sub) : null,
      snippet ? el('span', { class: 'search-snippet' }, ...marked(snippet, terms)) : null));
  const dot = (color) => el('span', { class: 'search-dot', style: { '--cat': color || 'var(--faint)' } });

  const render = {
    event: (r) => row({
      lead: dot(r.color), title: r.title,
      sub: [formatShort(r.date), r.start_time ? formatTimeRange(r.start_time, null) : '', r.date_count > 1 ? `${r.date_count}개 날짜` : '', r.upcoming ? '' : '지난 일정'].filter(Boolean).join(' · '),
      snippet: r.snippet, onOpen: () => hooks.onOpenDate?.(r.date),
    }),
    todo: (r) => row({ lead: r.done ? '✓' : r.urgent ? '⚡' : '○', title: r.title, sub: r.done ? '끝낸 일' : '나중에', snippet: r.snippet, done: r.done, onOpen: () => hooks.onOpenNotes?.({ tab: 'todo' }) }),
    diary: (r) => row({ lead: r.mood || '📔', title: `${formatShort(r.date)} 일기`, snippet: r.snippet, onOpen: () => hooks.onOpenDiary?.(r.date) }),
    note: (r) => row({ lead: '📝', title: r.title || '(제목 없음)', snippet: r.snippet, onOpen: () => hooks.onOpenNotes?.({ noteId: r.id }) }),
    goal: (r) => row({ lead: '🎯', title: r.title, sub: [r.sub, r.due ? `${formatShort(r.due)}까지` : '', r.done ? '이룸' : ''].filter(Boolean).join(' · '), snippet: r.snippet, done: r.done, onOpen: () => hooks.onOpenNotes?.({ goalId: r.id }) }),
    project: (r) => row({
      lead: '📁', title: r.title, sub: [r.period || [r.start_date, r.end_date].filter(Boolean).map(formatShort).join(' ~ '), { paused: '잠시 멈춤', done: '끝남' }[r.status] || ''].filter(Boolean).join(' · '),
      snippet: r.snippet, done: r.status === 'done', onOpen: () => hooks.onOpenNotes?.({ projectId: r.id }),
    }),
    class: (r) => row({
      lead: dot(r.color), title: r.title,
      sub: [`${WEEKDAYS[r.weekday]} ${formatTimeRange(r.start_time, r.end_time)}`, r.place, r.t_name].filter(Boolean).join(' · '),
      onOpen: () => hooks.onOpenBlock?.(r.id),
    }),
    log: (r) => row({ lead: r.title.split(' ')[0], title: `${r.title.split(' ').slice(1).join(' ')} · ${formatShort(r.date)}`, snippet: r.snippet, onOpen: () => hooks.onOpenDate?.(r.date) }),
    about: (r) => row({ lead: '🙋', title: r.title, sub: '나', snippet: r.snippet, onOpen: () => hooks.onOpenNotes?.({ tab: 'me' }) }),
    wish: (r) => row({ lead: r.starred ? '⭐' : '🛍️', title: r.title, sub: ['살 것', r.price != null ? `${r.price.toLocaleString('ko-KR')}원` : '', r.when].filter(Boolean).join(' · '), onOpen: () => hooks.onOpenNotes?.({ tab: 'buy' }) }),
    anniv: (r) => row({ lead: r.title.split(' ')[0], title: r.title.split(' ').slice(1).join(' '), sub: '기념일', onOpen: () => hooks.onOpenAnnivs?.() }),
    repeat: (r) => row({ lead: r.title.split(' ')[0], title: r.title.split(' ').slice(1).join(' '), sub: r.sub, onOpen: () => hooks.onOpenRepeats?.(r.id) }),   // 0.15.3
  };

  box.replaceChildren(
    el('p', { class: 'search-count', role: 'status' }, `${data.total}개 찾음`),
    ...data.groups.map((g) => el('section', { class: 'search-group' },
      el('h3', { class: 'search-group-title' }, g.label, el('small', {}, ` ${g.results.length + g.more}`)),
      ...g.results.map((r) => render[g.kind](r)),
      g.more ? el('p', { class: 'search-more' }, `그 밖에 ${g.more}개 더 — 낱말을 더 붙여 좁혀 보세요`) : null)),
  );
}
