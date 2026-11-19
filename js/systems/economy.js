// 재화(보석, 티켓) 관리와 일일 출석 보상

import { kstDateKey, now } from '../core/time.js';

export const DAILY_GEMS = 300;

export function canAfford(save, cost) {
  return save.gems >= cost;
}

/** 보석 사용. 부족하면 false를 반환하고 아무것도 바꾸지 않음 */
export function spendGems(save, cost) {
  if (!canAfford(save, cost)) return false;
  save.gems -= cost;
  return true;
}

export function addGems(save, amount) {
  save.gems = Math.max(0, save.gems + Math.floor(amount));
}

export function addTickets(save, amount) {
  save.tickets = Math.max(0, (save.tickets || 0) + Math.floor(amount));
}

/** 보상 묶음 {gems, tickets} 지급 */
export function grantRewards(save, rewards) {
  if (!rewards) return;
  if (rewards.gems) addGems(save, rewards.gems);
  if (rewards.tickets) addTickets(save, rewards.tickets);
}

/**
 * 오늘(KST) 첫 접속이면 보석 300개 + 티켓 지급
 * @returns {{gems:number, tickets:number}|null} 이미 받았으면 null
 */
export function applyDailyLogin(save, dailyTickets = 0, t = now()) {
  const today = kstDateKey(t);
  if (save.lastLoginDate === today) return null;
  save.lastLoginDate = today;
  addGems(save, DAILY_GEMS);
  addTickets(save, dailyTickets);
  return { gems: DAILY_GEMS, tickets: dailyTickets };
}

/** 숫자 표시: 1,000 */
export function formatGems(n) {
  return Number(n).toLocaleString('ko-KR');
}
