// 키트 예산 — 스킬/패시브의 점수 계산 + 템플릿 숫자 칸 맞추기 (순수, 숫자는 balance.kitBudget)
//
// 점수(효과) = points[type] × 크기 × 대상 계수 × (확률/100)
//   크기: damage (mult + perStack × 평균 자원) × hits × (1 + vsMarked% × 평균 표식) · heal/shield/follow_up/counter mult · dot mult × turns
//         buff/debuff pct × statWeight[stat] × turns · energy/sp/stack n · advance/delay pct · taunt/mark/transform turns
//         charge/summon = 안의 효과 점수 합 (소환은 × 행동 횟수)
//   대상 계수: 적/아군 1명 1 · 전체 targetFactor.all · 무작위 N회 count × randomPer
// 점수(패시브) = 효과 합 × triggerWeight[발동] (전투당 limit이면 더 작게) + 수정자 점수
// 상한 = caps[칸] × rarityFactor[희귀도]. 결과가 상한 ±tolerancePct% 안이면 통과
import { normalizeRarity } from '../../js/config.js';

const AVG_STACKS = 0.5; // 자원 평균 = 상한 × 이 값
const AVG_MARKS = 1.5;

/** 대상 지정 → 점수 계수 */
export function targetFactor(targeting, count, B) {
  const T = B.targetFactor;
  switch (targeting) {
    case 'enemy_all':
      return T.all;
    case 'ally_all':
      return T.allyAll;
    case 'enemy_random_n':
      return (count || 2) * T.randomPer;
    case 'self':
      return T.self;
    case 'ally_single':
    case 'ally_lowest_hp':
      return T.ally;
    default:
      return T.single;
  }
}

/**
 * 효과 하나의 점수
 * @param {object} eff 정리된 효과
 * @param {{targeting:string, count?:number, cap?:number}} o 이 효과가 따르는 대상 / 자원 상한
 */
export function effectPoints(eff, o, B) {
  const P = B.points;
  const W = B.statWeight;
  const tf = targetFactor(eff.target || o.targeting, eff.target ? eff.count : o.count, B);
  const chance = (eff.chance ?? 100) / 100;
  const stacks = (o.cap || 0) * AVG_STACKS;
  let mag;
  switch (eff.type) {
    case 'damage':
      mag = P.damage * (eff.mult + (eff.perStack || 0) * stacks) * (eff.hits || 1) * (1 + ((eff.vsMarked || 0) / 100) * AVG_MARKS) * (eff.stat === 'def' ? 1.1 : eff.stat === 'hp' ? 0.12 : 1);
      break;
    case 'heal':
      mag = P.heal * (eff.mult + (eff.perStack || 0) * stacks) * (eff.stat === 'hp' ? 10 : 1);
      break;
    case 'shield':
      mag = P.shield * (eff.mult + (eff.perStack || 0) * stacks) * (eff.stat === 'atk' ? 1.4 : eff.stat === 'hp' ? 0.12 : 1);
      break;
    case 'follow_up':
    case 'counter':
      mag = P[eff.type] * eff.mult * (eff.stat === 'def' ? 1.1 : 1);
      break;
    case 'dot':
      mag = P.dot * eff.mult * eff.turns;
      break;
    case 'buff':
    case 'debuff':
      mag = P[eff.type] * eff.pct * (W[eff.stat] ?? 1) * eff.turns;
      break;
    case 'energy_gain':
    case 'sp_gain':
    case 'stack_gain':
      mag = P[eff.type] * Math.abs(eff.n);
      break;
    case 'advance_action':
    case 'delay_action':
      mag = P[eff.type] * eff.pct;
      break;
    case 'taunt':
    case 'mark':
    case 'transform':
      mag = P[eff.type] * eff.turns;
      break;
    case 'mark_detonate':
      mag = P.mark_detonate * eff.mult * AVG_MARKS;
      break;
    case 'charge':
    case 'summon': {
      const inner = (eff.effects || []).reduce((s, e) => s + effectPoints(e, { targeting: eff.targeting, cap: o.cap }, B), 0);
      return inner * (eff.type === 'summon' ? eff.actions || 1 : 0.9) * chance; // 안쪽 효과가 이미 대상 계수를 가짐
    }
    default:
      mag = P[eff.type] ?? 0;
  }
  return mag * tf * chance;
}

/** 스킬 하나의 점수 */
export function skillPoints(skill, B, cap = 0) {
  if (!skill) return 0;
  return skill.effects.reduce((s, e) => s + effectPoints(e, { targeting: skill.targeting, count: skill.count, cap }, B), 0);
}

/** 수정자 하나의 점수 */
export function modifierPoints(m, B, cap = 0) {
  const M = B.modifierPoints;
  switch (m.type) {
    case 'stat_bonus':
      return M.stat_bonus * Math.abs(m.pct) * (B.statWeight[m.stat] ?? 1) * 2;
    case 'effect_power':
      return M.effect_power * m.pct * (m.action === 'any' ? 1.5 : 1);
    case 'ultimate_cost':
      return M.ultimate_cost * -m.delta;
    case 'sp_cost':
      return M.sp_cost * -m.delta;
    case 'energy_gain':
      return M.energy_gain * m.delta;
    case 'action_targeting':
      return M.action_targeting;
    case 'resource_cap':
      return M.resource_cap * m.delta;
    case 'mark_turns':
      return M.mark_turns * m.delta;
    case 'extra_effects': {
      const w = B.triggerWeight[{ basic: 'onBasic', skill: 'onSkill', ultimate: 'onUltimate' }[m.action]] ?? 0.5;
      const tgt = m.target || (m.action === 'ultimate' ? 'enemy_all' : 'enemy_single');
      return m.effects.reduce((s, e) => s + effectPoints(e, { targeting: tgt, cap }, B), 0) * w;
    }
    default:
      return 0;
  }
}

/** 패시브 하나의 점수 */
export function passivePoints(p, B, cap = 0) {
  if (!p) return 0;
  let w = B.triggerWeight[p.trigger || 'always'] ?? 0.5;
  if (p.limit) w *= Math.min(1, 0.35 * p.limit);
  if (p.perRound) w *= Math.min(1, 0.6 + 0.2 * p.perRound);
  const eff = p.trigger ? (p.effects || []).reduce((s, e) => s + effectPoints(e, { targeting: p.targeting || 'self', count: p.count, cap }, B), 0) * w : 0;
  const mods = (p.modifiers || []).reduce((s, m) => s + modifierPoints(m, B, cap), 0);
  return eff + mods;
}

/** 칸 상한: caps[칸] × rarityFactor[희귀도] */
export function capFor(slot, rarity, B) {
  return B.caps[slot] * (B.rarityFactor[normalizeRarity(rarity) || 3] ?? 1);
}

// ── 템플릿 숫자 칸 맞추기 ─────────────────────────────────
const isSlot = (v) => !!v && typeof v === 'object' && '$' in v && 'base' in v;

/** 템플릿 안의 칸들을 배율 k로 채운 사본 (min~max로 자르고 step으로 반올림) */
export function instantiate(tpl, k) {
  if (isSlot(tpl)) {
    const v = Math.min(tpl.max, Math.max(tpl.min, tpl.base * k));
    const step = tpl.step || 0.05;
    return Math.round(Math.round(v / step) * step * 1000) / 1000;
  }
  if (Array.isArray(tpl)) return tpl.map((x) => instantiate(x, k));
  if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([key, v]) => [key, instantiate(v, k)]));
  return tpl;
}

/** 템플릿에 숫자 칸이 있는지 */
export function hasSlots(tpl) {
  if (isSlot(tpl)) return true;
  if (Array.isArray(tpl)) return tpl.some(hasSlots);
  if (tpl && typeof tpl === 'object') return Object.values(tpl).some(hasSlots);
  return false;
}

/**
 * 칸을 같은 배율로 키우거나 줄여 점수를 target에 맞춤 (이분 탐색, 결정론)
 * @param {object} tpl 스킬/패시브 템플릿
 * @param {(inst:object)=>number} score 채운 사본 → 점수
 * @param {number} target 목표 점수
 * @returns {{value:object, points:number, k:number}}
 */
export function solve(tpl, score, target, { preferUnder = false } = {}) {
  if (!hasSlots(tpl)) {
    const value = instantiate(tpl, 1);
    return { value, points: score(value), k: 1 };
  }
  let lo = 0.02;
  let hi = 30;
  let best = null;
  let under = null; // 목표 이하 중 가장 가까운 것 (preferUnder: 나머지는 부르는 쪽이 채움)
  for (let i = 0; i < 40; i++) {
    const k = Math.sqrt(lo * hi);
    const value = instantiate(tpl, k);
    const points = score(value);
    if (!best || Math.abs(points - target) < Math.abs(best.points - target)) best = { value, points, k };
    if (points <= target && (!under || points > under.points)) under = { value, points, k };
    if (points < target) lo = k;
    else hi = k;
  }
  return preferUnder && under ? under : best;
}

/** 결과 보고: { points, cap, pct, ok } (pct = 점수 ÷ 상한 × 100) */
export function report(points, cap, B) {
  const pct = cap > 0 ? Math.round((points / cap) * 1000) / 10 : 0;
  return { points: Math.round(points * 10) / 10, cap: Math.round(cap * 10) / 10, pct, ok: Math.abs(pct - 100) <= B.tolerancePct };
}
