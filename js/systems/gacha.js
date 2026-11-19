// 가챠(뽑기) 규칙 — 화면과 분리된 순수 함수들이라 콘솔에서 시뮬레이션/테스트 가능
//
// 규칙
// - 확률: R 79% / SR 18% / SSR 3%
// - 천장: SSR 없이 50번째 뽑기는 SSR 확정 (SSR이 나오면 카운트 0으로)
// - 10연차: 앞 9장이 모두 R이면 10번째는 SR 이상 (SR 97% / SSR 3%)
// - 희귀도 풀이 비어 있으면 다른 희귀도로 대체 (오류 없음)

import { random, pickOne } from '../core/rng.js';

export const RATES = { R: 79, SR: 18, SSR: 3 };
export const GUARANTEE_RATES = { R: 0, SR: 97, SSR: 3 };
export const COST = { 1: 100, 10: 1000 };
export const PITY_LIMIT = 50;

// 뽑힌 희귀도에 캐릭터가 없을 때 시도할 순서
const FALLBACK_ORDER = {
  SSR: ['SSR', 'SR', 'R'],
  SR: ['SR', 'R', 'SSR'],
  R: ['R', 'SR', 'SSR'],
};
const GUARANTEE_ORDER = ['SR', 'SSR', 'R'];

/** 기본(상시) 배너. Phase 3에서는 banners.json의 데이터가 같은 모양으로 들어옵니다. */
export const STANDARD_BANNER = {
  id: 'standard',
  title: '상시 모집',
  type: 'standard',
  pityKey: 'standard',
  description: '모든 캐릭터가 등장하는 상시 모집입니다.\n50회 안에 SSR이 나오지 않으면 50번째는 SSR 확정!',
  bannerImage: '',
};

/** 배너에 등장하는 캐릭터를 희귀도별로 나눔 */
export function buildPools(characters /*, banner */) {
  const pools = { R: [], SR: [], SSR: [] };
  for (const c of characters) pools[c.rarity]?.push(c);
  return pools;
}

export function isPoolEmpty(pools) {
  return pools.R.length + pools.SR.length + pools.SSR.length === 0;
}

/** 확률표에 따라 희귀도 하나를 뽑음 */
export function rollRarity(rates, rand = random) {
  const total = rates.R + rates.SR + rates.SSR;
  let r = rand() * total;
  for (const key of ['SSR', 'SR', 'R']) {
    if (r < rates[key]) return key;
    r -= rates[key];
  }
  return 'R';
}

/** 풀이 비어 있으면 대체 희귀도를 찾음. 모두 비어 있으면 null */
export function resolveRarity(rarity, pools, order = FALLBACK_ORDER[rarity]) {
  return order.find((r) => pools[r].length > 0) ?? null;
}

/**
 * 뽑기 실행 (세이브는 바꾸지 않음)
 * @param {{pools:object, count:number, pity:number, rand?:Function}} opts
 * @returns {{results:Array<{char:object, rarity:string, reason:null|'pity'|'guarantee'}>, pity:number}}
 */
export function pullMany({ pools, count, pity, rand = random }) {
  if (isPoolEmpty(pools)) throw new Error('뽑을 캐릭터가 없습니다');

  const results = [];
  let counter = pity;
  let hasSrPlus = false;

  for (let i = 0; i < count; i++) {
    counter += 1;
    let rolled;
    let order;
    let reason = null;

    if (counter >= PITY_LIMIT) {
      // 천장 우선
      rolled = 'SSR';
      reason = 'pity';
    } else if (count >= 10 && i === count - 1 && !hasSrPlus) {
      // 10연차 SR 이상 확정
      rolled = rollRarity(GUARANTEE_RATES, rand);
      order = rolled === 'SSR' ? FALLBACK_ORDER.SSR : GUARANTEE_ORDER;
      reason = 'guarantee';
    } else {
      rolled = rollRarity(RATES, rand);
    }

    const rarity = resolveRarity(rolled, pools, order);
    const char = pickOne(pools[rarity], rand);
    if (rolled === 'SSR' || rarity === 'SSR') counter = 0;
    if (rarity !== 'R') hasSrPlus = true;
    results.push({ char, rarity, reason });
  }

  return { results, pity: counter };
}

/** 확률 정보 표: 희귀도별 확률과 캐릭터 1명당 확률 */
export function rateTable(pools) {
  return ['SSR', 'SR', 'R'].map((rarity) => {
    const list = pools[rarity];
    return {
      rarity,
      rate: RATES[rarity],
      each: list.length ? RATES[rarity] / list.length : 0,
      characters: list,
    };
  });
}

/**
 * 개발용 시뮬레이션 (세이브를 건드리지 않음)
 * 콘솔에서: __tg.simulate(100000)
 */
export function simulate(pools, totalPulls = 100000) {
  const counts = { R: 0, SR: 0, SSR: 0 };
  const reasons = { pity: 0, guarantee: 0 };
  let pity = 0;
  let sinceSsr = 0;
  let maxSinceSsr = 0;
  let tenPullsWithoutSrPlus = 0;
  const tenPulls = Math.ceil(totalPulls / 10);

  for (let t = 0; t < tenPulls; t++) {
    const out = pullMany({ pools, count: 10, pity });
    pity = out.pity;
    if (!out.results.some((r) => r.rarity !== 'R')) tenPullsWithoutSrPlus++;
    for (const r of out.results) {
      counts[r.rarity]++;
      if (r.reason) reasons[r.reason]++;
      sinceSsr = r.rarity === 'SSR' ? 0 : sinceSsr + 1;
      maxSinceSsr = Math.max(maxSinceSsr, sinceSsr);
    }
  }

  const n = tenPulls * 10;
  const pct = (v) => `${((v / n) * 100).toFixed(2)}%`;
  const summary = {
    뽑기횟수: n,
    R: `${counts.R} (${pct(counts.R)})`,
    SR: `${counts.SR} (${pct(counts.SR)})`,
    SSR: `${counts.SSR} (${pct(counts.SSR)})`,
    천장발동: reasons.pity,
    '10연SR확정발동': reasons.guarantee,
    'SR+없는10연(0이어야정상)': tenPullsWithoutSrPlus,
    'SSR없이최장연속(49이하정상)': maxSinceSsr,
  };
  console.table(summary);
  return summary;
}
