// 날씨 (0.10.0) — 오픈소스 날씨 서비스 Open-Meteo (https://open-meteo.com)
//
// - 오늘부터 일주일의 날씨(아이콘·최고/최저 기온·비 올 확률)를 달력 칸과 하루 화면에 보여 준다.
// - 위치는 서울로 고정 (위치 권한을 묻지 않는다). 바꾸려면 아래 PLACE만 고치면 된다.
// - 브라우저가 Open-Meteo에 직접 물어본다 → 우리 서버는 하는 일이 없다. API 키도 필요 없다(비상업 무료).
// - 받은 결과는 이 기기에 3시간 동안 기억해 두고 다시 묻지 않는다.
// - 0.11.0: 시간별 예보도 함께 받는다 → 일정 시간의 날씨(하루 화면의 일정 옆, 비 올 확률이 높은 일정의 ☂),
//   오늘 비 소식(달력 위 띠), 월간 칸의 강수확률.
// - 인터넷이 안 되거나 못 받아 오면 아무것도 표시하지 않는다 (날씨는 '있으면 좋은' 정보라서).
// - 날씨 데이터 라이선스: CC BY 4.0 — 출처(Open-Meteo.com)를 화면과 README에 표시한다.

import { el } from './utils.js';

export const PLACE = { name: '서울', latitude: 37.5665, longitude: 126.978 };
const CACHE_KEY = 'my-calendar:weather-v2'; // v2: 시간별 예보 포함 (0.11.0)
const RAINY = 50;   // 이 확률(%) 이상이면 '비 소식'으로 본다
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

let days = {};          // 'YYYY-MM-DD' → { code, max, min, rain, hours: [[code, 기온, 강수확률] × 24] }
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
    + '&hourly=weather_code,temperature_2m,precipitation_probability'
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
          hours: [],
        };
      });
      // 시간별: '2026-11-12T15:00' → 그 날짜의 15번째 칸
      const h = data.hourly;
      (h?.time || []).forEach((stamp, i) => {
        const day = next[stamp.slice(0, 10)];
        if (!day) return;
        day.hours[Number(stamp.slice(11, 13))] = [h.weather_code[i], Math.round(h.temperature_2m[i]), h.precipitation_probability?.[i] ?? null];
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

/** 달력 칸 안의 작은 날씨 (아이콘 + 최고/최저 + 강수확률). 칸이 좁으면 최저기온부터 숨긴다 (style.css) */
export function weatherBadge(date) {
  const w = weatherOf(date);
  if (!w) return null;
  const { icon, text } = describe(w.code);
  const title = `${PLACE.name} ${text} · 최고 ${w.max}° 최저 ${w.min}°${w.rain != null ? ` · 비 올 확률 ${w.rain}%` : ''} (Open-Meteo)`;
  return el('span', { class: 'wx', title, 'aria-label': title },
    el('span', { class: 'wx-icon', 'aria-hidden': 'true' }, icon),
    el('span', { class: 'wx-temp', 'aria-hidden': 'true' }, `${w.max}°`, el('span', { class: 'wx-min' }, `/${w.min}°`)),
    w.rain != null
      ? el('span', { class: w.rain >= RAINY ? 'wx-rain is-rainy' : 'wx-rain', 'aria-hidden': 'true' }, `${w.rain}%`)
      : null,
  );
}

// ---------------------------------------------------------------- 시간별 (0.11.0)
/** 그 날짜 그 시각('HH:MM')의 날씨 { code, temp, rain } (없으면 null) */
export function weatherAt(date, time) {
  const slot = weatherOf(date)?.hours?.[Number(String(time || '').slice(0, 2))];
  return slot && time ? { code: slot[0], temp: slot[1], rain: slot[2] } : null;
}

/**
 * 일정 시간의 날씨 표시.
 *   compact=false (하루 목록): 🌧️ 14° · 70%
 *   compact=true  (달력 칸)  : 비 올 확률이 높을 때만 ☂
 */
export function timedBadge(date, time, { compact = false } = {}) {
  const w = weatherAt(date, time);
  if (!w) return null;
  const { icon, text } = describe(w.code);
  const rainy = w.rain != null && w.rain >= RAINY;
  const title = `${time} ${PLACE.name} ${text} · ${w.temp}°${w.rain != null ? ` · 비 올 확률 ${w.rain}%` : ''} (Open-Meteo)`;
  if (compact) return rainy ? el('span', { class: 'wx-ev is-rainy', title, 'aria-label': title }, '☂') : null;
  return el('span', { class: rainy ? 'wx-ev is-rainy' : 'wx-ev', title, 'aria-label': title },
    el('span', { 'aria-hidden': 'true' }, icon),
    el('span', { 'aria-hidden': 'true' }, ` ${w.temp}°${w.rain != null && w.rain >= 30 ? ` · ${w.rain}%` : ''}`),
  );
}

/**
 * root 안에서 data-wx-date / data-wx-time이 붙은 일정들에 '그 시간의 날씨'를 붙인다 (이미 있으면 바꾼다).
 * 표시가 들어갈 자리는 그 안의 [data-wx-slot] (없으면 그 요소의 맨 끝). data-wx-compact가 있으면 ☂만.
 */
export function decorateTimed(root) {
  root?.querySelectorAll('[data-wx-time]').forEach(decorateOne);
}

export function decorateOne(node) {
  const slot = node.querySelector('[data-wx-slot]') || node;
  slot.querySelector(':scope > .wx-ev')?.remove();
  const badge = timedBadge(node.dataset.wxDate, node.dataset.wxTime, { compact: 'wxCompact' in node.dataset });
  if (badge) slot.append(badge);
}

/** 오늘 남은 시간 중 처음으로 비 올 확률이 높은 때 { hour, prob, now } (없으면 null) — 달력 위 띠의 ☂ 칩 */
export function rainAlert(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hours = weatherOf(today)?.hours;
  if (!hours) return null;
  for (let h = now.getHours(); h < 24; h++) {
    const prob = hours[h]?.[2];
    if (prob != null && prob >= RAINY) {
      // 그 뒤로 이어지는 비 가운데 가장 높은 확률을 보여 준다
      let peak = prob;
      for (let k = h + 1; k < 24 && (hours[k]?.[2] ?? 0) >= RAINY; k++) peak = Math.max(peak, hours[k][2]);
      return { hour: h, prob: peak, now: h === now.getHours() };
    }
  }
  return null;
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
