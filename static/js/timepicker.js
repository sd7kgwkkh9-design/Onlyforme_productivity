// 24시간 시간 고르기 (일정 입력 창과 루틴 기록 창에서 함께 쓴다)
import { el } from './utils.js';

// 24시간 시간 고르기: [시 ▾] : [분 ▾]
// 브라우저 기본 시간 입력(<input type=time>)은 맥·아이폰 설정에 따라 오전/오후로 나와서 직접 만든다.
export function timeSelect(label, id, initial, className) {
  const pad = (n) => String(n).padStart(2, '0');
  const minutes = Array.from({ length: 60 }, (_, i) => pad(i)); // 00 ~ 59 (1분 단위)

  const hourEl = el('select', { id, class: `input sel ${className}-h`, 'aria-label': `${label} 시` },
    el('option', { value: '' }, '--'),
    Array.from({ length: 24 }, (_, i) => el('option', { value: pad(i) }, pad(i))),
  );
  const minuteEl = el('select', { class: `input sel ${className}-m`, 'aria-label': `${label} 분` },
    minutes.map((m) => el('option', { value: m }, m)),
  );

  const set = (value) => {
    const [h, m] = value ? value.split(':') : ['', '00'];
    hourEl.value = h;
    minuteEl.value = m;
    minuteEl.disabled = !h; // 시를 안 고르면 분은 의미가 없으므로 잠금
  };
  set(initial);
  hourEl.addEventListener('change', () => { minuteEl.disabled = !hourEl.value; });

  return {
    node: el('div', { class: 'time-field' },
      el('span', { class: 'time-label' }, label), hourEl, el('span', { class: 'time-colon' }, ':'), minuteEl),
    hourEl,
    get value() { return hourEl.value ? `${hourEl.value}:${minuteEl.value}` : null; },
    set,
    focus: () => hourEl.focus(),
  };
}

