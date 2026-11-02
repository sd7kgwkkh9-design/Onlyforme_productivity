// 앱 시작점: 화면 요소들을 만들고 서로 연결한다.
//
//   상단 바      ─ 이전/다음, 오늘, [월간 | 이번 주], 기한 미정, 카테고리
//   월간 화면    ─ FullCalendar (오픈소스)
//   주간 화면    ─ week.js (직접 구현)
//   편집 창      ─ sheet.js
//   기한 미정 패널 ─ panel.js (넓은 화면), 카드를 달력으로 끌어다 놓기

import { api } from './api.js';
import { onSwipe, slideIn } from './gestures.js';
import { holidaysBetween } from './holidays.js';
import { UndatedPanel, dragState } from './panel.js';
import { initSheet, openCategories, openDay, openItemForm, openNewItem, openUndated } from './sheet.js';
import { addDays, el, formatShort, toDateStr, toast, todayStr } from './utils.js';
import { WeekView, startOfWeek, weekTitle } from './week.js';

const $ = (id) => document.getElementById(id);
const wrapEl = $('calendar-wrap');
const calendarEl = $('calendar');
const weekEl = $('week');
const titleEl = $('month-title');
const prevBtn = $('btn-prev');
const nextBtn = $('btn-next');
const todayBtn = $('btn-today');
const monthBtn = $('btn-view-month');
const weekBtn = $('btn-view-week');
const undatedBtn = $('btn-undated');
const undatedCount = $('undated-count');

const state = {
  view: 'month',                       // 'month' | 'week'
  weekStart: startOfWeek(todayStr()),  // 주간 화면이 보여 주는 주의 일요일
};

// ============================================================ 월간 화면 (FullCalendar)

// 서버에서 받은 "날짜별 일정" 한 줄 → FullCalendar 이벤트 객체
//
// 시간이 있는 일정도 FullCalendar에는 '하루짜리(allDay)'로 넘긴다.
// 우리 일정은 시작 시각만 있고 끝 시각이 없는데, FullCalendar는 끝이 없으면
// 1시간짜리로 간주해서 23:30 일정이 다음 날까지 걸쳐 그려지기 때문이다.
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
      // 칸이 좁으므로 시작 시간만 (끝 시간만 있으면 '~18:00')
      time: o.start_time || (o.end_time ? `~${o.end_time}` : null),
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

  // 날짜 칸, 일정, "+n" 무엇을 눌러도 우선 그 날짜의 편집 창이 열린다.
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

// ============================================================ 주간 화면

const weekView = new WeekView(weekEl, { onDayClick: (date) => openDay(date) });

function showWeek(start, direction = 0) {
  state.weekStart = start;
  weekView.show(start, direction).catch((e) => toast(e.message, 'error'));
  updateHeader();
}

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
    showWeek(addDays(state.weekStart, 7 * direction), direction);
  } else {
    if (direction > 0) calendar.next();
    else calendar.prev();
    slideIn(calendarEl.querySelector('.fc-view-harness'), direction);
  }
}

function goToday() {
  if (state.view === 'week') {
    const thisWeek = startOfWeek(todayStr());
    showWeek(thisWeek, thisWeek > state.weekStart ? 1 : -1);
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
  titleEl.replaceChildren(el('span', { class: 'm' }, main), el('span', { class: 'y' }, year));
  document.title = `나의 캘린더 (${year}년 ${main})`;

  prevBtn.setAttribute('aria-label', isWeek ? '이전 주' : '이전 달');
  nextBtn.setAttribute('aria-label', isWeek ? '다음 주' : '다음 달');
  monthBtn.setAttribute('aria-pressed', String(!isWeek));
  weekBtn.setAttribute('aria-pressed', String(isWeek));
  document.body.dataset.view = state.view;
}

// ============================================================ 기한 미정 패널

const wideScreen = window.matchMedia('(min-width: 900px)');
const PANEL_KEY = 'my-calendar:undated-panel-open';

const panel = new UndatedPanel($('undated-panel'), {
  onOpenItem: (item) => openItemForm(item),
  onAdd: () => openNewItem(),
  onClose: () => setPanel(false),
});

function setPanel(open) {
  panel.setOpen(open);
  undatedBtn.setAttribute('aria-expanded', String(open));
  try { localStorage.setItem(PANEL_KEY, open ? '1' : '0'); } catch { /* 저장 못 해도 동작에는 문제 없음 */ }
  requestAnimationFrame(() => calendar.updateSize()); // 달력 너비가 바뀌었으므로
}

async function refreshUndated() {
  const items = await panel.refresh();
  undatedCount.textContent = items.length;
  undatedCount.hidden = items.length === 0;
}

// 넓은 화면: 패널 열고 닫기 / 좁은 화면: 편집 창에 목록 표시
undatedBtn.addEventListener('click', () => {
  if (wideScreen.matches) setPanel(!panel.isOpen);
  else openUndated();
});
wideScreen.addEventListener('change', () => calendar.updateSize());

// ============================================================ 끌어다 놓기 (패널 → 날짜)

const DROP_SELECTOR = 'td.fc-daygrid-day[data-date], .wk-day[data-date]';
let dropTarget = null;

function setDropTarget(cell) {
  if (dropTarget === cell) return;
  dropTarget?.classList.remove('is-drop-target');
  dropTarget = cell;
  dropTarget?.classList.add('is-drop-target');
}

wrapEl.addEventListener('dragover', (e) => {
  if (!dragState.itemId) return; // 패널 카드가 아닌 것(파일 등)은 무시
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

// 무언가 저장/삭제되면 보이는 화면을 모두 새로 고친다.
async function refreshAll() {
  calendar.refetchEvents();
  if (state.view === 'week') await weekView.refresh();
  await refreshUndated();
}

initSheet({ onDataChanged: refreshAll });

prevBtn.addEventListener('click', () => navigate(-1));
nextBtn.addEventListener('click', () => navigate(1));
todayBtn.addEventListener('click', goToday);
monthBtn.addEventListener('click', () => setView('month'));
weekBtn.addEventListener('click', () => setView('week'));
$('btn-categories').addEventListener('click', () => openCategories());

// 좌우로 넘기기: 휴대폰 스와이프, 트랙패드 두 손가락 쓸기
onSwipe(wrapEl, { onPrev: () => navigate(-1), onNext: () => navigate(1) });

// 키보드 ← →
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
});

// ============================================================ 시작

calendar.render();
updateHeader();

let panelPref = false;
try { panelPref = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* 무시 */ }
if (wideScreen.matches && panelPref) setPanel(true);

refreshUndated().catch((e) => toast(e.message, 'error'));
