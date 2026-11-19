// 편성: 프리셋 3개 × 5칸. 전투에 들어갈 때는 '사용 중' 프리셋을 씀
import { TEAM_SIZE } from '../core/save.js';
import { charPower } from './progression.js';

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
    return { charId: id, level: entry.level, breakthrough: entry.breakthrough };
  });
}

export function teamPower(ctx, i = ctx.save.teams.active) {
  return teamMembers(ctx, i).reduce((sum, m) => (m ? sum + charPower(ctx.data.charMap.get(m.charId), ctx.save.owned[m.charId], ctx.data.balance) : sum), 0);
}

export function teamSize(ctx, i) {
  return teamMembers(ctx, i).filter(Boolean).length;
}
