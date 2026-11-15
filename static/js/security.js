// Face ID·패스키 창 (0.12.0) — ⚙ 설정의 'Face ID·패스키…'
//
// - 이 기기를 패스키로 등록하면, 로그인 화면에서 비밀번호 대신 Face ID·지문·기기 암호로 들어간다.
// - '열 때마다 생체 인증'(이 기기만): 몇 분 넘게 안 쓰다가 다시 열면 Face ID·지문을 한 번 더 확인한다.
//   켤 때 패스키로 한 번 확인해서, 이 기기에서 정말 열 수 있는지 먼저 본다 (못 여는 잠금이 되지 않게).
// 서버 쪽은 passkeys.py, 바이트 변환은 webauthn.js.

import { api } from './api.js';
import { ask, el, toast } from './utils.js';
import { createPasskey, isCancel, passkeySupported, usePasskey } from './webauthn.js';

let dialog = null;
let inner = null;   // 창 안의 내용 (창 자체를 비우면 그 안으로 옮겨 둔 알림(toast)까지 지워져서 따로 둔다)

export async function openSecurity() {
  if (!dialog) {
    dialog = el('dialog', { class: 'security', 'aria-labelledby': 'security-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    inner = el('div', { class: 'dlg-inner' });
    dialog.append(inner);
    document.body.append(dialog);
  }
  if (!dialog.open) dialog.showModal();
  await render();
}

function stamp(s) {
  if (!s) return '';
  const [d, t] = s.split(' ');
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)} ${t.slice(0, 5)}`;
}

async function render() {
  let info;
  try { info = await api.passkeys(); } catch (e) { toast(e.message, 'error'); return; }
  const supported = passkeySupported();
  const { passkeys, lock, lock_minutes: minutes } = info;

  const lockSwitch = el('button', {
    type: 'button', role: 'switch', class: 'menu-choice menu-switch sec-switch', 'aria-checked': String(lock),
    disabled: !passkeys.length || !supported,
    onclick: () => toggleLock(!lock),
  },
    el('span', { class: 'menu-switch-text' },
      el('b', {}, '열 때마다 생체 인증 (이 기기)'),
      el('small', {}, passkeys.length
        ? `${minutes}분 넘게 안 쓰다가 다시 열면 Face ID·지문을 확인해요. 다른 기기에는 영향이 없어요.`
        : '먼저 이 기기를 패스키로 등록해 주세요.')),
    el('span', { class: 'switch', 'aria-hidden': 'true' }));

  inner.replaceChildren(
    el('header', { class: 'lk-head' },
      el('h2', { id: 'security-title' }, 'Face ID · 패스키'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    el('div', { class: 'lk-body' },
      el('p', { class: 'lk-intro' },
        '패스키를 등록하면 비밀번호 대신 ', el('b', {}, 'Face ID · Touch ID · 지문 · Windows Hello'), '로 들어가요. ',
        '아이클라우드 키체인을 쓰면 아이폰에서 등록한 패스키가 맥에서도 돼요. 비밀번호 로그인은 그대로 남아요.'),
      supported ? null : el('p', { class: 'lk-note' }, '이 브라우저(또는 http 주소)에서는 패스키를 쓸 수 없어요. 아이폰·맥 Safari, Chrome, Edge의 https 주소에서 열어 주세요.'),
      passkeys.length
        ? el('ul', { class: 'lk-list' }, passkeys.map((p) => el('li', { class: 'sec-item' },
            el('span', { class: 'sec-icon', 'aria-hidden': 'true' }, '🔑'),
            el('span', { class: 'sec-main' },
              el('b', {}, p.label),
              el('span', {}, `등록 ${stamp(p.created_at)}${p.last_used_at ? ` · 마지막 사용 ${stamp(p.last_used_at)}` : ''}`)),
            el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => remove(p) }, '지우기'))))
        : el('p', { class: 'lk-empty' }, '아직 등록한 패스키가 없어요.'),
      supported ? el('button', { type: 'button', class: 'btn primary', onclick: register }, '이 기기 등록 (Face ID · 지문)') : null,
      lockSwitch,
      el('p', { class: 'lk-note' },
        `패스키는 지금 주소(${location.host})에 묶여요. 서버 주소가 바뀌면 다시 등록해야 해요. `,
        '기기를 잃어버렸다면 여기서 그 기기의 패스키를 지우세요.'),
    ),
  );
}

async function register() {
  try {
    const options = await api.passkeyRegisterOptions();
    const credential = await createPasskey(options);
    const { label } = await api.passkeyRegister(credential, '');
    toast(`'${label}'을(를) 등록했어요. 다음부터 Face ID·지문으로 들어갈 수 있어요.`);
  } catch (e) {
    if (e?.name === 'InvalidStateError') toast('이 기기는 이미 등록되어 있어요.');
    else if (!isCancel(e)) toast(e.message || '등록하지 못했어요.', 'error');
  }
  await render();
}

async function remove(p) {
  const ok = await ask(`'${p.label}' 패스키를 지울까요? 그 기기에서는 비밀번호로 들어가야 해요. (기기에 남은 패스키는 기기 설정의 암호 관리에서 지울 수 있어요)`, [
    { label: '지우기', value: true, kind: 'danger-fill' },
    { label: '취소', value: null, kind: 'ghost' },
  ]);
  if (!ok) return;
  try { await api.deletePasskey(p.id); toast('지웠어요'); } catch (e) { toast(e.message, 'error'); }
  await render();
}

async function toggleLock(on) {
  try {
    if (on) {
      // 켜기 전에 이 기기에서 패스키로 열 수 있는지 한 번 확인한다
      const options = await api.passkeyOptions('lock');
      const credential = await usePasskey(options);
      await api.passkeyVerify('lock', credential);
      toast('켰어요. 몇 분 넘게 안 쓰다가 열면 Face ID·지문을 확인해요.');
    } else {
      await api.setLock(false);
      toast('껐어요. 이 기기에서는 1년 동안 로그인이 유지돼요.');
    }
  } catch (e) {
    if (!isCancel(e)) toast(e.message || '바꾸지 못했어요.', 'error');
  }
  await render();
}
