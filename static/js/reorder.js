// 목록 순서 바꾸기 (직접 구현)
//
// 각 줄 오른쪽의 손잡이(≡)를 잡고 위아래로 끌면 순서가 바뀐다.
//   - 마우스, 손가락(터치) 모두 Pointer Events 하나로 처리
//   - 키보드: 손잡이에 포커스를 두고 ↑ ↓
// 손을 떼면 바뀐 순서(id 배열)를 onChange로 알려 준다.

const AUTOSCROLL_EDGE = 48; // 스크롤 영역 위/아래 끝에서 이만큼 안쪽이면 자동으로 스크롤
const AUTOSCROLL_STEP = 10;

/**
 * @param {HTMLElement} list         <ul>. 각 <li>에 data-id, 안에 .drag-handle 버튼
 * @param {object} opts
 * @param {HTMLElement} opts.scroller  자동 스크롤할 요소 (편집 창 본문)
 * @param {(ids: number[]) => void} opts.onChange
 */
export function makeSortable(list, { scroller, onChange }) {
  const ids = () => [...list.children].map((li) => Number(li.dataset.id));

  // ------------------------------------------------------------ 끌기 (마우스·터치)
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button > 0) return;
    e.preventDefault(); // 글자 선택·스크롤 막기

    const li = handle.closest('li');
    const before = ids().join();
    li.classList.add('is-dragging');
    list.classList.add('is-sorting');

    const move = (ev) => {
      const y = ev.clientY;
      // 바로 위/아래 줄의 가운데를 넘어가면 자리를 바꾼다.
      const prev = li.previousElementSibling;
      const next = li.nextElementSibling;
      if (next && y > middle(next)) next.after(li);
      else if (prev && y < middle(prev)) prev.before(li);
      autoscroll(scroller, y);
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      li.classList.remove('is-dragging');
      list.classList.remove('is-sorting');
      if (ids().join() !== before) onChange(ids());
    };

    // 줄이 DOM 안에서 옮겨 다녀도 끊기지 않도록 document에서 듣는다.
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });

  // ------------------------------------------------------------ 키보드
  list.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const li = handle.closest('li');
    if (e.key === 'ArrowUp' && li.previousElementSibling) li.previousElementSibling.before(li);
    else if (e.key === 'ArrowDown' && li.nextElementSibling) li.nextElementSibling.after(li);
    else return;
    handle.focus(); // 옮긴 뒤에도 같은 손잡이에 포커스 유지
    onChange(ids());
  });
}

function middle(el) {
  const r = el.getBoundingClientRect();
  return r.top + r.height / 2;
}

function autoscroll(scroller, y) {
  if (!scroller) return;
  const r = scroller.getBoundingClientRect();
  if (y < r.top + AUTOSCROLL_EDGE) scroller.scrollTop -= AUTOSCROLL_STEP;
  else if (y > r.bottom - AUTOSCROLL_EDGE) scroller.scrollTop += AUTOSCROLL_STEP;
}
