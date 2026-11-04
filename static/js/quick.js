// 빠른 입력 (7차)
//
// "내일 3시~5시 스터디 #과제" 처럼 한 줄로 쓰면 날짜·시간·카테고리를 알아서 채운다.
// 해석은 서버의 파이썬 코드(quickadd.py)가 하고, 이 화면은
//   1) 쓰는 동안 '어떻게 읽었는지'를 바로 보여 주고 (읽은 부분은 색으로 표시)
//   2) Enter(추가)를 누르면 그대로 저장하고,
//   3) '자세히'를 누르면 채워진 입력 창을 연다 (메모·여러 날짜 등을 더 손볼 때).

import { api } from './api.js';
import { ddayLabel, daysBetween, el, formatShort, formatTimeRange, todayStr, toast } from './utils.js';

const KIND_LABEL = { date: '날짜', time: '시간', category: '카테고리', dday: 'D-day', undated: '기한 미정' };

export class QuickAdd {
  /**
   * @param {HTMLDialogElement} dialog  <dialog id="quick">
   * @param {object} opts
   * @param {(item) => Promise<void>} opts.onSaved     저장한 뒤 (화면 새로 고침)
   * @param {(date: string) => void}  opts.onOpenDate  알림의 '보기'를 누르면
   * @param {(prefill) => void}       opts.onDetail    '자세히'를 누르면 (입력 창 열기)
   */
  constructor(dialog, { onSaved, onOpenDate, onDetail }) {
    this.dialog = dialog;
    this.onSaved = onSaved;
    this.onOpenDate = onOpenDate;
    this.onDetail = onDetail;
    this.input = dialog.querySelector('.quick-input');
    this.readEl = dialog.querySelector('.quick-read');
    this.previewEl = dialog.querySelector('.quick-preview');
    this.saveBtn = dialog.querySelector('.quick-save');
    this.token = 0;
    this.result = null;   // 마지막 해석 결과
    this.resultText = null;
    this.timer = null;

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.parse(), 120);
    });
    dialog.querySelector('.quick-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
    dialog.querySelector('.quick-detail').addEventListener('click', () => this.detail());
    dialog.querySelector('.quick-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  open() {
    if (!this.dialog.open) this.dialog.showModal();
    this.input.focus();
    this.input.select();
    this.render();
  }

  async parse() {
    const text = this.input.value.trim();
    const token = ++this.token;
    if (!text) {
      this.result = null;
      this.resultText = '';
      this.render();
      return null;
    }
    try {
      const result = await api.parse(text, todayStr());
      if (token !== this.token) return this.result; // 그 사이 더 쳤으면 옛 결과는 버린다
      this.result = result;
      this.resultText = text;
      this.render();
      return result;
    } catch (e) {
      if (token === this.token) this.previewEl.replaceChildren(el('p', { class: 'form-error' }, e.message));
      return null;
    }
  }

  // 저장 직전: 마지막으로 친 글자까지 해석이 끝났는지 확인
  async current() {
    clearTimeout(this.timer);
    const text = this.input.value.trim();
    if (!text) return null;
    if (this.resultText === text && this.result) return this.result;
    return this.parse();
  }

  render() {
    const r = this.result;
    const text = this.resultText || '';
    this.saveBtn.disabled = !r || !r.title;

    if (!r) {
      this.readEl.replaceChildren();
      this.previewEl.replaceChildren(el('p', { class: 'quick-placeholder' }, '쓰는 대로 날짜·시간·카테고리를 알아서 채워요.'));
      return;
    }

    // 1) 어떻게 읽었는지: 원래 글에서 읽은 부분을 색으로 표시
    const parts = [];
    let pos = 0;
    for (const s of r.spans) {
      if (s.start > pos) parts.push(text.slice(pos, s.start));
      parts.push(el('mark', { class: `k-${s.kind}`, title: KIND_LABEL[s.kind] }, text.slice(s.start, s.end)));
      pos = s.end;
    }
    if (pos < text.length) parts.push(text.slice(pos));
    this.readEl.replaceChildren(...parts);

    // 2) 결과 미리보기
    const today = todayStr();
    let dateLabel;
    if (!r.dates.length) dateLabel = '기한 미정';
    else if (r.dates.length === 1) dateLabel = formatShort(r.dates[0]) + (r.dates[0] === today ? ' 오늘' : '');
    else if (isConsecutive(r.dates)) dateLabel = `${formatShort(r.dates[0])}~${formatShort(r.dates.at(-1))} · ${r.dates.length}일`;
    else dateLabel = `${r.dates.slice(0, 3).map(formatShort).join(', ')}${r.dates.length > 3 ? ` 외 ${r.dates.length - 3}개` : ''}`;

    const time = formatTimeRange(r.start_time, r.end_time);
    const chip = (label, value, extra = {}) =>
      el('span', { class: 'quick-chip', ...extra }, el('span', { class: 'quick-chip-label' }, label), value);

    this.previewEl.replaceChildren(...[
      el('p', { class: 'quick-title' }, r.title || el('span', { class: 'muted' }, '무엇을 할지도 적어 주세요')),
      el('div', { class: 'quick-chips' },
        chip('날짜', dateLabel + (r.date_defaulted ? ' (안 써서 오늘)' : '')),
        chip('시간', time || '없음'),
        chip('카테고리', el('span', { class: 'quick-cat', style: { '--cat': r.category?.color || 'var(--faint)' } },
          el('span', { class: 'dot' }), r.category?.name || '미분류')),
        r.dday && r.dates.length ? chip('D-day', ddayLabel(daysBetween(today, nextDate(r.dates, today)))) : null,
        r.routine_id ? chip('루틴', '연결됨') : null,
      ),
      r.warnings.length ? el('ul', { class: 'quick-warnings' }, r.warnings.map((w) => el('li', {}, w))) : null,
    ].filter(Boolean));
  }

  payload(r) {
    return {
      title: r.title,
      memo: '',
      dates: r.dates,
      start_time: r.start_time,
      end_time: r.end_time,
      category_id: r.category?.id ?? null,
      dday: r.dday,
      ...(r.routine_id ? { routine_id: r.routine_id } : {}),
    };
  }

  async save() {
    const r = await this.current();
    if (!r) return;
    if (!r.title) {
      toast('무엇을 할지도 적어 주세요.', 'error');
      return;
    }
    this.saveBtn.disabled = true;
    try {
      const item = await api.createItem(this.payload(r));
      this.input.value = '';
      this.result = null;
      this.resultText = '';
      this.dialog.close();
      await this.onSaved(item);
      if (item.dates.length) {
        const first = item.dates[0];
        toast(`${formatShort(first)}에 '${item.title}'을(를) 넣었어요`, 'info', { action: { label: '보기', run: () => this.onOpenDate(first) } });
      } else {
        toast(`기한 미정에 '${item.title}'을(를) 넣었어요`);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      this.render();
    }
  }

  async detail() {
    const r = await this.current();
    this.dialog.close();
    if (!r) {
      this.onDetail({ prefill: null, ctxDate: todayStr() });
      return;
    }
    this.onDetail({
      ctxDate: r.dates[0] || null,
      prefill: { ...this.payload(r), category_id: r.category?.id ?? undefined },
    });
  }
}

function isConsecutive(dates) {
  return dates.every((d, i) => i === 0 || daysBetween(dates[i - 1], d) === 1);
}

function nextDate(dates, today) {
  return dates.find((d) => d >= today) || dates.at(-1);
}
