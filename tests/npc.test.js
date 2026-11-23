// NPC 등급: 뽑기/도감/육성/편성에 안 나오고 스토리 화자나 적(enemies charId)으로만 나옴
// 등급을 1–5 ↔ NPC로 바꾸면 가챠 풀/픽업/로테이션에서 바로 빠지고 다시 들어오는지 (세이브 기록은 보관)
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { loadGameData } from './lib/gameData.js';
import { normalizeGrade, rarityLabel, isNpc, NPC } from '../js/config.js';
import { validateCharacters, splitCharacters, linkEnemyNpcs } from '../js/core/data.js';
import { createNewSave, sanitize, migrate } from '../js/core/save.js';
import { getFeatured, ownedCount, hasUnseenNew, syncKnownIds } from '../js/systems/collection.js';
import { teamMembers, bestTeam } from '../js/systems/teams.js';
import { buildPools, pickupList, pullMany } from '../js/systems/gacha.js';
import { activeBanners, rotationPool } from '../js/systems/banners.js';
import { storyState } from '../js/systems/stories.js';
import { createRng } from '../js/core/rng.js';

const real = await loadGameData();
const rawChars = await loadJson('data/characters.json');
const X = 'char_0002'; // 5★ + 픽업 배너(banner_0003)의 유일한 픽업 — 가장 얽힌 경우
const KEEP = real.characters.find((c) => c.id !== X && c.rarity !== NPC).id;

/** 실제 데이터에서 X의 등급만 바꾼 게임 데이터 (개발 도구에서 등급을 바꾸고 배포한 것과 같음) */
function dataWithGrade(grade) {
  const json = structuredClone(rawChars);
  json.find((c) => c.id === X).rarity = grade;
  const all = validateCharacters(json, real.vocab);
  return { ...real, ...splitCharacters(all) };
}
const asNpc = dataWithGrade('npc');
const back = dataWithGrade(5);

/** X를 가진 플레이어 (레벨/돌파, 편성 1번 칸, 대표, NEW) */
function playerSave() {
  const save = createNewSave();
  save.owned[X] = { level: 30, essence: 1, breakthrough: 2, count: 3, firstAt: save.createdAt };
  save.owned[KEEP] = { level: 5, essence: 0, breakthrough: 0, count: 1, firstAt: save.createdAt };
  save.teams.presets[0].slots = [X, KEEP, null, null, null];
  save.featuredId = X;
  save.knownIds = real.characters.map((c) => c.id);
  save.newIds = [X];
  return save;
}

/** 시드 고정 뽑기 n번 → 나온 캐릭터 id 집합 */
function pulledIds(data, banner, n = 3000) {
  const rand = createRng(7);
  const pools = buildPools(data.characters, banner);
  const seen = new Set();
  let pity = 0;
  let guaranteed = false;
  for (let i = 0; i < n / 10; i++) {
    const out = pullMany({ pools, count: 10, pity, guaranteed, cfg: data.balance, rand });
    pity = out.pity;
    guaranteed = out.guaranteed;
    for (const r of out.results) seen.add(r.char.id);
  }
  return seen;
}

describe('NPC 등급: 값 읽기', () => {
  it("'npc' / 'NPC' → NPC, 1–5 그대로, 모르는 값은 null", () => {
    expect([normalizeGrade('npc'), normalizeGrade(' NPC '), normalizeGrade(5), normalizeGrade('SSR'), normalizeGrade('boss')]).toEqual([NPC, NPC, 5, 5, null]);
    expect(rarityLabel(NPC)).toBe('NPC');
    expect(rarityLabel(4)).toBe('4★');
  });
  it('캐릭터 데이터: NPC는 pullable false, 예전 pullable: false는 NPC로 읽음', () => {
    const list = validateCharacters([
      { id: 'char_9001', name: '마을 사람', rarity: 'npc' },
      { id: 'char_9002', name: '예전 스토리 전용', rarity: 3, pullable: false },
      { id: 'char_9003', name: '동료', rarity: 4 },
    ]);
    expect(list.map((c) => [c.rarity, c.pullable])).toEqual([
      [NPC, false],
      [NPC, false],
      [4, true],
    ]);
    expect(list.map(isNpc)).toEqual([true, true, false]);
  });
});

describe('NPC 등급: 1–5 → NPC로 바꾸면', () => {
  it('플레이어 캐릭터 목록에서 빠지고 NPC/스토리 화자 목록에는 남음', () => {
    expect(asNpc.charMap.has(X)).toBe(false);
    expect(asNpc.characters.some((c) => c.id === X)).toBe(false);
    expect(asNpc.npcs.map((c) => c.id)).toContain(X);
    expect(asNpc.allCharMap.get(X).name).toBe(real.charMap.get(X).name);
  });
  it('가챠: 상시/픽업 풀과 로테이션에서 빠지고, 시드 3000회 뽑아도 안 나옴', () => {
    const banner = real.banners.find((b) => (b.pickupIds || []).includes(X));
    expect(!!banner, '테스트 전제: 픽업 배너가 X를 가리킴').toBe(true);
    const pools = buildPools(asNpc.characters, banner);
    expect(Object.values(pools).flat().some((c) => c?.id === X)).toBe(false);
    expect(pickupList(pools).some((c) => c.id === X)).toBe(false);
    expect(rotationPool(asNpc.characters, 5).some((c) => c.id === X)).toBe(false);
    // 목록을 나누기 전(전체 캐릭터)을 넘겨도 NPC는 빠짐
    expect(Object.values(buildPools([...asNpc.npcs, ...asNpc.characters], banner)).flat().some((c) => c?.id === X)).toBe(false);
    expect(pulledIds(asNpc, banner).has(X)).toBe(false);
  });
  it('픽업이 NPC뿐인 픽업 배너는 숨김', () => {
    expect(activeBanners(asNpc.banners, asNpc.characters).some((b) => b.id === 'banner_0003')).toBe(false);
  });
  it('가진 플레이어: 도감/대표/NEW/편성/자동 편성에서 빠지지만 세이브 기록은 보관', () => {
    const save = playerSave();
    const ctx = { save, data: asNpc };
    expect(ownedCount(save, asNpc.characters)).toBe(1);
    expect(getFeatured(save, asNpc.characters, asNpc.charMap)?.id).toBe(KEEP);
    expect(hasUnseenNew(save, asNpc.charMap)).toBe(false);
    syncKnownIds(save, asNpc.characters, false);
    expect(save.newIds.includes(X) && hasUnseenNew(save, asNpc.charMap)).toBe(false);
    expect(teamMembers(ctx)[0]).toBe(null);
    expect(bestTeam(ctx).some((m) => m.charId === X)).toBe(false);
    const kept = sanitize(migrate(save, { rarityOf: (id) => asNpc.allCharMap.get(id)?.rarity, balance: asNpc.balance }).raw);
    expect(kept.owned[X].level).toBe(30);
    expect(kept.teams.presets[0].slots[0]).toBe(X);
  });
  it('스토리: NPC 보유 조건 스토리는 숨김, NPC가 주인공인 스토리/대사는 그대로', () => {
    const save = playerSave();
    const locked = { id: 'x1', kind: 'character', chapter: 1, characterId: KEEP, title: 't', unlock: [{ type: 'ownsCharacter', characterId: X }] };
    const st = storyState(locked, { save, index: [locked], charMap: asNpc.allCharMap });
    expect([st.visible, st.unlocked]).toEqual([false, false]);
    const about = { id: 'x2', kind: 'character', chapter: 1, characterId: X, title: 't', unlock: [] };
    expect(storyState(about, { save, index: [about], charMap: asNpc.allCharMap }).visible).toBe(true);
  });
});

describe('NPC 등급: NPC → 다시 1–5로 바꾸면', () => {
  it('가챠 풀/픽업/로테이션에 다시 들어오고 실제로 뽑힘', () => {
    const banner = back.banners.find((b) => (b.pickupIds || []).includes(X));
    const pools = buildPools(back.characters, banner);
    expect(pools[5].some((c) => c.id === X)).toBe(true);
    expect(pickupList(pools).some((c) => c.id === X)).toBe(true);
    expect(rotationPool(back.characters, 5).some((c) => c.id === X)).toBe(true);
    expect(activeBanners(back.banners, back.characters).some((b) => b.id === 'banner_0003')).toBe(true);
    expect(pulledIds(back, banner).has(X)).toBe(true);
  });
  it('NPC였던 동안 보관된 세이브 기록이 그대로 돌아옴 (레벨/돌파/편성/대표)', () => {
    const save = playerSave();
    const ctx = { save, data: back };
    expect(ownedCount(save, back.characters)).toBe(2);
    expect(getFeatured(save, back.characters, back.charMap)?.id).toBe(X);
    expect(teamMembers(ctx)[0]).toEqual({ charId: X, level: 30, breakthrough: 2, extras: {} });
  });
  it('다른 희귀도로 바꾸면 그 희귀도 풀로 옮겨짐 (5★ → NPC → 4★)', () => {
    const as4 = dataWithGrade(4);
    const pools = buildPools(as4.characters, null);
    expect([pools[4].some((c) => c.id === X), pools[5].some((c) => c.id === X)]).toEqual([true, false]);
  });
});

describe('NPC 등급: 적 연결 (enemies.json charId)', () => {
  it('적 그림이 없으면 연결된 NPC 그림, 적 그림이 있으면 그대로', () => {
    const allCharMap = new Map([['char_9001', { id: 'char_9001', name: '악역', rarity: NPC, image: 'assets/chars/char_9001.png' }]]);
    const out = linkEnemyNpcs(
      [
        { id: 'enemy_9001', name: '악역', image: '', charId: 'char_9001' },
        { id: 'enemy_9002', name: '악역 (각성)', image: 'assets/enemies/enemy_9002.png', charId: 'char_9001' },
        { id: 'enemy_9003', name: '잡몹', image: '', charId: null },
      ],
      allCharMap,
    );
    expect(out.map((e) => e.image)).toEqual(['assets/chars/char_9001.png', 'assets/enemies/enemy_9002.png', '']);
  });
  it('실제 데이터: 적의 charId는 모두 있는 NPC 캐릭터', () => {
    for (const e of real.enemies.filter((x) => x.charId)) expect(isNpc(real.charMap.get(e.charId)), `${e.id} → ${e.charId}`).toBe(true);
  });
  it('실제 데이터: 픽업 배너에 NPC가 없음', () => {
    for (const b of real.banners) for (const id of b.pickupIds || []) expect(isNpc(real.charMap.get(id)), `${b.id}: ${id}`).toBe(false);
  });
});
