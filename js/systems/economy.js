// 재화(보석, 티켓, 골드, 모집 증서) 관리와 일일 출석 보상

import { kstDateKey, now } from '../core/time.js';

export const DAILY_GEMS = 300;
const MAX = 999_999_999;

/** 재화 종류 (보상 묶음의 키) — 표시 순서이기도 해요 */
export const CURRENCIES = [
  { key: 'gems', label: '보석', unit: '개' },
  { key: 'scrolls', label: '모집 증서', unit: '장' },
  { key: 'gold', label: '골드', unit: '' },
  { key: 'tickets', label: '티켓', unit: '장' },
];

export function canAfford(save, cost) {
  return save.gems >= cost;
}

/** 보석 사용. 부족하면 false를 반환하고 아무것도 바꾸지 않음 */
export function spendGems(save, cost) {
  if (!canAfford(save, cost)) return false;
  save.gems -= cost;
  return true;
}

/** 골드 사용. 부족하면 false */
export function spendGold(save, cost) {
  if ((save.gold || 0) < cost) return false;
  save.gold -= cost;
  return true;
}

/** 모집 증서 사용. 부족하면 false */
export function spendScrolls(save, n) {
  if ((save.scrolls || 0) < n) return false;
  save.scrolls -= n;
  return true;
}

const add = (save, key, amount) => {
  save[key] = Math.min(MAX, Math.max(0, (save[key] || 0) + Math.floor(amount)));
};
export const addGems = (save, amount) => add(save, 'gems', amount);
export const addTickets = (save, amount) => add(save, 'tickets', amount);
export const addGold = (save, amount) => add(save, 'gold', amount);
export const addScrolls = (save, amount) => add(save, 'scrolls', amount);

/** 보상 묶음 {gems, tickets, gold, scrolls} 지급 */
export function grantRewards(save, rewards) {
  if (!rewards) return;
  for (const { key } of CURRENCIES) if (rewards[key] > 0) add(save, key, rewards[key]);
}

/** 보상 묶음 두 개 더하기 */
export function sumRewards(a, b) {
  const out = {};
  for (const { key } of CURRENCIES) {
    const v = (a?.[key] || 0) + (b?.[key] || 0);
    if (v) out[key] = v;
  }
  return out;
}

/** 보상 묶음 → [{key, label, amount}] (0은 뺌) */
export function rewardEntries(r) {
  return CURRENCIES.filter((c) => r?.[c.key] > 0).map((c) => ({ ...c, amount: r[c.key] }));
}

/** 보상 한 줄 글자: "보석 300 · 골드 5,000" */
export function rewardText(r) {
  return rewardEntries(r)
    .map((e) => `${e.label} ${formatGems(e.amount)}`)
    .join(' · ');
}

/**
 * 오늘(KST) 첫 접속이면 보석 300개 + 티켓 + 골드 지급
 * @param {{tickets?:number, gold?:number}} daily balance의 출석 보상
 * @returns {{gems:number, tickets:number, gold:number}|null} 이미 받았으면 null
 */
export function applyDailyLogin(save, { tickets = 0, gold = 0 } = {}, t = now()) {
  const today = kstDateKey(t);
  if (save.lastLoginDate === today) return null;
  save.lastLoginDate = today;
  addGems(save, DAILY_GEMS);
  addTickets(save, tickets);
  addGold(save, gold);
  return { gems: DAILY_GEMS, tickets, gold };
}

/** 숫자 표시: 1,000 */
export function formatGems(n) {
  return Number(n).toLocaleString('ko-KR');
}

/** 원화 표시: ₩33,000 */
export function formatKRW(n) {
  return `₩${Number(n).toLocaleString('ko-KR')}`;
}
