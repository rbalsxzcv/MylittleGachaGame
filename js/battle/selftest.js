// 전투 엔진 자체 검사 — 게임 콘솔 __tg.battleTest(), 개발 도구 밸런스 탭 '엔진 검사', tests/battle.test.js가 같이 씀
// 정해진 숫자가 나오는지, 타임라인/SP/궁극기/예고 규칙대로인지, 같은 시드면 같은 결과인지 확인
import { createBattle, replayBattle, checkRegistry } from './engine.js';
import { chooseAction, chooseUltimates } from './ai.js';
import { char, enemy, mkData, stageOf, teamOf, skill, dmg } from './testkit.js';

/**
 * @param {object} vocab
 * @param {{team?:Array, stage?:object, data?:object}} [extra] 실제 데이터로 결정론/HP 범위까지 검사
 * @returns {{ok:boolean, results:Array<{name:string, ok:boolean, detail:string}>}}
 */
export function runSelfTest(vocab, extra = {}) {
  const results = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      results.push({ name, ok: detail === true || detail === undefined, detail: detail === true || detail === undefined ? '' : String(detail) });
    } catch (e) {
      results.push({ name, ok: false, detail: String(e?.stack || e?.message || e) });
    }
  };
  const eq = (got, want, label = '') => (JSON.stringify(got) === JSON.stringify(want) ? true : `${label}받은 값 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`);

  const dummy = enemy(vocab, 'd'); // 아무것도 안 함, 속도 50
  const hitter = enemy(vocab, 'atk', { actions: { hit: skill('enemy_single', [dmg(0.1)], { name: '찌르기' }) } });
  const bigOne = enemy(vocab, 'big', { actions: { slam: skill('enemy_all', [dmg(0.1)], { name: '내려찍기', big: true }) } });
  const H = char(vocab, 'h');
  const stage = stageOf(['d']);
  const battle = (chars, enemies, st = stage, team = teamOf(chars[0].id), seed = 1, override = {}) => createBattle({ team, stage: st, data: mkData(vocab, chars, enemies, override), seed });

  check('용어집(vocab)과 엔진 구현 일치', () => {
    const p = checkRegistry(vocab);
    return p.length ? p.join(' / ') : true;
  });

  check('피해 공식: 공 100, 방 40, 배율 1 → floor(100 × 100/140) = 71', () => {
    const b = battle([H], [dummy]);
    return eq(b.act({ action: 'basic', target: 'w1e1' }).find((e) => e.t === 'damage')?.amount, 71);
  });

  check('레벨 성장: Lv.10 공격력 = floor(100 × 1.72) = 172, 속도는 그대로', () => {
    const b = createBattle({ team: [{ charId: 'h', level: 10, breakthrough: 0 }], stage, data: mkData(vocab, [H], [dummy]), seed: 1 });
    return eq([b.state.allies[0].base.atk, b.state.allies[0].base.spd], [172, 100]);
  });

  check('SP: 시작 3 · 스킬 −1 · 기본 +1 · 0이면 스킬 불가(기본 공격으로)', () => {
    const b = battle([H], [dummy]);
    const seen = [b.state.sp.ally];
    for (const a of ['skill', 'basic', 'skill', 'skill', 'skill']) {
      b.act({ action: a, target: 'w1e1' });
      seen.push(b.state.sp.ally);
    }
    seen.push(b.options().skill.ok);
    const ev = b.act({ action: 'skill', target: 'w1e1' });
    seen.push(ev.find((e) => e.t === 'action')?.action, b.state.sp.ally);
    return eq(seen, [3, 2, 3, 2, 1, 0, false, 'basic', 1]);
  });

  check('기력: 기본 +20, 스킬 +30, 맞으면 +10', () => {
    const b = battle([H], [hitter], stageOf(['atk']));
    const seen = [];
    b.act({ action: 'basic', target: 'w1e1' });
    seen.push(b.state.allies[0].energy);
    b.act({ action: 'skill', target: 'w1e1' }); // 그다음 적이 때림 → +10
    seen.push(b.state.allies[0].energy);
    return eq(seen, [20, 60]);
  });

  check('궁극기: 입력 중에 쓰고, 턴을 쓰지 않음', () => {
    const U = char(vocab, 'u', { kit: { ultimate: skill('enemy_all', [dmg(1)], { name: '필살', cost: 20 }) } });
    const b = battle([U], [dummy]);
    const before = b.ultimate({ uid: 'a1' }).length; // 기력 0 → 못 씀
    b.act({ action: 'basic', target: 'w1e1' });
    const elapsed = b.state.elapsed;
    const ev = b.ultimate({ uid: 'a1' });
    return eq([before, ev.some((e) => e.t === 'action' && e.action === 'ultimate'), b.state.pendingUid, b.state.elapsed === elapsed, b.state.allies[0].energy], [0, true, 'a1', true, 0]);
  });

  check('강화 turns:2 → 자기 턴 2번 유지 (자기 턴 중 받은 효과는 그 턴엔 안 줄어듦)', () => {
    const B = char(vocab, 'bf', { kit: { skill: skill('self', [{ type: 'buff', stat: 'atk', pct: 50, turns: 2 }]) } });
    const b = battle([B], [dummy]);
    b.act({ action: 'skill' });
    const amounts = [];
    for (let i = 0; i < 3; i++) amounts.push(b.act({ action: 'basic', target: 'w1e1' }).find((e) => e.t === 'damage')?.amount);
    return eq(amounts, [107, 107, 71]); // floor(150 × 100/140) = 107
  });

  check('타임라인: 속도 100 아군 vs 50 적 → 아군, 적, 아군, 아군, 적', () => {
    const b = battle([H], [dummy]);
    return eq([b.state.pendingUid, ...b.queue(5)], ['a1', 'a1', 'w1e1', 'a1', 'a1', 'w1e1']);
  });

  check('라운드: 속도 100이면 라운드마다 한 번 행동', () => {
    const b = battle([H], [dummy]);
    for (let i = 0; i < 3; i++) b.act({ action: 'basic', target: 'w1e1' });
    return eq(b.state.round, 4);
  });

  check('행동 밀기 → 예고 ⏱ 늘어남 / 자기 당기기 → 바로 다시 행동', () => {
    const D = char(vocab, 'dl', { kit: { skill: skill('enemy_single', [{ type: 'delay_action', pct: 50 }]) } });
    const plain = battle([D], [hitter], stageOf(['atk']));
    plain.act({ action: 'basic', target: 'w1e1' });
    const delayed = battle([D], [hitter], stageOf(['atk']));
    delayed.act({ action: 'skill', target: 'w1e1' });
    const A = char(vocab, 'adv', { kit: { skill: skill('self', [{ type: 'advance_action', pct: 100 }]) } });
    const adv = battle([A], [dummy]);
    adv.act({ action: 'skill' });
    return eq([plain.intents()[0].eta, delayed.intents()[0].eta, adv.state.pendingUid, adv.state.elapsed], [0, 1, 'a1', 100]);
  });

  check('속도 강화: 남은 행동 수치가 비율대로 줄어듦', () => {
    const S = char(vocab, 'sp', { kit: { skill: skill('enemy_single', [{ type: 'debuff', stat: 'spd', pct: 50, turns: 3 }]) } });
    const b = battle([S], [dummy]);
    const before = b.state.enemies[0].av; // 100 남음
    b.act({ action: 'skill', target: 'w1e1' });
    // 속도 50 → 25: 남은 100 → 200, 그다음 아군 한 턴(100) 지남 → 100
    return eq([before, b.state.enemies[0].av, b.state.enemies[0].spdNow], [100, 100, 25]);
  });

  check('예고: 큰 공격을 차단하면 흐트러짐 (피해 없음), 다음 예고는 다시 큰 공격', () => {
    const I = char(vocab, 'int', { kit: { skill: skill('enemy_single', [{ type: 'interrupt' }]) } });
    const b = battle([I], [bigOne], stageOf(['big']));
    const first = b.intents()[0];
    b.act({ action: 'skill', target: 'w1e1' });
    const cut = b.intents()[0].interrupted;
    const ev = b.act({ action: 'basic', target: 'w1e1' });
    const stagger = ev.some((e) => e.t === 'stagger');
    const hurt = ev.some((e) => e.t === 'damage' && e.tgt === 'a1');
    const next = b.intents()[0];
    return eq([first.big, first.aoe, cut, stagger, hurt, next.big, next.interrupted], [true, true, true, true, false, true, false]);
  });

  check('예고 대상: 규칙(2번 칸) → 도발한 아군으로 바뀜', () => {
    const E = enemy(vocab, 'sl', { actions: { hit: skill('enemy_single', [dmg(0.1)]) }, pattern: [{ action: 'hit', target: 'slot2' }] });
    const T = char(vocab, 't', { kit: { skill: skill('self', [{ type: 'taunt', turns: 2 }]) } });
    const b = battle([T, H], [E], stageOf(['sl']), teamOf('t', 'h'));
    const before = b.intents()[0].targetSlot;
    b.act({ action: 'skill' });
    const after = b.intents()[0].targetSlot;
    return eq([before, after], [2, 1]);
  });

  check('라운드 제한을 넘기면 패배(timeout)', () => {
    const W = char(vocab, 'w', { kit: { basic: skill('enemy_single', [dmg(0)]), skill: skill('enemy_single', [dmg(0)]) } });
    const b = battle([W], [dummy], stageOf(['d'], { roundLimit: 3 }));
    b.runToEnd();
    return eq([b.state.result, b.state.reason, b.state.round], ['lose', 'timeout', 4]);
  });

  check('보스 페이즈: HP 50% 아래로 → 페이즈 이벤트 + 패턴 바뀜', () => {
    const boss = enemy(vocab, 'boss', {
      boss: true,
      stats: { hp: 1000, def: 0 },
      actions: { idle: skill('self', [{ type: 'energy_gain', n: 0 }]), rage: skill('enemy_all', [dmg(0.1)], { big: true }) },
      pattern: [{ action: 'idle' }],
      phases: [{ hpBelow: 50, name: '분노', pattern: [{ action: 'rage' }], enterEffects: [{ type: 'buff', stat: 'atk', pct: 20, turns: 3 }] }],
    });
    const P = char(vocab, 'p', { kit: { basic: skill('enemy_single', [dmg(6)]) } }); // 600 피해
    const b = battle([P], [boss], stageOf(['boss']));
    const ev = b.act({ action: 'basic', target: 'w1e1' });
    return eq([ev.some((e) => e.t === 'phase'), b.intents()[0].action, b.state.enemies[0].statuses.length], [true, 'rage', 1]);
  });

  check('광폭화: 정한 라운드가 되면 효과', () => {
    const E = enemy(vocab, 'en', { enrage: { round: 3, effects: [{ type: 'buff', stat: 'atk', pct: 100, turns: 99 }] } });
    const b = battle([H], [E], stageOf(['en']));
    const seen = [];
    for (let i = 0; i < 3; i++) seen.push(b.act({ action: 'basic', target: 'w1e1' }).some((e) => e.t === 'enrage'));
    return eq(seen, [false, true, false]);
  });

  check('AUTO: SP ≥ 2면 스킬, 1이면 기본 공격', () => {
    const b = battle([H], [dummy]);
    const a = chooseAction(b.tools, b.current()).action;
    b.state.sp.ally = 1;
    const c = chooseAction(b.tools, b.current()).action;
    return eq([a, c], ['skill', 'basic']);
  });

  check('AUTO: 궁극기는 쓰러뜨릴 수 있을 때 / 큰 공격 예고 때만', () => {
    const U = char(vocab, 'u', { kit: { ultimate: skill('enemy_single', [dmg(5)], { cost: 100 }) } });
    const weak = enemy(vocab, 'weak', { stats: { hp: 200, def: 0 } });
    const b1 = battle([U], [weak], stageOf(['weak']));
    b1.state.allies[0].energy = 100;
    const kill = chooseUltimates(b1.tools).length;
    const b2 = battle([U], [dummy]);
    b2.state.allies[0].energy = 100;
    const tough = chooseUltimates(b2.tools).length;
    const b3 = battle([U], [bigOne], stageOf(['big']));
    b3.state.allies[0].energy = 100;
    const big = chooseUltimates(b3.tools).length;
    return eq([kill, tough, big], [1, 0, 1]);
  });

  // 실제 데이터: 결정론 + 불변 조건
  const { team, stage: realStage, data: realData } = extra;
  if (team && realStage && realData) {
    check('같은 시드 → 같은 결과 (실제 데이터)', () => {
      const a = createBattle({ team, stage: realStage, data: realData, seed: 12345 });
      a.runToEnd();
      const b = createBattle({ team, stage: realStage, data: realData, seed: 12345 });
      b.runToEnd();
      return JSON.stringify(a.state.events) === JSON.stringify(b.state.events) ? true : '이벤트 기록이 달라요';
    });
    check('리플레이 재현 (궁극기 포함)', () => {
      const a = createBattle({ team, stage: realStage, data: realData, seed: 777 });
      a.runToEnd();
      const r = replayBattle({ team, stage: realStage, data: realData, ...a.record() });
      return JSON.stringify(r.state.events) === JSON.stringify(a.state.events) ? true : '리플레이 결과가 달라요';
    });
    check('HP 범위 (0 이상, 최대 이하)와 SP 범위 — 50판', () => {
      for (let s = 1; s <= 50; s++) {
        const bt = createBattle({ team, stage: realStage, data: realData, seed: s });
        bt.runToEnd();
        for (const ev of bt.state.events) {
          if (ev.t === 'sp' && (ev.sp < 0 || ev.sp > bt.state.spMax)) return `시드 ${s}: SP ${ev.sp}`;
          if (ev.hp == null) continue;
          const u = bt.unit(ev.tgt);
          if (ev.hp < 0 || (u && ev.hp > u.maxHp)) return `시드 ${s}: ${ev.tgt} HP ${ev.hp}`;
        }
        if (!bt.state.result) return `시드 ${s}: 전투가 끝나지 않음`;
      }
      return true;
    });
  }

  return { ok: results.every((r) => r.ok), results };
}
