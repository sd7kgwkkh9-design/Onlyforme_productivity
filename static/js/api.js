// 서버(Flask) API를 부르는 함수 모음. 실패하면 서버가 보낸 한국어 메시지로 Error를 던진다.

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
    throw new Error('서버에 연결할 수 없어요. 앱(python app.py)이 켜져 있는지 확인해 주세요.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요. (${res.status})`);
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

  // 공휴일
  holidays: (start, end) => request('GET', `/api/holidays?${q({ start, end })}`),

  // 카테고리
  categories: () => request('GET', '/api/categories'),
  createCategory: (payload) => request('POST', '/api/categories', payload),
  updateCategory: (id, payload) => request('PUT', `/api/categories/${id}`, payload),
  deleteCategory: (id) => request('DELETE', `/api/categories/${id}`),
};
