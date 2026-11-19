// 상단 HUD: 뒤로 버튼 + 화면 제목 + 보석 표시
import { h, gemIcon } from './dom.js';
import { on } from '../core/events.js';
import { formatGems } from '../systems/economy.js';

/**
 * @param {HTMLElement} root #hud 요소
 * @param {{getGems:()=>number, onBack:()=>void}} opts
 */
export function initHud(root, { getGems, onBack }) {
  const backBtn = h('button', { class: 'hud-back', type: 'button', 'aria-label': '뒤로 (Esc)', onclick: onBack }, '‹');
  const title = h('div', { class: 'hud-title' });
  const gemValue = h('span', { class: 'gem-value' }, formatGems(getGems()));
  const gemPill = h('div', { class: 'gem-pill', title: '보석' }, gemIcon(), gemValue);
  root.append(backBtn, title, h('div', { class: 'hud-spacer' }), gemPill);

  let lastGems = getGems();
  on('save:changed', (save) => {
    if (save.gems === lastGems) return;
    lastGems = save.gems;
    gemValue.textContent = formatGems(save.gems);
    // 숫자가 바뀌면 살짝 튀는 효과
    gemPill.classList.remove('bump');
    void gemPill.offsetWidth;
    gemPill.classList.add('bump');
  });

  return {
    /** 화면이 바뀔 때 호출 */
    update(screen) {
      const mode = screen.def.hud;
      root.dataset.mode = mode;
      title.textContent = screen.def.title || '';
    },
  };
}
