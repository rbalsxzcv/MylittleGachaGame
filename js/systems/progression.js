// 육성: 레벨(티켓 + 골드), 정수, 돌파, 능력치, 전투력
// 공식의 숫자는 모두 balance(= config.js loadConfig 결과)에서 옵니다.
// 화면과 분리된 순수 함수 — 전투 엔진과 개발 도구 시뮬레이터도 같이 씁니다.

import { baseStatsOf, computeStats, breakthroughStatNodes } from './stats.js';
import { loadConfig, normalizeRarity, overflowTickets } from '../config.js';

/** 예전 이름 호환 (개발 도구가 부름): balance.json → 설정 객체 */
export const validateBalance = loadConfig;

// ── 능력치 ───────────────────────────────────────────────
/** 레벨 1 기본 능력치 (역할 템플릿 × 희귀도 배율, 또는 데이터의 절대값 stats) — stats.js baseStatsOf */
export const baseStats = baseStatsOf;

/**
 * 지금 켜져 있는 상시 능력 (발동 조건이 있는 것 + modifiers만 있는 것)
 * - 적: passives 전부
 * - 캐릭터: talents(늘) + bt2(돌파 2부터) + bt6(돌파 6) + 예전 breakthroughs[0..돌파−1]
 * - extra: 추억 패시브 등 바깥에서 붙는 능력 (그대로 뒤에 붙음)
 */
export function activePassives(entity, breakthrough = 0, extra = []) {
  if (Array.isArray(entity?.passives)) return [...entity.passives, ...extra];
  const out = [...(entity?.talents || [])];
  if (entity?.bt2 && breakthrough >= 2) out.push(entity.bt2);
  if (entity?.bt6 && breakthrough >= 6) out.push(entity.bt6);
  out.push(...(entity?.breakthroughs || []).slice(0, Math.max(0, breakthrough)));
  return [...out, ...extra];
}

/**
 * 돌파 1–6 칸 (화면용): 1·3·4·5 = 역할 능력치 노드 (balance 공식), 2 = bt2, 6 = bt6
 * 예전 데이터(breakthroughs만 있음)는 그 목록을 그대로 1~N칸으로
 * @returns {Array<{step:number, kind:'stat'|'passive'|'empty', stat?:string, pct?:number, passive?:object}>}
 */
export function breakthroughNodes(entity, balance) {
  const max = balance.essence.maxBreakthrough;
  const legacy = !entity?.bt2 && !entity?.bt6 && (entity?.breakthroughs || []).length > 0;
  const stat = breakthroughStatNodes(entity, max, balance);
  return Array.from({ length: max }, (_, i) => {
    const step = i + 1;
    if (legacy) return entity.breakthroughs[i] ? { step, kind: 'passive', passive: entity.breakthroughs[i] } : { step, kind: 'empty' };
    if (step === 2) return entity?.bt2 ? { step, kind: 'passive', passive: entity.bt2 } : { step, kind: 'empty' };
    if (step === 6) return entity?.bt6 ? { step, kind: 'passive', passive: entity.bt6 } : { step, kind: 'empty' };
    const n = stat.find((x) => x.step === step);
    return n ? { step, kind: 'stat', stat: n.stat, pct: n.pct } : { step, kind: 'empty' };
  });
}

/**
 * 캐릭터/적의 스킬 세트. 빈 칸은 기본 스킬(balance.defaultKit)
 * 적(passives 배열이 있음)은 스킬/궁극기가 없으면 없는 대로 둠
 * transformed: 변신 중 바뀌는 기본/스킬/궁극기 (없으면 null)
 */
export function kitOf(entity, balance) {
  const k = entity?.kit || {};
  const d = balance.defaultKit;
  const enemy = Array.isArray(entity?.passives);
  return {
    basic: k.basic || d.basic,
    skill: k.skill || (enemy ? null : d.skill),
    ultimate: k.ultimate || (enemy ? null : d.ultimate),
    transformed: k.transformed || null,
  };
}

/**
 * 레벨 + 돌파 (+ 추억/장비) 반영 능력치 — 공식은 stats.js computeStats
 * @param {object} [extras] { memory: {entity, level, refine}, gear: {칸: {tier, enh}}, passives: 바깥 패시브(추억) }
 */
export function statsOf(entity, level, breakthrough, balance, extras = {}) {
  const passives = activePassives(entity, breakthrough, extras.passives || []);
  return computeStats(entity, { level, breakthrough, passives, memory: extras.memory || null, gear: extras.gear || null }, balance);
}

/** 전투력 = 능력치 가중합 (기력 회복은 1을 넘는 만큼만) */
export function powerOf(stats, balance) {
  const w = balance.power;
  return Math.floor(
    w.atk * stats.atk +
      w.def * stats.def +
      w.hp * stats.hp +
      w.spd * (stats.spd || 0) +
      w.critRate * stats.critRate +
      w.critDmg * stats.critDmg +
      (w.energyRegen || 0) * Math.max(0, (stats.energyRegen ?? 1) - 1) +
      (w.effectHit || 0) * (stats.effectHit || 0) +
      (w.effectRes || 0) * (stats.effectRes || 0) +
      (w.healBonus || 0) * (stats.healBonus || 0) +
      (w.shieldBonus || 0) * (stats.shieldBonus || 0),
  );
}

/** 보유 캐릭터 하나의 전투력 (extras: 추억/장비 — teams.extrasOf) */
export function charPower(char, entry, balance, extras = {}) {
  return powerOf(statsOf(char, entry?.level ?? 1, entry?.breakthrough ?? 0, balance, extras), balance);
}

// ── 레벨업 비용 ──────────────────────────────────────────
/** lv → lv+1 티켓 비용: ceil(costBase × lv^costExp) */
export function levelCost(lv, balance) {
  return Math.ceil(balance.level.costBase * Math.max(1, lv) ** balance.level.costExp);
}

/** lv에서 n번 레벨업하는 총비용 */
export function costFor(lv, n, balance) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += levelCost(lv + i, balance);
  return sum;
}

/** lv에서 n번 레벨업하는 총 골드 = 티켓 비용 × goldPerTicket */
export function goldCostFor(lv, n, balance) {
  return Math.ceil(costFor(lv, n, balance) * balance.level.goldPerTicket);
}

/** 가진 티켓(과 골드)으로 최대 몇 레벨까지 올릴 수 있는지 → {n, cost, gold} */
export function maxAffordable(lv, tickets, balance, cap = 100000, gold = Infinity) {
  const k = balance.level.goldPerTicket;
  let n = 0;
  let cost = 0;
  while (n < cap) {
    const c = levelCost(lv + n, balance);
    if (cost + c > tickets || Math.ceil((cost + c) * k) > gold) break;
    cost += c;
    n += 1;
  }
  return { n, cost, gold: Math.ceil(cost * k) };
}

// ── 세이브 조작 ──────────────────────────────────────────
/** 레벨업. 티켓이나 골드가 모자라면 false (아무것도 안 바뀜) */
export function levelUp(save, id, n, balance) {
  const entry = save.owned[id];
  if (!entry || n < 1) return false;
  const cost = costFor(entry.level, n, balance);
  const gold = goldCostFor(entry.level, n, balance);
  if (save.tickets < cost || (save.gold || 0) < gold) return false;
  save.tickets -= cost;
  save.gold -= gold;
  entry.level += n;
  return true;
}

export function canBreakthrough(entry, balance) {
  return !!entry && entry.essence >= 1 && entry.breakthrough < balance.essence.maxBreakthrough;
}

/** 돌파 (정수 1개 사용) */
export function doBreakthrough(save, id, balance) {
  const entry = save.owned[id];
  if (!canBreakthrough(entry, balance)) return false;
  entry.essence -= 1;
  entry.breakthrough += 1;
  return true;
}

/** 정수 1개 → 티켓으로 바꿀 때의 양 (5★ 200 / 4★ 80 / ≤3★ 30) */
export function essenceTicketRate(rarity, balance) {
  return overflowTickets(rarity, balance);
}

/** 별 개수 (예전 이름 호환) */
export const starsOf = (rarity) => normalizeRarity(rarity) || 1;

/**
 * 중복 획득: 정수 +1. 보유할 수 있는 정수 = 최대 돌파 − 현재 돌파, 넘치는 몫은 바로 티켓
 * @returns {{essence:number, tickets:number}}
 */
export function grantDuplicate(save, char, balance) {
  const entry = save.owned[char.id];
  if (entry.breakthrough + entry.essence < balance.essence.maxBreakthrough) {
    entry.essence += 1;
    return { essence: 1, tickets: 0 };
  }
  const t = essenceTicketRate(char.rarity, balance);
  save.tickets += t;
  return { essence: 0, tickets: t };
}
