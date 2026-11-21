// 도감(컬렉션): 보유 캐릭터, 중복 → 정수(돌파 재료), NEW 표시

import { nowKstIso, now } from '../core/time.js';
import { grantDuplicate } from './progression.js';

/** 카드의 별 칸 수 = 최대 돌파 단계 */
export const MAX_STARS = 5;

export function isOwned(save, id) {
  return !!save.owned[id];
}

/**
 * 뽑은 캐릭터를 도감에 추가. 중복이면 정수 +1 (이미 최대면 티켓으로)
 * @returns {{isNew:boolean, essence:number, tickets:number, breakthrough:number}}
 */
export function addCharacter(save, char, balance, t = now()) {
  const entry = save.owned[char.id];
  if (!entry) {
    save.owned[char.id] = { level: 1, essence: 0, breakthrough: 0, count: 1, firstAt: nowKstIso(t) };
    return { isNew: true, essence: 0, tickets: 0, breakthrough: 0 };
  }
  entry.count += 1;
  const got = grantDuplicate(save, char, balance);
  return { isNew: false, ...got, breakthrough: entry.breakthrough };
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
      b.rarity - a.rarity ||
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
