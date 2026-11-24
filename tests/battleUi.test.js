// 전투 화면의 순수 부분 (js/fx/battleChoreo.js): 이벤트 → 장면 묶기, 카드 줄 배치, 숫자 위치, 행동 순서 짝 맞추기
// + 실제 전투 이벤트로 묶기가 빠짐없이 되는지 (Phaser 없이)
import { describe, it, expect } from './lib/runner.js';
import { groupBeats, rowLayout, floatOffset, formatNum, diffQueue, queueSlot } from '../js/fx/battleChoreo.js';
import { BT } from '../js/fx/battleTheme.js';
import { createBattle } from '../js/battle/engine.js';
import { loadGameData } from './lib/gameData.js';

const sideOf = (uid) => (uid?.startsWith('a') ? 'ally' : uid?.startsWith('w') ? 'enemy' : null);

describe('battleUi: 장면 묶기', () => {
  it('기본 공격 한 번 = 장면 하나, 대상 하나', () => {
    const beats = groupBeats(
      [
        { t: 'action', uid: 'a1', action: 'basic', name: '베기', side: 'ally' },
        { t: 'damage', src: 'a1', tgt: 'w1e1', amount: 120, absorbed: 0, crit: false, hp: 380 },
        { t: 'sp', sp: 4, delta: 1 },
      ],
      sideOf,
    );
    expect(beats.length).toBe(1);
    expect(beats[0].kind).toBe('action');
    expect(beats[0].targets).toEqual(['w1e1']);
    expect(beats[0].aoe).toBe(false);
    expect(beats[0].total).toBe(120);
  });
  it('광역 = 대상 여럿, 다단히트 = 같은 대상 여러 번', () => {
    const [b] = groupBeats(
      [
        { t: 'action', uid: 'a2', action: 'skill', name: '폭풍', side: 'ally' },
        { t: 'damage', src: 'a2', tgt: 'w1e1', amount: 50, crit: false },
        { t: 'damage', src: 'a2', tgt: 'w1e2', amount: 60, crit: true },
        { t: 'damage', src: 'a2', tgt: 'w1e1', amount: 40, crit: false },
      ],
      sideOf,
    );
    expect(b.targets).toEqual(['w1e1', 'w1e2']);
    expect(b.aoe).toBe(true);
    expect(b.multi).toBe(true);
    expect(b.crit).toBe(true);
    expect(b.hitsByTarget.get('w1e1').length).toBe(2);
    expect(b.total).toBe(150);
  });
  it('아군 대상 스킬: 피해 없음 → supportTargets', () => {
    const [b] = groupBeats(
      [
        { t: 'action', uid: 'a3', action: 'skill', name: '치유', side: 'ally' },
        { t: 'heal', src: 'a3', tgt: 'a1', amount: 80, hp: 500 },
        { t: 'shield', src: 'a3', tgt: 'a2', amount: 100, turns: 2 },
        { t: 'status', src: 'a3', tgt: 'w1e1', kind: 'debuff', stat: 'def', value: -10, turns: 2 },
      ],
      sideOf,
    );
    expect(b.targets).toEqual([]);
    expect(b.supportTargets).toEqual(['a1', 'a2']);
  });
  it('반응(추가 공격) · 토큰 행동 · 턴 시작 · 웨이브는 각각 새 장면', () => {
    const beats = groupBeats(
      [
        { t: 'turn', uid: 'w1e1', round: 2 },
        { t: 'damage', src: 'a1', tgt: 'w1e1', amount: 10, dot: true },
        { t: 'action', uid: 'w1e1', action: 'basic', name: '할퀴기', side: 'enemy' },
        { t: 'damage', src: 'w1e1', tgt: 'a1', amount: 30 },
        { t: 'action', uid: 'a1', action: 'counter', name: '반격', side: 'ally', reaction: true },
        { t: 'damage', src: 'a1', tgt: 'w1e1', amount: 20 },
        { t: 'death', uid: 'w1e1', by: 'a1' },
        { t: 'token_act', id: 't1', kind: 'charge', owner: 'w2e1', name: '차지', icon: 'charge' },
        { t: 'damage', src: 'w2e1', tgt: 'a2', amount: 99 },
        { t: 'wave', wave: 2, total: 3, uids: ['w2e1'] },
      ],
      sideOf,
    );
    expect(beats.map((b) => b.kind)).toEqual(['turn', 'action', 'action', 'action', 'wave']);
    expect(beats[1].side).toBe('enemy');
    expect(beats[2].reaction).toBe(true);
    expect(beats[2].events.some((e) => e.t === 'death')).toBe(true);
    expect(beats[3].token).toBe(true);
    expect(beats[3].actor).toBe('w2e1');
    expect(beats[3].side).toBe('enemy');
  });
  it('턴 시작의 지속 피해는 행동 대상에 안 섞임', () => {
    const [, act] = groupBeats(
      [
        { t: 'turn', uid: 'a1' },
        { t: 'damage', src: 'w1e1', tgt: 'a1', amount: 10, dot: true },
        { t: 'action', uid: 'a1', action: 'basic', side: 'ally' },
        { t: 'damage', src: 'a1', tgt: 'w1e1', amount: 5, dot: true },
        { t: 'damage', src: 'a1', tgt: 'w1e2', amount: 50 },
      ],
      sideOf,
    );
    expect(act.targets).toEqual(['w1e2']);
  });
});

describe('battleUi: 카드 줄 배치', () => {
  const inside = (cards, side) => {
    const a = BT.area[side];
    for (const c of cards) {
      expect(c.x - (c.w * c.scale) / 2).toBeGreaterThanOrEqual(a.x - 0.01);
      expect(c.x + (c.w * c.scale) / 2).toBeLessThanOrEqual(a.x + a.w + 0.01);
    }
  };
  it('아군 5장: 156×218, 간격 18, 가운데 정렬', () => {
    const cards = rowLayout([1, 2, 3, 4, 5].map((i) => ({ uid: `a${i}` })), 'ally');
    expect(cards.length).toBe(5);
    expect(cards[0].w).toBe(156);
    expect(cards[1].x - cards[0].x).toBeCloseTo(156 + 18, 5);
    const mid = BT.area.ally.x + BT.area.ally.w / 2;
    expect((cards[0].x + cards[4].x) / 2).toBeCloseTo(mid, 5);
    inside(cards, 'ally');
  });
  it('적 5~6명이면 0.85배 · 간격 14', () => {
    const six = rowLayout([1, 2, 3, 4, 5, 6].map((i) => ({ uid: `e${i}` })), 'enemy');
    expect(six[0].scale).toBeCloseTo(0.85, 5);
    expect(six[1].x - six[0].x).toBeCloseTo((140 + 14) * 0.85, 5);
    inside(six, 'enemy');
    expect(rowLayout([{ uid: 'e1' }, { uid: 'e2' }], 'enemy')[0].scale).toBe(1);
  });
  it('보스는 184×258, 양옆 28', () => {
    const cards = rowLayout([{ uid: 'e1' }, { uid: 'boss', boss: true }, { uid: 'e3' }], 'enemy');
    expect(cards[1].w).toBe(184);
    expect(cards[1].boss).toBe(true);
    expect(cards[1].x - cards[0].x).toBeCloseTo(140 / 2 + 28 + 184 / 2, 5);
    inside(cards, 'enemy');
  });
  it('빈 줄', () => {
    expect(rowLayout([], 'enemy')).toEqual([]);
  });
});

describe('battleUi: 숫자 · 행동 순서', () => {
  it('겹치는 숫자: 26px 위, 좌우 ±18 번갈아', () => {
    expect(floatOffset(0)).toEqual({ dx: 0, dy: 0 });
    expect(floatOffset(1)).toEqual({ dx: 18, dy: -26 });
    expect(floatOffset(2)).toEqual({ dx: -18, dy: -52 });
  });
  it('천 단위 쉼표, 1만 이상은 1.2만', () => {
    expect(formatNum(9876)).toBe('9,876');
    expect(formatNum(12345)).toBe('1.2만');
    expect(formatNum(-5)).toBe('0');
  });
  it('차례가 넘어가면: 이전 차례는 위로 빠지고, 다음 칩이 올라와 지금 차례가 됨', () => {
    const d = diffQueue(['a1', 'w1e1', 'a2', 'a1'], ['w1e1', 'a2', 'a1', 'a3']);
    expect(d.match).toEqual([1, 2, 3, -1]);
    expect(d.exitUp).toEqual([0]);
    expect(d.fade).toEqual([]);
  });
  it('같은 유닛이 계속 차례면 그대로, 순서만 바뀌면 칩을 옮김', () => {
    const d = diffQueue(['a1', 'w1e1', 'a2'], ['a1', 'a2', 'w1e1']);
    expect(d.match).toEqual([0, 2, 1]);
    expect(d.exitUp).toEqual([]);
  });
  it('쓰러진 유닛 칩은 그냥 사라짐', () => {
    const d = diffQueue(['a1', 'w1e1', 'a2'], ['a1', 'a2']);
    expect(d.fade).toEqual([1]);
  });
  it('칩 자리: 지금 차례 72, 나머지 56, 간격 10', () => {
    expect(queueSlot(0).size).toBe(72);
    expect(queueSlot(1).y - queueSlot(0).y).toBe(72 / 2 + 10 + 56 / 2);
    expect(queueSlot(2).y - queueSlot(1).y).toBe(56 + 10);
    expect(queueSlot(BT.queue.count - 1).y + 28).toBeLessThanOrEqual(BT.area.queue.y + BT.area.queue.h);
  });
});

describe('battleUi: 실제 전투 이벤트 묶기', () => {
  it('끝까지 자동 전투한 모든 이벤트가 장면에 빠짐없이 들어감', async () => {
    const data = await loadGameData();
    const team = data.characters.filter((c) => c.pullable).slice(0, 5).map((c) => ({ charId: c.id, level: 20, breakthrough: 0 }));
    const stage = data.stages.at(-1);
    const battle = createBattle({ team, stage, data, seed: 7 });
    const events = battle.runToEnd();
    const side = (uid) => battle.unit(uid)?.side ?? null;
    const beats = groupBeats(events, side);
    const count = beats.reduce((n, b) => n + b.events.length + (b.head ? 1 : 0), 0);
    expect(count).toBe(events.length);
    const actions = beats.filter((b) => b.kind === 'action');
    expect(actions.length).toBeGreaterThanOrEqual(1);
    for (const b of actions) {
      expect(['ally', 'enemy']).toContain(b.side);
      for (const t of b.targets) expect(side(t)).toBeTruthy();
    }
  });
});
