// 상단 HUD: 뒤로 버튼 + 화면 제목 + 우편/공지/설정 아이콘 + 티켓 + 골드 + 보석
import { h, gemIcon, ticketIcon, goldIcon } from './dom.js';
import { on } from '../core/events.js';
import { formatGems } from '../systems/economy.js';
import { iconOr } from './theme.js';

// 오른쪽 재화 표시 (왼쪽부터)
const PILLS = [
  { key: 'tickets', title: '티켓 (레벨업 재료)', icon: ticketIcon, className: 'ticket-pill' },
  { key: 'gold', title: '골드 (레벨업 · 상점)', icon: goldIcon, className: 'gold-pill' },
  { key: 'gems', title: '보석', icon: gemIcon, className: '' },
];

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
  const pills = PILLS.map((p) => {
    const value = h('span', { class: 'gem-value' }, formatGems(getSave()[p.key] || 0));
    const el = h('div', { class: ['gem-pill', p.className], title: p.title }, p.icon(), value);
    return { ...p, el, value, last: getSave()[p.key] || 0 };
  });

  const linkEls = links.map((l) =>
    h(
      'button',
      { class: 'hud-link', type: 'button', title: `${l.label} (${l.key})`, 'aria-label': l.label, onclick: l.onClick },
      h('span', { class: 'hud-link-icon', 'aria-hidden': 'true' }, iconOr(`menu_${l.id}`, l.icon)),
      h('span', { class: 'hud-link-label' }, l.label),
      h('span', { class: 'menu-dot', hidden: true }),
    ),
  );
  root.append(backBtn, title, h('div', { class: 'hud-spacer' }), h('div', { class: 'hud-links' }, linkEls), ...pills.map((p) => p.el));

  const updateDots = () => {
    links.forEach((l, i) => {
      if (l.dot) linkEls[i].querySelector('.menu-dot').hidden = !l.dot();
    });
  };

  on('save:changed', (save) => {
    updateDots();
    for (const p of pills) {
      const v = save[p.key] || 0;
      if (v === p.last) continue;
      p.value.textContent = formatGems(v);
      // 숫자가 바뀌면 살짝 튀는 효과
      p.el.classList.remove('bump');
      void p.el.offsetWidth;
      p.el.classList.add('bump');
      p.last = v;
    }
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
