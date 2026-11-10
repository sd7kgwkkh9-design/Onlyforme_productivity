// 날씨 (0.10.0) — 오픈소스 날씨 서비스 Open-Meteo (https://open-meteo.com)
//
// - 오늘부터 일주일의 날씨(아이콘·최고/최저 기온·비 올 확률)를 달력 칸과 하루 화면에 보여 준다.
// - 위치는 서울로 고정 (위치 권한을 묻지 않는다). 바꾸려면 아래 PLACE만 고치면 된다.
// - 브라우저가 Open-Meteo에 직접 물어본다 → 우리 서버는 하는 일이 없다. API 키도 필요 없다(비상업 무료).
// - 받은 결과는 이 기기에 3시간 동안 기억해 두고 다시 묻지 않는다.
// - 인터넷이 안 되거나 못 받아 오면 아무것도 표시하지 않는다 (날씨는 '있으면 좋은' 정보라서).
// - 날씨 데이터 라이선스: CC BY 4.0 — 출처(Open-Meteo.com)를 화면과 README에 표시한다.

import { el } from './utils.js';

export const PLACE = { name: '서울', latitude: 37.5665, longitude: 126.978 };
const CACHE_KEY = 'my-calendar:weather';
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const DAYS = 7;
export const SOURCE_URL = 'https://open-meteo.com/';

// WMO 날씨 코드 → [아이콘, 설명]
const CODES = [
  [[0], '☀️', '맑음'],
  [[1], '🌤️', '대체로 맑음'],
  [[2], '⛅', '구름 조금'],
  [[3], '☁️', '흐림'],
  [[45, 48], '🌫️', '안개'],
  [[51, 53, 55, 56, 57], '🌦️', '이슬비'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', '비'],
  [[71, 73, 75, 77, 85, 86], '🌨️', '눈'],
  [[95, 96, 99], '⛈️', '뇌우'],
];

export function describe(code) {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return hit ? { icon: hit[1], text: hit[2] } : { icon: '🌡️', text: '날씨' };
}

let days = {};          // 'YYYY-MM-DD' → { code, max, min, rain }
let loading = null;
const listeners = new Set();

/** 날씨가 새로 들어오면 부를 함수 (달력 칸 다시 칠하기 등) */
export function onWeather(fn) { listeners.add(fn); }

/** 그 날짜의 날씨 (없으면 null) */
export function weatherOf(date) { return days[date] || null; }

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.place === PLACE.name && Date.now() - c.at < MAX_AGE_MS) return c.days;
  } catch { /* 무시 */ }
  return null;
}

function writeCache(value) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ place: PLACE.name, at: Date.now(), days: value })); } catch { /* 무시 */ }
}

/** 기억해 둔 게 있으면 그것을, 오래됐으면 새로 받아 온다. 실패해도 조용히 넘어간다. */
export function loadWeather({ force = false } = {}) {
  const cached = !force && readCache();
  if (cached) {
    days = cached;
    listeners.forEach((fn) => fn());
    return Promise.resolve(days);
  }
  if (loading) return loading;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${PLACE.latitude}&longitude=${PLACE.longitude}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + `&timezone=Asia%2FSeoul&forecast_days=${DAYS}`;
  loading = fetch(url, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => {
      const d = data.daily;
      const next = {};
      d.time.forEach((date, i) => {
        next[date] = {
          code: d.weather_code[i],
          max: Math.round(d.temperature_2m_max[i]),
          min: Math.round(d.temperature_2m_min[i]),
          rain: d.precipitation_probability_max?.[i] ?? null,
        };
      });
      days = next;
      writeCache(next);
      listeners.forEach((fn) => fn());
      return days;
    })
    .catch(() => days) // 못 받아 오면 표시하지 않는다
    .finally(() => { loading = null; });
  return loading;
}

const rainText = (w) => (w.rain != null && w.rain >= 30 ? `비 ${w.rain}%` : '');

/** 달력 칸 안의 작은 날씨 (아이콘 + 최고/최저) */
export function weatherBadge(date) {
  const w = weatherOf(date);
  if (!w) return null;
  const { icon, text } = describe(w.code);
  const title = `${PLACE.name} ${text} · 최고 ${w.max}° 최저 ${w.min}°${w.rain != null ? ` · 비 올 확률 ${w.rain}%` : ''} (Open-Meteo)`;
  return el('span', { class: 'wx', title, 'aria-label': title },
    el('span', { class: 'wx-icon', 'aria-hidden': 'true' }, icon),
    el('span', { class: 'wx-temp', 'aria-hidden': 'true' }, `${w.max}°`, el('span', { class: 'wx-min' }, `/${w.min}°`)),
  );
}

/** 하루 화면 제목 아래 한 줄 (아이콘 설명 · 기온 · 비 올 확률 · 출처) */
export function weatherLine(date) {
  const w = weatherOf(date);
  if (!w) return null;
  const { icon, text } = describe(w.code);
  const rain = rainText(w) || (w.rain != null ? `비 ${w.rain}%` : '');
  return el('p', { class: 'wx-line' },
    el('span', { 'aria-hidden': 'true' }, icon),
    el('span', {}, `${PLACE.name} ${text} · ${w.max}° / ${w.min}°${rain ? ` · ${rain}` : ''}`),
    el('a', { class: 'wx-source', href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'Open-Meteo'),
  );
}

/** 월간 화면: 날짜 칸 위쪽(날짜 숫자 옆)에 날씨를 넣는다. 이미 있으면 바꾼다. */
export function decorateMonthCell(td) {
  const date = td.dataset.date;
  const top = td.querySelector('.fc-daygrid-day-top');
  if (!date || !top) return;
  top.querySelector('.wx')?.remove();
  const badge = weatherBadge(date);
  if (badge) top.append(badge);
}

export function decorateMonth(root) {
  root.querySelectorAll('td.fc-daygrid-day[data-date]').forEach(decorateMonthCell);
}

/** 주간 화면: 날짜 머리(가로 배치는 '월 10', 세로 배치는 '10 월요일') 옆에 날씨를 넣는다. */
export function decorateWeek(root) {
  root.querySelectorAll('[data-date]').forEach((day) => {
    const head = day.querySelector('.wk-col-head, .wk-date');
    if (!head) return;
    head.querySelector('.wx')?.remove();
    const badge = weatherBadge(day.dataset.date);
    if (badge) head.append(badge);
  });
}

// 화면으로 돌아왔을 때 3시간이 지났으면 새로 받아 온다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadWeather();
});
