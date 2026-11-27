// js/systems/progression.js: 능력치 공식(속도 포함), 레벨업 비용, 전투력, 정수/돌파
import { describe, it, expect } from './lib/runner.js';
import { loadConfig } from '../js/config.js';
import { statsOf, powerOf, levelCost, costFor, goldCostFor, maxAffordable, grantDuplicate, doBreakthrough, canBreakthrough, levelUp } from '../js/systems/progression.js';
import { clearedChapterCount, levelCapOf } from '../js/systems/stageProgress.js';
import { levelCapFor } from '../js/config.js';
import { addCharacter } from '../js/systems/collection.js';
import { createNewSave } from '../js/core/save.js';

const cfg = loadConfig({});

describe('progression: 능력치', () => {
  it('희귀도 기본값 (5★ Lv.1)', () => {
    expect(statsOf({ rarity: 5 }, 1, 0, cfg)).toEqual({ atk: 130, def: 52, hp: 1170, spd: 105, critRate: 0.05, critDmg: 0.5, energyRegen: 1, effectHit: 0, effectRes: 0, healBonus: 0, shieldBonus: 0 });
  });
  it('레벨 성장: atk/def/hp만, 속도·치명타는 그대로', () => {
    const s = statsOf({ rarity: 3 }, 10, 0, cfg); // ×1.72
    expect(s.atk).toBe(172);
    expect(s.def).toBe(68);
    expect(s.hp).toBe(1548);
    expect(s.spd).toBe(100);
    expect(s.critRate).toBe(0.05);
  });
  it('데이터의 stats가 우선, 예전 희귀도 문자열도 됨', () => {
    expect(statsOf({ rarity: 'SR', stats: { spd: 120 } }, 1, 0, cfg).spd).toBe(120);
    expect(statsOf({ rarity: 'SR' }, 1, 0, cfg).atk).toBe(115);
  });
  it('상시 속도 보너스 (돌파 능력 stat_bonus)', () => {
    const c = { rarity: 3, breakthroughs: [{ modifiers: [{ type: 'stat_bonus', stat: 'spd', pct: 10 }] }] };
    expect(statsOf(c, 1, 0, cfg).spd).toBe(100);
    expect(statsOf(c, 1, 1, cfg).spd).toBe(110);
  });
});

describe('progression: 레벨업 비용 / 전투력', () => {
  it('티켓 = ceil(10 × lv^1.25), 골드 = 티켓 × 10', () => {
    expect(levelCost(1, cfg)).toBe(10);
    expect(levelCost(10, cfg)).toBe(178);
    expect(costFor(1, 3, cfg)).toBe(10 + 24 + 40);
    expect(goldCostFor(1, 3, cfg)).toBe(740);
  });
  it('가진 티켓/골드로 올릴 수 있는 최대', () => {
    expect(maxAffordable(1, 74, cfg, 1000, 740)).toEqual({ n: 3, cost: 74, gold: 740 });
    expect(maxAffordable(1, 74, cfg, 1000, 739).n).toBe(2);
  });
  it('전투력 = 가중합 (속도 포함)', () => {
    const s = { atk: 100, def: 40, hp: 900, spd: 100, critRate: 0.05, critDmg: 0.5 };
    expect(powerOf(s, cfg)).toBe(Math.floor(200 + 60 + 180 + 200 + 15 + 50));
  });
});

describe('progression: 레벨 상한', () => {
  const chapters = [
    { id: 'ch01', stageIds: ['s1', 's2'] },
    { id: 'ch02', stageIds: ['s3', 'old'] },
    { id: 'ch03', stageIds: [] },
  ];
  const stageMap = new Map([['s1', { id: 's1' }], ['s2', { id: 's2' }], ['s3', { id: 's3' }], ['old', { id: 'old', retired: true }]]);
  const clear = (save, ...ids) => ids.forEach((id) => (save.stages[id] = { clears: 1, firstClaimed: true, bestRounds: 3, stars: 1 }));
  it('상한 = 50 + 10 × 모두 깬 챕터 (은퇴 스테이지 무시, 빈 챕터는 안 셈)', () => {
    const save = createNewSave();
    expect(clearedChapterCount(save, chapters, stageMap)).toBe(0);
    expect(levelCapOf({ save, data: { chapters, stageMap, balance: cfg } })).toBe(50);
    clear(save, 's1');
    expect(clearedChapterCount(save, chapters, stageMap)).toBe(0);
    clear(save, 's2');
    expect(clearedChapterCount(save, chapters, stageMap)).toBe(1);
    clear(save, 's3');
    expect(clearedChapterCount(save, chapters, stageMap)).toBe(2);
    expect(levelCapFor(2, cfg)).toBe(70);
  });
  it('levelUp은 상한까지만 (넘는 만큼 잘라서 올림, 상한이면 false — 티켓도 안 씀)', () => {
    const save = createNewSave();
    save.tickets = 1e7;
    save.gold = 1e9;
    save.owned.a = { level: 45, essence: 0, breakthrough: 0, count: 1, firstAt: 0 };
    expect(levelUp(save, 'a', 10, cfg, 50)).toBe(true);
    expect(save.owned.a.level).toBe(50);
    const t = save.tickets;
    expect(levelUp(save, 'a', 1, cfg, 50)).toBe(false);
    expect(save.tickets).toBe(t);
    // 예전에 상한을 넘긴 캐릭터는 깎지 않음
    save.owned.b = { level: 80, essence: 0, breakthrough: 0, count: 1, firstAt: 0 };
    expect(levelUp(save, 'b', 1, cfg, 50)).toBe(false);
    expect(save.owned.b.level).toBe(80);
  });
  it('maxAffordable에 남은 칸(상한 − 레벨)을 주면 그 이상 안 셈', () => {
    expect(maxAffordable(48, 1e9, cfg, 2).n).toBe(2);
  });
});

describe('progression: 정수 / 돌파', () => {
  it('중복 → 정수, 최대 돌파 − 현재 돌파를 넘으면 희귀도별 티켓', () => {
    const save = createNewSave();
    const char = { id: 'x', rarity: 5 };
    expect(addCharacter(save, char, cfg).isNew).toBe(true);
    for (let i = 0; i < 6; i++) expect(addCharacter(save, char, cfg).essence).toBe(1);
    const over = addCharacter(save, char, cfg);
    expect(over).toEqual({ isNew: false, essence: 0, tickets: 200, breakthrough: 0 });
    expect(save.tickets).toBe(200);
  });
  it('돌파하면 정수 1개 사용, 보유 한도 = 6 − 돌파 단계', () => {
    const save = createNewSave();
    save.owned.y = { level: 1, essence: 6, breakthrough: 0, count: 7, firstAt: '' };
    expect(canBreakthrough(save.owned.y, cfg)).toBe(true);
    expect(doBreakthrough(save, 'y', cfg)).toBe(true);
    expect(save.owned.y).toEqual({ level: 1, essence: 5, breakthrough: 1, count: 7, firstAt: '' });
    // 돌파 1 + 정수 5 = 6 → 이미 가득 → 다음 중복은 4★ 티켓 80
    expect(grantDuplicate(save, { id: 'y', rarity: 4 }, cfg)).toEqual({ essence: 0, tickets: 80 });
    save.owned.z = { level: 1, essence: 2, breakthrough: 0, count: 3, firstAt: '' };
    doBreakthrough(save, 'z', cfg); // 정수 1, 돌파 1 → 한도 5
    expect(grantDuplicate(save, { id: 'z', rarity: 4 }, cfg)).toEqual({ essence: 1, tickets: 0 });
  });
  it('돌파 6단계면 더 돌파할 수 없음', () => {
    expect(canBreakthrough({ essence: 3, breakthrough: 5 }, cfg)).toBe(true);
    expect(canBreakthrough({ essence: 3, breakthrough: 6 }, cfg)).toBe(false);
    expect(canBreakthrough({ essence: 0, breakthrough: 2 }, cfg)).toBe(false);
  });
});
