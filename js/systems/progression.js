// 육성: 레벨(티켓 + 골드), 정수, 돌파, 능력치, 전투력
// 공식의 숫자는 모두 data/balance.json에서 옵니다 (없으면 DEFAULT_BALANCE).
// 화면과 분리된 순수 함수 — 전투 엔진과 개발 도구 시뮬레이터도 같이 씁니다.

import { cleanKit, cleanStats } from '../battle/schema.js';

export const RARITY_STARS = { SSR: 5, SR: 4, R: 3 };

export const DEFAULT_BALANCE = {
  growth: 0.08,
  levelCost: { base: 10, exp: 1.25 },
  levelGoldPerTicket: 10, // 레벨업 골드 = 티켓 비용 × 이 값
  crit: { rate: 0.05, dmg: 0.5 },
  rarityStats: {
    R: { atk: 100, def: 40, hp: 900 },
    SR: { atk: 115, def: 46, hp: 1035 },
    SSR: { atk: 130, def: 52, hp: 1170 },
  },
  energy: { max: 100, basic: 20, skill: 30, hit: 10, ultimateCost: 100 },
  essenceTickets: { SSR: 200, SR: 80, R: 30 },
  maxBreakthrough: 5,
  dailyTickets: 30,
  dailyGold: 3000,
  power: { atk: 2, def: 1.5, hp: 0.2, critRate: 300, critDmg: 100 },
  powerWarnPct: 25,
  maxRounds: 200,
  defaultKit: {
    basic: { name: '기본 공격', description: '적 하나를 공격해요.', targeting: 'enemy_single', effects: [{ type: 'damage', mult: 1, stat: 'atk', hits: 1 }] },
    skill: { name: '강타', description: '적 하나에게 큰 피해를 줘요.', targeting: 'enemy_single', cooldown: 2, effects: [{ type: 'damage', mult: 1.8, stat: 'atk', hits: 1 }] },
    ultimate: { name: '필살기', description: '적 전체를 공격해요.', targeting: 'enemy_all', effects: [{ type: 'damage', mult: 1.4, stat: 'atk', hits: 1 }] },
  },
};

// ── balance.json 정리 ────────────────────────────────────
function num(v, def, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function intRec(raw, def, min, max) {
  const out = {};
  for (const [k, v] of Object.entries(def)) out[k] = Math.round(num(raw?.[k], v, min, max));
  return out;
}

/** balance.json → 빠진 값은 기본값, 범위 밖은 잘라냄 */
export function validateBalance(json, vocab, warn = console.warn) {
  const d = DEFAULT_BALANCE;
  const j = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  const rarityStats = {};
  for (const r of Object.keys(d.rarityStats)) rarityStats[r] = intRec(j.rarityStats?.[r], d.rarityStats[r], 1, 1e6);
  const power = {};
  for (const [k, v] of Object.entries(d.power)) power[k] = num(j.power?.[k], v, 0, 1e4);
  const out = {
    growth: num(j.growth, d.growth, 0, 10),
    levelCost: { base: num(j.levelCost?.base, d.levelCost.base, 0, 1e6), exp: num(j.levelCost?.exp, d.levelCost.exp, 0, 5) },
    levelGoldPerTicket: num(j.levelGoldPerTicket, d.levelGoldPerTicket, 0, 1e4),
    crit: { rate: num(j.crit?.rate, d.crit.rate, 0, 1), dmg: num(j.crit?.dmg, d.crit.dmg, 0, 10) },
    rarityStats,
    energy: intRec(j.energy, d.energy, 0, 1000),
    essenceTickets: intRec(j.essenceTickets, d.essenceTickets, 0, 1e6),
    maxBreakthrough: Math.round(num(j.maxBreakthrough, d.maxBreakthrough, 0, 5)),
    dailyTickets: Math.round(num(j.dailyTickets, d.dailyTickets, 0, 1e6)),
    dailyGold: Math.round(num(j.dailyGold, d.dailyGold, 0, 1e8)),
    power,
    powerWarnPct: num(j.powerWarnPct, d.powerWarnPct, 0, 1000),
    maxRounds: Math.round(num(j.maxRounds, d.maxRounds, 10, 1000)),
  };
  out.energy.max = Math.max(1, out.energy.max);
  out.defaultKit = vocab ? cleanKit(j.defaultKit || {}, vocab, warn, 'balance.defaultKit', d.defaultKit) : structuredClone(d.defaultKit);
  return out;
}

// ── 능력치 ───────────────────────────────────────────────
/** 레벨 1 기본 능력치 (캐릭터/적의 stats → 없으면 희귀도 기본값) */
export function baseStats(entity, balance) {
  const r = balance.rarityStats[entity?.rarity] || balance.rarityStats.R;
  const s = cleanStats(entity?.stats) || {};
  return {
    atk: s.atk ?? r.atk,
    def: s.def ?? r.def,
    hp: s.hp ?? r.hp,
    critRate: s.critRate ?? balance.crit.rate,
    critDmg: s.critDmg ?? balance.crit.dmg,
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
 * 치명타 확률/피해는 레벨과 무관 (능력으로만 바뀜)
 */
export function statsOf(entity, level, breakthrough, balance) {
  const b = baseStats(entity, balance);
  const mul = 1 + balance.growth * (Math.max(1, level) - 1);
  const bonus = { atk: 0, def: 0, hp: 0, critRate: 0, critDmg: 0 };
  for (const p of activePassives(entity, breakthrough)) {
    for (const m of p.modifiers || []) if (m.type === 'stat_bonus' && m.stat in bonus) bonus[m.stat] += m.pct;
  }
  const scale = (k) => Math.max(0, Math.floor(Math.floor(b[k] * mul) * (1 + bonus[k] / 100)));
  return {
    atk: scale('atk'),
    def: scale('def'),
    hp: Math.max(1, scale('hp')),
    critRate: Math.max(0, Math.round((b.critRate + bonus.critRate / 100) * 1000) / 1000),
    critDmg: Math.max(0, Math.round((b.critDmg + bonus.critDmg / 100) * 1000) / 1000),
  };
}

/** 전투력 = 능력치 가중합 */
export function powerOf(stats, balance) {
  const w = balance.power;
  return Math.floor(w.atk * stats.atk + w.def * stats.def + w.hp * stats.hp + w.critRate * stats.critRate + w.critDmg * stats.critDmg);
}

/** 보유 캐릭터 하나의 전투력 */
export function charPower(char, entry, balance) {
  return powerOf(statsOf(char, entry?.level ?? 1, entry?.breakthrough ?? 0, balance), balance);
}

// ── 레벨업 비용 ──────────────────────────────────────────
/** lv → lv+1 비용: ceil(base × lv^exp) */
export function levelCost(lv, balance) {
  return Math.ceil(balance.levelCost.base * Math.max(1, lv) ** balance.levelCost.exp);
}

/** lv에서 n번 레벨업하는 총비용 */
export function costFor(lv, n, balance) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += levelCost(lv + i, balance);
  return sum;
}

/** lv에서 n번 레벨업하는 총 골드 = 티켓 비용 × levelGoldPerTicket */
export function goldCostFor(lv, n, balance) {
  return Math.ceil(costFor(lv, n, balance) * balance.levelGoldPerTicket);
}

/** 가진 티켓(과 골드)으로 최대 몇 레벨까지 올릴 수 있는지 → {n, cost, gold} */
export function maxAffordable(lv, tickets, balance, cap = 100000, gold = Infinity) {
  const k = balance.levelGoldPerTicket;
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
  return !!entry && entry.essence >= 1 && entry.breakthrough < balance.maxBreakthrough;
}

/** 돌파 (정수 1개 사용) */
export function doBreakthrough(save, id, balance) {
  const entry = save.owned[id];
  if (!canBreakthrough(entry, balance)) return false;
  entry.essence -= 1;
  entry.breakthrough += 1;
  return true;
}

/** 정수 1개 → 티켓으로 바꿀 때의 양 */
export function essenceTicketRate(rarity, balance) {
  return balance.essenceTickets[rarity] ?? balance.essenceTickets.R ?? 30;
}

/**
 * 중복 획득: 정수 +1. 이미 돌파 + 정수가 최대(5)면 티켓으로 바뀜
 * @returns {{essence:number, tickets:number}}
 */
export function grantDuplicate(save, char, balance) {
  const entry = save.owned[char.id];
  if (entry.breakthrough + entry.essence < balance.maxBreakthrough) {
    entry.essence += 1;
    return { essence: 1, tickets: 0 };
  }
  const t = essenceTicketRate(char.rarity, balance);
  save.tickets += t;
  return { essence: 0, tickets: t };
}
