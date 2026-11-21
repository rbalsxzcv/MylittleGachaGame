// HTML 앱 ↔ 가챠 연출 장면 연결
// playGachaFx(results) → 연출이 끝나면(또는 SKIP) 'gachaFxComplete' 이벤트를 보내고 Promise가 풀림
// Phaser를 못 불러오면 연출 없이 바로 끝남 (결과 화면은 항상 나옴)
import { runScene, prefersReducedMotion } from './phaserHost.js';
import { createGachaFxScene } from './GachaFxScene.js';

/** 이미지 미리 불러오기 (결과가 정해지자마자) */
export function preloadResultImages(results) {
  for (const r of results) {
    const src = r.char.cutout || r.char.image;
    if (src) new Image().src = src;
  }
}

/**
 * @param {Array} results 뽑기 결과 (collection.addCharacter 정보가 붙은 것)
 * @param {{speed?:1|2, onSpeed?:(s)=>void, fakeout?:boolean|null, reduced?:boolean}} [o]
 * @returns {Promise<{skipped:boolean, failed?:boolean}>}
 */
export async function playGachaFx(results, { speed = 1, onSpeed, fakeout = null, reduced } = {}) {
  let out;
  try {
    out = await runScene('GachaFx', createGachaFxScene, {
      results,
      speed,
      onSpeed,
      fakeout,
      reduced: reduced ?? prefersReducedMotion(),
    });
  } catch (e) {
    console.warn('[fx] 가챠 연출을 건너뛰어요', e);
    out = { skipped: true, failed: true };
  }
  document.dispatchEvent(new CustomEvent('gachaFxComplete', { detail: out }));
  return out || { skipped: true };
}
