// 전투 엔진: js/battle/selftest.js의 검사를 테스트 하나씩으로 + 실제 데이터 결정론
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { runSelfTest } from '../js/battle/selftest.js';
import { loadGameData } from './lib/gameData.js';

const vocab = await loadJson('js/battle/vocab.json');

async function realExtra() {
  const data = await loadGameData();
  const team = data.characters.filter((c) => c.pullable).slice(0, 5).map((c) => ({ charId: c.id, level: 15, breakthrough: 0 }));
  // 보스가 있는 마지막 스테이지 (페이즈/광폭화까지 지나가도록)
  const stage = data.stages.at(-1);
  return { team, stage, data };
}

const report = runSelfTest(vocab, await realExtra());

describe('전투 엔진 (selftest)', () => {
  for (const r of report.results) {
    it(r.name, () => {
      if (!r.ok) throw new Error(r.detail);
    });
  }
  it('검사 개수 (실제 데이터 검사 포함)', () => {
    expect(report.results.length).toBeGreaterThanOrEqual(20);
  });
});
