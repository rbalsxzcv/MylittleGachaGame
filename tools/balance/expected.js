// 기대 성장 (밸런스 툴킷): 스테이지마다 '그때쯤 플레이어 상태' 가정 → 기준 팀 + expectedPower
// 숫자는 balance.expected (레벨 곡선, 희귀도별 돌파, 추억), 장비는 지역 티어 + 지역 안 순서 × gearEnhPerStage
import { charPower } from '../../js/systems/progression.js';
import { memoryPassives } from '../../js/systems/memories.js';
import { regionTier, chapterOf } from '../../js/systems/gear.js';
import { GEAR_SLOTS, normalizeRarity, isNpc } from '../../js/config.js';
import { expectedLevel } from '../enemygen/generate.js';

/** 스테이지 전체 순서 (챕터 순서대로) */
export function stageIndexOf(stageId, chapters) {
  let i = 0;
  for (const ch of chapters) {
    for (const id of ch.stageIds) {
      if (id === stageId) return i;
      i += 1;
    }
  }
  return 0;
}

/** 이 스테이지에서 기대하는 플레이어 상태 */
export function expectedState(stage, data) {
  const B = data.balance;
  const E = B.expected;
  const index = stageIndexOf(stage.id, data.chapters);
  const ch = chapterOf(stage.id, data.chapters);
  const level = expectedLevel(index, B);
  const caps = E.maxRarityByChapter?.length ? E.maxRarityByChapter : [5];
  return {
    index,
    level,
    maxRarity: caps[Math.min(ch.index, caps.length - 1)],
    // 돌파는 처음엔 0 → breakthroughRamp 스테이지에 걸쳐 희귀도별 가정값까지 (중복은 뽑기를 하면서 모이므로)
    breakthrough: (rarity) => Math.round((E.breakthrough[normalizeRarity(rarity) || 3] ?? 0) * Math.min(1, index / Math.max(1, E.breakthroughRamp))),
    memory: { rarity: E.memory.rarity, level: Math.max(1, Math.min(B.memory.maxLevel, Math.round(level * E.memory.levelRatio))), refine: E.memory.refine },
    gear: expectedGear(ch, data),
  };
}

/** 기대 장비: 지역 안 gearFromPosition번째부터 지역 티어, 그 전은 이전 지역 티어(그 지역 끝까지 강화한 만큼), 첫 지역 초반은 없음 */
function expectedGear(ch, data) {
  const B = data.balance;
  const E = B.expected;
  const enhAt = (pos) => Math.min(B.gear.maxEnh, Math.floor(pos * E.gearEnhPerStage));
  const tier = regionTier(ch.id, ch.index, B);
  if (ch.position >= E.gearFromPosition) return { tier, enh: enhAt(ch.position - E.gearFromPosition) };
  if (ch.index === 0 || tier <= 1) return null;
  const prev = data.chapters[ch.index - 1];
  return { tier: regionTier(prev.id, ch.index - 1, B), enh: enhAt(Math.max(0, prev.stageIds.length - E.gearFromPosition)) };
}

/** 기대 상태의 멤버 하나 {charId, level, breakthrough, extras} — 추억은 역할 기본(없으면 기대 희귀도 아무거나), 장비는 4칸 모두 */
export function expectedMember(c, state, data) {
  const mems = data.memories || [];
  const mem = mems.find((m) => m.kind === 'default' && m.role === c.role) || mems.find((m) => m.rarity === state.memory.rarity) || null;
  const inst = mem ? { lv: state.memory.level, r: state.memory.refine } : null;
  const gear = state.gear ? Object.fromEntries(GEAR_SLOTS.map((s) => [s, { tier: state.gear.tier, enh: state.gear.enh }])) : null;
  const extras = { ...(gear ? { gear } : {}), ...(mem ? { memory: { entity: mem, level: inst.lv, refine: inst.r }, passives: memoryPassives(mem, inst, c.id, data.balance) } : {}) };
  return { charId: c.id, level: state.level, breakthrough: state.breakthrough(c.rarity), extras };
}

/**
 * 기준 팀: 쓸 수 있는 캐릭터(뽑기 대상, 공개됨) 중 역할 섞기 — 탱커 1 · 치유/지원 1 → 나머지는 기대 전투력 순 (5명)
 * @param {object} [o] { exclude: 뺄 캐릭터 id, include: 꼭 넣을 캐릭터 id }
 */
export function referenceTeam(stage, data, { exclude = null, include = null, state = expectedState(stage, data) } = {}) {
  // 그때쯤 가졌을 법한 캐릭터: 최고 희귀도 제한 (꼭 넣을 캐릭터는 예외)
  const pool = data.characters.filter((c) => !isNpc(c) && !c.retired && c.id !== exclude && (c.id === include || (normalizeRarity(c.rarity) || 3) <= (state.maxRarity ?? 5)));
  const power = (c) => charPower(c, { level: state.level, breakthrough: state.breakthrough(c.rarity) }, data.balance, expectedMember(c, state, data).extras);
  const sorted = [...pool].sort((a, b) => power(b) - power(a) || a.id.localeCompare(b.id));
  const team = [];
  const take = (c) => c && !team.includes(c) && team.length < 5 && team.push(c);
  if (include) take(pool.find((c) => c.id === include));
  if (!team.some((c) => c.role === 'defender')) take(sorted.find((c) => c.role === 'defender' && (normalizeRarity(c.rarity) || 3) >= 3)); // 1·2★ 탱커는 억지로 안 넣음
  if (!team.some((c) => c.role === 'healer' || c.role === 'support')) take(sorted.find((c) => c.role === 'healer') || sorted.find((c) => c.role === 'support'));
  for (const c of sorted) take(c);
  return team.map((c) => expectedMember(c, state, data));
}

/** 기대 전투력 = 기준 팀 전투력 합 */
export function expectedPower(stage, data) {
  return referenceTeam(stage, data).reduce((sum, m) => sum + charPower(data.charMap.get(m.charId), m, data.balance, m.extras), 0);
}
