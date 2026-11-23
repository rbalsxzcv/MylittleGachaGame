// js/systems/stats.js: 역할 템플릿 × 희귀도 배율, 돌파 능력치 노드, 추억, 장비
import { describe, it, expect } from './lib/runner.js';
import { loadConfig } from '../js/config.js';
import { computeStats, baseStatsOf, breakthroughStatNodes, memoryStats, gearPieceStats, gearStats } from '../js/systems/stats.js';
import { statsOf, powerOf, breakthroughNodes } from '../js/systems/progression.js';

const cfg = loadConfig({});
const T = cfg.stats.roleTemplate;

describe('능력치 모델: 기본', () => {
  it('역할 템플릿 × 희귀도 배율 (atk/def/hp만), 속도·비율 능력치는 역할 값', () => {
    const b = baseStatsOf({ rarity: 3, role: 'defender' }, cfg);
    expect(b.atk).toBe(Math.round(T.defender.atk * 0.78));
    expect(b.hp).toBe(Math.round(T.defender.hp * 0.78));
    expect(b.spd).toBe(T.defender.spd);
    expect(b.effectRes).toBe(T.defender.effectRes);
    expect(b.energyRegen).toBe(1);
  });
  it('statTweak: 능력치 % 손조정', () => {
    expect(baseStatsOf({ rarity: 5, role: 'attacker', statTweak: { atk: 10 } }, cfg).atk).toBe(Math.round(T.attacker.atk * 1.1));
  });
  it('절대값 stats가 있으면 그게 우선 (적/예전 데이터), 빠진 칸은 희귀도 기본값', () => {
    const b = baseStatsOf({ rarity: 3, role: 'attacker', stats: { atk: 55 } }, cfg);
    expect([b.atk, b.def, b.energyRegen, b.effectRes]).toEqual([55, 40, 1, 0]);
    expect(baseStatsOf({ passives: [], stats: { atk: 60, effectRes: 0.2 } }, cfg).effectRes).toBe(0.2);
  });
});

describe('능력치 모델: 돌파 · 추억 · 장비', () => {
  it('돌파 1·3·4·5 = 역할 노드 × 낮은 희귀도 보정, 2·6은 노드 없음', () => {
    const c = { rarity: 5, role: 'attacker' };
    expect(breakthroughStatNodes(c, 0, cfg).length).toBe(0);
    expect(breakthroughStatNodes(c, 2, cfg).map((n) => n.step)).toEqual([1]);
    expect(breakthroughStatNodes(c, 6, cfg).map((n) => n.step)).toEqual([1, 3, 4, 5]);
    expect(breakthroughStatNodes({ rarity: 3, role: 'attacker' }, 1, cfg)[0].pct).toBe(8 * 1.3);
    const s0 = statsOf(c, 1, 0, cfg);
    const s5 = statsOf(c, 1, 5, cfg);
    expect(s5.atk).toBe(Math.floor(s0.atk * 1.18)); // atk +8% +10%
    expect(s5.critRate).toBeCloseTo(s0.critRate + 0.06, 1e-9);
    expect(s5.critDmg).toBeCloseTo(s0.critDmg + 0.18, 1e-9);
  });
  it('추억: 기본 공격력은 레벨 기본값에 더하고 부옵션은 %', () => {
    const mem = { rarity: 4, secondary: { stat: 'hp' } };
    const ms = memoryStats(mem, 1, cfg);
    expect(ms).toEqual({ atk: 34, secondary: { stat: 'hp', pct: 9 } });
    expect(memoryStats(mem, 11, cfg).atk).toBe(Math.floor(34 * 1.8));
    const c = { rarity: 5, role: 'attacker' };
    const s = computeStats(c, { level: 1, memory: { entity: mem, level: 1 } }, cfg);
    const plain = computeStats(c, { level: 1 }, cfg);
    expect(s.atk).toBe(plain.atk + 34);
    expect(s.hp).toBe(Math.floor(plain.hp * 1.09));
  });
  it('장비: 같은 티어 + 칸 + 강화 = 같은 수치, 고정값으로 더함', () => {
    expect(gearPieceStats('atk', 1, 0, cfg)).toEqual({ atk: 18 });
    expect(gearPieceStats('atk', 3, 2, cfg)).toEqual({ atk: Math.round(18 * 1.35 ** 2 * 1.2) });
    expect(gearPieceStats('crit', 2, 0, cfg)).toEqual({ critRate: 0.02, critDmg: 0.041 });
    expect(gearPieceStats('atk', 0, 0, cfg)).toEqual({});
    const g = { atk: { tier: 1, enh: 0 }, hp: { tier: 1, enh: 0 }, crit: null };
    expect(gearStats(g, cfg)).toEqual({ atk: 18, hp: 160 });
    const c = { rarity: 5, role: 'attacker' };
    const s = computeStats(c, { level: 1, gear: g }, cfg);
    const plain = computeStats(c, { level: 1 }, cfg);
    expect([s.atk - plain.atk, s.hp - plain.hp]).toEqual([18, 160]);
  });
  it('전투력: 새 능력치 가중치 (기력 회복은 1을 넘는 만큼)', () => {
    const base = { atk: 100, def: 40, hp: 900, spd: 100, critRate: 0.05, critDmg: 0.5, energyRegen: 1, effectHit: 0, effectRes: 0, healBonus: 0, shieldBonus: 0 };
    const p0 = powerOf(base, cfg);
    expect(powerOf({ ...base, energyRegen: 1.1 }, cfg)).toBe(Math.floor(p0 + 200 * 0.1));
    expect(powerOf({ ...base, effectHit: 0.2 }, cfg)).toBe(Math.floor(p0 + 100 * 0.2));
  });
});

describe('돌파 1–6 칸', () => {
  it('1·3·4·5 = 역할 능력치 노드, 2 = bt2, 6 = bt6 (없으면 빈 칸)', () => {
    const c = { rarity: 5, role: 'defender', bt2: { name: '강화', modifiers: [] }, bt6: null };
    const nodes = breakthroughNodes(c, cfg);
    expect(nodes.map((n) => n.kind)).toEqual(['stat', 'passive', 'stat', 'stat', 'stat', 'empty']);
    expect(nodes[0]).toEqual({ step: 1, kind: 'stat', stat: 'hp', pct: 8 });
    expect(nodes[1].passive.name).toBe('강화');
  });
  it('예전 데이터(breakthroughs만): 그 목록 그대로', () => {
    const nodes = breakthroughNodes({ rarity: 3, breakthroughs: [{ name: 'a' }, { name: 'b' }] }, cfg);
    expect(nodes.map((n) => n.passive?.name ?? null)).toEqual(['a', 'b', null, null, null, null]);
  });
});
