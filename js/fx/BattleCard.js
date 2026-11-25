// 전투 카드 하나 (BATTLE_UI.md 2장 · 4장 · 7장) — 장면은 아래 메서드만 부름
//
// 층: root(배치 자리) → act(돌진 · 밀림, 그림자 포함) → bob(떠 있음) → lift(차례 들림 · 크기) → flip(변신 뒤집기) → 내용
// 변하지 않는 앞면(반투명 검정 바탕 · 크롭 그림 · 아래 그라데이션 · 이름 · 역할 아이콘)은 캔버스 텍스처 한 장으로 구움(+ 회색 한 장)
// 바뀌는 것: HP(앞 막대 + 잔상), 기력, 효과 아이콘 줄, 보호막 막, 테두리들(차례/대상/낮은 HP/강화/도발/변신/궁극기 준비), 예고 배지(적)
// 카드 앞면에는 숫자가 없음 (효과가 4개를 넘을 때의 '+n'만)
import { FONT } from './phaserHost.js';
import { BT } from './battleTheme.js';
import { iconKey } from './icons.js';
import { NUM_FONT } from './numberFont.js';

const C = BT.card;
const COL = BT.color;
const ST = BT.state;
const css = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
const rgba = (n, a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
let seq = 0;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 그림 위쪽(top 비율)을 w×h 비율로 크롭해서 그리기 — crop.y: 위에서 얼마나 내려서 시작할지 (얼굴이 잘릴 때) */
export function drawCrop(ctx, src, W, H, top, cropY = 0, cropX = 0.5) {
  const sw0 = src.width;
  const sh0 = src.height;
  let sh = sh0 * top;
  let sw = (sh * W) / H;
  if (sw > sw0) {
    sw = sw0;
    sh = (sw * H) / W;
  }
  const sx = Math.max(0, Math.min(sw0 - sw, sw0 * cropX - sw / 2));
  const sy = Math.max(0, Math.min(sh0 - sh, sh0 * cropY));
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
}

/** 회색 판 만들기 (ctx.filter가 없으면 픽셀로) */
function grayCopy(scene, key, srcCanvas, W, H) {
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  if ('filter' in ctx) {
    ctx.filter = 'grayscale(1) brightness(0.72)';
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.filter = 'none';
  } else {
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 0.72;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  tex.refresh();
}

/**
 * 카드 앞면 굽기 → { key, grayKey }
 * o: { id, w, h, artKey, artTop, cropY, line, name, role (아이콘 이름 | null) }
 */
export function bakeCard(scene, o) {
  const R = C.res;
  const W = Math.round(o.w * R);
  const H = Math.round(o.h * R);
  const key = `bcard:${o.id}:${++seq}`;
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  ctx.save();
  roundRect(ctx, 0, 0, W, H, C.radius * R);
  ctx.clip();
  // 바탕: 반투명 검정 (글래스 — 아군/적 색 없이, 뒤 전투 배경이 어둡게 비침)
  ctx.fillStyle = rgba(C.glass.color, C.glass.alpha);
  ctx.fillRect(0, 0, W, H);
  const src = o.artKey && scene.textures.exists(o.artKey) ? scene.textures.get(o.artKey).getSourceImage() : null;
  if (src?.width) drawCrop(ctx, src, W, H, o.artTop, o.cropY);
  else {
    // 그림이 없을 때: 이름 첫 글자를 크게
    ctx.fillStyle = rgba(0xffffff, 0.18);
    ctx.font = `${BT.font.bold} ${Math.round(H * 0.4)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((o.name || '?').slice(0, 1), W / 2, H * 0.42);
  }
  const top = H * (1 - C.shade);
  const sh = ctx.createLinearGradient(0, top, 0, H);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, `rgba(0,0,0,${C.shadeAlpha})`);
  ctx.fillStyle = sh;
  ctx.fillRect(0, top, W, H - top);
  ctx.restore();
  // 카드 테두리는 그리지 않음 (상태 테두리만 위에 따로)

  // 이름: 20px 800, 흰색 + 어두운 외곽선 3px (넘치면 조금 줄임)
  let size = C.nameSize;
  const maxW = W - 2 * C.hpInset * R - 24 * R;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (; size > 16; size--) {
    ctx.font = `${BT.font.bold} ${size * R}px ${FONT}`;
    if (ctx.measureText(o.name).width <= maxW) break;
  }
  ctx.font = `${BT.font.bold} ${size * R}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = C.nameStroke * 2 * R;
  ctx.strokeStyle = COL.textStroke;
  const nx = C.hpInset * R;
  const ny = H - (8 + C.hpH + 9) * R;
  ctx.strokeText(o.name, nx, ny);
  ctx.fillStyle = COL.text;
  ctx.fillText(o.name, nx, ny);

  // 역할 아이콘: 왼쪽 위 28px 원
  if (o.role) {
    const r = (C.roleIcon / 2) * R;
    const cx = 8 * R + r;
    const cy = (C.energyH + 8) * R + r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,6,20,0.78)';
    ctx.fill();
    ctx.lineWidth = 2 * R;
    ctx.strokeStyle = css(o.line);
    ctx.stroke();
    const ik = iconKey(scene, o.role);
    const isrc = scene.textures.exists(ik) ? scene.textures.get(ik).getSourceImage() : null;
    if (isrc) ctx.drawImage(isrc, cx - r * 0.62, cy - r * 0.62, r * 1.24, r * 1.24);
  }
  tex.refresh();
  const grayKey = `${key}:gray`;
  grayCopy(scene, grayKey, tex.getSourceImage(), W, H);
  return { key, grayKey };
}

export class BattleCard {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} motion createMotion 결과
   * @param {object} unit 엔진 유닛
   * @param {object} o { layer, x, y, scale, kind:'ally'|'enemy'|'boss', w, h, artKey, cropY, theme, line, fx, idle }
   */
  constructor(scene, motion, unit, o) {
    this.scene = scene;
    this.m = motion;
    this.fx = o.fx;
    this.uid = unit.uid;
    this.side = unit.side;
    this.kind = o.kind;
    this.w = o.w;
    this.h = o.h;
    this.theme = o.theme;
    this.alive = true;
    this.hpRatio = 1;
    this.energyRatio = 0;
    this.st = { active: false, target: 'none', ready: false, hover: false, press: false, stun: false, low: false, lifted: false };
    this.loops = {};
    this.effectKeys = [];
    this.home = { x: o.x, y: o.y, scale: o.scale };

    const baked = bakeCard(scene, { id: unit.uid, w: o.w, h: o.h, artKey: o.artKey, artTop: o.artTop, cropY: o.cropY, line: o.line, name: unit.name, role: o.role });
    this.texKeys = [baked.key, baked.grayKey];
    const w = o.w;
    const h = o.h;
    const add = scene.add;

    this.root = add.container(o.x, o.y).setScale(o.scale);
    o.layer.add(this.root);
    this.act = add.container(0, 0);
    this.shadow = add.image(0, BT.shadow.dy, `bfx-soft-${o.kind}`).setTint(0x000000).setAlpha(BT.shadow.alpha);
    this.bob = add.container(0, 0);
    this.lift = add.container(0, 0);
    this.flip = add.container(0, 0);
    this.root.add(this.act);
    this.act.add([this.shadow, this.bob]);
    this.bob.add(this.lift);
    this.lift.add(this.flip);

    const soft = `bfx-soft-${o.kind}`;
    // 지금 차례: 흐릿한 흰 테두리 (미리 만든 텍스처, 카드 위에 덮음)
    this.glowActive = add.image(0, 0, `bfx-edge-${o.kind}`).setAlpha(0);
    this.glowReady = add.image(0, 0, soft).setTint(o.theme).setAlpha(0).setBlendMode('ADD');
    this.body = add.image(0, 0, baked.key).setScale(1 / C.res);
    this.gray = add.image(0, 0, baked.grayKey).setScale(1 / C.res).setAlpha(0);
    const ring = (color, lw, alpha = 0) => {
      const g = add.graphics();
      g.lineStyle(lw, color, 1);
      g.strokeRoundedRect(-w / 2 + lw / 2, -h / 2 + lw / 2, w - lw, h - lw, C.radius);
      return g.setAlpha(alpha);
    };
    this.dim = add.graphics().fillStyle(0x000000, 1).fillRoundedRect(-w / 2, -h / 2, w, h, C.radius).setAlpha(0);
    this.bTarget = ring(COL.white, C.stateLine);
    this.bDanger = ring(COL.hpLow, C.stateLine);
    this.bGold = ring(COL.gold, C.stateLine + 1);
    this.bTaunt = ring(COL.stone, C.tauntLine);
    this.bTransform = ring(COL.transform, C.stateLine);
    this.bReady = ring(o.theme, C.stateLine);
    this.crack = add.image(0, 0, 'bfx-crack').setDisplaySize(w * 1.1, w * 1.1).setAlpha(0).setBlendMode('ADD');

    // 보호막 막
    this.shieldBox = add.container(0, 0).setAlpha(0);
    this.shieldBox.add(add.graphics().fillStyle(COL.shield, C.shieldAlpha).fillRoundedRect(-w / 2, -h / 2, w, h, C.radius).lineStyle(C.shieldLine, COL.shield, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, C.radius));

    // HP (아래 8px): 배경 · 잔상 · 앞 막대 (숫자 없음)
    const barW = w - C.hpInset * 2;
    const hy = h / 2 - 8 - C.hpH / 2;
    const hx = -w / 2 + C.hpInset;
    this.hpW = barW;
    this.hpBg = add.rectangle(hx, hy, barW, C.hpH, COL.hpBg, 0.92).setOrigin(0, 0.5);
    this.hpTrail = add.rectangle(hx, hy, barW, C.hpH, COL.trail, 0.85).setOrigin(0, 0.5);
    this.hpFront = add.rectangle(hx, hy, barW, C.hpH, this.hpColor(1)).setOrigin(0, 0.5);

    const parts = [this.glowReady, this.body, this.gray, this.dim, this.glowActive, this.shieldBox, this.bTaunt, this.bTransform, this.bReady, this.bDanger, this.bGold, this.bTarget, this.crack, this.hpBg, this.hpTrail, this.hpFront];

    // 기력 (아군, 위 4px)
    if (unit.side === 'ally') {
      const ew = w - C.radius * 2;
      const ey = -h / 2 + 3 + C.energyH / 2;
      this.enBg = add.rectangle(-ew / 2, ey, ew, C.energyH, COL.energyBg, 0.9).setOrigin(0, 0.5);
      this.enFill = add.rectangle(-ew / 2, ey, ew, C.energyH, o.theme).setOrigin(0, 0.5).setScale(0, 1);
      parts.push(this.enBg, this.enFill);
    }

    // 효과 아이콘 줄 (오른쪽, 24px, 최대 4 + '+n', 남은 턴은 점)
    this.slots = [];
    const ex = w / 2 - 6 - C.effectIcon / 2;
    const ey0 = -h / 2 + 10 + C.effectIcon / 2 + (unit.side === 'enemy' ? 18 : 0);
    for (let i = 0; i < C.effectMax; i++) {
      const s = add.container(ex, ey0 + i * (C.effectIcon + 10)).setAlpha(0);
      const bg = add.circle(0, 0, C.effectIcon / 2, 0x0d0818, 0.88);
      const rim = add.circle(0, 0, C.effectIcon / 2).setStrokeStyle(2, COL.gold);
      const icon = add.image(0, 0, iconKey(scene, 'buff')).setDisplaySize(C.effectIcon * 0.66, C.effectIcon * 0.66);
      const dots = [0, 1, 2].map((k) => add.circle((k - 1) * 6, C.effectIcon / 2 + 4, 2, COL.white, 1));
      s.add([bg, rim, icon, ...dots]);
      this.slots.push({ c: s, rim, icon, dots, key: null });
      parts.push(s);
    }
    this.more = add.bitmapText(ex, ey0 + C.effectMax * (C.effectIcon + 10) - 4, NUM_FONT.small, '', 34).setOrigin(0.5).setScale(0.5).setAlpha(0);
    parts.push(this.more);

    // 자원(스택) 마름모 줄 (왼쪽)
    this.resBox = add.container(-w / 2 + 14, -h / 2 + (o.role ? 52 : 20));
    parts.push(this.resBox);
    this.res = null;

    // 행동 불가 아이콘 · 조준 표시
    this.stunIcon = add.container(0, -h * 0.12).setAlpha(0);
    this.stunIcon.add([add.circle(0, 0, 26, 0x0d0818, 0.85), add.image(0, 0, iconKey(scene, 'stun')).setDisplaySize(36, 36).setTint(0xfff0a0)]);
    this.aim = add.image(0, 0, iconKey(scene, 'aim')).setDisplaySize(w * 0.62, w * 0.62).setAlpha(0);
    parts.push(this.stunIcon, this.aim);

    // 적: 행동 예고 배지 (위쪽 가운데)
    if (unit.side === 'enemy') {
      const I = BT.intent;
      const b = (this.badge = add.container(0, -h / 2 - 2).setAlpha(0));
      const bw = I.badge;
      this.badgeBg = add.graphics().fillStyle(0x1a1026, 0.94).fillRoundedRect(-bw / 2, -bw / 2, bw, bw, BT.radius.badge).lineStyle(2, COL.enemy, 1).strokeRoundedRect(-bw / 2, -bw / 2, bw, bw, BT.radius.badge);
      this.badgeBig = add.graphics().fillStyle(0x6a0f1e, 0.96).fillRoundedRect(-bw / 2, -bw / 2, bw, bw, BT.radius.badge).lineStyle(3, COL.hpLow, 1).strokeRoundedRect(-bw / 2, -bw / 2, bw, bw, BT.radius.badge).setAlpha(0);
      this.badgeIcon = add.image(0, 0, iconKey(scene, 'attack')).setDisplaySize(I.icon * 0.8, I.icon * 0.8);
      this.badgeCrack = add.image(0, 0, 'bfx-crack').setDisplaySize(bw * 1.4, bw * 1.4).setAlpha(0);
      this.badgeDots = [0, 1, 2].map((k) => add.circle((k - 1) * I.dotGap, bw / 2 + 9, I.dotR, COL.white, 1));
      b.add([this.badgeBg, this.badgeBig, this.badgeIcon, this.badgeCrack, ...this.badgeDots]);
      parts.push(b);
    }
    this.flip.add(parts);

    // 탭 영역 (돌진해도 안 움직이게 root에)
    this.zone = add.zone(0, 0, Math.max(w, BT.minTouch), Math.max(h, BT.minTouch)).setInteractive({ useHandCursor: true });
    this.zone.setData('ui', true);
    this.zone.setData('card', this);
    this.root.add(this.zone);

    if (o.idle) this.startIdle();
  }

  // ── 위치 ──
  /** 화면 좌표의 카드 가운데 (돌진 · 들림 포함) */
  center() {
    const s = this.root.scale;
    return { x: this.root.x + this.act.x * s, y: this.root.y + (this.act.y + this.bob.y + this.lift.y) * s };
  }
  /** 화면 좌표 사각형 (탭/끌기 판정) */
  bounds(pad = 0) {
    const s = this.root.scale;
    return { x: this.root.x - (this.w * s) / 2 - pad, y: this.root.y - (this.h * s) / 2 - pad, w: this.w * s + pad * 2, h: this.h * s + pad * 2 };
  }
  contains(px, py, pad = 0) {
    const b = this.bounds(pad);
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }
  /** 배치 자리로 이동 (재정렬 · 웨이브) */
  moveTo(x, y, scale, token = 'base', ease = 'out', delay = 0) {
    this.home = { x, y, scale };
    const tk = this.m.reduced ? 'fast' : token;
    return this.m.tween(this.root, { x, y, scale }, tk, this.m.reduced ? 'out' : ease, { delay });
  }

  // ── 반복 움직임 ──
  startIdle() {
    if (this.m.reduced || this.loops.idle) return;
    this.bob.y = -ST.idleBob;
    this.loops.idle = this.m.loop(this.bob, { y: ST.idleBob }, ST.idlePeriod, { delay: Math.random() * ST.idlePeriod * 0.5 });
  }
  stopLoop(name) {
    this.loops[name]?.stop();
    delete this.loops[name];
  }
  stopAllLoops() {
    for (const k of Object.keys(this.loops)) this.stopLoop(k);
  }

  // ── 상태 (4장) ──
  /** patch: { active, target:'none'|'ok'|'no'|'aim', ready, hover, press, stun } */
  setState(patch) {
    const prev = { ...this.st };
    Object.assign(this.st, patch);
    const s = this.st;
    if (!this.alive) return;
    const lifted = s.active;
    // 크기: 차례 1.06 × 조준 1.05 × 올림 1.03 × 누름 0.97
    const scale = (s.active ? ST.activeScale : 1) * (s.target === 'aim' ? ST.aimScale : 1) * (s.hover ? ST.hoverScale : 1) * (s.press ? ST.pressScale : 1);
    if (s.press !== prev.press) this.m.tween(this.lift, { scale }, 'instant', 'out');
    else if (s.hover !== prev.hover) this.m.tween(this.lift, { scale }, 'fast', 'out');
    else if (s.active !== prev.active || s.target !== prev.target) this.m.tween(this.lift, { scale }, s.target === 'aim' ? 'fast' : 'base', 'pop');
    if (lifted !== prev.lifted) {
      s.lifted = lifted;
      const S = BT.shadow;
      this.m.tween(this.lift, { y: lifted ? -ST.activeLift : 0 }, 'base', lifted ? 'pop' : 'out');
      this.m.tween(this.shadow, { y: lifted ? S.liftDy : S.dy, alpha: lifted ? S.liftAlpha : S.alpha, scale: lifted ? S.liftScale : 1 }, 'base', 'out');
      this.m.tween(this.glowActive, { alpha: lifted ? ST.activeEdge.alpha : 0 }, 'base', 'out');
    }
    if (s.target !== prev.target) {
      this.stopLoop('target');
      this.stopLoop('aim');
      if (s.target === 'ok') {
        this.bTarget.setAlpha(0.25);
        this.loops.target = this.m.loop(this.bTarget, { alpha: 1 }, ST.targetPulse);
      } else this.m.tween(this.bTarget, { alpha: 0 }, 'fast');
      this.m.tween(this.dim, { alpha: s.target === 'no' ? 0.45 : 0 }, 'fast');
      if (s.target === 'aim') {
        this.m.tween(this.aim, { alpha: 0.95 }, 'fast');
        if (!this.m.reduced) this.loops.aim = { tween: this.scene.tweens.add({ targets: this.aim, angle: 360, duration: ST.aimSpin, repeat: -1 }), stop() { this.tween.remove(); } };
      } else this.m.tween(this.aim, { alpha: 0 }, 'fast');
    }
    if (s.ready !== prev.ready) {
      this.stopLoop('ready');
      if (s.ready) {
        this.m.tween(this.enBg, { alpha: 0 }, 'fast');
        this.m.tween(this.enFill, { alpha: 0 }, 'fast');
        this.bReady.setAlpha(1);
        this.glowReady.setAlpha(1);
        this.loops.ready = this.m.loop([this.bReady, this.glowReady], { alpha: ST.readyAlphaMin }, ST.readyPulse * 2);
      } else {
        // 궁극기를 쓰면 테두리 빛은 base에 걸쳐 꺼짐
        this.m.tween([this.bReady, this.glowReady], { alpha: 0 }, 'base');
        this.m.tween([this.enBg, this.enFill].filter(Boolean), { alpha: 1 }, 'base');
      }
    }
    if (s.stun !== prev.stun) {
      this.m.tween(this.gray, { alpha: s.stun ? 1 : 0 }, 'base');
      if (s.stun) {
        this.stunIcon.setScale(0);
        this.stunIcon.setAlpha(1);
        this.m.tween(this.stunIcon, { scale: 1 }, 'base', 'pop');
      } else this.m.tween(this.stunIcon, { alpha: 0 }, 'fast');
    }
  }

  /** 1초간 맥박 (행동 순서 칩을 눌렀을 때) */
  pulse() {
    if (this.st.target === 'ok' || !this.alive) return;
    this.stopLoop('target');
    this.bTarget.setAlpha(0.2);
    this.loops.target = this.m.loop(this.bTarget, { alpha: 1 }, ST.targetPulse);
    this.scene.time.delayedCall(BT.queue.pulse, () => {
      if (this.st.target === 'ok') return;
      this.stopLoop('target');
      this.m.tween(this.bTarget, { alpha: 0 }, 'fast');
    });
  }

  // ── HP / 기력 (2장) ──
  hpColor(r) {
    if (r < BT.hp.low) return COL.hpLow;
    if (r < BT.hp.mid) return COL.hpMid;
    return this.side === 'ally' ? this.theme : COL.enemy;
  }
  setHp(ratio, { heal = false, instant = false } = {}) {
    const r = Math.max(0, Math.min(1, ratio));
    const prev = this.hpRatio;
    this.hpRatio = r;
    this.hpFront.setFillStyle(this.hpColor(r));
    const H = BT.hp;
    if (instant || this.m.instant) {
      this.m.kill([this.hpFront, this.hpTrail]);
      this.hpFront.scaleX = r;
      this.hpTrail.scaleX = r;
    } else if (r < prev) {
      this.hpTrail.setFillStyle(COL.trail, 0.85);
      if (this.hpTrail.scaleX < prev) this.hpTrail.scaleX = prev;
      this.m.tween(this.hpFront, { scaleX: r }, 'instant', 'out');
      this.m.tween(this.hpTrail, { scaleX: r }, H.trailDur, 'out', { delay: H.trailDelay });
    } else if (r > prev) {
      this.hpTrail.setFillStyle(COL.heal, 0.9);
      this.m.tween(this.hpTrail, { scaleX: r }, H.healLead, 'out');
      this.m.tween(this.hpFront, { scaleX: r }, H.healFollow, 'out', { delay: H.healLead });
    }
    const low = r > 0 && r < H.low;
    if (low !== this.st.low) {
      this.st.low = low;
      this.stopLoop('danger');
      if (low) {
        this.bDanger.setAlpha(0);
        this.loops.danger = this.m.loop(this.bDanger, { alpha: 1 }, ST.lowHpPulse);
      } else this.m.tween(this.bDanger, { alpha: 0 }, 'fast');
    }
    return heal;
  }
  setEnergy(ratio, hasUlt = true) {
    if (!this.enFill) return;
    const r = Math.max(0, Math.min(1, ratio));
    this.energyRatio = r;
    if (this.m.instant) this.enFill.scaleX = r;
    else this.m.tween(this.enFill, { scaleX: r }, 'fast', 'out');
    this.setState({ ready: hasUlt && r >= 1 && this.alive });
  }

  // ── 효과 아이콘 (2장 · 7장) ──
  /** list: [{ key, icon, kind:'buff'|'debuff', dots }] */
  setEffects(list) {
    const shown = list.slice(0, C.effectMax);
    this.slots.forEach((slot, i) => {
      const it = shown[i];
      if (!it) {
        if (slot.key) this.m.tween(slot.c, { alpha: 0 }, 'fast');
        slot.key = null;
        return;
      }
      const isNew = slot.key !== it.key;
      slot.key = it.key;
      slot.icon.setTexture(iconKey(this.scene, it.icon)).setDisplaySize(C.effectIcon * 0.66, C.effectIcon * 0.66);
      slot.rim.setStrokeStyle(2, it.kind === 'buff' ? COL.gold : COL.debuff);
      slot.dots.forEach((d, k) => d.setAlpha(k < Math.min(C.turnDots, it.dots || 0) ? 1 : 0));
      if (isNew) {
        slot.c.setAlpha(1).setScale(0);
        this.m.tween(slot.c, { scale: 1 }, 'fast', 'pop');
      } else if (slot.c.alpha < 1) this.m.tween(slot.c, { alpha: 1 }, 'fast');
    });
    const extra = list.length - shown.length;
    if (extra > 0) this.more.setText(`+${extra}`);
    this.m.tween(this.more, { alpha: extra > 0 ? 1 : 0 }, 'fast');
  }
  /** 강화: 테두리 금색 번쩍임 */
  flashBuff() {
    this.bGold.setAlpha(1);
    return this.m.tween(this.bGold, { alpha: 0 }, 'slow', 'out');
  }
  /** 약화: 보라 연기 */
  smoke() {
    const c = this.center();
    this.fx?.smoke(c.x, c.y, this.w * this.root.scale);
  }
  /** 지속 피해: 효과 아이콘이 짧게 흔들림 */
  shakeIcons() {
    if (this.m.reduced) return;
    for (const s of this.slots) if (s.key) this.m.tween(s.c, { angle: { from: -14, to: 0 } }, 'fast', 'pop');
  }

  // ── 보호막 · 도발 · 변신 · 자원 ──
  setShield(on, { instant = false } = {}) {
    if (!!on === !!this.shieldOn) return;
    this.shieldOn = !!on;
    if (instant || this.m.instant) {
      this.shieldBox.setAlpha(on ? 1 : 0).setScale(1);
      return;
    }
    if (on) {
      this.shieldBox.setAlpha(1).setScale(0.8);
      this.m.tween(this.shieldBox, { scale: 1 }, 'base', 'pop');
    } else {
      const c = this.center();
      this.fx?.shards(c.x, c.y, BT.color.shield);
      this.m.tween(this.shieldBox, { alpha: 0, scale: 1.06 }, 'fast', 'out');
    }
  }
  setTaunt(on) {
    if (!!on === !!this.tauntOn) return;
    this.tauntOn = !!on;
    this.m.tween(this.bTaunt, { alpha: on ? 1 : 0 }, on ? 'fast' : 'base');
  }
  async setTransformed(on, { instant = false } = {}) {
    if (!!on === !!this.transformed) return;
    this.transformed = !!on;
    if (instant || this.m.instant || this.m.reduced) {
      this.bTransform.setAlpha(on ? 1 : 0);
      return;
    }
    await this.m.tween(this.flip, { scaleX: 0 }, 120, 'in');
    this.bTransform.setAlpha(on ? 1 : 0);
    await this.m.tween(this.flip, { scaleX: 1 }, 120, 'out');
  }
  setResource(value, cap) {
    if (!cap) return;
    if (!this.res || this.res.cap !== cap) {
      this.resBox.removeAll(true);
      const add = this.scene.add;
      if (cap <= C.resMaxPips) {
        const pips = Array.from({ length: cap }, (_, i) => add.image(0, i * (C.resPip + 4), iconKey(this.scene, 'stack')).setDisplaySize(C.resPip, C.resPip).setTint(this.theme).setAlpha(0.25));
        this.resBox.add(pips);
        this.res = { cap, pips, value: 0 };
      } else {
        const hgt = C.resMaxPips * (C.resPip + 4);
        const bg = add.rectangle(0, 0, 5, hgt, COL.energyBg, 0.9).setOrigin(0.5, 0);
        const fill = add.rectangle(0, hgt, 5, hgt, this.theme).setOrigin(0.5, 1).setScale(1, 0);
        this.resBox.add([bg, fill]);
        this.res = { cap, fill, value: 0 };
      }
    }
    const v = Math.max(0, Math.min(cap, value));
    if (this.res.pips) {
      this.res.pips.forEach((p, i) => {
        const on = i < v;
        const was = i < this.res.value;
        if (on && !was && !this.m.instant) {
          p.setAlpha(1).setScale(0);
          this.m.tween(p, { scale: (C.resPip / 64) * 1 }, 'fast', 'pop');
        } else p.setAlpha(on ? 1 : 0.25);
      });
    } else this.m.tween(this.res.fill, { scaleY: v / cap }, 'fast', 'out');
    this.res.value = v;
  }

  // ── 적 예고 배지 (6장) ──
  /** it: { icon, big, eta, interrupted } | null */
  setIntent(it) {
    if (!this.badge) return;
    if (!it || !this.alive) {
      this.stopLoop('badge');
      this.m.tween(this.badge, { alpha: 0 }, 'fast');
      return;
    }
    this.badgeCrack.setAlpha(0);
    this.badgeIcon.setTexture(iconKey(this.scene, it.icon)).setDisplaySize(BT.intent.icon * 0.8, BT.intent.icon * 0.8);
    const big = it.big && !it.interrupted;
    this.badgeBig.setAlpha(big ? 1 : 0);
    this.badgeIcon.setTint(it.interrupted ? 0x888888 : 0xffffff);
    const filled = it.eta == null ? 0 : Math.min(3, it.eta + 1);
    this.badgeDots.forEach((d, k) => d.setFillStyle(k < filled ? COL.white : 0x4a4058, 1));
    if (this.badge.alpha < 1) {
      this.badge.setScale(0.6);
      this.m.tween(this.badge, { alpha: 1, scale: 1 }, 'fast', 'pop');
    }
    if (big && !this.loops.badge && !this.m.reduced) this.loops.badge = this.m.loop(this.badge, { scale: BT.intent.bigPulse }, BT.intent.bigPulseDur * 2);
    if (!big && this.loops.badge) {
      this.stopLoop('badge');
      this.m.tween(this.badge, { scale: 1 }, 'fast');
    }
  }
  /** 차단 성공: 배지가 금 가며 깨짐 + 카드 흔들림 */
  async breakBadge() {
    if (!this.badge) return;
    this.stopLoop('badge');
    this.badgeCrack.setAlpha(1);
    this.badgeIcon.setTint(0x888888);
    this.shake();
    await this.m.tween(this.badge, { scale: 1.25, alpha: 0 }, 'base', 'out');
  }

  // ── 행동 연출 (7장) ──
  /** 대상 반대쪽으로 물러나며 1.08배 */
  windup(dirX, dirY) {
    if (this.m.reduced) return Promise.resolve();
    const H = BT.hit;
    const s = this.root.scale;
    return this.m.tween(this.act, { x: (-dirX * H.backoff) / s, y: (-dirY * H.backoff) / s, scale: H.windupScale }, H.windup, 'out');
  }
  /** 대상까지 거리의 70% 돌진 + 진행 방향으로 6° 기울기 */
  dash(tx, ty) {
    if (this.m.reduced) return Promise.resolve();
    const H = BT.hit;
    const s = this.root.scale;
    const dx = (tx - this.root.x) * H.dashRatio;
    const dy = (ty - this.root.y) * H.dashRatio;
    return this.m.tween(this.act, { x: dx / s, y: dy / s, angle: Math.sign(dx || 1) * H.tilt }, H.dash, 'in');
  }
  /** 광역: 진영 가운데 앞으로 나와 1.1배 */
  stepForward(x, y) {
    if (this.m.reduced) return Promise.resolve();
    const s = this.root.scale;
    return this.m.tween(this.act, { x: (x - this.root.x) / s, y: (y - this.root.y) / s, scale: BT.aoe.scale }, 'base', 'out');
  }
  /** 제자리로 */
  goHome() {
    if (this.m.reduced) return Promise.resolve();
    return this.m.tween(this.act, { x: 0, y: 0, angle: 0, scale: 1 }, BT.hit.ret, 'out');
  }
  /** 맞음: 흰색 번쩍임 + 16px 밀렸다가 돌아옴 */
  async playHit(dirX = 0, dirY = -1) {
    this.m.flash(this.body, BT.hit.flash);
    if (this.m.reduced) return;
    const s = this.root.scale;
    const K = BT.hit.knock;
    this.act.x = (dirX * K) / s;
    this.act.y = (dirY * K) / s;
    await this.m.tween(this.act, { x: 0, y: 0 }, 'slow', 'pop');
  }
  /** 좌우로 짧게 흔들림 (instant × 3) */
  async shake(target = this.act) {
    if (this.m.reduced) return;
    const x0 = 0;
    for (const dx of [BT.hand.shakeX, -BT.hand.shakeX, 0]) await this.m.tween(target, { x: x0 + dx }, BT.motion.instant / 2, 'out');
  }
  /** 패시브 발동 등: 짧은 반짝임 */
  glint() {
    this.glowActive.setAlpha(1);
    return this.m.tween(this.glowActive, { alpha: this.st.active ? ST.activeEdge.alpha : 0 }, 'slow', 'out');
  }

  /** 쓰러짐: 번쩍 → 금 → 회색으로 30px 떨어지며 사라짐 + 조각 */
  async playDeath() {
    if (!this.alive) return;
    this.alive = false;
    this.stopAllLoops();
    this.setIntent(null);
    this.zone.disableInteractive();
    const D = BT.death;
    if (this.m.instant) {
      this.root.setVisible(false);
      return;
    }
    if (this.m.reduced) {
      this.gray.setAlpha(1);
      await this.m.tween(this.root, { alpha: 0 }, 'fast');
      this.root.setVisible(false);
      return;
    }
    await this.m.flash(this.body, D.flash);
    this.crack.setScale(this.crack.scaleX * 0.5).setAlpha(1);
    await this.m.tween(this.crack, { scale: (this.w * 1.1) / 256 }, D.crack, 'out');
    const c = this.center();
    this.fx?.shards(c.x, c.y, 0xbab2c8);
    this.m.tween(this.gray, { alpha: 1 }, 'fast');
    await this.m.tween(this.act, { y: this.act.y + D.drop / this.root.scale }, D.fall, 'in');
    await this.m.tween(this.root, { alpha: 0 }, 'fast');
    this.root.setVisible(false);
  }

  /** 웨이브 등장: 위에서 떨어지며 1.2배 → 1배 */
  async dropIn(delay = 0) {
    const W = BT.wave;
    if (this.m.instant) return;
    if (this.m.reduced) {
      this.root.setAlpha(0);
      await this.m.tween(this.root, { alpha: 1 }, 'fast', 'out', { delay });
      return;
    }
    this.root.setAlpha(0);
    this.act.y = -W.dropFrom;
    this.lift.setScale(W.dropScale);
    this.m.tween(this.root, { alpha: 1 }, 'fast', 'out', { delay });
    this.m.tween(this.lift, { scale: 1 }, 'slow', 'pop', { delay });
    await this.m.tween(this.act, { y: 0 }, 'slow', 'in', { delay });
    const b = this.bounds();
    this.fx?.dust(b.x + b.w / 2, b.y + b.h, b.w);
  }

  destroy() {
    this.stopAllLoops();
    this.m.kill([this.root, this.act, this.bob, this.lift, this.flip]);
    this.root.destroy(true);
    for (const k of this.texKeys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }
}
