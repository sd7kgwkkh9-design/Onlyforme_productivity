// 잠금 · 패스키 창 — ⚙ 설정의 '잠금 · 패스키…' (0.12.0 'Face ID·패스키', 0.13.0에서 잠금 설정을 더함)
//
// 0.13.0 캘린더만 잠그기 (서버는 lock.py) — 설정은 이 기기(브라우저)에만 적용된다:
//   - 🔒 지금 잠그기 (단축키 L)
//   - 자동 잠금: 끔 / 1·3·5·10·15·30분 동안 안 쓰면 잠금
//   - PIN: 숫자 4~8자리로 잠금 풀기 (정하거나 바꿀 때 비밀번호를 한 번 더 확인). 5번 틀리면 그 기기에서는 비밀번호로만
//   - 공용 PC 모드: 브라우저를 닫으면 로그아웃, 이 기기에 띠 내용 등을 남기지 않음
//   - 자리를 비우면 가리기: 캘린더 창을 떠나면 흐리게 가림
// 0.12.0 패스키:
//   - 이 기기를 패스키로 등록하면, 로그인·잠금 화면에서 Face ID·지문·기기 암호로 들어간다.

import { api } from './api.js';
import { ask, el, toast } from './utils.js';
import { createPasskey, isCancel, passkeySupported } from './webauthn.js';

let dialog = null;
let inner = null;   // 창 안의 내용 (창 자체를 비우면 그 안으로 옮겨 둔 알림(toast)까지 지워져서 따로 둔다)
let pinOpen = false;

export async function openSecurity() {
  if (!dialog) {
    dialog = el('dialog', { class: 'security', 'aria-labelledby': 'security-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    inner = el('div', { class: 'dlg-inner' });
    dialog.append(inner);
    document.body.append(dialog);
  }
  pinOpen = false;
  if (!dialog.open) dialog.showModal();
  await render();
}

function stamp(s) {
  if (!s) return '';
  const [d, t] = s.split(' ');
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)} ${t.slice(0, 5)}`;
}

function announce(lock) {
  // main.js(가리기·L 키)와 settings.js(메뉴 표시)에 알려 준다
  window.dispatchEvent(new CustomEvent('lock-config', { detail: { auto: lock.auto, minutes: lock.minutes, public: lock.public, blur: lock.blur } }));
  document.body.dataset.lock = JSON.stringify({ login: lock.login, auto: lock.auto, minutes: lock.minutes, public: lock.public, blur: lock.blur });
}

async function render() {
  let info;
  let lock;
  try { [info, lock] = await Promise.all([api.passkeys(), api.lockSettings()]); } catch (e) { toast(e.message, 'error'); return; }
  const supported = passkeySupported();
  const { passkeys } = info;

  const save = async (payload, message) => {
    try {
      const next = await api.updateLock(payload);
      announce(next);
      if (message) toast(message);
    } catch (e) { toast(e.message, 'error'); }
    await render();
  };

  const toggle = (label, hint, on, onClick) => el('button', {
    type: 'button', role: 'switch', class: 'menu-choice menu-switch sec-switch', 'aria-checked': String(on), onclick: onClick,
  },
    el('span', { class: 'menu-switch-text' }, el('b', {}, label), el('small', {}, hint)),
    el('span', { class: 'switch', 'aria-hidden': 'true' }));

  // 자동 잠금: [끔] [1분] [3분] …
  const autoSeg = el('div', { class: 'seg sec-auto', role: 'group', 'aria-label': '자동 잠금' },
    el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(!lock.auto), onclick: () => lock.auto && save({ auto: false }, '자동 잠금을 껐어요') }, '끔'),
    lock.choices.map((m) => el('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(lock.auto && lock.minutes === m),
      onclick: () => save({ auto: true, minutes: m }, `${m}분 동안 안 쓰면 잠가요 (이 기기)`),
    }, `${m}분`)));

  // PIN
  const pinBox = pinForm(lock);

  inner.replaceChildren(
    el('header', { class: 'lk-head' },
      el('h2', { id: 'security-title' }, '잠금 · 패스키'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    el('div', { class: 'lk-body' },
      // ---- 캘린더만 잠그기 (0.13.0)
      el('section', { class: 'sec-block' },
        el('h3', { class: 'sec-title' }, '캘린더만 잠그기'),
        el('p', { class: 'lk-intro' }, '회사·학교 컴퓨터에 띄워 두고 잠깐 자리를 비울 때, 컴퓨터 전체 대신 이 캘린더만 잠가요. 잠긴 동안에는 새로 고침해도 일정이 보이지 않아요.'),
        el('button', {
          type: 'button', class: 'btn primary', onclick: () => { dialog.close(); document.getElementById('btn-lock')?.click(); },
        }, '🔒 지금 잠그기', el('span', { class: 'kbd' }, 'L')),
        el('p', { class: 'label sec-label' }, '안 쓰면 자동으로 잠그기 (이 기기)'),
        autoSeg,
        pinBox,
        toggle('공용 PC 모드 (이 기기)',
          '브라우저를 닫으면 로그아웃돼요. 첫 화면의 띠 내용도 이 기기에 남기지 않아요. 회사·학교 컴퓨터에서 켜 두세요.',
          lock.public, () => save({ public: !lock.public, ...(lock.public ? {} : { auto: true, minutes: lock.auto ? lock.minutes : 3, blur: true }) },
            lock.public ? '공용 PC 모드를 껐어요. 이 기기에서 1년 동안 로그인이 유지돼요.' : '공용 PC 모드를 켰어요. 3분 자동 잠금과 가리기도 같이 켰어요.')),
        toggle('자리를 비우면 가리기 (이 기기)',
          '캘린더 창을 떠나면(다른 창·탭을 누르면) 화면을 흐리게 가려요. 누르면 다시 보여요.',
          lock.blur, () => save({ blur: !lock.blur }, lock.blur ? '가리기를 껐어요' : '이 창을 떠나면 가릴게요')),
        el('p', { class: 'lk-note' }, '브라우저에 이 사이트 비밀번호를 저장해 두면 누구나 로그인할 수 있어요. 공용 컴퓨터에서는 저장하지 마세요.'),
      ),
      // ---- 패스키 (0.12.0)
      el('section', { class: 'sec-block' },
        el('h3', { class: 'sec-title' }, 'Face ID · 패스키'),
        el('p', { class: 'lk-intro' },
          '패스키를 등록하면 비밀번호 대신 ', el('b', {}, 'Face ID · Touch ID · 지문 · Windows Hello'), '로 들어가고 잠금을 풀어요. ',
          '아이클라우드 키체인을 쓰면 아이폰에서 등록한 패스키가 맥에서도 돼요.'),
        supported ? null : el('p', { class: 'lk-note' }, '이 브라우저(또는 http 주소)에서는 패스키를 쓸 수 없어요. 아이폰·맥 Safari, Chrome, Edge의 https 주소에서 열어 주세요.'),
        passkeys.length
          ? el('ul', { class: 'lk-list' }, passkeys.map((p) => el('li', { class: 'sec-item' },
              el('span', { class: 'sec-icon', 'aria-hidden': 'true' }, '🔑'),
              el('span', { class: 'sec-main' },
                el('b', {}, p.label),
                el('span', {}, `등록 ${stamp(p.created_at)}${p.last_used_at ? ` · 마지막 사용 ${stamp(p.last_used_at)}` : ''}`)),
              el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => remove(p) }, '지우기'))))
          : el('p', { class: 'lk-empty' }, '아직 등록한 패스키가 없어요.'),
        supported ? el('button', { type: 'button', class: 'btn', onclick: register }, '이 기기 등록 (Face ID · 지문)') : null,
        el('p', { class: 'lk-note' },
          `패스키는 지금 주소(${location.host})에 묶여요. 서버 주소가 바뀌면 다시 등록해야 해요. `,
          '기기를 잃어버렸다면 여기서 그 기기의 패스키를 지우세요.'),
      ),
    ),
  );
}

function pinForm(lock) {
  const wrap = el('div', { class: 'sec-pin' });
  const head = el('div', { class: 'sec-pin-head' },
    el('span', { class: 'sec-pin-text' }, el('b', {}, 'PIN으로 열기'),
      el('small', {}, lock.pin ? '잠금 화면에서 숫자로 열어요. 5번 틀리면 그 기기에서는 비밀번호로만 열려요.' : '정해 두면 잠금 화면에서 비밀번호 대신 숫자 4~8자리로 열어요.')),
    lock.pin ? el('span', { class: 'sec-pin-state' }, '켬') : null,
    el('button', { type: 'button', class: 'btn sm', onclick: () => { pinOpen = !pinOpen; render(); } }, lock.pin ? '바꾸기' : 'PIN 정하기'),
    lock.pin ? el('button', { type: 'button', class: 'btn sm ghost danger', onclick: removePin }, '없애기') : null);
  wrap.append(head);
  if (pinOpen) {
    const pin = el('input', { type: 'password', class: 'input', inputmode: 'numeric', maxlength: '8', autocomplete: 'off', placeholder: '숫자 4~8자리', 'aria-label': '새 PIN' });
    const again = el('input', { type: 'password', class: 'input', inputmode: 'numeric', maxlength: '8', autocomplete: 'off', placeholder: '한 번 더', 'aria-label': 'PIN 한 번 더' });
    const password = el('input', { type: 'password', class: 'input', autocomplete: 'current-password', placeholder: '로그인 비밀번호', 'aria-label': '로그인 비밀번호' });
    const err = el('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = el('form', { class: 'sec-pin-form', novalidate: true },
      pin, again, password, el('button', { type: 'submit', class: 'btn primary' }, '저장'), err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pin.value !== again.value) { err.textContent = '두 PIN이 달라요.'; err.hidden = false; return; }
      try {
        await api.setPin(pin.value, password.value);
        pinOpen = false;
        toast('PIN을 정했어요. 잠금 화면에서 숫자로 열 수 있어요.');
        await render();
      } catch (er) { err.textContent = er.message; err.hidden = false; }
    });
    wrap.append(form);
    setTimeout(() => pin.focus());
  }
  return wrap;
}

async function removePin() {
  const ok = await ask('PIN을 없앨까요? 잠금 화면에서는 비밀번호나 패스키로 열어야 해요.', [
    { label: '없애기', value: true, kind: 'danger-fill' },
    { label: '취소', value: null, kind: 'ghost' },
  ]);
  if (!ok) return;
  try { await api.deletePin(); toast('PIN을 없앴어요'); } catch (e) { toast(e.message, 'error'); }
  await render();
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
