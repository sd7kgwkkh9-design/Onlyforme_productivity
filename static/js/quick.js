// 빠른 입력 (7차)
//
// "내일 3시~5시 스터디 #과제" 처럼 한 줄로 쓰면 날짜·시간·카테고리를 알아서 채운다.
// 해석은 서버의 파이썬 코드(quickadd.py)가 하고, 이 화면은
//   1) 쓰는 동안 '어떻게 읽었는지'를 바로 보여 주고 (읽은 부분은 색으로 표시)
//   2) Enter(추가)를 누르면 그대로 저장하고,
//   3) '자세히'를 누르면 채워진 입력 창을 연다 (메모·여러 날짜 등을 더 손볼 때).
// 날짜를 안 쓰면 기록지의 할 일로 들어간다 (8차).
// 제목이 루틴 이름과 같으면('운동 7시') 일정이 아니라 루틴 기록으로 저장한다 (날짜를 안 쓰면 오늘).
// 0.9.0: '매주 월수 9시 컴구 ~12/15' → 반복 일정 (그 기간의 월·수 전부)
//        맨 앞에 - 메모, * 목표, [] 할 일 → 기록지로 (입력칸 위의 [메모][목표][할 일] 버튼으로도 넣었다 뺐다)

import { api } from './api.js';
import { ddayLabel, daysBetween, el, formatShort, formatTimeRange, todayStr, toast } from './utils.js';

const KIND_LABEL = { date: '날짜', time: '시간', category: '카테고리', dday: 'D-day', undated: '할 일', repeat: '반복', kind: '종류' };

// 입력칸 위의 종류 버튼: 누르면 맨 앞 기호를 넣었다 뺐다 한다
const KINDS = [
  { kind: 'memo', label: '메모', prefix: '- ', re: /^-\s+/ },
  { kind: 'goal', label: '목표', prefix: '* ', re: /^\*\s+/ },
  { kind: 'todo', label: '할 일', prefix: '[] ', re: /^\[\s*\]\s*/ },
];
const WD = '월화수목금토일'; // 서버(파이썬)의 요일 번호: 월=0 … 일=6

// '매주 월·수', '격주 화', '매일', '매주 평일'
export function repeatLabel(rep) {
  if (rep.daily) return '매일';
  const days = rep.weekdays.map((i) => WD[i]).join('·');
  const name = days === '월·화·수·목·금' ? '평일' : days === '토·일' ? '주말' : days;
  return `${rep.interval === 2 ? '격주' : '매주'} ${name}`;
}

export class QuickAdd {
  /**
   * @param {HTMLDialogElement} dialog  <dialog id="quick">
   * @param {object} opts
   * @param {(item) => Promise<void>} opts.onSaved     저장한 뒤 (화면 새로 고침)
   * @param {(date: string) => void}  opts.onOpenDate  알림의 '보기'를 누르면
   * @param {(prefill) => void}       opts.onDetail    '자세히'를 누르면 (입력 창 열기)
   * @param {(opts) => void}          opts.onOpenNotes 기록지 열기 (메모·목표·할 일로 넣었을 때 '보기')
   */
  constructor(dialog, { onSaved, onOpenDate, onDetail, onOpenNotes }) {
    this.dialog = dialog;
    this.onSaved = onSaved;
    this.onOpenDate = onOpenDate;
    this.onDetail = onDetail;
    this.onOpenNotes = onOpenNotes;
    this.kindsEl = dialog.querySelector('.quick-kinds');
    this.kindsEl.replaceChildren(...KINDS.map((k) =>
      el('button', { type: 'button', class: 'quick-kind', dataset: { kind: k.kind }, 'aria-pressed': 'false', onclick: () => this.toggleKind(k) }, k.label)));
    this.input = dialog.querySelector('.quick-input');
    this.readEl = dialog.querySelector('.quick-read');
    this.previewEl = dialog.querySelector('.quick-preview');
    this.saveBtn = dialog.querySelector('.quick-save');
    this.token = 0;
    this.result = null;   // 마지막 해석 결과
    this.resultText = null;
    this.timer = null;

    this.input.addEventListener('input', () => {
      this.syncKinds();
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
    this.syncKinds();
    this.render();
  }

  // [메모][목표][할 일] 버튼: 맨 앞 기호를 바꿔 끼운다 (같은 걸 다시 누르면 빼서 일반 일정으로)
  toggleKind(k) {
    let text = this.input.value.trimStart();
    const active = k.re.test(text);
    for (const other of KINDS) text = text.replace(other.re, '');
    this.input.value = active ? text : k.prefix + text;
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.syncKinds();
    this.parse();
  }

  syncKinds() {
    const text = this.input.value.trimStart();
    this.kindsEl.querySelectorAll('.quick-kind').forEach((b) => {
      const k = KINDS.find((x) => x.kind === b.dataset.kind);
      b.setAttribute('aria-pressed', String(k.re.test(text)));
    });
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
    this.saveBtn.disabled = !r || !r.title || (r.repeat && !r.dates.length);

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

    const catChip = () => chip('카테고리', el('span', { class: 'quick-cat', style: { '--cat': r.category?.color || 'var(--faint)' } },
      el('span', { class: 'dot' }), r.category?.name || '미분류'));
    let chips;
    if (r.kind === 'memo') {
      chips = [chip('기록지', '메모', { class: 'quick-chip is-note' })];
    } else if (r.kind === 'goal') {
      chips = [
        chip('기록지', '🎯 목표', { class: 'quick-chip is-note' }),
        chip('기한', r.due ? `${formatShort(r.due)} · ${ddayLabel(daysBetween(today, r.due))}` : '없음'),
      ];
    } else if (r.routine) { // 루틴 기록: 카테고리·D-day 없이
      chips = [
        chip('루틴 기록', `${r.routine.emoji} ${r.routine.name}`, { class: 'quick-chip is-routine' }),
        chip('날짜', dateLabel + (r.routine_today ? ' (안 써서 오늘)' : '')),
        chip('시간', time || '없음'),
      ];
    } else if (r.kind === 'todo') {
      chips = [chip('기록지', '할 일 (날짜 없음)', { class: 'quick-chip is-note' }), chip('시간', time || '없음'), catChip()];
    } else {
      chips = [
        r.repeat
          ? chip('반복', `${repeatLabel(r.repeat)} · ${formatShort(r.repeat.start)}~${formatShort(r.repeat.end)} · ${r.dates.length}번`, { class: 'quick-chip is-repeat' })
          : chip('날짜', dateLabel),
        chip('시간', time || '없음'),
        catChip(),
        r.dday && r.dates.length ? chip('D-day', ddayLabel(daysBetween(today, nextDate(r.dates, today)))) : null,
      ];
    }
    this.previewEl.replaceChildren(...[
      el('p', { class: 'quick-title' }, r.title || el('span', { class: 'muted' }, r.kind === 'memo' ? '메모할 내용을 적어 주세요' : '무엇을 할지도 적어 주세요')),
      el('div', { class: 'quick-chips' }, chips),
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
    };
  }

  // 루틴 기록으로 저장 (날짜마다 기록 하나)
  async saveRoutine(r) {
    const logs = [];
    for (const date of r.dates) {
      logs.push(await api.createRoutineLog({
        routine_id: r.routine.id, date, start_time: r.start_time, end_time: r.end_time, memo: '',
      }));
    }
    return logs;
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
      if (r.kind === 'memo' || r.kind === 'goal') {
        await this.saveToNotes(r);
        return;
      }
      if (r.routine) {
        const logs = await this.saveRoutine(r);
        this.clear();
        await this.onSaved();
        const first = logs[0].date;
        toast(`${formatShort(first)}에 ${r.routine.emoji} ${r.routine.name} 기록을 넣었어요`, 'info', { action: { label: '보기', run: () => this.onOpenDate(first) } });
        return;
      }
      const item = await api.createItem(this.payload(r));
      this.clear();
      await this.onSaved(item);
      if (r.repeat) {
        const first = item.dates[0];
        toast(`${repeatLabel(r.repeat)} '${item.title}' ${item.dates.length}번을 넣었어요`, 'info', { action: { label: '보기', run: () => this.onOpenDate(first) } });
      } else if (item.dates.length) {
        const first = item.dates[0];
        toast(`${formatShort(first)}에 '${item.title}'을(를) 넣었어요`, 'info', { action: { label: '보기', run: () => this.onOpenDate(first) } });
      } else {
        toast(`할 일에 '${item.title}'을(를) 넣었어요`, 'info', { action: { label: '보기', run: () => this.onOpenNotes({ tab: 'todo' }) } });
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      this.render();
    }
  }

  // 메모·목표는 기록지에 넣는다. open=true면 넣은 뒤 기록지에서 바로 연다 ('자세히')
  async saveToNotes(r, { open = false } = {}) {
    if (r.kind === 'memo') {
      const note = await api.createNote({ body: r.title });
      this.clear();
      await this.onSaved();
      if (open) this.onOpenNotes({ noteId: note.id });
      else toast('기록지에 메모했어요', 'info', { action: { label: '보기', run: () => this.onOpenNotes({ tab: 'memo' }) } });
    } else {
      const goal = await api.createGoal({ title: r.title, due: r.due });
      this.clear();
      await this.onSaved();
      if (open) this.onOpenNotes({ goalId: goal.id });
      else toast(`목표를 넣었어요${r.due ? ` · 기한 ${formatShort(r.due)}` : ''}`, 'info', { action: { label: '보기', run: () => this.onOpenNotes({ goalId: goal.id }) } });
    }
  }

  clear() {
    this.input.value = '';
    this.syncKinds();
    this.result = null;
    this.resultText = '';
    this.dialog.close();
  }

  async detail() {
    const r = await this.current();
    this.dialog.close();
    if (!r) {
      this.onDetail({ prefill: null, ctxDate: todayStr() });
      return;
    }
    if ((r.kind === 'memo' || r.kind === 'goal') && r.title) { // 기록지에 넣고 바로 열어서 더 쓰기
      try { await this.saveToNotes(r, { open: true }); } catch (e) { toast(e.message, 'error'); }
      return;
    }
    if (r.routine) { // 루틴 기록 창 (첫 날짜로)
      this.onDetail({
        routineLog: { routine: r.routine, date: r.dates[0], prefill: { start_time: r.start_time, end_time: r.end_time } },
      });
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
