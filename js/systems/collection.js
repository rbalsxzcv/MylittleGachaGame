// 도감(컬렉션): 보유 캐릭터, 중복 시 별(최대 5), NEW 표시

import { nowKstIso, now } from '../core/time.js';

export const MAX_STARS = 5;
const RARITY_ORDER = { SSR: 3, SR: 2, R: 1 };

export function isOwned(save, id) {
  return !!save.owned[id];
}

/**
 * 뽑은 캐릭터를 도감에 추가
 * @returns {{isNew:boolean, stars:number, starUp:boolean}}
 */
export function addCharacter(save, id, t = now()) {
  const entry = save.owned[id];
  if (!entry) {
    save.owned[id] = { stars: 1, count: 1, firstAt: nowKstIso(t) };
    return { isNew: true, stars: 1, starUp: false };
  }
  entry.count += 1;
  const before = entry.stars;
  entry.stars = Math.min(MAX_STARS, entry.stars + 1);
  return { isNew: false, stars: entry.stars, starUp: entry.stars > before };
}

/**
 * 데이터에 새로 추가된 캐릭터를 NEW 목록에 올림
 * - 첫 시작이면 현재 캐릭터 전부를 '이미 아는 것'으로 처리 (NEW 없음)
 */
export function syncKnownIds(save, characters, isFirstStart) {
  const known = new Set(save.knownIds);
  const fresh = new Set(save.newIds);
  for (const c of characters) {
    if (known.has(c.id)) continue;
    known.add(c.id);
    if (!isFirstStart) fresh.add(c.id);
  }
  save.knownIds = [...known];
  save.newIds = [...fresh];
}

export function isMarkedNew(save, id) {
  return save.newIds.includes(id);
}

/** 도감에서 확인함 → NEW 해제. 바뀌었으면 true */
export function markSeen(save, id) {
  const i = save.newIds.indexOf(id);
  if (i < 0) return false;
  save.newIds.splice(i, 1);
  return true;
}

/** 확인하지 않은 NEW가 있는지 (현재 데이터에 있는 것만) */
export function hasUnseenNew(save, charMap) {
  return save.newIds.some((id) => charMap.has(id));
}

/** 희귀도 높은 순 → 추가일 최신 순 → 이름 순 */
export function sortCharacters(list) {
  return [...list].sort(
    (a, b) =>
      RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] ||
      (b.addedAt || '').localeCompare(a.addedAt || '') ||
      a.name.localeCompare(b.name, 'ko'),
  );
}

/** 홈 대표 캐릭터: 지정한 캐릭터 → 보유 중 최고 희귀도 → 없음(null) */
export function getFeatured(save, characters, charMap) {
  if (save.featuredId && isOwned(save, save.featuredId) && charMap.has(save.featuredId)) {
    return charMap.get(save.featuredId);
  }
  const owned = sortCharacters(characters.filter((c) => isOwned(save, c.id)));
  return owned[0] ?? null;
}

export function ownedCount(save, characters) {
  return characters.filter((c) => isOwned(save, c.id)).length;
}
