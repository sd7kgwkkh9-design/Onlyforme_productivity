// 좌우로 넘기는 제스처를 감지한다.
//   - 휴대폰: 손가락으로 왼쪽/오른쪽 스와이프
//   - 맥북 트랙패드: 두 손가락으로 좌우 쓸기 (가로 wheel 이벤트)
// 왼쪽으로 밀면 다음(onNext), 오른쪽으로 밀면 이전(onPrev).

const SWIPE_MIN_PX = 60;      // 이 거리 이상 움직여야 스와이프로 인정
const SWIPE_MAX_MS = 800;     // 너무 느린 움직임은 스크롤로 봄
const WHEEL_THRESHOLD = 80;   // 트랙패드 가로 이동량 누적 기준
const WHEEL_IDLE_MS = 220;    // 이 시간 동안 wheel이 멈춰야 다음 제스처를 받음

export function onSwipe(element, { onPrev, onNext }) {
  // ------------------------------------------------------------ 터치
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  element.addEventListener('touchstart', (e) => {
    tracking = e.touches.length === 1;
    if (!tracking) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const quick = Date.now() - startTime < SWIPE_MAX_MS;
    // 세로 스크롤과 헷갈리지 않도록 가로 이동이 세로보다 확실히 클 때만
    if (quick && Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onNext();
      else onPrev();
    }
  }, { passive: true });

  // ------------------------------------------------------------ 트랙패드
  // 한 번 쓸어도 wheel 이벤트가 수십 번 오므로(관성 포함) 이동량을 모으다가
  // 기준을 넘으면 한 번만 넘기고, 이벤트가 잠잠해질 때까지 잠근다.
  let accumulated = 0;
  let locked = false;
  let idleTimer;

  element.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // 세로 스크롤은 그대로 둔다
    e.preventDefault(); // 브라우저의 '뒤로 가기' 제스처 막기

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { accumulated = 0; locked = false; }, WHEEL_IDLE_MS);
    if (locked) return;

    accumulated += e.deltaX;
    if (Math.abs(accumulated) >= WHEEL_THRESHOLD) {
      locked = true;
      if (accumulated > 0) onNext();
      else onPrev();
      accumulated = 0;
    }
  }, { passive: false });
}

// 넘길 때 화면이 살짝 미끄러져 들어오는 효과 (direction: 1 = 다음, -1 = 이전)
export function slideIn(element, direction) {
  if (!element || !direction || !element.animate) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.animate(
    [
      { transform: `translateX(${direction * 32}px)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' },
  );
}
