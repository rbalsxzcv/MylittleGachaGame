// 적 아키타입(tools/enemygen) + 기대 성장 · 자동 튜너 · 평가(tools/balance) — 개발 도구 전용 (게임은 안 씀)
import { describe, it, expect } from './lib/runner.js';
import { loadGameData } from './lib/gameData.js';
import { ENEMY_TEMPLATES, ENEMY_BOOTSTRAP } from '../tools/enemygen/archetypes.js';
import { regenerateEnemy, regenerateStage, stageTypeOf, expectedLevelOf, expectedLevelIn, chapterSlot, padWave } from '../tools/enemygen/generate.js';
import { expectedState, referenceTeam, expectedPower, recommendedPower, sawtoothRatio, teamAtPower, teamPower } from '../tools/balance/expected.js';
import { tuneStage, winRateAt, checkTargets, targetsFor } from '../tools/balance/tuner.js';
import { economyCheck } from '../tools/balance/economy.js';
import { evaluateGear } from '../tools/balance/evaluate.js';
import { ENEMY_ARCHETYPES, loadConfig } from '../js/config.js';

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
  it('적 레벨 = 기대 레벨(레벨 상한 경사), 종류 = 보스/정예/일반, 라운드 제한 = 종류별', () => {
    for (const st of data.stages) {
      expect(st.waves.flat().every((w) => w.level === expectedLevelOf(st.id, data.chapters, B, data.stageMap)), st.id).toBe(true);
      expect(st.stageType, st.id).toBe(stageTypeOf(st, data.enemyMap));
      expect(st.roundLimit, st.id).toBe(B.tuner.roundLimit[st.stageType]);
    }
    const raw = { id: 'x', waves: [[{ enemyId: data.enemies[0].id, level: 99 }]] };
    const re = regenerateStage(raw, 17, data.enemyMap, B);
    expect(re.waves[0][0].level).toBe(17);
    expect(re.waves[0].length).toBe(B.enemy.waveSize[re.stageType]);
    expect([re.difficulty, re.hpScale]).toEqual([1, 1]);
  });
  it('실제 데이터: 모든 스테이지에 튜너 배율(난이도 · HP 배율 범위 안)과 권장 전투력(= 기대 전투력 ÷ 톱니 비율)', () => {
    for (const st of data.stages) {
      expect(st.difficulty >= B.tuner.difficulty.min && st.difficulty <= B.tuner.difficulty.max, st.id).toBe(true);
      expect(st.hpScale >= B.tuner.hpScale.min && st.hpScale <= B.tuner.hpScale.max, st.id).toBe(true);
      expect(st.recommendedPower, st.id).toBe(recommendedPower(st, data));
    }
  });
});

describe('웨이브 채우기 (적 수로 압박)', () => {
  it('보스 아닌 적을 돌아가며 복제, 빼지 않음, 최대 6, 보스뿐이면 그대로', () => {
    const map = new Map([['a', { id: 'a' }], ['b', { id: 'b' }], ['B', { id: 'B', boss: true }]]);
    expect(padWave([{ enemyId: 'B' }, { enemyId: 'a' }, { enemyId: 'b' }], 5, map).map((x) => x.enemyId)).toEqual(['B', 'a', 'b', 'a', 'b']);
    expect(padWave([{ enemyId: 'a' }, { enemyId: 'b' }, { enemyId: 'a' }, { enemyId: 'b' }], 3, map).length).toBe(4);
    expect(padWave([{ enemyId: 'a' }], 9, map).length).toBe(6);
    expect(padWave([{ enemyId: 'B' }], 4, map).length).toBe(1);
  });
  it('실제 데이터: 웨이브마다 종류별 최소 인원 이상', () => {
    for (const st of data.stages) for (const w of st.waves) expect(w.length >= Math.min(6, B.enemy.waveSize[st.stageType]) || w.every((x) => data.enemyMap.get(x.enemyId)?.boss), st.id).toBe(true);
  });
});

describe('기대 레벨 = 레벨 상한 경사', () => {
  const cfg = loadConfig({});
  it('첫 챕터 levelStart → 상한(50) − capGap, 다음 챕터는 이전 끝 → 새 상한(60) − capGap', () => {
    expect(expectedLevelIn(0, 0, 12, cfg)).toBe(1);
    expect(expectedLevelIn(0, 11, 12, cfg)).toBe(45);
    expect(expectedLevelIn(1, 0, 12, cfg)).toBe(45);
    expect(expectedLevelIn(1, 11, 12, cfg)).toBe(55);
    expect(expectedLevelIn(2, 11, 12, cfg)).toBe(65);
    expect(expectedLevelIn(0, 0, 1, cfg)).toBe(45); // 스테이지 1개짜리 챕터 = 끝
  });
  it('은퇴 스테이지는 세지 않음, 챕터에 없는 스테이지는 예비 곡선', () => {
    const chapters = [{ id: 'ch01', stageIds: ['a', 'r', 'b'] }];
    const stageMap = new Map([['a', { id: 'a' }], ['r', { id: 'r', retired: true }], ['b', { id: 'b' }]]);
    expect(chapterSlot('b', chapters, stageMap)).toEqual({ c: 0, pos: 1, n: 2 });
    expect(expectedLevelOf('b', chapters, cfg, stageMap)).toBe(45);
    expect(expectedLevelOf('없음', chapters, cfg, stageMap)).toBe(cfg.expected.levelStart);
  });
  it('경제 표: 챕터마다 누적 비용 · 수입', () => {
    const rows = economyCheck(data);
    expect(rows.length).toBe(data.chapters.length);
    expect(rows.every((r, i) => i === 0 || r.incomeTickets > rows[i - 1].incomeTickets)).toBe(true);
    expect(rows[0].toLevel).toBe(B.level.cap.base - B.expected.capGap);
  });
});

describe('기대 성장 · 튜너', () => {
  it('기대 상태: 레벨 곡선 · 지역 티어 장비 · 역할 섞인 기준 팀 5명', () => {
    const last = data.stageMap.get(data.chapters.at(-1).stageIds.at(-1));
    const s = expectedState(last, data);
    expect(s.level).toBe(B.level.cap.base + B.level.cap.perChapter * (data.chapters.length - 1) - B.expected.capGap);
    expect(s.gear.tier).toBe(Math.min(B.gear.tiers, data.chapters.length));
    const team = referenceTeam(last, data);
    expect(team.length).toBe(5);
    expect(team.some((m) => data.charMap.get(m.charId).role === 'defender')).toBe(true);
    expect(team.every((m) => m.extras.gear && m.level === s.level)).toBe(true);
  });
  it('처치 턴: 적 공격력이 오르면 적이 잡는 턴 ↓, 적 HP가 오르면 내가 잡는 턴 ↑, 튜닝은 결정론 (같은 시드 묶음)', () => {
    const st = data.stages[0];
    const team = referenceTeam(st, data);
    const weak = winRateAt(st, 0.3, team, data, 20, 1, 1 / 0.3);
    const strong = winRateAt(st, 3, team, data, 20, 1, 1 / 3);
    expect(strong.enemyKill < weak.enemyKill).toBe(true);
    const thin = winRateAt(st, 0.5, team, data, 20, 1, 0.3).myKill;
    const thick = winRateAt(st, 0.5, team, data, 20, 1, 1).myKill;
    expect(thick > thin).toBe(true);
    const a = tuneStage(st, data, { runs: 20 });
    const b = tuneStage(st, data, { runs: 20 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.history.length <= B.tuner.maxIter * B.tuner.passes).toBe(true);
    expect(a.recommended).toBe(recommendedPower(st, data));
    expect(a.powerCheck.map((c) => c.key)).toEqual(Object.keys(B.tuner.powerCheck));
    expect(a.atCap.level).toBe(B.level.cap.base);
    expect(a.enemyPower > 0).toBe(true);
  });
  it('목표 판정: 내가 잡는 턴 · 적이 잡는 턴 · 시간 초과 모두', () => {
    const t = { myMin: 7, myMax: 9, enemyMin: 6, enemyMax: 8 };
    const good = { myKill: 8, enemyKill: 7, timeoutRate: 0 };
    expect(checkTargets(good, t, B).ok).toBe(true);
    expect(checkTargets({ ...good, myKill: 10 }, t, B).my).toBe(false);
    expect(checkTargets({ ...good, enemyKill: 5 }, t, B).enemy).toBe(false);
    expect(checkTargets({ ...good, timeoutRate: 0.2 }, t, B).ok).toBe(false);
    expect(checkTargets({ ...good, myKill: null }, t, B).ok).toBe(false);
    expect(targetsFor({ stageType: 'boss' }, B)).toEqual(B.tuner.killTurns.boss);
  });
  it('톱니 곡선: 챕터 첫 스테이지 start → 보스 앞 end → 챕터 보스 boss, 권장 전투력 = 기대 ÷ 비율', () => {
    const S = B.expected.sawtooth;
    for (const ch of data.chapters) {
      const ids = ch.stageIds.filter((id) => !data.stageMap.get(id)?.retired);
      if (ids.length < 3) continue;
      expect(sawtoothRatio(data.stageMap.get(ids[0]), data)).toBe(S.start);
      expect(Math.abs(sawtoothRatio(data.stageMap.get(ids.at(-2)), data) - S.end) < 1e-9).toBe(true);
      expect(sawtoothRatio(data.stageMap.get(ids.at(-1)), data)).toBe(S.boss);
    }
    const st = data.stages[5];
    expect(recommendedPower(st, data)).toBe(Math.round(expectedPower(st, data) / sawtoothRatio(st, data)));
  });
  it('전투력에 맞춘 팀: 레벨만 바꿔서 목표 전투력에 가장 가깝게, 전투력은 레벨에 따라 늘어남', () => {
    const st = data.stages.at(-1);
    const R = recommendedPower(st, data);
    const t = teamAtPower(st, data, R);
    const lo = teamAtPower(st, data, R * 0.8);
    expect(Math.abs(t.power - R) / R < 0.05).toBe(true);
    expect(lo.level < t.level && lo.power < t.power).toBe(true);
    expect(teamPower(t.team, data)).toBe(t.power);
  });
  it('전투 요약에 팀 HP 최저점 · 받은 피해(보호막 전), 지표 hpLeft · peakLoss는 0~1', () => {
    const st = data.stages[0];
    const r = winRateAt(st, 1, referenceTeam(st, data), data, 5);
    expect(r.peakLoss >= 0 && r.peakLoss <= 1 && r.hpLeft >= 0 && r.hpLeft <= 1).toBe(true);
    expect(r.enemyKill > 0).toBe(true);
  });
  it('장비 곡선 평가: 지역마다 기대 파밍 횟수', () => {
    const g = evaluateGear(data, { runs: 5 });
    expect(g.length).toBe(data.chapters.length);
    expect(g.every((x) => x.expectedRuns > 0)).toBe(true);
  });
});
