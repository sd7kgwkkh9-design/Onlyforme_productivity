// 메모장의 '나' 탭 (0.14.2) — 나를 자세히 적어 두는 곳 (서버는 about.py)
//
//   기본 정보   : '이름: 내용' 줄 (이름은 마음대로: 생일, MBTI, 혈액형 …)
//   좋아하는 것 : 분류마다 칩 (운동: 수영 · 러닝, 브랜드: …) — 적고 Enter(또는 쉼표)
//   싫어하는 것 · 요즘 빠진 것 : 칩
//   자유롭게    : 긴 글
// 칸 이름 바꾸기·더하기·지우기·순서 바꾸기(↑↓) 모두 된다. 쓰는 대로 자동 저장.
// 나만 보는 내용이라 공유 링크·캘린더 구독·위젯에는 나가지 않는다. 검색·백업에는 들어간다.

import { api } from './api.js';
import { ask, el, icon, toast } from './utils.js';

const SAVE_DELAY = 700;
const ICON = {
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7M9 7V4.5h6V7',
  x: 'M7 7l10 10M17 7L7 17',
};
const KIND_NAME = { fields: '항목', lists: '칩 목록', text: '글' };

let sections = null;          // [{id, title, kind, data}] — 처음 열 때 받는다
const timers = new Map();     // id → 저장 대기 타이머
const dirty = new Set();      // 아직 저장 안 한 칸 id
let chain = Promise.resolve();
let wrap = null;              // 지금 그려진 '나' 탭

/** notes.js의 showList가 부른다 */
export function renderAbout() {
  wrap = el('div', { class: 'about-wrap' });
  if (sections) draw();
  else {
    wrap.append(el('p', { class: 'notes-empty' }, '불러오는 중…'));
    load();
  }
  return [wrap];
}

async function load() {
  try {
    sections = await api.about();
  } catch (e) {
    wrap?.replaceChildren(el('p', { class: 'notes-empty' }, e.message));
    return;
  }
  if (wrap?.isConnected) draw();
}

/** 다른 기기에서 바뀌었을 때 (notes.refresh): 쓰는 중이 아니면 새로 받는다 */
export async function refreshAbout() {
  if (dirty.size || (wrap && wrap.contains(document.activeElement))) return;
  await load();
}

/** 메모장을 닫거나 탭을 바꾸거나 페이지를 떠날 때 */
export function flushAbout({ keepalive = false } = {}) {
  for (const id of [...dirty]) save(id, { keepalive });
  return chain;
}

function find(id) { return sections.find((s) => s.id === id); }

function schedule(sec) {
  dirty.add(sec.id);
  clearTimeout(timers.get(sec.id));
  timers.set(sec.id, setTimeout(() => save(sec.id), SAVE_DELAY));
}

function save(id, { keepalive = false } = {}) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!dirty.has(id)) return chain;
  dirty.delete(id);
  const sec = find(id);
  if (!sec) return chain;
  const title = sec.title.trim() || '이름 없는 칸';
  const payload = { title, data: sec.data };
  chain = chain.then(() => api.saveAbout(id, payload, { keepalive })).then(() => {
    const status = wrap?.querySelector('.about-status');
    if (status) status.textContent = '저장됨';
  }).catch((e) => {
    dirty.add(id);
    toast(e.message, 'error');
  });
  return chain;
}

// ---------------------------------------------------------------- 그리기
function draw() {
  wrap.replaceChildren(
    el('p', { class: 'about-intro' }, '나를 적어 두는 곳 — 좋아하는 것, 요즘 빠진 것, 무엇이든. ',
      el('span', { class: 'about-status', role: 'status' }, '쓰는 대로 저장돼요')),
    ...sections.map((s, i) => section(s, i)),
    el('button', { type: 'button', class: 'btn wide about-add-sec', onclick: addSection }, '+ 칸 더하기'),
  );
}

function redraw(sec, focus = null) {
  const old = wrap?.querySelector(`.about-sec[data-id="${sec.id}"]`);
  if (!old) return;
  const node = section(sec, sections.indexOf(sec));
  old.replaceWith(node);
  if (focus) node.querySelector(focus)?.focus();
}

const smallBtn = (label, path, onclick, extra = '') => el('button', { type: 'button', class: `icon-btn about-mini ${extra}`, 'aria-label': label, title: label, onclick }, icon(path));

function section(sec, index) {
  const title = el('input', {
    class: 'about-title', value: sec.title, maxlength: '30', 'aria-label': '칸 이름', placeholder: '칸 이름', enterkeyhint: 'done',
  });
  title.addEventListener('input', () => { sec.title = title.value; schedule(sec); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); title.blur(); } });

  const body = sec.kind === 'fields' ? fields(sec) : sec.kind === 'lists' ? lists(sec) : text(sec);
  return el('section', { class: `about-sec is-${sec.kind}`, dataset: { id: String(sec.id) } },
    el('header', { class: 'about-head' }, title,
      el('span', { class: 'about-tools' },
        index > 0 ? smallBtn('위로', ICON.up, () => move(sec, -1)) : null,
        index < sections.length - 1 ? smallBtn('아래로', ICON.down, () => move(sec, 1)) : null,
        smallBtn(`'${sec.title || '이 칸'}' 지우기`, ICON.trash, () => removeSection(sec), 'is-danger'))),
    body);
}

// 기본 정보: [이름 | 내용 | ×]
function fields(sec) {
  const rows = sec.data.map((r, i) => {
    const label = el('input', { class: 'about-label', value: r.label, maxlength: '30', placeholder: '항목', 'aria-label': '항목 이름' });
    const value = el('input', { class: 'about-value', value: r.value, maxlength: '200', placeholder: '적어 보세요', 'aria-label': r.label || '내용' });
    label.addEventListener('input', () => { r.label = label.value; value.setAttribute('aria-label', r.label || '내용'); schedule(sec); });
    value.addEventListener('input', () => { r.value = value.value; schedule(sec); });
    value.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); (value.closest('.about-row').nextElementSibling?.querySelector('.about-value') || value).focus(); }
    });
    return el('div', { class: 'about-row' }, label, value,
      smallBtn(`'${r.label || '항목'}' 줄 지우기`, ICON.x, () => { sec.data.splice(i, 1); schedule(sec); redraw(sec); }, 'about-row-del'));
  });
  return el('div', { class: 'about-body' }, ...rows,
    el('button', { type: 'button', class: 'link-btn about-add-row', onclick: () => {
      sec.data.push({ label: '', value: '' }); schedule(sec); redraw(sec, '.about-row:last-of-type .about-label');
    } }, '+ 항목 더하기'));
}

// 좋아하는 것: 분류 이름 + 칩들 + 칩 넣는 칸
function lists(sec) {
  const rows = sec.data.map((r, i) => {
    const label = el('input', { class: 'about-label', value: r.label, maxlength: '30', placeholder: '분류', 'aria-label': '분류 이름' });
    label.addEventListener('input', () => { r.label = label.value; schedule(sec); });
    const add = el('input', {
      class: 'about-chip-input', maxlength: '40', placeholder: r.items.length ? '+' : '적고 Enter', enterkeyhint: 'enter',
      'aria-label': `${r.label || '분류'}에 더하기`,
    });
    // 칩은 다시 그리지 않고 그 자리에서 넣고 뺀다 (입력칸 포커스·다른 칩 누르기가 끊기지 않게)
    const chip = (item) => {
      const node = el('span', { class: 'about-chip' }, item,
        el('button', { type: 'button', class: 'about-chip-x', 'aria-label': `'${item}' 빼기`, onclick: () => {
          r.items = r.items.filter((v) => v !== item); node.remove(); schedule(sec); add.focus();
        } }, '×'));
      return node;
    };
    const push = () => {
      const parts = add.value.split(',').map((v) => v.trim()).filter(Boolean);
      add.value = '';
      for (const p of parts) {
        if (r.items.includes(p)) continue;
        r.items.push(p);
        add.before(chip(p));
      }
      if (parts.length) { schedule(sec); add.placeholder = '+'; }
    };
    add.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); push(); } else if (e.key === 'Backspace' && !add.value && r.items.length) {
        r.items.pop(); add.previousElementSibling?.remove(); schedule(sec);
      }
    });
    add.addEventListener('input', () => { if (add.value.includes(',')) push(); });
    add.addEventListener('blur', () => { if (add.value.trim()) push(); });
    const chips = r.items.map(chip);
    return el('div', { class: 'about-row' }, label,
      el('div', { class: 'about-chips', onclick: (e) => { if (e.target === e.currentTarget) add.focus(); } }, ...chips, add),
      smallBtn(`'${r.label || '분류'}' 줄 지우기`, ICON.x, async () => {
        if (r.items.length && !(await ask(`'${r.label || '이 분류'}'와 칩 ${r.items.length}개를 지울까요?`, [
          { label: '지우기', value: true, kind: 'danger-fill' }, { label: '취소', value: null, kind: 'ghost' }]))) return;
        sec.data.splice(i, 1); schedule(sec); redraw(sec);
      }, 'about-row-del'));
  });
  return el('div', { class: 'about-body' }, ...rows,
    el('button', { type: 'button', class: 'link-btn about-add-row', onclick: () => {
      sec.data.push({ label: '', items: [] }); schedule(sec); redraw(sec, '.about-row:last-of-type .about-label');
    } }, '+ 분류 더하기'));
}

// 자유롭게: 긴 글 (쓰는 만큼 늘어난다)
function text(sec) {
  const area = el('textarea', { class: 'about-text', maxlength: '5000', rows: '4', placeholder: '나에 대해 무엇이든', 'aria-label': sec.title || '글' });
  area.value = sec.data || '';
  const grow = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight + 2}px`; };
  area.addEventListener('input', () => { sec.data = area.value; schedule(sec); grow(); });
  requestAnimationFrame(grow);
  return el('div', { class: 'about-body' }, area);
}

// ---------------------------------------------------------------- 칸 더하기·지우기·옮기기
async function addSection() {
  const kind = await ask('어떤 칸을 더할까요?', [
    { label: "항목 ('이름: 내용')", value: 'fields' },
    { label: '칩 목록 (좋아하는 것처럼)', value: 'lists' },
    { label: '글', value: 'text' },
    { label: '취소', value: null, kind: 'ghost' },
  ]);
  if (!kind) return;
  await flushAbout();
  try {
    const data = kind === 'text' ? '' : [kind === 'fields' ? { label: '', value: '' } : { label: '', items: [] }];
    const sec = await api.createAbout({ title: `새 ${KIND_NAME[kind]}`, kind, data });
    sections.push(sec);
    draw();
    const input = wrap.querySelector(`.about-sec[data-id="${sec.id}"] .about-title`);
    input?.focus();
    input?.select();
    input?.scrollIntoView({ block: 'nearest' });
  } catch (e) { toast(e.message, 'error'); }
}

async function removeSection(sec) {
  const has = sec.kind === 'text' ? Boolean(sec.data.trim()) : sec.data.some((r) => r.value || r.items?.length);
  if (has && !(await ask(`'${sec.title}' 칸을 통째로 지울까요? 적어 둔 내용도 함께 사라져요.`, [
    { label: '지우기', value: true, kind: 'danger-fill' }, { label: '취소', value: null, kind: 'ghost' }]))) return;
  clearTimeout(timers.get(sec.id));
  dirty.delete(sec.id);
  try {
    await chain;
    await api.deleteAbout(sec.id);
    sections = sections.filter((s) => s !== sec);
    draw();
    toast(`'${sec.title}' 칸을 지웠어요`);
  } catch (e) { toast(e.message, 'error'); }
}

async function move(sec, step) {
  const i = sections.indexOf(sec);
  const j = i + step;
  if (j < 0 || j >= sections.length) return;
  [sections[i], sections[j]] = [sections[j], sections[i]];
  draw();
  wrap.querySelector(`.about-sec[data-id="${sec.id}"] .about-mini[aria-label="${step < 0 ? '위로' : '아래로'}"]`)?.focus();
  try {
    await flushAbout();
    await api.orderAbout(sections.map((s) => s.id));
  } catch (e) {
    toast(e.message, 'error');
    await load();
  }
}
