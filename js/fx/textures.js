// 연출용 기본 텍스처를 코드로 만들어 둠 (그림 파일 없이). 흰색으로 그리고 쓸 때 tint로 색을 입힘
// 한 게임에서 한 번만 만들어짐 (scene.textures에 이미 있으면 건너뜀)

const TAU = Math.PI * 2;

function make(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** 부드러운 점 (가운데가 밝고 바깥으로 흐려짐) */
function softDot(g, size) {
  const c = size / 2;
  for (let i = 16; i >= 1; i--) {
    g.fillStyle(0xffffff, 0.06 + (1 - i / 16) * 0.1);
    g.fillCircle(c, c, (c * i) / 16);
  }
}

/** 별 모양 꼭짓점 */
function starPoints(cx, cy, outer, inner, n = 5, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / n;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** 부드러운 둥근 사각형 (가장자리로 갈수록 흐려짐) — 카드 그림자 · 바깥 빛을 미리 흐리게 만든 것 (postFX 블러 대신) */
function softRect(g, w, h, pad, r) {
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1); // 0 = 가장 바깥
    const inset = pad * (1 - t);
    g.fillStyle(0xffffff, 0.05 + t * 0.06);
    g.fillRoundedRect(inset, inset, w + pad * 2 - inset * 2, h + pad * 2 - inset * 2, Math.max(2, r + pad * (1 - t)));
  }
}

/**
 * 전투 화면 전용 텍스처 (BATTLE_UI.md 13-1장: 장면 시작 때 한 번)
 * sizes: { 이름: {w, h} } 카드 종류별 크기 → 'bfx-soft-<이름>' (그림자/빛 공용, tint로 색)
 */
export function ensureBattleTextures(scene, sizes, { pad = 26, radius = 14 } = {}) {
  for (const [name, s] of Object.entries(sizes)) make(scene, `bfx-soft-${name}`, s.w + pad * 2, s.h + pad * 2, (g) => softRect(g, s.w, s.h, pad, radius));
  // 화살표 꺾쇠 (오른쪽을 가리킴 → 회전해서 씀)
  make(scene, 'bfx-chevron', 32, 32, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints([{ x: 6, y: 4 }, { x: 18, y: 4 }, { x: 30, y: 16 }, { x: 18, y: 28 }, { x: 6, y: 28 }, { x: 18, y: 16 }], true);
  });
  // 금 간 선 (가운데에서 퍼짐)
  make(scene, 'bfx-crack', 256, 256, (g) => {
    g.lineStyle(4, 0xffffff, 1);
    const arms = [[-0.2, 0.9], [0.5, 1], [1.4, 0.8], [2.2, 1], [3.0, 0.85], [3.9, 1], [4.6, 0.9], [5.4, 0.95]];
    for (const [a, len] of arms) {
      let x = 128;
      let y = 128;
      for (let k = 1; k <= 4; k++) {
        const nx = 128 + Math.cos(a + (k % 2 ? 0.18 : -0.14)) * 30 * k * len;
        const ny = 128 + Math.sin(a + (k % 2 ? 0.18 : -0.14)) * 30 * k * len;
        g.lineStyle(Math.max(1, 5 - k), 0xffffff, 1);
        g.lineBetween(x, y, nx, ny);
        x = nx;
        y = ny;
      }
    }
  });
  // 파편 (삼각형 조각)
  make(scene, 'bfx-shard', 16, 16, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(0, 2, 16, 0, 6, 16);
  });
  // 참격 띠 (가운데가 밝은 긴 띠)
  make(scene, 'bfx-slash', 512, 64, (g) => {
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      g.fillStyle(0xffffff, 0.06 + t * 0.12);
      g.fillRect(0, 32 - 30 * (1 - t), 512, 60 * (1 - t) + 2);
    }
  });
  // 비네트 (가장자리 어둡게)
  if (!scene.textures.exists('bfx-vignette')) {
    const tex = scene.textures.createCanvas('bfx-vignette', 640, 360);
    const ctx = tex.getContext();
    const grd = ctx.createRadialGradient(320, 180, 90, 320, 180, 380);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 640, 360);
    tex.refresh();
  }
}

export function ensureFxTextures(scene) {
  make(scene, 'fx-dot', 64, 64, (g) => softDot(g, 64));
  make(scene, 'fx-spark', 24, 24, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints([{ x: 12, y: 0 }, { x: 15, y: 9 }, { x: 24, y: 12 }, { x: 15, y: 15 }, { x: 12, y: 24 }, { x: 9, y: 15 }, { x: 0, y: 12 }, { x: 9, y: 9 }], true);
  });
  make(scene, 'fx-ring', 256, 256, (g) => {
    g.lineStyle(10, 0xffffff, 1);
    g.strokeCircle(128, 128, 118);
    g.lineStyle(3, 0xffffff, 0.6);
    g.strokeCircle(128, 128, 100);
  });
  // 마법진 1: 이중 원 + 육망성 + 눈금
  make(scene, 'fx-circle1', 512, 512, (g) => {
    const c = 256;
    g.lineStyle(4, 0xffffff, 0.95);
    g.strokeCircle(c, c, 240);
    g.lineStyle(2, 0xffffff, 0.7);
    g.strokeCircle(c, c, 220);
    g.strokeCircle(c, c, 150);
    for (let k = 0; k < 2; k++) {
      const pts = [0, 1, 2].map((i) => ({ x: c + Math.cos(-Math.PI / 2 + k * Math.PI + (i * TAU) / 3) * 215, y: c + Math.sin(-Math.PI / 2 + k * Math.PI + (i * TAU) / 3) * 215 }));
      g.lineStyle(3, 0xffffff, 0.85);
      g.strokePoints(pts, true);
    }
    for (let i = 0; i < 48; i++) {
      const a = (i * TAU) / 48;
      const r1 = i % 4 === 0 ? 222 : 230;
      g.lineStyle(2, 0xffffff, 0.8);
      g.lineBetween(c + Math.cos(a) * r1, c + Math.sin(a) * r1, c + Math.cos(a) * 238, c + Math.sin(a) * 238);
    }
  });
  // 마법진 2: 돌려 놓은 사각형 두 개 + 룬 점
  make(scene, 'fx-circle2', 512, 512, (g) => {
    const c = 256;
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeCircle(c, c, 200);
    for (const rot of [0, Math.PI / 4]) {
      const pts = [0, 1, 2, 3].map((i) => ({ x: c + Math.cos(rot + (i * TAU) / 4) * 190, y: c + Math.sin(rot + (i * TAU) / 4) * 190 }));
      g.strokePoints(pts, true);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i * TAU) / 16;
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(c + Math.cos(a) * 172, c + Math.sin(a) * 172, i % 2 ? 4 : 7);
    }
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeCircle(c, c, 120);
    g.strokeCircle(c, c, 60);
  });
  // 빛줄기 (가운데에서 바깥으로 퍼지는 쐐기 여러 개)
  make(scene, 'fx-rays', 1024, 1024, (g) => {
    const c = 512;
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n;
      const w = i % 2 ? 0.05 : 0.09;
      g.fillStyle(0xffffff, i % 2 ? 0.35 : 0.6);
      g.fillTriangle(c, c, c + Math.cos(a - w) * 512, c + Math.sin(a - w) * 512, c + Math.cos(a + w) * 512, c + Math.sin(a + w) * 512);
    }
  });
  make(scene, 'fx-star', 48, 48, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints(starPoints(24, 24, 23, 10), true);
  });
  // 카드 뒷면 (흰 바탕 → tint로 색)
  make(scene, 'fx-card-back', 200, 300, (g) => {
    g.fillStyle(0x2a1d47, 1);
    g.fillRoundedRect(0, 0, 200, 300, 18);
    g.lineStyle(4, 0xd9b8ff, 1);
    g.strokeRoundedRect(6, 6, 188, 288, 14);
    g.lineStyle(2, 0xd9b8ff, 0.6);
    g.strokeCircle(100, 150, 56);
    g.strokeCircle(100, 150, 40);
    g.fillStyle(0xf3e6ff, 1);
    g.fillPoints(starPoints(100, 150, 30, 12, 4, 0), true);
  });
  // 가로 줄 (컷인 속도선)
  make(scene, 'fx-line', 256, 6, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 2, 256, 2);
    g.fillStyle(0xffffff, 0.4);
    g.fillRect(0, 0, 256, 6);
  });
}
