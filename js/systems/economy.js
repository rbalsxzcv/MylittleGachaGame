// 재화(보석) 관리와 일일 출석 보상

import { kstDateKey } from '../core/time.js';

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

/**
 * 오늘(KST) 첫 접속이면 보석 300개 지급
 * @returns {number} 지급한 보석 수 (이미 받았으면 0)
 */
export function applyDailyLogin(save, now = new Date()) {
  const today = kstDateKey(now);
  if (save.lastLoginDate === today) return 0;
  save.lastLoginDate = today;
  addGems(save, DAILY_GEMS);
  return DAILY_GEMS;
}

/** 숫자 표시: 1,000 */
export function formatGems(n) {
  return Number(n).toLocaleString('ko-KR');
}
