// 내 데이터 백업 · 되살리기 (0.14.0) — ⚙ 설정 → '백업 · 되살리기…' (서버는 backup.py)
//
//   내려받기  : 일정·할 일·노트·목표·루틴·습관·시간표·기념일·프로젝트·일기를 JSON 파일 하나로
//   되살리기  : 그 파일로 지금 데이터를 통째로 바꾼다. 바꾸기 전 데이터는 서버(instance/backups/)에 한 벌 남는다.
// 비밀번호·PIN·패스키·공유 링크는 파일에 들어가지 않는다 (열쇠라서).

import { api } from './api.js';
import { ask, el, toast } from './utils.js';

let dialog = null;

export function openBackup() {
  if (!dialog) {
    dialog = el('dialog', { class: 'security backup', 'aria-labelledby': 'backup-title' });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  draw();
  if (!dialog.open) dialog.showModal();
}

function draw(message = null) {
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', () => pick(file.files?.[0]));
  dialog.replaceChildren(el('div', { class: 'dlg-inner' },
    el('header', { class: 'lk-head' },
      el('h2', { id: 'backup-title' }, '백업 · 되살리기'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    el('div', { class: 'lk-body' },
      el('section', { class: 'sec-block' },
        el('h3', { class: 'sec-title' }, '내려받기'),
        el('p', { class: 'lk-intro' },
          '일정·할 일·노트·목표·루틴·습관·시간표·기념일·프로젝트·일기를 ', el('b', {}, '파일 하나(JSON)'), '로 내려받아요. ',
          '가끔 받아 두면 실수로 지우거나 서버에 문제가 생겨도 되살릴 수 있어요.'),
        el('a', { class: 'btn primary', href: '/api/backup', download: '' }, '지금 내려받기'),
        el('p', { class: 'lk-note' }, '비밀번호·PIN·패스키·공유 링크 주소는 들어가지 않아요. 공용 컴퓨터에서 받았다면 다 쓴 뒤 파일을 지우세요.')),
      el('section', { class: 'sec-block' },
        el('h3', { class: 'sec-title' }, '되살리기'),
        el('p', { class: 'lk-intro' }, '내려받아 둔 파일을 고르면 ', el('b', {}, '지금 데이터가 그 파일 내용으로 통째로 바뀌어요.'),
          ' 바꾸기 전 데이터는 서버에 한 벌 남겨 둬요.'),
        file,
        el('button', { type: 'button', class: 'btn', onclick: () => file.click() }, '백업 파일 고르기…'),
        message ? el('p', { class: message.error ? 'form-error' : 'lk-note', role: 'status' }, message.text) : null),
    )));
}

async function pick(f) {
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) { draw({ error: true, text: '파일이 너무 커요. (20MB까지)' }); return; }
  let data;
  try { data = JSON.parse(await f.text()); } catch { draw({ error: true, text: '백업 파일을 읽지 못했어요. 이 캘린더에서 내려받은 .json 파일인지 확인해 주세요.' }); return; }
  if (data?.app !== 'my-calendar' || typeof data.tables !== 'object') { draw({ error: true, text: '이 캘린더에서 내려받은 백업 파일이 아니에요.' }); return; }
  const t = data.tables;
  const n = (k) => (Array.isArray(t[k]) ? t[k].length : 0);
  const summary = [`일정·할 일 ${n('items')}개`, `노트 ${n('notes')}개`, `목표 ${n('goals')}개`, `루틴 기록 ${n('routine_logs')}개`, `일기 ${n('diaries')}편`].join(', ');
  const ok = await ask(
    `${data.exported_at || '날짜 모름'}에 받은 백업(버전 ${data.version || '?'})이에요 — ${summary}. 지금 데이터를 이 내용으로 통째로 바꿀까요?`,
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
