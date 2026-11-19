// 배너 일정: 진행 중인 배너만 골라냄 + 자동 로테이션 픽업
//
// 로테이션 픽업 배너: { type: "pickup", rotation: { rarity: "SSR", count: 2, days: 7, anchor: "..." } }
//   anchor 시각부터 days일마다 다음 count명이 픽업돼요. 대상은 그 희귀도의 뽑을 수 있는 캐릭터 전체를
//   공개 시각(addedAt) → id 순서로 줄 세운 것. 끝까지 가면 처음으로 돌아가요.
//   지금 로테이션이 끝나는 시각이 그 배너의 endAt처럼 보여요(남은 시간 표시). 대상이 없으면 배너를 숨겨요.
import { inPeriod, now, parseDate } from '../core/time.js';
import { STANDARD_BANNER } from './gacha.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function isBannerActive(banner, t = now()) {
  return inPeriod(banner.startAt, banner.endAt, t);
}

/** 뽑기에 나오는 캐릭터인지 (스토리 전용 인물은 pullable: false) */
export const isPullable = (c) => c.pullable !== false;

/** 로테이션 대상 순서 (공개 시각 → id) */
export function rotationPool(characters, rarity) {
  return characters
    .filter((c) => c.rarity === rarity && isPullable(c))
    .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '') || a.id.localeCompare(b.id));
}

/**
 * 로테이션 배너의 지금 픽업 계산
 * @returns {null | {index:number, pickupIds:string[], startAt:string, endAt:string}} 대상이 없으면 null
 */
export function rotationAt(banner, characters, t = now()) {
  const r = banner.rotation;
  const pool = rotationPool(characters, r.rarity);
  if (!pool.length) return null;
  const anchor = parseDate(r.anchor) || parseDate(banner.startAt) || new Date(0);
  const period = r.days * DAY_MS;
  const index = Math.max(0, Math.floor((t.getTime() - anchor.getTime()) / period));
  const count = Math.min(r.count, pool.length);
  const ids = [];
  for (let i = 0; i < count; i++) ids.push(pool[(index * count + i) % pool.length].id);
  const start = new Date(anchor.getTime() + index * period);
  return { index, pickupIds: ids, startAt: start.toISOString(), endAt: new Date(start.getTime() + period).toISOString() };
}

/** 다음 n번의 로테이션 (개발 도구 미리보기용) */
export function rotationSchedule(banner, characters, n = 4, t = now()) {
  const out = [];
  const cur = rotationAt(banner, characters, t);
  if (!cur) return out;
  let at = new Date(cur.startAt);
  for (let i = 0; i < n; i++) {
    const r = rotationAt(banner, characters, at);
    out.push(r);
    at = new Date(r.endAt);
  }
  return out;
}

/** 배너 하나를 지금 시점 기준으로 풀어냄 (로테이션이면 픽업/기간을 채움). 보여줄 수 없으면 null */
export function resolveBanner(banner, characters, t = now()) {
  if (!banner.rotation) return banner;
  const r = rotationAt(banner, characters, t);
  if (!r) return null;
  const bannerEnd = parseDate(banner.endAt);
  const bannerStart = parseDate(banner.startAt);
  const end = bannerEnd && bannerEnd < new Date(r.endAt) ? banner.endAt : r.endAt;
  const start = bannerStart && bannerStart > new Date(r.startAt) ? banner.startAt : r.startAt;
  // 기간 표시는 '이번 로테이션' 기준
  return { ...banner, pickupIds: r.pickupIds, startAt: start, endAt: end, rotationIndex: r.index };
}

/**
 * 지금 진행 중인 배너 목록 (픽업 먼저, 곧 끝나는 순)
 * 진행 중인 상시 배너가 없으면 기본 상시 배너를 맨 뒤에 붙여서 뽑기는 항상 가능
 */
export function activeBanners(banners, characters = [], t = now()) {
  const list = banners
    .filter((b) => isBannerActive(b, t))
    .map((b) => resolveBanner(b, characters, t))
    .filter((b) => b && isBannerActive(b, t));
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'pickup' ? -1 : 1;
    const ae = a.endAt ? Date.parse(a.endAt) : Infinity;
    const be = b.endAt ? Date.parse(b.endAt) : Infinity;
    return ae - be;
  });
  if (!list.some((b) => b.type === 'standard')) list.push(STANDARD_BANNER);
  return list;
}

/** 목록이 바뀌었는지 비교하기 위한 서명 (로테이션이 넘어가도 바뀜) */
export const bannerSignature = (list) => list.map((b) => `${b.id}:${b.rotationIndex ?? ''}`).join('|');
