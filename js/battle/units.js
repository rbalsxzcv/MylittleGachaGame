// 전투 유닛 만들기: 캐릭터/적 데이터 + 레벨 + 돌파 → 전투 중 상태를 가진 객체
import { statsOf, activePassives, kitOf } from '../systems/progression.js';
import { MODIFIERS } from './modifiers.js';

/**
 * @param {object} o
 * @param {object} o.entity 캐릭터 또는 적 데이터
 * @param {'ally'|'enemy'} o.side
 */
export function buildUnit({ entity, level = 1, breakthrough = 0, side, slot, uid, balance, extras = {}, difficulty = 1 }) {
  const stats = statsOf(entity, level, breakthrough, balance, extras);
  const ally = side === 'ally';
  // 적: 스테이지 난이도 배율 (공격/HP)
  if (!ally && difficulty !== 1) {
    stats.atk = Math.max(0, Math.floor(stats.atk * difficulty));
    stats.hp = Math.max(1, Math.floor(stats.hp * difficulty));
  }
  const full = ally ? structuredClone(kitOf(entity, balance)) : null;
  const kitAlt = full?.transformed ? Object.fromEntries(Object.entries(full.transformed).filter(([, v]) => v)) : null;
  const kit = full ? { basic: full.basic, skill: full.skill, ultimate: full.ultimate } : null;
  const res = entity.resource ? { name: entity.resource.name || '자원', cap: Math.max(1, entity.resource.cap || 1), value: Math.min(entity.resource.cap || 1, entity.resource.start || 0), full: false } : null;
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
    marks: [], // 이 유닛에 붙은 표식 [{src, n, turns, fresh}]
    res, // 자원(스택) {name, value, cap, full} | null
    transform: null, // 변신 {turns, fresh} | null
    kitBase: null, // 변신이 끝나면 돌아갈 키트
    kitAlt: kitAlt && Object.keys(kitAlt).length ? kitAlt : null,
    alive: true,
    passives: [],
    stats: { dealt: 0, healed: 0, shielded: 0, taken: 0 },
  };
  activePassives(entity, breakthrough, extras.passives || []).forEach((p, idx) => {
    for (const m of p.modifiers || []) MODIFIERS[m.type]?.(u, m);
    if (p.trigger) u.passives.push({ ...p, idx, fired: 0, below: false, roundOf: 0, roundFired: 0 });
  });
  u.ultCost = Math.max(0, u.ultCost);
  if (u.kit) u.kitBase = u.kit;
  return u;
}
