// 장비(js/systems/gear.js) + 클리어 처리 · 반복 전투 · 소탕(js/systems/farming.js)
import { describe, it, expect } from './lib/runner.js';
import { loadGameData } from './lib/gameData.js';
import { createNewSave } from '../js/core/save.js';
import { createRng } from '../js/core/rng.js';
import { addGear, bagList, equipGear, unequipGear, autoEquip, gearExtras, enhanceCost, enhanceEquipped, salvage, salvageValue, bulkSalvage, toggleLock, regionTier, chapterOf, dropTable, rollDrops, starsOf } from '../js/systems/gear.js';
import { clearStage, repeatBattle, sweep, canSweep } from '../js/systems/farming.js';
import { statsOf } from '../js/systems/progression.js';

const data = await loadGameData();
const B = data.balance;

describe('장비: 가방 · 장착', () => {
  it('같은 칸 + 티어 + 강화는 개수로 쌓임, 장착하면 하나 빠지고 빼면 돌아옴', () => {
    const s = createNewSave();
    addGear(s, 'atk', 2, 0, 3);
    expect(s.gear['atk.2.0']).toEqual({ n: 3, lock: false });
    expect(equipGear(s, 'c1', 'atk', 2, 0)).toBe(true);
    expect([s.gear['atk.2.0'].n, s.equips.c1.g.atk]).toEqual([2, '2.0']);
    addGear(s, 'atk', 3, 1);
    equipGear(s, 'c1', 'atk', 3, 1); // 바꿔 끼면 끼던 건 가방으로
    expect([s.gear['atk.2.0'].n, s.gear['atk.3.1'], s.equips.c1.g.atk]).toEqual([3, undefined, '3.1']);
    unequipGear(s, 'c1', 'atk');
    expect([s.gear['atk.3.1'].n, s.equips.c1.g.atk]).toEqual([1, null]);
    expect(equipGear(s, 'c1', 'hp', 9, 0)).toBe(false); // 없는 조각
  });
  it('자동 장착: 칸마다 가장 좋은 것 (티어 → 강화)', () => {
    const s = createNewSave();
    addGear(s, 'hp', 1, 5);
    addGear(s, 'hp', 2, 0);
    addGear(s, 'crit', 1, 0);
    expect(autoEquip(s, 'c1')).toBe(2);
    expect(s.equips.c1.g).toEqual({ hp: '2.0', def: null, crit: '1.0', atk: null });
    expect(autoEquip(s, 'c1')).toBe(0);
    expect(gearExtras(s, 'c1')).toEqual({ gear: { hp: { tier: 2, enh: 0 }, crit: { tier: 1, enh: 0 } } });
  });
  it('장비가 능력치에 고정값으로 들어감', () => {
    const c = data.characters.find((x) => x.id === 'char_0012');
    const s = createNewSave();
    addGear(s, 'def', 3, 2);
    equipGear(s, c.id, 'def', 3, 2);
    const plain = statsOf(c, 10, 0, B);
    const geared = statsOf(c, 10, 0, B, gearExtras(s, c.id));
    expect(geared.def - plain.def).toBe(Math.round(B.gear.slotBase.def.def * B.gear.tierMul ** 2 * (1 + B.gear.enhStep * 2)));
  });
});

describe('장비: 강화 · 분해 · 잠금', () => {
  it('강화: 강화석 ceil(base × 티어^a × (강화+1)^b), 최대 강화에서 멈춤', () => {
    const s = createNewSave();
    addGear(s, 'atk', 2, 0);
    equipGear(s, 'c', 'atk', 2, 0);
    s.gearMat = 10000;
    const c0 = enhanceCost(2, 0, B);
    expect(c0).toBe(Math.ceil(B.gear.enhCost.base * 2 ** B.gear.enhCost.tierExp));
    for (let i = 0; i < 10; i++) enhanceEquipped(s, 'c', 'atk', B);
    expect(s.equips.c.g.atk).toBe(`2.${B.gear.maxEnh}`);
    s.gearMat = 0;
    addGear(s, 'hp', 1, 0);
    equipGear(s, 'c', 'hp', 1, 0);
    expect(enhanceEquipped(s, 'c', 'hp', B)).toBe(false);
  });
  it('분해: 기본 값 + 쓴 강화석 일부, 잠금은 분해 안 됨, 일괄 분해는 티어 이하만', () => {
    const s = createNewSave();
    addGear(s, 'atk', 1, 0, 4);
    addGear(s, 'def', 1, 2, 1);
    addGear(s, 'hp', 3, 0, 1);
    expect(salvageValue(1, 2, B) > salvageValue(1, 0, B)).toBe(true);
    toggleLock(s, 'def.1.2');
    expect(salvage(s, 'def.1.2', 1, B)).toBe(0);
    const r = bulkSalvage(s, 2, B);
    expect(r).toEqual({ pieces: 4, mat: salvageValue(1, 0, B) * 4 });
    expect(bagList(s).map((x) => x.key).sort()).toEqual(['def.1.2', 'hp.3.0']);
  });
});

describe('장비: 드롭 · 별점', () => {
  it('지역 티어 = 챕터 순서 + 1, 챕터 마지막 스테이지는 보스 표', () => {
    expect(regionTier('ch01', 0, B)).toBe(1);
    expect(regionTier('ch02', 1, B)).toBe(2);
    expect(regionTier('chX', 0, { ...B, gear: { ...B.gear, regionTier: { chX: 5 } } })).toBe(5);
    const last = data.chapters[1].stageIds.at(-1);
    expect(chapterOf(last, data.chapters)).toEqual({ id: data.chapters[1].id, index: 1, last: true, position: data.chapters[1].stageIds.length - 1 });
    const normal = dropTable(data.stageMap.get(data.chapters[1].stageIds[0]), data.chapters, B);
    const boss = dropTable(data.stageMap.get(last), data.chapters, B);
    expect(normal.tiers).toEqual([{ tier: 1, p: B.gear.drop.rates.normal.prev }, { tier: 2, p: B.gear.drop.rates.normal.cur }]);
    expect([boss.boss, boss.count, boss.tiers[1].p]).toEqual([true, B.gear.drop.count.boss, B.gear.drop.rates.boss.cur]);
    expect(dropTable(data.stageMap.get(data.chapters[0].stageIds[0]), data.chapters, B).tiers).toEqual([{ tier: 1, p: 1 }]);
  });
  it('굴리기: 시드가 같으면 같은 결과, 비율은 표대로', () => {
    const t = { count: 1, tiers: [{ tier: 1, p: 0.65 }, { tier: 2, p: 0.35 }], mat: 20 };
    expect(rollDrops(t, createRng(4))).toEqual(rollDrops(t, createRng(4)));
    const rng = createRng(9);
    let t2 = 0;
    for (let i = 0; i < 20000; i++) if (rollDrops(t, rng).pieces[0].tier === 2) t2 += 1;
    expect(Math.abs(t2 / 20000 - 0.35) < 0.02).toBe(true);
  });
  it('별점: ★1 승리 · ★2 쓰러진 아군 없음 · ★3 + 빠른 클리어', () => {
    const st = { roundLimit: 20 };
    const alive = [{ alive: true }, { alive: true }];
    expect(starsOf({ result: 'lose', rounds: 3, units: alive }, st, B)).toBe(0);
    expect(starsOf({ result: 'win', rounds: 15, units: [{ alive: false }] }, st, B)).toBe(1);
    expect(starsOf({ result: 'win', rounds: 15, units: alive }, st, B)).toBe(2);
    expect(starsOf({ result: 'win', rounds: 10, units: alive }, st, B)).toBe(3);
  });
});

describe('클리어 · 반복 전투 · 소탕', () => {
  const ctx = () => ({ save: createNewSave(), data });
  const team = ['char_0012', 'char_0002', 'char_0001', 'char_0006', 'char_0011'].map((charId) => ({ charId, level: 40, breakthrough: 3 }));
  it('클리어: 보상 + 별점 기록(최고) + 드롭이 가방으로', () => {
    const c = ctx();
    const st = data.stages[0];
    const r = clearStage(c, st, { result: 'win', rounds: 3, units: [{ alive: true }] }, createRng(1));
    expect(r.stars).toBe(3);
    expect(c.save.stages[st.id].stars).toBe(3);
    expect(bagList(c.save).reduce((a, x) => a + x.n, 0)).toBe(r.drops.pieces.length);
    clearStage(c, st, { result: 'win', rounds: 30, units: [{ alive: false }] }, createRng(2));
    expect(c.save.stages[st.id].stars).toBe(3); // 최고 기록 유지
  });
  it('반복 전투: 렌더 없이 N판, 드롭 합계 / 소탕은 ★3만', () => {
    const c = ctx();
    const st = data.stages[0];
    expect(canSweep(c.save, st.id)).toBe(false);
    expect(sweep(c, st, 3, createRng(1))).toBe(null);
    const r = repeatBattle(c, st, team, 5, createRng(3));
    expect(r.results.length + (r.lost ? 1 : 0) >= 1).toBe(true);
    expect(c.save.stages[st.id].clears).toBe(r.results.length);
    expect(Object.values(r.merged.pieces).reduce((a, b) => a + b, 0)).toBe(r.results.reduce((a, x) => a + x.drops.pieces.length, 0));
    c.save.stages[st.id].stars = 3;
    const sw = sweep(c, st, 4, createRng(5));
    expect(sw.results.length).toBe(4);
    expect(c.save.stages[st.id].clears).toBe(r.results.length + 4);
  });
});
