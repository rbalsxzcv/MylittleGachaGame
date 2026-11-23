// 추억 카드: 일러스트(세로) + 희귀도 테두리(그림에 굽지 않고 CSS로) + 이름 · 재련 · 레벨
import { h } from './dom.js';
import { rarityStars } from '../config.js';

const KIND_LABEL = { signature: '전용', default: '기본', generic: '' };

/**
 * @param {object} mem 추억 데이터
 * @param {{inst?:{lv:number, r:number}, badge?:string, badgeClass?:string, owner?:object, small?:boolean, locked?:boolean}} [o]
 */
export function memoryCard(mem, { inst = null, badge = '', badgeClass = '', owner = null, small = false, locked = false } = {}) {
  const src = (small && mem.thumb) || mem.image || mem.thumb || '';
  const art = h('div', { class: 'mem-art' });
  const fallback = () => art.replaceChildren(h('div', { class: 'mem-fallback' }, h('span', {}, '✦'), h('b', {}, mem.name)));
  if (src) {
    const img = h('img', { src, alt: mem.name, draggable: 'false', decoding: 'async' });
    img.addEventListener('error', fallback, { once: true });
    art.append(img);
  } else fallback();
  return h(
    'div',
    { class: ['mem-card', `rar-${mem.rarity}`, small && 'is-small', locked && 'is-locked'] },
    art,
    badge && h('span', { class: ['ccard-badge', badgeClass] }, badge),
    KIND_LABEL[mem.kind] && h('span', { class: 'mem-kind' }, KIND_LABEL[mem.kind]),
    h(
      'div',
      { class: 'mem-plate' },
      h('div', { class: 'mem-stars' }, rarityStars(mem.rarity)),
      h('b', { class: 'mem-name' }, mem.name),
      inst && h('div', { class: 'mem-meta' }, `Lv.${inst.lv} · R${inst.r}`),
      owner && h('div', { class: 'mem-owner' }, `${owner.name} 전용`),
    ),
  );
}
