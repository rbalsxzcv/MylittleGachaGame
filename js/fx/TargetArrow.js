// 화살표 (BATTLE_UI.md 5장 · 6장)
// - TargetArrow: 끌기 화살표. 2차 베지어 위에 꺾쇠 조각(풀)이 대상 쪽으로 흐름(간격 28px, 초당 120px). 끄는 동안에만 갱신
// - IntentArrows: 적 예고 화살표. 적 카드 아래 가장자리 → 노리는 아군. 모두 0.3, 바로 다음에 행동할 적만 1.
//   예고가 바뀔 때만 다시 그림. 광역은 화살표 대신 아군 진영 테두리가 빨갛게 맥박
import { BT } from './battleTheme.js';

const A = BT.arrow;
const quad = (p0, p1, p2, t) => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
});
const control = (a, b, lift) => ({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift });

/** 곡선을 잘게 나눈 점과 누적 길이 */
function sample(p0, p1, p2, n = 28) {
  const pts = [p0];
  const acc = [0];
  for (let i = 1; i <= n; i++) {
    const p = quad(p0, p1, p2, i / n);
    acc.push(acc[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y));
    pts.push(p);
  }
  return { pts, acc, len: acc[n] };
}
function at(s, d) {
  const { pts, acc } = s;
  let i = 1;
  while (i < acc.length - 1 && acc[i] < d) i++;
  const t = (d - acc[i - 1]) / Math.max(0.0001, acc[i] - acc[i - 1]);
  const a = pts[i - 1];
  const b = pts[i];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, rot: Math.atan2(b.y - a.y, b.x - a.x) };
}

export class TargetArrow {
  constructor(scene, motion) {
    this.scene = scene;
    this.m = motion;
    this.layer = scene.add.container(0, 0).setDepth(BT.depth.drag);
    this.pool = Array.from({ length: 48 }, () => scene.add.image(0, 0, 'bfx-chevron').setDisplaySize(A.chevron, A.chevron).setVisible(false));
    this.head = scene.add.image(0, 0, 'bfx-chevron').setDisplaySize(A.chevron * 1.8, A.chevron * 1.8).setVisible(false);
    this.layer.add([...this.pool, this.head]);
    this.active = false;
    this.phase = 0;
    this.from = null;
    this.to = null;
    this.onUpdate = (time, delta) => this.tick(delta);
  }
  show(from, color) {
    this.from = from;
    this.to = { ...from };
    this.color = color;
    for (const c of [...this.pool, this.head]) c.setTint(color);
    this.layer.setAlpha(0);
    this.m.tween(this.layer, { alpha: 1 }, 'instant');
    if (!this.active) this.scene.events.on('update', this.onUpdate);
    this.active = true;
    this.draw();
  }
  update(to) {
    this.to = to;
    this.draw();
  }
  hide() {
    if (!this.active) return;
    this.active = false;
    this.scene.events.off('update', this.onUpdate);
    this.m.tween(this.layer, { alpha: 0 }, 'fast').then(() => {
      if (!this.active) for (const c of [...this.pool, this.head]) c.setVisible(false);
    });
  }
  tick(delta) {
    if (!this.active) return;
    // 흐름은 배속과 상관없이 같은 속도 (조작 중 화면)
    this.phase = (this.phase + (A.speed * delta) / 1000) % A.gap;
    this.draw();
  }
  draw() {
    const p0 = this.from;
    const p2 = this.to;
    const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    const s = sample(p0, control(p0, p2, Math.min(A.lift, dist * 0.35)), p2);
    let k = 0;
    for (let d = this.phase; d < s.len - A.chevron * 1.2 && k < this.pool.length; d += A.gap, k++) {
      const p = at(s, d);
      this.pool[k].setPosition(p.x, p.y).setRotation(p.rot).setVisible(true).setAlpha(0.35 + 0.65 * (d / Math.max(1, s.len)));
    }
    for (; k < this.pool.length; k++) this.pool[k].setVisible(false);
    const end = at(s, Math.max(0, s.len - 1));
    this.head.setPosition(p2.x, p2.y).setRotation(end.rot).setVisible(dist > A.chevron);
  }
}

export class IntentArrows {
  constructor(scene, motion) {
    this.scene = scene;
    this.m = motion;
    this.layer = scene.add.container(0, 0).setDepth(BT.depth.arrows);
    this.arrows = new Map(); // 적 uid → { g, key }
    const a = BT.area.ally;
    this.aoeFrame = scene.add.graphics().lineStyle(4, BT.color.hpLow, 1).strokeRoundedRect(a.x - 6, a.y - 6, a.w + 12, a.h + 4, BT.radius.panel).setAlpha(0);
    this.layer.add(this.aoeFrame);
    this.aoeLoop = null;
  }
  /**
   * list: [{ uid, from:{x,y}, to:{x,y}|null, aoe, live, big }]
   */
  set(list) {
    const seen = new Set();
    let aoe = false;
    for (const it of list) {
      if (it.aoe) aoe = true;
      if (!it.to) continue;
      seen.add(it.uid);
      const key = `${Math.round(it.from.x)},${Math.round(it.from.y)},${Math.round(it.to.x)},${Math.round(it.to.y)},${it.big ? 1 : 0}`;
      let a = this.arrows.get(it.uid);
      if (!a) {
        a = { g: this.scene.add.graphics().setAlpha(0), key: '' };
        this.layer.add(a.g);
        this.arrows.set(it.uid, a);
      }
      if (a.key !== key) {
        a.key = key;
        this.drawArrow(a.g, it.from, it.to, it.big ? BT.color.hpLow : BT.color.enemy);
      }
      a.live = it.live;
      this.m.tween(a.g, { alpha: it.live ? BT.intent.liveAlpha : BT.intent.idleAlpha }, 'fast');
    }
    for (const [uid, a] of this.arrows) {
      if (seen.has(uid)) continue;
      this.arrows.delete(uid);
      this.m.tween(a.g, { alpha: 0 }, 'fast').then(() => a.g.destroy());
    }
    if (aoe && !this.aoeLoop) {
      this.aoeFrame.setAlpha(0.2);
      this.aoeLoop = this.m.loop(this.aoeFrame, { alpha: 0.9 }, BT.state.targetPulse * 2);
    } else if (!aoe && this.aoeLoop) {
      this.aoeLoop.stop();
      this.aoeLoop = null;
      this.m.tween(this.aoeFrame, { alpha: 0 }, 'fast');
    }
  }
  drawArrow(g, from, to, color) {
    g.clear();
    const s = sample(from, control(from, to, 30), to, 24);
    g.lineStyle(4, color, 1);
    // 점선 곡선 (16 그리고 10 비움), 끝은 화살촉
    for (let d = 0; d < s.len - 18; d += 26) {
      const a = at(s, d);
      const b = at(s, Math.min(s.len - 18, d + 16));
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    const tip = at(s, s.len);
    const back = at(s, s.len - 20);
    const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
    g.fillStyle(color, 1);
    g.fillTriangle(
      to.x,
      to.y,
      to.x - Math.cos(ang - 0.5) * 20,
      to.y - Math.sin(ang - 0.5) * 20,
      to.x - Math.cos(ang + 0.5) * 20,
      to.y - Math.sin(ang + 0.5) * 20,
    );
  }
  /** 적 공격 직전: 그 적의 화살표가 한 번 밝게 번쩍 */
  async flash(uid) {
    const a = this.arrows.get(uid);
    if (!a) return;
    a.g.setAlpha(1);
    await this.m.tween(a.g, { alpha: 0.45 }, 'base', 'out');
  }
  clear() {
    this.set([]);
  }
}
