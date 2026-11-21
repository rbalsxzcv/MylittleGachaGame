// 효과 등록표: 효과 하나씩 직접 실행해서 결과 확인 (js/battle/effects/*.js)
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { createBattle } from '../js/battle/engine.js';
import { EFFECTS } from '../js/battle/effects/index.js';
import { char, enemy, mkData, stageOf, teamOf, skill } from '../js/battle/testkit.js';

const vocab = await loadJson('js/battle/vocab.json');

/** 아군 a1(공 100) + 허수아비 적 w1e1(방 40, 속도 50) 전투, 아군 입력 대기 상태 */
function setup({ enemyOpts = {}, team = ['h'], chars } = {}) {
  const cs = chars || team.map((id) => char(vocab, id));
  const b = createBattle({ team: teamOf(...team), stage: stageOf(['d']), data: mkData(vocab, cs, [enemy(vocab, 'd', enemyOpts)]), seed: 3 });
  const ctx = { actor: null, action: 'skill', sourceKey: 'test', crit: false, kills: [], hits: [], triggerTarget: null };
  const a1 = b.unit('a1');
  const e1 = b.unit('w1e1');
  const run = (type, params, src = a1, tgt = e1, power = 1) => {
    const from = b.state.events.length;
    EFFECTS[type](b.tools, ctx, src, tgt, { type, ...params }, power);
    return b.state.events.slice(from);
  };
  return { b, a1, e1, run };
}

describe('효과', () => {
  it('등록표 = 용어집 효과 목록', () => {
    expect(Object.keys(EFFECTS).sort()).toEqual(Object.keys(vocab.effects).sort());
  });
  it('damage: 배율·타수·효과 강화', () => {
    const { e1, run } = setup();
    const ev = run('damage', { mult: 1, stat: 'atk', hits: 2 }, undefined, undefined, 1.5);
    expect(ev.filter((e) => e.t === 'damage').map((e) => e.amount)).toEqual([107, 107]); // floor(150 × 100/140)
    expect(e1.hp).toBe(100000 - 214);
  });
  it('damage: 최소 1, 보호막이 먼저 막음', () => {
    const { e1, run } = setup();
    expect(run('damage', { mult: 0, stat: 'atk', hits: 1 })[0].amount).toBe(1);
    e1.shield = { value: 50, turns: 2 };
    run('damage', { mult: 1, stat: 'atk', hits: 1 });
    expect([e1.shield, e1.hp]).toEqual([null, 100000 - 1 - 21]);
  });
  it('heal: 능력치 × 배율, 최대 HP까지', () => {
    const { a1, run } = setup();
    a1.hp = 100;
    run('heal', { mult: 0.5, stat: 'atk' }, a1, a1);
    expect(a1.hp).toBe(150);
    run('heal', { mult: 9999, stat: 'atk' }, a1, a1);
    expect(a1.hp).toBe(a1.maxHp);
  });
  it('shield: 더 큰 쪽만 남고 지속 시간 새로 고침', () => {
    const { a1, run } = setup();
    run('shield', { mult: 1, stat: 'def', turns: 2 }, a1, a1);
    expect(a1.shield.value).toBe(40);
    run('shield', { mult: 0.5, stat: 'def', turns: 3 }, a1, a1);
    expect([a1.shield.value, a1.shield.turns]).toEqual([40, 3]);
  });
  it('buff / debuff: 능력치 %, 같은 출처면 새로 고침', () => {
    const { b, a1, e1, run } = setup();
    run('buff', { stat: 'atk', pct: 30, turns: 2 }, a1, a1);
    run('buff', { stat: 'atk', pct: 30, turns: 2 }, a1, a1);
    expect(b.tools.stat(a1, 'atk')).toBe(130);
    run('debuff', { stat: 'def', pct: 50, turns: 2 });
    expect(b.tools.stat(e1, 'def')).toBe(20);
    run('debuff', { stat: 'dmgTaken', pct: 20, turns: 2 });
    expect(b.tools.stat(e1, 'dmgTaken')).toBeCloseTo(0.2, 1e-9);
  });
  it('dot: 시전자 공격력 × 배율, 대상 턴 시작에 터짐', () => {
    const { b, e1, run } = setup();
    run('dot', { mult: 0.3, turns: 2 });
    expect(e1.dots[0]).toEqual({ src: 'a1', dmg: 30, turns: 2 });
    b.act({ action: 'basic', target: 'w1e1' });
    b.act({ action: 'basic', target: 'w1e1' }); // 그사이 적 턴 한 번 → 지속 피해 30
    expect(b.state.events.some((e) => e.t === 'damage' && e.dot && e.amount === 30)).toBe(true);
    expect(e1.dots[0].turns).toBe(1);
  });
  it('energy_gain: 0~최대 사이로', () => {
    const { a1, run } = setup();
    run('energy_gain', { n: 70 }, a1, a1);
    run('energy_gain', { n: 70 }, a1, a1);
    expect(a1.energy).toBe(100);
    run('energy_gain', { n: -150 }, a1, a1);
    expect(a1.energy).toBe(0);
  });
  it('sp_gain: 팀 SP 0~5, 적에게는 효과 없음', () => {
    const { b, a1, e1, run } = setup();
    run('sp_gain', { n: 5 }, a1, a1);
    expect(b.state.sp.ally).toBe(5);
    run('sp_gain', { n: -2 }, e1, a1);
    expect(b.state.sp.ally).toBe(3);
    run('sp_gain', { n: 2 }, a1, e1);
    expect(b.state.sp.ally).toBe(3);
  });
  it('advance_action / delay_action: 한 턴 길이의 %', () => {
    const { e1, run } = setup();
    expect(e1.av).toBe(100); // 속도 50 → 한 턴 200, 아군이 100 먼저 행동
    run('delay_action', { pct: 25 });
    expect(e1.av).toBe(150);
    run('advance_action', { pct: 100 });
    expect(e1.av).toBe(0);
  });
  it('interrupt: 큰 공격 예고만 끊음', () => {
    const big = { actions: { slam: skill('enemy_all', [{ type: 'damage', mult: 1, stat: 'atk', hits: 1 }], { big: true }) } };
    const { e1, run } = setup({ enemyOpts: big });
    expect(run('interrupt', {})[0].ok).toBe(true);
    expect(e1.intent.interrupted).toBe(true);
    const { run: run2, e1: plain } = setup();
    expect(run2('interrupt', {})[0].ok).toBe(false);
    expect(plain.intent.interrupted).toBe(false);
  });
  it('cleanse: 약화와 지속 피해 해제, 속도 약화가 풀리면 행동 순서도 복구', () => {
    const { b, a1, run } = setup();
    run('debuff', { stat: 'spd', pct: 50, turns: 3 }, a1, a1);
    run('dot', { mult: 0.3, turns: 2 }, a1, a1);
    run('buff', { stat: 'atk', pct: 10, turns: 2 }, a1, a1);
    run('cleanse', {}, a1, a1);
    expect([a1.dots.length, a1.statuses.map((s) => s.kind), b.tools.stat(a1, 'spd'), a1.spdNow]).toEqual([0, ['buff'], 100, 100]);
  });
  it('taunt: 적의 단일 공격이 도발한 아군에게', () => {
    const { b, run } = setup({ team: ['h', 'h2'] });
    const a2 = b.unit('a2');
    run('taunt', { turns: 2 }, a2, a2);
    expect(b.tools.opponentsOf(b.unit('w1e1')).find((x) => x.taunt)?.uid).toBe('a2');
  });
});
