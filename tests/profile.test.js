// 캐릭터 프로필: 정리 · 검사 · 해금(미보유/보유/돌파/상대 보유) · 화면 데이터 · quote 대체 · 세이브 profileSeen
import { describe, it, expect } from './lib/runner.js';
import { cleanProfile, emptyProfile, hasProfile, quoteOf, profileIssues, profileView, unlockedStoryIdx, newStoriesAt, hasUnseenStory, unseenStoryCount, markStorySeen, lineOf, PROFILE_LIMITS } from '../js/systems/profile.js';
import { validateCharacters, splitCharacters } from '../js/core/data.js';
import { createNewSave, sanitize } from '../js/core/save.js';
import { remapSaveIds } from '../js/core/aliases.js';

const RAW_PROFILE = {
  facts: { age: '스물하나', height: '162cm', origin: '남부 항구 빈민가', likes: ['따뜻한 우유', '높은 곳'], dislikes: ['빚'], hobby: '' },
  stories: [
    { title: '첫 번째 도망', text: '첫 이야기', unlock: { breakthrough: 1 } },
    { title: '빚 없는 삶', text: '둘째 이야기', unlock: { breakthrough: 3 } },
    { title: '돌아온 이유', text: '셋째 이야기', unlock: { breakthrough: 6 } },
  ],
  lines: { obtain: '……시논. 척후.', team: '앞은 내가 본다.', idle: ['우유 남았어?', '단장, 또 빚졌지.'] },
  relations: [
    { id: 'char_0008', label: '그 마녀', note: '마법 실력은 인정' },
    { id: 'char_0099', label: '보스', note: 'NPC' },
  ],
  voice: { personality: '말수 적은 현실주의자', never: ['욕설'], weakness: '도망친 과거', samples: ['셋.', '우유.', '……'] },
};

function gameChars() {
  const all = validateCharacters([
    { id: 'char_0001', name: '시논', rarity: 4, profile: RAW_PROFILE },
    { id: 'char_0008', name: '이레나', rarity: 5, quote: '컷인 대사', profile: { lines: { obtain: '쓰이지 않음' } } },
    { id: 'char_0002', name: '빈 프로필', rarity: 3 },
    { id: 'char_0099', name: '보스', rarity: 'npc', profile: RAW_PROFILE },
  ]);
  return splitCharacters(all);
}
const own = (save, id, bt = 0) => (save.owned[id] = { level: 1, essence: 0, breakthrough: bt, count: 1, firstAt: save.createdAt });

describe('profile: 데이터 정리', () => {
  it('없거나 이상한 값 → 빈 프로필, 예외 없음', () => {
    for (const raw of [undefined, null, 3, 'x', [], { facts: 'x', stories: {}, lines: [], relations: 'y' }]) {
      expect(cleanProfile(raw)).toEqual(emptyProfile());
    }
    expect(hasProfile(cleanProfile(null))).toBe(false);
  });
  it('빈 칸은 빼고 길이는 자름, 이야기 최대 3편 · 해금 기본값 1/3/6', () => {
    const long = 'ㄱ'.repeat(1000);
    const p = cleanProfile({
      facts: { age: long, likes: ['a', 'b', 'c', 'd', 'e', 'f'], hobby: '  ' },
      stories: [{ text: '하나' }, { title: '둘', text: '둘' }, { text: '' }, { text: '넷' }],
      lines: { team: long, idle: Array(9).fill('대기') },
    });
    expect(p.facts.age.length).toBe(PROFILE_LIMITS.fact);
    expect(p.facts.likes.length).toBe(5);
    expect('hobby' in p.facts).toBe(false);
    expect(p.stories.map((s) => s.unlock.breakthrough)).toEqual([1, 3]); // 빈 셋째는 빠짐, 넷째는 3편 제한 밖
    expect(p.stories[0].title).toBe('이야기 1');
    expect(p.lines.team.length).toBe(PROFILE_LIMITS.line);
    expect(p.lines.idle.length).toBe(PROFILE_LIMITS.idle);
  });
  it('게임 데이터: voice는 버리고, NPC는 빈 프로필', () => {
    const { allCharMap } = gameChars();
    expect('voice' in allCharMap.get('char_0001').profile).toBe(false);
    expect(allCharMap.get('char_0001').profile.stories.length).toBe(3);
    expect(allCharMap.get('char_0099').profile).toEqual(emptyProfile());
  });
  it('quote: 있으면 그대로, 비어 있으면 lines.obtain', () => {
    const { allCharMap } = gameChars();
    expect(allCharMap.get('char_0001').quote).toBe('……시논. 척후.');
    expect(allCharMap.get('char_0008').quote).toBe('컷인 대사');
    expect(allCharMap.get('char_0002').quote).toBe('');
    expect(quoteOf({ quote: '  ', profile: { lines: { obtain: '대체' } } })).toBe('대체');
  });
});

describe('profile: 검사 (배포 검사와 같은 규칙)', () => {
  it('올바른 프로필은 문제 없음', () => {
    expect(profileIssues(RAW_PROFILE, ['char_0008', 'char_0099'])).toEqual([]);
    expect(profileIssues(undefined, [])).toEqual([]);
  });
  it('길이 · 개수 · 없는 id · 해금 단계 · samples 개수 · address 키', () => {
    const bad = {
      facts: { age: 'ㄱ'.repeat(41), likes: ['1', '2', '3', '4', '5', '6'] },
      stories: [{ text: 'ㄴ'.repeat(601) }, { text: 'x', unlock: { breakthrough: 7 } }, { text: '' }, { text: 'x' }],
      lines: { team: 'ㄷ'.repeat(41), idle: ['1', '2', '3', '4', '5', '6'] },
      relations: [{ id: 'nobody', note: 'ㄹ'.repeat(61) }],
      voice: { samples: ['하나'], address: { protagonist: '단장', ghost: '유령' } },
    };
    const issues = profileIssues(bad, ['char_0001']).join('\n');
    for (const part of ['facts.age', 'facts.likes', 'stories: 4편', 'stories[0].text', 'stories[1].unlock', 'stories[2].text: 비어', 'lines.team', 'lines.idle', 'relations[0].id', 'relations[0].note', 'voice.samples', 'voice.address: 없는 캐릭터 (ghost)']) {
      expect(issues.includes(part), part).toBe(true);
    }
    expect(issues.includes('protagonist')).toBe(false);
  });
});

describe('profile: 해금 규칙', () => {
  it('미보유: 이야기 전부 잠김, facts/lines/relations 없음', () => {
    const { allCharMap, charMap } = gameChars();
    const v = profileView(allCharMap.get('char_0001'), { save: createNewSave(), allCharMap, charMap });
    expect(v.owned).toBe(false);
    expect(v.facts).toEqual([]);
    expect(v.lines).toEqual([]);
    expect(v.relations).toEqual([]);
    expect(v.stories.every((s) => s.locked && s.text === null)).toBe(true);
  });
  it('보유(돌파 0): facts · lines 보임, 이야기는 잠김 + 해금 단계', () => {
    const { allCharMap, charMap } = gameChars();
    const save = createNewSave();
    own(save, 'char_0001');
    const v = profileView(allCharMap.get('char_0001'), { save, allCharMap, charMap });
    expect(v.facts.map((f) => f.key)).toEqual(['age', 'height', 'origin', 'likes', 'dislikes']);
    expect(v.facts.find((f) => f.key === 'likes').chips).toEqual(['따뜻한 우유', '높은 곳']);
    expect(v.lines.map((l) => l.label)).toEqual(['처음 만났을 때', '편성', '대기 1', '대기 2']);
    expect(v.stories.map((s) => s.need)).toEqual([1, 3, 6]);
    expect(v.stories.every((s) => s.locked)).toBe(true);
  });
  it('돌파 1 / 3 / 6에서 이야기가 하나씩 열림', () => {
    const { allCharMap } = gameChars();
    const c = allCharMap.get('char_0001');
    expect(unlockedStoryIdx(c, 0)).toEqual([]);
    expect(unlockedStoryIdx(c, 1)).toEqual([0]);
    expect(unlockedStoryIdx(c, 5)).toEqual([0, 1]);
    expect(unlockedStoryIdx(c, 6)).toEqual([0, 1, 2]);
    expect(newStoriesAt(c, 2, 3)).toEqual([1]);
    expect(newStoriesAt(c, 3, 4)).toEqual([]);
    expect(newStoriesAt(c, 0, 6)).toEqual([0, 1, 2]);
  });
  it('관계: 상대도 보유해야 보임 (아니면 ???), NPC 상대는 바로 보임, 지워진 상대는 빠짐', () => {
    const { allCharMap, charMap } = gameChars();
    const save = createNewSave();
    own(save, 'char_0001');
    let rel = profileView(allCharMap.get('char_0001'), { save, allCharMap, charMap }).relations;
    expect(rel.map((r) => [r.id, r.known, r.label])).toEqual([
      ['char_0008', false, '???'],
      ['char_0099', true, '보스'],
    ]);
    own(save, 'char_0008');
    rel = profileView(allCharMap.get('char_0001'), { save, allCharMap, charMap }).relations;
    expect(rel[0]).toEqual({ id: 'char_0008', char: allCharMap.get('char_0008'), label: '그 마녀', note: '마법 실력은 인정', known: true });
    const noIrena = new Map([...allCharMap].filter(([id]) => id !== 'char_0008'));
    expect(profileView(allCharMap.get('char_0001'), { save, allCharMap: noIrena, charMap }).relations.length).toBe(1);
  });
  it('일부만 있는 프로필 / 빈 프로필도 화면 데이터가 만들어짐', () => {
    const { allCharMap, charMap } = gameChars();
    const save = createNewSave();
    own(save, 'char_0002');
    own(save, 'char_0008');
    const empty = profileView(allCharMap.get('char_0002'), { save, allCharMap, charMap });
    expect([empty.hasAny, empty.facts.length, empty.stories.length, empty.lines.length, empty.relations.length]).toEqual([false, 0, 0, 0, 0]);
    const partial = profileView(allCharMap.get('char_0008'), { save, allCharMap, charMap });
    expect(partial.lines.map((l) => l.text)).toEqual(['쓰이지 않음']);
  });
});

describe('profile: 읽음 표시 (도감 빨간 점)', () => {
  it('열린 이야기를 안 읽으면 점, 읽으면 사라짐', () => {
    const { allCharMap, charMap } = gameChars();
    const c = allCharMap.get('char_0001');
    const save = createNewSave();
    expect(hasUnseenStory(save, charMap)).toBe(false);
    own(save, 'char_0001', 3);
    expect(unseenStoryCount(save, c)).toBe(2);
    expect(hasUnseenStory(save, charMap)).toBe(true);
    expect(markStorySeen(save, c.id, 0)).toBe(true);
    expect(markStorySeen(save, c.id, 0)).toBe(false);
    markStorySeen(save, c.id, 1);
    expect(save.profileSeen).toEqual({ char_0001: [0, 1] });
    expect(hasUnseenStory(save, charMap)).toBe(false);
    expect(profileView(c, { save, allCharMap, charMap }).stories.map((s) => s.isNew)).toEqual([false, false, false]);
  });
  it('세이브 정리: profileSeen은 없으면 빈 객체, 이상한 값은 버림, 예전 id는 별칭으로 옮김', () => {
    expect(createNewSave().profileSeen).toEqual({});
    expect(sanitize({ ...createNewSave(), profileSeen: undefined }).profileSeen).toEqual({});
    const s = sanitize({ ...createNewSave(), profileSeen: { char_0001: [2, 0, 0, 'x', -1, 99], 'bad id!': [0], char_0002: 'no' } });
    expect(s.profileSeen).toEqual({ char_0001: [0, 2] });
    const moved = remapSaveIds({ profileSeen: { old_a: [0], char_0001: [1] } }, { characters: { old_a: 'char_0001' } });
    expect(moved.profileSeen.char_0001.sort()).toEqual([0, 1]);
  });
  it('대표 · 편성 대사 (lineOf)', () => {
    const { allCharMap } = gameChars();
    const c = allCharMap.get('char_0001');
    expect(lineOf(c, 'team')).toBe('앞은 내가 본다.');
    expect(lineOf(c, 'idle', 3)).toBe('단장, 또 빚졌지.');
    expect(lineOf(c, 'levelUp')).toBe('');
    expect(lineOf(allCharMap.get('char_0002'), 'idle', 1)).toBe('');
  });
});
