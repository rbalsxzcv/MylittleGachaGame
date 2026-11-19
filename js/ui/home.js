// 홈 화면: 대표 캐릭터(왼쪽~가운데), 배너 캐러셀, 메뉴(오른쪽)
import { h } from './dom.js';
import { on } from '../core/events.js';
import { go } from './router.js';
import { toast } from './toast.js';
import { charArt, rarityBadge, starRow } from './charCard.js';
import { createCarousel } from './carousel.js';
import { getFeatured, hasUnseenNew } from '../systems/collection.js';
import { RATES, PITY_LIMIT } from '../systems/gacha.js';

// 메뉴 정의 — 새 기능(미션, 출석, 상점 등)은 여기에 한 줄 추가하면 됩니다.
// key: 키보드 단축키 표시용 (실제 처리는 main.js)
const MENU = [
  { id: 'gacha', label: '뽑기', icon: '✦', key: 'G', screen: 'gacha', primary: true },
  { id: 'collection', label: '도감', icon: '❖', key: 'C', screen: 'collection' },
  { id: 'story', label: '스토리', icon: '❝', soon: true },
  { id: 'mail', label: '우편', icon: '✉︎', soon: true },
  { id: 'notice', label: '공지', icon: '!', soon: true },
  { id: 'settings', label: '설정', icon: '⚙︎', key: 'O', screen: 'settings' },
];

export function homeScreen(ctx) {
  return {
    hud: 'gems',
    mount(el) {
      const { characters, charMap } = ctx.data;
      const featured = getFeatured(ctx.save, characters, charMap);

      // ── 대표 캐릭터 ──
      let featuredEl;
      if (featured) {
        const entry = ctx.save.owned[featured.id];
        const art = h('div', { class: 'featured-art' }, charArt(featured));
        art.addEventListener('click', () => {
          art.classList.remove('poke');
          void art.offsetWidth;
          art.classList.add('poke');
        });
        featuredEl = h(
          'div',
          { class: `featured rar-${featured.rarity}` },
          h('div', { class: 'featured-aura' }),
          art,
          h(
            'div',
            { class: 'featured-plate' },
            h('div', { class: 'fp-top' }, rarityBadge(featured.rarity), starRow(entry?.stars ?? 1)),
            featured.title && h('div', { class: 'fp-title' }, featured.title),
            h('div', { class: 'fp-name' }, featured.name),
          ),
        );
      } else {
        featuredEl = h(
          'div',
          { class: 'featured featured-empty' },
          h('div', { class: 'fe-mark' }, '?'),
          h('div', { class: 'fe-text' }, '아직 함께하는 동료가 없어요'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('gacha') }, '첫 동료 만나러 가기'),
        );
      }

      // ── 배너 캐러셀 ──
      const carousel = createCarousel({
        items: ctx.banners,
        onSelect: (banner) => go('gacha', { bannerId: banner.id }),
        renderItem: (banner) =>
          h(
            'div',
            { class: 'banner-card' },
            bannerVisual(banner),
            h('span', { class: 'banner-tag' }, banner.type === 'pickup' ? '픽업' : '상시'),
            h(
              'div',
              { class: 'banner-info' },
              h('div', { class: 'banner-title' }, banner.title),
              h('div', { class: 'banner-sub' }, `SSR ${RATES.SSR}% · ${PITY_LIMIT}회 천장`),
            ),
          ),
      });

      // ── 메뉴 ──
      const menuButtons = MENU.map((m) => {
        const btn = h(
          'button',
          {
            class: ['menu-btn', m.primary && 'menu-primary', m.soon && 'menu-soon'],
            type: 'button',
            dataset: { menu: m.id },
            onclick: () => (m.soon ? toast(`${m.label}: 준비 중이에요`) : go(m.screen)),
          },
          h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, m.icon),
          h('span', { class: 'menu-label' }, m.label),
          m.key && h('kbd', { class: 'key-hint' }, m.key),
          h('span', { class: 'menu-dot', hidden: true }),
        );
        return btn;
      });
      const menu = h('nav', { class: 'home-menu' }, menuButtons);

      // 도감 NEW 표시(빨간 점)
      const updateBadges = () => {
        const dot = menu.querySelector('[data-menu="collection"] .menu-dot');
        dot.hidden = !hasUnseenNew(ctx.save, charMap);
      };
      updateBadges();
      const unsub = on('save:changed', updateBadges);

      el.append(
        h('div', { class: 'home-bg' }),
        h('div', { class: 'home-logo' }, 'Tiny ', h('b', {}, 'Gacha')),
        featuredEl,
        h('div', { class: 'home-carousel' }, carousel.el),
        menu,
      );
      if (characters.length === 0) {
        el.append(h('div', { class: 'home-warning' }, '캐릭터 데이터를 불러오지 못했어요 (설정 → 데이터 상태)'));
      }

      return {
        destroy() {
          carousel.destroy();
          unsub();
        },
        onKey(e) {
          if (e.code === 'ArrowRight') return carousel.next(), true;
          if (e.code === 'ArrowLeft') return carousel.prev(), true;
          return false;
        },
      };
    },
  };
}

/** 배너 그림. 이미지가 없거나 실패하면 그라데이션으로 대체 */
export function bannerVisual(banner) {
  const wrap = h('div', { class: 'banner-visual' });
  if (banner.bannerImage) {
    const img = h('img', { src: banner.bannerImage, alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.remove(), { once: true });
    wrap.append(img);
  }
  return wrap;
}
