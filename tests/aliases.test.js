// 콘텐츠 id 별칭(data/id_aliases.json): 예전 id로 기록된 세이브가 새 id로 옮겨지는지
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { loadGameData } from './lib/gameData.js';
import { remapSaveIds, resolverOf } from '../js/core/aliases.js';
import { migrate, sanitize, exportCode, parseCode, createNewSave } from '../js/core/save.js';
import { loadConfig } from '../js/config.js';
import '../js/systems/shop.js'; // 상점 세이브 영역(registerSaveSlice) 등록

const aliases = await loadJson('data/id_aliases.json');
const data = await loadGameData({ stories: true });
const balance = loadConfig({});
// 세이브 옮기기 검사용 별칭: 실제 별칭 + 스테이지/스토리 예시
// (예전 1챕터를 새 1챕터로 바꾸면서 실제 별칭의 스테이지/스토리 줄은 정리됨 — 가리키던 콘텐츠가 없어서)
const testAliases = {
  ...aliases,
  stages: { st_01_04: 'stage_0004', ...(aliases.stages || {}) },
  stories: { main_01_01: 'story_0001', main_01_04: 'story_0004', ...(aliases.stories || {}) },
};
const env = { rarityOf: (id) => data.charMap.get(id)?.rarity, balance, aliases: testAliases };

/** 예전 id로 가득한 v3 세이브 */
function oldSave() {
  const s = createNewSave();
  s.owned = { ssr_valeria: { level: 30, essence: 1, breakthrough: 2, count: 4, firstAt: s.createdAt }, sr_1: { level: 5, essence: 0, breakthrough: 0, count: 1, firstAt: s.createdAt } };
  s.knownIds = ['ssr_valeria', 'sr_1', 'r_garrick'];
  s.newIds = ['r_garrick'];
  s.featuredId = 'ssr_valeria';
  s.teams.presets[0].slots = ['ssr_valeria', 'sr_1', null, null, null];
  s.stages = { st_01_04: { clears: 3, firstClaimed: true, bestRounds: 5 } };
  s.readStories = { main_01_01: '2026-11-01T00:00:00+09:00', main_01_04: '2026-11-02T00:00:00+09:00' };
  s.claimedMail = ['mail_mwp45sw1'];
  s.shop = { bought: { cash_first_purchase: 1, gold_free_gift: 3 }, period: { gold_free_gift: { key: '2026-11-20', n: 1 } }, spentKRW: 1200, pass: { until: null, lastClaim: null, dailyGems: 0 } };
  return s;
}

describe('id 별칭: 세이브 옮기기', () => {
  const s = sanitize(migrate(oldSave(), env).raw);
  it('보유 / 도감 기록 / 대표 / 편성 → 새 캐릭터 id', () => {
    expect(Object.keys(s.owned).sort()).toEqual(['char_0001', 'char_0002']);
    expect(s.owned.char_0002.level).toBe(30);
    expect(s.knownIds).toEqual(['char_0002', 'char_0001', 'char_0003']);
    expect(s.newIds).toEqual(['char_0003']);
    expect(s.featuredId).toBe('char_0002');
    expect(s.teams.presets[0].slots).toEqual(['char_0002', 'char_0001', null, null, null]);
  });
  it('스테이지 / 읽은 스토리 / 받은 우편 / 상점 구매 기록 → 새 id', () => {
    expect(s.stages).toEqual({ stage_0004: { clears: 3, firstClaimed: true, bestRounds: 5 } });
    expect(Object.keys(s.readStories).sort()).toEqual(['story_0001', 'story_0004']);
    expect(s.claimedMail).toEqual(['mail_0001']);
    expect(s.shop.bought).toEqual({ shop_0007: 1, shop_0001: 3 });
    expect(s.shop.period.shop_0001.n).toBe(1);
  });
  it('여러 번 해도 같음 (이미 새 id면 그대로)', () => {
    const again = sanitize(migrate(structuredClone(s), env).raw);
    expect(again.owned).toEqual(s.owned);
    expect(again.stages).toEqual(s.stages);
  });
  it('v1 세이브(예전 id) → 정수 환산도 새 id 기준 희귀도로', () => {
    const v1 = { v: 1, gems: 0, owned: { ssr_valeria: { count: 9, firstAt: '2026-11-01T00:00:00+09:00' } } };
    const m = migrate(v1, env);
    // 5★: 중복 8 → 정수 5 + 넘침 3 × 200
    expect(m.raw.owned.char_0002.essence).toBe(5);
    expect(m.report.tickets).toBe(600);
  });
  it('예전 세이브 코드(예전 id)도 새 id로 불러옴', () => {
    const r = parseCode(exportCode(oldSave()), env);
    expect(r.ok).toBe(true);
    expect(r.save.owned.char_0002.breakthrough).toBe(2);
  });
  it('예전 id와 새 id 기록이 둘 다 있으면 합침 (성장한 쪽, 횟수는 더함)', () => {
    const raw = { owned: { ssr_valeria: { level: 30, breakthrough: 2, essence: 1, count: 4 }, char_0002: { level: 2, breakthrough: 0, essence: 3, count: 1 } }, stages: { st_01_04: { clears: 2, firstClaimed: true, bestRounds: 6 }, stage_0004: { clears: 1, firstClaimed: false, bestRounds: 4 } }, teams: { presets: [{ slots: ['ssr_valeria', 'char_0002', null, null, null] }] } };
    const out = remapSaveIds(raw, testAliases);
    expect(out.owned.char_0002).toEqual({ level: 30, breakthrough: 2, essence: 3, count: 5 });
    expect(out.stages.stage_0004).toEqual({ clears: 3, firstClaimed: true, bestRounds: 4 });
    expect(out.teams.presets[0].slots).toEqual(['char_0002', null, null, null, null]);
  });
  it('별칭이 이어져 있으면 끝까지 (a → b → c), 순환이어도 멈춤', () => {
    expect(resolverOf({ characters: { a: 'b', b: 'c' } }, 'characters')('a')).toBe('c');
    expect(typeof resolverOf({ characters: { a: 'b', b: 'a' } }, 'characters')('a')).toBe('string');
  });
});

describe('id 별칭: 데이터', () => {
  // 새 id가 나중에 삭제됐을 수 있어서(예: 캐릭터 삭제, 챕터 교체) '지금 있는지'가 아니라 그 종류의 id 규칙인지를 봄
  // (삭제한 id는 다시 발급되지 않으니 별칭이 엉뚱한 새 콘텐츠를 가리킬 일은 없음)
  it('별칭이 가리키는 새 id는 그 종류의 자동 id 규칙 (<종류>_<4자리>)', () => {
    const prefix = { characters: 'char', enemies: 'enemy', stages: 'stage', stories: 'story', banners: 'banner', notices: 'notice', mail: 'mail', shop: 'shop' };
    for (const [kind, map] of Object.entries(aliases)) {
      expect(kind in prefix, `모르는 별칭 종류: ${kind}`).toBe(true);
      for (const [from, to] of Object.entries(map || {})) expect(new RegExp(`^${prefix[kind]}_\\d{4,}$`).test(to), `${kind}: ${from} → ${to}`).toBe(true);
    }
  });
  it('지금 데이터의 id는 모두 자동 규칙 (<종류>_<4자리>)', () => {
    const rule = { characters: 'char', enemies: 'enemy', stages: 'stage', storyIndex: 'story', banners: 'banner' };
    for (const [key, prefix] of Object.entries(rule)) {
      for (const x of data[key]) expect(new RegExp(`^${prefix}_\\d{4,}$`).test(x.id), `${key}: ${x.id}`).toBe(true);
    }
  });
});
