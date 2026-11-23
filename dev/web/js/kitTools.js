// 키트 도구: 생성기(/preview/tools/kitgen) 불러오기 + 예산 + 빠른 시뮬 — 캐릭터 전투 편집기와 '키트 일괄' 탭이 같이 씀
import { state } from './state.js';
import { loadBattleKit, cleanEntity } from './battleForm.js';

let gen = null;
let sim = null;

/** 생성기 모듈 + 게임 모듈 */
export async function loadKitTools() {
  const kitMods = await loadBattleKit();
  if (!gen) [gen, sim] = await Promise.all([import('/preview/tools/kitgen/generate.js'), import('/preview/js/battle/sim.js')]);
  const balance = kitMods.progression.validateBalance(state.data.balance, kitMods.vocab, () => {});
  return { ...kitMods, gen, sim, balance };
}

/** 작업 공간 데이터 → 게임과 같은 모양 (override: 아직 저장 안 한 캐릭터 하나를 바꿔 끼움) */
export function gameDataWith(kt, override = null) {
  const chars = state.data.characters.map((c) => cleanEntity(override && c.id === override.id ? { ...c, ...override } : c));
  const enemies = state.data.enemies.map((e) => cleanEntity(e, { enemy: true }));
  const stages = kt.data.validateStages(state.data.stages);
  return { balance: kt.balance, characters: chars, stages, charMap: new Map(chars.map((c) => [c.id, c])), enemyMap: new Map(enemies.map((e) => [e.id, e])) };
}

/** 빠른 시뮬 팀: 이 캐릭터 + 다른 역할 4명 (탱커/치유/지원/딜러를 채움, 키트가 있는 캐릭터 우선) */
export function quickTeam(data, charId, { level = 20, breakthrough = 2 } = {}) {
  const me = data.charMap.get(charId);
  const pool = data.characters.filter((c) => c.pullable && c.id !== charId).sort((a, b) => (b.kit?.basic ? 1 : 0) - (a.kit?.basic ? 1 : 0) || b.rarity - a.rarity || a.id.localeCompare(b.id));
  const pickRole = (role, taken) => pool.find((c) => c.role === role && !taken.includes(c.id));
  const ids = [charId];
  for (const role of ['defender', 'healer', 'support', 'attacker', 'attacker']) {
    if (ids.length >= 5) break;
    if (role === me?.role && role !== 'attacker') continue;
    const c = pickRole(role, ids);
    if (c) ids.push(c.id);
  }
  for (const c of pool) if (ids.length < 5 && !ids.includes(c.id)) ids.push(c.id);
  return ids.map((id) => ({ charId: id, level, breakthrough }));
}

/**
 * 빠른 시뮬: 챕터마다 마지막(보스) 스테이지 × 시드 N → 승률 + 이 캐릭터 몫
 * @returns {Array<{stage, winRate, avgRounds, share}>}
 */
export function quickSim(kt, data, charId, { runs = 20, level = 20, breakthrough = 2 } = {}) {
  const team = quickTeam(data, charId, { level, breakthrough });
  const byChapter = new Map();
  const chapterOf = new Map((state.data.stages || []).map((s) => [s.id, s.chapter || 'ch01']));
  for (const st of data.stages) if (!st.retired) byChapter.set(chapterOf.get(st.id) || 'ch01', st); // 챕터마다 마지막 스테이지
  const out = [];
  for (const stage of byChapter.values()) {
    const res = kt.sim.simulate({ team, stage, data, runs, seedStart: 1 });
    const me = res.units?.find((u) => u.refId === charId);
    const total = (res.units || []).reduce((s, u) => s + (u.dealt || 0) + (u.healed || 0) + (u.shielded || 0), 0);
    const mine = me ? (me.dealt || 0) + (me.healed || 0) + (me.shielded || 0) : 0;
    out.push({ stage, winRate: res.winRate, avgRounds: res.avgRounds, share: total ? mine / total : 0 });
  }
  return out;
}

/** 예산 보고 → 짧은 글자 (칸 ±%) */
export function budgetLine(budget) {
  return Object.entries(budget || {})
    .map(([k, b]) => `${k} ${b.pct}%${b.ok ? '' : '⚠'}`)
    .join(' · ');
}
