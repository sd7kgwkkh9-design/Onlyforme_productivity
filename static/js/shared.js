// 보기 전용 공유 화면 (0.12.0) — /v/<토큰>
//
// 내 캘린더의 일정을 '보기만' 하는 달력. 고치기·끌기·오른쪽 클릭 메뉴는 없다.
// 서버는 링크에서 고른 카테고리의 일정만 주고, 메모는 '메모도 보여 주기'를 켠 링크에서만 준다 (links.py).
// 날짜를 누르면 그날 일정이 옆(넓은 화면) 또는 아래(휴대폰)에 펼쳐진다.

import { WEEKDAYS, el, formatTimeRange, parseDateStr, todayStr, toDateStr } from './utils.js';

const { token } = document.body.dataset;
const dayBox = document.getElementById('sh-day');
const titleEl = document.getElementById('sh-title');
let byDate = new Map();     // 'YYYY-MM-DD' → 그날 일정 (지금 받아 둔 달)
let holidayOf = new Map();
let selected = todayStr();

async function load(start, end) {
  const res = await fetch(`/v/${token}/events?start=${start}&end=${end}`);
  if (res.status === 404) { location.reload(); return { items: [], holidays: [] }; }  // 링크가 끊김 → 안내 화면
  if (!res.ok) throw new Error('일정을 불러오지 못했어요.');
  return res.json();
}

const calendar = new FullCalendar.Calendar(document.getElementById('sh-calendar'), {
  locale: 'ko',
  initialView: 'dayGridMonth',
  headerToolbar: false,
  height: 'auto',
  fixedWeekCount: false,
  dayMaxEvents: 3,
  eventDisplay: 'block',
  eventOrder: 'order',
  editable: false,
  dayCellContent: (arg) => arg.dayNumberText.replace('일', ''),
  moreLinkContent: (arg) => `+${arg.num}`,
  moreLinkClick: (arg) => { pick(toDateStr(arg.date)); return 'none'; },
  dayCellClassNames: (arg) => (toDateStr(arg.date) === selected ? ['is-selected'] : []),
  events: async (info, success, failure) => {
    try {
      const { items, holidays } = await load(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
      byDate = new Map();
      items.forEach((o) => { if (!byDate.has(o.date)) byDate.set(o.date, []); byDate.get(o.date).push(o); });
      holidayOf = new Map(holidays.map((h) => [h.date, h.name]));
      success([
        ...items.map((o, i) => ({
          title: o.title, start: o.date, allDay: true, classNames: o.dday ? ['is-dday'] : [],
          extendedProps: { time: formatTimeRange(o.start_time, o.end_time) || null, color: o.category.color, order: i },
        })),
        ...holidays.map((h) => ({ start: h.date, allDay: true, display: 'background', classNames: ['holiday-bg'], title: h.name, extendedProps: { holiday: true } })),
      ]);
      renderDay();
    } catch (e) {
      failure(e);
      dayBox.replaceChildren(el('p', { class: 'form-error' }, e.message));
    }
  },
  eventContent: (arg) => {
    const { time, holiday } = arg.event.extendedProps;
    if (holiday) return { domNodes: [el('span', { class: 'holiday-name' }, arg.event.title)] };
    return { domNodes: [el('span', { class: 'ev' }, time ? el('span', { class: 'ev-time' }, time) : null, el('span', { class: 'ev-title' }, arg.event.title))] };
  },
  eventDidMount: (arg) => {
    if (arg.event.extendedProps.color) arg.el.style.setProperty('--cat', arg.event.extendedProps.color);
  },
  eventClick: (info) => pick(toDateStr(info.event.start)),
  dateClick: (info) => pick(info.dateStr),
  datesSet: () => {
    const d = calendar.getDate();
    titleEl.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  },
});

function pick(date) {
  selected = date;
  document.querySelectorAll('.fc-daygrid-day.is-selected').forEach((td) => td.classList.remove('is-selected'));
  document.querySelector(`.fc-daygrid-day[data-date="${date}"]`)?.classList.add('is-selected');
  renderDay();
  if (window.matchMedia('(max-width: 760px)').matches) dayBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDay() {
  const d = parseDateStr(selected);
  const list = byDate.get(selected) || [];
  const holiday = holidayOf.get(selected);
  dayBox.replaceChildren(...[
    el('h3', { class: 'shared-day-title' }, `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`,
      selected === todayStr() ? el('span', { class: 'shared-today' }, '오늘') : null),
    holiday ? el('p', { class: 'shared-holiday' }, holiday) : null,
    list.length
      ? el('ul', { class: 'shared-items' }, list.map((o) => el('li', { class: 'shared-item', style: { '--cat': o.category.color } },
          el('span', { class: 'shared-time' }, formatTimeRange(o.start_time, o.end_time) || '하루'),
          el('span', { class: 'shared-main' },
            el('span', { class: 'shared-title' }, o.dday ? '⭐ ' : '', o.title),
            el('span', { class: 'shared-cat' }, o.category.name),
            o.memo ? el('span', { class: 'shared-memo' }, o.memo) : null),
        )))
      : el('p', { class: 'shared-empty' }, '일정이 없어요.'),
  ].filter(Boolean));
}

document.getElementById('sh-prev').addEventListener('click', () => calendar.prev());
document.getElementById('sh-next').addEventListener('click', () => calendar.next());
document.getElementById('sh-today').addEventListener('click', () => { calendar.today(); pick(todayStr()); });
calendar.render();
// 1분마다 새로 받아 온다 (공유한 사람이 일정을 바꾸면 따라 바뀌게)
setInterval(() => { if (!document.hidden) calendar.refetchEvents(); }, 60_000);
