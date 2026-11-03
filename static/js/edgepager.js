// 가로 배치 주간 화면에서 "끝에서 한 번 더 당기면 다음/지난주" (직접 구현)
//
// 좌우로 밀면 원래는 그 주 안에서 날짜가 스크롤된다. 실수로 주가 넘어가지 않도록:
//   1) 관성으로 끝에 닿은 건 무시한다.
//      → 손가락을 대는(트랙패드는 쓸기 시작하는) 순간 이미 끝에 멈춰 있던 경우에만 '당기기'로 본다.
//   2) 끝에서 당기면 가장자리에 '다음 주 →' 안내가 나타나고, 당긴 만큼 차오른다.
//   3) 화면 폭의 1/3 정도는 당겨야 넘어간다. 다 차기 전에 손을 떼면 아무 일도 없다.
// 날짜가 7칸 다 보이는 넓은 화면에서는 처음부터 양쪽 끝이므로, 같은 규칙으로 당기면 넘어간다.

const MOMENTUM_MS = 140;      // 마지막 스크롤 후 이 시간 안에 손을 대면 '아직 미끄러지는 중'으로 본다
const START_SLOP = 8;         // 이만큼 움직여야 방향을 정한다 (살짝 닿은 것 무시)
const MIN_PULL_PX = 90;
const WHEEL_PULL_PX = 260;    // 트랙패드로 이만큼 쓸어야 넘어감
const WHEEL_IDLE_MS = 220;    // 이 시간 동안 쓸기가 멈추면 한 번의 동작이 끝난 것

/**
 * @param {HTMLElement} scroller  가로로 스크롤되는 주간 화면
 * @param {object} opts
 * @param {() => boolean} opts.enabled  지금 이 기능을 쓸지 (가로 배치 주간 화면일 때만)
 * @param {() => void} opts.onPrev
 * @param {() => void} opts.onNext
 * @param {HTMLElement} opts.hintHost  안내 표시를 띄울 곳 (position: relative)
 */
export function attachEdgePager(scroller, { enabled, onPrev, onNext, hintHost }) {
  const hints = {
    prev: makeHint('prev', '← 지난주'),
    next: makeHint('next', '다음 주 →'),
  };
  hintHost.append(hints.prev, hints.next);

  let lastScrollAt = 0;
  scroller.addEventListener('scroll', () => { lastScrollAt = performance.now(); }, { passive: true });

  const edges = () => ({
    atStart: scroller.scrollLeft <= 1,
    atEnd: scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1,
  });
  const threshold = () => Math.max(MIN_PULL_PX, scroller.clientWidth / 3);

  function show(dir, progress) {
    const other = dir === 'next' ? 'prev' : 'next';
    hints[other].classList.remove('show');
    hints[dir].style.setProperty('--p', String(Math.min(1, progress)));
    hints[dir].classList.toggle('show', progress > 0);
    hints[dir].classList.toggle('ready', progress >= 1);
  }
  function hideAll() {
    for (const h of Object.values(hints)) h.classList.remove('show', 'ready');
  }
  function fire(dir) {
    hideAll();
    if (dir === 'next') onNext();
    else onPrev();
  }

  // ------------------------------------------------------------ 터치 (휴대폰·아이패드)
  let t = null; // { x, y, mode: 'idle'|'none'|'next'|'prev', progress, atStart, atEnd }

  scroller.addEventListener('touchstart', (e) => {
    if (!enabled() || e.touches.length !== 1) { t = null; return; }
    const momentum = performance.now() - lastScrollAt < MOMENTUM_MS;
    t = { x: e.touches[0].clientX, y: e.touches[0].clientY, mode: momentum ? 'none' : 'idle', progress: 0, ...edges() };
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    if (!t || t.mode === 'none') return;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (t.mode === 'idle') {
      if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) { t.mode = 'none'; return; }      // 세로 스크롤
      if (dx < 0 && t.atEnd) t.mode = 'next';                              // 끝에서 왼쪽으로 밀기
      else if (dx > 0 && t.atStart) t.mode = 'prev';                       // 처음에서 오른쪽으로 밀기
      else { t.mode = 'none'; return; }                                    // 그냥 날짜 스크롤
    }
    e.preventDefault(); // 당기는 동안은 화면이 출렁이지 않게
    const pull = t.mode === 'next' ? -dx : dx;
    t.progress = Math.max(0, pull) / threshold();
    show(t.mode, t.progress);
  }, { passive: false });

  const endTouch = () => {
    if (t && (t.mode === 'next' || t.mode === 'prev')) {
      if (t.progress >= 1) fire(t.mode);
      else hideAll();
    }
    t = null;
  };
  scroller.addEventListener('touchend', endTouch);
  scroller.addEventListener('touchcancel', () => { t = null; hideAll(); });

  // ------------------------------------------------------------ 트랙패드 (맥북 두 손가락 쓸기)
  // 한 번 쓸면 wheel 이벤트가 관성까지 포함해 연달아 들어온다. 잠깐 멈출 때까지를 한 동작으로 본다.
  let w = null; // { mode, acc, done }
  let idleTimer;

  scroller.addEventListener('wheel', (e) => {
    if (!enabled() || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { w = null; hideAll(); }, WHEEL_IDLE_MS);

    if (!w) {
      // 새 동작의 첫 이벤트: 이때 이미 끝에 있어야 당기기로 본다.
      const { atStart, atEnd } = edges();
      let mode = 'none';
      if (e.deltaX > 0 && atEnd) mode = 'next';
      else if (e.deltaX < 0 && atStart) mode = 'prev';
      w = { mode, acc: 0, done: false };
    }
    if (w.mode === 'none') return; // 평소처럼 스크롤 (끝에 닿아도 넘어가지 않음)

    e.preventDefault();
    if (w.done) return;
    const signed = w.mode === 'next' ? e.deltaX : -e.deltaX;
    w.acc = Math.max(0, w.acc + signed);
    const progress = w.acc / WHEEL_PULL_PX;
    show(w.mode, progress);
    if (progress >= 1) {
      w.done = true; // 남은 관성 이벤트로 두 주씩 넘어가지 않게
      fire(w.mode);
    }
  }, { passive: false });
}

function makeHint(dir, text) {
  const node = document.createElement('div');
  node.className = `edge-hint ${dir}`;
  node.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = text;
  node.append(label);
  return node;
}
