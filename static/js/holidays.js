// 한국 공휴일: 서버(/api/holidays)에서 1년 단위로 받아 와서 기억해 둔다.
// 월간·주간 화면이 같은 데이터를 쓰므로 한 번 받은 해는 다시 요청하지 않는다.

import { api } from './api.js';

const cache = new Map(); // 2026 → Promise<Map<'YYYY-MM-DD', '이름'>>

function loadYear(year) {
  if (!cache.has(year)) {
    const request = api
      .holidays(`${year}-01-01`, `${year + 1}-01-01`)
      .then((list) => new Map(list.map((h) => [h.date, h.name])))
      .catch(() => {
        cache.delete(year); // 실패하면 다음에 다시 시도
        return new Map();
      });
    cache.set(year, request);
  }
  return cache.get(year);
}

// [start, end) 기간의 공휴일 목록 → [{ date, name }]
export async function holidaysBetween(start, end) {
  const out = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (const [date, name] of await loadYear(y)) {
      if (date >= start && date < end) out.push({ date, name });
    }
  }
  return out;
}
