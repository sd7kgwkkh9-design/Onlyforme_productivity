// 기기 간 동기화 (직접 구현)
//
// 서버는 일정·카테고리가 바뀔 때마다 '변경 번호'(version)를 1씩 올린다.
// 이 화면은 그 번호만 가볍게 확인하다가, 번호가 바뀌었을 때만 일정을 다시 불러온다.
//
//   - 화면이 보이는 동안: POLL_MS마다 확인
//   - 앱/탭으로 돌아오는 순간, 창에 다시 포커스할 때, 인터넷이 다시 연결될 때: 바로 확인
//   - 화면이 안 보이면(다른 앱 사용 중) 확인하지 않음 → 배터리·데이터 절약

import { api } from './api.js';

const POLL_MS = 4000;

let known = null;      // 마지막으로 반영한 변경 번호
let checking = false;
let onRemoteChange = async () => {};

export function startSync(handler) {
  onRemoteChange = handler;
  check();
  setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  window.addEventListener('pageshow', check); // 아이폰에서 홈 화면 앱으로 돌아올 때
}

// 내가 방금 저장했을 때: 지금 번호를 '이미 반영함'으로 기록해서 한 번 더 불러오지 않게 한다.
// (번호를 먼저 받고 데이터를 나중에 받으므로, 그 사이 다른 기기의 변경을 놓치지 않는다)
export async function acknowledge() {
  try {
    known = (await api.version()).version;
  } catch { /* 다음 확인 때 처리 */ }
}

async function check() {
  if (document.hidden || checking) return;
  checking = true;
  try {
    const { version } = await api.version();
    if (known !== null && version !== known) {
      known = version;
      await onRemoteChange();
    } else {
      known = version;
    }
  } catch {
    // 인터넷이 잠깐 끊긴 경우 등: 조용히 넘어가고 다음에 다시 확인
  } finally {
    checking = false;
  }
}
