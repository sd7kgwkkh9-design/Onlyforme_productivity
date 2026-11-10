// 메모 마크다운 (0.10.0)
//
//   marked    (MIT)                   마크다운 글 → HTML
//   DOMPurify (Apache-2.0 / MPL-2.0)  HTML에서 위험한 부분(스크립트, onclick 같은 속성)을 걸러 내는 안전장치
//
// - 두 라이브러리는 static/vendor/에 그대로 넣었고, 메모를 처음 볼 때 한 번만 불러온다 (첫 화면을 무겁게 하지 않으려고).
//   주소는 index.html의 data-marked / data-purify에 지문(?v=…)이 붙은 채로 들어 있다.
// - 체크리스트 `- [ ] 할 것`은 보기 화면에서 바로 눌러서 체크할 수 있다 → 원래 글의 그 줄이 `- [x]`로 바뀐다.
// - 메모 목록의 카드에는 기호를 걷어 낸 짧은 글만 보여 준다 (stripMarkdown, 라이브러리 없이).

let ready = null;

function load() {
  if (!ready) {
    const { marked: markedUrl, purify: purifyUrl } = document.body.dataset;
    ready = Promise.all([import(markedUrl), import(purifyUrl)]).then(([m, p]) => {
      const marked = m.marked;
      const DOMPurify = p.default;
      marked.setOptions({ gfm: true, breaks: true }); // 줄바꿈 한 번도 그대로 줄바꿈 (메모장처럼)
      // 링크는 새 탭에서 열고, 열린 페이지가 이 앱을 건드리지 못하게
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'A') {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      });
      return { marked, DOMPurify };
    });
    ready.catch(() => { ready = null; }); // 못 불러오면 다음에 다시 시도
  }
  return ready;
}

// 체크리스트 줄: '- [ ] 글', '* [x] 글', '1. [ ] 글'
const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

/**
 * 마크다운 글을 안전한 HTML로 바꿔 box 안에 넣는다.
 * onToggle(새 글): 체크리스트를 눌렀을 때 그 줄을 바꾼 전체 글을 넘겨준다 (저장은 부른 쪽에서).
 * 라이브러리를 못 불러오면 글을 그대로(줄바꿈만 살려서) 보여 준다.
 */
export async function renderMarkdown(box, text, { onToggle = null } = {}) {
  let lib;
  try { lib = await load(); } catch { lib = null; }
  if (!lib) {
    box.textContent = text;
    box.classList.add('is-plain');
    return;
  }
  const html = lib.DOMPurify.sanitize(lib.marked.parse(text || ''), { ADD_ATTR: ['target'] });
  box.innerHTML = html;

  // marked는 체크 칸을 '누를 수 없게(disabled)' 만든다 → 눌러서 체크할 수 있게 풀고, 원래 글의 몇 번째 줄인지 이어 준다
  const taskLines = [];
  (text || '').split('\n').forEach((line, i) => { if (TASK_LINE.test(line)) taskLines.push(i); });
  box.querySelectorAll('input[type="checkbox"]').forEach((input, n) => {
    const lineNo = taskLines[n];
    input.closest('li')?.classList.add('task');
    if (lineNo == null || !onToggle) return;
    input.disabled = false;
    input.setAttribute('aria-label', input.checked ? '체크 풀기' : '체크');
    input.addEventListener('change', () => {
      const lines = text.split('\n');
      lines[lineNo] = lines[lineNo].replace(TASK_LINE, (_, head, mark) => `${head}[${mark === ' ' ? 'x' : ' '}]`);
      onToggle(lines.join('\n'));
    });
  });
}

/** 카드 미리보기용: 마크다운 기호를 걷어 낸 글 (체크리스트는 ☐/☑로) */
export function stripMarkdown(text) {
  return (text || '')
    .replace(TASK_LINE_GLOBAL, (_, _head, mark) => (mark === ' ' ? '☐ ' : '☑ '))
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')            // # 제목
    .replace(/^\s{0,3}>\s?/gm, '')                 // > 인용
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '· ')   // 목록 기호
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')      // 그림
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // [글](주소) → 글
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')       // **굵게**, ~~취소~~, `코드`
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2'); // *기울임*
}
const TASK_LINE_GLOBAL = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]\s*/gm;
