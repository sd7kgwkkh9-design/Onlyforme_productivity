// 앱 시작점: 화면 요소들을 만들고 서로 연결한다.
//
//   상단 바      ─ 기록지, 이전/다음, 제목(눌러서 이동), 오늘, 돌아보기, 주간 배치, 빠른 입력, [월간 | 이번 주], 카테고리, ⚙ 설정
//   월간 화면    ─ FullCalendar (오픈소스)
//   주간 화면    ─ week.js (직접 구현) + edgepager.js (끝에서 당겨 주 넘기기)
//   오른쪽 칸    ─ 넓은 화면: 고른 날짜의 일정 (sheet.js의 pane)
//   팝업 창      ─ 좁은 화면의 날짜 일정, 카테고리 관리, 돌아보기 (sheet.js의 modal)
//   빠른 이동    ─ jump.js
//   ⚙ 설정       ─ settings.js (화면 테마, 글꼴, 로그아웃, 버전)
//   동기화       ─ sync.js (다른 기기에서 바꾼 내용을 몇 초 안에 반영)
//   생산성 도구
//     기록지     ─ notes.js (왼쪽 칸/창: 메모·목표·할 일)   달력 위 띠 ─ strip.js (배너 글귀 + D-day + 목표)
//     빠른 입력  ─ quick.js (+ quickadd.py, 반복 일정)       돌아보기   ─ stats.js
//     루틴       ─ routines.js (일정과 따로 저장되는 루틴 기록)
//     끌어서 옮기기 / Option 누르고 끌어서 복사 / 오른쪽 클릭 메뉴 ─ 아래 5번 (ctxmenu.js, datepop.js)
//
// 안전 장치: 달력을 가장 먼저 그리고, 나머지 기능은 하나씩 safely()로 감싸서 켠다.
// 어느 한 기능에 문제가 생겨도(예: 서버를 새 버전으로 바꿨는데 화면 파일 일부가 예전 것) 달력은 계속 보인다.

import { api } from './api.js';
import { openMenu } from './ctxmenu.js';
import { pickDate } from './datepop.js';
import { attachEdgePager } from './edgepager.js';
import { onSwipe, slideIn } from './gestures.js';
import { holidaysBetween } from './holidays.js';
import { initJump } from './jump.js';
import { NotesPanel, dragState } from './notes.js';
import { QuickAdd } from './quick.js';
import { initSettings } from './settings.js';
import { Sheet, configureSheets } from './sheet.js';
import { statsView } from './stats.js';
import { TopStrip } from './strip.js';
import { startSync } from './sync.js';
import { addDays, ask, el, formatShort, formatTimeRange, icon, toDateStr, toast, todayStr } from './utils.js';
import { WeekView, startOfWeek, weekTitle } from './week.js';

// ============================================================ 안전 장치

const failed = [];

// fn을 실행하다 오류가 나면 그 기능만 건너뛰고 계속한다. 오류는 콘솔과 화면 아래 알림으로 알린다.
function safely(label, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(`[${label}]`, e);
    failed.push(label);
    setTimeout(() => toast(`일부 기능(${failed.join(', ')})을 불러오지 못했어요. 새로고침해 보세요.`, 'error'), 300);
    return null;
  }
}

const on = (node, type, fn) => node?.addEventListener(type, fn);

// ============================================================ 화면 요소

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
const paneHost = $('pane-day');
const APP_NAME = document.body.dataset.appName || '오직 나를 위한 캘린더';
const COPY_PLACEHOLDER = 'copy-placeholder'; // Option 끌기로 복사하는 동안 놓은 칸에 잠깐 보여 주는 일정의 id

// 넓은 화면(맥, 가로로 든 아이패드)이면 오른쪽 칸을 쓴다. style.css의 같은 값과 맞춰야 한다.
const wide = window.matchMedia('(min-width: 960px)');
// 휴대폰: 상단 바 자리가 좁아서 주간 제목을 '11.1–7'처럼 줄여 쓴다
const phone = window.matchMedia('(max-width: 640px)');

const state = {
  view: 'month',                       // 'month' | 'week'
  weekStart: startOfWeek(todayStr()),  // 주간 화면이 보여 주는 주의 일요일
  selected: todayStr(),                // 오른쪽 칸에 열려 있는 날짜
  dragging: false,                     // 월간 화면에서 일정을 끌고 있는 중 (좌우 넘기기와 헷갈리지 않게)
};

// 아래 기능들은 safely()로 만들기 때문에, 문제가 생기면 null로 남는다. 쓰는 곳에서는 ?.로 확인한다.
let modalSheet = null;
let paneSheet = null;
let weekView = null;
let notes = null;
let strip = null;
let quick = null;

// ============================================================ 1. 월간 화면 (FullCalendar) — 가장 먼저

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
    classNames: o.dday ? ['is-dday'] : [],
    extendedProps: {
      itemId: o.id,
      date: o.date,
      time: formatTimeRange(o.start_time, o.end_time) || null, // 09:00~ / ~18:00 / 09:00~10:30
      color: o.category.color,
      order: index, // 서버가 정렬해 준 순서(올린 순서 또는 하루 창에서 바꾼 순서) 그대로
      occ: o,       // 오른쪽 클릭 메뉴에서 쓰는 원래 정보 (몇 개 날짜에 들어 있는지 등)
    },
  };
}

// 루틴 기록 → FullCalendar 이벤트. 같은 날의 일정들 아래에 '🏃 운동'처럼 보인다.
function toRoutineEvent(log, index) {
  return {
    id: `r${log.id}`,
    title: `${log.routine.emoji} ${log.routine.name}`,
    start: log.date,
    allDay: true,
    classNames: ['is-routine'],
    extendedProps: {
      kind: 'routine',
      log,
      date: log.date,
      order: 100000 + index, // 일정(0, 1, 2 …)보다 항상 뒤
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

  // 일정을 다른 날짜로 끌어서 옮기기 (맥은 Option, 윈도우는 Alt/Ctrl을 누르고 있으면 복사). 휴대폰은 꾹 누른 뒤 끌기.
  editable: true,
  eventDurationEditable: false,
  eventLongPressDelay: 350,
  eventDragStart: (info) => {
    state.dragging = true;
    document.body.classList.add('is-dragging-event');
    copyDrag.start(info);
  },
  eventDragStop: (info) => {
    document.body.classList.remove('is-dragging-event');
    copyDrag.stop(info); // eventDrop보다 먼저 불린다 → 이 순간 복사인지 정해 둔다
    setTimeout(() => { state.dragging = false; }, 50); // 손을 뗄 때의 스와이프 판정이 끝난 뒤
  },
  eventDrop: (info) => dropEvent(info),

  // '5일' → '5'
  dayCellContent: (arg) => arg.dayNumberText.replace('일', ''),
  moreLinkContent: (arg) => `+${arg.num}`,
  // 오른쪽 칸에 열린 날짜 표시 (달을 넘겨도 유지)
  dayCellClassNames: (arg) => (toDateStr(arg.date) === state.selected ? ['is-selected'] : []),

  eventSources: [
    // 1) 내 일정 + 루틴 기록: 보이는 기간이 바뀔 때마다 서버에서 한 번에 받아 온다 (/api/calendar).
    //    루틴 기록은 칸에서 일정 아래에 보인다.
    {
      id: 'calendar',
      events: async (info, success, failure) => {
        try {
          const { items, logs } = await api.calendar(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
          success([...items.map(toEvent), ...logs.map(toRoutineEvent)]);
          copyDrag.clearPlaceholders(); // 복사하는 동안 잠깐 보여 준 자리 표시는 진짜 복사본으로 바뀐다
        } catch (e) {
          failure(e);
          toast(e.message, 'error');
        }
      },
    },
    // 2) 공휴일: 칸 배경(background) 이벤트로 넣고 이름만 작게 표시 (실패해도 일정은 보이게)
    {
      id: 'holidays',
      display: 'background',
      editable: false,
      events: async (info, success) => {
        try {
          const list = await holidaysBetween(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
          success(list.map((h) => ({
            start: h.date,
            allDay: true,
            title: h.name,
            classNames: ['holiday-bg'],
            extendedProps: { holiday: true },
          })));
        } catch {
          success([]);
        }
      },
    },
  ],

  // 일정 칸 모양: [시간] 제목, 왼쪽 띠는 카테고리 색
  eventContent: (arg) => {
    const { time, holiday, kind } = arg.event.extendedProps;
    if (holiday) return { domNodes: [el('span', { class: 'holiday-name' }, arg.event.title)] };
    if (kind === 'routine') return { domNodes: [el('span', { class: 'ev ev-routine' }, el('span', { class: 'ev-title' }, arg.event.title))] };
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
    const { color, holiday, kind, occ, log } = arg.event.extendedProps;
    if (color) arg.el.style.setProperty('--cat', color);
    if (holiday || arg.event.id === COPY_PLACEHOLDER) return;
    // 두 손가락 클릭(오른쪽 클릭) → 수정 / 다른 날로 옮기기 / 다른 날로 복사 / 삭제
    arg.el.addEventListener('contextmenu', (e) => (kind === 'routine' ? logMenu(e, log) : itemMenu(e, occ)));
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

  datesSet: () => safely('상단 제목', updateHeader),
});

calendar.render();
window.__appReady = true; // 달력이 그려졌으면 '화면을 불러오지 못했어요' 안내는 띄우지 않는다 (index.html)
safely('상단 제목', updateHeader);
phone.addEventListener('change', () => safely('상단 제목', updateHeader));

// ============================================================ 2. 날짜 열기 (오른쪽 칸 / 팝업)

// 날짜를 누르면: 넓은 화면은 오른쪽 칸이 그 날짜로 바뀌고, 좁은 화면은 팝업이 뜬다.
function openDay(date) {
  select(date);
  if (wide.matches && paneSheet) paneSheet.showDay(date);
  else modalSheet?.showDay(date);
}

function select(date) {
  state.selected = date;
  calendarEl.querySelectorAll('td.fc-daygrid-day.is-selected').forEach((c) => c.classList.remove('is-selected'));
  calendarEl.querySelector(`td.fc-daygrid-day[data-date="${date}"]`)?.classList.add('is-selected');
  weekView?.select(date);
}

safely('편집 창', () => {
  modalSheet = new Sheet($('sheet'), { kind: 'modal' });
});

safely('오른쪽 칸', () => {
  paneSheet = new Sheet(paneHost, { kind: 'pane' });
});

// 지금 화면에서 일정 입력 창을 띄울 곳: 넓은 화면은 오른쪽 칸, 좁은 화면은 팝업
const editSheet = () => (wide.matches && paneSheet ? paneSheet : modalSheet);

// 넓은 ↔ 좁은 화면으로 바뀌는 순간 (창 크기 조절, 아이패드 돌리기)
wide.addEventListener('change', () => {
  requestAnimationFrame(() => calendar.updateSize());
  if (wide.matches) paneSheet?.showDay(state.selected);
});

// ============================================================ 3. 주간 화면

safely('주간 화면', () => {
  weekView = new WeekView(weekEl, {
    onDayClick: (date) => openDay(date),
    onItemMenu: (e, occ) => itemMenu(e, occ),
    onLogMenu: (e, log) => logMenu(e, log),
  });
  weekView.select(state.selected);
});

function showWeek(start, direction = 0, scrollTo = 'today') {
  if (!weekView) return;
  state.weekStart = start;
  weekView.show(start, direction, scrollTo).catch((e) => toast(e.message, 'error'));
  safely('상단 제목', updateHeader);
}

// 가로 ⇄ 세로 배치 버튼
const LAYOUT_ICON = {
  row: 'M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z',   // 세로 막대 3개 = 가로 배치
  col: 'M4 5h16v4H4zM4 10h16v4H4zM4 15h16v4H4z',     // 가로 막대 3개 = 세로 배치
};
function updateLayoutButton() {
  if (!weekView || !layoutBtn) return;
  const now = weekView.layout;
  const next = now === 'row' ? '세로' : '가로';
  layoutBtn.replaceChildren(icon(LAYOUT_ICON[now]));
  layoutBtn.setAttribute('aria-label', `주간 배치: ${now === 'row' ? '가로' : '세로'} (누르면 ${next}로)`);
  layoutBtn.title = `${next}로 보기`;
}
on(layoutBtn, 'click', async () => {
  if (!weekView) return;
  await weekView.setLayout(weekView.layout === 'row' ? 'col' : 'row');
  updateLayoutButton();
  toast(weekView.layout === 'row' ? '가로로 보기' : '세로로 보기');
});
safely('주간 배치 버튼', updateLayoutButton);

const isRowWeek = () => state.view === 'week' && weekView?.layout === 'row';

// 가로 배치에서 끝까지 간 뒤 한 번 더 당기면 다음/지난주 (다음 주는 일요일부터, 지난주는 토요일부터 보이게)
safely('주 넘기기', () => attachEdgePager(weekEl, {
  enabled: isRowWeek,
  onNext: () => showWeek(addDays(state.weekStart, 7), 1, 'start'),
  onPrev: () => showWeek(addDays(state.weekStart, -7), -1, 'end'),
  hintHost: wrapEl,
}));

// ============================================================ 4. 보기 전환과 이동

function setView(view) {
  if (view === 'week' && weekView) {
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
  safely('상단 제목', updateHeader);
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
    ({ main, year } = weekTitle(state.weekStart, { compact: phone.matches }));
    if (todayBtn) todayBtn.disabled = state.weekStart === startOfWeek(todayStr());
  } else {
    const d = calendar.view.currentStart;
    main = `${d.getMonth() + 1}월`;
    year = String(d.getFullYear());
    const now = new Date();
    if (todayBtn) todayBtn.disabled = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  titleEl?.replaceChildren(
    el('span', { class: 'm' }, main),
    el('span', { class: 'y' }, year),
    el('span', { class: 'caret', 'aria-hidden': 'true' }, icon('M7 10l5 5 5-5')),
  );
  titleEl?.setAttribute('aria-label', `${year}년 ${main} — 눌러서 ${isWeek ? '다른 주' : '다른 달'}로 이동`);
  document.title = `${year}년 ${main} · ${APP_NAME}`;

  prevBtn?.setAttribute('aria-label', isWeek ? '이전 주' : '이전 달');
  nextBtn?.setAttribute('aria-label', isWeek ? '다음 주' : '다음 달');
  monthBtn?.setAttribute('aria-pressed', String(!isWeek));
  weekBtn?.setAttribute('aria-pressed', String(isWeek));
  if (layoutBtn) layoutBtn.hidden = !isWeek;
  document.body.dataset.view = state.view;
}

on(prevBtn, 'click', () => navigate(-1));
on(nextBtn, 'click', () => navigate(1));
on(todayBtn, 'click', goToday);
on(monthBtn, 'click', () => setView('month'));
on(weekBtn, 'click', () => setView('week'));
on($('btn-categories'), 'click', () => modalSheet?.showCategories());

// 시간 돌아보기: 지금 보고 있는 주/달을 기준으로 연다
on($('btn-stats'), 'click', () => {
  if (!modalSheet) return;
  const anchor = state.view === 'week'
    ? (todayStr() >= state.weekStart && todayStr() < addDays(state.weekStart, 7) ? todayStr() : state.weekStart)
    : (sameMonth(calendar.view.currentStart, new Date()) ? todayStr() : toDateStr(calendar.view.currentStart));
  modalSheet.showView('stats', statsView({ mode: state.view, anchor }));
});
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

// 제목을 눌러 원하는 달·주로
safely('빠른 이동', () => initJump({
  button: titleEl,
  menu: $('jump-menu'),
  current: () => {
    const d = calendar.view.currentStart;
    return { view: state.view, year: d.getFullYear(), month: d.getMonth(), weekStart: state.weekStart };
  },
  gotoMonth: (year, month) => {
    const target = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const cur = toDateStr(calendar.view.currentStart);
    calendar.gotoDate(target);
    slideIn(calendarEl.querySelector('.fc-view-harness'), target > cur ? 1 : target < cur ? -1 : 0);
  },
  gotoWeekOf: (date) => {
    const start = startOfWeek(date);
    showWeek(start, start > state.weekStart ? 1 : start < state.weekStart ? -1 : 0, 'start');
    requestAnimationFrame(() => weekView?.scrollTo('selected')); // 고른 날짜가 보이도록 (좁은 화면 가로 배치)
  },
}));

// 좌우로 넘기기: 휴대폰 스와이프, 트랙패드 두 손가락 쓸기
// (가로 배치 주간 화면은 날짜를 스크롤해야 하므로 edgepager가 따로 처리)
safely('좌우 넘기기', () => onSwipe(wrapEl, {
  onPrev: () => navigate(-1),
  onNext: () => navigate(1),
  enabled: () => !isRowWeek() && !state.dragging,
}));

// 키보드 ← →
function anyMenuOpen() {
  try { return Boolean(document.querySelector('.jump-menu:popover-open, .settings-menu:popover-open')); } catch { return false; }
}
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (document.querySelector('dialog[open]') || anyMenuOpen()) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (e.code === 'KeyN') { e.preventDefault(); quick?.open(); return; } // N = 빠른 입력 (한글 자판이어도)
  if (e.target.closest?.('.pane, .notes')) return;
  if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
});

// ============================================================ 5. 끌어서 옮기기·복사, 오른쪽 클릭 메뉴

// ---- 5-1. 기록지의 할 일 → 달력의 날짜로 끌어다 놓기 (그날의 일정이 된다)
const DROP_SELECTOR = 'td.fc-daygrid-day[data-date], .wk-day[data-date], .wk-col[data-date]';
let dropTarget = null;

function setDropTarget(cell) {
  if (dropTarget === cell) return;
  dropTarget?.classList.remove('is-drop-target');
  dropTarget = cell;
  dropTarget?.classList.add('is-drop-target');
}

on(wrapEl, 'dragover', (e) => {
  if (!dragState.itemId) return; // 할 일 카드가 아닌 것(파일 등)은 무시
  const cell = e.target.closest(DROP_SELECTOR);
  setDropTarget(cell);
  if (cell) {
    e.preventDefault(); // "여기에 놓을 수 있음" 표시
    e.dataTransfer.dropEffect = 'move';
  }
});
on(wrapEl, 'dragleave', (e) => {
  if (!wrapEl.contains(e.relatedTarget)) setDropTarget(null);
});
on(wrapEl, 'drop', async (e) => {
  const cell = e.target.closest(DROP_SELECTOR);
  const itemId = dragState.itemId;
  setDropTarget(null);
  if (!cell || !itemId) return;
  e.preventDefault();
  if (await notes?.assignDate(itemId, cell.dataset.date)) flashDate(cell.dataset.date);
});
document.addEventListener('dragend', () => setDropTarget(null));

// 방금 바뀐 날짜 칸을 잠깐 반짝여서 어디에 들어갔는지 보여 준다
function flashDate(date) {
  requestAnimationFrame(() => {
    const cell = calendarEl.querySelector(`td.fc-daygrid-day[data-date="${date}"]`) || weekEl.querySelector(`[data-date="${date}"]`);
    if (!cell) return;
    cell.classList.remove('is-flash');
    void cell.offsetWidth; // 같은 칸을 연달아 반짝일 때 애니메이션을 처음부터
    cell.classList.add('is-flash');
    setTimeout(() => cell.classList.remove('is-flash'), 1200);
  });
}

// ---- 5-2. Option(⌥)을 누르고 끌기 = 복사 (윈도우는 Alt 또는 Ctrl)
//
// 0.8까지는 복사가 되긴 했지만 '실패한 것처럼' 보였다:
//   ① 끄는 동안 원래 일정이 사라져서 옮기기처럼 보였고  ② 놓으면 원래 자리로 튕겨 돌아갔고
//   ③ 복사본이 꽉 찬 칸의 '+n' 안에 숨어 버렸다.
// 그래서 지금은
//   - 끄는 동안 키 상태를 계속 지켜보다가(키를 누르고 떼는 것 + 마우스가 움직일 때의 키 상태),
//     복사면 원래 일정을 제자리에 그대로 보여 주고, 끌고 있는 일정에 '＋ 복사' 표시를 붙인다.
//     (맥 트랙패드의 세 손가락 끌기처럼 놓는 순간 키 정보가 빠지는 경우도 이 기록으로 판단한다)
//   - 놓으면 그 칸에 바로 자리 표시를 그려 두고(튕기지 않음), 저장이 끝나면 진짜 복사본으로 바뀐다.
//   - 놓은 칸을 반짝이고, 넓은 화면에서는 오른쪽 칸을 그 날짜로 바꿔서 '+n'에 숨은 복사본도 보이게 한다.
const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
const copyDrag = {
  active: false,  // 끄는 중
  on: false,      // 지금 복사 키가 눌려 있음
  decided: false, // 손을 뗀 순간 복사였는지
  source: null,   // 끄는 일정의 원래 칸 (복사일 때 제자리에 보이게)
  placeholders: [],

  isKey(e) { return Boolean(e?.altKey || (!isMac && e?.ctrlKey)); },
  set(on) {
    this.on = on;
    document.body.classList.toggle('is-copy-drag', on);
  },
  start(info) {
    this.active = true;
    this.source = info.el.closest('.fc-daygrid-event-harness');
    this.source?.classList.add('is-copy-source');
    this.set(this.isKey(info.jsEvent));
  },
  stop(info) {
    this.decided = this.on || this.isKey(info.jsEvent);
    this.active = false;
    this.source?.classList.remove('is-copy-source');
    this.source = null;
    this.set(false);
  },
  track(e) {
    if (!copyDrag.active) return;
    if (e.type === 'keydown' || e.type === 'keyup') {
      if (e.key === 'Alt' || (!isMac && e.key === 'Control')) copyDrag.set(e.type === 'keydown');
    } else {
      copyDrag.set(copyDrag.isKey(e));
    }
  },
  // 놓은 칸에 바로 보여 주는 자리 표시 (저장 → 다시 불러오기가 끝나면 지운다)
  addPlaceholder(event, date) {
    const p = calendar.addEvent({
      id: COPY_PLACEHOLDER,
      title: event.title,
      start: date,
      allDay: true,
      editable: false,
      classNames: [...event.classNames, 'is-copy-pending'],
      extendedProps: { ...event.extendedProps, order: -1, date },
    });
    const entry = { event: p, ready: false };
    this.placeholders.push(entry);
    return entry;
  },
  clearPlaceholders() {
    this.placeholders = this.placeholders.filter((entry) => {
      if (!entry.ready) return true;
      entry.event.remove();
      return false;
    });
  },
};
for (const type of ['keydown', 'keyup', 'pointermove', 'mousemove']) document.addEventListener(type, copyDrag.track, true);

// 월간 화면에서 일정을 다른 날짜로 끌어다 놓았을 때 (FullCalendar의 eventDrop)
//   그냥 놓기             → 그 날짜만 옮긴다 (여러 날짜 일정이면 나머지 날짜는 그대로)
//   Option(Alt) + 끌기    → 같은 내용으로 새 일정을 만든다 (복사)
// 어느 쪽이든 알림의 '되돌리기'로 바로 취소할 수 있다.
async function dropEvent(info) {
  const { itemId, date: from, kind, log } = info.oldEvent.extendedProps;
  const to = info.event.startStr.slice(0, 10);
  const copy = copyDrag.decided || copyDrag.isKey(info.jsEvent);
  copyDrag.decided = false;
  let placeholder = null;
  if (copy) {
    info.revert(); // 원래 일정은 제자리에 그대로
    placeholder = copyDrag.addPlaceholder(info.oldEvent, to);
  }
  try {
    if (kind === 'routine') await (copy ? copyLog(log, to) : moveLog(log, to));
    else await (copy ? copyItem(itemId, to) : moveItem(itemId, from, to));
    if (placeholder) placeholder.ready = true;
    await refreshAll();
    flashDate(to);
    if (copy && wide.matches) openDay(to); // '+n'에 숨었어도 오른쪽 칸 목록에서 보이게
  } catch (e) {
    if (placeholder) { placeholder.event.remove(); copyDrag.placeholders = copyDrag.placeholders.filter((p) => p !== placeholder); }
    if (!copy) info.revert();
    toast(e.message, 'error');
  }
}

// ---- 5-3. 옮기기·복사 (끌어다 놓기와 오른쪽 클릭 메뉴가 같이 쓴다)
async function moveItem(itemId, from, to) {
  await api.moveItem(itemId, from, to);
  toast(`${formatShort(to)}로 옮겼어요`, 'info', {
    action: { label: '되돌리기', run: () => undo(() => api.moveItem(itemId, to, from)) },
  });
}

async function copyItem(itemId, to) {
  const created = await api.copyItem(itemId, [to]);
  toast(`${formatShort(to)}에 복사했어요`, 'info', {
    action: { label: '되돌리기', run: () => undo(() => api.deleteItem(created.id)) },
  });
}

const logLabel = (log) => `${log.routine.emoji} ${log.routine.name}`;

async function moveLog(log, to) {
  await api.updateRoutineLog(log.id, { date: to });
  toast(`${logLabel(log)} 기록을 ${formatShort(to)}로 옮겼어요`, 'info', {
    action: { label: '되돌리기', run: () => undo(() => api.updateRoutineLog(log.id, { date: log.date })) },
  });
}

async function copyLog(log, to) {
  const created = await api.createRoutineLog({
    routine_id: log.routine.id, date: to, start_time: log.start_time, end_time: log.end_time, memo: log.memo,
  });
  toast(`${logLabel(log)} 기록을 ${formatShort(to)}에 복사했어요`, 'info', {
    action: { label: '되돌리기', run: () => undo(() => api.deleteRoutineLog(created.id)) },
  });
}

async function undo(fn) {
  try {
    await fn();
    await refreshAll();
    toast('되돌렸어요');
  } catch (e) { toast(e.message, 'error'); }
}

// ---- 5-4. 오른쪽 클릭(두 손가락 클릭) 메뉴: 수정 / 다른 날로 옮기기 / 다른 날로 복사 / 삭제
//   월간·주간 화면, 하루 목록(오른쪽 칸·팝업) 어디서나 같은 메뉴. sheet: 하루 목록에서 열었으면 그 창
function itemMenu(e, occ, sheet = null) {
  if (!occ) return;
  openMenu(e, [
    { label: '수정', run: () => editOccurrence(occ, sheet) },
    { label: '다른 날로 옮기기…', run: () => moveTo(occ) },
    { label: '다른 날로 복사…', run: () => copyTo(occ) },
    { label: '삭제', danger: true, run: () => deleteOccurrence(occ) },
  ], { title: occ.title });
}

function logMenu(e, log, sheet = null) {
  if (!log) return;
  openMenu(e, [
    { label: '수정', run: () => editLog(log, sheet) },
    { label: '다른 날로 옮기기…', run: () => moveTo(null, log) },
    { label: '다른 날로 복사…', run: () => copyTo(null, log) },
    { label: '삭제', danger: true, run: () => deleteLog(log) },
  ], { title: logLabel(log) });
}

function editOccurrence(occ, sheet) {
  const target = sheet || editSheet();
  if (!target) return;
  select(occ.date);
  target.day = occ.date;
  target.editFromDay(occ);
}

function editLog(log, sheet) {
  const target = sheet || editSheet();
  if (!target) return;
  select(log.date);
  target.showRoutineLog({ mode: 'edit', log });
}

async function moveTo(occ, log = null) {
  const from = occ ? occ.date : log.date;
  const name = occ ? occ.title : logLabel(log);
  const to = await pickDate({ title: '어느 날로 옮길까요?', from, hint: `'${name}' — ${formatShort(from)}에서 옮겨요.` });
  if (!to || to === from) return;
  try {
    if (log) await moveLog(log, to);
    else await moveItem(occ.id, from, to);
    await refreshAll();
    flashDate(to);
  } catch (err) { toast(err.message, 'error'); }
}

async function copyTo(occ, log = null) {
  const from = occ ? occ.date : log.date;
  const name = occ ? occ.title : logLabel(log);
  const to = await pickDate({ title: '어느 날로 복사할까요?', from, hint: `'${name}'과 같은 내용으로 새로 만들어요.` });
  if (!to) return;
  try {
    if (log) await copyLog(log, to);
    else await copyItem(occ.id, to);
    await refreshAll();
    flashDate(to);
    if (wide.matches) openDay(to);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteOccurrence(occ) {
  let scope = 'all';
  if (occ.date_count > 1) {
    scope = await ask(`'${occ.title}'은(는) ${occ.date_count}개 날짜에 들어 있어요. 어디에서 삭제할까요?`, [
      { label: `${formatShort(occ.date)}만`, value: 'single', kind: 'danger-fill' },
      { label: `모든 날짜 (${occ.date_count}일)`, value: 'all', kind: 'danger' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
  } else {
    scope = await ask(`'${occ.title}'을(를) 삭제할까요?`, [
      { label: '삭제', value: 'all', kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
  }
  if (!scope) return;
  try {
    await api.deleteItem(occ.id, scope, occ.date);
    toast('삭제했어요');
    await refreshAll();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteLog(log) {
  const ok = await ask(`${formatShort(log.date)}의 '${log.routine.name}' 기록을 삭제할까요?`, [
    { label: '삭제', value: true, kind: 'danger-fill' },
    { label: '취소', value: null, kind: 'ghost' },
  ]);
  if (!ok) return;
  try {
    await api.deleteRoutineLog(log.id);
    toast('기록을 삭제했어요');
    await refreshAll();
  } catch (err) { toast(err.message, 'error'); }
}

// ============================================================ 6. 새로 고침과 동기화

// 보이는 화면(월간·주간·오른쪽 칸 목록·기록지)을 모두 새로 불러온다.
async function reloadViews() {
  calendar.refetchEvents();
  if (state.view === 'week') await weekView?.refresh();
  paneSheet?.refreshList();  // 편집 중이면 건드리지 않는다
  await notes?.refresh();    // 할 일(날짜 없는 일정)이 바뀌었을 수 있다 (쓰고 있는 칸은 건드리지 않는다)
  await refreshStrip();      // D-day가 바뀌었을 수 있다
}

async function refreshStrip() {
  try { await strip?.refresh(); } catch { /* 띠는 못 그려도 달력은 그대로 */ }
}

// 이 기기에서 저장/삭제했을 때 (내 변경은 sync.js가 응답의 변경 번호로 알아채서 한 번 더 불러오지 않는다)
async function refreshAll() {
  await reloadViews();
}

// 다른 기기에서 바뀐 것이 감지됐을 때 (sync.js)
async function onRemoteChange() {
  await reloadViews();
  modalSheet?.refreshList(); // 열려 있는 팝업의 날짜 일정 목록도
}

configureSheets({
  onDataChanged: refreshAll,
  onItemMenu: (e, occ, sheet) => itemMenu(e, occ, sheet),
  onLogMenu: (e, log, sheet) => logMenu(e, log, sheet),
});

// ============================================================ 7. 나머지 시작

safely('설정', () => initSettings({
  loginEnabled: document.body.dataset.login === '1',
  appName: APP_NAME,
  version: document.body.dataset.version,
}));

// ---- 달력 위 띠, 기록지, 빠른 입력
safely('달력 위 띠', () => {
  strip = new TopStrip($('top-strip'), {
    onOpenNote: (noteId) => notes?.open({ noteId }),
    onOpenDate: (date) => showDate(date),
    onOpenGoal: (goalId) => notes?.open({ goalId }),
  });
});

safely('기록지', () => {
  notes = new NotesPanel($('notes'), {
    toggle: $('btn-notes'),
    badge: $('todo-count'),
    backdrop: $('notes-backdrop'),
    onStripChanged: refreshStrip,
    onLayoutChanged: () => requestAnimationFrame(() => calendar.updateSize()),
    onCalendarChanged: refreshAll,
    onOpenDate: (date) => showDate(date),
    // 할 일을 누르면 일정 입력 창으로 수정 (날짜를 넣으면 그날의 일정이 된다)
    onOpenItem: (item) => {
      const sheet = editSheet();
      sheet?.openForm({ mode: 'edit', item, scope: 'all', ctxDate: null, returnTo: sheet === paneSheet ? 'day' : null });
    },
  });
});

safely('빠른 입력', () => {
  quick = new QuickAdd($('quick'), {
    onSaved: refreshAll,
    onOpenDate: (date) => showDate(date),
    onOpenNotes: (opts) => notes?.open(opts),
    onDetail: ({ ctxDate, prefill, routineLog }) => {
      // 루틴 이름으로 썼으면 루틴 기록 창, 아니면 일정 입력 창 — 넓은 화면은 오른쪽 칸, 좁은 화면은 팝업
      if (routineLog) {
        if (wide.matches && paneSheet) {
          select(routineLog.date);
          paneSheet.showRoutineLog({ mode: 'create', ...routineLog });
        } else {
          modalSheet?.showRoutineLog({ mode: 'create', ...routineLog, returnTo: null });
        }
        return;
      }
      if (wide.matches && paneSheet) {
        if (ctxDate) { select(ctxDate); paneSheet.day = ctxDate; }
        paneSheet.openForm({ mode: 'create', ctxDate, returnTo: 'day', prefill });
      } else {
        modalSheet?.openForm({ mode: 'create', ctxDate, returnTo: null, prefill });
      }
    },
  });
  on($('btn-quick'), 'click', () => quick.open());
  on($('fab-quick'), 'click', () => quick.open());
});

// 띠가 나타나거나 기록지 칸이 열려서 달력 자리가 바뀌면 달력 크기를 다시 맞춘다
safely('크기 맞추기', () => {
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => calendar.updateSize());
  }).observe(wrapEl);
});

// 날짜로 가서 열기 (D-day 칩, 빠른 입력 알림의 '보기')
function showDate(date) {
  if (state.view === 'week') {
    const start = startOfWeek(date);
    if (start !== state.weekStart) showWeek(start, start > state.weekStart ? 1 : -1, 'start');
  } else {
    calendar.gotoDate(date);
  }
  openDay(date);
}
if (wide.matches) safely('오른쪽 칸', () => paneSheet?.showDay(state.selected)); // 오른쪽 칸: 오늘
if (notes && !notes.loaded) notes.load(); // '기록지' 버튼의 숫자 (안 한 할 일)
refreshStrip();
safely('동기화', () => startSync(onRemoteChange));
