// 내 데이터 백업 · 되살리기 (0.14.0) — ⚙ 설정 → '백업 · 되살리기…' (서버는 backup.py)
//
//   내려받기  : 일정·할 일·노트·나·목표·살 것·루틴·습관·시간표·기념일·프로젝트·일기를 JSON 파일 하나로
//   자동 백업 : 서버가 그날 처음 쓸 때 스스로 한 벌 만든다 (0.15.2). 여기서 받거나 그대로 되살릴 수 있다.
//   되살리기  : 그 파일로 지금 데이터를 통째로 바꾼다. 바꾸기 전 데이터는 서버(instance/backups/)에 한 벌 남는다.
// 비밀번호·PIN·패스키·공유 링크는 파일에 들어가지 않는다 (열쇠라서).

import { api } from './api.js';
import { ask, daysBetween, el, fillDialog, formatShort, toast, todayStr } from './utils.js';

let dialog = null;
let showAll = false;
const SHOW = 4;            // 처음에 보여 줄 자동 백업 수 (나머지는 '모두 보기')
const REMIND_DAYS = 30;    // 내 컴퓨터에 받은 지 이만큼 지나면 한 번 더 권한다

export function openBackup() {
  if (!dialog) {
    dialog = el('dialog', { class: 'security backup', 'aria-labelledby': 'backup-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  showAll = false;
  draw();
  if (!dialog.open) dialog.showModal();
  refresh();
}

let state = { files: null, last: undefined, keep: null, error: false };

async function refresh() {
  try {
    const res = await api.autoBackups();
    state = { files: res.files, last: res.last_download, keep: res.keep, error: false };
  } catch {
    state = { ...state, files: state.files || [], error: true };
  }
  if (dialog?.open) draw();
}

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function dayName(date) {
  const gap = daysBetween(date, todayStr());
  return gap === 0 ? '오늘' : gap === 1 ? '어제' : formatShort(date);
}

function lastDownloadNote() {
  if (state.last === undefined) return null;
  if (!state.last) return el('p', { class: 'lk-note backup-remind' }, '아직 내 컴퓨터에 받아 둔 적이 없어요. 한 번 받아 두면 마음이 편해요.');
  const day = state.last.slice(0, 10);
  const gap = daysBetween(day, todayStr());
  const when = `${formatShort(day)}${gap > 0 ? ` · ${gap}일 전` : ' · 오늘'}`;
  return gap >= REMIND_DAYS
    ? el('p', { class: 'lk-note backup-remind' }, `마지막으로 받은 날 ${when}. 오랜만이니 한 벌 받아 두면 좋아요.`)
    : el('p', { class: 'lk-note' }, `마지막으로 받은 날 ${when}`);
}

function autoRow(f) {
  const auto = f.kind === 'auto';
  return el('li', { class: 'sec-item backup-item' },
    el('span', { class: 'sec-icon', 'aria-hidden': 'true' }, auto ? '🗂' : '🛟'),
    el('span', { class: 'sec-main' },
      el('b', {}, dayName(f.date)),
      el('span', {}, `${auto ? '자동 백업' : `되살리기 전 보관 · ${f.time}`} · ${kb(f.size)}`)),
    el('a', { class: 'btn sm ghost', href: `/api/backup/auto/${encodeURIComponent(f.name)}`, download: '' }, '받기'),
    el('button', { type: 'button', class: 'btn sm ghost', onclick: () => restoreAuto(f) }, '되살리기'));
}

function autoSection() {
  const { files, keep } = state;
  const intro = el('p', { class: 'lk-intro' },
    '그날 처음 캘린더를 쓸 때 ', el('b', {}, '서버가 스스로 한 벌'), ' 만들어 둬요. ',
    keep ? `최근 ${keep.daily}개는 날마다, 그 전은 일주일에 하나씩 ${keep.weekly}주까지 남아요.` : '');
  let body;
  if (files === null) body = el('p', { class: 'lk-empty' }, '불러오는 중…');
  else if (state.error) body = el('p', { class: 'form-error' }, '자동 백업 목록을 불러오지 못했어요.');
  else if (!files.length) body = el('p', { class: 'lk-empty' }, '아직 없어요. 내일부터 하루 한 벌씩 쌓여요.');
  else {
    const shown = showAll ? files : files.slice(0, SHOW);
    body = el('div', { class: 'backup-auto' },
      el('ul', { class: 'lk-list' }, shown.map(autoRow)),
      files.length > SHOW && !showAll
        ? el('button', { type: 'button', class: 'text-btn', onclick: () => { showAll = true; draw(); } }, `모두 보기 (${files.length}개)`)
        : null);
  }
  return el('section', { class: 'sec-block' },
    el('h3', { class: 'sec-title' }, '자동 백업'),
    intro,
    body,
    el('p', { class: 'lk-note' }, '자동 백업은 같은 서버에 있어서, 서버가 통째로 사라지면 함께 사라져요. 가끔은 위에서 내 컴퓨터로도 받아 두세요.'));
}

function draw(message = null) {
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', () => pick(file.files?.[0]));
  fillDialog(dialog, el('div', { class: 'dlg-inner' },
    el('header', { class: 'lk-head' },
      el('h2', { id: 'backup-title' }, '백업 · 되살리기'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    el('div', { class: 'lk-body' },
      el('section', { class: 'sec-block' },
        el('h3', { class: 'sec-title' }, '내 컴퓨터로 받기'),
        el('p', { class: 'lk-intro' },
          '일정·할 일·노트·나·목표·살 것·루틴·습관·시간표·기념일·프로젝트·일기를 ', el('b', {}, '파일 하나(JSON)'), '로 내려받아요.'),
        el('a', { class: 'btn primary', href: '/api/backup', download: '', onclick: () => setTimeout(refresh, 1500) }, '지금 내려받기'),
        lastDownloadNote(),
        el('p', { class: 'lk-note' }, '비밀번호·PIN·패스키·공유 링크 주소는 들어가지 않아요. 공용 컴퓨터에서 받았다면 다 쓴 뒤 파일을 지우세요.')),
      autoSection(),
      el('section', { class: 'sec-block' },
        el('h3', { class: 'sec-title' }, '파일로 되살리기'),
        el('p', { class: 'lk-intro' }, '내려받아 둔 파일을 고르면 ', el('b', {}, '지금 데이터가 그 파일 내용으로 통째로 바뀌어요.'),
          ' 바꾸기 전 데이터는 서버에 한 벌 남겨 둬요.'),
        file,
        el('button', { type: 'button', class: 'btn', onclick: () => file.click() }, '백업 파일 고르기…'),
        message ? el('p', { class: message.error ? 'form-error' : 'lk-note', role: 'status' }, message.text) : null),
    )));
}

async function restoreAuto(f) {
  let data;
  try { data = await api.autoBackup(f.name); } catch (e) { draw({ error: true, text: e.message }); return; }
  await confirmAndRestore(data);
}

async function pick(f) {
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { draw({ error: true, text: '파일이 너무 커요. (20MB까지)' }); return; }
  let data;
  try { data = JSON.parse(await f.text()); } catch { draw({ error: true, text: '백업 파일을 읽지 못했어요. 이 캘린더에서 내려받은 .json 파일인지 확인해 주세요.' }); return; }
  await confirmAndRestore(data);
}

async function confirmAndRestore(data) {
  if (data?.app !== 'my-calendar' || typeof data.tables !== 'object') { draw({ error: true, text: '이 캘린더에서 내려받은 백업 파일이 아니에요.' }); return; }
  const t = data.tables;
  const n = (k) => (Array.isArray(t[k]) ? t[k].length : 0);
  const summary = [`일정·할 일 ${n('items')}개`, `노트 ${n('notes')}개`, `목표 ${n('goals')}개`, `루틴 기록 ${n('routine_logs')}개`, `일기 ${n('diaries')}편`].join(', ');
  const ok = await ask(
    `${data.exported_at || '날짜 모름'}에 만든 백업(버전 ${data.version || '?'})이에요 — ${summary}. 지금 데이터를 이 내용으로 통째로 바꿀까요?`,
    [
      { label: '바꾸기', value: true, kind: 'danger-fill' },
      { label: '취소', value: null, kind: 'ghost' },
    ],
  );
  if (!ok) { draw(); return; }
  try {
    await api.restoreBackup(data);
    toast('되살렸어요. 화면을 새로 불러올게요.');
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    draw({ error: true, text: e.message });
  }
}
