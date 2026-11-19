// 밸런스 시뮬레이션: 같은 팀으로 시드 1..N 자동 전투 → 승률, 평균 라운드, 캐릭터별 피해
import { createBattle } from './engine.js';

/** 전투 한 판 (자동) → summary */
export function runOne({ team, stage, data, seed }) {
  const battle = createBattle({ team, stage, data, seed });
  battle.runToEnd();
  return battle.summary();
}

/** 여러 판 결과 합치기 */
export function aggregate(summaries) {
  const n = summaries.length || 1;
  const wins = summaries.filter((s) => s.result === 'win');
  const per = new Map();
  for (const s of summaries) {
    for (const u of s.units) {
      const p = per.get(u.uid) || { uid: u.uid, refId: u.refId, name: u.name, dealt: 0, healed: 0, shielded: 0, taken: 0, survived: 0 };
      p.dealt += u.dealt;
      p.healed += u.healed;
      p.shielded += u.shielded;
      p.taken += u.taken;
      if (u.alive) p.survived += 1;
      per.set(u.uid, p);
    }
  }
  const avg = (v) => Math.round(v / n);
  return {
    runs: summaries.length,
    wins: wins.length,
    winRate: summaries.length ? wins.length / summaries.length : 0,
    timeouts: summaries.filter((s) => s.reason === 'timeout').length,
    avgRoundsWin: wins.length ? Math.round((wins.reduce((a, s) => a + s.rounds, 0) / wins.length) * 10) / 10 : null,
    avgRounds: Math.round((summaries.reduce((a, s) => a + s.rounds, 0) / n) * 10) / 10,
    units: [...per.values()].map((p) => ({ ...p, dealt: avg(p.dealt), healed: avg(p.healed), shielded: avg(p.shielded), taken: avg(p.taken), surviveRate: p.survived / n })),
  };
}

/** 한 번에 전부 (콘솔용). 화면에서는 runOne을 나눠서 부르세요 */
export function simulate({ team, stage, data, runs = 200, seedStart = 1 }) {
  const out = [];
  for (let i = 0; i < runs; i++) out.push(runOne({ team, stage, data, seed: seedStart + i }));
  return aggregate(out);
}
