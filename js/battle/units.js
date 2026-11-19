// 전투 유닛 만들기: 캐릭터/적 데이터 + 레벨 + 돌파 → 전투 중 상태를 가진 객체
import { statsOf, activePassives, kitOf } from '../systems/progression.js';
import { MODIFIERS } from './modifiers.js';

/**
 * @param {object} o
 * @param {object} o.entity 캐릭터 또는 적 데이터
 * @param {'ally'|'enemy'} o.side
 */
export function buildUnit({ entity, level = 1, breakthrough = 0, side, slot, uid, balance }) {
  const stats = statsOf(entity, level, breakthrough, balance);
  const kit = structuredClone(kitOf(entity, balance));
  const u = {
    uid,
    side,
    slot,
    refId: entity.id,
    name: entity.name,
    rarity: entity.rarity || null,
    image: entity.image || '',
    boss: !!entity.boss,
    level,
    breakthrough,
    base: stats,
    maxHp: stats.hp,
    hp: stats.hp,
    energy: 0,
    kit,
    ultCost: kit.ultimate?.cost ?? balance.energy.ultimateCost,
    energyGain: { basic: balance.energy.basic, skill: balance.energy.skill, hit: balance.energy.hit },
    effectPower: [],
    cd: kit.skill?.initialCooldown || 0,
    cdFresh: false,
    shield: null,
    statuses: [],
    dots: [],
    taunt: null,
    alive: true,
    passives: [],
    stats: { dealt: 0, healed: 0, shielded: 0, taken: 0 },
  };
  activePassives(entity, breakthrough).forEach((p, idx) => {
    for (const m of p.modifiers || []) MODIFIERS[m.type]?.(u, m);
    if (p.trigger) u.passives.push({ ...p, idx, fired: 0, below: false });
  });
  u.ultCost = Math.max(0, u.ultCost);
  return u;
}
