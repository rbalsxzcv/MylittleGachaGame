// js/config.js: 기본값, 예전 balance.json 형식 변환, 희귀도/큰 숫자 도우미
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { loadConfig, DEFAULTS, normalizeRarity, formatBig, rarityLabel, overflowTickets, upgradeLegacyBalance } from '../js/config.js';

// 1단계 전의 data/balance.json 모양 (예전 형식)
const LEGACY = {
  growth: 0.08,
  levelCost: { base: 10, exp: 1.25 },
  levelGoldPerTicket: 10,
  crit: { rate: 0.05, dmg: 0.5 },
  rarityStats: { R: { atk: 100, def: 40, hp: 900 }, SR: { atk: 115, def: 46, hp: 1035 }, SSR: { atk: 130, def: 52, hp: 1170 } },
  energy: { max: 100, basic: 20, skill: 30, hit: 10, ultimateCost: 100 },
  essenceTickets: { SSR: 200, SR: 80, R: 30 },
  maxBreakthrough: 5,
  dailyTickets: 30,
  dailyGold: 3000,
  power: { atk: 2, def: 1.5, hp: 0.2, critRate: 300, critDmg: 100 },
  powerWarnPct: 25,
  maxRounds: 200,
};

describe('config: 희귀도', () => {
  it('1–5 정수와 예전 R/SR/SSR을 받음', () => {
    expect(normalizeRarity(1)).toBe(1);
    expect(normalizeRarity('5')).toBe(5);
    expect(normalizeRarity('R')).toBe(3);
    expect(normalizeRarity('SR')).toBe(4);
    expect(normalizeRarity('SSR')).toBe(5);
  });
  it('범위 밖/이상한 값은 null', () => {
    for (const v of [0, 6, 2.5, 'UR', null, undefined, true, '']) expect(normalizeRarity(v), String(v)).toBe(null);
  });
  it('표시 이름', () => {
    expect(rarityLabel(4)).toBe('4★');
    expect(rarityLabel('SSR')).toBe('5★');
  });
});

describe('config: 큰 숫자 표기', () => {
  it('만 / 억 단위, 소수 첫째 자리 내림', () => {
    expect(formatBig(9876)).toBe('9,876');
    expect(formatBig(12345)).toBe('1.2만');
    expect(formatBig(10000)).toBe('1만');
    expect(formatBig(19999)).toBe('1.9만');
    expect(formatBig(123456789)).toBe('1.2억');
    expect(formatBig(-25000)).toBe('-2.5만');
    expect(formatBig(0)).toBe('0');
  });
});

describe('config: loadConfig', () => {
  it('빈 파일 → 기본값 (사양 숫자)', () => {
    const c = loadConfig({});
    expect(c.gacha.rates).toEqual({ 1: 40, 2: 30, 3: 20, 4: 8, 5: 2 });
    expect(c.gacha.pity).toBe(70);
    expect(c.gacha.cost).toEqual({ single: 100, ten: 1000 });
    expect(c.gacha.tenGuaranteeMin).toBe(4);
    expect(c.stats.growth).toBe(0.08);
    expect(c.stats.critRate).toBe(0.05);
    expect(c.combat.sp).toEqual({ start: 3, max: 5, basicGain: 1, skillCost: 1 });
    expect(c.combat.energy).toEqual({ max: 100, basic: 20, skill: 30, hit: 10, ultimateCost: 100 });
    expect(c.essence.overflowTickets).toEqual({ 1: 30, 2: 30, 3: 30, 4: 80, 5: 200 });
    expect(c.daily.tickets).toBe(30);
  });
  it('예전 형식 → 새 형식 (값 유지, R/SR/SSR → 3/4/5★)', () => {
    const c = loadConfig(LEGACY);
    expect(c.stats.byRarity[3]).toEqual({ atk: 100, def: 40, hp: 900, spd: 100 });
    expect(c.stats.byRarity[5]).toEqual({ atk: 130, def: 52, hp: 1170, spd: 105 });
    expect(c.stats.byRarity[1]).toEqual(DEFAULTS.stats.byRarity[1]);
    expect(c.level).toEqual({ costBase: 10, costExp: 1.25, goldPerTicket: 10 });
    expect(c.essence.overflowTickets[5]).toBe(200);
    expect(c.essence.overflowTickets[4]).toBe(80);
    expect(c.essence.overflowTickets[3]).toBe(30);
    expect(c.powerWarnPct).toBe(25);
    expect(c.combat.maxRounds).toBe(200);
    expect(c.power.spd).toBe(DEFAULTS.power.spd);
  });
  it('새 형식은 그대로 통과 (upgradeLegacyBalance가 건드리지 않음)', () => {
    const j = { gacha: { pity: 90 } };
    expect(upgradeLegacyBalance(j)).toBe(j);
    expect(loadConfig(j).gacha.pity).toBe(90);
  });
  it('범위 밖 값은 잘리고, 확률이 모두 0이면 기본 확률', () => {
    const warns = [];
    const c = loadConfig({ gacha: { rates: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, pickupShare: 3 }, stats: { growth: -1 } }, null, (m) => warns.push(m));
    expect(c.gacha.rates[5]).toBe(2);
    expect(c.gacha.pickupShare).toBe(1);
    expect(c.stats.growth).toBe(0);
    expect(warns.length).toBe(1);
  });
  it('이상한 입력에도 예외 없음', () => {
    for (const j of [null, undefined, 42, 'x', [], { gacha: 'no', stats: [1] }]) loadConfig(j);
  });
  it('정수 → 티켓 환산', () => {
    const c = loadConfig({});
    expect(overflowTickets(5, c)).toBe(200);
    expect(overflowTickets(4, c)).toBe(80);
    expect(overflowTickets(1, c)).toBe(30);
    expect(overflowTickets('SSR', c)).toBe(200);
  });
  it('지금 data/balance.json이 새 형식이고 기본값과 같은 사양 숫자', async () => {
    const j = await loadJson('data/balance.json');
    expect('rarityStats' in j, '예전 키가 남아 있으면 안 됨').toBe(false);
    const c = loadConfig(j);
    expect(c.gacha.rates).toEqual(DEFAULTS.gacha.rates);
    expect(c.gacha.pity).toBe(70);
    expect(c.powerWarnPct).toBe(15);
  });
});
