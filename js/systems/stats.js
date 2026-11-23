// 능력치 모델 — 캐릭터/적의 최종 능력치 (순수 함수, 숫자는 모두 balance에서)
//
// 최종 = (기본(레벨) + 추억 기본 공격력) × (1 + Σ%) + Σ고정값
//   기본: 캐릭터 = round(rarityMul[희귀도] × roleTemplate[역할][능력치] × (1 + statTweak%)), atk/def/hp만 × (1 + growth × (lv − 1))
//         데이터에 절대값 stats가 있으면 그 값 (적, 예전 데이터, 테스트) — 없는 칸은 희귀도 기본값(byRarity)
//   Σ%:  돌파 1·3·4·5 능력치 노드(역할별 설정) + 상시 패시브 stat_bonus + 추억 부옵션
//   Σ고정값: 장비
//   비율 능력치(치명타/기력 회복/효과 적중·저항/치유·보호막 보너스)는 % 포인트로 더함 (+6 → +0.06), 레벨과 무관
import { ALL_STATS, LEVEL_STATS, RATIO_STATS, ROLES, normalizeRarity, rarityBaseStats } from '../config.js';
import { cleanStats } from '../battle/schema.js';

const DEFAULT_EXTRA = { energyRegen: 1, effectHit: 0, effectRes: 0, healBonus: 0, shieldBonus: 0 };
const round3 = (n) => Math.round(n * 1000) / 1000;

/** 적인지 (적 데이터는 passives 배열이 있음) */
export const isEnemyEntity = (e) => Array.isArray(e?.passives);

/** 돌파 1·3·4·5 능력치 노드 → 지금 돌파 단계까지 켜진 것 [{stat, pct}] (낮은 희귀도 보정 반영) */
export function breakthroughStatNodes(entity, breakthrough, balance) {
  if (!entity || isEnemyEntity(entity) || !ROLES.includes(entity.role)) return [];
  const nodes = balance.breakthrough?.statNodes?.[entity.role];
  if (!nodes) return [];
  const boost = balance.breakthrough.lowRarityBoost?.[normalizeRarity(entity.rarity) || 3] ?? 1;
  const steps = [1, 3, 4, 5];
  return nodes.map((n, i) => ({ ...n, step: steps[i], pct: round3(n.pct * boost) })).filter((n) => n.step <= breakthrough);
}

/** 레벨 1 기본 능력치 (모든 능력치 11개) */
export function baseStatsOf(entity, balance) {
  const abs = cleanStats(entity?.stats) || {};
  const tpl = !isEnemyEntity(entity) && ROLES.includes(entity?.role) && !entity?.stats ? balance.stats.roleTemplate?.[entity.role] : null;
  const out = {};
  if (tpl) {
    const mul = balance.stats.rarityMul?.[normalizeRarity(entity.rarity) || 3] ?? 1;
    for (const k of ALL_STATS) {
      const tweak = 1 + (Number(entity.statTweak?.[k]) || 0) / 100;
      // 희귀도 배율은 atk/def/hp에만 (속도 · 비율 능력치는 역할 값 그대로)
      if (RATIO_STATS.includes(k)) out[k] = round3((tpl[k] ?? DEFAULT_EXTRA[k] ?? 0) * tweak);
      else out[k] = Math.round((tpl[k] ?? 0) * (LEVEL_STATS.includes(k) ? mul : 1) * tweak);
    }
    return out;
  }
  const r = rarityBaseStats(entity?.rarity, balance);
  for (const k of ALL_STATS) {
    if (abs[k] != null) out[k] = abs[k];
    else if (k in r) out[k] = r[k];
    else if (k === 'critRate') out[k] = balance.stats.critRate;
    else if (k === 'critDmg') out[k] = balance.stats.critDmg;
    else out[k] = DEFAULT_EXTRA[k];
  }
  return out;
}

/**
 * 최종 능력치
 * @param {object} entity 캐릭터 또는 적
 * @param {{level?:number, breakthrough?:number, passives?:Array, memory?:{entity:object, level:number}|null, gear?:object|null}} build
 *   passives: 지금 켜진 상시 능력 (progression.activePassives) / memory: 추억 데이터 + 레벨 / gear: {칸: {tier, enh}} → 장비 고정값
 * @param {object} balance
 */
export function computeStats(entity, build, balance) {
  const { level = 1, breakthrough = 0, passives = [], memory = null, gear = null } = build || {};
  const b = baseStatsOf(entity, balance);
  const lvMul = 1 + balance.stats.growth * (Math.max(1, level) - 1);
  const pct = Object.fromEntries(ALL_STATS.map((k) => [k, 0]));
  const flat = Object.fromEntries(ALL_STATS.map((k) => [k, 0]));
  for (const n of breakthroughStatNodes(entity, breakthrough, balance)) pct[n.stat] += n.pct;
  for (const p of passives) for (const m of p.modifiers || []) if (m.type === 'stat_bonus' && m.stat in pct) pct[m.stat] += m.pct;
  // 추억: 기본 공격력은 레벨 기본값에 더하고, 부옵션은 %
  let memAtk = 0;
  if (memory?.entity) {
    const ms = memoryStats(memory.entity, memory.level, balance);
    memAtk = ms.atk;
    if (ms.secondary) pct[ms.secondary.stat] += ms.secondary.pct;
  }
  if (gear) for (const [k, v] of Object.entries(gearStats(gear, balance))) flat[k] += v;

  const out = {};
  for (const k of ALL_STATS) {
    if (RATIO_STATS.includes(k)) out[k] = Math.max(0, round3(b[k] + pct[k] / 100 + flat[k]));
    else if (LEVEL_STATS.includes(k)) {
      const base = Math.floor(b[k] * lvMul) + (k === 'atk' ? memAtk : 0);
      out[k] = Math.max(k === 'hp' ? 1 : 0, Math.floor(base * (1 + pct[k] / 100)) + Math.floor(flat[k]));
    } else out[k] = Math.max(1, Math.floor(b[k] * (1 + pct[k] / 100)) + Math.floor(flat[k])); // spd
  }
  return out;
}

// ── 추억 ──────────────────────────────────────────────────
/** 추억 하나의 능력치: 기본 공격력(레벨) + 부옵션 {stat, pct}(레벨) */
export function memoryStats(mem, level, balance) {
  const M = balance.memory;
  const r = normalizeRarity(mem?.rarity) || 3;
  const lv = Math.max(1, Math.min(M.maxLevel, level || 1));
  const atkBase = mem?.baseAtk ?? M.atkBase[r] ?? 0;
  const atk = Math.floor(atkBase * (1 + M.growth * (lv - 1)));
  const sec = mem?.secondary && ALL_STATS.includes(mem.secondary.stat) ? mem.secondary : null;
  const secPct = sec ? round3((sec.pct ?? M.secondary[r] ?? 0) * (1 + M.secGrowth * (lv - 1))) : 0;
  return { atk, secondary: sec ? { stat: sec.stat, pct: secPct } : null };
}

// ── 장비 ──────────────────────────────────────────────────
/** 장비 한 조각의 능력치 {능력치: 고정값} — 같은 티어 + 칸 + 강화면 늘 같음 */
export function gearPieceStats(slot, tier, enh, balance) {
  const G = balance.gear;
  const base = G.slotBase[slot];
  if (!base || tier < 1) return {};
  const t = Math.min(G.tiers, tier);
  const e = Math.max(0, Math.min(G.maxEnh, enh || 0));
  const mul = G.tierMul ** (t - 1) * (1 + G.enhStep * e);
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = RATIO_STATS.includes(k) ? round3(v * mul) : Math.round(v * mul);
  return out;
}

/** 장착한 장비 전부 {칸: {tier, enh} | null} → 능력치 합 */
export function gearStats(gear, balance) {
  const out = {};
  for (const [slot, piece] of Object.entries(gear || {})) {
    if (!piece) continue;
    for (const [k, v] of Object.entries(gearPieceStats(slot, piece.tier, piece.enh, balance))) out[k] = round3((out[k] || 0) + v);
  }
  return out;
}
