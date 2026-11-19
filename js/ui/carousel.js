// 범용 캐러셀(배너 슬라이드)
// Phase 3에서는 banners.json의 활성 배너 목록이 그대로 들어옵니다.

import { h } from './dom.js';

/**
 * @param {object} opts
 * @param {Array} opts.items
 * @param {(item:any)=>HTMLElement} opts.renderItem 슬라이드 내용
 * @param {(item:any)=>void} [opts.onSelect] 슬라이드를 탭했을 때
 * @param {number} [opts.interval] 자동 넘김 간격(ms), 0이면 끔
 * @returns {{el:HTMLElement, next:Function, prev:Function, destroy:Function}}
 */
export function createCarousel({ items, renderItem, onSelect, interval = 6000 }) {
  let index = 0;
  let timer = null;

  const track = h(
    'div',
    { class: 'carousel-track' },
    items.map((item) => h('div', { class: 'carousel-slide', onclick: () => !dragged && onSelect?.(item) }, renderItem(item))),
  );
  const dots = h(
    'div',
    { class: 'carousel-dots' },
    items.map((_, i) => h('button', { class: 'carousel-dot', type: 'button', 'aria-label': `${i + 1}번 배너`, onclick: () => goTo(i) })),
  );
  const multi = items.length > 1;
  const el = h(
    'div',
    { class: ['carousel', !multi && 'single'] },
    h('div', { class: 'carousel-window' }, track),
    multi && h('button', { class: 'carousel-arrow prev', type: 'button', 'aria-label': '이전 배너', onclick: () => prev() }, '‹'),
    multi && h('button', { class: 'carousel-arrow next', type: 'button', 'aria-label': '다음 배너', onclick: () => next() }, '›'),
    multi && dots,
  );

  function render() {
    track.style.transform = `translateX(${-index * 100}%)`;
    [...dots.children].forEach((d, i) => d.classList.toggle('active', i === index));
  }
  function goTo(i) {
    if (!items.length) return;
    index = (i + items.length) % items.length;
    render();
    restart();
  }
  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  function restart() {
    clearInterval(timer);
    if (multi && interval > 0) {
      timer = setInterval(() => {
        if (!document.hidden) goTo(index + 1);
      }, interval);
    }
  }

  // 스와이프 (터치/마우스 공통)
  let startX = null;
  let dragged = false;
  el.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    dragged = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (startX !== null && Math.abs(e.clientX - startX) > 12) dragged = true;
  });
  el.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (multi && Math.abs(dx) > 40) dx < 0 ? next() : prev();
    // 클릭 이벤트가 끝난 뒤 드래그 표시 해제
    setTimeout(() => (dragged = false), 0);
  });
  el.addEventListener('pointercancel', () => (startX = null));

  render();
  restart();

  return { el, next, prev, destroy: () => clearInterval(timer) };
}
