// 서버(Flask) API를 부르는 함수 모음. 실패하면 서버가 보낸 한국어 메시지로 Error를 던진다.

// 저장·삭제 응답에 담겨 오는 '변경 번호'를 동기화(sync.js)에 알려 주는 연결 고리
export const hooks = { onVersion: null };

// 사람이 화면을 만졌는지 (0.12.0): 동기화 확인에 'X-Active'로 알려서, '열 때마다 생체 인증'의 잠금 시간을 늦춘다.
// 화면을 그냥 띄워만 두면 몇 분 뒤 잠긴다 (passkeys.py).
let active = false;
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(type, () => { active = true; }, { passive: true, capture: true });
}

// ---------------------------------------------------------------- 받은 내용 기억해 두기 (0.12.1)
// 서버는 읽기 응답마다 '읽기 시작할 때의 변경 번호'를 붙여 준다(X-Data-Version).
// 그 번호가 지금 알고 있는 최신 번호와 같으면 그 뒤로 아무것도 바뀌지 않은 것이므로, 같은 주소는 서버에 다시 묻지 않고
// 기억해 둔 내용을 바로 쓴다 → 가 봤던 달·날짜는 기다림 없이 바로 열린다.
// - 이 기기에서 저장하면(응답의 새 번호) 또는 다른 기기에서 바뀐 것을 알아채면(sync.js) 번호가 바뀌어 기억한 내용은 모두 '옛것'이 된다.
// - 같은 주소를 동시에 두 번 부르면(미리 받기 + 누르기) 한 번만 보낸다.
// - 기억한 내용은 복사본을 돌려준다(부른 쪽이 고쳐도 기억한 내용은 그대로).
let latest = null;          // 지금 알고 있는 최신 변경 번호
const memo = new Map();     // 주소 → { v: 변경 번호, data }
const inflight = new Map(); // 주소 → 보내는 중인 요청
const MEMO_MAX = 80;

const clone = (data) => (typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data)));

/** 동기화 확인(sync.js)이 받은 서버의 지금 번호 */
export function setLatestVersion(v) {
  if (Number.isFinite(v)) latest = v;
}

function raiseVersion(v) {
  if (Number.isFinite(v) && (latest === null || v > latest)) latest = v;
}

function remember(url, v, data) {
  memo.delete(url); // 맨 뒤로 (가장 최근)
  memo.set(url, { v, data });
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
}

// 첫 화면에 필요한 내용은 서버가 페이지에 같이 실어 보낸다 (index.html의 #boot, api_tools.boot_data).
// 받은 내용처럼 기억해 두면, 화면이 처음 부르는 요청들이 서버에 가지 않고 바로 끝난다.
// (기기 날짜가 한국과 다르거나 주소가 달라 글자가 안 맞으면 평소처럼 서버에서 받는다)
export let bootVersion = null;
try {
  const boot = JSON.parse(document.getElementById('boot')?.textContent || 'null');
  if (boot && Number.isFinite(boot.v)) {
    bootVersion = latest = boot.v;
    for (const [url, data] of Object.entries(boot.get)) remember(url, boot.v, data);
  }
} catch {
  // 실린 내용이 깨졌으면 무시하고 평소처럼 받는다
}

/** 기억해 둔 내용이 아직 최신이면 그것을, 아니면 서버에서 받아 온다 */
function cachedGet(url) {
  const hit = memo.get(url);
  if (hit && latest !== null && hit.v === latest) return Promise.resolve(clone(hit.data));
  let pending = inflight.get(url);
  if (!pending) {
    pending = request('GET', url, undefined, { keep: true }).finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return pending.then(clone);
}

/** 화면이 곧 쓸 것 같은 내용을 미리 받아 두기 (실패해도 조용히) */
function prefetchGet(url) {
  const hit = memo.get(url);
  if ((hit && latest !== null && hit.v === latest) || inflight.has(url)) return;
  cachedGet(url).catch(() => {});
}

/**
 * 잠금·로그인 화면으로 떠날 때 (0.13.0): 화면에 있던 일정을 먼저 지우고, 지금 페이지를 방문 기록에서 바꿔 끼운다.
 * '뒤로 가기'를 눌러도 잠그기 전 화면이 되살아나지 않게 한다.
 */
export function leavePage(url) {
  document.body.classList.add('is-leaving');
  for (const node of document.querySelectorAll('.layout, .top-strip, dialog[open]')) node.replaceChildren();
  memo.clear();
  window.location.replace(url);
}

async function request(method, url, body, { poll = false, keep = false, keepalive = false } = {}) {
  const options = { method, headers: {} };
  if (keepalive) options.keepalive = true; // 창을 닫는 중에도 끝까지 보내기 (0.14.0: 일기 자동 저장)
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
    if (data.locked) leavePage(`/unlock${location.search ? `?next=${encodeURIComponent(here)}` : ''}`);
    else leavePage('/login');
    throw new Error(data.error || '로그인이 필요해요.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요. (${res.status})`);
  const header = res.headers.get('X-Data-Version');
  const version = header === null ? NaN : Number(header);
  if (method === 'GET') {
    // 읽기: 그 사이 다른 기기에서 바뀌었으면 번호가 올라가 있다 → 기억한 다른 내용도 옛것이 된다
    raiseVersion(version);
    if (keep && Number.isFinite(version)) remember(url, version, data);
  } else if (Number.isFinite(version)) {
    // 저장·삭제: 기억한 내용은 모두 옛것 + 동기화에 '내가 바꾼 것'이라고 알린다
    raiseVersion(version);
    hooks.onVersion?.(version);
  }
  return data;
}

const q = (params) => new URLSearchParams(params).toString();

/** 곧 열 것 같은 화면의 내용을 미리 받아 둔다 (0.12.1) — 달을 넘기거나 날짜를 누르는 순간 바로 보이게 */
export const prefetch = {
  calendar: (start, end) => prefetchGet(`/api/calendar?${q({ start, end })}`),
  day: (date) => prefetchGet(`/api/day/${date}`),
};

export const api = {
  // 화면별로 묶어 받기 (요청 수 줄이기)
  // (cachedGet: 바뀐 것이 없으면 서버에 다시 묻지 않는다 — 위 '받은 내용 기억해 두기')
  calendar: (start, end) => cachedGet(`/api/calendar?${q({ start, end })}`), // 월간·주간: 일정 + 루틴 기록 + 수업 + 기념일
  day: (date) => cachedGet(`/api/day/${date}`),                              // 하루: 일정 + 루틴 기록 + 루틴 버튼 + 수업 + 기념일
  inbox: () => cachedGet('/api/inbox'),                                       // 메모장: 노트 + 목표 + 할 일 + 프로젝트

  // 일정 (날짜 없는 일정 = 할 일)
  undated: () => request('GET', '/api/items/undated'),
  setDone: (id, done) => request('PUT', `/api/items/${id}/done`, { done }),
  setUrgent: (id, urgent) => request('PUT', `/api/items/${id}/urgent`, { urgent }),   // 급한 할 일 ⚡ (0.13.0)
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
  routines: (date) => cachedGet(date ? `/api/routines?${q({ date })}` : '/api/routines'),
  createRoutine: (payload) => request('POST', '/api/routines', payload),
  updateRoutine: (id, payload) => request('PUT', `/api/routines/${id}`, payload),
  deleteRoutine: (id) => request('DELETE', `/api/routines/${id}`),
  reorderRoutines: (ids) => request('PUT', '/api/routines/order', { ids }),

  // 루틴 기록 (일정과 따로 저장) — 읽기는 calendar / day로 함께 받는다
  createRoutineLog: (payload) => request('POST', '/api/routine-logs', payload),
  updateRoutineLog: (id, payload) => request('PUT', `/api/routine-logs/${id}`, payload),
  deleteRoutineLog: (id) => request('DELETE', `/api/routine-logs/${id}`),

  // 메모장 — 노트 (주소는 예전 이름 그대로 notes)
  notes: () => request('GET', '/api/notes'),
  createNote: (payload) => request('POST', '/api/notes', payload),
  updateNote: (id, payload) => request('PUT', `/api/notes/${id}`, payload),
  setMainNote: (id) => request('PUT', `/api/notes/${id}/main`),
  deleteNote: (id) => request('DELETE', `/api/notes/${id}`),
  reorderNotes: (ids) => request('PUT', '/api/notes/order', { ids }),

  // 메모장 — 목표
  createGoal: (payload) => request('POST', '/api/goals', payload),
  updateGoal: (id, payload) => request('PUT', `/api/goals/${id}`, payload),
  deleteGoal: (id) => request('DELETE', `/api/goals/${id}`),
  reorderGoals: (ids) => request('PUT', '/api/goals/order', { ids }),
  stepGoal: (id, delta = 1) => request('POST', `/api/goals/${id}/step`, { delta }), // 숫자 목표 +1 (0.11.0)

  // 습관 (0.13.0)
  habits: (today) => cachedGet(`/api/habits?${q({ today })}`),
  createHabit: (payload) => request('POST', '/api/habits', payload),
  updateHabit: (id, payload) => request('PUT', `/api/habits/${id}`, payload),
  deleteHabit: (id) => request('DELETE', `/api/habits/${id}`),
  reorderHabits: (ids) => request('PUT', '/api/habits/order', { ids }),
  stepHabit: (id, date, delta) => request('POST', `/api/habits/${id}/step`, { date, delta }),

  // 프로젝트 (0.13.0) — 목록은 inbox로 함께 받는다
  project: (id, today) => cachedGet(`/api/projects/${id}?${q({ today })}`),
  createProject: (payload, today) => request('POST', `/api/projects?${q({ today })}`, payload),
  updateProject: (id, payload, today) => request('PUT', `/api/projects/${id}?${q({ today })}`, payload),
  deleteProject: (id, tasks = 'keep') => request('DELETE', `/api/projects/${id}?${q({ tasks })}`),
  reorderProjects: (ids) => request('PUT', '/api/projects/order', { ids }),

  // 기념일 (0.13.0) — 달력에 보이는 날짜는 calendar / day로 함께 받는다
  anniversaries: (today) => cachedGet(`/api/anniversaries?${q({ today })}`),
  createAnniversary: (payload) => request('POST', '/api/anniversaries', payload),
  updateAnniversary: (id, payload) => request('PUT', `/api/anniversaries/${id}`, payload),
  deleteAnniversary: (id) => request('DELETE', `/api/anniversaries/${id}`),

  // 시간표 (0.13.0) — 달력에 보이는 수업은 calendar / day로 함께 받는다
  timetables: () => cachedGet('/api/timetables'),
  createTimetable: (payload) => request('POST', '/api/timetables', payload),
  updateTimetable: (id, payload) => request('PUT', `/api/timetables/${id}`, payload),
  deleteTimetable: (id) => request('DELETE', `/api/timetables/${id}`),
  createBlocks: (timetableId, payload) => request('POST', `/api/timetables/${timetableId}/blocks`, payload),
  updateBlock: (id, payload) => request('PUT', `/api/timetable-blocks/${id}`, payload),
  deleteBlock: (id) => request('DELETE', `/api/timetable-blocks/${id}`),
  setSkip: (payload) => request('PUT', '/api/timetable-skips', payload),
  importCandidates: () => request('GET', '/api/timetable/import'),
  importItems: (payload) => request('POST', '/api/timetable/import', payload),

  // 캘린더만 잠그기 (0.13.0) — /auth/lock 아래 (lock.py)
  lockSettings: () => request('GET', '/auth/lock'),
  lockNow: () => request('POST', '/auth/lock/now'),
  updateLock: (payload) => request('PUT', '/auth/lock/settings', payload),
  setPin: (pin, password) => request('POST', '/auth/lock/pin', { pin, password }),
  deletePin: () => request('DELETE', '/auth/lock/pin'),

  // 달력 꾸미기 (0.11.0): 날짜 스티커 — 읽기는 calendar / day로 함께 받는다
  setMark: (date, payload) => request('PUT', `/api/days/${date}/mark`, payload),

  // 달력 위 띠(배너·D-day), 빠른 입력
  overview: (today) => cachedGet(`/api/overview?${q({ today })}`),
  parse: (text, today) => request('GET', `/api/parse?${q({ text, today })}`),

  // 0.14.0: 일기 (달력의 표시는 calendar, 하루 화면은 day로 함께 받는다), 검색, 백업
  diaries: (before = '', limit = 40) => request('GET', `/api/diaries?${q({ before, limit })}`),
  diary: (date) => request('GET', `/api/diaries/${date}`),
  saveDiary: (date, payload, opts) => request('PUT', `/api/diaries/${date}`, payload, opts),
  deleteDiary: (date) => request('DELETE', `/api/diaries/${date}`),
  search: (text, today) => request('GET', `/api/search?${q({ q: text, today })}`),
  restoreBackup: (data) => request('POST', '/api/backup/restore', data),

  // 0.14.2: 메모장의 '나' (about.py)
  about: () => request('GET', '/api/about'),
  createAbout: (payload) => request('POST', '/api/about', payload),
  saveAbout: (id, payload, opts) => request('PUT', `/api/about/${id}`, payload, opts),
  deleteAbout: (id) => request('DELETE', `/api/about/${id}`),
  orderAbout: (ids) => request('PUT', '/api/about/order', { ids }),
  // 0.14.2: 메모장의 '살 것' (wishlist.py)
  wishlist: () => request('GET', '/api/wishlist'),
  createWish: (payload) => request('POST', '/api/wishlist', payload),
  updateWish: (id, payload) => request('PUT', `/api/wishlist/${id}`, payload),
  deleteWish: (id) => request('DELETE', `/api/wishlist/${id}`),

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
  holidays: (start, end) => cachedGet(`/api/holidays?${q({ start, end })}`),

  // 카테고리
  categories: () => cachedGet('/api/categories'),
  createCategory: (payload) => request('POST', '/api/categories', payload),
  updateCategory: (id, payload) => request('PUT', `/api/categories/${id}`, payload),
  deleteCategory: (id) => request('DELETE', `/api/categories/${id}`),
};
