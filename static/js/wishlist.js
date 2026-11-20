// 메모장의 '살 것' 탭 (0.14.2) — 구매 예정 목록 (서버는 wishlist.py)
//
//   맨 위 칸에 `에어팟 프로 25만원`처럼 적고 Enter → 가격은 알아서 읽는다 (원·만원·천원, 쉼표). 상품 주소를 붙여 넣으면 링크로.
//   ⭐ 꼭 살 것은 맨 위로. 언제쯤('12월', '세일하면')·링크·가격은 항목을 눌러서 고친다.
//   ✓ 샀어요 → 목록에서 빠진다 (알림의 '되돌리기'로 되살리기). 위쪽에 가격을 적은 것의 합계.
// 나만 보는 목록이라 공유 링크·캘린더 구독·위젯에는 나가지 않는다. 검색·백업에는 들어간다.

import { api } from './api.js';
import { ask, el, icon, toast } from './utils.js';

const ICON = {
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
  plus: 'M12 5v14M5 12h14',
};

let data = null;         // {items, total, priced, starred_total, starred_count}
let wrap = null;
let editing = null;      // 고치는 중인 항목 id

const won = (n) => `${n.toLocaleString('ko-KR')}원`;

/** '에어팟 프로 25만원 https://…' → {title, price, url} (가격·주소는 없으면 null·'') */
export function parseWish(text) {
  let rest = ` ${text} `;
  let url = '';
  const u = rest.match(/\s((?:https?:\/\/|www\.)\S+)\s/i);
  if (u) { url = u[1]; rest = rest.replace(u[0], ' '); }
  let price = null;
  const p = rest.trim().match(/(?:^|\s)(\d[\d,]*(?:\.\d+)?)\s*(만\s*원|만|천\s*원|천|원)$/);
  if (p) {
    const n = Number(p[1].replace(/,/g, ''));
    const unit = p[2].replace(/\s/g, '');
    const mult = unit.startsWith('만') ? 10000 : unit.startsWith('천') ? 1000 : 1;
    if (Number.isFinite(n)) {
      price = Math.round(n * mult);
      rest = rest.trim().slice(0, -p[0].length);
    }
  }
  return { title: rest.trim().replace(/\s+/g, ' '), price, url };
}

/** notes.js의 showList가 부른다 */
export function renderWishlist() {
  wrap = el('div', { class: 'wish-wrap' });
  if (data) draw();
  else {
    wrap.append(el('p', { class: 'notes-empty' }, '불러오는 중…'));
    load();
  }
  return [wrap];
}

async function load() {
  try { data = await api.wishlist(); } catch (e) {
    wrap?.replaceChildren(el('p', { class: 'notes-empty' }, e.message));
    return;
  }
  if (wrap?.isConnected) draw();
}

/** 다른 기기에서 바뀌었을 때: 고치는 중이 아니면 새로 받는다 */
export async function refreshWishlist() {
  if (editing || (wrap && wrap.contains(document.activeElement) && document.activeElement.matches('input'))) return;
  await load();
}

// ---------------------------------------------------------------- 그리기
function draw({ focusCapture = false } = {}) {
  const input = el('input', {
    class: 'input capture-input', maxlength: '600', enterkeyhint: 'enter', 'aria-label': '살 것 적기',
    placeholder: '예: 러닝화 13만원',
    title: '가격은 끝에 13만원·130,000원처럼, 상품 주소를 붙여 넣으면 링크로',
  });
  const add = async () => {
    const parsed = parseWish(input.value);
    if (!parsed.title) { input.focus(); return; }
    try {
      await api.createWish(parsed);
      input.value = '';
      await load();
      wrap.querySelector('.capture-input')?.focus();
      toast(parsed.price != null ? `'${parsed.title}' ${won(parsed.price)} — 넣었어요` : `'${parsed.title}' 넣었어요`);
    } catch (e) { toast(e.message, 'error'); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

  const items = data.items;
  wrap.replaceChildren(
    el('div', { class: 'capture' },
      el('div', { class: 'capture-row' }, input,
        el('button', { type: 'button', class: 'icon-btn capture-add', 'aria-label': '넣기', onclick: add }, icon(ICON.plus)))),
    items.length ? summary() : null,
    items.length
      ? el('ul', { class: 'wish-list' }, items.map((w) => (w.id === editing ? form(w) : row(w))))
      : el('p', { class: 'notes-empty' }, '사고 싶은 것을 적어 두세요. 가격을 같이 적으면 모두 얼마인지 더해 드려요.'),
  );
  if (focusCapture) wrap.querySelector('.capture-input')?.focus();
}

function summary() {
  const parts = [`${data.items.length}개`];
  if (data.priced) parts.push(`${data.priced === data.items.length ? '모두' : `가격 적은 ${data.priced}개`} ${won(data.total)}`);
  return el('p', { class: 'wish-summary' }, parts.join(' · '),
    data.starred_count && data.starred_total ? el('span', { class: 'wish-summary-star' }, `⭐ 꼭 ${data.starred_count}개 ${won(data.starred_total)}`) : null);
}

function row(w) {
  const sub = [w.price != null ? won(w.price) : null, w.when || null].filter(Boolean);
  return el('li', { class: `wish-row${w.starred ? ' is-starred' : ''}` },
    el('button', {
      type: 'button', class: 'icon-btn wish-star', 'aria-pressed': String(w.starred),
      'aria-label': w.starred ? `'${w.title}' 꼭 살 것 해제` : `'${w.title}' 꼭 살 것으로`, title: '꼭 살 것 (맨 위로)',
      onclick: () => save(w, { starred: !w.starred }),
    }, icon(ICON.star)),
    el('button', { type: 'button', class: 'wish-main', onclick: () => { editing = w.id; draw(); wrap.querySelector('.wish-form input')?.focus(); } },
      el('span', { class: 'wish-title' }, w.title),
      sub.length ? el('span', { class: 'wish-sub' }, sub.join(' · ')) : null),
    w.url
      ? el('a', { class: 'icon-btn wish-link', href: w.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `'${w.title}' 상품 페이지 열기`, title: hostOf(w.url) }, icon(ICON.link))
      : null,
    el('button', { type: 'button', class: 'icon-btn wish-bought', 'aria-label': `'${w.title}' 샀어요`, title: '샀어요 (목록에서 빼기)', onclick: () => bought(w) }, icon(ICON.check)));
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function form(w) {
  const title = el('input', { class: 'input', value: w.title, maxlength: '60', 'aria-label': '이름' });
  const price = el('input', { class: 'input', type: 'text', inputmode: 'numeric', value: w.price != null ? w.price.toLocaleString('ko-KR') : '', placeholder: '예: 130000 또는 13만', 'aria-label': '가격 (원)' });
  const when = el('input', { class: 'input', value: w.when, maxlength: '20', placeholder: '예: 12월, 세일하면', 'aria-label': '언제쯤' });
  const url = el('input', { class: 'input', type: 'url', value: w.url, maxlength: '500', placeholder: 'https://…', 'aria-label': '링크' });
  const err = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const node = el('form', { class: 'wish-form', novalidate: true },
    el('label', { class: 'wish-field' }, el('span', {}, '이름'), title),
    el('div', { class: 'wish-two' },
      el('label', { class: 'wish-field' }, el('span', {}, '가격'), price),
      el('label', { class: 'wish-field' }, el('span', {}, '언제쯤'), when)),
    el('label', { class: 'wish-field' }, el('span', {}, '링크'), url),
    err,
    el('div', { class: 'wish-form-buttons' },
      el('button', { type: 'button', class: 'btn sm ghost danger', onclick: () => remove(w) }, '빼기'),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { editing = null; draw(); } }, '취소'),
      el('button', { type: 'submit', class: 'btn sm primary' }, '저장')));
  node.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = price.value.trim();
    let p = null;
    if (raw) {
      p = parseWish(`x ${raw}${/\d$/.test(raw) ? '원' : ''}`).price;
      if (p == null) { err.textContent = '가격은 130000, 13만, 13만원처럼 적어 주세요.'; err.hidden = false; return; }
    }
    const ok = await save(w, { title: title.value, price: p, when: when.value, url: url.value }, err);
    if (ok) { editing = null; draw(); }
  });
  node.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; draw(); } });
  return el('li', { class: 'wish-row is-editing' }, node);
}

// ---------------------------------------------------------------- 저장
async function save(w, fields, errEl = null) {
  try {
    await api.updateWish(w.id, fields);
    if (!errEl) await load();
    else data = await api.wishlist();
    return true;
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.hidden = false; } else toast(e.message, 'error');
    return false;
  }
}

async function bought(w) {
  try {
    await api.deleteWish(w.id);
    await load();
    toast(`'${w.title}' 샀어요 🎉 목록에서 뺐어요`, 'info', { action: { label: '되돌리기', run: () => restore(w) } });
  } catch (e) { toast(e.message, 'error'); }
}

async function remove(w) {
  const ok = await ask(`'${w.title}'을(를) 목록에서 뺄까요?`, [
    { label: '빼기', value: true, kind: 'danger-fill' }, { label: '취소', value: null, kind: 'ghost' }]);
  if (!ok) return;
  editing = null;
  try {
    await api.deleteWish(w.id);
    await load();
    toast(`'${w.title}' 뺐어요`, 'info', { action: { label: '되돌리기', run: () => restore(w) } });
  } catch (e) { toast(e.message, 'error'); }
}

async function restore(w) {
  try {
    await api.createWish({ title: w.title, price: w.price, url: w.url, starred: w.starred, when: w.when });
    await load();
  } catch (e) { toast(e.message, 'error'); }
}
