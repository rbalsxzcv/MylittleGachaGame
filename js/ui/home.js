// 홈 화면: 대표 캐릭터 상반신(왼쪽~가운데), 배너 캐러셀(오른쪽 위, 진행 중인 배너만),
// 메뉴(하단: 하나로 이어진 긴 바 + 오른쪽 끝의 큰 뽑기 버튼)
import { h } from './dom.js';
import { on } from '../core/events.js';
import { go } from './router.js';
import { charArt } from './charCard.js';
import { createCarousel } from './carousel.js';
import { countdownEl, startCountdowns } from './countdown.js';
import { getFeatured, hasUnseenNew } from '../systems/collection.js';
import { bannerSignature } from '../systems/banners.js';
import { hasOpenAdventure } from '../systems/adventure.js';
import { canBreakthrough } from '../systems/progression.js';
import { MAX_RARITY } from '../config.js';
import { iconOr } from './theme.js';
import { hasFreeItem } from '../systems/shop.js';

// 메뉴 정의 — 새 기능(미션, 출석, 상점 등)은 여기에 한 줄 추가하면 됩니다.
// key: 키보드 단축키 표시용 (실제 처리는 main.js), dot: 빨간 점 표시 조건, soon: 준비 중(누를 수 없음)
// primary: 바 밖 오른쪽 끝의 큰 버튼으로 (뽑기), 나머지는 순서대로 하단 바 안에
// 우편 / 공지 / 설정은 위쪽 HUD 아이콘 (main.js의 HUD_LINKS)
const MENU = [
  { id: 'gacha', label: '뽑기', icon: '✦', key: 'G', screen: 'gacha', primary: true },
  // id는 예전 그대로 'stories' (화면 에셋 icons.menu_stories를 계속 씀), 화면은 모험
  { id: 'stories', label: '모험', icon: '⚔', key: 'T', screen: 'adventure', dot: (ctx) => hasOpenAdventure(ctx) },
  { id: 'growth', label: '육성', icon: '▲', key: 'U', screen: 'growth', dot: (ctx) => canGrowAny(ctx) },
  { id: 'team', label: '편성', icon: '⚑', key: 'P', screen: 'team' },
  { id: 'collection', label: '도감', icon: '❖', key: 'C', screen: 'collection', dot: (ctx) => hasUnseenNew(ctx.save, ctx.data.charMap) },
  { id: 'shop', label: '상점', icon: '⚖', key: 'S', screen: 'shop', shop: true, dot: (ctx) => hasFreeItem(ctx.save, ctx.data.shop) },
  { id: 'event', label: '이벤트', icon: '★', soon: true },
];

/** 돌파할 수 있는 캐릭터가 있으면 육성 메뉴에 빨간 점 */
function canGrowAny(ctx) {
  return ctx.data.characters.some((c) => canBreakthrough(ctx.save.owned[c.id], ctx.data.balance));
}

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
        const art = h('div', { class: 'featured-art' }, charArt(featured));
        art.addEventListener('click', () => {
          art.classList.remove('poke');
          void art.offsetWidth;
          art.classList.add('poke');
        });
        featuredEl = h('div', { class: `featured rar-${featured.rarity}` }, h('div', { class: 'featured-aura' }), art);
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
            bannerVisual(banner, charMap),
            h('span', { class: ['banner-tag', banner.type === 'pickup' && 'is-pickup'] }, banner.type === 'pickup' ? '픽업' : '상시'),
            h(
              'div',
              { class: 'banner-info' },
              h('div', { class: 'banner-title' }, banner.title),
              h('div', { class: 'banner-sub' }, `${MAX_RARITY}★ ${ctx.data.balance.gacha.rates[MAX_RARITY]}% · ${ctx.data.balance.gacha.pity}회 천장`),
              countdownEl(banner.endAt, 'countdown banner-countdown'),
            ),
          ),
      });

      // ── 메뉴: 긴 바 하나 + 오른쪽 끝 큰 뽑기 버튼 ──
      const menuBtn = (m) =>
        h(
          'button',
          {
            class: ['menu-btn', m.primary && 'menu-primary menu-gacha', m.shop && 'menu-shop', m.soon && 'menu-soon'],
            type: 'button',
            dataset: { menu: m.id },
            disabled: m.soon,
            'aria-disabled': m.soon ? 'true' : null,
            onclick: m.soon ? null : () => go(m.screen),
          },
          m.primary && h('i', { class: 'menu-gacha-shine', 'aria-hidden': 'true' }),
          h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, iconOr(`menu_${m.id}`, m.icon)),
          h('span', { class: 'menu-label' }, m.label, m.soon && h('small', { class: 'menu-sub' }, '준비 중')),
          m.key && h('kbd', { class: 'key-hint' }, m.key),
          h('span', { class: 'menu-dot', hidden: true }),
        );
      const menu = h(
        'nav',
        { class: 'home-menu' },
        h('div', { class: 'menu-bar' }, MENU.filter((m) => !m.primary).map(menuBtn)),
        MENU.filter((m) => m.primary).map(menuBtn),
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

/**
 * 배너 그림. 그림이 없으면 그라데이션 (픽업 캐릭터가 있으면 그 캐릭터들을 나란히)
 * @param {object} banner
 * @param {Map} [charMap] 픽업 캐릭터 그림을 그릴 때 사용
 */
export function bannerVisual(banner, charMap) {
  const wrap = h('div', { class: ['banner-visual', banner.type === 'pickup' && 'is-pickup'] });
  const featured = () => {
    const chars = (banner.pickupIds || []).map((id) => charMap?.get(id)).filter(Boolean);
    if (chars.length) wrap.append(h('div', { class: 'banner-featured' }, chars.map((c) => h('div', { class: `banner-featured-char rar-${c.rarity}` }, charArt(c)))));
  };
  if (banner.bannerImage) {
    const img = h('img', { src: banner.bannerImage, alt: '', draggable: 'false' });
    img.addEventListener('error', () => (img.remove(), featured()), { once: true });
    wrap.append(img);
  } else featured();
  return wrap;
}
