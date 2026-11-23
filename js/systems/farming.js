// 스테이지 클리어 처리 한 곳: 별점 + 보상(stageProgress) + 장비 드롭 — 스토리 전투 · 반복 전투 · 소탕이 같이 씀
// 반복 전투 = 렌더 없이 엔진만(sim.runOne + AUTO), 지면 멈춤. 소탕 = ★3 스테이지만, 전투 없이 보상 + 드롭. 스태미나 없음
import { recordClear, stageRecord } from './stageProgress.js';
import { dropTable, rollDrops, grantDrops, starsOf } from './gear.js';
import { runOne } from '../battle/sim.js';

/**
 * 승리 한 번 반영 → { rewards, first, stars, drops }
 * @param {{save, data}} ctx
 * @param {()=>number} rand 드롭 굴리기 (화면은 Math.random, 테스트는 시드)
 */
export function clearStage(ctx, stage, summary, rand) {
  const stars = starsOf(summary, stage, ctx.data.balance);
  const r = recordClear(ctx.save, stage, summary.rounds);
  const rec = ctx.save.stages[stage.id];
  rec.stars = Math.max(rec.stars || 0, stars);
  const drops = rollDrops(dropTable(stage, ctx.data.chapters, ctx.data.balance), rand);
  grantDrops(ctx.save, drops);
  return { ...r, stars, drops };
}

/** 소탕 가능한지 (★3 기록) */
export const canSweep = (save, stageId) => (stageRecord(save, stageId).stars || 0) >= 3;

/** 결과 여러 개 합치기 → { runs, wins, pieces: {'칸.티어': n}, gearMat, rewards } */
export function mergeResults(list) {
  const out = { runs: list.length, wins: 0, pieces: {}, gearMat: 0, rewards: {} };
  for (const r of list) {
    if (!r) continue;
    out.wins += 1;
    out.gearMat += r.drops.gearMat;
    for (const p of r.drops.pieces) out.pieces[`${p.slot}.${p.tier}`] = (out.pieces[`${p.slot}.${p.tier}`] || 0) + 1;
    for (const src of [r.rewards, r.first]) for (const [k, v] of Object.entries(src || {})) if (v) out.rewards[k] = (out.rewards[k] || 0) + v;
  }
  return out;
}

/**
 * 반복 전투 N회 (헤드리스 AUTO). 지면 거기서 멈춤
 * @returns {{results:Array, lost:boolean, merged:object}}
 */
export function repeatBattle(ctx, stage, team, n, rand) {
  const runs = Math.max(1, Math.min(ctx.data.balance.repeat.maxRuns, n));
  const results = [];
  let lost = false;
  for (let i = 0; i < runs; i++) {
    const seed = Math.floor(rand() * 2 ** 31) + 1;
    const summary = runOne({ team, stage, data: ctx.data, seed });
    if (summary.result !== 'win') {
      lost = true;
      break;
    }
    results.push(clearStage(ctx, stage, summary, rand));
  }
  return { results, lost, merged: mergeResults(results) };
}

/** 소탕 N회: ★3 스테이지만, 전투 없이 (별점은 그대로) */
export function sweep(ctx, stage, n, rand) {
  if (!canSweep(ctx.save, stage.id)) return null;
  const runs = Math.max(1, Math.min(ctx.data.balance.repeat.maxRuns, n));
  const best = stageRecord(ctx.save, stage.id).bestRounds || 1;
  const results = [];
  for (let i = 0; i < runs; i++) results.push(clearStage(ctx, stage, { result: 'win', rounds: best, units: [] }, rand));
  return { results, merged: mergeResults(results) };
}
