// 서버(Flask) API를 부르는 함수 모음. 실패하면 서버가 보낸 한국어 메시지로 Error를 던진다.

// 저장·삭제 응답에 담겨 오는 '변경 번호'를 동기화(sync.js)에 알려 주는 연결 고리
export const hooks = { onVersion: null };

// 사람이 화면을 만졌는지 (0.12.0): 동기화 확인에 'X-Active'로 알려서, '열 때마다 생체 인증'의 잠금 시간을 늦춘다.
// 화면을 그냥 띄워만 두면 몇 분 뒤 잠긴다 (passkeys.py).
let active = false;
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(type, () => { active = true; }, { passive: true, capture: true });
}

async function request(method, url, body, { poll = false } = {}) {
  const options = { method, headers: {} };
  if (poll && active) {
    options.headers['X-Active'] = '1';
    active = false;
  }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
  }

  // 로그인이 풀렸으면(다른 기기에서 비밀번호를 바꾼 경우 등) 로그인 화면으로.
  // '열 때마다 생체 인증'으로 잠겼으면 잠금 화면으로 (보던 화면 주소를 기억해서 연 뒤에 돌아온다)
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    const here = `${location.pathname}${location.search}`;
    if (data.locked) window.location.href = `/unlock${location.search ? `?next=${encodeURIComponent(here)}` : ''}`;
    else window.location.href = '/login';
    throw new Error(data.error || '로그인이 필요해요.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요. (${res.status})`);
  const version = res.headers.get('X-Data-Version');
  if (version && hooks.onVersion) hooks.onVersion(Number(version));
  return data;
}

const q = (params) => new URLSearchParams(params).toString();

export const api = {
  // 화면별로 묶어 받기 (요청 수 줄이기)
  calendar: (start, end) => request('GET', `/api/calendar?${q({ start, end })}`), // 월간·주간: 일정 + 루틴 기록
  day: (date) => request('GET', `/api/day/${date}`),                              // 하루: 일정 + 루틴 기록 + 루틴 버튼
  inbox: () => request('GET', '/api/inbox'),                                       // 기록지: 메모 + 목표 + 할 일

  // 일정 (날짜 없는 일정 = 할 일)
  undated: () => request('GET', '/api/items/undated'),
  setDone: (id, done) => request('PUT', `/api/items/${id}/done`, { done }),
  clearDone: () => request('DELETE', '/api/items/done'),
  getItem: (id) => request('GET', `/api/items/${id}`),
  createItem: (payload) => request('POST', '/api/items', payload),
  updateItem: (id, payload) => request('PUT', `/api/items/${id}`, payload),
  deleteItem: (id, scope = 'all', date = '') =>
    request('DELETE', `/api/items/${id}?${q({ scope, date })}`),
  reorderDay: (date, itemIds) => request('PUT', `/api/days/${date}/order`, { item_ids: itemIds }),
  moveItem: (id, from, to) => request('POST', `/api/items/${id}/move`, { from, to }),
  copyItem: (id, dates) => request('POST', `/api/items/${id}/copy`, { dates }),

  // 루틴
  routines: (date) => request('GET', date ? `/api/routines?${q({ date })}` : '/api/routines'),
  createRoutine: (payload) => request('POST', '/api/routines', payload),
  updateRoutine: (id, payload) => request('PUT', `/api/routines/${id}`, payload),
  deleteRoutine: (id) => request('DELETE', `/api/routines/${id}`),
  reorderRoutines: (ids) => request('PUT', '/api/routines/order', { ids }),

  // 루틴 기록 (일정과 따로 저장) — 읽기는 calendar / day로 함께 받는다
  createRoutineLog: (payload) => request('POST', '/api/routine-logs', payload),
  updateRoutineLog: (id, payload) => request('PUT', `/api/routine-logs/${id}`, payload),
  deleteRoutineLog: (id) => request('DELETE', `/api/routine-logs/${id}`),

  // 기록지 — 메모
  notes: () => request('GET', '/api/notes'),
  createNote: (payload) => request('POST', '/api/notes', payload),
  updateNote: (id, payload) => request('PUT', `/api/notes/${id}`, payload),
  setMainNote: (id) => request('PUT', `/api/notes/${id}/main`),
  deleteNote: (id) => request('DELETE', `/api/notes/${id}`),
  reorderNotes: (ids) => request('PUT', '/api/notes/order', { ids }),

  // 기록지 — 목표
  createGoal: (payload) => request('POST', '/api/goals', payload),
  updateGoal: (id, payload) => request('PUT', `/api/goals/${id}`, payload),
  deleteGoal: (id) => request('DELETE', `/api/goals/${id}`),
  reorderGoals: (ids) => request('PUT', '/api/goals/order', { ids }),
  stepGoal: (id, delta = 1) => request('POST', `/api/goals/${id}/step`, { delta }), // 숫자 목표 +1 (0.11.0)

  // 달력 꾸미기 (0.11.0): 날짜 스티커·형광펜 — 읽기는 calendar / day로 함께 받는다
  setMark: (date, payload) => request('PUT', `/api/days/${date}/mark`, payload),

  // 달력 위 띠(배너·D-day), 시간 돌아보기, 빠른 입력
  overview: (today) => request('GET', `/api/overview?${q({ today })}`),
  stats: (start, end) => request('GET', `/api/stats?${q({ start, end })}`),
  parse: (text, today) => request('GET', `/api/parse?${q({ text, today })}`),

  // 동기화
  version: () => request('GET', '/api/version', undefined, { poll: true }),

  // 공유 링크·캘린더 구독·홈 화면 위젯 (0.12.0)
  links: () => request('GET', '/api/links'),
  createLink: (payload) => request('POST', '/api/links', payload),
  updateLink: (id, payload) => request('PUT', `/api/links/${id}`, payload),
  deleteLink: (id) => request('DELETE', `/api/links/${id}`),

  // 패스키 (0.12.0) — /auth/passkey 아래 (passkeys.py)
  passkeys: () => request('GET', '/auth/passkey/list'),
  passkeyRegisterOptions: () => request('POST', '/auth/passkey/register/options', {}),
  passkeyRegister: (credential, label) => request('POST', '/auth/passkey/register/verify', { credential, label }),
  deletePasskey: (id) => request('DELETE', `/auth/passkey/${id}`),
  passkeyOptions: (purpose) => request('POST', '/auth/passkey/options', { purpose }),
  passkeyVerify: (purpose, credential) => request('POST', '/auth/passkey/verify', { purpose, credential }),
  setLock: (on) => request('POST', '/auth/passkey/lock', { on }),

  // 공휴일
  holidays: (start, end) => request('GET', `/api/holidays?${q({ start, end })}`),

  // 카테고리
  categories: () => request('GET', '/api/categories'),
  createCategory: (payload) => request('POST', '/api/categories', payload),
  updateCategory: (id, payload) => request('PUT', `/api/categories/${id}`, payload),
  deleteCategory: (id) => request('DELETE', `/api/categories/${id}`),
};
