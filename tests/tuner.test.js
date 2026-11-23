// 적 아키타입(tools/enemygen) + 기대 성장 · 자동 튜너 · 평가(tools/balance) — 개발 도구 전용 (게임은 안 씀)
import { describe, it, expect } from './lib/runner.js';
import { loadGameData } from './lib/gameData.js';
import { ENEMY_TEMPLATES, ENEMY_BOOTSTRAP } from '../tools/enemygen/archetypes.js';
import { regenerateEnemy, regenerateStage, stageTypeOf, expectedLevel } from '../tools/enemygen/generate.js';
import { expectedState, referenceTeam, expectedPower, stageIndexOf } from '../tools/balance/expected.js';
import { tuneStage, winRateAt } from '../tools/balance/tuner.js';
import { evaluateGear } from '../tools/balance/evaluate.js';
import { ENEMY_ARCHETYPES } from '../js/config.js';

const data = await loadGameData();
data.chapters ||= [];
const B = data.balance;

describe('적 아키타입', () => {
  it('8종 모두 템플릿, 기존 적 11종 배정', () => {
    expect(Object.keys(ENEMY_TEMPLATES).sort()).toEqual([...ENEMY_ARCHETYPES].sort());
    for (const e of data.enemies) expect(ENEMY_BOOTSTRAP[e.id], e.id).toBe(e.archetype);
  });
  it('다시 계산: id · 이름 · 행동 이름 · 아이콘 · 페이즈 이름 유지, 용어집 경고 없음, 같은 입력 = 같은 결과', () => {
    for (const e of data.enemies) {
      const a = regenerateEnemy(e, e.archetype, B, data.vocab);
      expect(a.issues, e.id).toEqual([]);
      expect(Object.keys(a.enemy.actions)).toEqual(Object.keys(e.actions));
      for (const [id, act] of Object.entries(e.actions)) expect([a.enemy.actions[id].name, a.enemy.actions[id].icon], `${e.id}.${id}`).toEqual([act.name, act.icon]);
      for (const [i, ph] of (e.phases || []).entries()) expect(a.enemy.phases[i].name).toBe(ph.name);
      expect(JSON.stringify(regenerateEnemy(e, e.archetype, B, data.vocab))).toBe(JSON.stringify(a));
    }
  });
  it('능력치 = balance.enemy.base × 아키타입 배율', () => {
    const boss = data.enemies.find((e) => e.archetype === 'boss');
    expect(boss.stats.hp).toBe(Math.round(B.enemy.base.hp * B.enemy.archetypes.boss.hp));
    expect(boss.stats.effectRes).toBe(B.enemy.archetypes.boss.effectRes);
  });
  it('보스 큰 공격 = 차지 토큰 (예고도 big)', () => {
    const boss = data.enemies.find((e) => e.archetype === 'boss');
    const ult = boss.actions.ultimate;
    expect(ult.big).toBe(true);
    expect(ult.effects[0].type).toBe('charge');
  });
});

describe('스테이지 다시 계산', () => {
  it('적 레벨 = 기대 레벨 곡선, 종류 = 보스/정예/일반', () => {
    data.stages.forEach((st, i) => {
      expect(st.waves.flat().every((w) => w.level === expectedLevel(stageIndexOf(st.id, data.chapters), B)), st.id).toBe(true);
      expect(st.stageType, st.id).toBe(stageTypeOf(st, data.enemyMap));
      void i;
    });
    const raw = { id: 'x', waves: [[{ enemyId: data.enemies[0].id, level: 99 }]] };
    expect(regenerateStage(raw, 5, data.enemyMap, B).waves[0][0].level).toBe(expectedLevel(5, B));
  });
  it('실제 데이터: 모든 스테이지에 튜너 난이도(0.2~6)와 추천 전투력(= 기대 전투력)', () => {
    for (const st of data.stages) {
      expect(st.difficulty >= B.tuner.difficulty.min && st.difficulty <= B.tuner.difficulty.max, st.id).toBe(true);
      expect(st.recommendedPower, st.id).toBe(expectedPower(st, data));
    }
  });
});

describe('기대 성장 · 튜너', () => {
  it('기대 상태: 레벨 곡선 · 지역 티어 장비 · 역할 섞인 기준 팀 5명', () => {
    const last = data.stageMap.get(data.chapters.at(-1).stageIds.at(-1));
    const s = expectedState(last, data);
    expect(s.level).toBe(expectedLevel(data.stages.length - 1, B));
    expect(s.gear.tier).toBe(Math.min(B.gear.tiers, data.chapters.length));
    const team = referenceTeam(last, data);
    expect(team.length).toBe(5);
    expect(team.some((m) => data.charMap.get(m.charId).role === 'defender')).toBe(true);
    expect(team.every((m) => m.extras.gear && m.level === s.level)).toBe(true);
  });
  it('승률은 난이도가 오르면 줄어듦, 튜닝은 결정론 (같은 시드 묶음)', () => {
    const st = data.stages[0];
    const team = referenceTeam(st, data);
    const easy = winRateAt(st, 0.3, team, data, 20).winRate;
    const hard = winRateAt(st, 6, team, data, 20).winRate;
    expect(easy >= hard).toBe(true);
    const a = tuneStage(st, data, { runs: 20 });
    const b = tuneStage(st, data, { runs: 20 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.history.length <= B.tuner.maxIter).toBe(true);
  });
  it('장비 곡선 평가: 지역마다 기대 파밍 횟수', () => {
    const g = evaluateGear(data, { runs: 5 });
    expect(g.length).toBe(data.chapters.length);
    expect(g.every((x) => x.expectedRuns > 0)).toBe(true);
  });
});
