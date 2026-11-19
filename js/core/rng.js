// 난수 유틸 — 브라우저의 암호학적 난수(crypto.getRandomValues)를 사용합니다.

const buf = new Uint32Array(1);

/** 0 이상 1 미만의 난수 */
export function random() {
  if (globalThis.crypto && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296; // 2^32
  }
  return Math.random(); // 아주 오래된 환경 대비
}

/** 배열에서 하나를 무작위로 고름 (빈 배열이면 undefined) */
export function pickOne(list, rand = random) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(rand() * list.length)];
}

/**
 * 시드 난수 (mulberry32) — 같은 시드면 항상 같은 순서의 난수.
 * 전투 엔진의 재현(리플레이)과 밸런스 시뮬레이션에 씁니다.
 * @param {number} seed 32비트 정수
 * @returns {() => number} 0 이상 1 미만
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 새 전투용 무작위 시드 */
export function randomSeed() {
  return Math.floor(random() * 4294967296) >>> 0;
}
