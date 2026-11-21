// 조정 수치(밸런스) — 코드가 숫자를 가져오는 유일한 모듈
//
// 숫자 자체는 data/balance.json에 있습니다 (개발 도구 밸런스 탭에서 편집 → 배포).
// 여기에는 (1) 파일이 없거나 값이 빠졌을 때 쓰는 기본값(DEFAULTS),
//          (2) balance.json 검사/정리(loadConfig) — 예전 평평한 형식도 새 형식으로 바꿔서 읽음,
//          (3) 희귀도/큰 숫자 같은 공용 도우미가 있습니다.
// 다른 파일에 조정 수치를 직접 쓰지 마세요. 함수는 loadConfig 결과(보통 ctx.data.balance)를 인자로 받습니다.
// DOM을 쓰지 않아서 게임 / 개발 도구 / 테스트(Node)가 같이 씁니다.

import { cleanKit } from './battle/schema.js';

// ── 희귀도 ────────────────────────────────────────────────
export const RARITIES = [1, 2, 3, 4, 5];
export const MAX_RARITY = 5;
/** 예전 데이터의 희귀도 → 별 개수 */
export const LEGACY_RARITY = { R: 3, SR: 4, SSR: 5 };

/** 희귀도 값 정리: 1–5 정수 (예전 'R'/'SR'/'SSR'도 받음). 알 수 없으면 null */
export function normalizeRarity(value) {
  if (typeof value === 'string' && value in LEGACY_RARITY) return LEGACY_RARITY[value];
  if (typeof value !== 'number' && typeof value !== 'string') return null; // true → 1 같은 변환 막기
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_RARITY ? n : null;
}

/** 표시용: 5 → '★★★★★' */
export const rarityStars = (r) => '★'.repeat(normalizeRarity(r) || 1);
/** 표시용 짧은 이름: 5 → '5★' */
export const rarityLabel = (r) => `${normalizeRarity(r) || 1}★`;

// ── 큰 숫자 ───────────────────────────────────────────────
/** 12,345 → '1.2만', 340,000,000 → '3.4억', 9,876 → '9,876' (소수 첫째 자리 내림, .0은 생략) */
export function formatBig(n) {
  const v = Math.floor(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const short = (x, unit) => `${sign}${(Math.floor((a / x) * 10) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${unit}`;
  if (a >= 1e8) return short(1e8, '억');
  if (a >= 1e4) return short(1e4, '만');
  return `${sign}${a.toLocaleString('ko-KR')}`;
}

// ── 기본값 ────────────────────────────────────────────────
export const DEFAULTS = {
  gacha: {
    rates: { 1: 40, 2: 30, 3: 20, 4: 8, 5: 2 }, // %
    cost: { single: 100, ten: 1000 }, // 보석
    pity: 70, // 5★ 없이 70번째 뽑기는 5★
    tenGuaranteeMin: 4, // 10연차에 이 희귀도 이상 1장 확정
    pickupShare: 0.5, // 5★가 나오면 픽업일 확률
  },
  stats: {
    growth: 0.08, // 레벨당 atk/def/hp 성장률
    byRarity: {
      // 캐릭터 데이터에 stats가 없을 때 쓰는 Lv.1 기본 능력치
      1: { atk: 85, def: 34, hp: 765, spd: 95 },
      2: { atk: 92, def: 37, hp: 830, spd: 97 },
      3: { atk: 100, def: 40, hp: 900, spd: 100 },
      4: { atk: 115, def: 46, hp: 1035, spd: 102 },
      5: { atk: 130, def: 52, hp: 1170, spd: 105 },
    },
    critRate: 0.05,
    critDmg: 0.5,
  },
  level: { costBase: 10, costExp: 1.25, goldPerTicket: 10 }, // lv→lv+1 티켓 = ceil(costBase × lv^costExp), 골드 = 티켓 × goldPerTicket
  essence: { maxBreakthrough: 5, overflowTickets: { 1: 30, 2: 30, 3: 30, 4: 80, 5: 200 } },
  daily: { tickets: 30, gold: 3000 },
  power: { atk: 2, def: 1.5, hp: 0.2, spd: 2, critRate: 300, critDmg: 100 }, // 전투력 가중치
  powerWarnPct: 15, // 같은 희귀도 평균 전투력보다 이만큼(%) 높으면 개발 도구 경고
  combat: {
    avBase: 10000, // 행동 수치 = avBase / spd
    roundAv: 100, // 타임라인이 이만큼 흐를 때마다 1라운드
    queuePreview: 8, // 왼쪽 행동 순서에 보여 줄 인원
    maxRounds: 200, // 무한 전투 방지
    energy: { max: 100, basic: 20, skill: 30, hit: 10, ultimateCost: 100 },
    sp: { start: 3, max: 5, basicGain: 1, skillCost: 1 },
    // 스테이지 웨이브에 level이 없을 때: 적 레벨 = 1 + (추천 전투력 ÷ 5 − refPower) ÷ perLevel
    // refPower = Lv.1 3★ 한 명의 전투력, perLevel = 레벨 1당 늘어나는 전투력 (대략)
    enemyLevel: { refPower: 705, perLevel: 35 },
    fx: { actionMs: 500, cutinMs: 1000 },
  },
  defaultKit: {
    basic: { name: '기본 공격', description: '적 하나를 공격해요.', targeting: 'enemy_single', effects: [{ type: 'damage', mult: 1, stat: 'atk', hits: 1 }] },
    skill: { name: '강타', description: '적 하나에게 큰 피해를 줘요. (SP 1)', targeting: 'enemy_single', effects: [{ type: 'damage', mult: 1.8, stat: 'atk', hits: 1 }] },
    ultimate: { name: '필살기', description: '적 전체를 공격해요.', targeting: 'enemy_all', effects: [{ type: 'damage', mult: 1.4, stat: 'atk', hits: 1 }] },
  },
};

// ── 정리 도우미 ───────────────────────────────────────────
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v, def, min, max) {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
const int = (v, def, min, max) => Math.round(num(v, def, min, max));
/** def와 같은 모양의 숫자 묶음 */
function rec(raw, def, min, max, round = true) {
  const out = {};
  for (const [k, v] of Object.entries(def)) out[k] = round ? int(raw?.[k], v, min, max) : num(raw?.[k], v, min, max);
  return out;
}
/** 희귀도(1–5)별 값. 예전 키 R/SR/SSR도 받음 (→ 3/4/5★, 1·2★는 기본값) */
function byRarity(raw, def, fn) {
  const src = {};
  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const r = normalizeRarity(k);
      if (r) src[r] = v;
    }
  }
  const out = {};
  for (const r of RARITIES) out[r] = fn(src[r], def[r]);
  return out;
}

/**
 * 예전 평평한 형식 → 새 형식 (이미 새 형식이면 그대로)
 * 예전: { growth, levelCost:{base,exp}, levelGoldPerTicket, crit:{rate,dmg}, rarityStats:{R,SR,SSR},
 *         energy, essenceTickets:{R,SR,SSR}, maxBreakthrough, dailyTickets, dailyGold, power, powerWarnPct, maxRounds, defaultKit }
 */
export function upgradeLegacyBalance(j) {
  if (!isObj(j)) return {};
  const legacy = ['rarityStats', 'levelCost', 'essenceTickets', 'energy', 'dailyTickets', 'levelGoldPerTicket'].some((k) => k in j);
  if (!legacy) return j;
  return {
    gacha: j.gacha,
    stats: {
      growth: j.stats?.growth ?? j.growth,
      byRarity: j.stats?.byRarity ?? j.rarityStats,
      critRate: j.stats?.critRate ?? j.crit?.rate,
      critDmg: j.stats?.critDmg ?? j.crit?.dmg,
    },
    level: { costBase: j.levelCost?.base, costExp: j.levelCost?.exp, goldPerTicket: j.levelGoldPerTicket, ...(j.level || {}) },
    essence: { maxBreakthrough: j.maxBreakthrough, overflowTickets: j.essenceTickets, ...(j.essence || {}) },
    daily: { tickets: j.dailyTickets, gold: j.dailyGold, ...(j.daily || {}) },
    power: j.power,
    powerWarnPct: j.powerWarnPct,
    combat: { energy: j.energy, maxRounds: j.maxRounds, ...(j.combat || {}) },
    defaultKit: j.defaultKit,
  };
}

/**
 * balance.json → 쓸 수 있는 설정 객체. 빠진 값은 기본값, 범위 밖은 잘라냄. 절대 예외를 던지지 않음
 * @param {object} json balance.json 내용 (예전 형식도 됨)
 * @param {object|null} vocab 전투 용어집 (있으면 defaultKit도 정리)
 * @param {(msg:string)=>void} [warn]
 */
export function loadConfig(json, vocab = null, warn = () => {}) {
  const d = DEFAULTS;
  const j = upgradeLegacyBalance(json);
  const g = j.gacha || {};
  const rates = byRarity(g.rates, d.gacha.rates, (v, def) => num(v, def, 0, 100));
  if (RARITIES.every((r) => rates[r] <= 0)) {
    warn('balance.gacha.rates: 확률이 모두 0이라 기본값을 써요');
    Object.assign(rates, d.gacha.rates);
  }
  const st = j.stats || {};
  const out = {
    gacha: {
      rates,
      cost: rec(g.cost, d.gacha.cost, 0, 1e7),
      pity: int(g.pity, d.gacha.pity, 1, 1000),
      tenGuaranteeMin: int(g.tenGuaranteeMin, d.gacha.tenGuaranteeMin, 1, 5),
      pickupShare: num(g.pickupShare, d.gacha.pickupShare, 0, 1),
    },
    stats: {
      growth: num(st.growth, d.stats.growth, 0, 10),
      byRarity: byRarity(st.byRarity, d.stats.byRarity, (v, def) => ({ ...rec(v, { atk: def.atk, def: def.def, hp: def.hp }, 1, 1e6), spd: int(v?.spd, def.spd, 1, 1000) })),
      critRate: num(st.critRate, d.stats.critRate, 0, 1),
      critDmg: num(st.critDmg, d.stats.critDmg, 0, 10),
    },
    level: {
      costBase: num(j.level?.costBase, d.level.costBase, 0, 1e6),
      costExp: num(j.level?.costExp, d.level.costExp, 0, 5),
      goldPerTicket: num(j.level?.goldPerTicket, d.level.goldPerTicket, 0, 1e4),
    },
    essence: {
      maxBreakthrough: int(j.essence?.maxBreakthrough, d.essence.maxBreakthrough, 0, 5),
      overflowTickets: byRarity(j.essence?.overflowTickets, d.essence.overflowTickets, (v, def) => int(v, def, 0, 1e6)),
    },
    daily: rec(j.daily, d.daily, 0, 1e8),
    power: rec(j.power, d.power, 0, 1e4, false),
    powerWarnPct: num(j.powerWarnPct, d.powerWarnPct, 0, 1000),
    combat: {
      avBase: int(j.combat?.avBase, d.combat.avBase, 100, 1e6),
      roundAv: int(j.combat?.roundAv, d.combat.roundAv, 1, 1e6),
      queuePreview: int(j.combat?.queuePreview, d.combat.queuePreview, 1, 20),
      maxRounds: int(j.combat?.maxRounds, d.combat.maxRounds, 10, 1000),
      energy: rec(j.combat?.energy, d.combat.energy, 0, 1000),
      sp: rec(j.combat?.sp, d.combat.sp, 0, 99),
      enemyLevel: {
        refPower: num(j.combat?.enemyLevel?.refPower, d.combat.enemyLevel.refPower, 1, 1e7),
        perLevel: num(j.combat?.enemyLevel?.perLevel, d.combat.enemyLevel.perLevel, 1, 1e7),
      },
      fx: rec(j.combat?.fx, d.combat.fx, 0, 10000),
    },
  };
  out.combat.energy.max = Math.max(1, out.combat.energy.max);
  out.combat.sp.max = Math.max(1, out.combat.sp.max);
  out.combat.sp.start = Math.min(out.combat.sp.start, out.combat.sp.max);
  out.defaultKit = vocab ? cleanKit(j.defaultKit || {}, vocab, warn, 'balance.defaultKit', d.defaultKit) : structuredClone(d.defaultKit);
  return out;
}

// ── 설정에서 바로 계산하는 값 ─────────────────────────────
/** 정수 1개를 티켓으로 바꿀 때의 양 */
export const overflowTickets = (rarity, cfg) => cfg.essence.overflowTickets[normalizeRarity(rarity) || 1] ?? 0;

/** 희귀도 기본 능력치 (모르는 희귀도면 3★) */
export const rarityBaseStats = (rarity, cfg) => cfg.stats.byRarity[normalizeRarity(rarity) || 3];

/** 스테이지 웨이브의 적 레벨: 적어 둔 level → 없으면 추천 전투력으로 계산 */
export function enemyLevelFor(entry, stage, cfg) {
  if (entry?.level) return entry.level;
  const { refPower, perLevel } = cfg.combat.enemyLevel;
  return Math.max(1, Math.round(1 + ((stage?.recommendedPower || 0) / 5 - refPower) / perLevel));
}
