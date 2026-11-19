// 일기 (0.14.0) — 날짜마다 하나, 쓰고 싶은 날만.
//
//   diarySection  하루 화면 맨 아래: 안 쓴 날은 작은 '일기 쓰기' 버튼, 쓴 날은 첫 몇 줄 미리보기
//   diaryEditor   쓰는 화면 (하루 화면 자리에서 열린다): 기분 이모지(골라도 되고 안 골라도 됨) + 본문, 쓰는 대로 저장
//   diaryList     상단 📔 버튼 → 모아 보기: 최신순, 달마다 묶어서. 누르면 그 자리에서 읽고 고친다
//
// 꾸준히 쓰는 일기가 아니라 '가끔 쓰고 싶은 날'을 위한 칸이라 알림·연속 기록·'안 썼어요' 같은 건 일부러 없다.
// 공유 링크·캘린더 구독·위젯에는 절대 나가지 않는다 (서버의 diary.py). 월간·주간 달력에는 쓴 날에 작은 표시만 (decor.js).

import { api } from './api.js';
import { ask, el, formatLong, formatShort, icon, parseDateStr, toast, todayStr } from './utils.js';

export const MOODS = ['😊', '😆', '🥰', '😌', '😐', '😔', '😢', '😡', '😴', '🤒'];
const BOOK = 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6M9 11h4';
const SAVE_DELAY = 700;

const timeOf = (stamp) => (stamp ? stamp.slice(11, 16) : '');

/** 하루 화면 맨 아래 */
export function diarySection({ date, diary, onOpen }) {
  if (!diary) {
    return el('div', { class: 'diary-day is-empty' },
      el('button', { type: 'button', class: 'diary-write', onclick: onOpen, 'aria-label': `${formatShort(date)} 일기 쓰기` },
        icon(BOOK), '일기 쓰기'));
  }
  return el('section', { class: 'diary-day', 'aria-label': '이 날의 일기' },
    el('button', { type: 'button', class: 'diary-card', onclick: onOpen, 'aria-label': `${formatShort(date)} 일기 읽고 고치기` },
      el('span', { class: 'diary-card-head' },
        diary.mood ? el('span', { class: 'diary-mood', 'aria-label': `기분 ${diary.mood}` }, diary.mood) : icon(BOOK),
        el('b', {}, '일기'),
        el('span', { class: 'diary-meta' }, `${diary.body.length.toLocaleString()}자`)),
      diary.body ? el('span', { class: 'diary-preview' }, diary.body) : null));
}

/**
 * 쓰는 화면. sheet.showView('diary', diaryEditor({...}))로 연다.
 * @param {object} o
 * @param {string} o.date
 * @param {() => Promise<void>} o.onChanged   달력의 표시·하루 화면을 다시 그리기
 * @param {'day'|null} [o.returnTo]          뒤로(←)를 누르면 갈 곳 (sheet.js)
 * @param {(sheet) => void} [o.onBack]        모아 보기 안에서 열었을 때: 목록으로 돌아가기
 */
export function diaryEditor({ date, onChanged, returnTo = 'day', onBack = null }) {
  let mood = '';
  let dirty = false;
  let changed = false;   // 저장한 게 있는지 (나갈 때 달력·하루 화면을 다시 그린다)
  let timer = null;
  let chain = Promise.resolve();
  let textarea = null;
  let statusEl = null;
  let had = false;       // 열 때 이미 쓴 일기가 있었는지

  const setStatus = (text, error = false) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', error);
  };

  function flush({ keepalive = false } = {}) {
    clearTimeout(timer);
    timer = null;
    if (!dirty || !textarea) return chain;
    dirty = false;
    const payload = { body: textarea.value, mood };
    chain = chain.then(() => api.saveDiary(date, payload, { keepalive })).then((saved) => {
      changed = true;
      setStatus(saved.updated_at ? `저장됨 · ${timeOf(saved.updated_at)}` : '비어 있어서 지웠어요');
    }).catch((e) => {
      dirty = true;
      setStatus('저장하지 못했어요. 인터넷 연결을 확인해 주세요.', true);
      toast(e.message, 'error');
    });
    return chain;
  }

  const schedule = () => {
    dirty = true;
    setStatus('쓰는 중…');
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  };

  // 창을 닫거나 다른 앱으로 넘어가도 마지막 글자까지 (keepalive: 페이지가 사라져도 요청은 끝까지 간다)
  const onHide = () => { if (document.visibilityState === 'hidden') flush({ keepalive: true }); };

  async function leave() {
    document.removeEventListener('visibilitychange', onHide);
    await flush();
    if (changed) { changed = false; await onChanged(); }
  }

  async function render(sheet) {
    sheet.setHead(formatLong(date), '일기 · 쓰는 대로 저장돼요', { back: true });
    sheet.loading();
    let entry;
    try { entry = await api.diary(date); } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'diary' && sheet.view !== 'diaries') return;
    had = Boolean(entry.updated_at);
    mood = entry.mood || '';

    textarea = el('textarea', {
      class: 'input diary-text', rows: '12', maxlength: '20000', value: entry.body,
      placeholder: '오늘 있었던 일, 떠오른 생각… 쓰고 싶은 만큼만 써도 돼요.', 'aria-label': `${formatLong(date)} 일기`,
    });
    textarea.addEventListener('input', schedule);
    textarea.addEventListener('blur', () => flush());
    statusEl = el('p', { class: 'diary-status', role: 'status' }, had ? `마지막 저장 · ${entry.updated_at.slice(5, 10).replace('-', '/')} ${timeOf(entry.updated_at)}` : '');

    const moods = el('div', { class: 'diary-moods', role: 'group', 'aria-label': '기분 (골라도 되고 안 골라도 돼요)' });
    const drawMoods = () => moods.replaceChildren(...MOODS.map((m) => el('button', {
      type: 'button', class: 'diary-mood-btn', 'aria-pressed': String(m === mood), 'aria-label': `기분 ${m}`,
      onclick: () => { mood = mood === m ? '' : m; drawMoods(); dirty = true; flush(); }, // 다시 누르면 뺀다
    }, m)));
    drawMoods();

    sheet.setBody(
      el('div', { class: 'diary-editor' },
        el('div', { class: 'diary-mood-row' }, el('span', { class: 'label' }, '기분'), moods),
        textarea,
        statusEl));
    sheet.setFoot(
      el('div', { class: 'diary-foot' },
        had ? el('button', { type: 'button', class: 'btn ghost danger', onclick: () => remove(sheet) }, '지우기') : null,
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'btn primary', onclick: () => sheet.goBack() }, '완료')));
    document.addEventListener('visibilitychange', onHide);
    if (!entry.body) setTimeout(() => textarea?.focus());
  }

  async function remove(sheet) {
    const ok = await ask(`${formatShort(date)} 일기를 지울까요? 되돌릴 수 없어요.`, [
      { label: '지우기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ]);
    if (!ok) return;
    clearTimeout(timer);
    dirty = false;
    try {
      await api.deleteDiary(date);
      changed = true;
      toast('일기를 지웠어요');
      sheet.goBack();
    } catch (e) { toast(e.message, 'error'); }
  }

  return { render, refresh: null, returnTo, onBack, onLeave: leave };
}

/** 상단 📔 → 모아 보기. sheet.showView('diaries', diaryList({...}))로 연다 */
export function diaryList({ onChanged, onOpenDate }) {
  let entries = [];
  let total = 0;
  let more = false;
  let editor = null;   // 지금 열어 둔 일기 (diaryEditor)

  async function load(before = '') {
    const res = await api.diaries(before, 40);
    total = res.total;
    more = res.more;
    entries = before ? [...entries, ...res.entries] : res.entries;
  }

  async function render(sheet) {
    if (editor) return editor.render(sheet);
    sheet.setHead('일기', total ? `모두 ${total.toLocaleString()}편 · 쓰는 곳은 날짜를 누르면 나오는 하루 화면 아래` : '쓰는 곳은 날짜를 누르면 나오는 하루 화면 아래', { back: false });
    if (!sheet.bodyEl.querySelector('.diary-list, .empty')) sheet.loading();
    try { await load(); } catch (e) { return sheet.failed(e); }
    if (sheet.view !== 'diaries') return;
    sheet.setHead('일기', total ? `모두 ${total.toLocaleString()}편` : '', { back: false });
    draw(sheet);
  }

  function draw(sheet) {
    if (!entries.length) {
      sheet.setBody(el('div', { class: 'diary-empty' },
        el('p', { class: 'empty' }, '아직 쓴 일기가 없어요.'),
        el('p', { class: 'muted' }, '쓰고 싶은 날, 그 날짜를 눌러 하루 화면 맨 아래의 ‘일기 쓰기’를 누르세요. 매일 안 써도 괜찮아요.'),
        el('button', { type: 'button', class: 'btn', onclick: () => open(sheet, todayStr()) }, '오늘 일기 쓰기')));
      sheet.setFoot();
      return;
    }
    // 달마다 묶기: '2026년 11월 · 3편'
    const groups = new Map();
    for (const e of entries) {
      const key = e.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const list = el('div', { class: 'diary-list' }, [...groups].map(([month, items]) => {
      const [y, m] = month.split('-').map(Number);
      return el('section', { class: 'diary-month' },
        el('h3', { class: 'diary-month-title' }, `${y}년 ${m}월`, el('small', {}, ` · ${items.length}편`)),
        el('ul', { class: 'diary-entries' }, items.map((e) => {
          const d = parseDateStr(e.date);
          return el('li', {},
            el('button', { type: 'button', class: 'diary-entry', onclick: () => open(sheet, e.date) },
              el('span', { class: 'diary-entry-day' }, el('b', {}, String(d.getDate())), el('small', {}, '일월화수목금토'[d.getDay()])),
              el('span', { class: 'diary-entry-main' },
                el('span', { class: 'diary-entry-preview' }, e.preview || '(기분만 남김)'),
                el('span', { class: 'diary-entry-meta' }, `${e.chars.toLocaleString()}자`)),
              e.mood ? el('span', { class: 'diary-entry-mood', 'aria-label': `기분 ${e.mood}` }, e.mood) : null));
        })));
    }));
    sheet.setBody(list,
      more ? el('button', {
        type: 'button', class: 'btn wide ghost diary-more',
        onclick: async () => { try { await load(entries.at(-1).date); draw(sheet); } catch (er) { toast(er.message, 'error'); } },
      }, '더 보기') : null);
    sheet.setFoot(el('button', { type: 'button', class: 'btn wide', onclick: () => open(sheet, todayStr()) }, '오늘 일기 쓰기'));
  }

  function open(sheet, date) {
    editor = diaryEditor({
      date,
      onChanged,
      returnTo: null,
      onBack: async (sh) => {
        const ed = editor;
        editor = null;
        sh.custom = view;   // 모아 보기로 돌아온다 (sheet.goBack이 지운 것을 다시)
        await ed.onLeave();
        await render(sh);
      },
    });
    sheet.custom = { ...view, onBack: editor.onBack, onLeave: editor.onLeave };
    editor.render(sheet).then(() => {
      // 하루 화면으로 가 보기 (그날 일정과 같이 보고 싶을 때)
      sheet.footEl.querySelector('.diary-foot')?.prepend(el('button', {
        type: 'button', class: 'btn ghost', onclick: async () => { await editor?.onLeave(); onOpenDate(date); },
      }, '그날로 가기'));
    });
  }

  const view = { render, refresh: (sheet) => { if (!editor) render(sheet); }, returnTo: null };
  return view;
}
