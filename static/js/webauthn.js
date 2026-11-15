// 패스키(WebAuthn) 브라우저 쪽 도우미 (0.12.0)
//
// 서버(py_webauthn)는 옵션을 JSON으로 보내는데, 바이트 값은 base64url 글자로 들어 있다.
// 브라우저의 navigator.credentials는 바이트(ArrayBuffer)를 원하므로 서로 바꿔 준다.
// (최신 브라우저에는 PublicKeyCredential.parseCreationOptionsFromJSON이 있지만 아이폰 예전 버전을 위해 직접 바꾼다)
//
// 이 파일은 다른 모듈을 불러오지 않는다 → 로그인 화면(gate.js)에서도 그대로 쓴다.

const toBytes = (b64url) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
};
const toB64url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 이 브라우저가 패스키를 쓸 수 있는지 */
export function passkeySupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials?.create && window.isSecureContext);
}

/** 서버의 등록 옵션(JSON) → 새 패스키 만들기 → 서버에 보낼 JSON */
export async function createPasskey(options) {
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    user: { ...options.user, id: toBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: toBytes(c.id) })),
  };
  const cred = await navigator.credentials.create({ publicKey });
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      attestationObject: toB64url(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

/** 서버의 확인 옵션(JSON) → Face ID·지문으로 서명 → 서버에 보낼 JSON */
export async function usePasskey(options) {
  const publicKey = {
    ...options,
    challenge: toBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: toBytes(c.id) })),
  };
  const cred = await navigator.credentials.get({ publicKey });
  const r = cred.response;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: toB64url(r.clientDataJSON),
      authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature),
      userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

/** 사용자가 창을 닫았거나 시간이 지난 경우 (오류로 알리지 않아도 되는 경우) */
export function isCancel(e) {
  return e?.name === 'NotAllowedError' || e?.name === 'AbortError';
}
