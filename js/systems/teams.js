// 편성: 프리셋 3개 × 5칸. 전투에 들어갈 때는 '사용 중' 프리셋을 씀
import { TEAM_SIZE } from '../core/save.js';
import { charPower } from './progression.js';
import { memoryExtras } from './memories.js';

/**
 * 캐릭터 한 명의 장착품 → 능력치/전투에 넘길 extras { memory, passives, gear }
 * (statsOf · charPower · createBattle 멤버가 같이 씀)
 */
export function extrasOf(ctx, charId) {
  return { ...memoryExtras(ctx.save, ctx.data, charId) };
}

/** 보유 캐릭터 하나의 전투력 (장착품 포함) */
export const ownedPower = (ctx, c) => charPower(c, ctx.save.owned[c.id], ctx.data.balance, extrasOf(ctx, c.id));

export function activeIndex(save) {
  return save.teams.active;
}

export function presetOf(save, i = save.teams.active) {
  return save.teams.presets[i];
}

export function setActive(save, i) {
  if (i >= 0 && i < save.teams.presets.length) save.teams.active = i;
}

export function renamePreset(save, i, name) {
  const n = String(name || '').trim().slice(0, 12);
  if (n) save.teams.presets[i].name = n;
}

/**
 * 칸에 캐릭터 넣기 (null이면 비우기). 같은 프리셋의 다른 칸에 이미 있으면 두 칸을 맞바꿈
 */
export function setSlot(save, presetIdx, slot, charId) {
  const slots = save.teams.presets[presetIdx].slots;
  if (slot < 0 || slot >= TEAM_SIZE) return;
  if (charId) {
    const other = slots.indexOf(charId);
    if (other >= 0 && other !== slot) slots[other] = slots[slot];
  }
  slots[slot] = charId || null;
}

/** 전투에 넣을 멤버 (보유하지 않았거나 데이터에 없는 캐릭터는 빈 칸) */
export function teamMembers(ctx, i = ctx.save.teams.active) {
  return presetOf(ctx.save, i).slots.map((id) => {
    const entry = id && ctx.save.owned[id];
    if (!entry || !ctx.data.charMap.has(id)) return null;
    return { charId: id, level: entry.level, breakthrough: entry.breakthrough, extras: extrasOf(ctx, id) };
  });
}

export function teamPower(ctx, i = ctx.save.teams.active) {
  return teamMembers(ctx, i).reduce((sum, m) => (m ? sum + ownedPower(ctx, ctx.data.charMap.get(m.charId)) : sum), 0);
}

export function teamSize(ctx, i) {
  return teamMembers(ctx, i).filter(Boolean).length;
}

/** 보유 캐릭터 중 전투력 상위 5명 (편성이 비었을 때 미리보기용) */
export function bestTeam(ctx) {
  const owned = ctx.data.characters.filter((c) => ctx.save.owned[c.id] && c.pullable !== false);
  owned.sort((a, b) => ownedPower(ctx, b) - ownedPower(ctx, a));
  return owned.slice(0, TEAM_SIZE).map((c) => ({ charId: c.id, level: ctx.save.owned[c.id].level, breakthrough: ctx.save.owned[c.id].breakthrough, extras: extrasOf(ctx, c.id) }));
}

