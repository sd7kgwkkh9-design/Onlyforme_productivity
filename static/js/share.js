// 공유하기·인쇄 (0.10.0)
//
// 상단의 공유 버튼(↑)을 누르면 작은 메뉴가 뜬다.
//   - '11월 12일 (목) 일정 보내기' : 고른 날짜의 일정을 글로 만들어 보낸다
//   - '이 주 일정 보내기'          : 그 날짜가 들어 있는 한 주(일~토)의 일정
//   - '인쇄 / PDF로 저장'          : 지금 보이는 달력(월간·주간)을 종이·PDF로
//
// 보내기는 휴대폰·맥의 '공유' 창(카톡, 메시지, 메모 …)을 연다(Web Share API).
// 공유 창이 없는 브라우저(예: 윈도우의 일부 브라우저)에서는 글을 복사해 두고 알려 준다.
// 루틴 기록은 개인 기록이라 넣지 않고, 일정만 보낸다.

import { api } from './api.js';
import { WEEKDAYS, addDays, el, formatShort, formatTimeRange, parseDateStr, toast } from './utils.js';

function dayLabel(date) {
  const d = parseDateStr(date);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

function line(o) {
  const time = formatTimeRange(o.start_time, o.end_time);
  const cat = o.category && !o.category.is_default ? ` #${o.category.name}` : '';
  return `· ${time ? `${time} ` : ''}${o.title}${cat}`;
}

/** 하루 일정을 글로 */
export async function dayText(date, appName) {
  const { items } = await api.calendar(date, addDays(date, 1));
  const lines = items.filter((o) => o.date === date).map(line);
  return [
    `📅 ${dayLabel(date)} 일정`,
    ...(lines.length ? lines : ['· 일정 없음']),
    '',
    `— ${appName}`,
  ].join('\n');
}

/** 한 주(start = 일요일) 일정을 글로. 일정이 없는 날은 건너뛴다. */
export async function weekText(start, appName) {
  const end = addDays(start, 7);
  const { items } = await api.calendar(start, end);
  const s = parseDateStr(start);
  const e = parseDateStr(addDays(start, 6));
  const head = s.getMonth() === e.getMonth()
    ? `📅 ${s.getMonth() + 1}월 ${s.getDate()}일 ~ ${e.getDate()}일 일정`
    : `📅 ${s.getMonth() + 1}월 ${s.getDate()}일 ~ ${e.getMonth() + 1}월 ${e.getDate()}일 일정`;
  const parts = [head];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const today = items.filter((o) => o.date === date);
    if (!today.length) continue;
    parts.push('', `[${dayLabel(date)}]`, ...today.map(line));
  }
  if (parts.length === 1) parts.push('· 일정 없음');
  parts.push('', `— ${appName}`);
  return parts.join('\n');
}

/** 공유 창 열기 → 없으면 복사 */
export async function sendText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // 사용자가 공유 창을 닫음
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('일정을 복사했어요. 카톡·메시지에 붙여 넣으세요.');
  } catch {
    toast('이 브라우저에서는 공유·복사를 할 수 없어요.', 'error');
  }
}

/** 인쇄 / PDF로 저장: 지금 보이는 달력만 깔끔하게 (style.css의 @media print) */
export function printCalendar(beforePrint) {
  beforePrint?.();
  // 메뉴(popover)가 닫히고 화면이 다시 그려진 뒤에 인쇄 창을 연다
  setTimeout(() => window.print(), 120);
}

/**
 * 공유 메뉴 만들기
 * @param {object} o
 * @param {HTMLElement} o.button  상단의 공유 버튼 (popovertarget="share-menu")
 * @param {HTMLElement} o.menu    <div id="share-menu" popover>
 * @param {() => {date: string, weekStart: string}} o.current  지금 고른 날짜, 그 날짜가 든 주의 일요일
 * @param {string} o.appName
 * @param {() => void} o.beforePrint  인쇄 전에 달력 크기 맞추기
 */
export function initShare({ button, menu, current, appName, beforePrint }) {
  if (!button || !menu) return;
  const item = (label, sub, run) => el('button', {
    type: 'button', role: 'menuitem', class: 'menu-choice share-choice',
    onclick: async () => {
      if (menu.hidePopover) menu.hidePopover();
      try { await run(); } catch (e) { toast(e.message, 'error'); }
    },
  }, el('span', { class: 'share-main' }, label), sub ? el('span', { class: 'share-sub' }, sub) : null);

  function render() {
    const { date, weekStart } = current();
    const end = addDays(weekStart, 6);
    menu.replaceChildren(
      el('p', { class: 'menu-label' }, '보내기'),
      item(`${dayLabel(date)} 일정`, '카톡·메시지로 보내기', async () => sendText(`${dayLabel(date)} 일정`, await dayText(date, appName))),
      item('이 주 일정', `${formatShort(weekStart)} ~ ${formatShort(end)}`, async () => sendText('이번 주 일정', await weekText(weekStart, appName))),
      el('p', { class: 'menu-label share-sep' }, '종이·파일로'),
      item('인쇄 / PDF로 저장', '지금 보이는 달력 그대로', () => printCalendar(beforePrint)),
    );
  }

  if (typeof menu.showPopover === 'function') {
    menu.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      button.setAttribute('aria-expanded', String(open));
      if (!open) return;
      render();
      const r = button.getBoundingClientRect();
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    });
  } else {
    // 아주 오래된 브라우저: 메뉴 대신 고른 날짜 보내기
    button.removeAttribute('popovertarget');
    button.addEventListener('click', async () => {
      const { date } = current();
      sendText(`${dayLabel(date)} 일정`, await dayText(date, appName));
    });
  }
}
