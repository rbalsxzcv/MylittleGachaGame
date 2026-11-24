// 전투 아이콘 (BATTLE_UI.md 11장 — 이모지 · 유니코드 기호 대신 그림 아이콘)
// 64px 흰색 벡터 아이콘을 장면 시작 때 코드로 그려 텍스처 'bicon:<이름>'으로 만듦 → 쓸 때 tint로 색
// 그림 파일로 바꾸려면 assets/ui/icons/<이름>.png(64px, 흰색 바탕 투명 권장)를 넣고 assets/ui/icons/index.json 목록에 이름 추가
//   → 목록에 있는 것만 불러오므로 404가 없음. 그림이 있으면 그 그림이 이김 (iconKey)
import { assetUrl } from './phaserHost.js';

const S = 64;
const C = S / 2;
const LIST_KEY = 'bicons-list';
const LIST_URL = 'assets/ui/icons/index.json';

/** 이름 목록 (그림 파일 이름과 같음) */
export const ICON_NAMES = [
  'attack', 'aoe', 'buff', 'debuff', 'heal', 'shield', 'resist', 'taunt', 'dot', 'mark', 'stack', 'stun', 'transform',
  'charge', 'orb', 'bird', 'wolf', 'demon', 'turret',
  'role_attacker', 'role_defender', 'role_support', 'role_healer',
  'stat_atk', 'stat_def', 'stat_spd', 'stat_critRate', 'stat_critDmg', 'stat_energyRegen', 'stat_effectHit', 'stat_effectRes',
  'stat_healBonus', 'stat_shieldBonus', 'stat_dmgDealt', 'stat_dmgTaken', 'stat_hp',
  'crystal', 'pause', 'auto', 'speed', 'skip', 'aim', 'passive',
];

/** preload 단계: 그림 파일 목록을 읽고, 목록에 있는 그림만 불러옴 */
export function preloadBattleIcons(scene) {
  if (scene.cache.json.exists(LIST_KEY)) return queuePngs(scene, scene.cache.json.get(LIST_KEY));
  scene.load.json(LIST_KEY, assetUrl(LIST_URL));
  scene.load.once(`filecomplete-json-${LIST_KEY}`, (key, type, data) => queuePngs(scene, data));
}
function queuePngs(scene, list) {
  for (const name of Array.isArray(list) ? list : []) {
    if (typeof name !== 'string' || !ICON_NAMES.includes(name)) continue;
    const key = `biconpng:${name}`;
    if (!scene.textures.exists(key)) scene.load.image(key, assetUrl(`assets/ui/icons/${name}.png`));
  }
}

/** 쓸 텍스처 키 (그림 파일이 있으면 그것) */
export function iconKey(scene, name) {
  const png = `biconpng:${name}`;
  if (scene.textures.exists(png)) return png;
  const key = `bicon:${name}`;
  return scene.textures.exists(key) ? key : 'bicon:attack';
}

// ── 그리기 도우미 ──
const star = (cx, cy, outer, inner, n, rot = -Math.PI / 2) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / n;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
const SHIELD = [
  { x: 32, y: 5 },
  { x: 54, y: 13 },
  { x: 52, y: 34 },
  { x: 32, y: 59 },
  { x: 12, y: 34 },
  { x: 10, y: 13 },
];
const chevron = (g, cx, cy, w, h, t, up = true) => {
  const d = up ? -1 : 1;
  g.fillPoints(
    [
      { x: cx - w / 2, y: cy - (d * h) / 2 + d * h },
      { x: cx, y: cy - (d * h) / 2 },
      { x: cx + w / 2, y: cy - (d * h) / 2 + d * h },
      { x: cx + w / 2, y: cy - (d * h) / 2 + d * h + d * t },
      { x: cx, y: cy - (d * h) / 2 + d * t },
      { x: cx - w / 2, y: cy - (d * h) / 2 + d * h + d * t },
    ],
    true,
  );
};
const sword = (g) => {
  g.fillPoints([{ x: 54, y: 6 }, { x: 58, y: 10 }, { x: 26, y: 44 }, { x: 20, y: 38 }], true);
  g.fillPoints([{ x: 54, y: 6 }, { x: 60, y: 4 }, { x: 58, y: 10 }], true);
  g.lineStyle(7, 0xffffff, 1);
  g.lineBetween(12, 32, 32, 52);
  g.lineStyle(6, 0xffffff, 1);
  g.lineBetween(22, 42, 10, 54);
  g.fillCircle(9, 55, 5);
};
const shield = (g) => g.fillPoints(SHIELD, true);
const plus = (g, cx = C, cy = C, len = 48, t = 16) => {
  g.fillRoundedRect(cx - t / 2, cy - len / 2, t, len, 4);
  g.fillRoundedRect(cx - len / 2, cy - t / 2, len, t, 4);
};
const bolt = (g) => g.fillPoints([{ x: 38, y: 3 }, { x: 14, y: 36 }, { x: 30, y: 36 }, { x: 24, y: 61 }, { x: 50, y: 26 }, { x: 34, y: 26 }], true);
const crosshair = (g) => {
  g.lineStyle(6, 0xffffff, 1);
  g.strokeCircle(C, C, 20);
  g.lineStyle(6, 0xffffff, 1);
  for (const [x1, y1, x2, y2] of [[C, 2, C, 16], [C, 48, C, 62], [2, C, 16, C], [48, C, 62, C]]) g.lineBetween(x1, y1, x2, y2);
  g.fillCircle(C, C, 5);
};
const burst = (g) => g.fillPoints(star(C, C, 30, 13, 8), true);
const cycle = (g) => {
  g.lineStyle(7, 0xffffff, 1);
  g.beginPath();
  g.arc(C, C, 20, Math.PI * 0.95, Math.PI * 1.9);
  g.strokePath();
  g.beginPath();
  g.arc(C, C, 20, -Math.PI * 0.05, Math.PI * 0.9);
  g.strokePath();
  g.fillTriangle(48, 12, 58, 26, 42, 28);
  g.fillTriangle(16, 52, 6, 38, 22, 36);
};
const dark = (g) => g.fillStyle(0x000000, 1);
const white = (g) => g.fillStyle(0xffffff, 1);

const DRAW = {
  attack: sword,
  aoe: burst,
  buff: (g) => {
    chevron(g, C, 22, 40, 16, 9, true);
    chevron(g, C, 42, 40, 16, 9, true);
  },
  debuff: (g) => {
    chevron(g, C, 22, 40, 16, 9, false);
    chevron(g, C, 42, 40, 16, 9, false);
  },
  heal: (g) => plus(g),
  shield,
  resist: (g) => {
    g.lineStyle(6, 0xffffff, 1);
    g.strokePoints(SHIELD, true);
    g.fillCircle(C, 30, 7);
  },
  taunt: (g) => {
    g.fillRect(14, 22, 36, 36);
    for (const x of [14, 28, 42]) g.fillRect(x, 8, 8, 16);
    dark(g);
    g.fillRoundedRect(27, 38, 10, 20, 4);
  },
  dot: (g) => {
    g.fillCircle(C, 40, 17);
    g.fillTriangle(C, 4, 16, 34, 48, 34);
  },
  mark: crosshair,
  aim: crosshair,
  stack: (g) => g.fillPoints([{ x: C, y: 4 }, { x: 54, y: C }, { x: C, y: 60 }, { x: 10, y: C }], true),
  crystal: (g) => {
    g.fillPoints([{ x: C, y: 2 }, { x: 52, y: 24 }, { x: C, y: 62 }, { x: 12, y: 24 }], true);
    g.lineStyle(2, 0x000000, 0.35);
    g.lineBetween(12, 24, 52, 24);
    g.lineBetween(C, 2, C, 62);
  },
  stun: (g) => {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      g.fillPoints(star(C + Math.cos(a) * 18, C + Math.sin(a) * 18, 13, 5, 4), true);
    }
  },
  transform: cycle,
  auto: cycle,
  charge: bolt,
  orb: (g) => {
    g.fillCircle(C, C, 14);
    g.lineStyle(5, 0xffffff, 1);
    g.strokeCircle(C, C, 25);
  },
  bird: (g) => g.fillPoints([{ x: 2, y: 22 }, { x: 24, y: 30 }, { x: C, y: 44 }, { x: 40, y: 30 }, { x: 62, y: 22 }, { x: 44, y: 46 }, { x: C, y: 56 }, { x: 20, y: 46 }], true),
  wolf: (g) => g.fillPoints([{ x: 10, y: 6 }, { x: 24, y: 20 }, { x: 40, y: 20 }, { x: 54, y: 6 }, { x: 54, y: 34 }, { x: C, y: 60 }, { x: 10, y: 34 }], true),
  demon: (g) => {
    g.fillCircle(C, 40, 18);
    g.fillPoints([{ x: 14, y: 34 }, { x: 4, y: 4 }, { x: 26, y: 26 }], true);
    g.fillPoints([{ x: 50, y: 34 }, { x: 60, y: 4 }, { x: 38, y: 26 }], true);
  },
  turret: (g) => {
    g.fillRoundedRect(10, 42, 44, 16, 4);
    g.fillCircle(C, 42, 14);
    g.fillRect(C, 26, 28, 8);
  },
  role_attacker: sword,
  role_defender: shield,
  role_support: (g) => g.fillPoints(star(C, C, 30, 9, 4, 0), true),
  role_healer: (g) => plus(g),
  stat_atk: sword,
  stat_def: shield,
  stat_hp: (g) => {
    g.fillCircle(21, 24, 14);
    g.fillCircle(43, 24, 14);
    g.fillTriangle(8, 30, 56, 30, C, 58);
  },
  stat_spd: (g) => {
    g.fillTriangle(6, 10, 32, C, 6, 54);
    g.fillTriangle(32, 10, 58, C, 32, 54);
  },
  stat_critRate: crosshair,
  stat_critDmg: burst,
  stat_energyRegen: bolt,
  stat_effectHit: crosshair,
  stat_effectRes: (g) => DRAW.resist(g),
  stat_healBonus: (g) => plus(g),
  stat_shieldBonus: (g) => {
    shield(g);
    dark(g);
    plus(g, C, 30, 24, 8);
  },
  stat_dmgDealt: (g) => {
    sword(g);
    chevron(g, 48, 46, 18, 8, 5, true);
  },
  stat_dmgTaken: (g) => {
    shield(g);
    g.lineStyle(5, 0x000000, 1);
    g.lineBetween(30, 8, 36, 26);
    g.lineBetween(36, 26, 26, 40);
    g.lineBetween(26, 40, 34, 58);
  },
  pause: (g) => {
    g.fillRoundedRect(14, 10, 13, 44, 3);
    g.fillRoundedRect(37, 10, 13, 44, 3);
  },
  speed: (g) => DRAW.stat_spd(g),
  skip: (g) => {
    g.fillTriangle(8, 10, 40, C, 8, 54);
    g.fillRoundedRect(44, 10, 11, 44, 3);
  },
  passive: (g) => g.fillPoints(star(C, C, 28, 8, 4, Math.PI / 4), true),
};

/** 코드로 그린 아이콘 텍스처 만들기 (장면마다 부름, 이미 있으면 건너뜀) */
export function ensureBattleIcons(scene) {
  for (const name of ICON_NAMES) {
    const key = `bicon:${name}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    white(g);
    DRAW[name](g);
    g.generateTexture(key, S, S);
    g.destroy();
  }
}

/** 강화/약화 능력치 → 아이콘 이름 */
export const statIcon = (stat) => (ICON_NAMES.includes(`stat_${stat}`) ? `stat_${stat}` : 'buff');
/** 적 행동 아이콘(attack|aoe|buff|heal|debuff) → 아이콘 이름 */
export const actionIcon = (icon) => (['attack', 'aoe', 'buff', 'heal', 'debuff'].includes(icon) ? icon : 'attack');
/** 토큰 아이콘 → 아이콘 이름 */
export const tokenIcon = (icon) => (['charge', 'orb', 'bird', 'wolf', 'demon', 'turret'].includes(icon) ? icon : 'orb');
