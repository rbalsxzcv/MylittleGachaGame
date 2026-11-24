// 떠오르는 숫자용 비트맵 글꼴 (BATTLE_UI.md 8장 · 13-1장)
// 장면 시작 때 캔버스에 '0-9 , + 만 억 .' 글리프를 한 번 그려 cache.bitmapFont에 등록 → BitmapText로 씀
// (Text는 바뀔 때마다 캔버스를 다시 그려 GPU로 올려서 비쌈). 흰 채움 + 어두운 외곽선 → 색은 tint로
// 외곽선이 크기마다 6px에 가깝도록 작은 글꼴(34px 기준)과 큰 글꼴(64px 기준) 두 벌
import { FONT } from './phaserHost.js';
import { BT } from './battleTheme.js';

export const NUM_FONT = { small: 'bnum-s', large: 'bnum-l' };
const GLYPHS = '0123456789,.+만억';

function build(scene, key, size) {
  if (scene.cache.bitmapFont.exists(key)) return;
  const stroke = BT.number.stroke;
  const pad = stroke + 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${BT.font.bold} ${size}px ${FONT}`;
  ctx.font = font;
  const metrics = [...GLYPHS].map((ch) => ({ ch, w: Math.ceil(ctx.measureText(ch).width) }));
  const cellH = Math.ceil(size * 1.25) + pad * 2;
  const totalW = metrics.reduce((n, m) => n + m.w + pad * 2 + 2, 0);
  canvas.width = totalW;
  canvas.height = cellH;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke * 2; // 가운데 기준으로 그려져서 바깥 6px = 두께 12
  ctx.strokeStyle = BT.color.textStroke;
  ctx.fillStyle = '#ffffff';
  let x = 0;
  const cells = [];
  for (const m of metrics) {
    const cx = x + pad;
    ctx.strokeText(m.ch, cx, cellH / 2);
    ctx.fillText(m.ch, cx, cellH / 2);
    cells.push({ ch: m.ch, x, w: m.w + pad * 2 });
    x += m.w + pad * 2 + 2;
  }
  const tex = scene.textures.addCanvas(`${key}-tex`, canvas);
  const W = canvas.width;
  const H = canvas.height;
  const chars = {};
  for (const c of cells) {
    const code = c.ch.charCodeAt(0);
    chars[code] = {
      x: c.x,
      y: 0,
      width: c.w,
      height: cellH,
      centerX: Math.floor(c.w / 2),
      centerY: Math.floor(cellH / 2),
      xOffset: 0,
      yOffset: 0,
      // 외곽선끼리 조금 겹치게 → 글자 사이가 벌어지지 않음
      xAdvance: c.w - pad * 1.4,
      data: {},
      kerning: {},
      u0: c.x / W,
      v0: 0,
      u1: (c.x + c.w) / W,
      v1: 1,
    };
    tex.add(c.ch, 0, c.x, 0, c.w, cellH);
  }
  scene.cache.bitmapFont.add(key, { data: { font: key, size, lineHeight: cellH, chars }, texture: `${key}-tex`, frame: null });
}

/** 두 벌 만들기 (이미 있으면 건너뜀) */
export function ensureNumberFonts(scene) {
  build(scene, NUM_FONT.small, BT.number.dmg.size);
  build(scene, NUM_FONT.large, BT.number.total.size);
}

/** 원하는 크기 → { font, scale } */
export function fontFor(size) {
  const small = BT.number.dmg.size;
  return size <= small ? { font: NUM_FONT.small, scale: size / small } : { font: NUM_FONT.large, scale: size / BT.number.total.size };
}
