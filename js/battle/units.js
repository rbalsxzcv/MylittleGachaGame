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
  const ally = side === 'ally';
  const kit = ally ? structuredClone(kitOf(entity, balance)) : null;
  const e = balance.combat.energy;
  const u = {
    uid,
    side,
    slot,
    refId: entity.id,
    name: entity.name,
    rarity: entity.rarity || null,
    role: entity.role || null,
    image: entity.image || '',
    cutout: entity.cutout || '',
    themeColor: entity.themeColor || null,
    nameEn: entity.nameEn || '',
    title: entity.title || '',
    boss: !!entity.boss,
    level,
    breakthrough,
    base: stats,
    maxHp: stats.hp,
    hp: stats.hp,
    energy: 0,
    // ── 아군: 기본 공격 / 스킬(SP) / 궁극기(기력) ──
    kit,
    ultCost: kit?.ultimate?.cost ?? e.ultimateCost,
    energyGain: { basic: e.basic, skill: e.skill, hit: e.hit },
    spCostDelta: 0,
    effectPower: [],
    // ── 적: 행동 정의 + 패턴 + 페이즈 + 광폭화 + 예고 ──
    actions: ally ? null : structuredClone(entity.actions || {}),
    pattern: ally ? null : structuredClone(entity.pattern || []),
    phases: ally ? [] : structuredClone(entity.phases || []),
    enrage: ally ? null : structuredClone(entity.enrage || null),
    patternIdx: 0,
    phaseIdx: -1,
    enraged: false,
    intent: null,
    // ── 타임라인 ──
    av: 0, // 남은 행동 수치 (0이 되면 행동)
    spdNow: stats.spd, // 지금 속도 (강화/약화 반영) — 바뀌면 남은 av를 비율대로 조정
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
