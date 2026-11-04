// 시간 돌아보기 (7차) — 이번 주 / 이번 달에 시간을 어디에 썼는지
//
//   - 맨 위: 기록된 전체 시간 (시작·끝 시간이 모두 있는 일정만 더한다)
//   - 카테고리별 가로 막대: 시간이 많은 순서. 이름과 값을 막대 옆에 글자로 적어서 색만으로 구분하지 않게 했다.
//   - 날짜별 세로 막대: 카테고리별로 쌓는다. 막대에 마우스를 올리거나 키보드로 고르면 자세한 값이 뜬다.
//   - 루틴: 그 기간에 몇 번 했는지
// 계산은 서버(api_tools.py의 /api/stats)가 하고, 여기서는 그리기만 한다.
// 달성률·목표 같은 건 일부러 넣지 않았다. '내 시간이 어디에 쓰였나'를 보는 화면이다.

import { api } from './api.js';
import {
  WEEKDAYS, addDays, el, formatMinutes, icon, parseDateStr, toDateStr, todayStr,
} from './utils.js';
import { startOfWeek, weekTitle } from './week.js';

export function statsView({ mode = 'week', anchor = todayStr() }) {
  const state = { mode, start: periodStart(mode, anchor) };

  async function render(sheet) {
    const { start, end } = period(state);
    sheet.setHead('시간 돌아보기', periodLabel(state));
    if (!sheet.bodyEl.querySelector('.stats')) sheet.loading();
    else sheet.bodyEl.querySelector('.stats').classList.add('is-loading'); // 다시 불러오는 동안 이전 화면을 흐리게 유지

    let data;
    try {
      data = await api.stats(start, end);
    } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'stats') return;

    const go = (next) => {
      Object.assign(state, next);
      render(sheet);
    };
    const isCurrent = state.start === periodStart(state.mode, todayStr());

    const controls = el('div', { class: 'stats-controls' },
      el('div', { class: 'seg', role: 'group', 'aria-label': '기간' },
        el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(state.mode === 'week'), onclick: () => go({ mode: 'week', start: periodStart('week', anchorOf(state)) }) }, '주간'),
        el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(state.mode === 'month'), onclick: () => go({ mode: 'month', start: periodStart('month', anchorOf(state)) }) }, '월간'),
      ),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': state.mode === 'week' ? '지난주' : '지난달', onclick: () => go({ start: shift(state, -1) }) }, icon('M15 6l-6 6 6 6')),
      el('button', { type: 'button', class: 'btn sm ghost', disabled: isCurrent, onclick: () => go({ start: periodStart(state.mode, todayStr()) }) }, state.mode === 'week' ? '이번 주' : '이번 달'),
      el('button', { type: 'button', class: 'icon-btn sm', 'aria-label': state.mode === 'week' ? '다음 주' : '다음 달', onclick: () => go({ start: shift(state, 1) }) }, icon('M9 6l6 6-6 6')),
    );

    sheet.setBody(
      el('div', { class: 'stats' },
        controls,
        hero(data),
        data.item_count ? categoryBars(data) : null,
        data.total_minutes ? dayColumns(data, state) : null,
        data.routines.length ? routineCounts(data) : null,
        el('p', { class: 'list-hint' }, '시작·끝 시간이 모두 있는 일정만 시간에 더해요. 여러 날짜에 들어간 일정은 날짜마다 따로 세요.'),
      ),
    );
    sheet.setFoot();
  }

  return { render, refresh: render, returnTo: null };
}

// ---------------------------------------------------------------- 기간 계산
function periodStart(mode, date) {
  if (mode === 'week') return startOfWeek(date);
  return `${date.slice(0, 7)}-01`;
}

function period(state) {
  if (state.mode === 'week') return { start: state.start, end: addDays(state.start, 7) };
  const d = parseDateStr(state.start);
  return { start: state.start, end: toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
}

function shift(state, dir) {
  if (state.mode === 'week') return addDays(state.start, 7 * dir);
  const d = parseDateStr(state.start);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + dir, 1));
}

// 주간 ↔ 월간을 바꿀 때 기준 날짜: 이번 기간에 오늘이 있으면 오늘, 아니면 기간 첫날
function anchorOf(state) {
  const { start, end } = period(state);
  const today = todayStr();
  return today >= start && today < end ? today : start;
}

function periodLabel(state) {
  if (state.mode === 'week') {
    const { main, year } = weekTitle(state.start);
    return `${year}년 ${main}`;
  }
  const d = parseDateStr(state.start);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

// ---------------------------------------------------------------- 그리기
function hero(data) {
  return el('div', { class: 'stats-hero' },
    el('span', { class: 'stats-hero-label' }, '기록된 시간'),
    el('span', { class: 'stats-hero-value' }, formatMinutes(data.total_minutes)),
    el('span', { class: 'stats-hero-sub' },
      data.item_count
        ? `일정 ${data.item_count}개 중 시간을 적은 일정 ${data.timed_count}개`
        : '이 기간에는 일정이 없어요.'),
  );
}

// 카테고리별 가로 막대 (시간 많은 순). 막대 길이 = 가장 많은 카테고리 대비 비율
function categoryBars(data) {
  const max = Math.max(1, ...data.categories.map((c) => c.minutes));
  return el('section', { class: 'stats-section' },
    el('h3', { class: 'label' }, '카테고리별'),
    el('ul', { class: 'stats-bars' },
      data.categories.map((c) => {
        const pct = (c.minutes / max) * 100;
        const share = data.total_minutes ? Math.round((c.minutes / data.total_minutes) * 100) : 0;
        return el('li', { class: 'stats-bar-row', style: { '--cat': c.color } },
          el('span', { class: 'stats-bar-name' }, el('span', { class: 'dot' }), c.name),
          el('span', { class: 'stats-bar-track', role: 'img', 'aria-label': `${c.name}: ${formatMinutes(c.minutes)}, 일정 ${c.count}개` },
            c.minutes ? el('span', { class: 'stats-bar-fill', style: { width: `max(4px, ${pct}%)` } }) : null),
          el('span', { class: 'stats-bar-value' },
            c.minutes ? formatMinutes(c.minutes) : '시간 기록 없음',
            el('span', { class: 'muted' }, c.minutes ? ` · ${share}% · ${c.count}개` : ` · ${c.count}개`)),
        );
      }),
    ),
  );
}

// 날짜별 세로 막대 (카테고리별로 쌓음). 칸 사이·조각 사이는 바탕색 틈으로 구분한다.
function dayColumns(data, state) {
  const { start, end } = period(state);
  const byDate = new Map(data.days.map((d) => [d.date, d.by_category]));
  const catOf = new Map(data.categories.map((c) => [String(c.id), c]));
  const order = data.categories.map((c) => String(c.id)); // 아래부터 시간 많은 카테고리 순으로 쌓는다

  const days = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  const totals = days.map((d) => Object.values(byDate.get(d) || {}).reduce((a, b) => a + b, 0));
  const maxDay = Math.max(...totals);
  const scaleTop = Math.max(60, Math.ceil(maxDay / 60) * 60); // 위쪽 기준선: 시간 단위로 올림

  // 막대 아래 읽는 칸: 막대에 마우스를 올리거나(휴대폰은 누르거나) 키보드로 고르면 그날의 값이 나온다
  const hint = () => [el('span', { class: 'muted' }, '막대에 마우스를 올리거나 눌러 보면 그날의 시간이 나와요.')];
  const tip = el('div', { class: 'stats-tip', role: 'status' }, hint());
  const today = todayStr();

  const cols = days.map((d, i) => {
    const cats = byDate.get(d) || {};
    const total = totals[i];
    const date = parseDateStr(d);
    const label = `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
    const segs = order.filter((id) => cats[id]).map((id) =>
      el('span', { class: 'stats-seg', style: { '--cat': catOf.get(id).color, height: `${(cats[id] / scaleTop) * 100}%` } }));

    const showTip = () => {
      tip.replaceChildren(
        el('strong', {}, total ? formatMinutes(total) : '기록 없음'),
        el('span', { class: 'muted' }, ` ${label}`),
        ...order.filter((id) => cats[id]).map((id) =>
          el('span', { class: 'stats-tip-row', style: { '--cat': catOf.get(id).color } },
            el('span', { class: 'stats-tip-key' }), el('b', {}, formatMinutes(cats[id])), ` ${catOf.get(id).name}`)),
      );
    };
    const col = el('button', {
      type: 'button',
      class: `stats-col${d === today ? ' is-today' : ''}`,
      'aria-label': `${label}: ${total ? formatMinutes(total) : '기록 없음'}`,
      onpointerenter: showTip,
      onfocus: showTip,
      onclick: showTip, // 휴대폰: 눌러서 보기
    }, el('span', { class: 'stats-stack' }, segs));
    return col;
  });

  // 아래 날짜 표시: 주간은 요일 전부, 월간은 1·8·15·22·29일만
  const ticks = days.map((d) => {
    const date = parseDateStr(d);
    const show = state.mode === 'week' || [1, 8, 15, 22, 29].includes(date.getDate());
    return el('span', { class: `stats-tick wd-${date.getDay()}` },
      show ? (state.mode === 'week' ? WEEKDAYS[date.getDay()] : String(date.getDate())) : '');
  });

  const chart = el('div', { class: `stats-chart is-${state.mode}` }, // ('week'만 쓰면 주간 화면 .week 스타일과 겹친다)
    el('div', { class: 'stats-scale' }, el('span', {}, formatMinutes(scaleTop))),
    el('div', { class: 'stats-cols', onpointerleave: (e) => { if (e.pointerType === 'mouse') tip.replaceChildren(...hint()); } }, cols),
    el('div', { class: 'stats-ticks', 'aria-hidden': 'true' }, ticks),
  );

  return el('section', { class: 'stats-section' },
    el('h3', { class: 'label' }, '날짜별'),
    chart,
    tip,
  );
}

function routineCounts(data) {
  return el('section', { class: 'stats-section' },
    el('h3', { class: 'label' }, '루틴'),
    el('div', { class: 'stats-routines' },
      data.routines.map((r) =>
        el('span', { class: 'stats-routine', style: { '--cat': r.color } },
          el('span', { class: 'dot' }), r.name, el('b', {}, `${r.count}번`)))),
  );
}

