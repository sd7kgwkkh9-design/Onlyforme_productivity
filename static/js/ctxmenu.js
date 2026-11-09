// 일정을 두 손가락 클릭(오른쪽 클릭)했을 때 뜨는 메뉴 (0.9.0, 직접 구현)
//
//   openMenu(event, [
//     { label: '수정', run: () => … },
//     { label: '다른 날로 복사…', run: () => … },
//     { label: '삭제', danger: true, run: () => … },
//   ]);
//
// - 마우스·트랙패드가 있는 화면(맥, 윈도우)에서만 뜬다. 휴대폰은 꾹 누르기가 '끌어서 옮기기'라서 메뉴를 띄우지 않는다.
// - 키보드: 일정에 포커스를 두고 Shift+F10(또는 메뉴 키) → 위아래 화살표로 고르고 Enter, Esc로 닫기.
// - popover(manual)로 띄워서 열려 있는 팝업 창(dialog)보다도 위에 보인다.
//   브라우저의 '바깥 누르면 닫기'(light dismiss)는 쓰지 않는다: 두 손가락 클릭은 메뉴가 뜬 '뒤에' 손을 떼는
//   신호(pointerup)가 와서, 그걸 바깥 클릭으로 알고 메뉴가 바로 닫혀 버리기 때문. 대신 바깥을 '누르는' 순간 닫는다.

import { el, topLayerHost } from './utils.js';

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

let menu = null;
let returnFocus = null;

const isOpen = () => Boolean(menu && (menu.matches?.(':popover-open') || menu.classList.contains('is-open')));

function hide({ restoreFocus = true } = {}) {
  if (!isOpen()) return;
  if (menu.matches?.(':popover-open')) menu.hidePopover();
  menu.classList.remove('is-open');
  if (restoreFocus) returnFocus?.focus?.({ preventScroll: true });
}

function setup() {
  if (menu) return menu;
  menu = document.getElementById('ctx-menu');
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.ctx-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') { e.preventDefault(); hide(); }
  });
  // Esc, 바깥 누르기, 스크롤, 창 크기 바뀜 → 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); hide(); }
  }, true);
  document.addEventListener('pointerdown', (e) => { if (isOpen() && !menu.contains(e.target)) hide({ restoreFocus: false }); }, true);
  window.addEventListener('resize', () => hide({ restoreFocus: false }));
  document.addEventListener('scroll', (e) => { if (!menu.contains(e.target)) hide({ restoreFocus: false }); }, true);
  return menu;
}

/**
 * @param {MouseEvent} event   contextmenu 이벤트
 * @param {{label: string, run: Function, danger?: boolean, hint?: string}[]} items
 * @param {object} [opts]
 * @param {string} [opts.title]  메뉴 맨 위에 작게 보일 이름 (일정 제목)
 * @returns {boolean} 메뉴를 띄웠는지
 */
export function openMenu(event, items, { title = '' } = {}) {
  const keyboard = event.clientX === 0 && event.clientY === 0; // Shift+F10 / 메뉴 키
  if (!finePointer.matches && !keyboard) return false;          // 휴대폰: 기본 동작 그대로
  event.preventDefault();
  event.stopPropagation();
  setup();
  hide({ restoreFocus: false });
  returnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;

  menu.replaceChildren(
    title ? el('p', { class: 'ctx-title' }, title) : null,
    ...items.filter(Boolean).map((item) =>
      el('button', {
        type: 'button',
        role: 'menuitem',
        class: item.danger ? 'ctx-item danger' : 'ctx-item',
        onclick: () => { hide({ restoreFocus: false }); item.run(); },
      }, item.label, item.hint ? el('span', { class: 'ctx-hint' }, item.hint) : null)),
  );

  // 위치: 마우스 자리 (키보드면 그 일정 바로 아래). 화면 밖으로 나가지 않게 맞춘다.
  let x = event.clientX;
  let y = event.clientY;
  if (keyboard) {
    const r = (event.target instanceof Element ? event.target : returnFocus)?.getBoundingClientRect?.();
    if (r) { x = r.left + 8; y = r.bottom + 4; }
  }
  const host = topLayerHost(); // 팝업 창 안의 하루 목록에서 열었으면 메뉴도 그 창 안에 (창 바깥은 누를 수 없어서)
  if (menu.parentElement !== host) host.append(menu);
  menu.style.left = '0px';
  menu.style.top = '0px';
  if (menu.showPopover) menu.showPopover();
  else menu.classList.add('is-open');
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, y + height > window.innerHeight - 8 ? y - height : y)}px`;
  menu.querySelector('.ctx-item')?.focus({ preventScroll: true });
  return true;
}
