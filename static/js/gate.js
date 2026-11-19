// 로그인·잠금 화면의 '패스키로 들어가기' 버튼 (0.12.0)
//
// <body data-mode="login|unlock" data-next="…"> 로그인 화면이면 로그인, 잠금 화면이면 잠금 열기.
// 패스키를 못 쓰는 브라우저면 버튼을 숨기고 비밀번호만 보인다.

import { isCancel, passkeySupported, usePasskey } from './webauthn.js';

const button = document.getElementById('btn-passkey');
const errorEl = document.getElementById('passkey-error');
const { mode = 'login', next = '' } = document.body.dataset;

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요. (${res.status})`);
  return data;
}

async function go() {
  errorEl.hidden = true;
  button.disabled = true;
  try {
    const options = await post('/auth/passkey/options', { purpose: mode });
    const credential = await usePasskey(options);
    await post('/auth/passkey/verify', { purpose: mode, credential });
    window.location.href = next && next.startsWith('/?') ? next : '/';
  } catch (e) {
    if (!isCancel(e)) {
      errorEl.textContent = e.message || '패스키로 들어가지 못했어요.';
      errorEl.hidden = false;
    }
    button.disabled = false;
  }
}

if (button && passkeySupported()) {
  button.hidden = false;
  document.querySelector('.gate-or')?.removeAttribute('hidden');
  button.addEventListener('click', go);
  // 잠금 화면: 바로 Face ID를 띄워 본다 (브라우저가 '버튼을 눌러야 한다'고 막으면 버튼으로)
  // 0.13.0: PIN을 정해 두었으면 PIN 칸이 먼저라서 띄우지 않는다 (회사 컴퓨터에서 Windows Hello 창이 갑자기 뜨지 않게)
  if (mode === 'unlock' && document.body.dataset.auto !== '0') go();
}
