// 배너 일정: 진행 중인 배너만 골라냄
import { inPeriod, now } from '../core/time.js';
import { STANDARD_BANNER } from './gacha.js';

export function isBannerActive(banner, t = now()) {
  return inPeriod(banner.startAt, banner.endAt, t);
}

/**
 * 지금 진행 중인 배너 목록 (픽업 먼저, 곧 끝나는 순)
 * 진행 중인 상시 배너가 없으면 기본 상시 배너를 맨 뒤에 붙여서 뽑기는 항상 가능
 */
export function activeBanners(banners, t = now()) {
  const list = banners.filter((b) => isBannerActive(b, t));
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'pickup' ? -1 : 1;
    const ae = a.endAt ? Date.parse(a.endAt) : Infinity;
    const be = b.endAt ? Date.parse(b.endAt) : Infinity;
    return ae - be;
  });
  if (!list.some((b) => b.type === 'standard')) list.push(STANDARD_BANNER);
  return list;
}

/** 목록이 바뀌었는지 비교하기 위한 서명 */
export const bannerSignature = (list) => list.map((b) => b.id).join('|');
