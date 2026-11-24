// 손패 + SP 크리스털 (BATTLE_UI.md 1장 · 5장 · 7장 · 11장)
// 손패: 차례인 아군의 [기본 공격] [스킬] 카드 112×156, 부채꼴 ±6°. 그림은 그 캐릭터 일러스트의 다른 크롭
//   누르면 1.1배로 들림 → 끌면 화살표, 대상 위에서 놓으면 실행 / 탭하면 조준 상태(대상 탭으로 실행, 하나뿐/광역은 바로)
//   SP 부족 스킬: 어둡게 + 아래 크리스털, 누르면 좌우로 짧게 흔들림
// SP: 마름모 크리스털 5개 — 얻을 때 빛나며 채워짐(Back.easeOut), 쓸 때 깨지듯 빠짐
import { FONT } from './phaserHost.js';
import { BT } from './battleTheme.js';
import { iconKey } from './icons.js';
import { drawCrop } from './BattleCard.js';

const HC = BT.card.hand;
const SP_COLOR = 0x7fd8ff;
const SP_EMPTY = 0x2a2140;
const rgba = (n, a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;

/** 행동 카드 앞면 굽기 (캐릭터 · 행동마다 한 번) */
function handTexture(scene, o) {
  const key = `bhand:${o.refId}:${o.action}:${o.name}`;
  if (scene.textures.exists(key)) return key;
  const R = BT.card.res;
  const W = HC.w * R;
  const H = HC.h * R;
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  const r = BT.radius.card * R;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(W, 0, W, H, r);
    ctx.arcTo(W, H, 0, H, r);
    ctx.arcTo(0, H, 0, 0, r);
    ctx.arcTo(0, 0, W, 0, r);
    ctx.closePath();
  };
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = '#140e22';
  ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, rgba(o.theme, 0.65));
  bg.addColorStop(1, '#140e22');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const src = o.artKey && scene.textures.exists(o.artKey) ? scene.textures.get(o.artKey).getSourceImage() : null;
  // 기본 공격 = 허리 아래쪽까지, 스킬 = 얼굴 가까이 (같은 그림의 다른 크롭)
  if (src?.width) drawCrop(ctx, src, W, H, o.action === 'skill' ? 0.3 : 0.62, o.action === 'skill' ? 0.02 : 0.18, o.action === 'skill' ? 0.5 : 0.56);
  const sh = ctx.createLinearGradient(0, H * 0.45, 0, H);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
  ctx.restore();
  ctx.lineWidth = 2 * R;
  ctx.strokeStyle = rgba(o.action === 'skill' ? SP_COLOR : 0xffffff, 0.9);
  path();
  ctx.stroke();
  // 행동 아이콘 (왼쪽 위)
  const ik = scene.textures.get(iconKey(scene, o.icon)).getSourceImage();
  ctx.beginPath();
  ctx.arc(20 * R, 20 * R, 14 * R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,6,20,0.8)';
  ctx.fill();
  if (ik) ctx.drawImage(ik, 11 * R, 11 * R, 18 * R, 18 * R);
  // 비용: 스킬 = 크리스털 n개, 기본 = 크리스털 1개 + 위 꺾쇠(얻음) — 숫자 없음
  const crystal = scene.textures.get(iconKey(scene, 'crystal')).getSourceImage();
  const up = scene.textures.get(iconKey(scene, 'buff')).getSourceImage();
  const n = o.action === 'skill' ? Math.max(0, Math.min(3, o.cost ?? 1)) : 1;
  for (let i = 0; i < n; i++) if (crystal) ctx.drawImage(crystal, W - (16 + i * 14) * R, 8 * R, 12 * R, 16 * R);
  if (o.action !== 'skill' && up) ctx.drawImage(up, W - 30 * R, 10 * R, 12 * R, 12 * R);
  // 이름 (20px, 넘치면 두 줄 → 그래도 넘치면 줄임)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  let size = BT.minText;
  const maxW = W - 12 * R;
  const words = String(o.name || '');
  let lines = [words];
  for (; size >= 15; size--) {
    ctx.font = `${BT.font.bold} ${size * R}px ${FONT}`;
    if (ctx.measureText(words).width <= maxW) {
      lines = [words];
      break;
    }
    const cut = Math.ceil(words.length / 2);
    const sp = words.lastIndexOf(' ', cut);
    const a = sp > 0 ? words.slice(0, sp) : words.slice(0, cut);
    const b = sp > 0 ? words.slice(sp + 1) : words.slice(cut);
    if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= maxW) {
      lines = [a, b];
      break;
    }
  }
  ctx.font = `${BT.font.bold} ${size * R}px ${FONT}`;
  ctx.lineWidth = 6 * R;
  ctx.strokeStyle = BT.color.textStroke;
  ctx.fillStyle = BT.color.text;
  lines.forEach((ln, i) => {
    const y = H - (12 + (lines.length - 1 - i) * (size + 2)) * R;
    ctx.strokeText(ln, W / 2, y);
    ctx.fillText(ln, W / 2, y);
  });
  tex.refresh();
  return key;
}

export class ActionHand {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} motion
   * @param {object} o
   *   arrow: TargetArrow
   *   canAct(): 입력을 받을 수 있는지
   *   targetsOf(action): { uids:[], single:boolean, none:boolean, support:boolean }
   *   aimAt(action, x, y): 손가락 근처의 대상 uid (+20px) | null → 장면이 조준 표시
   *   onArm(action|null): 들림/조준 시작·끝 (대상 맥박)
   *   onCommit(action, uid|null)
   *   centerOf(uid): {x,y}
   */
  constructor(scene, motion, o) {
    this.scene = scene;
    this.m = motion;
    this.o = o;
    const A = BT.area.hand;
    this.layer = scene.add.container(0, 0).setDepth(BT.depth.hand);
    this.cx = A.x + A.w / 2;
    this.cy = A.y + A.h / 2;
    this.cards = {};
    for (const action of ['basic', 'skill']) {
      const i = action === 'basic' ? -1 : 1;
      const c = scene.add.container(this.cx + (i * HC.spread) / 2, this.cy - (i * HC.stagger)).setAngle(i * HC.fan).setAlpha(0);
      const shadow = scene.add.image(0, 6, 'bfx-soft-hand').setTint(0x000000).setAlpha(0.45);
      const face = scene.add.image(0, 0, '__WHITE').setScale(1 / BT.card.res);
      const dim = scene.add.graphics().fillStyle(0x000000, 0.55).fillRoundedRect(-HC.w / 2, -HC.h / 2, HC.w, HC.h, BT.radius.card).setAlpha(0);
      const lack = scene.add.image(0, HC.h / 2 - 18, iconKey(scene, 'crystal')).setDisplaySize(18, 24).setTint(BT.color.hpLow).setAlpha(0);
      c.add([shadow, face, dim, lack]);
      const zone = scene.add.zone(0, 0, Math.max(HC.w, BT.minTouch), Math.max(HC.h, BT.minTouch)).setInteractive({ useHandCursor: true });
      zone.setData('ui', true);
      c.add(zone);
      this.layer.add(c);
      const card = { action, c, face, dim, lack, zone, home: { x: c.x, y: c.y, angle: c.angle }, ok: false };
      zone.on('pointerdown', (p, lx, ly, ev) => {
        ev?.stopPropagation?.();
        this.down(card, p);
      });
      this.cards[action] = card;
    }
    // 끌기 · 놓기는 장면 전체에서
    scene.input.on('pointermove', (p) => this.move(p));
    scene.input.on('pointerup', (p) => this.up(p));
    this.visible = false;
    this.press = null; // { card, x, y, dragging, aimUid }
    this.armed = null; // 탭으로 조준 중인 행동
  }

  /** 차례인 아군의 카드로 보여 주기 */
  showFor(unit, info, opt) {
    for (const action of ['basic', 'skill']) {
      const card = this.cards[action];
      const o = opt?.[action];
      card.ok = !!o?.ok;
      card.has = !!o;
      if (!o) {
        card.c.setVisible(false);
        continue;
      }
      card.c.setVisible(true);
      card.face.setTexture(handTexture(this.scene, { refId: unit.refId, action, name: o.name, cost: o.cost, theme: info.theme, artKey: info.artKey, icon: action === 'skill' ? info.skillIcon : 'attack' }));
      card.face.setScale(1 / BT.card.res);
      this.m.tween(card.dim, { alpha: card.ok ? 0 : 1 }, 'fast');
      this.m.tween(card.lack, { alpha: card.ok ? 0 : 1 }, 'fast');
    }
    if (this.visible && this.uid === unit.uid) return;
    this.uid = unit.uid;
    this.visible = true;
    ['basic', 'skill'].forEach((a, i) => {
      const card = this.cards[a];
      card.c.setPosition(card.home.x, card.home.y + BT.hand.hideDy).setAngle(card.home.angle).setScale(0.9).setAlpha(0);
      this.m.tween(card.c, { y: card.home.y, alpha: 1, scale: 1 }, 'base', 'pop', { delay: i * 40 });
    });
  }
  hide() {
    this.cancel(true);
    if (!this.visible) return;
    this.visible = false;
    ['basic', 'skill'].forEach((a, i) => {
      const card = this.cards[a];
      this.m.tween(card.c, { y: card.home.y + BT.hand.hideDy, alpha: 0 }, 'fast', 'in', { delay: i * 30 });
    });
  }

  down(card, p) {
    if (!this.visible || !this.o.canAct()) return;
    if (!card.ok) {
      this.shake(card);
      return;
    }
    if (this.armed === card.action) {
      // 조준 중에 같은 카드를 다시 누름 → 취소
      this.cancel();
      return;
    }
    this.cancel(true);
    this.press = { card, x: p.x, y: p.y, dragging: false, aimUid: null };
    this.lift(card, true);
    this.o.onArm(card.action);
  }
  move(p) {
    const pr = this.press;
    if (!pr) return;
    if (!pr.dragging && Math.hypot(p.x - pr.x, p.y - pr.y) > BT.press.slop) {
      pr.dragging = true;
      const t = this.o.targetsOf(pr.card.action);
      this.o.arrow.show({ x: pr.card.c.x, y: pr.card.c.y - HC.h * 0.55 }, t.support ? BT.arrow.support : BT.arrow.attack);
    }
    if (!pr.dragging) return;
    const uid = this.o.aimAt(pr.card.action, p.x, p.y);
    pr.aimUid = uid;
    this.o.arrow.update(uid ? this.o.centerOf(uid) : { x: p.x, y: p.y });
  }
  up() {
    const pr = this.press;
    if (!pr) return;
    this.press = null;
    const action = pr.card.action;
    if (pr.dragging) {
      this.o.arrow.hide();
      if (pr.aimUid) return this.commit(action, pr.aimUid);
      // 다른 곳에서 놓음 → 카드가 돌아옴
      this.lift(pr.card, false);
      this.o.onArm(null);
      return;
    }
    // 탭: 대상이 하나뿐이거나 광역이면 바로, 아니면 조준 상태
    const t = this.o.targetsOf(action);
    if (t.none) return this.commit(action, null);
    if (t.single) return this.commit(action, t.uids[0]);
    this.armed = action;
  }
  commit(action, uid) {
    this.armed = null;
    this.press = null;
    this.o.onCommit(action, uid);
  }
  /** 조준 · 들림 취소 (silent = 장면에 알리지 않음) */
  cancel(silent = false) {
    const was = this.armed || this.press;
    if (this.press?.dragging) this.o.arrow.hide();
    this.press = null;
    this.armed = null;
    for (const card of Object.values(this.cards)) if (card.lifted) this.lift(card, false);
    if (was && !silent) this.o.onArm(null);
    return !!was;
  }
  lift(card, on) {
    card.lifted = on;
    // alpha 포함: 등장 트윈 도중에 눌러도 반투명으로 남지 않게
    if (on) return this.m.tween(card.c, { scale: BT.hand.liftScale, angle: 0, y: card.home.y - 10, alpha: 1 }, 'fast', 'out');
    return this.m.tween(card.c, { scale: 1, angle: card.home.angle, y: card.home.y, x: card.home.x, alpha: 1 }, 'base', 'pop');
  }
  async shake(card) {
    if (this.m.reduced) return;
    const x = card.home.x;
    for (const dx of [BT.hand.shakeX, -BT.hand.shakeX, BT.hand.shakeX, 0]) await this.m.tween(card.c, { x: x + dx }, BT.motion.instant / 2, 'out');
  }

  /** 스킬: 손패의 스킬 카드가 화면 가운데로 날아가 1.15배로 300ms (손패가 숨어 있으면 그 자리에서 나타남) */
  async flyToCenter(unit, info, name, cost) {
    const S = BT.skill;
    const key = handTexture(this.scene, { refId: unit.refId, action: 'skill', name, cost, theme: info.theme, artKey: info.artKey, icon: info.skillIcon || 'attack' });
    const card = this.cards.skill;
    const from = this.visible ? { x: card.c.x, y: card.c.y, angle: card.c.angle } : { x: this.cx, y: this.cy + 40, angle: HC.fan };
    if (this.visible) card.c.setAlpha(0);
    const img = this.scene.add.image(from.x, from.y, key).setScale(1 / BT.card.res).setAngle(from.angle).setDepth(BT.depth.band);
    if (!this.visible) img.setAlpha(0);
    const s1 = (1 / BT.card.res) * S.showScale * 1.6;
    if (this.m.reduced) {
      img.setPosition(BT.W / 2, BT.H / 2).setScale(s1).setAngle(0).setAlpha(0);
      await this.m.tween(img, { alpha: 1 }, 'fast');
    } else await this.m.tween(img, { x: BT.W / 2, y: BT.H / 2, scale: s1, angle: 0, alpha: 1 }, 'base', 'out');
    await this.m.wait(S.show);
    return img;
  }
}

/** SP 크리스털 5개 */
export class SpGauge {
  constructor(scene, motion, max, fx) {
    this.scene = scene;
    this.m = motion;
    this.fx = fx;
    const A = BT.area.sp;
    this.layer = scene.add.container(0, 0).setDepth(BT.depth.hand);
    this.items = [];
    const step = A.w / max;
    for (let i = 0; i < max; i++) {
      const x = A.x + step * (i + 0.5);
      const y = A.y + A.h / 2;
      const empty = scene.add.image(x, y, iconKey(scene, 'crystal')).setDisplaySize(24, 34).setTint(SP_EMPTY);
      const glow = scene.add.image(x, y, 'fx-dot').setTint(SP_COLOR).setBlendMode('ADD').setScale(0.9).setAlpha(0);
      const fill = scene.add.image(x, y, iconKey(scene, 'crystal')).setDisplaySize(24, 34).setTint(SP_COLOR).setAlpha(0);
      this.layer.add([glow, empty, fill]);
      this.items.push({ empty, fill, glow, on: false, x, y });
    }
  }
  /** n개로 (animate=false면 바로) */
  set(n, { animate = true } = {}) {
    const base = 24 / 64;
    this.items.forEach((it, i) => {
      const on = i < n;
      if (on === it.on) return;
      it.on = on;
      if (!animate || this.m.instant) {
        it.fill.setAlpha(on ? 1 : 0).setScale(base, 34 / 64);
        return;
      }
      const delay = Math.abs(i - n) * 40;
      if (on) {
        it.glow.setAlpha(0.9);
        this.m.tween(it.glow, { alpha: 0 }, 'slow', 'out', { delay });
        it.fill.setAlpha(1).setScale(0);
        this.m.tween(it.fill, { scaleX: base, scaleY: 34 / 64 }, 'base', 'pop', { delay });
      } else {
        this.fx?.shards(it.x, it.y, SP_COLOR);
        this.m.tween(it.fill, { alpha: 0, scaleX: base * 1.3, scaleY: (34 / 64) * 1.3 }, 'fast', 'out', { delay });
      }
    });
  }
}