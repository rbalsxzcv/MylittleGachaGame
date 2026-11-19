// 홈 화면: 대표 캐릭터(왼쪽~가운데), 배너 캐러셀(진행 중인 배너만), 메뉴(오른쪽)
import { h } from './dom.js';
import { on } from '../core/events.js';
import { go } from './router.js';
import { charArt, rarityBadge, starRow } from './charCard.js';
import { createCarousel } from './carousel.js';
import { countdownEl, startCountdowns } from './countdown.js';
import { getFeatured, hasUnseenNew } from '../systems/collection.js';
import { bannerSignature } from '../systems/banners.js';
import { hasUnreadUnlocked } from '../systems/stories.js';
import { unclaimedCount } from '../systems/inbox.js';
import { RATES, PITY_LIMIT } from '../systems/gacha.js';
import { iconOr } from './theme.js';

// 메뉴 정의 — 새 기능(미션, 출석, 상점 등)은 여기에 한 줄 추가하면 됩니다.
// key: 키보드 단축키 표시용 (실제 처리는 main.js), dot: 빨간 점 표시 조건
const MENU = [
  { id: 'gacha', label: '뽑기', icon: '✦', key: 'G', screen: 'gacha', primary: true },
  { id: 'collection', label: '도감', icon: '❖', key: 'C', screen: 'collection', dot: (ctx) => hasUnseenNew(ctx.save, ctx.data.charMap) },
  { id: 'stories', label: '스토리', icon: '❝', key: 'T', screen: 'stories', dot: (ctx) => hasUnreadUnlocked(ctx) },
  { id: 'mail', label: '우편', icon: '✉︎', key: 'M', screen: 'mail', dot: (ctx) => unclaimedCount(ctx.save, ctx.data.mail) > 0 },
  { id: 'notices', label: '공지', icon: '!', key: 'N', screen: 'notices' },
  { id: 'settings', label: '설정', icon: '⚙︎', key: 'O', screen: 'settings' },
];

export function homeScreen(ctx) {
  return {
    hud: 'gems',
    mount(el) {
      const { characters, charMap } = ctx.data;
      const featured = getFeatured(ctx.save, characters, charMap);
      const banners = ctx.activeBanners();
      const signature = bannerSignature(banners);

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

      // ── 배너 캐러셀 (진행 중인 배너만) ──
      const carousel = createCarousel({
        items: banners,
        onSelect: (banner) => go('gacha', { bannerId: banner.id }),
        renderItem: (banner) =>
          h(
            'div',
            { class: 'banner-card' },
            bannerVisual(banner),
            h('span', { class: ['banner-tag', banner.type === 'pickup' && 'is-pickup'] }, banner.type === 'pickup' ? '픽업' : '상시'),
            h(
              'div',
              { class: 'banner-info' },
              h('div', { class: 'banner-title' }, banner.title),
              h('div', { class: 'banner-sub' }, `SSR ${RATES.SSR}% · ${PITY_LIMIT}회 천장`),
              countdownEl(banner.endAt, 'countdown banner-countdown'),
            ),
          ),
      });

      // ── 메뉴 ──
      const menu = h(
        'nav',
        { class: 'home-menu' },
        MENU.map((m) =>
          h(
            'button',
            {
              class: ['menu-btn', m.primary && 'menu-primary'],
              type: 'button',
              dataset: { menu: m.id },
              onclick: () => go(m.screen),
            },
            h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, iconOr(`menu_${m.id}`, m.icon)),
            h('span', { class: 'menu-label' }, m.label),
            m.key && h('kbd', { class: 'key-hint' }, m.key),
            h('span', { class: 'menu-dot', hidden: true }),
          ),
        ),
      );

      // 메뉴 빨간 점
      const updateBadges = () => {
        for (const m of MENU) {
          if (!m.dot) continue;
          const dot = menu.querySelector(`[data-menu="${m.id}"] .menu-dot`);
          dot.hidden = !m.dot(ctx);
        }
      };
      updateBadges();
      const unsub = on('save:changed', updateBadges);

      el.append(
        h('div', { class: 'home-bg' }),
        h('div', { class: 'home-logo' }, iconOr('logo', h('span', {}, 'Tiny ', h('b', {}, 'Gacha')), 'logo-img')),
        featuredEl,
        h('div', { class: 'home-carousel' }, carousel.el),
        menu,
      );
      if (characters.length === 0) {
        el.append(h('div', { class: 'home-warning' }, '캐릭터 데이터를 불러오지 못했어요 (설정 → 데이터 상태)'));
      }

      // 남은 시간 갱신 + 배너가 끝나거나 새로 시작되면 홈을 다시 그림
      const stopCountdown = startCountdowns(el, () => {
        if (bannerSignature(ctx.activeBanners()) !== signature) go('home', {}, { replace: true });
      });

      return {
        destroy() {
          carousel.destroy();
          stopCountdown();
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
  const wrap = h('div', { class: ['banner-visual', banner.type === 'pickup' && 'is-pickup'] });
  if (banner.bannerImage) {
    const img = h('img', { src: banner.bannerImage, alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.remove(), { once: true });
    wrap.append(img);
  }
  return wrap;
}
