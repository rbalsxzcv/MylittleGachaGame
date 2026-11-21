// 컷인 (재사용 컴포넌트) — 가챠(5★ / 새 4★)와 전투 궁극기(short)에서 같이 씀
//
// 층(패럴랙스): 뒤 배경 띠 + 큰 영문 이름(느림) → 캐릭터 그림(보통) → 속도선·파티클(빠름), 카메라 천천히 확대
// 앞: 칭호, 글자마다 빛나며 나타나는 이름, 첫 대사 자막, NEW 배지(맥박)
// 탭하면 바로 끝남(skip). reduced = 움직임 없이 페이드만.
// 캐릭터 그림 텍스처 키는 charTextureKey(id) — 부르는 쪽에서 미리 불러 둡니다.

import { FONT, hexToInt, rarityColor } from './phaserHost.js';

export const charTextureKey = (id) => `char:${id}`;

/** 캐릭터 그림을 로더에 올림 (이미 있으면 건너뜀). 실제 로드는 scene.load.start() 또는 preload 단계에서 */
export function queueCharTexture(scene, char, url) {
  const key = charTextureKey(char.id);
  if (!url || scene.textures.exists(key)) return key;
  scene.load.image(key, url);
  return key;
}

const lighten = (c, t) => {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const f = (x) => Math.round(x + (255 - x) * t);
  return (f(r) << 16) | (f(g) << 8) | f(b);
};

/**
 * @param {Phaser.Scene} scene
 * @param {object} char 캐릭터 데이터 {id, name, nameEn, title, quote, themeColor, rarity}
 * @param {{isNew?:boolean, short?:boolean, reduced?:boolean, quality?:number, label?:string}} [o]
 *   label: 이름 대신/위에 보여 줄 글 (예: 궁극기 이름)
 * @returns {{done: Promise<void>, skip: () => void}}
 */
export function playCutIn(scene, char, { isNew = false, short = false, reduced = false, quality = 1, label = '' } = {}) {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const theme = hexToInt(char.themeColor, rarityColor(char.rarity || 5));
  const light = lighten(theme, 0.55);
  const tIn = short ? 180 : 420;
  const hold = short ? 520 : 2100;
  const tOut = short ? 160 : 300;
  const root = scene.add.container(0, 0).setDepth(800);
  const cam = scene.cameras.main;
  const tweens = [];
  const tw = (cfg) => {
    const t = scene.tweens.add(cfg);
    tweens.push(t);
    return t;
  };

  // ── 뒤 배경 ──
  const dim = scene.add.rectangle(0, 0, W, H, 0x05030a, 1).setOrigin(0).setAlpha(0);
  const band = scene.add.graphics();
  band.fillStyle(theme, 0.32);
  band.fillPoints([{ x: 0, y: H * 0.26 }, { x: W, y: H * 0.12 }, { x: W, y: H * 0.84 }, { x: 0, y: H * 0.97 }], true);
  band.lineStyle(3, light, 0.7);
  band.lineBetween(0, H * 0.26, W, H * 0.12);
  band.lineBetween(0, H * 0.97, W, H * 0.84);
  band.setAlpha(0);
  root.add([dim, band]);

  const eng = scene.add
    .text(W * 0.62, H * 0.5, (char.nameEn || char.name || '').toUpperCase(), { fontFamily: FONT, fontSize: short ? '150px' : '210px', fontStyle: '800', color: '#ffffff' })
    .setOrigin(0.5)
    .setAlpha(0);
  root.add(eng);

  // ── 속도선 / 파티클 (빠른 층) ──
  const lines = [];
  if (!reduced) {
    const n = Math.max(3, Math.round(12 * quality));
    for (let i = 0; i < n; i++) {
      const y = H * 0.18 + Math.random() * H * 0.68;
      const ln = scene.add.image(W + Math.random() * W, y, 'fx-line').setTint(light).setAlpha(0.15 + Math.random() * 0.35).setScale(1 + Math.random() * 2, 1).setBlendMode('ADD');
      lines.push(ln);
      root.add(ln);
      tw({ targets: ln, x: -300, duration: 380 + Math.random() * 420, repeat: -1, delay: Math.random() * 300 });
    }
  }

  // ── 캐릭터 그림 (보통 층) ──
  const key = charTextureKey(char.id);
  let art = null;
  if (scene.textures.exists(key)) {
    art = scene.add.image(W * 0.72, H + 10, key).setOrigin(0.5, 1);
    const src = art.texture.getSourceImage();
    const scale = Math.min((H * 1.02) / src.height, (W * 0.6) / src.width);
    art.setScale(scale).setAlpha(0);
    root.add(art);
  }

  let emitter = null;
  if (!reduced && quality > 0.2) {
    emitter = scene.add.particles(0, 0, 'fx-dot', {
      x: { min: 0, max: W },
      y: H * 0.95,
      speedY: { min: -260, max: -90 },
      speedX: { min: -30, max: 30 },
      scale: { start: 0.35, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 1400,
      frequency: Math.round(40 / quality),
      tint: [theme, light, 0xffffff],
      blendMode: 'ADD',
    });
    root.add(emitter);
  }

  // ── 글자 ──
  const nameX = W * 0.08;
  const nameY = H * 0.56;
  const title = scene.add
    .text(nameX + 4, nameY - 62, label || char.title || '', { fontFamily: FONT, fontSize: short ? '30px' : '28px', fontStyle: '700', color: `#${light.toString(16).padStart(6, '0')}` })
    .setOrigin(0, 1)
    .setAlpha(0);
  title.setStroke('#000000', 5);
  root.add(title);

  const letters = [];
  let lx = nameX;
  for (const ch of [...(char.name || '')]) {
    const t = scene.add.text(lx, nameY, ch, { fontFamily: FONT, fontSize: short ? '66px' : '82px', fontStyle: '800', color: '#ffffff' }).setOrigin(0, 0.5).setAlpha(0);
    t.setStroke(`#${theme.toString(16).padStart(6, '0')}`, 8);
    t.setShadow(0, 0, `#${light.toString(16).padStart(6, '0')}`, 18, true, true);
    lx += t.width - 6;
    letters.push(t);
    root.add(t);
  }

  let quote = null;
  if (!short && char.quote) {
    quote = scene.add
      .text(W / 2, H * 0.9, `「${char.quote}」`, { fontFamily: FONT, fontSize: '28px', fontStyle: '700', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.45)', padding: { x: 18, y: 8 } })
      .setOrigin(0.5)
      .setAlpha(0);
    root.add(quote);
  }

  let badge = null;
  if (isNew) {
    badge = scene.add.container(nameX + 18, nameY - 120);
    const bg = scene.add.rectangle(0, 0, 92, 38, 0xff3d6e, 1).setStrokeStyle(3, 0xffffff);
    const tx = scene.add.text(0, 0, 'NEW', { fontFamily: FONT, fontSize: '24px', fontStyle: '800', color: '#ffffff' }).setOrigin(0.5);
    badge.add([bg, tx]);
    badge.setAlpha(0);
    root.add(badge);
  }

  // ── 움직임 ──
  tw({ targets: dim, alpha: 0.82, duration: tIn });
  tw({ targets: band, alpha: 1, duration: tIn });
  if (reduced) {
    tw({ targets: [eng], alpha: 0.1, duration: tIn });
    if (art) tw({ targets: art, alpha: 1, duration: tIn });
    tw({ targets: [title, ...letters, quote, badge].filter(Boolean), alpha: 1, duration: tIn });
  } else {
    eng.x += 160;
    tw({ targets: eng, alpha: 0.1, duration: tIn });
    tw({ targets: eng, x: eng.x - 260, duration: tIn + hold + tOut }); // 가장 느린 층
    if (art) {
      art.x += 260;
      tw({ targets: art, alpha: 1, x: art.x - 230, duration: tIn + 120, ease: 'Cubic.out' });
      tw({ targets: art, x: art.x - 300, duration: tIn + hold + tOut, delay: tIn + 120 }); // 보통 층
    }
    title.x -= 40;
    tw({ targets: title, alpha: 1, x: title.x + 40, duration: tIn, delay: tIn * 0.4, ease: 'Cubic.out' });
    letters.forEach((t, i) => {
      t.y += 30;
      t.setScale(1.5);
      tw({ targets: t, alpha: 1, y: t.y - 30, scale: 1, duration: 220, delay: tIn * 0.5 + i * (short ? 40 : 70), ease: 'Back.out' });
      // 글자마다 빛 맥박
      tw({ targets: t, alpha: { from: 1, to: 0.8 }, duration: 380, delay: tIn + 300 + i * 70, yoyo: true, repeat: -1 });
    });
    if (quote) tw({ targets: quote, alpha: 1, duration: 300, delay: tIn + 420 });
    if (badge) {
      tw({ targets: badge, alpha: 1, duration: 200, delay: tIn });
      tw({ targets: badge, scale: { from: 1, to: 1.15 }, duration: 420, delay: tIn, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    tw({ targets: cam, zoom: short ? 1.03 : 1.06, duration: tIn + hold, ease: 'Sine.out' });
  }

  let finished = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const timer = scene.time.delayedCall(tIn + hold, () => finish());

  function finish(instant = false) {
    if (finished) return;
    finished = true;
    timer.remove(false);
    const cleanup = () => {
      for (const t of tweens) t.remove();
      emitter?.destroy();
      root.destroy(true);
      cam.setZoom(1);
      resolveDone();
    };
    if (instant || !scene.sys.isActive()) return cleanup();
    scene.tweens.add({ targets: root, alpha: 0, duration: tOut, onComplete: cleanup });
    if (!reduced) scene.tweens.add({ targets: cam, zoom: 1, duration: tOut });
  }

  return { done, skip: () => finish(false), destroy: () => finish(true) };
}
