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

// ------------------------------------------------------------------ 알림
let toastTimer;
export function toast(message, kind = 'info') {
  const box = document.getElementById('toast');
  box.textContent = message;
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
  }, kind === 'error' ? 4000 : 2000);
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
