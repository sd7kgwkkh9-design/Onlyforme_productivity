// 공유 링크 · 캘린더 구독 · 홈 화면 위젯 창 (0.12.0)
//
//   [공유 링크]   가족·친구에게 보내는 '보기 전용' 달력 주소 (/v/…)
//   [캘린더 구독] 아이폰·맥·구글 캘린더에 구독해 두는 주소 (/ical/….ics) → 기본 캘린더 위젯·잠금 화면·시리에도 보인다
//   [홈 화면 위젯] 아이폰 앱 Scriptable로 띄우는 위젯 (/w/….json을 읽는 스크립트를 복사해 붙여 넣는다)
//
// 주소마다 보여 줄 카테고리를 고를 수 있고, 언제든 '끊기'로 그 주소를 막을 수 있다. 서버 쪽은 links.py.

import { api } from './api.js';
import { accentHex } from './settings.js';
import { ask, el, toast } from './utils.js';

const TABS = [
  ['share', '공유 링크'],
  ['ics', '캘린더 구독'],
  ['widget', '홈 화면 위젯'],
];
const ALARMS = [[null, '알림 없음'], [0, '시작할 때'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [1440, '하루 전']];
const PLACEHOLDER = { share: '예: 가족용', ics: '예: 내 아이폰', widget: '예: 내 아이폰 위젯' };

let dialog = null;
let inner = null;   // 창 안의 내용 (창 자체를 비우면 그 안으로 옮겨 둔 알림(toast)까지 지워져서 따로 둔다)
let tab = 'share';
let links = [];
let categories = [];
let editing = null;          // 고치는 중인 링크 번호 (새로 만들기는 'new')
const scripts = new Map();   // 위젯 링크 번호 → 스크립트 글 (미리 받아 두어야 아이폰에서도 '복사'가 된다)

function ensureDialog() {
  if (dialog) return dialog;
  dialog = el('dialog', { class: 'links', 'aria-labelledby': 'links-title' });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  inner = el('div', { class: 'dlg-inner' });
  dialog.append(inner);
  document.body.append(dialog);
  return dialog;
}

/** 창 열기. which: 'share' | 'ics' | 'widget' */
export async function openLinks(which = 'share') {
  tab = which;
  editing = null;
  ensureDialog();
  inner.replaceChildren(el('p', { class: 'lk-intro', style: { padding: '24px' } }, '불러오는 중…'));
  if (!dialog.open) dialog.showModal();
  await reload();
}

async function reload() {
  try {
    [links, categories] = await Promise.all([api.links(), api.categories()]);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  render();
  prefetchScripts();
}

// ---------------------------------------------------------------- 화면
function render() {
  const mine = links.filter((l) => l.kind === tab);
  inner.replaceChildren(
    el('header', { class: 'lk-head' },
      el('h2', { id: 'links-title' }, '공유 · 구독 · 위젯'),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => dialog.close() }, '✕')),
    el('div', { class: 'seg lk-tabs', role: 'tablist' },
      TABS.map(([k, label]) => el('button', {
        type: 'button', role: 'tab', class: 'seg-btn', 'aria-selected': String(k === tab), 'aria-pressed': String(k === tab),
        onclick: () => { tab = k; editing = null; render(); },
      }, label))),
    el('div', { class: 'lk-body' },
      intro(),
      mine.length ? el('ul', { class: 'lk-list' }, mine.map(card)) : null,
      editing === 'new' ? form(null) : el('button', {
        type: 'button', class: 'btn primary', onclick: () => { editing = 'new'; render(); dialog.querySelector('.lk-new input')?.focus(); },
      }, { share: '+ 새 공유 링크', ics: '+ 새 구독 주소', widget: '+ 새 위젯' }[tab]),
      howTo(),
    ),
  );
}

function intro() {
  return el('p', { class: 'lk-intro' }, ...{
    share: ['가족·친구에게 내 일정을 ', el('b', {}, '보기만'), ' 할 수 있는 달력 주소로 보내요. 받은 사람은 고칠 수 없고, 고른 카테고리만 보여요. 메모·루틴 기록·메모장은 보이지 않아요.'],
    ics: ['아이폰·맥 ', el('b', {}, '기본 캘린더'), '나 구글 캘린더에 이 캘린더를 ', el('b', {}, '구독'), '해 둬요. 기본 캘린더 위젯·잠금 화면·시리에도 일정이 보이고, 알림도 받을 수 있어요. 구독한 쪽에서는 보기만 돼요.'],
    widget: ['아이폰 ', el('b', {}, '홈 화면·잠금 화면'), '에 오늘 일정, 다음 일정, D-day, 올해 목표 진행도를 띄워요. 무료 앱 ', el('b', {}, 'Scriptable'), '로 만들어요.'],
  }[tab]);
}

function catText(opts) {
  if (!opts.categories) return '모든 카테고리';
  const names = categories.filter((c) => opts.categories.includes(c.id)).map((c) => c.name);
  return names.length ? names.join(', ') : '카테고리 없음';
}

function usedText(l) {
  if (!l.last_used_at) return '아직 안 열림';
  const [d, t] = l.last_used_at.split(' ');
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)} ${t.slice(0, 5)}에 열림`;
}

function card(l) {
  if (editing === l.id) return el('li', {}, form(l));
  const o = l.options;
  const desc = {
    share: `${catText(o)} · 메모 ${o.memo ? '보임' : '숨김'}`,
    ics: `${catText(o)} · ${ALARMS.find(([v]) => v === o.alarm)?.[1] || '알림 없음'}${o.goals ? ' · 목표 기한 포함' : ''}`,
    widget: `${catText(o)}`,
  }[l.kind];

  const actions = [];
  if (l.kind === 'share') {
    actions.push(
      button('링크 복사', () => copy(l.url, '링크를 복사했어요. 카톡·메시지에 붙여 넣으세요.'), 'primary'),
      navigator.share ? button('보내기', () => navigator.share({ title: l.label, url: l.url }).catch(() => {})) : null,
      el('a', { class: 'btn sm', href: l.url, target: '_blank', rel: 'noopener' }, '열어 보기'),
    );
  } else if (l.kind === 'ics') {
    actions.push(
      el('a', { class: 'btn sm primary', href: l.webcal }, '아이폰·맥 캘린더에 추가'),
      button('주소 복사', () => copy(l.url, '구독 주소를 복사했어요. 구글 캘린더의 \'URL로 추가\'에 붙여 넣으세요.')),
    );
  } else {
    actions.push(
      button('스크립트 복사', () => copyScript(l), 'primary'),
      el('a', { class: 'btn sm', href: scriptUrl(l), download: 'onlyforme-widget.js' }, '파일로 받기'),
    );
  }
  actions.push(el('span', { class: 'spacer' }), button('고치기', () => { editing = l.id; render(); }, 'ghost'), button('끊기', () => remove(l), 'ghost danger'));

  return el('li', { class: 'lk-card' },
    el('div', { class: 'lk-card-top' }, el('span', { class: 'lk-name' }, l.label), el('span', { class: 'lk-meta' }, usedText(l))),
    el('p', { class: 'lk-desc' }, desc),
    el('code', { class: 'lk-url', title: l.url }, l.kind === 'ics' ? l.webcal : l.url),
    el('div', { class: 'lk-actions' }, actions),
  );
}

function button(label, run, kind = '') {
  return el('button', { type: 'button', class: `btn sm ${kind}`.trim(), onclick: run }, label);
}

// 새로 만들기 / 고치기
function form(l) {
  const kind = l?.kind || tab;
  const o = l?.options || { categories: null, memo: false, alarm: kind === 'ics' ? 30 : null, goals: true };
  const name = el('input', { type: 'text', class: 'input', maxlength: '30', value: l?.label || '', placeholder: PLACEHOLDER[kind], 'aria-label': '이름' });
  const all = el('input', { type: 'checkbox', checked: !o.categories });
  const boxes = categories.map((c) => {
    const box = el('input', { type: 'checkbox', value: String(c.id), checked: !o.categories || o.categories.includes(c.id) });
    return { c, box };
  });
  all.addEventListener('change', () => boxes.forEach(({ box }) => { box.checked = all.checked; }));
  boxes.forEach(({ box }) => box.addEventListener('change', () => { all.checked = boxes.every((b) => b.box.checked); }));

  const memo = el('input', { type: 'checkbox', checked: Boolean(o.memo) });
  const goals = el('input', { type: 'checkbox', checked: o.goals !== false });
  const alarm = el('select', { class: 'input', 'aria-label': '알림' },
    ALARMS.map(([v, label]) => el('option', { value: v === null ? '' : String(v), selected: v === o.alarm }, label)));

  const submit = async (e) => {
    e.preventDefault();
    const picked = boxes.filter((b) => b.box.checked).map((b) => b.c.id);
    if (!picked.length) { toast('카테고리를 하나 이상 골라 주세요.', 'error'); return; }
    const options = { categories: picked.length === categories.length ? null : picked };
    if (kind === 'share') options.memo = memo.checked;
    if (kind === 'ics') { options.alarm = alarm.value === '' ? null : Number(alarm.value); options.goals = goals.checked; }
    try {
      if (l) await api.updateLink(l.id, { label: name.value, options });
      else await api.createLink({ kind, label: name.value, options });
      toast(l ? '저장했어요' : { share: '공유 링크를 만들었어요', ics: '구독 주소를 만들었어요', widget: '위젯 주소를 만들었어요' }[kind]);
      editing = null;
      await reload();
    } catch (err) { toast(err.message, 'error'); }
  };

  return el('form', { class: 'lk-new', novalidate: true, onsubmit: submit },
    el('h3', {}, l ? `'${l.label}' 고치기` : { share: '새 공유 링크', ics: '새 구독 주소', widget: '새 위젯' }[kind]),
    name,
    el('div', { class: 'lk-cats', role: 'group', 'aria-label': '보여 줄 카테고리' },
      el('label', { class: 'lk-check' }, all, '모든 카테고리'),
      boxes.map(({ c, box }) => el('label', { class: 'lk-cat', style: { '--cat': c.color } }, box, c.name))),
    kind === 'share' ? el('label', { class: 'lk-check' }, memo, '메모도 보여 주기') : null,
    kind === 'ics' ? el('div', { class: 'lk-row' }, '시간 있는 일정의 알림', alarm) : null,
    kind === 'ics' ? el('label', { class: 'lk-check' }, goals, '기한 있는 목표도 넣기 (🎯 하루 종일 일정으로)') : null,
    el('div', { class: 'lk-actions' },
      el('span', { class: 'spacer' }),
      button('취소', () => { editing = null; render(); }, 'ghost'),
      el('button', { type: 'submit', class: 'btn sm primary' }, l ? '저장' : '만들기')),
  );
}

// 쓰는 방법 (탭마다)
function howTo() {
  if (tab === 'share') {
    return el('p', { class: 'lk-note' }, '링크를 아는 사람은 누구나 볼 수 있어요. 더 이상 보여 주고 싶지 않으면 \'끊기\'를 누르세요. 그 주소는 바로 막혀요.');
  }
  if (tab === 'ics') {
    return el('div', { class: 'lk-how' },
      el('p', { class: 'lk-steps-title' }, '아이폰에서 추가하기'),
      el('ol', { class: 'lk-steps' },
        el('li', {}, '아이폰에서 이 창을 열고 ', el('b', {}, '아이폰·맥 캘린더에 추가'), '를 눌러요.'),
        el('li', {}, el('b', {}, '구독'), '을 누르고 이름·색·알림을 확인한 뒤 ', el('b', {}, '추가'), '를 눌러요.'),
        el('li', {}, '안 되면: 설정 → 캘린더 → 캘린더 계정 → 계정 추가 → 기타 → ', el('b', {}, '구독 캘린더 추가'), '에 주소를 붙여 넣어요.')),
      el('p', { class: 'lk-steps-title' }, '구글 캘린더에서 추가하기'),
      el('ol', { class: 'lk-steps' },
        el('li', {}, '컴퓨터로 구글 캘린더 → 왼쪽 \'다른 캘린더\'의 ', el('b', {}, '+'), ' → ', el('b', {}, 'URL로 추가'), '.'),
        el('li', {}, el('b', {}, '주소 복사'), '로 복사한 주소를 붙여 넣어요.')),
      el('p', { class: 'lk-note' },
        '구독한 캘린더는 앱이 정한 간격(아이폰은 설정에서 15분~1주, 구글은 몇 시간)마다 새로 받아 가요. 그래서 여기서 고친 일정이 바로 보이지 않을 수 있어요. 기기 간 실시간 동기화는 이 앱에서 하고, 구독은 위젯·알림용으로 쓰는 게 좋아요.'));
  }
  return el('div', { class: 'lk-how' },
    el('p', { class: 'lk-steps-title' }, '아이폰 홈 화면에 띄우기'),
    el('ol', { class: 'lk-steps' },
      el('li', {}, 'App Store에서 무료 앱 ', el('b', {}, 'Scriptable'), '을 설치해요.'),
      el('li', {}, '아이폰에서 이 창을 열고 위젯의 ', el('b', {}, '스크립트 복사'), '를 눌러요.'),
      el('li', {}, 'Scriptable에서 오른쪽 위 ', el('b', {}, '+'), '를 누르고 붙여 넣은 뒤, 맨 위 제목을 눌러 이름을 ', el('b', {}, 'Onlyforme'), '로 바꿔요. ▶︎를 누르면 미리 볼 수 있어요.'),
      el('li', {}, '홈 화면을 길게 누르고 ', el('b', {}, '편집 → 위젯 추가 → Scriptable'), '에서 크기(작게·중간·크게)를 골라 놓아요.'),
      el('li', {}, '놓은 위젯을 길게 눌러 ', el('b', {}, '위젯 편집 → Script'), '에서 ', el('b', {}, 'Onlyforme'), '를 골라요. 잠금 화면 위젯도 같은 방법이에요.')),
    el('p', { class: 'lk-note' }, '위젯은 아이폰이 정한 간격(보통 15분~1시간)으로 새로 그려져요. 위젯을 누르면 이 캘린더가 열려요. 위젯 색은 지금 고른 색 테마를 따라가요(스크립트를 복사할 때의 색).'));
}

// ---------------------------------------------------------------- 동작
async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('복사하지 못했어요. 주소를 길게 눌러 복사해 주세요.', 'error');
  }
}

const scriptUrl = (l) => `/api/links/${l.id}/script?accent=${encodeURIComponent(accentHex())}`;

function prefetchScripts() {
  for (const l of links.filter((x) => x.kind === 'widget')) {
    if (scripts.has(l.id)) continue;
    fetch(scriptUrl(l)).then((r) => (r.ok ? r.text() : null)).then((t) => { if (t) scripts.set(l.id, t); }).catch(() => {});
  }
}

async function copyScript(l) {
  const ready = scripts.get(l.id);
  if (ready) return copy(ready, '스크립트를 복사했어요. Scriptable에서 + 를 누르고 붙여 넣으세요.');
  // 아직 못 받았으면: 아이폰 Safari는 '누른 순간'에만 복사를 허락하므로 ClipboardItem에 받아 올 약속을 넘긴다
  try {
    const blob = fetch(scriptUrl(l)).then((r) => r.text()).then((t) => new Blob([t], { type: 'text/plain' }));
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    toast('스크립트를 복사했어요. Scriptable에서 + 를 누르고 붙여 넣으세요.');
  } catch {
    toast('복사하지 못했어요. \'파일로 받기\'로 받아 주세요.', 'error');
  }
}

async function remove(l) {
  const what = { share: '이 링크로는 더 이상 달력을 볼 수 없어요.', ics: '구독한 캘린더에 더 이상 새 일정이 오지 않아요. (구독은 그 기기에서 따로 지워 주세요)', widget: '이 위젯은 더 이상 새로 그려지지 않아요.' }[l.kind];
  const ok = await ask(`'${l.label}'을(를) 끊을까요? ${what}`, [
    { label: '끊기', value: true, kind: 'danger-fill' },
    { label: '취소', value: null, kind: 'ghost' },
  ]);
  if (!ok) return;
  try {
    await api.deleteLink(l.id);
    scripts.delete(l.id);
    toast('끊었어요. 그 주소는 이제 열리지 않아요.');
    await reload();
  } catch (e) { toast(e.message, 'error'); }
}
