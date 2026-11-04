// 서버(Flask) API를 부르는 함수 모음. 실패하면 서버가 보낸 한국어 메시지로 Error를 던진다.

// 저장·삭제 응답에 담겨 오는 '변경 번호'를 동기화(sync.js)에 알려 주는 연결 고리
export const hooks = { onVersion: null };

async function request(method, url, body) {
  const options = { method, headers: {} };
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

  // 로그인이 풀렸으면(다른 기기에서 비밀번호를 바꾼 경우 등) 로그인 화면으로
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('로그인이 필요해요.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요. (${res.status})`);
  const version = res.headers.get('X-Data-Version');
  if (version && hooks.onVersion) hooks.onVersion(Number(version));
  return data;
}

const q = (params) => new URLSearchParams(params).toString();

export const api = {
  // 일정
  occurrences: (start, end) => request('GET', `/api/occurrences?${q({ start, end })}`),
  undated: () => request('GET', '/api/items/undated'),
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

  // 마음 노트
  notes: () => request('GET', '/api/notes'),
  createNote: (payload) => request('POST', '/api/notes', payload),
  updateNote: (id, payload) => request('PUT', `/api/notes/${id}`, payload),
  setMainNote: (id) => request('PUT', `/api/notes/${id}/main`),
  deleteNote: (id) => request('DELETE', `/api/notes/${id}`),
  reorderNotes: (ids) => request('PUT', '/api/notes/order', { ids }),

  // 달력 위 띠(배너·D-day), 시간 돌아보기, 빠른 입력
  overview: (today) => request('GET', `/api/overview?${q({ today })}`),
  stats: (start, end) => request('GET', `/api/stats?${q({ start, end })}`),
  parse: (text, today, fallback) => request('GET', `/api/parse?${q({ text, today, ...(fallback ? { default: fallback } : {}) })}`),

  // 동기화
  version: () => request('GET', '/api/version'),

  // 공휴일
  holidays: (start, end) => request('GET', `/api/holidays?${q({ start, end })}`),

  // 카테고리
  categories: () => request('GET', '/api/categories'),
  createCategory: (payload) => request('POST', '/api/categories', payload),
  updateCategory: (id, payload) => request('PUT', `/api/categories/${id}`, payload),
  deleteCategory: (id) => request('DELETE', `/api/categories/${id}`),
};
