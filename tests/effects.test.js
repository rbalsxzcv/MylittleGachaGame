// 효과 등록표: 효과 하나씩 직접 실행해서 결과 확인 (js/battle/effects/*.js)
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { createBattle } from '../js/battle/engine.js';
import { EFFECTS } from '../js/battle/effects/index.js';
import { char, enemy, mkData, stageOf, teamOf, skill, dmg } from '../js/battle/testkit.js';

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

// ── 키트 아키타입용 메커니즘 (자원/표식/추가 공격/반격/변신/차지/소환 + 새 능력치) ──
const withRes = (id, extra = {}) => char(vocab, id, { resource: { name: '투지', cap: 5 }, ...extra });

describe('효과: 자원 / 표식 / 새 능력치', () => {
  it('stack_gain / stack_spend: 상한까지, 0이면 전부', () => {
    const { a1, run } = setup({ chars: [withRes('h')] });
    run('stack_gain', { n: 3 }, a1, a1);
    run('stack_gain', { n: 9 }, a1, a1);
    expect(a1.res.value).toBe(5);
    run('stack_spend', { n: 2 }, a1, a1);
    expect(a1.res.value).toBe(3);
    run('stack_spend', { n: 0 }, a1, a1);
    expect(a1.res.value).toBe(0);
  });
  it('damage perStack: 배율 + 자원 1개당 값', () => {
    const { a1, run } = setup({ chars: [withRes('h')] });
    run('stack_gain', { n: 3 }, a1, a1);
    const ev = run('damage', { mult: 1, stat: 'atk', hits: 1, perStack: 0.2 });
    expect(ev[0].amount).toBe(Math.floor(100 * 1.6 * (100 / 140)));
  });
  it('onStackFull: 가득 차는 순간 한 번만', () => {
    const c = withRes('h', {
      resource: { name: '투지', cap: 2 },
      kit: { basic: skill('enemy_single', [dmg(1), { type: 'stack_gain', n: 1, target: 'self' }]) },
      talents: [{ name: '가득', trigger: 'onStackFull', targeting: 'self', effects: [{ type: 'buff', stat: 'atk', pct: 10, turns: 2 }] }],
    });
    const { b } = setup({ chars: [c] });
    for (let i = 0; i < 4; i++) b.act({ action: 'basic', target: 'w1e1' });
    expect(b.state.events.filter((e) => e.t === 'passive' && e.name === '가득').length).toBe(1);
  });
  it('mark / vsMarked / mark_detonate', () => {
    const { a1, e1, b, run } = setup();
    run('mark', { turns: 2, max: 3 });
    run('mark', { turns: 2, max: 3 });
    expect(b.tools.marksFrom(a1, e1)).toBe(2);
    expect(run('damage', { mult: 1, stat: 'atk', hits: 1, vsMarked: 50 })[0].amount).toBe(Math.floor(100 * 2 * (100 / 140)));
    const ev = run('mark_detonate', { mult: 0.5 });
    expect(ev.find((e) => e.t === 'damage').amount).toBe(Math.floor(100 * 1 * (100 / 140)));
    expect(b.tools.marksFrom(a1, e1)).toBe(0);
  });
  it('효과 적중/저항: 저항 100%면 약화가 안 걸림, 확률이 1 이상이면 난수를 안 굴림', () => {
    const debuffKit = { skill: skill('enemy_single', [{ type: 'debuff', stat: 'def', pct: 20, turns: 2 }]) };
    const { b, e1 } = setup({ chars: [char(vocab, 'h', { kit: debuffKit })], enemyOpts: { stats: { effectRes: 1 } } });
    b.act({ action: 'skill', target: 'w1e1' });
    expect(b.state.events.some((e) => e.t === 'resist')).toBe(true);
    expect(e1.statuses.length).toBe(0);
    // 적중 1(=+100%) × 저항 0.5 → 확률 1 → 판정 없이 걸림
    const s2 = setup({ chars: [char(vocab, 'h', { kit: debuffKit, stats: { effectHit: 1 } })], enemyOpts: { stats: { effectRes: 0.5 } } });
    s2.b.act({ action: 'skill', target: 'w1e1' });
    expect(s2.e1.statuses.length).toBe(1);
  });
  it('energyRegen / healBonus / shieldBonus', () => {
    const { a1, run } = setup({ chars: [char(vocab, 'h', { stats: { energyRegen: 1.5, healBonus: 0.5, shieldBonus: 1 } })] });
    run('energy_gain', { n: 20 }, a1, a1);
    expect(a1.energy).toBe(30);
    a1.hp = 100;
    run('heal', { mult: 0.5, stat: 'atk' }, a1, a1);
    expect(a1.hp).toBe(175);
    run('shield', { mult: 1, stat: 'def', turns: 2 }, a1, a1);
    expect(a1.shield.value).toBe(80);
  });
});

describe('효과: 반응 / 변신 / 토큰', () => {
  const striker = (id) => char(vocab, id, { talents: [{ name: '추격', trigger: 'onAllyAttack', targeting: 'trigger_target', perRound: 1, effects: [{ type: 'follow_up', mult: 0.5, stat: 'atk' }] }] });
  it('follow_up: 다른 아군이 공격한 뒤 추가 공격, 라운드당 제한', () => {
    const { b } = setup({ team: ['h', 'h2', 'f'], chars: [char(vocab, 'h'), char(vocab, 'h2'), striker('f')] });
    b.act({ action: 'basic', target: 'w1e1' }); // a1 → a3 추가 공격
    b.act({ action: 'basic', target: 'w1e1' }); // a2 (같은 라운드) → 제한
    const fu = b.state.events.filter((e) => e.t === 'action' && e.action === 'follow_up');
    expect(fu.length).toBe(1);
    expect(fu[0].uid).toBe('a3');
  });
  it('counter: 공격받으면 행동이 끝난 뒤 반격 (반응은 반응을 부르지 않음)', () => {
    const tank = char(vocab, 'h', { talents: [{ name: '반격', trigger: 'onHit', targeting: 'trigger_target', effects: [{ type: 'counter', mult: 0.5, stat: 'atk' }] }] });
    const foe = { stats: { spd: 300 }, actions: { hit: skill('enemy_single', [dmg(1)]) }, passives: [{ name: '맞반격', trigger: 'onHit', targeting: 'trigger_target', effects: [{ type: 'counter', mult: 0.5, stat: 'atk' }] }] };
    const { b } = setup({ chars: [tank], enemyOpts: foe });
    const counters = b.state.events.filter((e) => e.t === 'action' && e.action === 'counter');
    expect(counters.length > 0).toBe(true);
    expect(counters.every((e) => e.uid === 'a1')).toBe(true); // 적의 맞반격은 반격에 반응하지 않음
  });
  it('transform: 키트가 바뀌고 지속 턴이 끝나면 돌아옴', () => {
    const c = char(vocab, 'h', { kit: { transformed: { basic: skill('enemy_single', [dmg(3)], { name: '변신 기본' }) } } });
    const { b, a1, run } = setup({ chars: [c] });
    run('transform', { turns: 1 }, a1, a1);
    expect(a1.kit.basic.name).toBe('변신 기본');
    b.act({ action: 'basic', target: 'w1e1' }); // 이번 턴에 받은 건 이번 턴 끝에 안 줄어듦
    expect(a1.kit.basic.name).toBe('변신 기본');
    b.act({ action: 'basic', target: 'w1e1' });
    expect(a1.kit.basic.name).toBe('기본');
    expect(a1.transform).toBe(null);
  });
  it('charge: 타임라인 토큰 → 시간이 되면 실행, 큰 차지는 차단 가능', () => {
    const big = { type: 'charge', delayPct: 100, big: 'big', targeting: 'enemy_all', effects: [dmg(1)] };
    const s = setup();
    s.run('charge', big, s.e1, s.a1);
    expect(s.b.queueItems(8).some((x) => x.kind === 'token' && x.big)).toBe(true);
    for (let i = 0; i < 4; i++) s.b.act({ action: 'basic', target: 'w1e1' });
    expect(s.b.state.events.some((e) => e.t === 'token_act')).toBe(true);
    expect(s.b.state.tokens.length).toBe(0);
    const s2 = setup();
    s2.run('charge', big, s2.e1, s2.a1);
    expect(s2.run('interrupt', {}, s2.a1, s2.e1).find((e) => e.t === 'interrupt').ok).toBe(true);
    for (let i = 0; i < 4; i++) s2.b.act({ action: 'basic', target: 'w1e1' });
    expect(s2.b.state.events.some((e) => e.t === 'token_act')).toBe(false);
    expect(s2.b.state.events.some((e) => e.t === 'token_end' && e.why === 'interrupted')).toBe(true);
  });
  it('summon: 자기 속도로 actions번 행동하고 사라짐', () => {
    const s = setup();
    s.run('summon', { icon: 'orb', spd: 200, actions: 2, targeting: 'enemy_all', effects: [dmg(0.5)] }, s.a1, s.a1);
    for (let i = 0; i < 4; i++) s.b.act({ action: 'basic', target: 'w1e1' });
    expect(s.b.state.events.filter((e) => e.t === 'token_act').length).toBe(2);
    expect(s.b.state.tokens.length).toBe(0);
  });
  it('AI useIf: 조건이 맞을 때만 스킬 (SP가 가득이면 예외)', async () => {
    const { chooseAction } = await import('../js/battle/ai.js');
    const c = withRes('h', { kit: { skill: skill('enemy_single', [dmg(2)], { useIf: [{ type: 'stacks_full' }] }) } });
    const { b, a1 } = setup({ chars: [c] });
    b.state.sp.ally = 3;
    expect(chooseAction(b.tools, a1).action).toBe('basic');
    a1.res.value = a1.res.cap;
    expect(chooseAction(b.tools, a1).action).toBe('skill');
    a1.res.value = 0;
    b.state.sp.ally = b.state.spMax;
    expect(chooseAction(b.tools, a1).action).toBe('skill');
  });
});

describe('수정자: 자원 상한 / 표식 지속', () => {
  it('resource_cap: 자원 상한 ±, mark_turns: 내가 거는 표식 지속 +턴', () => {
    const bt = [{ name: '넘침', modifiers: [{ type: 'resource_cap', delta: 2 }, { type: 'mark_turns', delta: 1 }] }];
    const c = char(vocab, 'h', { resource: { name: '투지', cap: 5 }, breakthroughs: bt });
    const b = createBattle({ team: [{ charId: 'h', level: 1, breakthrough: 1 }], stage: stageOf(['d']), data: mkData(vocab, [c], [enemy(vocab, 'd')]), seed: 3 });
    const a1 = b.unit('a1');
    expect(a1.res.cap).toBe(7);
    b.tools.addMark(a1, b.unit('w1e1'), 2, 3);
    expect(b.unit('w1e1').marks[0].turns).toBe(3);
  });
});
