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
// 기간이 해를 넘어가면(12월 화면은 1월 초까지 보인다) 두 해를 동시에 받는다.
// end는 그날을 포함하지 않으므로 'YYYY-01-01'로 끝나면 그 해는 받지 않는다.
export async function holidaysBetween(start, end) {
  const first = Number(start.slice(0, 4));
  const last = Number(end.slice(0, 4)) - (end.slice(5) === '01-01' ? 1 : 0);
  const years = [];
  for (let y = first; y <= last; y++) years.push(loadYear(y));
  return (await Promise.all(years))
    .flatMap((map) => [...map])
    .filter(([date]) => date >= start && date < end)
    .map(([date, name]) => ({ date, name }));
}
