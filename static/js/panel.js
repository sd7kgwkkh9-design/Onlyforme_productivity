// 기한 미정 목록 — 넓은 화면 오른쪽 칸의 '기한 미정' 탭
//
// 기한 미정 일정을 카드로 보여 준다.
// 카드를 달력(월간/주간)의 날짜로 끌어다 놓으면 그 날짜가 정해진다.
// 실제로 날짜를 넣는 일은 main.js의 drop 처리에서 한다. 여기서는
// "지금 어떤 일정을 끌고 있는지"만 dragState에 기록해 둔다.
//
// (휴대폰처럼 좁은 화면에서는 이 패널 대신 편집 창의 기한 미정 목록을 쓴다.)

import { api } from './api.js';
import { el, formatTimeRange } from './utils.js';

export const dragState = { itemId: null };

export class UndatedPanel {
  /**
   * @param {HTMLElement} root  탭 내용 요소 (.panel-list, .panel-add 포함)
   * @param {object} opts
   * @param {(item) => void} opts.onOpenItem  카드를 누르면 (편집 화면 열기)
   * @param {() => void}     opts.onAdd       '할 일 추가'를 누르면
   */
  constructor(root, { onOpenItem, onAdd }) {
    this.root = root;
    this.onOpenItem = onOpenItem;
    this.list = root.querySelector('.panel-list');
    root.querySelector('.panel-add').addEventListener('click', onAdd);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  async refresh() {
    const items = await api.undated();
    if (!this.isOpen) return items;

    this.list.replaceChildren(
      ...(items.length
        ? items.map((item) => this.card(item))
        : [el('li', { class: 'panel-empty' }, '날짜를 아직 못 정한 일은 여기에 모아 두세요.')]),
    );
    return items;
  }

  card(item) {
    // <button>은 파이어폭스에서 끌 수 없어서 div + role="button"을 쓴다.
    const card = el('div', {
      class: 'panel-card',
      role: 'button',
      tabindex: '0',
      draggable: 'true',
      style: { '--cat': item.category.color },
      title: '달력의 날짜로 끌어다 놓으세요',
    },
      el('span', { class: 'panel-card-title' }, item.title),
      el('span', { class: 'panel-card-meta' },
        el('span', {}, item.category.name),
        item.start_time || item.end_time
          ? el('span', { class: 'panel-card-time' }, formatTimeRange(item.start_time, item.end_time))
          : null,
      ),
    );

    card.addEventListener('click', () => this.onOpenItem(item));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onOpenItem(item);
      }
    });

    card.addEventListener('dragstart', (e) => {
      dragState.itemId = item.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.title); // 파이어폭스는 데이터가 있어야 드래그가 시작된다
      card.classList.add('is-dragging');
      document.body.classList.add('is-dragging-item');
    });
    card.addEventListener('dragend', () => {
      dragState.itemId = null;
      card.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-item');
    });

    return el('li', {}, card);
  }
}
