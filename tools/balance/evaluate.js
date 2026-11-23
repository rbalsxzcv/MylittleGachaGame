// 밸런스 평가 (순수 계산, AI 없음) — 보고서용
//  - 캐릭터: 교체 테스트 (기준 팀에 꼭 넣고 돌0 / 돌6, 일반 추억 / 전용 추억) → 승률 · 기여 → 티어 표
//  - 추억: 교체 테스트 (기준 팀 첫 딜러의 추억만 바꿈)
//  - 장비: 지역 티어 곡선 — 티어 업그레이드 한 번(4칸 모두 지역 티어)에 필요한 기대 파밍 횟수, 한 단계 낮은 장비로 지역 첫 스테이지 승률
//  - 조합: 무작위 팀 몬테카를로 → 상위 1% 이상치
import { runOne } from '../../js/battle/sim.js';
import { createRng } from '../../js/core/rng.js';
import { referenceTeam, expectedState, expectedMember } from './expected.js';
import { memoryPassives } from '../../js/systems/memories.js';
import { dropTable, chapterOf } from '../../js/systems/gear.js';
import { GEAR_SLOTS } from '../../js/config.js';

function battleStats(stage, team, data, runs, seedStart = 1, focus = null) {
  let wins = 0;
  let rounds = 0;
  let share = 0;
  for (let i = 0; i < runs; i++) {
    const s = runOne({ team, stage, data, seed: seedStart + i });
    if (s.result === 'win') wins += 1;
    rounds += s.rounds;
    if (focus) {
      const total = s.units.reduce((a, u) => a + u.dealt + u.healed + u.shielded, 0) || 1;
      const me = s.units.find((u) => u.refId === focus);
      share += me ? (me.dealt + me.healed + me.shielded) / total : 0;
    }
  }
  return { winRate: wins / runs, avgRounds: Math.round((rounds / runs) * 10) / 10, share: focus ? share / runs : null };
}

/** 평가할 스테이지: 챕터마다 마지막(보스) 스테이지 */
const bossStages = (data) => data.chapters.map((ch) => data.stageMap.get(ch.stageIds.at(-1))).filter(Boolean);

/** 캐릭터 교체 테스트 → [{id, name, rarity, archetype, bt0, bt6, sigDelta?, score}] (점수 높은 순) */
export function evaluateCharacters(data, { runs = 100 } = {}) {
  const out = [];
  const stages = bossStages(data);
  for (const c of data.characters.filter((x) => !x.retired)) {
    const row = { id: c.id, name: c.name, rarity: c.rarity, role: c.role, archetype: c.archetype || '-', bt0: [], bt6: [] };
    for (const st of stages) {
      const state = expectedState(st, data);
      for (const bt of [0, 6]) {
        const team = referenceTeam(st, data, { include: c.id, state }).map((m) => (m.charId === c.id ? { ...m, breakthrough: bt } : m));
        row[`bt${bt}`].push(battleStats(st, team, data, runs, 1, c.id));
      }
      // 5★: 전용 추억으로 바꿨을 때 (주인 보너스 포함)
      const sig = (data.memories || []).find((m) => m.signatureOf === c.id);
      if (sig) {
        const team = referenceTeam(st, data, { include: c.id, state }).map((m) => {
          if (m.charId !== c.id) return m;
          const inst = { lv: state.memory.level, r: 1 };
          return { ...m, extras: { ...m.extras, memory: { entity: sig, level: inst.lv, refine: 1 }, passives: memoryPassives(sig, inst, c.id, data.balance) } };
        });
        (row.sig ||= []).push(battleStats(st, team, data, runs, 1, c.id));
      }
    }
    const avg = (list, k) => list.reduce((a, x) => a + x[k], 0) / Math.max(1, list.length);
    row.bt0 = { winRate: avg(row.bt0, 'winRate'), share: avg(row.bt0, 'share') };
    row.bt6 = { winRate: avg(row.bt6, 'winRate'), share: avg(row.bt6, 'share') };
    if (row.sig) row.sig = { winRate: avg(row.sig, 'winRate'), share: avg(row.sig, 'share') };
    row.score = Math.round((row.bt0.winRate * 0.6 + row.bt0.share * 0.4) * 1000) / 10;
    out.push(row);
  }
  out.sort((a, b) => b.score - a.score);
  const tiers = ['S', 'A', 'B', 'C'];
  out.forEach((r, i) => (r.tier = tiers[Math.min(tiers.length - 1, Math.floor((i / out.length) * tiers.length))]));
  return out;
}

/** 추억 교체 테스트: 기준 팀의 첫 딜러(없으면 첫 칸) 추억만 바꿔서 → [{id, name, rarity, winRate, share}] */
export function evaluateMemories(data, { runs = 100 } = {}) {
  const st = bossStages(data).at(-1);
  const state = expectedState(st, data);
  const base = referenceTeam(st, data, { state });
  const slot = Math.max(0, base.findIndex((m) => data.charMap.get(m.charId)?.role === 'attacker'));
  const cid = base[slot].charId;
  return (data.memories || [])
    .map((mem) => {
      const inst = { lv: state.memory.level, r: 1 };
      const team = base.map((m, i) => (i === slot ? { ...m, extras: { ...m.extras, memory: { entity: mem, level: inst.lv, refine: 1 }, passives: memoryPassives(mem, inst, cid, data.balance) } } : m));
      return { id: mem.id, name: mem.name, rarity: mem.rarity, kind: mem.kind, holder: cid, ...battleStats(st, team, data, runs, 1, cid) };
    })
    .sort((a, b) => b.share - a.share);
}

/**
 * 장비 곡선: 지역마다 — 한 판 드롭에서 지역 티어 조각이 나올 기대 개수, 4칸 모두 지역 티어로 바꾸는 기대 판 수(쿠폰 수집),
 * 지역 첫 스테이지를 한 단계 낮은 장비로 / 지역 장비로 돌린 승률 (파밍이 필요한지)
 */
export function evaluateGear(data, { runs = 100 } = {}) {
  const out = [];
  for (const ch of data.chapters) {
    const first = data.stageMap.get(ch.stageIds[0]);
    const table = dropTable(first, data.chapters, data.balance);
    const top = table.tiers.at(-1);
    const perRun = table.count * top.p; // 지역 티어 조각 / 판
    // 4칸을 모두 모으는 기대 조각 수 = 4 × (1 + 1/2 + 1/3 + 1/4) (칸은 무작위)
    const pieces = GEAR_SLOTS.length * [1, 2, 3, 4].reduce((a, k) => a + 1 / k, 0);
    const state = expectedState(first, data);
    const at = (tier) => {
      const team = referenceTeam(first, data, { state: { ...state, gear: { tier, enh: 0 } } });
      return battleStats(first, team, data, runs).winRate;
    };
    out.push({
      chapter: ch.id,
      regionTier: top.tier,
      piecesPerRun: Math.round(perRun * 100) / 100,
      expectedRuns: Math.round((pieces / Math.max(0.01, perRun)) * 10) / 10,
      winWithPrevTier: top.tier > 1 ? at(top.tier - 1) : null,
      winWithRegionTier: at(top.tier),
    });
  }
  return out;
}

/** 조합 몬테카를로: 무작위 5명 팀 N개 × 마지막 보스 → 상위 1% (승률 → 라운드) */
export function comboSearch(data, { teams = 200, runs = 30, seed = 1 } = {}) {
  const rng = createRng(seed);
  const st = bossStages(data).at(-1);
  const state = expectedState(st, data);
  const pool = data.characters.filter((c) => !c.retired);
  const seen = new Set();
  const results = [];
  for (let t = 0; t < teams * 3 && results.length < teams; t++) {
    const ids = [...pool].sort(() => rng() - 0.5).slice(0, 5).map((c) => c.id).sort();
    const key = ids.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const team = ids.map((id) => expectedMember(data.charMap.get(id), state, data));
    results.push({ team: ids, ...battleStats(st, team, data, runs) });
  }
  results.sort((a, b) => b.winRate - a.winRate || a.avgRounds - b.avgRounds);
  const n = Math.max(1, Math.ceil(results.length * 0.01));
  return { stage: st.id, tested: results.length, top: results.slice(0, n), median: results[Math.floor(results.length / 2)] || null };
}

/** 평가 묶음 → Markdown */
export function evalReport({ characters, memories, gear, combos }) {
  const pct = (x) => (x == null ? '-' : `${Math.round(x * 1000) / 10}%`);
  const L = ['# 밸런스 평가 보고서', ''];
  if (characters) {
    L.push('## 캐릭터 티어 (교체 테스트, 챕터 보스 스테이지 평균)', '', '| 티어 | 캐릭터 | ★ | 역할 | 아키타입 | 돌0 승률 · 기여 | 돌6 승률 · 기여 | 전용 추억 |', '|---|---|---|---|---|---|---|---|');
    for (const r of characters) L.push(`| ${r.tier} | ${r.name} (${r.id}) | ${r.rarity} | ${r.role} | ${r.archetype} | ${pct(r.bt0.winRate)} · ${pct(r.bt0.share)} | ${pct(r.bt6.winRate)} · ${pct(r.bt6.share)} | ${r.sig ? `${pct(r.sig.winRate)} · ${pct(r.sig.share)}` : '-'} |`);
    L.push('');
  }
  if (memories) {
    L.push(`## 추억 교체 테스트 (장착: ${memories[0]?.holder || '-'})`, '', '| 추억 | ★ | 종류 | 승률 | 기여 |', '|---|---|---|---|---|');
    for (const m of memories) L.push(`| ${m.name} (${m.id}) | ${m.rarity} | ${m.kind} | ${pct(m.winRate)} | ${pct(m.share)} |`);
    L.push('');
  }
  if (gear) {
    L.push('## 장비 티어 곡선', '', '| 지역 | 지역 티어 | 지역 티어 조각/판 | 4칸 교체 기대 판 수 | 첫 스테이지 승률 (티어−1 / 지역 티어) |', '|---|---|---|---|---|');
    for (const g of gear) L.push(`| ${g.chapter} | T${g.regionTier} | ${g.piecesPerRun} | ${g.expectedRuns} | ${pct(g.winWithPrevTier)} / ${pct(g.winWithRegionTier)} |`);
    L.push('');
  }
  if (combos) {
    L.push(`## 조합 몬테카를로 (${combos.stage}, ${combos.tested}팀)`, '', '상위 1%:', ...combos.top.map((t) => `- ${t.team.join(', ')} — 승률 ${pct(t.winRate)}, ${t.avgRounds}라운드`), combos.median ? `- (중앙값: 승률 ${pct(combos.median.winRate)}, ${combos.median.avgRounds}라운드)` : '', '');
  }
  return L.join('\n') + '\n';
}
