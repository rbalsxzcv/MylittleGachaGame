// 추억: 세이브 조작(js/systems/memories.js) + 추억 뽑기(gacha/banners) + 실제 데이터
import { describe, it, expect } from './lib/runner.js';
import { loadGameData } from './lib/gameData.js';
import { createNewSave } from '../js/core/save.js';
import { createRng } from '../js/core/rng.js';
import { addMemory, grantMemory, equipMemory, holderOf, ensureDefaultMemories, memoryCostFor, levelUpMemory, scalePassive, memoryPassives, memoryExtras } from '../js/systems/memories.js';
import { buildPools, pullMany, rulesFor, pityKeyOf, isMemoryBanner, STANDARD_MEMORY_BANNER } from '../js/systems/gacha.js';
import { activeBanners } from '../js/systems/banners.js';
import { statsOf } from '../js/systems/progression.js';
import { createBattle } from '../js/battle/engine.js';

const data = await loadGameData();
const B = data.balance;
const mem = (id, extra = {}) => ({ id, name: id, rarity: 4, kind: 'generic', secondary: { stat: 'hp' }, passive: { generic: { name: 'g', conditions: [], targeting: 'self', effects: [], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: 10 }] } }, ...extra });

describe('추억: 세이브', () => {
  it('뽑기 중복: 처음은 새 카드 → 재련 +1 (R5까지) → 그 뒤는 추억 재료', () => {
    const s = createNewSave();
    const m = mem('memory_9001');
    expect(addMemory(s, m, B).isNew).toBe(true);
    for (let r = 2; r <= 5; r++) expect(addMemory(s, m, B).refine).toBe(r);
    const over = addMemory(s, m, B);
    expect(over).toEqual({ isNew: false, refine: null, material: B.memory.overflowMaterial[4], u: null });
    expect(s.memMat).toBe(B.memory.overflowMaterial[4]);
  });
  it('재련은 레벨이 가장 높은 카드부터', () => {
    const s = createNewSave();
    grantMemory(s, 'memory_9001', { lv: 3 });
    const hi = grantMemory(s, 'memory_9001', { lv: 9 });
    expect(addMemory(s, mem('memory_9001'), B).u).toBe(hi.u);
  });
  it('장착: 한 장은 한 명만 (다른 캐릭터가 끼고 있으면 옮김)', () => {
    const s = createNewSave();
    const a = grantMemory(s, 'memory_9001');
    equipMemory(s, 'char_a', a.u);
    equipMemory(s, 'char_b', a.u);
    expect(holderOf(s, a.u)).toBe('char_b');
    expect(s.equips.char_a.m).toBe(null);
  });
  it('역할 기본 추억: 가진 캐릭터마다 한 번만 지급 + 장착 (몇 번 불러도 같음)', () => {
    const s = createNewSave();
    s.owned.x = { level: 1, essence: 0, breakthrough: 0, count: 1 };
    const chars = [{ id: 'x', role: 'healer' }, { id: 'y', role: 'attacker' }];
    const mems = [mem('memory_d1', { kind: 'default', role: 'healer' }), mem('memory_d2', { kind: 'default', role: 'attacker' })];
    expect(ensureDefaultMemories(s, chars, mems)).toBe(1);
    expect(ensureDefaultMemories(s, chars, mems)).toBe(0);
    expect(s.memories.map((m) => m.id)).toEqual(['memory_d1']);
    expect(s.equips.x.m).toBe(s.memories[0].u);
    equipMemory(s, 'x', null); // 빼도 다시 주지 않음
    expect(ensureDefaultMemories(s, chars, mems)).toBe(0);
  });
  it('레벨업: 추억 재료를 먼저 쓰고 나머지는 티켓 + 골드', () => {
    const s = createNewSave();
    const a = grantMemory(s, 'memory_9001');
    s.memMat = 1;
    s.tickets = 1000;
    const cost = memoryCostFor(1, 3, s, B);
    expect(cost.material).toBe(1);
    expect(levelUpMemory(s, a.u, 3, B)).toBe(true);
    expect([a.lv, s.memMat, s.tickets]).toEqual([4, 0, 1000 - cost.tickets]);
    s.tickets = 1e9;
    s.gold = 1e9;
    expect(levelUpMemory(s, a.u, 9999, B)).toBe(true); // 최대 레벨에서 멈춤
    expect(a.lv).toBe(B.memory.maxLevel);
  });
  it('재련: 패시브 숫자 × refineScale (지속 턴은 그대로), 주인 보너스는 주인일 때만', () => {
    const p = { name: 'p', trigger: 'onBattleStart', targeting: 'self', conditions: [], effects: [{ type: 'buff', stat: 'atk', pct: 20, turns: 2 }], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: 10 }] };
    const r5 = scalePassive(p, 5, B);
    expect([r5.effects[0].pct, r5.effects[0].turns, r5.modifiers[0].pct]).toEqual([40, 2, 20]);
    const sig = mem('memory_s', { signatureOf: 'char_o', passive: { generic: p, owner: p } });
    expect(memoryPassives(sig, { r: 1 }, 'char_o', B).length).toBe(2);
    expect(memoryPassives(sig, { r: 1 }, 'char_x', B).length).toBe(1);
  });
});

describe('추억: 능력치 · 전투', () => {
  it('장착하면 능력치에 기본 공격력 + 부옵션 + 패시브 stat_bonus가 들어감', () => {
    const c = data.characters.find((x) => x.id === 'char_0002');
    const m = data.memories.find((x) => x.kind === 'default' && x.role === 'attacker');
    const s = createNewSave();
    s.owned[c.id] = { level: 10, essence: 0, breakthrough: 0, count: 1 };
    const inst = grantMemory(s, m.id, { lv: 10 });
    equipMemory(s, c.id, inst.u);
    const extras = memoryExtras(s, data, c.id);
    expect(extras.memory.entity.id).toBe(m.id);
    expect(statsOf(c, 10, 0, B, extras).atk > statsOf(c, 10, 0, B).atk).toBe(true);
    // 전투 유닛에도 반영
    const b = createBattle({ team: [{ charId: c.id, level: 10, breakthrough: 0, extras }], stage: data.stages[0], data, seed: 1 });
    expect(b.state.allies[0].base.atk).toBe(statsOf(c, 10, 0, B, extras).atk);
  });
});

describe('추억 뽑기', () => {
  it('추억 배너: 규칙은 balance.memoryGacha, 천장 키 따로, 1·2★ 없음', () => {
    const pickup = { id: 'banner_9', type: 'pickup', category: 'memory', pickupIds: [] };
    expect(isMemoryBanner(pickup)).toBe(true);
    expect([pityKeyOf(pickup), pityKeyOf(STANDARD_MEMORY_BANNER), pityKeyOf({ type: 'pickup' })]).toEqual(['memoryPickup', 'memory', 'pickup']);
    const cfg = rulesFor(pickup, B);
    expect(cfg.gacha.pity).toBe(60);
    expect([cfg.gacha.rates[1], cfg.gacha.rates[2], cfg.gacha.rates[5]]).toEqual([0, 0, 1.5]);
    const pools = buildPools(data.memories, STANDARD_MEMORY_BANNER);
    const out = pullMany({ pools, count: 10, pity: 0, cfg, rand: createRng(5) });
    expect(out.results.every((r) => r.rarity >= 3 && data.memoryMap.has(r.char.id))).toBe(true);
    expect(out.results.some((r) => r.rarity >= 4)).toBe(true); // 10연 4★ 확정
  });
  it('천장 60: 5★ 없이 60번째는 5★', () => {
    const pools = buildPools(data.memories, STANDARD_MEMORY_BANNER);
    const out = pullMany({ pools, count: 1, pity: 59, cfg: rulesFor(STANDARD_MEMORY_BANNER, B), rand: () => 0.99 });
    expect(out.results[0].rarity).toBe(5);
  });
  it('추억 픽업 pickupFrom: 캐릭터 픽업 배너의 지금 픽업 캐릭터 전용 추억을 따라감 + 추억 상시 배너 자동', () => {
    const sig = data.memories.find((m) => m.kind === 'signature');
    const banners = [
      { id: 'banner_c', type: 'pickup', category: 'character', pickupIds: [sig.signatureOf], startAt: null, endAt: null },
      { id: 'banner_m', type: 'pickup', category: 'memory', pickupFrom: 'banner_c', pickupIds: [], startAt: null, endAt: null },
    ];
    const list = activeBanners(banners, data.characters, new Date(), data.memories);
    const mb = list.find((b) => b.id === 'banner_m');
    expect(mb.pickupIds).toEqual([sig.id]);
    expect(list.some((b) => b.id === STANDARD_MEMORY_BANNER.id)).toBe(true);
    expect(list.filter((b) => !isMemoryBanner(b)).every((b) => list.indexOf(b) < list.indexOf(mb))).toBe(true); // 캐릭터 배너 먼저
  });
});

describe('추억: 실제 데이터', () => {
  it('역할마다 기본 추억 1장, 5★ 캐릭터마다 전용 추억 정확히 1장, 일반 12~16장', () => {
    for (const role of ['attacker', 'defender', 'support', 'healer']) expect(data.memories.filter((m) => m.kind === 'default' && m.role === role).length, role).toBe(1);
    for (const c of data.characters.filter((x) => x.rarity === 5)) expect(data.memories.filter((m) => m.signatureOf === c.id).length, c.id).toBe(1);
    const generic = data.memories.filter((m) => m.kind !== 'signature').length;
    expect(generic >= 12 && generic <= 16, String(generic)).toBe(true);
  });
  it('모든 추억 패시브가 용어집을 통과 (정리 후 비지 않음)', () => {
    for (const m of data.memories) {
      expect(!!m.passive.generic, m.id).toBe(true);
      expect(m.passive.generic.effects.length + m.passive.generic.modifiers.length > 0, m.id).toBe(true);
    }
  });
});
