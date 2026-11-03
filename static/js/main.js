// 앱 시작점: 화면 요소들을 만들고 서로 연결한다.
//
//   상단 바      ─ 이전/다음, 제목(눌러서 이동), 오늘, 주간 배치, [월간 | 이번 주], 기한 미정, 카테고리, 테마
//   월간 화면    ─ FullCalendar (오픈소스)
//   주간 화면    ─ week.js (직접 구현) + edgepager.js (끝에서 당겨 주 넘기기)
//   오른쪽 칸    ─ 넓은 화면: [날짜 일정 | 기한 미정] 탭 (sheet.js의 pane + panel.js)
//   팝업 창      ─ 좁은 화면의 날짜 일정·기한 미정, 카테고리 관리 (sheet.js의 modal)
//   빠른 이동    ─ jump.js
//   동기화       ─ sync.js (다른 기기에서 바꾼 내용을 몇 초 안에 반영)

import { api } from './api.js';
import { attachEdgePager } from './edgepager.js';
import { onSwipe, slideIn } from './gestures.js';
import { holidaysBetween } from './holidays.js';
import { initJump } from './jump.js';
import { UndatedPanel, dragState } from './panel.js';
import { Sheet, configureSheets } from './sheet.js';
import { acknowledge, startSync } from './sync.js';
import { initTheme } from './theme.js';
import { addDays, el, formatShort, formatTimeRange, icon, toDateStr, toast, todayStr } from './utils.js';
import { WeekView, startOfWeek, weekTitle } from './week.js';

const $ = (id) => document.getElementById(id);
const wrapEl = $('calendar-wrap');
const calendarEl = $('calendar');
const weekEl = $('week');
const titleEl = $('month-title');
const prevBtn = $('btn-prev');
const nextBtn = $('btn-next');
const todayBtn = $('btn-today');
const layoutBtn = $('btn-week-layout');
const monthBtn = $('btn-view-month');
const weekBtn = $('btn-view-week');
const undatedBtn = $('btn-undated');
const undatedCount = $('undated-count');

// 넓은 화면(맥, 가로로 든 아이패드)이면 오른쪽 칸을 쓴다. style.css의 같은 값과 맞춰야 한다.
const wide = window.matchMedia('(min-width: 960px)');

const state = {
  view: 'month',                       // 'month' | 'week'
  weekStart: startOfWeek(todayStr()),  // 주간 화면이 보여 주는 주의 일요일
  selected: todayStr(),                // 오른쪽 칸에 열려 있는 날짜
  paneTab: 'day',                      // 'day' | 'undated'
};

// ============================================================ 월간 화면 (FullCalendar)

// 서버에서 받은 "날짜별 일정" 한 줄 → FullCalendar 이벤트 객체
//
// 시간이 있는 일정도 FullCalendar에는 '하루짜리(allDay)'로 넘긴다.
// FullCalendar는 끝 시간이 없으면 1시간짜리로 간주해서 23:30 일정이 다음 날까지 걸쳐 그려지기 때문이다.
// 시각은 extendedProps.time으로 따로 들고 다니며 직접 표시한다.
function toEvent(o, index) {
  return {
    id: `${o.id}@${o.date}`,
    title: o.title,
    start: o.date,
    allDay: true,
    extendedProps: {
      itemId: o.id,
      date: o.date,
      time: formatTimeRange(o.start_time, o.end_time) || null, // 09:00~ / ~18:00 / 09:00~10:30
      color: o.category.color,
      order: index, // 서버가 정렬해 준 순서(올린 순서 또는 하루 창에서 바꾼 순서) 그대로
    },
  };
}

const calendar = new FullCalendar.Calendar(calendarEl, {
  locale: 'ko',
  initialView: 'dayGridMonth',
  headerToolbar: false,      // 상단 바는 직접 만든 것을 쓴다
  height: '100%',
  fixedWeekCount: false,     // 그 달에 필요한 주(4~6주)만 표시
  dayMaxEvents: true,        // 칸에 다 안 들어가면 "+n"으로 접기
  eventDisplay: 'block',
  eventOrder: 'order',

  // '5일' → '5'
  dayCellContent: (arg) => arg.dayNumberText.replace('일', ''),
  moreLinkContent: (arg) => `+${arg.num}`,
  // 오른쪽 칸에 열린 날짜 표시 (달을 넘겨도 유지)
  dayCellClassNames: (arg) => (toDateStr(arg.date) === state.selected ? ['is-selected'] : []),

  eventSources: [
    // 1) 내 일정: 보이는 기간이 바뀔 때마다 서버에서 받아 온다.
    {
      id: 'items',
      events: async (info, success, failure) => {
        try {
          const list = await api.occurrences(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
          success(list.map(toEvent));
        } catch (e) {
          failure(e);
          toast(e.message, 'error');
        }
      },
    },
    // 2) 공휴일: 칸 배경(background) 이벤트로 넣고 이름만 작게 표시
    {
      id: 'holidays',
      display: 'background',
      events: async (info, success) => {
        const list = await holidaysBetween(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
        success(list.map((h) => ({
          start: h.date,
          allDay: true,
          title: h.name,
          classNames: ['holiday-bg'],
          extendedProps: { holiday: true },
        })));
      },
    },
  ],

  // 일정 칸 모양: [시간] 제목, 왼쪽 띠는 카테고리 색
  eventContent: (arg) => {
    const { time, holiday } = arg.event.extendedProps;
    if (holiday) return { domNodes: [el('span', { class: 'holiday-name' }, arg.event.title)] };
    return {
      domNodes: [
        el('span', { class: 'ev' },
          time ? el('span', { class: 'ev-time' }, time) : null,
          el('span', { class: 'ev-title' }, arg.event.title),
        ),
      ],
    };
  },
  eventDidMount: (arg) => {
    if (arg.event.extendedProps.color) arg.el.style.setProperty('--cat', arg.event.extendedProps.color);
  },

  // 날짜 칸, 일정, "+n" 무엇을 눌러도 그 날짜가 열린다.
  dateClick: (info) => openDay(info.dateStr),
  eventClick: (info) => {
    info.jsEvent.preventDefault();
    openDay(info.event.extendedProps.date || info.event.startStr.slice(0, 10));
  },
  moreLinkClick: (info) => {
    openDay(toDateStr(info.date));
    return true; // 문자열이 아닌 값을 돌려주면 FullCalendar 기본 팝업이 뜨지 않는다
  },

  datesSet: () => updateHeader(),
});

// ============================================================ 날짜 열기 (오른쪽 칸 / 팝업)

const modalSheet = new Sheet($('sheet'), { kind: 'modal' });
const paneSheet = new Sheet($('pane-day'), {
  kind: 'pane',
  onShow: (view) => { if (view === 'day') showPaneTab('day', { render: false }); else revealPaneHost(); },
  onBackToUndated: () => showPaneTab('undated'),
});

// 날짜를 누르면: 넓은 화면은 오른쪽 칸이 그 날짜로 바뀌고, 좁은 화면은 팝업이 뜬다.
function openDay(date) {
  select(date);
  if (wide.matches) paneSheet.showDay(date);
  else modalSheet.showDay(date);
}

function select(date) {
  state.selected = date;
  calendarEl.querySelectorAll('td.fc-daygrid-day.is-selected').forEach((c) => c.classList.remove('is-selected'));
  calendarEl.querySelector(`td.fc-daygrid-day[data-date="${date}"]`)?.classList.add('is-selected');
  weekView.select(date);
}

// ============================================================ 오른쪽 칸 탭

const paneHost = $('pane-day');
const paneUndated = $('pane-undated');
const tabDay = $('tab-day');
const tabUndated = $('tab-undated');
const tabUndatedCount = $('tab-undated-count');

const panel = new UndatedPanel(paneUndated, {
  onOpenItem: (item) => paneSheet.openForm({ mode: 'edit', item, scope: 'all', ctxDate: null, returnTo: 'undated' }),
  onAdd: () => paneSheet.openForm({ mode: 'create', ctxDate: null, returnTo: 'undated' }),
});

function showPaneTab(tab, { render = true } = {}) {
  state.paneTab = tab;
  tabDay.setAttribute('aria-selected', String(tab === 'day'));
  tabUndated.setAttribute('aria-selected', String(tab === 'undated'));
  undatedBtn.setAttribute('aria-pressed', String(wide.matches && tab === 'undated'));
  paneHost.hidden = tab !== 'day';
  paneUndated.hidden = tab !== 'undated';
  if (tab === 'undated') panel.refresh().catch((e) => toast(e.message, 'error'));
  else if (render) paneSheet.showDay(state.selected);
}

// 기한 미정 탭에서 일정을 눌러 편집할 때: 탭은 '기한 미정' 그대로 두고 편집 화면만 보여 준다.
function revealPaneHost() {
  paneHost.hidden = false;
  paneUndated.hidden = true;
}

tabDay.addEventListener('click', () => showPaneTab('day'));
tabUndated.addEventListener('click', () => showPaneTab('undated'));

// 상단 '기한 미정' 버튼: 넓은 화면은 탭 전환(한 번 더 누르면 날짜 일정으로), 좁은 화면은 팝업
undatedBtn.addEventListener('click', () => {
  if (!wide.matches) modalSheet.showUndated();
  else showPaneTab(state.paneTab === 'undated' && !paneUndated.hidden ? 'day' : 'undated');
});

// 넓은 ↔ 좁은 화면으로 바뀌는 순간 (창 크기 조절, 아이패드 돌리기)
wide.addEventListener('change', () => {
  requestAnimationFrame(() => calendar.updateSize());
  if (wide.matches) showPaneTab(state.paneTab);
  undatedBtn.setAttribute('aria-pressed', String(wide.matches && state.paneTab === 'undated'));
});

async function refreshUndated() {
  const items = await panel.refresh();
  for (const badge of [undatedCount, tabUndatedCount]) {
    badge.textContent = items.length;
    badge.hidden = items.length === 0;
  }
}

// ============================================================ 주간 화면

const weekView = new WeekView(weekEl, { onDayClick: (date) => openDay(date) });
weekView.select(state.selected);

function showWeek(start, direction = 0, scrollTo = 'today') {
  state.weekStart = start;
  weekView.show(start, direction, scrollTo).catch((e) => toast(e.message, 'error'));
  updateHeader();
}

// 가로 ⇄ 세로 배치 버튼
const LAYOUT_ICON = {
  row: 'M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z',   // 세로 막대 3개 = 가로 배치
  col: 'M4 5h16v4H4zM4 10h16v4H4zM4 15h16v4H4z',     // 가로 막대 3개 = 세로 배치
};
function updateLayoutButton() {
  const now = weekView.layout;
  const next = now === 'row' ? '세로' : '가로';
  layoutBtn.replaceChildren(icon(LAYOUT_ICON[now]));
  layoutBtn.setAttribute('aria-label', `주간 배치: ${now === 'row' ? '가로' : '세로'} (누르면 ${next}로)`);
  layoutBtn.title = `${next}로 보기`;
}
layoutBtn.addEventListener('click', async () => {
  await weekView.setLayout(weekView.layout === 'row' ? 'col' : 'row');
  updateLayoutButton();
  toast(weekView.layout === 'row' ? '가로로 보기' : '세로로 보기');
});

// 가로 배치에서 끝까지 간 뒤 한 번 더 당기면 다음/지난주 (다음 주는 일요일부터, 지난주는 토요일부터 보이게)
attachEdgePager(weekEl, {
  enabled: () => state.view === 'week' && weekView.layout === 'row',
  onNext: () => showWeek(addDays(state.weekStart, 7), 1, 'start'),
  onPrev: () => showWeek(addDays(state.weekStart, -7), -1, 'end'),
  hintHost: wrapEl,
});

// ============================================================ 보기 전환과 이동

function setView(view) {
  if (view === 'week') {
    // '이번 주' 버튼은 언제 눌러도 오늘이 들어 있는 주로 간다.
    state.view = 'week';
    calendarEl.hidden = true;
    weekEl.hidden = false;
    showWeek(startOfWeek(todayStr()));
  } else {
    if (state.view === 'week') calendar.gotoDate(addDays(state.weekStart, 3)); // 보던 주가 속한 달로
    state.view = 'month';
    weekEl.hidden = true;
    calendarEl.hidden = false;
    calendar.updateSize(); // 숨겨져 있던 동안의 크기 변화를 반영
  }
  updateHeader();
}

function navigate(direction) {
  if (state.view === 'week') {
    showWeek(addDays(state.weekStart, 7 * direction), direction, direction > 0 ? 'start' : 'end');
  } else {
    if (direction > 0) calendar.next();
    else calendar.prev();
    slideIn(calendarEl.querySelector('.fc-view-harness'), direction);
  }
}

function goToday() {
  if (state.view === 'week') {
    const thisWeek = startOfWeek(todayStr());
    showWeek(thisWeek, thisWeek > state.weekStart ? 1 : -1, 'today');
  } else {
    calendar.today();
  }
}

function updateHeader() {
  const isWeek = state.view === 'week';
  let main;
  let year;
  if (isWeek) {
    ({ main, year } = weekTitle(state.weekStart));
    todayBtn.disabled = state.weekStart === startOfWeek(todayStr());
  } else {
    const d = calendar.view.currentStart;
    main = `${d.getMonth() + 1}월`;
    year = String(d.getFullYear());
    const now = new Date();
    todayBtn.disabled = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  titleEl.replaceChildren(
    el('span', { class: 'm' }, main),
    el('span', { class: 'y' }, year),
    el('span', { class: 'caret', 'aria-hidden': 'true' }, icon('M7 10l5 5 5-5')),
  );
  titleEl.setAttribute('aria-label', `${year}년 ${main} — 눌러서 ${isWeek ? '다른 주' : '다른 달'}로 이동`);
  document.title = `나의 캘린더 (${year}년 ${main})`;

  prevBtn.setAttribute('aria-label', isWeek ? '이전 주' : '이전 달');
  nextBtn.setAttribute('aria-label', isWeek ? '다음 주' : '다음 달');
  monthBtn.setAttribute('aria-pressed', String(!isWeek));
  weekBtn.setAttribute('aria-pressed', String(isWeek));
  layoutBtn.hidden = !isWeek;
  document.body.dataset.view = state.view;
}

// 제목을 눌러 원하는 달·주로
initJump({
  button: titleEl,
  menu: $('jump-menu'),
  current: () => {
    const d = calendar.view.currentStart;
    return { view: state.view, year: d.getFullYear(), month: d.getMonth(), weekStart: state.weekStart };
  },
  gotoMonth: (year, month) => {
    const target = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const cur = calendar.view.currentStart;
    const dir = target > toDateStr(cur) ? 1 : target < toDateStr(cur) ? -1 : 0;
    calendar.gotoDate(target);
    slideIn(calendarEl.querySelector('.fc-view-harness'), dir);
  },
  gotoWeekOf: (date) => {
    const start = startOfWeek(date);
    showWeek(start, start > state.weekStart ? 1 : start < state.weekStart ? -1 : 0, 'start');
    // 고른 날짜가 화면에 보이도록 (좁은 화면 가로 배치)
    requestAnimationFrame(() => weekView.scrollTo('selected'));
  },
});

// ============================================================ 끌어다 놓기 (기한 미정 → 날짜)

const DROP_SELECTOR = 'td.fc-daygrid-day[data-date], .wk-day[data-date], .wk-col[data-date]';
let dropTarget = null;

function setDropTarget(cell) {
  if (dropTarget === cell) return;
  dropTarget?.classList.remove('is-drop-target');
  dropTarget = cell;
  dropTarget?.classList.add('is-drop-target');
}

wrapEl.addEventListener('dragover', (e) => {
  if (!dragState.itemId) return; // 기한 미정 카드가 아닌 것(파일 등)은 무시
  const cell = e.target.closest(DROP_SELECTOR);
  setDropTarget(cell);
  if (cell) {
    e.preventDefault(); // "여기에 놓을 수 있음" 표시
    e.dataTransfer.dropEffect = 'move';
  }
});
wrapEl.addEventListener('dragleave', (e) => {
  if (!wrapEl.contains(e.relatedTarget)) setDropTarget(null);
});
wrapEl.addEventListener('drop', (e) => {
  const cell = e.target.closest(DROP_SELECTOR);
  const itemId = dragState.itemId;
  setDropTarget(null);
  if (!cell || !itemId) return;
  e.preventDefault();
  assignDate(itemId, cell.dataset.date);
});
document.addEventListener('dragend', () => setDropTarget(null));

async function assignDate(itemId, date) {
  try {
    const item = await api.getItem(itemId);
    await api.updateItem(itemId, {
      title: item.title,
      memo: item.memo,
      category_id: item.category.id,
      start_time: item.start_time,
      end_time: item.end_time,
      dates: [...new Set([...item.dates, date])],
      scope: 'all',
    });
    toast(`${formatShort(date)}에 넣었어요`);
    await refreshAll();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ============================================================ 새로 고침과 연결

// 보이는 화면(월간·주간·기한 미정·오른쪽 칸 목록)을 모두 새로 불러온다.
async function reloadViews() {
  calendar.refetchEvents();
  if (state.view === 'week') await weekView.refresh();
  await refreshUndated();
  paneSheet.refreshList(); // 편집 중이면 건드리지 않는다
}

// 이 기기에서 저장/삭제했을 때
async function refreshAll() {
  await acknowledge(); // 내 변경은 이미 반영하니 동기화가 한 번 더 불러오지 않게
  await reloadViews();
}

// 다른 기기에서 바뀐 것이 감지됐을 때 (sync.js)
async function onRemoteChange() {
  await reloadViews();
  modalSheet.refreshList(); // 열려 있는 팝업의 날짜 일정·기한 미정 목록도
}

configureSheets({ onDataChanged: refreshAll, loginEnabled: document.body.dataset.login === '1' });

prevBtn.addEventListener('click', () => navigate(-1));
nextBtn.addEventListener('click', () => navigate(1));
todayBtn.addEventListener('click', goToday);
monthBtn.addEventListener('click', () => setView('month'));
weekBtn.addEventListener('click', () => setView('week'));
$('btn-categories').addEventListener('click', () => modalSheet.showCategories());

// 좌우로 넘기기: 휴대폰 스와이프, 트랙패드 두 손가락 쓸기
// (가로 배치 주간 화면은 날짜를 스크롤해야 하므로 edgepager가 따로 처리)
onSwipe(wrapEl, {
  onPrev: () => navigate(-1),
  onNext: () => navigate(1),
  enabled: () => !(state.view === 'week' && weekView.layout === 'row'),
});

// 키보드 ← →
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (document.querySelector('dialog[open]') || anyMenuOpen()) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"], .pane')) return;
  if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
});

function anyMenuOpen() {
  try { return Boolean(document.querySelector('.jump-menu:popover-open, .theme-menu:popover-open')); } catch { return false; }
}

// ============================================================ 시작

initTheme();
updateLayoutButton();

calendar.render();
updateHeader();
if (wide.matches) showPaneTab('day'); // 오른쪽 칸: 오늘

refreshUndated().catch((e) => toast(e.message, 'error'));
startSync(onRemoteChange);
