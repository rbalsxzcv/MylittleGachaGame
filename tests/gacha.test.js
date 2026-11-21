// js/systems/gacha.js: 확률, 천장, 10연 확정, 픽업 확정, 빈 희귀도 대체 — 모두 시드 난수로 재현
import { describe, it, expect } from './lib/runner.js';
import { buildPools, pullMany, resolveRarity, simulateStats, rateTable, isPoolEmpty } from '../js/systems/gacha.js';
import { createRng } from '../js/core/rng.js';
import { loadConfig } from '../js/config.js';
import { SAMPLE_CHARACTERS } from './fixtures/characters.js';

const cfg = loadConfig({});
const STANDARD = { id: 'standard', type: 'standard', pickupIds: [] };
const PICKUP = { id: 'p', type: 'pickup', pickupIds: ['fx_ssr_a'] };
const pools = buildPools(SAMPLE_CHARACTERS, STANDARD);

describe('gacha: 풀 만들기', () => {
  it('희귀도별로 나누고 은퇴/스토리 전용은 뺌', () => {
    expect(pools[5].map((c) => c.id)).toEqual(['fx_ssr_a', 'fx_ssr_b']);
    expect(pools[3].map((c) => c.id)).toEqual(['fx_r_a', 'fx_r_b']);
    expect(pools[1].length).toBe(2);
  });
  it('픽업 목록', () => {
    const p = buildPools(SAMPLE_CHARACTERS, PICKUP);
    expect(p.pickup[5].map((c) => c.id)).toEqual(['fx_ssr_a']);
    expect(buildPools(SAMPLE_CHARACTERS, STANDARD).pickup[5].length).toBe(0);
  });
});

describe('gacha: 기본 확률 (천장/확정 없이 10만 회)', () => {
  it('각 희귀도가 설정 확률 ±0.5%p 안', () => {
    const noPity = loadConfig({ gacha: { pity: 1000 } });
    const rand = createRng(12345);
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let pity = 0;
    const N = 100000;
    for (let i = 0; i < N; i++) {
      const out = pullMany({ pools, count: 1, pity: 0, cfg: noPity, rand });
      counts[out.results[0].rarity]++;
      pity = out.pity;
    }
    for (const r of [1, 2, 3, 4, 5]) {
      const pct = (counts[r] / N) * 100;
      expect(Math.abs(pct - cfg.gacha.rates[r]), `${r}★ 관측 ${pct.toFixed(2)}%`).toBeLessThanOrEqual(0.5);
    }
    expect(pity).toBeGreaterThanOrEqual(0);
  });
});

describe('gacha: 10만 회 10연 시뮬 (실제 규칙)', () => {
  const s = simulateStats(buildPools(SAMPLE_CHARACTERS, PICKUP), cfg, { pulls: 100000, rand: createRng(777) });
  it('5★ 없이 70번을 넘기지 않음 (최장 69연속)', () => {
    expect(s.maxSinceTop).toBeLessThanOrEqual(cfg.gacha.pity - 1);
    expect(s.pityHits).toBeGreaterThanOrEqual(1);
  });
  it('모든 10연에 4★ 이상', () => {
    expect(s.tenPullsWithoutHigh).toBe(0);
    expect(s.guaranteeHits).toBeGreaterThanOrEqual(1);
  });
  it('픽업 연속 실패 없음, 5★ 중 픽업 비율 ≈ 2/3', () => {
    expect(s.lostTwiceInRow).toBe(0);
    const ratio = s.pickupWins / s.counts[5];
    expect(ratio, `픽업 비율 ${ratio.toFixed(3)}`).toBeGreaterThanOrEqual(0.62);
    expect(ratio).toBeLessThanOrEqual(0.71);
  });
  it('천장 + 10연 확정 덕분에 실제 5★ 비율은 기본 2%보다 높음 (약 3%)', () => {
    // 천장만: 1 ÷ Σ(0.98^k, k<70) ≈ 2.64%, 여기에 10연 확정(4★+ 중 20%가 5★)이 조금 더해짐
    expect(s.rates[5]).toBeGreaterThanOrEqual(2.5);
    expect(s.rates[5]).toBeLessThanOrEqual(3.5);
  });
});

describe('gacha: 천장', () => {
  it('69회 쌓인 상태 → 다음 1회는 5★ (pity 표시)', () => {
    const out = pullMany({ pools, count: 1, pity: 69, cfg, rand: () => 0.999 /* 원래라면 1★ */ });
    expect(out.results[0].rarity).toBe(5);
    expect(out.results[0].reason).toBe('pity');
    expect(out.pity).toBe(0);
  });
  it('5★가 아니면 카운트 +1', () => {
    const out = pullMany({ pools, count: 1, pity: 10, cfg, rand: () => 0.999 });
    expect(out.results[0].rarity).toBe(1);
    expect(out.pity).toBe(11);
  });
});

describe('gacha: 10연 확정', () => {
  it('앞 9장이 모두 3★ 이하면 10번째는 4★/5★', () => {
    // 항상 1★가 나오는 난수(0.999 → 확률표의 마지막 칸) → 10번째만 확정 규칙
    const out = pullMany({ pools, count: 10, pity: 0, cfg, rand: () => 0.999 });
    expect(out.results.slice(0, 9).every((r) => r.rarity === 1)).toBe(true);
    expect(out.results[9].rarity).toBeGreaterThanOrEqual(4);
    expect(out.results[9].reason).toBe('guarantee');
  });
  it('1회 뽑기에는 확정 없음', () => {
    expect(pullMany({ pools, count: 1, pity: 0, cfg, rand: () => 0.999 }).results[0].reason).toBe(null);
  });
});

describe('gacha: 픽업', () => {
  const p = buildPools(SAMPLE_CHARACTERS, PICKUP);
  it('확정 상태면 5★는 반드시 픽업, 확정이 풀림', () => {
    const out = pullMany({ pools: p, count: 1, pity: 69, guaranteed: true, cfg, rand: () => 0.99 });
    expect(out.results[0].char.id).toBe('fx_ssr_a');
    expect(out.results[0].byGuarantee).toBe(true);
    expect(out.guaranteed).toBe(false);
  });
  it('50%에서 지면 다음은 확정', () => {
    const out = pullMany({ pools: p, count: 1, pity: 69, guaranteed: false, cfg, rand: () => 0.99 });
    expect(out.results[0].char.id).toBe('fx_ssr_b');
    expect(out.results[0].lost).toBe(true);
    expect(out.guaranteed).toBe(true);
  });
});

describe('gacha: 빈 희귀도 대체', () => {
  const only35 = buildPools(SAMPLE_CHARACTERS.filter((c) => c.rarity === 3 || c.rarity === 5), STANDARD);
  it('가까운 낮은 희귀도 → 없으면 가까운 높은 희귀도', () => {
    expect(resolveRarity(4, only35)).toBe(3);
    expect(resolveRarity(5, only35)).toBe(5);
    expect(resolveRarity(1, only35)).toBe(3);
    expect(resolveRarity(2, only35)).toBe(3);
  });
  it('일부 희귀도가 비어도 뽑기는 오류 없이 진행', () => {
    const rand = createRng(5);
    for (let i = 0; i < 200; i++) {
      const out = pullMany({ pools: only35, count: 10, pity: 0, cfg, rand });
      for (const r of out.results) expect([3, 5]).toContain(r.rarity);
    }
  });
  it('전부 비면 isPoolEmpty → pullMany는 명확한 오류', () => {
    const empty = buildPools([], STANDARD);
    expect(isPoolEmpty(empty)).toBe(true);
    expect(() => pullMany({ pools: empty, count: 1, pity: 0, cfg })).toThrow();
  });
});

describe('gacha: 재현성 · 확률표', () => {
  it('같은 시드 → 같은 결과', () => {
    const a = pullMany({ pools, count: 10, pity: 0, cfg, rand: createRng(42) }).results.map((r) => r.char.id);
    const b = pullMany({ pools, count: 10, pity: 0, cfg, rand: createRng(42) }).results.map((r) => r.char.id);
    expect(a).toEqual(b);
  });
  it('확률표: 5개 희귀도, 높은 것부터, 1명당 확률 합 = 희귀도 확률', () => {
    const t = rateTable(buildPools(SAMPLE_CHARACTERS, PICKUP), cfg);
    expect(t.map((r) => r.rarity)).toEqual([5, 4, 3, 2, 1]);
    for (const row of t) {
      const sum = row.characters.reduce((a, x) => a + x.each, 0);
      expect(sum).toBeCloseTo(row.rate, 1e-9);
    }
    expect(t[0].characters[0]).toEqual({ char: SAMPLE_CHARACTERS[8], pickup: true, each: 1 });
  });
});
