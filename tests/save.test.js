// js/core/save.js: 순서 있는 마이그레이션 (v1 → v2 → v3 → v4), 정리(sanitize)
import { describe, it, expect } from './lib/runner.js';
import { migrate, MIGRATIONS, sanitize, SAVE_VERSION, exportCode, parseCode, createNewSave } from '../js/core/save.js';
import { loadConfig } from '../js/config.js';
import { SAVE_V1, SAVE_V2 } from './fixtures/saves.js';
import { SAMPLE_CHARACTERS } from './fixtures/characters.js';

const balance = loadConfig({});
const rarityOf = (id) => SAMPLE_CHARACTERS.find((c) => c.id === id)?.rarity;
const env = { rarityOf, balance };

describe('save: 마이그레이션 목록', () => {
  it('한 칸씩 빈틈없이 최신 버전까지 이어짐', () => {
    MIGRATIONS.forEach((m, i) => {
      expect(m.to, `${i}번째`).toBe(m.from + 1);
      if (i > 0) expect(m.from).toBe(MIGRATIONS[i - 1].to);
    });
    expect(MIGRATIONS.at(-1).to).toBe(SAVE_VERSION);
  });
});

describe('save: v1 → 최신', () => {
  const m = migrate(structuredClone(SAVE_V1), env);
  const s = sanitize(m.raw);
  it('v1 → v2 → v3 → v4 순서로 적용', () => {
    expect(m.applied).toEqual([2, 3, 4]);
    expect(s.v).toBe(SAVE_VERSION);
  });
  it('중복 → 정수 (최대 = 돌파 상한 6), 넘치는 몫은 희귀도별 티켓', () => {
    expect(s.owned.fx_ssr_a.essence).toBe(6);
    expect(s.owned.fx_sr_a.essence).toBe(1);
    expect(s.owned.fx_r_a.essence).toBe(6);
    // 5★ 중복 8 → 넘침 2 × 200, 3★ 중복 6 → 넘침 없음 (+ 데이터에 없는 id: 중복 2 → 정수 2, 넘침 없음)
    expect(m.report.tickets).toBe(400);
    expect(s.tickets).toBe(400);
  });
  it('데이터에 없는 id도 지우지 않음', () => {
    expect(!!s.owned.deleted_char).toBe(true);
    expect(s.owned.deleted_char.essence).toBe(2);
  });
  it('천장 카운트/픽업 확정 유지, 설정은 기본값', () => {
    expect(s.pity).toEqual({ standard: 12, pickup: 3, memory: 0, memoryPickup: 0 });
    expect(s.guaranteed.pickup).toBe(true);
    expect(s.settings).toEqual({ fxSpeed: 1, fxSkip: false, battleSpeed: 1, battleAuto: false });
  });
});

describe('save: v2 → v3', () => {
  const m = migrate(structuredClone(SAVE_V2), env);
  const s = sanitize(m.raw);
  it('v2 → v3 → v4, 정수/티켓 환산 없음', () => {
    expect(m.applied).toEqual([3, 4]);
    expect(m.report).toEqual({ tickets: 0, essence: 0 });
  });
  it('기존 값은 그대로', () => {
    expect(s.owned.fx_ssr_a).toEqual({ level: 12, essence: 1, breakthrough: 2, count: 4, firstAt: '2026-11-01T10:05:00+09:00' });
    expect(s.tickets).toBe(777);
    expect(s.gold).toBe(12345);
    expect(s.pity.standard).toBe(33);
    expect(s.teams.active).toBe(1);
    expect(s.teams.presets[0].name).toBe('주력');
    expect(s.teams.presets[0].slots).toEqual(['fx_ssr_a', null, null, null, null]);
    expect(s.stages.st_01_04.bestRounds).toBe(5);
  });
  it('모르는 id(ghost_id)는 남아 있음', () => {
    expect(s.owned.ghost_id.level).toBe(3);
  });
  it('settings 추가', () => {
    expect(s.settings.fxSpeed).toBe(1);
  });
});

describe('save: v3 → v4 (추억 · 장비 · 장착)', () => {
  const v3 = { ...structuredClone(SAVE_V2), v: 3, settings: { fxSpeed: 2, fxSkip: false, battleSpeed: 1, battleAuto: true } };
  const m = migrate(v3, env);
  const s = sanitize(m.raw);
  it('v3 → v4 하나만, 기존 값 · 설정 유지', () => {
    expect(m.applied).toEqual([4]);
    expect(s.v).toBe(4);
    expect(s.settings.fxSpeed).toBe(2);
    expect(s.owned.fx_ssr_a.breakthrough).toBe(2);
    expect(s.pity.standard).toBe(33);
  });
  it('새 필드는 빈 값 (역할 기본 추억은 불러온 뒤 지급)', () => {
    expect([s.memories, s.memSeq, s.memMat, s.memGranted, s.gear, s.gearMat, s.equips]).toEqual([[], 0, 0, [], {}, 0, {}]);
    expect([s.pity.memory, s.pity.memoryPickup, s.guaranteed.memoryPickup]).toEqual([0, 0, false]);
    expect(s.stages.st_01_04.stars).toBe(0);
  });
  it('정리: 잘못된 추억/장비/장착은 버리고, 추억 한 장은 한 명만, 돌파는 6까지', () => {
    const raw = {
      ...createNewSave(),
      owned: { char_0001: { level: 3, essence: 0, breakthrough: 9, count: 1 }, char_0002: { level: 1, essence: 0, breakthrough: 0, count: 1 } },
      memories: [{ u: 'm1', id: 'memory_0001', lv: 3, r: 2 }, { u: 'm1', id: 'memory_0002' }, { u: 'x', id: 'memory_0003' }, { u: 'm7', id: 'memory_0004', lv: 9999, r: 9 }],
      gear: { 'atk.2.1': { n: 3 }, 'boot.1.0': { n: 1 }, 'hp.1.0': { n: 0 }, 'def.3.0': { n: 0, lock: true } },
      equips: { char_0001: { m: 'm1', g: { atk: '2.1', hp: 'bad' } }, char_0002: { m: 'm1', g: {} }, nobody: { m: 'm7' } },
    };
    const c = sanitize(raw);
    expect(c.owned.char_0001.breakthrough).toBe(6);
    expect(c.memories).toEqual([{ u: 'm1', id: 'memory_0001', lv: 3, r: 2 }, { u: 'm7', id: 'memory_0004', lv: 1000, r: 5 }]);
    expect(c.memSeq).toBe(7);
    expect(c.gear).toEqual({ 'atk.2.1': { n: 3, lock: false }, 'def.3.0': { n: 0, lock: true } });
    expect(c.equips.char_0001).toEqual({ m: 'm1', g: { hp: null, def: null, crit: null, atk: '2.1' } });
    expect(c.equips.char_0002.m).toBe(null);
    expect('nobody' in c.equips).toBe(false);
  });
  it('세이브 코드(TG2:)로 v4도 그대로', () => {
    const r = parseCode(exportCode(s), env);
    expect(r.ok).toBe(true);
    expect(r.save.v).toBe(4);
  });
});

describe('save: 정리(sanitize)', () => {
  it('최신 세이브는 마이그레이션 없음', () => {
    const fresh = createNewSave();
    const m = migrate(fresh, env);
    expect(m.applied).toEqual([]);
    expect(sanitize(m.raw).v).toBe(SAVE_VERSION);
  });
  it('이상한 값에도 예외 없이 새 세이브 모양', () => {
    for (const raw of [null, 7, 'x', [], { owned: 'nope', pity: 5, settings: 'x' }]) {
      const s = sanitize(migrate(raw, env).raw);
      expect(s.v).toBe(SAVE_VERSION);
      expect(typeof s.owned).toBe('object');
    }
  });
  it('settings 값 정리 (2배속/스킵만 허용)', () => {
    const s = sanitize({ ...createNewSave(), settings: { fxSpeed: 9, fxSkip: 'yes', battleSpeed: 2, battleAuto: true } });
    expect(s.settings).toEqual({ fxSpeed: 1, fxSkip: false, battleSpeed: 2, battleAuto: true });
  });
  it('세이브 코드 왕복 + 예전 v2 코드도 불러옴', () => {
    const s = sanitize(migrate(structuredClone(SAVE_V2), env).raw);
    const back = parseCode(exportCode(s), env);
    expect(back.ok).toBe(true);
    expect(back.save.owned.fx_ssr_a.level).toBe(12);
    const oldCode = exportCode(SAVE_V2); // v:2 그대로 내보낸 예전 코드
    const old = parseCode(oldCode, env);
    expect(old.ok).toBe(true);
    expect(old.save.v).toBe(SAVE_VERSION);
    expect(parseCode('TG2:깨진코드', env).ok).toBe(false);
  });
});
