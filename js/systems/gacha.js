// 가챠(뽑기) 규칙 — 화면과 분리된 순수 함수. 난수(rand)와 설정(cfg)을 인자로 받아서 시드로 재현/테스트 가능
//
// 규칙 (숫자는 balance.gacha → config.js)
// - 희귀도 1–5, 확률 40/30/20/8/2 %
// - 천장: 5★ 없이 70번째 뽑기는 5★ (5★가 나오면 카운트 0). 상시/픽업 배너는 카운트를 따로 셉니다.
// - 10연차: 앞 9장에 4★ 이상이 없으면 10번째는 4★/5★ (기본 확률 비율 8:2 그대로)
// - 픽업: 5★가 나오면 50% 확률로 픽업 캐릭터. 놓치면 다음 5★는 픽업 확정
//   (4★ 이하 픽업이 있으면 그 희귀도에서 50%로 픽업, 확정 없음)
// - 뽑힌 희귀도에 캐릭터가 없으면 가까운 낮은 희귀도 → 그래도 없으면 가까운 높은 희귀도 (오류 없음)
// - 중복 → 정수 변환은 collection.js가 처리 (여기는 누가 나왔는지만 정함)

import { random, pickOne } from '../core/rng.js';
import { RARITIES, MAX_RARITY, isNpc } from '../config.js';

/** 기본(상시) 배너. banners.json에 진행 중인 상시 배너가 없을 때 사용 */
export const STANDARD_BANNER = {
  id: 'standard',
  title: '상시 모집',
  type: 'standard',
  pickupIds: [],
  startAt: null,
  endAt: null,
  description: '모든 캐릭터가 등장하는 상시 모집입니다.',
  bannerImage: '',
  relatedStoryId: null,
};

/** 기본 추억 뽑기 배너 (진행 중인 추억 상시 배너가 없을 때, 추억 데이터가 있으면) */
export const STANDARD_MEMORY_BANNER = {
  id: 'memory_standard',
  title: '추억 뽑기',
  type: 'standard',
  category: 'memory',
  pickupIds: [],
  startAt: null,
  endAt: null,
  description: '모든 추억 카드가 나오는 상시 뽑기예요.',
  bannerImage: '',
  relatedStoryId: null,
};

/** 추억 뽑기 배너인지 */
export const isMemoryBanner = (banner) => banner?.category === 'memory';

/** 배너 종류별 천장/확정 저장 키 (캐릭터 상시/픽업 · 추억 상시/픽업 따로) */
export const pityKeyOf = (banner) => (isMemoryBanner(banner) ? (banner.type === 'pickup' ? 'memoryPickup' : 'memory') : banner?.type === 'pickup' ? 'pickup' : 'standard');

/** 이 배너의 뽑기 규칙 (pullMany/rateTable의 cfg 모양) — 추억은 balance.memoryGacha (1·2★ 확률 0) */
export function rulesFor(banner, balance) {
  if (!isMemoryBanner(banner)) return balance;
  const g = balance.memoryGacha;
  return { ...balance, gacha: { ...g, rates: { 1: 0, 2: 0, ...g.rates } } };
}

/** 이 배너에서 나오는 것 (캐릭터 또는 추억) */
export const poolSourceOf = (banner, data) => (isMemoryBanner(banner) ? data.memories || [] : data.characters);

const emptyByRarity = () => Object.fromEntries(RARITIES.map((r) => [r, []]));

/** 배너에 등장하는 캐릭터를 희귀도별로 나눔 (+ 픽업 목록). NPC 등급·은퇴(retired)는 빠짐 — 매번 데이터에서 새로 만들어서 등급을 바꾸면 바로 따라감 */
export function buildPools(characters, banner) {
  const pools = { ...emptyByRarity(), pickup: emptyByRarity() };
  const pickupIds = new Set(banner?.type === 'pickup' ? banner.pickupIds || [] : []);
  for (const c of characters) {
    if (!pools[c.rarity] || isNpc(c) || c.retired) continue;
    pools[c.rarity].push(c);
    if (pickupIds.has(c.id)) pools.pickup[c.rarity].push(c);
  }
  return pools;
}

export function isPoolEmpty(pools) {
  return RARITIES.every((r) => pools[r].length === 0);
}

/** 모든 픽업 캐릭터 (높은 희귀도부터) */
export const pickupList = (pools) => [...RARITIES].reverse().flatMap((r) => pools.pickup[r]);

/** 확률표에 따라 희귀도 하나를 뽑음. only를 주면 그 희귀도들 안에서만 (비율은 그대로) */
export function rollRarity(rates, rand = random, only = RARITIES) {
  const total = only.reduce((a, r) => a + (rates[r] || 0), 0);
  if (total <= 0) return only[only.length - 1];
  let x = rand() * total;
  for (const r of [...only].reverse()) {
    const w = rates[r] || 0;
    if (x < w) return r;
    x -= w;
  }
  return only[0];
}

/** 풀이 비어 있으면 대체 희귀도: 가까운 낮은 희귀도 → 가까운 높은 희귀도. 모두 비어 있으면 null */
export function resolveRarity(rarity, pools) {
  for (let r = rarity; r >= 1; r--) if (pools[r]?.length) return r;
  for (let r = rarity + 1; r <= MAX_RARITY; r++) if (pools[r]?.length) return r;
  return null;
}

/** 정해진 희귀도 안에서 캐릭터 고르기 (픽업 처리 포함). state.guaranteed를 갱신 */
function pickCharacter(pools, rarity, state, cfg, rand) {
  const all = pools[rarity];
  const pickups = pools.pickup?.[rarity] ?? [];
  if (!pickups.length) return { char: pickOne(all, rand), isPickup: false };

  const others = all.filter((c) => !pickups.includes(c));
  if (rarity === MAX_RARITY) {
    const byGuarantee = state.guaranteed;
    const win = byGuarantee || others.length === 0 || rand() < cfg.gacha.pickupShare;
    state.guaranteed = !win; // 픽업 실패 → 다음 5★는 픽업 확정
    return win ? { char: pickOne(pickups, rand), isPickup: true, byGuarantee } : { char: pickOne(others, rand), isPickup: false, lost: true };
  }
  const win = others.length === 0 || rand() < cfg.gacha.pickupShare;
  return { char: pickOne(win ? pickups : others, rand), isPickup: win };
}

/**
 * 뽑기 실행 (세이브는 바꾸지 않음)
 * @param {object} o
 * @param {object} o.pools buildPools 결과
 * @param {number} o.count 1 또는 10
 * @param {number} o.pity 지금까지 5★ 없이 뽑은 횟수
 * @param {boolean} [o.guaranteed] 다음 5★ 픽업 확정 여부
 * @param {object} o.cfg 설정 (loadConfig 결과)
 * @param {()=>number} [o.rand] 0~1 난수 (테스트는 createRng(seed))
 * @returns {{results:Array<{char:object, rarity:number, rolled:number, reason:null|'pity'|'guarantee', isPickup:boolean, lost?:boolean, byGuarantee?:boolean}>,
 *            pity:number, guaranteed:boolean}}
 */
export function pullMany({ pools, count, pity, guaranteed = false, cfg, rand = random }) {
  if (isPoolEmpty(pools)) throw new Error('뽑을 캐릭터가 없습니다');
  const g = cfg.gacha;
  const minGuarantee = Math.min(MAX_RARITY, g.tenGuaranteeMin);
  const guaranteeRarities = RARITIES.filter((r) => r >= minGuarantee);

  const results = [];
  const state = { guaranteed };
  let counter = pity;
  let hasHigh = false;

  for (let i = 0; i < count; i++) {
    counter += 1;
    let rolled;
    let reason = null;
    if (counter >= g.pity) {
      rolled = MAX_RARITY; // 천장 우선
      reason = 'pity';
    } else if (count >= 10 && i === count - 1 && !hasHigh) {
      rolled = rollRarity(g.rates, rand, guaranteeRarities); // 10연차 확정
      reason = 'guarantee';
    } else {
      rolled = rollRarity(g.rates, rand);
    }

    const rarity = resolveRarity(rolled, pools);
    const picked = pickCharacter(pools, rarity, state, cfg, rand);
    if (rolled === MAX_RARITY || rarity === MAX_RARITY) counter = 0;
    if (rarity >= minGuarantee) hasHigh = true;
    results.push({ rarity, rolled, reason, ...picked });
  }

  return { results, pity: counter, guaranteed: state.guaranteed };
}

/** 확률 정보 표: 희귀도별 확률과 캐릭터 1명당 확률 (높은 희귀도부터, 픽업 표시 포함) */
export function rateTable(pools, cfg) {
  return [...RARITIES].reverse().map((rarity) => {
    const all = pools[rarity];
    const pickups = pools.pickup?.[rarity] ?? [];
    const others = all.filter((c) => !pickups.includes(c));
    const rate = cfg.gacha.rates[rarity];
    const share = cfg.gacha.pickupShare;
    const pickupTotal = pickups.length ? (others.length ? rate * share : rate) : 0;
    const othersTotal = rate - pickupTotal;
    const characters = [
      ...pickups.map((c) => ({ char: c, pickup: true, each: pickupTotal / pickups.length })),
      ...others.map((c) => ({ char: c, pickup: false, each: othersTotal / others.length })),
    ];
    return { rarity, rate, count: all.length, characters };
  });
}

/**
 * 시뮬레이션 (세이브를 건드리지 않음) — 개발 도구 가챠 시뮬, 테스트, 콘솔(__tg.simulate)이 같이 씀
 * @returns {object} 숫자 결과 (counts, rates %, pityHits, guaranteeHits, maxSinceTop, tenPullsWithoutHigh, pickupWins, lostTwiceInRow, n)
 */
export function simulateStats(pools, cfg, { pulls = 100000, rand = random } = {}) {
  const counts = Object.fromEntries(RARITIES.map((r) => [r, 0]));
  let pity = 0;
  let guaranteed = false;
  let sinceTop = 0;
  let maxSinceTop = 0;
  let tenPullsWithoutHigh = 0;
  let pityHits = 0;
  let guaranteeHits = 0;
  let pickupWins = 0;
  let lostTwiceInRow = 0;
  let lastLost = false;
  const tens = Math.ceil(pulls / 10);
  for (let t = 0; t < tens; t++) {
    const out = pullMany({ pools, count: 10, pity, guaranteed, cfg, rand });
    pity = out.pity;
    guaranteed = out.guaranteed;
    if (!out.results.some((r) => r.rarity >= cfg.gacha.tenGuaranteeMin)) tenPullsWithoutHigh++;
    for (const r of out.results) {
      counts[r.rarity]++;
      if (r.reason === 'pity') pityHits++;
      if (r.reason === 'guarantee') guaranteeHits++;
      sinceTop = r.rarity === MAX_RARITY ? 0 : sinceTop + 1;
      maxSinceTop = Math.max(maxSinceTop, sinceTop);
      if (r.rarity === MAX_RARITY) {
        if (r.isPickup) pickupWins++;
        if (r.lost && lastLost) lostTwiceInRow++;
        lastLost = !!r.lost;
      }
    }
  }
  const n = tens * 10;
  const rates = Object.fromEntries(RARITIES.map((r) => [r, (counts[r] / n) * 100]));
  return { n, counts, rates, pityHits, guaranteeHits, maxSinceTop, tenPullsWithoutHigh, pickupWins, lostTwiceInRow };
}

/** 콘솔용: 결과를 표로 출력. __tg.simulate(100000) / __tg.simulate(100000, '배너id') */
export function simulate(pools, cfg, totalPulls = 100000) {
  const s = simulateStats(pools, cfg, { pulls: totalPulls });
  const pct = (v, total = s.n) => `${((v / Math.max(1, total)) * 100).toFixed(2)}%`;
  const summary = { 뽑기횟수: s.n };
  for (const r of [...RARITIES].reverse()) summary[`${r}★ (설정 ${cfg.gacha.rates[r]}%)`] = `${s.counts[r]} (${pct(s.counts[r])})`;
  Object.assign(summary, {
    천장발동: s.pityHits,
    '10연확정발동': s.guaranteeHits,
    [`${cfg.gacha.tenGuaranteeMin}★+없는10연(0이어야정상)`]: s.tenPullsWithoutHigh,
    [`5★없이최장연속(${cfg.gacha.pity - 1}이하정상)`]: s.maxSinceTop,
    '5★중픽업비율(픽업배너≈66%)': pct(s.pickupWins, s.counts[MAX_RARITY]),
    '픽업연속실패(0이어야정상)': s.lostTwiceInRow,
  });
  console.table(summary);
  return summary;
}
