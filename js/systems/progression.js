// 육성: 레벨(티켓 + 골드), 정수, 돌파, 능력치, 전투력
// 공식의 숫자는 모두 balance(= config.js loadConfig 결과)에서 옵니다.
// 화면과 분리된 순수 함수 — 전투 엔진과 개발 도구 시뮬레이터도 같이 씁니다.

import { cleanStats } from '../battle/schema.js';
import { loadConfig, normalizeRarity, overflowTickets, rarityBaseStats } from '../config.js';

/** 예전 이름 호환 (개발 도구가 부름): balance.json → 설정 객체 */
export const validateBalance = loadConfig;

// ── 능력치 ───────────────────────────────────────────────
/** 레벨 1 기본 능력치 (캐릭터/적의 stats → 없으면 희귀도 기본값, 적은 3★ 기본값) */
export function baseStats(entity, balance) {
  const r = rarityBaseStats(entity?.rarity, balance);
  const s = cleanStats(entity?.stats) || {};
  return {
    atk: s.atk ?? r.atk,
    def: s.def ?? r.def,
    hp: s.hp ?? r.hp,
    spd: s.spd ?? r.spd,
    critRate: s.critRate ?? balance.stats.critRate,
    critDmg: s.critDmg ?? balance.stats.critDmg,
  };
}

/** 지금 켜져 있는 패시브: 캐릭터는 돌파 단계만큼, 적은 전부 */
export function activePassives(entity, breakthrough = 0) {
  if (Array.isArray(entity?.passives)) return entity.passives;
  return (entity?.breakthroughs || []).slice(0, Math.max(0, breakthrough));
}

/**
 * 캐릭터/적의 스킬 세트. 빈 칸은 기본 스킬(balance.defaultKit)
 * 적(passives 배열이 있음)은 스킬/궁극기가 없으면 없는 대로 둠
 */
export function kitOf(entity, balance) {
  const k = entity?.kit || {};
  const d = balance.defaultKit;
  const enemy = Array.isArray(entity?.passives);
  return {
    basic: k.basic || d.basic,
    skill: k.skill || (enemy ? null : d.skill),
    ultimate: k.ultimate || (enemy ? null : d.ultimate),
  };
}

/**
 * 레벨 + 돌파 반영 능력치
 * stat = floor(base × (1 + growth × (lv − 1))), 그 뒤 상시 능력치 보너스(stat_bonus)
 * 속도/치명타 확률/치명타 피해는 레벨과 무관 (능력으로만 바뀜)
 */
export function statsOf(entity, level, breakthrough, balance) {
  const b = baseStats(entity, balance);
  const mul = 1 + balance.stats.growth * (Math.max(1, level) - 1);
  const bonus = { atk: 0, def: 0, hp: 0, spd: 0, critRate: 0, critDmg: 0 };
  for (const p of activePassives(entity, breakthrough)) {
    for (const m of p.modifiers || []) if (m.type === 'stat_bonus' && m.stat in bonus) bonus[m.stat] += m.pct;
  }
  const scale = (k) => Math.max(0, Math.floor(Math.floor(b[k] * mul) * (1 + bonus[k] / 100)));
  return {
    atk: scale('atk'),
    def: scale('def'),
    hp: Math.max(1, scale('hp')),
    spd: Math.max(1, Math.floor(b.spd * (1 + bonus.spd / 100))),
    critRate: Math.max(0, Math.round((b.critRate + bonus.critRate / 100) * 1000) / 1000),
    critDmg: Math.max(0, Math.round((b.critDmg + bonus.critDmg / 100) * 1000) / 1000),
  };
}

/** 전투력 = 능력치 가중합 */
export function powerOf(stats, balance) {
  const w = balance.power;
  return Math.floor(w.atk * stats.atk + w.def * stats.def + w.hp * stats.hp + w.spd * (stats.spd || 0) + w.critRate * stats.critRate + w.critDmg * stats.critDmg);
}

/** 보유 캐릭터 하나의 전투력 */
export function charPower(char, entry, balance) {
  return powerOf(statsOf(char, entry?.level ?? 1, entry?.breakthrough ?? 0, balance), balance);
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
