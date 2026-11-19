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
