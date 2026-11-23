// 자동 튜너 (순수 계산, AI 없음): 스테이지마다 기준 팀(expected.referenceTeam)으로 시드 N판 AUTO 전투 →
// difficulty(적 공격/HP 배율)를 이분 탐색해서 목표 승률(balance.tuner.targetWinRate[stageType]) ± tolerance에 맞춤
// 승률은 difficulty가 오를수록 줄어든다고 보고 로그 공간에서 이분 탐색 (같은 시드 묶음 → 결정론)
import { runOne } from '../../js/battle/sim.js';
import { referenceTeam } from './expected.js';

/** 이 팀 · 스테이지 · difficulty로 시드 1..runs 승률 + 평균 라운드 */
export function winRateAt(stage, difficulty, team, data, runs, seedStart = 1) {
  const st = { ...stage, difficulty };
  let wins = 0;
  let rounds = 0;
  for (let i = 0; i < runs; i++) {
    const s = runOne({ team, stage: st, data, seed: seedStart + i });
    if (s.result === 'win') wins += 1;
    rounds += s.rounds;
  }
  return { winRate: wins / runs, avgRounds: Math.round((rounds / runs) * 10) / 10 };
}

/**
 * 스테이지 하나 튜닝
 * @returns {{stageId, stageType, target, difficulty, winRate, avgRounds, iterations, ok, history:Array<{difficulty, winRate}>}}
 */
export function tuneStage(stage, data, opts = {}) {
  const T = data.balance.tuner;
  const runs = opts.runs ?? T.runs;
  const target = T.targetWinRate[stage.stageType || 'normal'] ?? T.targetWinRate.normal;
  const team = opts.team || referenceTeam(stage, data);
  let lo = T.difficulty.min;
  let hi = T.difficulty.max;
  const history = [];
  let best = null;
  let d = Math.min(hi, Math.max(lo, stage.difficulty || 1));
  for (let it = 0; it < T.maxIter; it++) {
    const r = winRateAt(stage, d, team, data, runs);
    history.push({ difficulty: Math.round(d * 1000) / 1000, winRate: r.winRate });
    if (!best || Math.abs(r.winRate - target) < Math.abs(best.winRate - target)) best = { difficulty: d, ...r };
    if (Math.abs(r.winRate - target) <= T.tolerance) break;
    if (r.winRate > target) lo = d;
    else hi = d;
    d = Math.sqrt(lo * hi);
  }
  return {
    stageId: stage.id,
    name: stage.name,
    stageType: stage.stageType || 'normal',
    target,
    difficulty: Math.round(best.difficulty * 1000) / 1000,
    winRate: best.winRate,
    avgRounds: best.avgRounds,
    iterations: history.length,
    ok: Math.abs(best.winRate - target) <= T.tolerance,
    team: team.map((m) => m.charId),
    history,
  };
}

/** 전체 스테이지 일괄 (onProgress(i, n, result)) */
export function tuneAll(data, opts = {}, onProgress = () => {}) {
  const stages = data.stages.filter((s) => !s.retired);
  const out = [];
  stages.forEach((st, i) => {
    const r = tuneStage(st, data, opts);
    out.push(r);
    onProgress(i + 1, stages.length, r);
  });
  return out;
}

/** 튜닝 결과 → Markdown 보고서 */
export function tuneReport(results, balance) {
  const lines = [
    '# 자동 튜너 보고서',
    '',
    `목표 승률: 일반 ${balance.tuner.targetWinRate.normal * 100}% · 정예 ${balance.tuner.targetWinRate.elite * 100}% · 보스 ${balance.tuner.targetWinRate.boss * 100}% (±${balance.tuner.tolerance * 100}%), 판 수 ${balance.tuner.runs}`,
    '',
    '| 스테이지 | 종류 | 난이도 | 승률 | 목표 | 평균 라운드 | 탐색 | 기준 팀 |',
    '|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.stageId} ${r.name || ''} | ${r.stageType} | ×${r.difficulty} | ${Math.round(r.winRate * 1000) / 10}% ${r.ok ? '' : '⚠'} | ${r.target * 100}% | ${r.avgRounds} | ${r.iterations} | ${r.team.join(', ')} |`),
    '',
    `목표 안: ${results.filter((r) => r.ok).length}/${results.length}`,
  ];
  return lines.join('\n') + '\n';
}
