// 캐릭터 그림/카드 공용 렌더러
// 이미지가 없거나 불러오기 실패 → 희귀도 색 카드 + 이름으로 대체

import { h } from './dom.js';
import { MAX_STARS } from '../systems/collection.js';

// 한 번 실패한 이미지 주소는 다시 요청하지 않음
const failedImages = new Set();

/** 대체 그림 (희귀도 색 그라데이션 + 이름) */
function fallbackArt(char, locked) {
  return h(
    'div',
    { class: ['art-fallback', `rar-${char.rarity}`, locked && 'is-locked'] },
    h('div', { class: 'af-rarity' }, char.rarity),
    h('div', { class: 'af-name' }, locked ? '?' : char.name),
  );
}

/**
 * 캐릭터 그림
 * @param {object} char
 * @param {{locked?: boolean}} [opts] locked: 미보유 → 실루엣
 */
export function charArt(char, { locked = false } = {}) {
  const wrap = h('div', { class: ['art', locked && 'is-locked'] });
  const useFallback = () => wrap.replaceChildren(fallbackArt(char, locked));

  if (!char.image || failedImages.has(char.image)) {
    useFallback();
    return wrap;
  }
  const img = h('img', { class: 'art-img', src: char.image, alt: locked ? '미보유 캐릭터' : char.name, draggable: 'false', decoding: 'async' });
  img.addEventListener(
    'error',
    () => {
      failedImages.add(char.image);
      useFallback();
    },
    { once: true },
  );
  wrap.append(img);
  return wrap;
}

export function rarityBadge(rarity) {
  return h('span', { class: `rarity-badge rar-${rarity}` }, rarity);
}

export function starRow(stars) {
  return h(
    'span',
    { class: 'stars', 'aria-label': `별 ${stars}개` },
    Array.from({ length: MAX_STARS }, (_, i) => h('span', { class: i < stars ? 'star on' : 'star' }, '★')),
  );
}

/**
 * 도감/결과용 캐릭터 카드
 * @param {object} char
 * @param {{owned?:boolean, stars?:number, badge?:string|null, badgeClass?:string, onClick?:Function}} [opts]
 */
export function charCard(char, { owned = true, stars = 0, badge = null, badgeClass = '', onClick } = {}) {
  return h(
    onClick ? 'button' : 'div',
    {
      class: ['ccard', `rar-${char.rarity}`, !owned && 'is-locked'],
      onclick: onClick,
      type: onClick ? 'button' : null,
      'aria-label': owned ? `${char.rarity} ${char.name}` : `${char.rarity} 미보유 캐릭터`,
    },
    h('div', { class: 'ccard-art' }, charArt(char, { locked: !owned })),
    h(
      'div',
      { class: 'ccard-plate' },
      h('div', { class: 'ccard-name' }, owned ? char.name : '???'),
      owned ? starRow(stars) : h('span', { class: 'stars' }, ' '),
    ),
    rarityBadge(char.rarity),
    badge && h('span', { class: ['ccard-badge', badgeClass] }, badge),
  );
}
