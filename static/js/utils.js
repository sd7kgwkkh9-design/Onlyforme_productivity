// 날짜 계산, 화면 요소 만들기, 알림(toast), 질문 창(ask) 같은 공용 도구.

// ------------------------------------------------------------------ 날짜
// 날짜는 항상 'YYYY-MM-DD' 문자열로 주고받는다.
// (JS Date를 그대로 쓰면 시간대 때문에 하루가 밀리는 버그가 생기기 쉽다.)

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d); // 현지 시간 자정
}

export function addDays(s, n) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export const todayStr = () => toDateStr(new Date());

export function formatLong(s) {
  const d = parseDateStr(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
}

export function formatShort(s) {
  const d = parseDateStr(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

// 두 날짜 사이 일수 (b - a)
export function daysBetween(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000);
}

// 루틴 버튼의 '마지막으로 한 날' — 보고 있는 날짜(base) 기준
//   같은 날 → '오늘'(보는 날이 오늘일 때) / '이 날',  하루 전 → '어제' / '전날',  그 외 → 'N일 전'
export function lastDoneLabel(last, base) {
  if (!last) return '처음';
  const n = daysBetween(last, base);
  const isToday = base === todayStr();
  if (n <= 0) return isToday ? '오늘' : '이 날';
  if (n === 1) return isToday ? '어제' : '전날';
  return `${n}일 전`;
}

// D-day 표시: 0 → 'D-day', 3 → 'D-3', -2 → 'D+2'
export function ddayLabel(daysLeft) {
  if (daysLeft === 0) return 'D-day';
  return daysLeft > 0 ? `D-${daysLeft}` : `D+${-daysLeft}`;
}

// 분 → '3시간 20분' / '45분' / '0분'
export function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 시간 표시 (24시간) — 모든 화면이 이 규칙 하나를 쓴다.
//   둘 다   → '09:00~10:30'
//   시작만  → '09:00~'
//   끝만    → '~18:00'
//   없음    → ''
export function formatTimeRange(start, end) {
  if (start && end) return `${start}~${end}`;
  if (start) return `${start}~`;
  if (end) return `~${end}`;
  return '';
}

// 두 날짜 사이(양 끝 포함)의 모든 날짜. 순서가 거꾸로 들어와도 된다.
export function datesBetween(a, b) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ------------------------------------------------------------------ 화면 요소
// el('button', { class: 'btn', onclick: fn }, '저장') 처럼 요소를 만든다.
// 글자는 항상 textContent로 들어가므로 사용자가 입력한 HTML이 실행되지 않는다(XSS 방지).
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'value' || key === 'checked') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// 카테고리 고르기: 색 점이 붙은 칩 라디오 (일정 입력, 루틴 편집에서 공통으로 사용)
export function categoryChips(categories, initialId, groupName) {
  const node = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': '카테고리' },
    categories.map((c) =>
      el('label', { class: 'chip', style: { '--cat': c.color } },
        el('input', { type: 'radio', name: groupName, value: String(c.id), checked: c.id === initialId }),
        el('span', { class: 'dot' }),
        c.name,
      )),
  );
  return {
    node,
    get value() {
      const checked = node.querySelector('input:checked');
      return checked ? Number(checked.value) : null;
    },
  };
}

// 선 아이콘 하나짜리 SVG (예: icon('M6 6l12 12M18 6L6 18') → ×)
export function icon(path) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

// 팝업 창(모달 dialog)이 열려 있으면 그 창, 아니면 <body>.
// 모달 창이 열려 있는 동안 창 바깥은 '누를 수 없는' 상태가 되므로, 그 위에 띄우는 메뉴·알림은 창 안으로 옮겨서 띄운다.
export function topLayerHost() {
  const modals = [...document.querySelectorAll('dialog[open]')].filter((d) => {
    try { return d.matches(':modal'); } catch { return true; }
  });
  return modals.at(-1) || document.body;
}

// ------------------------------------------------------------------ 알림
// toast('옮겼어요', 'info', { action: { label: '되돌리기', run: () => ... } })
//   action을 주면 알림 안에 버튼이 생기고, 조금 더 오래(5초) 떠 있다.
let toastTimer;
export function toast(message, kind = 'info', { action = null } = {}) {
  const box = document.getElementById('toast');
  const host = topLayerHost(); // '되돌리기' 버튼을 팝업 창이 열려 있을 때도 누를 수 있게
  if (box.parentElement !== host) {
    if (box.matches?.(':popover-open')) box.hidePopover();
    host.append(box);
  }
  box.replaceChildren(el('span', {}, message));
  if (action) {
    box.append(el('button', {
      type: 'button',
      class: 'toast-action',
      onclick: () => {
        box.classList.remove('show');
        if (box.hidePopover && box.matches(':popover-open')) box.hidePopover();
        action.run();
      },
    }, action.label));
  }
  box.classList.toggle('has-action', Boolean(action));
  box.dataset.kind = kind;
  clearTimeout(toastTimer);
  if (box.showPopover) {
    // 다시 열어야 방금 열린 창보다 위로 올라온다.
    if (box.matches(':popover-open')) box.hidePopover();
    box.showPopover();
  }
  box.classList.add('show');
  toastTimer = setTimeout(() => {
    box.classList.remove('show');
    if (box.hidePopover && box.matches(':popover-open')) box.hidePopover();
  }, action ? 5000 : kind === 'error' ? 4000 : 2000);
}

// ------------------------------------------------------------------ 질문 창
// const v = await ask('어디를 수정할까요?', [{ label: '이 날만', value: 'single' }, ...])
// 사용자가 고른 버튼의 value를 돌려준다. Esc나 바깥 클릭으로 닫으면 null.
export function ask(message, buttons) {
  const dialog = document.getElementById('ask');
  const box = document.getElementById('ask-buttons');
  document.getElementById('ask-message').textContent = message;

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    box.replaceChildren(
      ...buttons.map((b) =>
        el('button', { type: 'button', class: `btn ${b.kind || ''}`, onclick: () => finish(b.value) }, b.label),
      ),
    );
    dialog.addEventListener('close', () => finish(null), { once: true });
    dialog.onclick = (e) => { if (e.target === dialog) finish(null); }; // 바깥(배경) 클릭
    dialog.showModal();
  });
}
