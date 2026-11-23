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

// ── 등급 = 희귀도 1–5 + NPC ──────────────────────────────
// NPC 등급: 뽑기/도감/육성/편성에 나오지 않음. 스토리 화자나 전투의 적(enemies.json의 charId로 연결)으로만 나옴.
// 등급을 NPC ↔ 1–5로 바꾸면 가챠 풀은 데이터에서 매번 새로 만들어서 바로 따라감 (세이브 기록은 그대로 보관)
export const NPC = 'npc';
/** 캐릭터 등급 정리: 1–5 정수 또는 'npc' (대소문자 무관, 예전 'R'/'SR'/'SSR'도). 알 수 없으면 null */
export function normalizeGrade(value) {
  if (typeof value === 'string' && value.trim().toLowerCase() === NPC) return NPC;
  return normalizeRarity(value);
}
/** NPC 등급 캐릭터인지 (예전 데이터의 pullable: false도 NPC) */
export const isNpc = (c) => !!c && (c.rarity === NPC || c.pullable === false);
/** 정렬용 숫자 (NPC = 0) */
export const gradeRank = (r) => (r === NPC ? 0 : normalizeRarity(r) || 0);

/** 표시용: 5 → '★★★★★' (NPC → '') */
export const rarityStars = (r) => (r === NPC ? '' : '★'.repeat(normalizeRarity(r) || 1));
/** 표시용 짧은 이름: 5 → '5★', NPC → 'NPC' */
export const rarityLabel = (r) => (r === NPC ? 'NPC' : `${normalizeRarity(r) || 1}★`);

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

/** 돌파 단계 상한 (balance.essence.maxBreakthrough가 이 안에서 정함) */
export const MAX_BREAKTHROUGH = 6;

// ── 역할 / 능력치 이름 ────────────────────────────────────
/** 역할 (계획서의 dps/tank/support/healer = attacker/defender/support/healer) */
export const ROLES = ['attacker', 'defender', 'support', 'healer'];
/** 캐릭터 능력치 전부 (energyRegen = 기력 획득 배율(기본 1), effectHit/effectRes/healBonus/shieldBonus = 0~ 비율) */
export const ALL_STATS = ['atk', 'def', 'hp', 'spd', 'critRate', 'critDmg', 'energyRegen', 'effectHit', 'effectRes', 'healBonus', 'shieldBonus'];
/** 레벨에 따라 자라는 능력치 */
export const LEVEL_STATS = ['atk', 'def', 'hp'];
/** 비율 능력치 (보너스 pct를 % 포인트로 더함: +6 → +0.06) */
export const RATIO_STATS = ['critRate', 'critDmg', 'energyRegen', 'effectHit', 'effectRes', 'healBonus', 'shieldBonus'];
/** 장비 칸 (고정 주옵션) */
export const GEAR_SLOTS = ['hp', 'def', 'crit', 'atk'];
/** 적 아키타입 */
export const ENEMY_ARCHETYPES = ['grunt', 'brute', 'caster', 'healer', 'shielder', 'assassin', 'elite', 'boss'];
/** 스테이지 종류 (자동 튜너 목표 승률) */
export const STAGE_TYPES = ['normal', 'elite', 'boss'];

const roleStats = (atk, def, hp, spd, extra = {}) => ({ atk, def, hp, spd, critRate: 0.05, critDmg: 0.5, energyRegen: 1, effectHit: 0, effectRes: 0, healBonus: 0, shieldBonus: 0, ...extra });

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
    // 캐릭터 기본 능력치 = round(rarityMul[희귀도] × roleTemplate[역할][능력치] × 레벨 성장) — 캐릭터마다 손으로 정하지 않음
    rarityMul: { 1: 0.66, 2: 0.72, 3: 0.78, 4: 0.88, 5: 1 },
    roleTemplate: {
      attacker: roleStats(145, 46, 1050, 104),
      defender: roleStats(100, 72, 1500, 96, { effectRes: 0.1 }),
      support: roleStats(115, 52, 1150, 110, { effectHit: 0.1 }),
      healer: roleStats(110, 52, 1250, 102),
    },
    tweakWarnPct: 10, // 캐릭터 statTweak(%)가 이걸 넘으면 개발 도구 경고
  },
  level: { costBase: 10, costExp: 1.25, goldPerTicket: 10 }, // lv→lv+1 티켓 = ceil(costBase × lv^costExp), 골드 = 티켓 × goldPerTicket
  essence: { maxBreakthrough: 5, overflowTickets: { 1: 30, 2: 30, 3: 30, 4: 80, 5: 200 } },
  daily: { tickets: 30, gold: 3000 },
  // 전투력 가중치 (energyRegen은 1을 넘는 만큼만)
  power: { atk: 2, def: 1.5, hp: 0.2, spd: 2, critRate: 300, critDmg: 100, energyRegen: 200, effectHit: 100, effectRes: 100, healBonus: 120, shieldBonus: 120 },
  // 돌파 1·3·4·5 = 역할별 능력치 노드 (pct: atk/def/hp/spd는 %, 비율 능력치는 % 포인트) × 낮은 희귀도 보정. 2·6 = 캐릭터 데이터 bt2/bt6
  breakthrough: {
    statNodes: {
      attacker: [{ stat: 'atk', pct: 8 }, { stat: 'critRate', pct: 6 }, { stat: 'atk', pct: 10 }, { stat: 'critDmg', pct: 18 }],
      defender: [{ stat: 'hp', pct: 8 }, { stat: 'def', pct: 10 }, { stat: 'hp', pct: 10 }, { stat: 'def', pct: 12 }],
      support: [{ stat: 'hp', pct: 8 }, { stat: 'spd', pct: 6 }, { stat: 'energyRegen', pct: 10 }, { stat: 'spd', pct: 8 }],
      healer: [{ stat: 'hp', pct: 8 }, { stat: 'healBonus', pct: 10 }, { stat: 'hp', pct: 10 }, { stat: 'healBonus', pct: 15 }],
    },
    lowRarityBoost: { 1: 1.5, 2: 1.4, 3: 1.3, 4: 1.15, 5: 1 },
  },
  // 키트 예산 (개발 도구 생성기/검사): 점수 = points[효과] × 크기 × 대상 계수 × 지속 × 확률, 칸 상한 × 희귀도 계수
  kitBudget: {
    points: {
      damage: 100, heal: 90, shield: 80, dot: 85, buff: 2.5, debuff: 2.5, energy_gain: 1.2, sp_gain: 40, advance_action: 3, delay_action: 3,
      interrupt: 40, cleanse: 25, taunt: 20, stack_gain: 8, stack_spend: 0, mark: 10, mark_detonate: 100, follow_up: 100, counter: 100, transform: 30, charge: 100, summon: 60,
    },
    statWeight: { atk: 1, def: 0.6, hp: 0.6, spd: 1.5, critRate: 2, critDmg: 0.8, dmgDealt: 1.2, dmgTaken: 1.2, energyRegen: 1, effectHit: 0.8, effectRes: 0.6, healBonus: 0.8, shieldBonus: 0.6 },
    targetFactor: { single: 1, all: 1.8, randomPer: 0.7, self: 1, ally: 1, allyAll: 1.8 },
    // 패시브: 발동 조건마다 전투 한 판에서 대략 몇 번쯤 쓸모 있는지 (점수 배율) · 수정자 점수 (값 1당)
    triggerWeight: { always: 1, onBattleStart: 0.5, onTurnStart: 1, onBasic: 0.7, onSkill: 0.5, onUltimate: 0.4, onCrit: 0.4, onKill: 0.3, onHit: 0.8, onHpBelow: 0.3, onAllyAttack: 1, onStackFull: 0.5 },
    modifierPoints: { stat_bonus: 3, effect_power: 4, ultimate_cost: 2, sp_cost: 60, energy_gain: 4, action_targeting: 60, resource_cap: 16, mark_turns: 24 },
    caps: { basic: 100, skill: 220, ultimate: 420, talent: 120, bt2: 80, bt6: 160, signature: 100 },
    rarityFactor: { 1: 0.55, 2: 0.62, 3: 0.7, 4: 0.84, 5: 1 },
    tolerancePct: 5,
  },
  // 추억 (무기 대신): 기본 공격력 + 부옵션 1개 + 패시브. 레벨은 티켓(캐릭터와 다른 곡선), 재련 R1–R5는 중복으로
  memory: {
    maxLevel: 50,
    growth: 0.08,
    atkBase: { 3: 24, 4: 34, 5: 46 },
    secondary: { 3: 6, 4: 9, 5: 12 }, // 부옵션 Lv.1 (%, 비율 능력치는 % 포인트)
    secGrowth: 0.02,
    cost: { costBase: 5, costExp: 1.2, goldPerTicket: 10 },
    refineScale: [1, 1.25, 1.5, 1.75, 2], // R1..R5 패시브 숫자 배율
    overflowMaterial: { 3: 5, 4: 20, 5: 80 }, // R5 넘는 중복 → 추억 재료 (레벨업 티켓 대신 씀)
    materialTickets: 10, // 추억 재료 1 = 레벨업 티켓 10
  },
  memoryGacha: {
    rates: { 3: 88.5, 4: 10, 5: 1.5 },
    cost: { single: 100, ten: 1000 },
    pity: 60,
    tenGuaranteeMin: 4,
    pickupShare: 0.5,
  },
  // 장비: 4칸 × 티어. 수치 = slotBase × tierMul^(티어−1) × (1 + enhStep × 강화), 무작위 없음
  gear: {
    tiers: 8,
    maxEnh: 5,
    slotBase: { hp: { hp: 160 }, def: { def: 12 }, crit: { critRate: 0.015, critDmg: 0.03 }, atk: { atk: 18 } },
    tierMul: 1.35,
    enhStep: 0.1,
    enhCost: { base: 20, tierExp: 1.3, enhExp: 1.2 }, // 강화석 ceil(base × 티어^tierExp × (강화+1)^enhExp)
    salvage: { base: 8, tierExp: 1.3, enhRefund: 0.5 }, // 분해 floor(base × 티어^tierExp) + 쓴 강화석 × enhRefund
    drop: {
      count: { normal: 1, boss: 2 },
      rates: { normal: { prev: 0.65, cur: 0.35 }, boss: { prev: 0.3, cur: 0.7 } }, // 지역 티어 −1 / 지역 티어
      matPerClear: 10, // × 지역 티어
    },
    regionTier: {}, // { 챕터 id: 티어 } — 없으면 챕터 순서 + 1
  },
  stars: { star3Ratio: 0.5 }, // ★1 승리 · ★2 쓰러진 아군 없음 · ★3 라운드 ≤ ceil(제한 × star3Ratio)
  repeat: { maxRuns: 50 },
  // 적: 기본(Lv.1) × 아키타입 배율 × 스테이지 난이도(difficulty, 튜너가 정함)
  enemy: {
    base: { atk: 60, def: 20, hp: 450, spd: 100 },
    archetypes: {
      grunt: { atk: 1, def: 1, hp: 1, spd: 1, effectRes: 0 },
      brute: { atk: 1.25, def: 1.3, hp: 1.8, spd: 0.88, effectRes: 0.05 },
      caster: { atk: 1.2, def: 0.8, hp: 0.85, spd: 1.04, effectRes: 0.05 },
      healer: { atk: 0.8, def: 0.9, hp: 1.1, spd: 1.02, effectRes: 0.05 },
      shielder: { atk: 0.85, def: 1.4, hp: 1.4, spd: 0.9, effectRes: 0.1 },
      assassin: { atk: 1.1, def: 0.8, hp: 0.9, spd: 1.12, effectRes: 0 },
      elite: { atk: 1.3, def: 1.3, hp: 2.2, spd: 1.02, effectRes: 0.15 },
      boss: { atk: 1.5, def: 1.6, hp: 5, spd: 1.02, effectRes: 0.2 },
    },
  },
  // 밸런스 툴킷: 스테이지마다 '그때쯤 플레이어 상태' 가정 → expectedPower, 기준 팀
  expected: {
    levelStart: 1,
    levelPerStage: 1.4,
    breakthrough: { 1: 3, 2: 3, 3: 2, 4: 1, 5: 0 },
    memory: { rarity: 3, levelRatio: 0.8, refine: 1 },
    gearEnhPerStage: 0.25, // 지역 안에서 n번째 스테이지 → 강화 floor(n × 이 값) (최대 maxEnh)
  },
  tuner: {
    targetWinRate: { normal: 0.9, elite: 0.75, boss: 0.6 },
    runs: 300,
    tolerance: 0.03,
    difficulty: { min: 0.2, max: 6 },
    maxIter: 14,
  },
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
/**
 * def와 같은 모양으로 정리: 숫자는 0 이상(범위 밖은 자름), 문자열은 비어 있지 않으면 그대로,
 * 배열은 def 길이만큼 칸마다, 객체는 def에 있는 키만. 모르는 키는 버림
 */
function like(raw, def, max = 1e9) {
  if (typeof def === 'number') return num(raw, def, 0, max);
  if (typeof def === 'string') return typeof raw === 'string' && raw.trim() ? raw.trim() : def;
  if (Array.isArray(def)) return def.map((d, i) => like(Array.isArray(raw) ? raw[i] : undefined, d, max));
  if (isObj(def)) {
    const out = {};
    for (const [k, d] of Object.entries(def)) out[k] = like(isObj(raw) ? raw[k] : undefined, d, max);
    return out;
  }
  return def;
}
/** 확률표: 모두 0이면 기본 확률 (경고) */
function normalizeRates(rates, def, warn, where) {
  if (Object.values(rates).some((v) => v > 0)) return rates;
  warn(`${where}: 확률이 모두 0이라 기본값을 써요`);
  return { ...def };
}
/** 돌파 능력치 노드 [{stat, pct}] × 4 (모르는 능력치는 기본값) */
function statNodes(raw, def) {
  const out = {};
  for (const role of ROLES) {
    out[role] = def[role].map((d, i) => {
      const r = Array.isArray(raw?.[role]) ? raw[role][i] : null;
      return { stat: ALL_STATS.includes(r?.stat) ? r.stat : d.stat, pct: num(r?.pct, d.pct, 0, 1000) };
    });
  }
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
      rarityMul: byRarity(st.rarityMul, d.stats.rarityMul, (v, def) => num(v, def, 0.01, 10)),
      roleTemplate: like(st.roleTemplate, d.stats.roleTemplate, 1e6),
      tweakWarnPct: num(st.tweakWarnPct, d.stats.tweakWarnPct, 0, 100),
    },
    level: {
      costBase: num(j.level?.costBase, d.level.costBase, 0, 1e6),
      costExp: num(j.level?.costExp, d.level.costExp, 0, 5),
      goldPerTicket: num(j.level?.goldPerTicket, d.level.goldPerTicket, 0, 1e4),
    },
    essence: {
      maxBreakthrough: int(j.essence?.maxBreakthrough, d.essence.maxBreakthrough, 0, MAX_BREAKTHROUGH),
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
    breakthrough: {
      statNodes: statNodes(j.breakthrough?.statNodes, d.breakthrough.statNodes),
      lowRarityBoost: byRarity(j.breakthrough?.lowRarityBoost, d.breakthrough.lowRarityBoost, (v, def) => num(v, def, 0, 10)),
    },
    kitBudget: {
      ...like(j.kitBudget, d.kitBudget),
      rarityFactor: byRarity(j.kitBudget?.rarityFactor, d.kitBudget.rarityFactor, (v, def) => num(v, def, 0.01, 10)),
      tolerancePct: num(j.kitBudget?.tolerancePct, d.kitBudget.tolerancePct, 0.5, 50),
    },
    memory: {
      ...like(j.memory, d.memory),
      maxLevel: int(j.memory?.maxLevel, d.memory.maxLevel, 1, 1000),
      refineScale: like(j.memory?.refineScale, d.memory.refineScale, 100),
    },
    memoryGacha: {
      ...like(j.memoryGacha, d.memoryGacha),
      pity: int(j.memoryGacha?.pity, d.memoryGacha.pity, 1, 1000),
      tenGuaranteeMin: int(j.memoryGacha?.tenGuaranteeMin, d.memoryGacha.tenGuaranteeMin, 3, 5),
      pickupShare: num(j.memoryGacha?.pickupShare, d.memoryGacha.pickupShare, 0, 1),
    },
    gear: {
      ...like(j.gear, d.gear),
      tiers: int(j.gear?.tiers, d.gear.tiers, 1, 30),
      maxEnh: int(j.gear?.maxEnh, d.gear.maxEnh, 0, 20),
      regionTier: Object.fromEntries(Object.entries(isObj(j.gear?.regionTier) ? j.gear.regionTier : {}).filter(([, v]) => Number.isInteger(v) && v >= 1 && v <= 30)),
    },
    stars: { star3Ratio: num(j.stars?.star3Ratio, d.stars.star3Ratio, 0.05, 1) },
    repeat: { maxRuns: int(j.repeat?.maxRuns, d.repeat.maxRuns, 1, 500) },
    enemy: like(j.enemy, d.enemy, 1e6),
    expected: like(j.expected, d.expected, 1e6),
    tuner: {
      ...like(j.tuner, d.tuner),
      targetWinRate: like(j.tuner?.targetWinRate, d.tuner.targetWinRate, 1),
      runs: int(j.tuner?.runs, d.tuner.runs, 10, 100000),
      maxIter: int(j.tuner?.maxIter, d.tuner.maxIter, 1, 100),
    },
  };
  out.memoryGacha.rates = normalizeRates(out.memoryGacha.rates, d.memoryGacha.rates, warn, 'balance.memoryGacha.rates');
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
