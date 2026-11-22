// 캐릭터 삭제: 데이터에서 캐릭터를 지워도 (이미 그 캐릭터를 가진) 플레이어 화면/규칙에서는 "없었던 것"처럼 정리되는지
// - 세이브의 기록은 지우지 않음 (규칙: 모르는 id는 보관만, 무시) → 데이터가 돌아오면 다시 보임
// - 대신 어디에서도 보이거나 효과를 내면 안 됨: 도감 수, 대표 캐릭터, NEW, 편성/전투, 전투력, 뽑기, 픽업, 스토리 해금
import { describe, it, expect } from './lib/runner.js';
import { loadGameData } from './lib/gameData.js';
import { createNewSave, sanitize, migrate, exportCode, parseCode } from '../js/core/save.js';
import { getFeatured, ownedCount, hasUnseenNew, sortCharacters, syncKnownIds } from '../js/systems/collection.js';
import { teamMembers, teamPower, teamSize, bestTeam } from '../js/systems/teams.js';
import { buildPools, pickupList } from '../js/systems/gacha.js';
import { activeBanners, rotationPool } from '../js/systems/banners.js';
import { storyState } from '../js/systems/stories.js';
import { createBattle } from '../js/battle/engine.js';

const real = await loadGameData();
const GONE = 'char_0002'; // 지울 캐릭터 (픽업 배너 + 스토리에 나오는 캐릭터 — 가장 얽힌 경우)
const KEEP = real.characters.find((c) => c.id !== GONE && c.pullable).id;

const data = dataWithout(GONE);
const ctx = () => ({ save: ghostSave(), data });

/** 실제 데이터에서 GONE만 지운 데이터 (배너/스토리 참조는 일부러 남겨 둠 = 최악의 경우) */
function dataWithout(id) {
  const characters = real.characters.filter((c) => c.id !== id);
  const charMap = new Map(characters.map((c) => [c.id, c]));
  return { ...real, characters, charMap, allCharMap: charMap };
}

/** GONE을 여기저기 가진 세이브: 보유(레벨/돌파), 편성 1번 칸, 대표 캐릭터, NEW */
function ghostSave() {
  const save = createNewSave();
  save.owned[GONE] = { level: 40, essence: 2, breakthrough: 3, count: 6, firstAt: save.createdAt };
  save.owned[KEEP] = { level: 5, essence: 0, breakthrough: 0, count: 1, firstAt: save.createdAt };
  save.teams.presets[0].slots = [GONE, KEEP, null, null, null];
  save.featuredId = GONE;
  save.knownIds = [GONE, ...data.characters.map((c) => c.id)]; // 지금 데이터의 캐릭터는 이미 본 것
  save.newIds = [GONE];
  return save;
}



describe('캐릭터 삭제 → 플레이어 쪽 정리', () => {
  it('세이브 기록은 지우지 않고 보관 (데이터가 돌아오면 다시 보임)', () => {
    const s = sanitize(migrate(ghostSave(), { rarityOf: (id) => data.allCharMap.get(id)?.rarity, balance: data.balance }).raw);
    expect(s.owned[GONE].level).toBe(40);
    expect(s.teams.presets[0].slots[0]).toBe(GONE);
    const back = parseCode(exportCode(s), { rarityOf: () => undefined, balance: data.balance });
    expect(back.ok && back.save.owned[GONE].breakthrough).toBe(3);
  });
  it('도감: 보유 수/목록에 안 나옴', () => {
    const c = ctx();
    expect(ownedCount(c.save, data.characters)).toBe(1);
    expect(sortCharacters(data.characters).some((x) => x.id === GONE)).toBe(false);
  });
  it('대표 캐릭터: 지워진 캐릭터 대신 다른 보유 캐릭터', () => {
    const c = ctx();
    expect(getFeatured(c.save, data.characters, data.charMap)?.id).toBe(KEEP);
  });
  it('NEW 표시: 지워진 캐릭터는 NEW 점을 만들지 않음', () => {
    const c = ctx();
    expect(hasUnseenNew(c.save, data.charMap)).toBe(false);
    syncKnownIds(c.save, data.characters, false); // 다시 동기화해도 지워진 id를 NEW로 만들지 않음
    expect(hasUnseenNew(c.save, data.charMap)).toBe(false);
  });
  it('편성: 그 칸은 빈 칸, 전투력/인원에 안 들어감, 자동 편성에서도 빠짐', () => {
    const c = ctx();
    const members = teamMembers(c);
    expect(members[0]).toBe(null);
    expect(members[1].charId).toBe(KEEP);
    expect(teamSize(c)).toBe(1);
    const keepOnly = teamPower({ ...c, save: { ...c.save, teams: { ...c.save.teams, presets: [{ name: 'x', slots: [KEEP, null, null, null, null] }] } } });
    expect(teamPower(c)).toBe(keepOnly);
    expect(bestTeam(c).some((m) => m.charId === GONE)).toBe(false);
  });
  it('전투: 지워진 캐릭터가 편성에 있어도 오류 없이 빠지고 진행', () => {
    const c = ctx();
    const b = createBattle({ team: [{ charId: GONE, level: 40, breakthrough: 3 }, ...teamMembers(c).slice(1)], stage: data.stages[0], data, seed: 1 });
    expect(b.state.allies.map((u) => u.refId)).toEqual([KEEP]);
    b.runToEnd();
    expect(['win', 'lose']).toContain(b.state.result);
  });
  it('뽑기: 풀/픽업/로테이션에서 빠짐 (배너에 id가 남아 있어도)', () => {
    const banner = data.banners.find((b) => (b.pickupIds || []).includes(GONE));
    expect(!!banner, '테스트 전제: 픽업 배너가 이 캐릭터를 가리킴').toBe(true);
    const pools = buildPools(data.characters, banner);
    expect(Object.values(pools).flat().some((c) => c?.id === GONE)).toBe(false);
    expect(pickupList(pools).some((c) => c.id === GONE)).toBe(false);
    expect(rotationPool(data.characters, 5).some((c) => c.id === GONE)).toBe(false);
  });
  it('픽업 대상이 모두 사라진 픽업 배너는 목록에서 숨김 (상시처럼 보이는 빈 픽업 배너 방지)', () => {
    const list = activeBanners(data.banners, data.characters);
    const banner = list.find((b) => b.id === 'banner_0003');
    expect(!!banner, '픽업이 전부 지워진 배너가 아직 보여요').toBe(false);
  });
  it('스토리 해금: "캐릭터 보유" 조건은 지워진 캐릭터로는 열리지 않음', () => {
    const c = ctx();
    const story = { id: 'x_char', kind: 'character', chapter: 1, characterId: GONE, title: 't', unlock: [{ type: 'ownsCharacter', characterId: GONE }] };
    const st = storyState(story, { save: c.save, index: [story], charMap: data.allCharMap });
    expect(st.unlocked, '세이브에만 남은 캐릭터로 스토리가 열려요').toBe(false);
    expect(st.visible, '지워진 캐릭터의 스토리가 목록에 보여요').toBe(false);
  });
  it('캐릭터 스토리(characterId)도 해금 조건 없이 숨김', () => {
    const c = ctx();
    const story = { id: 'x_char2', kind: 'character', chapter: 1, characterId: GONE, title: 't', unlock: [] };
    expect(storyState(story, { save: c.save, index: [story], charMap: data.allCharMap }).visible).toBe(false);
  });
  it('남아 있는 캐릭터의 스토리/배너는 그대로', () => {
    const c = ctx();
    const story = { id: 'x_keep', kind: 'character', chapter: 1, characterId: KEEP, title: 't', unlock: [{ type: 'ownsCharacter', characterId: KEEP }] };
    const st = storyState(story, { save: c.save, index: [story], charMap: data.allCharMap });
    expect([st.visible, st.unlocked]).toEqual([true, true]);
    expect(activeBanners(real.banners, real.characters).some((b) => b.id === 'banner_0003')).toBe(true);
  });
});
