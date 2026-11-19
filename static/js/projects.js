// 프로젝트 (0.13.0) — 메모장의 '프로젝트' 탭
//
// 목표(이루고 싶은 결과)나 할 일(한 번 하면 끝)과 달리, 일정 기간 동안 진행하는 일을 적어 둔다.
//   텀프로젝트 ~12/6 · 자취방 구하기 1~2월 · 겨울방학 계획
// - 기간은 정확한 날짜뿐 아니라 '1월 중', '겨울방학'처럼 대략도 된다 (서버의 periods.py가 읽는다).
// - 세부 할 일을 넣고 체크하면 진행률이 올라간다. 세부 할 일은 이 프로젝트 안에서만 보인다 (할 일 탭에는 안 섞임).
// - 일정을 이 프로젝트에 묶으면(일정 입력 창의 '프로젝트', 빠른 입력의 @이름) 다음 일정이 보인다.
// - [목록 | 타임라인]: 타임라인은 몇 월에 무엇이 겹치는지 막대로 보여 준다.
// - 진행 중인 프로젝트는 첫 화면 '오늘 챙길 것' 줄에도 보인다 (strip.js).

import { api } from './api.js';
import { openMenu } from './ctxmenu.js';
import { addDays, ask, daysBetween, ddayLabel, el, formatShort, formatTimeRange, icon, parseDateStr, toast, todayStr } from './utils.js';

const STATUS = [['active', '진행 중'], ['paused', '잠시 멈춤'], ['done', '끝남']];
const STATUS_NAME = Object.fromEntries(STATUS);
const COLORS = ['#7C5CD6', '#3D6FD9', '#2BA5B5', '#3FA66B', '#D9A514', '#F08C2E', '#E5534B', '#D45A9A'];
const MODE_KEY = 'my-calendar:project-mode';

// ---------------------------------------------------------------- 기간 글자
export function periodText(p) {
  if (p.period) return p.period;
  if (p.start_date && p.end_date) {
    return p.start_date === todayStr() || p.start_date === p.created_at?.slice(0, 10)
      ? `~${formatShort(p.end_date)}`
      : `${formatShort(p.start_date)}~${formatShort(p.end_date)}`;
  }
  if (p.end_date) return `~${formatShort(p.end_date)}`;
  if (p.start_date) return `${formatShort(p.start_date)}~`;
  return '기간 없음';
}

function leftText(p) {
  if (p.status === 'done') return '끝남';
  if (p.end_date == null || p.days_left == null) return '';
  if (p.start_date && p.start_date > todayStr()) return `${daysBetween(todayStr(), p.start_date)}일 뒤 시작`;
  return p.days_left < 0 ? '기간 지남' : ddayLabel(p.days_left);
}

function progressBar(p, label = true) {
  if (p.progress == null) return null;
  return el('span', { class: 'pj-progress' },
    el('span', { class: 'pj-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.progress), 'aria-label': `진행률 ${p.progress}%` },
      el('span', { style: { width: `${p.progress}%` } })),
    label ? el('span', { class: 'pj-num' }, `${p.tasks_done}/${p.tasks_total}`) : null);
}

// ---------------------------------------------------------------- 넣기 (메모장 입력칸, 빠른 입력)
export async function addProject(panel, text) {
  let title = text;
  let period = null;
  try {
    const r = await api.parse(`# ${text}`, todayStr());
    if (r.title) title = r.title;
    period = r.period;
  } catch { /* 못 읽으면 쓴 그대로 */ }
  const made = await api.createProject({
    title, start_date: period?.start ?? null, end_date: period?.end ?? null, period: period?.label ?? '',
  }, todayStr());
  await panel.reload();
  panel.onStripChanged();
  toast(`프로젝트를 만들었어요 · ${periodText(made)}`, 'info', { action: { label: '열기', run: () => showProject(panel, made.id) } });
  return made;
}

// ---------------------------------------------------------------- '전체' 탭의 한 묶음
export function projectRowsForAll(panel, section) {
  const all = panel.data.projects || [];
  if (!all.length) return null;
  const active = all.filter((p) => p.status === 'active');
  return section('project', active.length,
    active.length ? el('ul', { class: 'pj-list compact' }, active.slice(0, 4).map((p) => projectRow(panel, p))) : null,
    '진행 중인 프로젝트가 없어요.');
}

// ---------------------------------------------------------------- 목록 / 타임라인
export function renderProjects(panel) {
  const all = panel.data.projects || [];
  let mode = panel.projectMode;
  try { mode = localStorage.getItem(MODE_KEY) === 'timeline' ? 'timeline' : 'list'; } catch { /* 무시 */ }
  panel.projectMode = mode;
  if (!all.length) {
    return [el('div', { class: 'notes-empty' },
      el('p', {}, '몇 월까지 진행하는 일을 적어 두세요.'),
      el('p', { class: 'muted' }, "'텀프로젝트 ~12/6', '자취방 구하기 1~2월', '겨울방학 계획'처럼 기간도 같이 쓸 수 있어요."),
    )];
  }
  const setMode = (m) => {
    panel.projectMode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* 무시 */ }
    panel.showList({ keepCapture: true });
  };
  const seg = el('div', { class: 'seg pj-mode', role: 'group', 'aria-label': '프로젝트 보기' },
    [['list', '목록'], ['timeline', '타임라인']].map(([m, label]) =>
      el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(mode === m), onclick: () => setMode(m) }, label)));
  const live = all.filter((p) => p.status !== 'done');
  const done = all.filter((p) => p.status === 'done');
  const parts = [seg];
  if (mode === 'timeline') parts.push(timeline(panel, live));
  else if (live.length) parts.push(el('ul', { class: 'pj-list' }, live.map((p) => projectRow(panel, p))));
  else parts.push(el('p', { class: 'all-empty' }, '진행 중인 프로젝트가 없어요.'));
  if (done.length) {
    const details = el('details', { class: 'done-group', open: panel.openDone.project },
      el('summary', {}, `끝난 프로젝트 ${done.length}개`),
      el('ul', { class: 'pj-list' }, done.map((p) => projectRow(panel, p))));
    details.addEventListener('toggle', () => { panel.openDone.project = details.open; });
    parts.push(details);
  }
  return parts;
}

function projectRow(panel, p) {
  const left = leftText(p);
  const li = el('li', { class: ['pj-li', `is-${p.status}`].join(' '), style: { '--pj': p.color }, dataset: { id: String(p.id) } },
    el('button', { type: 'button', class: 'pj-main', onclick: () => showProject(panel, p.id) },
      el('span', { class: 'pj-head' },
        el('span', { class: 'pj-title' }, p.title),
        left ? el('span', { class: p.days_left != null && p.days_left < 0 && p.status === 'active' ? 'pj-left is-over' : 'pj-left' }, left) : null),
      el('span', { class: 'pj-meta' },
        el('span', { class: p.period ? 'pj-period is-fuzzy' : 'pj-period' }, periodText(p)),
        p.status === 'paused' ? el('span', { class: 'pj-status' }, '잠시 멈춤') : null,
        p.next_event ? el('span', { class: 'pj-next' }, `다음: ${formatShort(p.next_event.date)} ${p.next_event.title}`) : null),
      progressBar(p),
    ),
  );
  li.addEventListener('contextmenu', (e) => openMenu(e, [
    { label: '열기', run: () => showProject(panel, p.id) },
    ...STATUS.filter(([s]) => s !== p.status).map(([s, name]) => ({ label: `${name}으로`, run: () => setStatus(panel, p, s) })),
    { label: '삭제', danger: true, run: () => removeProject(panel, p) },
  ], { title: p.title }));
  return li;
}

// 타임라인: 이번 달부터 몇 달(프로젝트가 걸친 만큼, 최대 8달)을 가로로, 프로젝트마다 막대 하나
function timeline(panel, projects) {
  const dated = projects.filter((p) => p.start_date || p.end_date);
  const undated = projects.filter((p) => !p.start_date && !p.end_date);
  const today = todayStr();
  const first = `${today.slice(0, 7)}-01`;
  const lastEnd = dated.reduce((m, p) => ((p.end_date || p.start_date) > m ? (p.end_date || p.start_date) : m), addDays(first, 95));
  const months = [];
  let cur = parseDateStr(first);
  while (months.length < 8 && toIso(cur) <= lastEnd) {   // 좁은 칸이라 8달까지
    months.push(toIso(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  const end = toIso(cur);
  const span = daysBetween(first, end);
  const pos = (d) => Math.max(0, Math.min(100, (daysBetween(first, d) / span) * 100));

  const head = el('div', { class: 'tl-months', 'aria-hidden': 'true' },
    months.map((m) => el('span', { style: { left: `${pos(m)}%`, width: `${(daysBetween(m, nextMonth(m)) / span) * 100}%` } },
      m.slice(5, 7) === '01' ? `1월’${m.slice(2, 4)}` : `${Number(m.slice(5, 7))}월`)));
  const rows = dated.map((p) => {
    const s = p.start_date && p.start_date > first ? p.start_date : first;
    const e = addDays(p.end_date || end, 1);
    const left = pos(s);
    const width = Math.max(1.5, pos(e) - left);
    // 이름은 막대 위에 따로 (좁은 칸에서도 잘리지 않게), 막대 왼쪽 끝에 맞추되 오른쪽으로 넘치면 당겨 온다
    return el('li', { class: 'tl-row', style: { '--pj': p.color } },
      el('button', {
        type: 'button', class: 'tl-name', style: { left: `${Math.min(left, 60)}%` },
        onclick: () => showProject(panel, p.id),
      }, p.title, el('span', { class: 'tl-name-sub' }, ` ${periodText(p)}${p.progress != null ? ` · ${p.progress}%` : ''}`)),
      el('button', {
        type: 'button', class: ['tl-bar', p.period ? 'is-fuzzy' : '', p.status === 'paused' ? 'is-paused' : ''].join(' ').trim(),
        style: { left: `${left}%`, width: `${width}%` },
        title: `${p.title} · ${periodText(p)}${p.progress != null ? ` · ${p.progress}%` : ''}`,
        'aria-label': `${p.title} 열기`,
        onclick: () => showProject(panel, p.id),
      },
        p.progress != null ? el('span', { class: 'tl-fill', style: { width: `${p.progress}%` } }) : null),
    );
  });
  return el('div', { class: 'tl' },
    el('div', { class: 'tl-chart' },
      head,
      el('span', { class: 'tl-today', style: { left: `${pos(today)}%` }, title: '오늘' }),
      el('ul', { class: 'tl-rows' }, rows)),
    undated.length ? el('p', { class: 'tl-undated' }, `기간 없는 프로젝트: ${undated.map((p) => p.title).join(', ')}`) : null,
    el('p', { class: 'list-hint' }, '점선 막대는 대략 정한 기간이에요. 안쪽의 진한 부분이 진행률이에요.'));
}

function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextMonth(iso) {
  const d = parseDateStr(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

// ---------------------------------------------------------------- 하나 보기 (세부 할 일·일정·메모)
export async function showProject(panel, id, { keepScroll = false } = {}) {
  panel.flush();
  const scroll = panel.bodyEl.scrollTop;
  let p;
  try { p = await api.project(id, todayStr()); } catch (e) { toast(e.message, 'error'); panel.showList(); return; }
  panel.tab = 'project';
  panel.view = 'project';
  panel.editingId = id;
  panel.titleEl.textContent = '프로젝트';
  panel.backBtn.hidden = false;
  panel.tabsEl.hidden = true;

  const save = async (fields, message = null) => {
    try {
      await api.updateProject(id, fields, todayStr());
      await panel.load();
      panel.onStripChanged();
      if (message) toast(message);
      await showProject(panel, id, { keepScroll: true });
    } catch (e) { toast(e.message, 'error'); }
  };

  const title = el('input', { type: 'text', class: 'input note-title-input pj-title-input', maxlength: '60', value: p.title, 'aria-label': '프로젝트 이름' });
  title.addEventListener('change', () => { if (title.value.trim() && title.value.trim() !== p.title) save({ title: title.value.trim() }); });

  // 기간: '~12/6', '1월 중', '겨울방학' 같은 글로 바꾼다
  const when = el('input', { type: 'text', class: 'input pj-when', maxlength: '40', placeholder: '예: ~12/6, 11/20~12/6, 1월 중, 겨울방학', 'aria-label': '기간' });
  const whenForm = el('form', { class: 'pj-when-row', novalidate: true },
    el('span', { class: p.period ? 'pj-period is-fuzzy' : 'pj-period' }, periodText(p), leftText(p) ? ` · ${leftText(p)}` : ''),
    when,
    el('button', { type: 'submit', class: 'btn sm ghost' }, '바꾸기'),
    p.start_date || p.end_date ? el('button', { type: 'button', class: 'btn sm ghost', onclick: () => save({ start_date: null, end_date: null, period: '' }, '기간을 지웠어요') }, '기간 없음') : null);
  whenForm.addEventListener('submit', (e) => { e.preventDefault(); if (when.value.trim()) save({ when: when.value.trim() }, '기간을 바꿨어요'); });

  const status = el('div', { class: 'seg pj-status-seg', role: 'group', 'aria-label': '상태' },
    STATUS.map(([s, name]) => el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(p.status === s), onclick: () => p.status !== s && save({ status: s }, s === 'done' ? `🎉 '${p.title}' 끝!` : `${name}으로 바꿨어요`) }, name)));

  const colors = el('div', { class: 'pj-colors', role: 'radiogroup', 'aria-label': '색' },
    COLORS.map((c) => el('button', {
      type: 'button', class: 'pj-color', role: 'radio', 'aria-checked': String(c === p.color), 'aria-label': c, style: { '--pj': c },
      onclick: () => c !== p.color && save({ color: c }),
    })));

  // 세부 할 일
  const taskInput = el('input', { type: 'text', class: 'input capture-input', maxlength: '100', placeholder: '세부 할 일 적고 Enter (급하면 맨 앞에 !)', 'aria-label': '세부 할 일 추가', autocomplete: 'off', enterkeyhint: 'done' });
  const taskForm = el('form', { class: 'capture', novalidate: true }, el('div', { class: 'capture-row' }, taskInput,
    el('button', { type: 'submit', class: 'icon-btn capture-add', 'aria-label': '세부 할 일 추가' }, icon('M12 5v14M5 12h14'))));
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    let text = taskInput.value.trim();
    const urgent = /^!\s*/.test(text);
    text = text.replace(/^!\s*/, '').trim();
    if (!text) return;
    taskInput.value = '';
    try {
      await api.createItem({ title: text, dates: [], project_id: id, urgent });
      if (urgent) panel.onStripChanged();
      await panel.load();
      await showProject(panel, id, { keepScroll: true });
      panel.bodyEl.querySelector('.pj-task-form .capture-input')?.focus();
    } catch (err) { toast(err.message, 'error'); taskInput.value = text; }
  });
  taskForm.classList.add('pj-task-form');
  const openTasks = p.tasks.filter((t) => !t.done);
  const doneTasks = p.tasks.filter((t) => t.done);
  const toggleTask = (t) => async () => {
    try {
      await api.setDone(t.id, !t.done);
      await panel.load();
      panel.onStripChanged();
      await showProject(panel, id, { keepScroll: true });
      if (!t.done) toast(`'${t.title}' 완료!`);
    } catch (e) { toast(e.message, 'error'); }
  };

  // 연결한 일정
  const eventRow = (ev) => el('li', { class: 'pj-ev', style: { '--cat': ev.color } },
    el('button', { type: 'button', onclick: () => panel.onOpenDate(ev.date) },
      el('span', { class: 'pj-ev-date' }, formatShort(ev.date)),
      el('span', { class: 'pj-ev-time' }, formatTimeRange(ev.start_time, ev.end_time) || ''),
      el('span', { class: 'pj-ev-title' }, ev.title)));

  const body = el('div', { class: 'note-edit pj-detail', style: { '--pj': p.color } },
    title,
    whenForm,
    el('div', { class: 'pj-row' }, status, colors),
    p.progress != null ? el('div', { class: 'pj-big-progress' }, progressBar(p), el('span', { class: 'pj-pct' }, `${p.progress}%`)) : null,
    el('section', { class: 'goal-sec' },
      el('header', { class: 'all-head' }, el('h3', {}, '세부 할 일', p.tasks_total ? el('span', { class: 'all-count' }, `${p.tasks_done}/${p.tasks_total}`) : null)),
      taskForm,
      openTasks.length ? el('ul', { class: 'todo-list' }, openTasks.map((t) => panel.todoRow(t, { onToggle: toggleTask(t) })))
        : el('p', { class: 'all-empty' }, p.tasks_total ? '세부 할 일을 다 했어요! 👏' : '이 프로젝트를 위해 할 일을 쪼개 적어 보세요.'),
      doneTasks.length ? el('details', { class: 'done-group' }, el('summary', {}, `완료 ${doneTasks.length}개`),
        el('ul', { class: 'todo-list' }, doneTasks.map((t) => panel.todoRow(t, { onToggle: toggleTask(t) })))) : null),
    el('section', { class: 'goal-sec' },
      el('header', { class: 'all-head' },
        el('h3', {}, '일정', p.event_count ? el('span', { class: 'all-count' }, String(p.event_count)) : null),
        el('button', { type: 'button', class: 'link-btn', onclick: () => panel.onAddEvent({ project_id: id, title: '' }) }, '+ 일정 추가')),
      p.upcoming.length ? el('ul', { class: 'pj-events' }, p.upcoming.slice(0, 8).map(eventRow))
        : el('p', { class: 'all-empty' }, '다가오는 일정이 없어요. 일정 입력 창의 \'프로젝트\'나 빠른 입력의 @이름으로 묶을 수 있어요.'),
      p.past_count ? el('details', { class: 'done-group' }, el('summary', {}, `지난 일정 ${p.past_count}개`),
        el('ul', { class: 'pj-events is-past' }, p.past.map(eventRow))) : null),
    memoField(p, save),
  );
  panel.bodyEl.replaceChildren(body);
  panel.setFoot(
    el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => removeProject(panel, p) }, '삭제'),
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', class: 'btn sm ghost', onclick: () => panel.showList() }, '목록으로'),
  );
  if (keepScroll) panel.bodyEl.scrollTop = scroll;
}

function memoField(p, save) {
  const memo = el('textarea', { class: 'input', rows: '3', maxlength: '2000', value: p.memo, placeholder: '왜 하는지, 어디까지 했는지 (선택)', 'aria-label': '메모' });
  memo.addEventListener('change', () => { if (memo.value !== p.memo) save({ memo: memo.value }); });
  return el('div', { class: 'field' }, el('label', { class: 'label' }, '메모'), memo);
}

async function setStatus(panel, p, status) {
  try {
    await api.updateProject(p.id, { status }, todayStr());
    await panel.reload();
    panel.onStripChanged();
    toast(status === 'done' ? `🎉 '${p.title}' 끝!` : `${STATUS_NAME[status]}으로 바꿨어요`);
  } catch (e) { toast(e.message, 'error'); }
}

async function removeProject(panel, p) {
  const choice = await ask(`'${p.title}' 프로젝트를 삭제할까요?${p.tasks_total ? ` 세부 할 일 ${p.tasks_total}개는 어떻게 할까요?` : ''} 묶어 둔 일정은 달력에 그대로 남아요.`, p.tasks_total
    ? [
        { label: '할 일은 남기기', value: 'keep', kind: 'danger-fill' },
        { label: '할 일도 지우기', value: 'delete', kind: 'danger' },
        { label: '취소', value: null, kind: 'ghost' },
      ]
    : [
        { label: '삭제', value: 'keep', kind: 'danger-fill' },
        { label: '취소', value: null, kind: 'ghost' },
      ]);
  if (!choice) return;
  try {
    await api.deleteProject(p.id, choice);
    toast(choice === 'keep' && p.tasks_total ? '삭제했어요. 세부 할 일은 할 일 탭으로 옮겼어요.' : '삭제했어요');
    await panel.load();
    panel.onStripChanged();
    panel.showList();
  } catch (e) { toast(e.message, 'error'); }
}
