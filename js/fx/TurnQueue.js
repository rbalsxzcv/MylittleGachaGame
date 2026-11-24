// 행동 순서 (왼쪽, BATTLE_UI.md 9장) — 얼굴 칩을 다시 그리지 않고 새 자리로 미끄러뜨림
// 지금 차례 72px · 나머지 56px · 간격 10px, 아군 테두리 = 테마색 / 적 = 빨강 계열
// 행동이 끝난 칩은 위로 빠지며 사라지고, 새 칩은 아래에서 들어옴. 칩을 누르면 그 카드가 1초간 맥박
import { BT } from './battleTheme.js';
import { iconKey, tokenIcon } from './icons.js';
import { diffQueue, queueSlot } from './battleChoreo.js';
import { drawCrop } from './BattleCard.js';

const Q = BT.queue;

/** 얼굴 칩 텍스처 (원으로 잘린 얼굴, 지름 72 × 해상도) */
function faceTexture(scene, refId, artKey, cropY = 0) {
  const key = `bchip:${refId}`;
  if (scene.textures.exists(key)) return key;
  const R = BT.card.res;
  const S = Q.cur * R;
  const tex = scene.textures.createCanvas(key, S, S);
  const ctx = tex.getContext();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#1b1430';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const src = artKey && scene.textures.exists(artKey) ? scene.textures.get(artKey).getSourceImage() : null;
  if (src?.width) drawCrop(ctx, src, S, S, Q.faceTop, cropY + Q.faceY);
  ctx.restore();
  tex.refresh();
  return key;
}

export class TurnQueue {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} motion
   * @param {{ info:(id:string)=>({refId, artKey, cropY, side, theme}|null), onTap:(uid:string)=>void }} o
   */
  constructor(scene, motion, o) {
    this.scene = scene;
    this.m = motion;
    this.o = o;
    this.layer = scene.add.container(0, 0).setDepth(BT.depth.queue);
    this.chips = []; // { id, kind, c }
    this.x = BT.area.queue.x + BT.area.queue.w / 2;
  }

  makeChip(item) {
    const add = this.scene.add;
    const c = add.container(this.x, 0);
    const r = Q.cur / 2;
    if (item.kind === 'token') {
      const owner = this.o.info(item.owner);
      const col = item.big ? BT.color.hpLow : owner?.side === 'ally' ? owner.theme : BT.color.enemy;
      c.add([add.circle(0, 0, r + Q.ring, col), add.circle(0, 0, r, 0x1a1026), add.image(0, 0, iconKey(this.scene, tokenIcon(item.icon))).setDisplaySize(r * 1.1, r * 1.1)]);
    } else {
      const inf = this.o.info(item.id);
      const col = inf?.side === 'ally' ? inf.theme : BT.color.enemy;
      c.add(add.circle(0, 0, r + Q.ring, col));
      const key = inf ? faceTexture(this.scene, inf.refId, inf.artKey, inf.cropY) : null;
      if (key) c.add(add.image(0, 0, key).setScale(1 / BT.card.res));
      else c.add(add.circle(0, 0, r, 0x1a1026));
    }
    const zone = add.zone(0, 0, Q.cur + 8, Q.cur + 8).setInteractive({ useHandCursor: true });
    zone.setData('ui', true);
    zone.on('pointerdown', (p, lx, ly, ev) => {
      ev?.stopPropagation?.();
      const uid = item.kind === 'token' ? item.owner : item.id;
      this.o.onTap(uid);
    });
    c.add(zone);
    this.layer.add(c);
    return { id: item.id, kind: item.kind, c };
  }

  /** 새 목록으로 (0 = 지금 차례). items: engine.queueItems 형식 [{kind, id, owner?, icon?, big?}] */
  set(items, { instant = false } = {}) {
    const list = items.slice(0, Q.count);
    const oldIds = this.chips.map((c) => c.id);
    const newIds = list.map((x) => x.id);
    const { match, exitUp, fade } = diffQueue(oldIds, newIds);
    const next = [];
    let moved = 0;
    list.forEach((item, i) => {
      const slot = queueSlot(i);
      const scale = slot.size / Q.cur;
      const j = match[i];
      if (j >= 0) {
        const chip = this.chips[j];
        next.push(chip);
        const same = Math.abs(chip.c.y - slot.y) < 0.5 && Math.abs(chip.c.scale - scale) < 0.001;
        if (!same || chip.c.alpha < 1) {
          if (instant) chip.c.setPosition(this.x, slot.y).setScale(scale);
          // alpha도 같이: 등장 중이던 트윈이 정리돼도 보이게
          else this.m.tween(chip.c, { y: slot.y, scale, alpha: 1 }, 'base', 'out', { delay: Math.min(moved++, 6) * 30 });
        }
        return;
      }
      const chip = this.makeChip(item);
      next.push(chip);
      if (instant) {
        chip.c.setPosition(this.x, slot.y).setScale(scale);
        return;
      }
      chip.c.setPosition(this.x, slot.y + Q.enterDy).setScale(scale).setAlpha(0);
      this.m.tween(chip.c, { y: slot.y, alpha: 1 }, 'fast', 'out', { delay: Math.min(moved++, 6) * 30 });
    });
    for (const j of exitUp) {
      const c = this.chips[j].c;
      if (instant) c.destroy();
      else this.m.tween(c, { y: c.y - Q.exitDy, alpha: 0 }, 'fast', 'in').then(() => c.destroy());
    }
    for (const j of fade) {
      const c = this.chips[j].c;
      if (instant) c.destroy();
      else this.m.tween(c, { alpha: 0, scale: c.scale * 0.8 }, 'fast', 'in').then(() => c.destroy());
    }
    this.chips = next;
  }

  /** 연출 중 차례가 넘어감 (엔진은 이미 끝까지 진행했으므로 화면 목록만 앞당김) */
  advance(uid) {
    const items = this.chips.map((c) => ({ kind: c.kind, id: c.id }));
    if (!items.length || items[0].id === uid) return;
    const k = items.findIndex((x, i) => i > 0 && x.id === uid);
    const rest = items.slice(1);
    if (k > 0) rest.splice(k - 1, 1);
    this.set([{ kind: 'unit', id: uid }, ...rest]);
  }

  /** 지금 목록의 id들 (테스트 페이지용) */
  ids() {
    return this.chips.map((c) => c.id);
  }
}
