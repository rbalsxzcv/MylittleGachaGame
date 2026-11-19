// 상단 HUD: 뒤로 버튼 + 화면 제목 + 우편/공지/설정 아이콘 + 티켓 + 보석
import { h, gemIcon, ticketIcon } from './dom.js';
import { on } from '../core/events.js';
import { formatGems } from '../systems/economy.js';
import { iconOr } from './theme.js';

/**
 * @param {HTMLElement} root #hud 요소
 * @param {object} opts
 * @param {()=>object} opts.getSave
 * @param {()=>void} opts.onBack
 * @param {Array<{id:string, label:string, icon:string, key:string, onClick:()=>void, dot?:()=>boolean}>} opts.links
 */
export function initHud(root, { getSave, onBack, links = [] }) {
  const backBtn = h('button', { class: 'hud-back', type: 'button', 'aria-label': '뒤로 (Esc)', onclick: onBack }, '‹');
  const title = h('div', { class: 'hud-title' });
  const gemValue = h('span', { class: 'gem-value' }, formatGems(getSave().gems));
  const gemPill = h('div', { class: 'gem-pill', title: '보석' }, gemIcon(), gemValue);
  const ticketValue = h('span', { class: 'gem-value' }, formatGems(getSave().tickets));
  const ticketPill = h('div', { class: 'gem-pill ticket-pill', title: '티켓 (레벨업 재료)' }, ticketIcon(), ticketValue);

  const linkEls = links.map((l) =>
    h(
      'button',
      { class: 'hud-link', type: 'button', title: `${l.label} (${l.key})`, 'aria-label': l.label, onclick: l.onClick },
      h('span', { class: 'hud-link-icon', 'aria-hidden': 'true' }, iconOr(`menu_${l.id}`, l.icon)),
      h('span', { class: 'hud-link-label' }, l.label),
      h('span', { class: 'menu-dot', hidden: true }),
    ),
  );
  root.append(backBtn, title, h('div', { class: 'hud-spacer' }), h('div', { class: 'hud-links' }, linkEls), ticketPill, gemPill);

  const updateDots = () => {
    links.forEach((l, i) => {
      if (l.dot) linkEls[i].querySelector('.menu-dot').hidden = !l.dot();
    });
  };

  let last = { gems: getSave().gems, tickets: getSave().tickets };
  on('save:changed', (save) => {
    updateDots();
    if (save.gems !== last.gems) {
      gemValue.textContent = formatGems(save.gems);
      // 숫자가 바뀌면 살짝 튀는 효과
      gemPill.classList.remove('bump');
      void gemPill.offsetWidth;
      gemPill.classList.add('bump');
    }
    if (save.tickets !== last.tickets) ticketValue.textContent = formatGems(save.tickets);
    last = { gems: save.gems, tickets: save.tickets };
  });

  return {
    /** 화면이 바뀔 때 호출 */
    update(screen) {
      root.dataset.mode = screen.def.hud;
      title.textContent = screen.def.title || '';
      updateDots();
    },
  };
}
