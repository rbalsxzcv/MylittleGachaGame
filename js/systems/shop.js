// 상점: 골드 상점 + 가상 캐시 상점 (실제 결제 없음) + 월정액 + 후원 등급(VIP)
// 상품 목록은 data/shop.json. 화면과 분리된 순수 함수입니다.
// 구매할 수 없으면(재화 부족, 구매 제한, 잠김) 아무것도 바꾸지 않고 null을 돌려줘요.

import { registerSaveSlice } from '../core/save.js';
import { ID_PATTERN } from '../core/data.js';
import { kstDateKey, kstWeekKey, kstMonthKey, addDaysKey, daysBetweenKeys, now } from '../core/time.js';
import { grantRewards, sumRewards, addGems } from './economy.js';
import { isCleared } from './stageProgress.js';

const MAX_IDS = 2000;
const MAX_SPENT = 1e12;
const dateKeyOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function createShop() {
  return {
    bought: {}, // 상품 id → 지금까지 산 횟수 (1회 한정 / 첫 구매 보너스 판정)
    period: {}, // 상품 id → { key: 기간 키, n: 그 기간에 산 횟수 }
    spentKRW: 0, // 누적 가상 결제 금액
    pass: { until: null, lastClaim: null, dailyGems: 0 }, // 월정액: 마지막 날(포함), 마지막 수령일
  };
}

function cleanCount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1e6, Math.max(0, Math.floor(n))) : 0;
}

registerSaveSlice('shop', {
  create: createShop,
  sanitize(raw) {
    const out = createShop();
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, n] of Object.entries(raw.bought || {}).slice(0, MAX_IDS)) {
      if (ID_PATTERN.test(id) && cleanCount(n) > 0) out.bought[id] = cleanCount(n);
    }
    for (const [id, p] of Object.entries(raw.period || {}).slice(0, MAX_IDS)) {
      if (ID_PATTERN.test(id) && p && typeof p.key === 'string' && p.key.length <= 12) out.period[id] = { key: p.key, n: cleanCount(p.n) };
    }
    const spent = Number(raw.spentKRW);
    out.spentKRW = Number.isFinite(spent) ? Math.min(MAX_SPENT, Math.max(0, Math.floor(spent))) : 0;
    const pass = raw.pass || {};
    out.pass = {
      until: dateKeyOk(pass.until) ? pass.until : null,
      lastClaim: dateKeyOk(pass.lastClaim) ? pass.lastClaim : null,
      dailyGems: Math.min(100000, cleanCount(pass.dailyGems)),
    };
    return out;
  },
});

// ── 구매 제한 ────────────────────────────────────────────
function periodKey(per, t) {
  if (per === 'day') return kstDateKey(t);
  if (per === 'week') return kstWeekKey(t);
  if (per === 'month') return kstMonthKey(t);
  return 'once';
}

/** 이번 기간에 산 횟수 */
function usedCount(save, item, t) {
  if (!item.limit) return 0;
  if (item.limit.per === 'once') return save.shop.bought[item.id] || 0;
  const p = save.shop.period[item.id];
  return p && p.key === periodKey(item.limit.per, t) ? p.n : 0;
}

/** 남은 구매 횟수 (제한이 없으면 Infinity) */
export function remaining(save, item, t = now()) {
  if (!item.limit) return Infinity;
  return Math.max(0, item.limit.count - usedCount(save, item, t));
}

/** 구매 제한 표시: "오늘 2/5" · "이번 주 1/3" · "1회 한정" */
export function limitLabel(save, item, t = now()) {
  if (!item.limit) return '';
  const { per, count } = item.limit;
  const used = usedCount(save, item, t);
  if (per === 'once') return count === 1 ? '1회 한정' : `계정당 ${used}/${count}`;
  const word = { day: '오늘', week: '이번 주', month: '이번 달' }[per];
  return `${word} ${used}/${count}`;
}

function markBought(save, item, t) {
  save.shop.bought[item.id] = (save.shop.bought[item.id] || 0) + 1;
  if (item.limit && item.limit.per !== 'once') {
    const key = periodKey(item.limit.per, t);
    const p = save.shop.period[item.id];
    save.shop.period[item.id] = { key, n: p && p.key === key ? p.n + 1 : 1 };
  }
}

/** 스테이지 몇 개를 깼는지 */
export function clearedStageCount(save, stages) {
  return stages.filter((s) => isCleared(save, s.id)).length;
}

/** 잠긴 상품이면 이유 글자, 아니면 null */
export function lockReason(save, item, stages) {
  const need = item.requires?.stagesCleared || 0;
  if (need > 0 && clearedStageCount(save, stages) < need) return `스토리 전투 ${need}개 클리어 시 해금`;
  return null;
}

// ── 골드 상점 ────────────────────────────────────────────
/** 구매 가능 여부 → 'ok' | 'soldout' | 'gold' | 'gems' */
export function goldItemState(save, item, t = now()) {
  if (remaining(save, item, t) <= 0) return 'soldout';
  if ((save.gold || 0) < item.cost.gold) return 'gold';
  if (save.gems < item.cost.gems) return 'gems';
  return 'ok';
}

/** 골드 상점 구매 → 받은 보상, 못 사면 null */
export function buyGoldItem(save, item, t = now()) {
  if (goldItemState(save, item, t) !== 'ok') return null;
  save.gold -= item.cost.gold;
  save.gems -= item.cost.gems;
  markBought(save, item, t);
  grantRewards(save, item.rewards);
  return { ...item.rewards };
}

/** 지금 받을 수 있는 무료 상품이 있으면 true (홈 메뉴 빨간 점) */
export function hasFreeItem(save, shop, t = now()) {
  return shop.gold.some((i) => i.cost.gold === 0 && i.cost.gems === 0 && remaining(save, i, t) > 0);
}

// ── 캐시 상점 (가상 결제) ────────────────────────────────
/** 첫 구매 보너스를 받을 수 있는지 */
export const hasFirstBonus = (save, item) => !!item.firstBonus && !save.shop.bought[item.id];

/** 월정액 남은 일수 (오늘 포함, 없으면 0) */
export function passDaysLeft(save, t = now()) {
  const until = save.shop.pass.until;
  if (!until) return 0;
  return Math.max(0, daysBetweenKeys(kstDateKey(t), until) + 1);
}

/** 캐시 상품 구매 가능 여부 → 'ok' | 'soldout' | 'locked' | 'passmax' */
export function cashItemState(save, item, stages, t = now()) {
  if (lockReason(save, item, stages)) return 'locked';
  if (remaining(save, item, t) <= 0) return 'soldout';
  if (item.pass && passDaysLeft(save, t) + item.pass.days > item.pass.maxDays) return 'passmax';
  return 'ok';
}

/**
 * 가상 결제 완료 처리: 보상 + 첫 구매 보너스 + 월정액 연장 + 누적 금액
 * @returns {{rewards:object, firstBonus:boolean, passDays:number, vipBefore:number, vipAfter:number}|null}
 */
export function buyCashItem(save, item, shop, stages, t = now()) {
  if (cashItemState(save, item, stages, t) !== 'ok') return null;
  const first = hasFirstBonus(save, item);
  const vipBefore = vipLevel(save.shop.spentKRW, shop.vip);
  let rewards = { ...item.rewards };
  if (first) rewards = sumRewards(rewards, item.firstBonus);
  markBought(save, item, t);
  grantRewards(save, rewards);
  save.shop.spentKRW = Math.min(MAX_SPENT, save.shop.spentKRW + item.priceKRW);

  let passDays = 0;
  if (item.pass) {
    const today = kstDateKey(t);
    const left = passDaysLeft(save, t);
    // 오늘부터 시작이면 오늘 몫도 바로 받도록 lastClaim은 그대로 둠
    save.shop.pass.until = addDaysKey(left > 0 ? save.shop.pass.until : today, left > 0 ? item.pass.days : item.pass.days - 1);
    save.shop.pass.dailyGems = item.pass.dailyGems;
    passDays = passDaysLeft(save, t);
  }
  return { rewards, firstBonus: first, passDays, vipBefore, vipAfter: vipLevel(save.shop.spentKRW, shop.vip) };
}

/**
 * 월정액 오늘 몫 받기 (기간 안 + 오늘 아직 안 받음)
 * @returns {{gems:number, daysLeft:number}|null}
 */
export function claimPassDaily(save, t = now()) {
  const pass = save.shop.pass;
  const today = kstDateKey(t);
  if (!pass.until || pass.lastClaim === today || passDaysLeft(save, t) <= 0 || !pass.dailyGems) return null;
  pass.lastClaim = today;
  addGems(save, pass.dailyGems);
  return { gems: pass.dailyGems, daysLeft: passDaysLeft(save, t) - 1 };
}

// ── 후원 등급 (VIP) ──────────────────────────────────────
/** 누적 금액 → VIP 등급 (0 = 없음) */
export function vipLevel(spent, tiers) {
  let lv = 0;
  for (const need of tiers) if (spent >= need) lv += 1;
  return lv;
}

/** VIP 진행도 → {level, next(다음 등급 필요 금액, 최고면 null), pct} */
export function vipProgress(spent, tiers) {
  const level = vipLevel(spent, tiers);
  const next = tiers[level] ?? null;
  const prev = level > 0 ? tiers[level - 1] : 0;
  const pct = next == null ? 100 : Math.max(0, Math.min(100, ((spent - prev) / (next - prev)) * 100));
  return { level, next, pct };
}
