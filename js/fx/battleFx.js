// 전투 화면 공용 효과 (BATTLE_UI.md 7장 · 8장 · 13-1장)
// - 입자: 종류마다 이미터 하나를 미리 만들어 explode만 (한 번 최대 16개, 동시 최대 150개, 품질 낮으면 절반)
// - 떠오르는 숫자: BitmapText 풀 (같은 카드에 겹치면 floatOffset)
// - 화면 섬광 · 참격 띠 · 충격파 · 빛 줄기 · 가운데 띠(WAVE/페이즈) — 객체 하나씩 만들어 두고 재사용
import { FONT } from './phaserHost.js';
import { BT } from './battleTheme.js';
import { fontFor } from './numberFont.js';
import { floatOffset, formatNum } from './battleChoreo.js';

export function createBattleFx(scene, motion, quality = 1) {
  const W = BT.W;
  const H = BT.H;
  const D = BT.depth;
  const P = BT.particles;
  const low = quality < 0.5;
  const each = Math.floor(P.max / 6);
  const count = (n) => Math.max(1, Math.min(P.burst, Math.round(n * (low ? 0.5 : 1))));
  const emitter = (key, cfg) => scene.add.particles(0, 0, key, { emitting: false, maxParticles: each, ...cfg }).setDepth(D.fx);

  const spark = emitter('fx-spark', { speed: { min: 90, max: 260 }, lifespan: 360, scale: { start: 0.7, end: 0 }, blendMode: 'ADD', tint: [0xffffff, 0xffd0c0] });
  const goldSpark = emitter('fx-spark', { speed: { min: 140, max: 360 }, lifespan: 420, scale: { start: 1, end: 0 }, blendMode: 'ADD', tint: [0xffc23d, 0xffffff] });
  const heal = emitter('fx-dot', { speedY: { min: -150, max: -70 }, speedX: { min: -30, max: 30 }, lifespan: 700, scale: { start: 0.35, end: 0 }, alpha: { start: 0.9, end: 0 }, blendMode: 'ADD', tint: BT.color.heal });
  const smoke = emitter('fx-dot', { speed: { min: 10, max: 50 }, lifespan: 620, scale: { start: 0.9, end: 1.6 }, alpha: { start: 0.55, end: 0 }, tint: BT.color.debuff });
  const shard = emitter('bfx-shard', { speed: { min: 80, max: 240 }, lifespan: 600, rotate: { min: 0, max: 360 }, scale: { start: 0.9, end: 0.2 }, alpha: { start: 1, end: 0 }, gravityY: 300 });
  const dust = emitter('fx-dot', { speedX: { min: -120, max: 120 }, speedY: { min: -40, max: -5 }, lifespan: 500, scale: { start: 0.4, end: 0.9 }, alpha: { start: 0.45, end: 0 }, tint: 0xcfc4b8 });

  // ── 떠오르는 숫자 풀 ──
  const pool = [];
  const stacks = new Map(); // 카드 uid → 지금 떠 있는 숫자 수
  const acquire = (font) => {
    let t = pool.find((x) => !x.visible && x.font === font);
    if (!t) {
      t = scene.add.bitmapText(0, 0, font, '', font === 'bnum-s' ? BT.number.dmg.size : BT.number.total.size).setOrigin(0.5).setDepth(D.numbers).setVisible(false);
      pool.push(t);
    }
    return t;
  };

  // ── 화면 섬광 · 참격 · 충격파 · 빛 줄기 · 띠 ──
  const flashRect = scene.add.rectangle(0, 0, W, H, 0xffffff, 1).setOrigin(0).setAlpha(0).setDepth(D.band);
  const slash = scene.add.image(W / 2, H / 2, 'bfx-slash').setDepth(D.band).setAlpha(0).setBlendMode('ADD');
  const wave = scene.add.image(0, 0, 'fx-ring').setDepth(D.fx).setAlpha(0).setBlendMode('ADD');
  const beams = Array.from({ length: 6 }, () => scene.add.image(0, 0, 'fx-line').setOrigin(0, 0.5).setDepth(D.fx).setAlpha(0).setBlendMode('ADD'));
  const motes = Array.from({ length: 14 }, () => scene.add.image(0, 0, 'fx-dot').setDepth(D.fx).setAlpha(0).setBlendMode('ADD').setScale(0.3));
  const bandBox = scene.add.container(W / 2, H / 2).setDepth(D.band).setAlpha(0);
  const bandBg = scene.add.rectangle(0, 0, W, BT.wave.bandH, 0x07040f, 0.78);
  const bandLine1 = scene.add.rectangle(0, -BT.wave.bandH / 2, W, 2, 0xffffff, 0.5);
  const bandLine2 = scene.add.rectangle(0, BT.wave.bandH / 2, W, 2, 0xffffff, 0.5);
  const bandText = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${BT.band.size}px`, fontStyle: BT.font.bold, color: BT.color.text, stroke: BT.color.textStroke, strokeThickness: 6 }).setOrigin(0.5);
  bandBox.add([bandBg, bandLine1, bandLine2, bandText]);

  const fx = {
    sparks(x, y, crit = false) {
      if (motion.instant) return;
      (crit ? goldSpark : spark).explode(count(crit ? BT.hit.critSparks : BT.hit.sparks), x, y);
    },
    healRise(x, y, w = 120) {
      if (motion.instant) return;
      for (let i = 0; i < 3; i++) heal.explode(count(4), x + (i - 1) * w * 0.3, y);
    },
    smoke(x, y, w = 140) {
      if (motion.instant) return;
      for (let i = 0; i < 3; i++) smoke.explode(count(4), x + (i - 1) * w * 0.25, y + (i % 2 ? -20 : 20));
    },
    shards(x, y, color = 0xffffff) {
      if (motion.instant) return;
      shard.setParticleTint?.(color);
      shard.explode(count(14), x, y);
    },
    dust(x, y, w = 140) {
      if (motion.instant || motion.reduced) return;
      dust.explode(count(8), x - w / 4, y);
      dust.explode(count(8), x + w / 4, y);
    },

    /**
     * 떠오르는 숫자 (8장)
     * @param {'dmg'|'crit'|'dot'|'heal'|'absorb'|'total'} type
     */
    number(uid, x, y, value, type = 'dmg') {
      if (motion.instant || !(value > 0)) return Promise.resolve();
      const N = BT.number;
      const st = N[type] || N.dmg;
      const { font, scale } = fontFor(st.size);
      const k = uid ? stacks.get(uid) || 0 : 0;
      if (uid) stacks.set(uid, k + 1);
      const off = floatOffset(k);
      const t = acquire(font);
      t.font = font;
      t.setText(`${type === 'heal' ? '+' : ''}${formatNum(value)}`)
        .setTint(st.color)
        .setPosition(x + off.dx, y + off.dy)
        .setAngle(st.angle || 0)
        .setAlpha(1)
        .setScale(scale * N.popFrom)
        .setVisible(true);
      const release = () => {
        t.setVisible(false);
        if (uid) stacks.set(uid, Math.max(0, (stacks.get(uid) || 1) - 1));
      };
      return motion
        .tween(t, { scale: scale * N.popPeak }, N.pop * 0.6, 'out')
        .then(() => motion.tween(t, { scale }, N.pop * 0.4, 'out'))
        .then(() => motion.tween(t, { y: t.y - N.rise, alpha: 0 }, N.riseDur, 'out'))
        .then(release, release);
    },

    /** 화면 흰 섬광 (투명도 a → 0) */
    screenFlash(a = BT.ult.flashAlpha, ms = BT.ult.flash) {
      if (motion.reduced || motion.instant) return Promise.resolve();
      flashRect.setAlpha(a);
      return motion.tween(flashRect, { alpha: 0 }, ms, 'out');
    },
    /** 테마색 참격 띠가 화면을 가로지름 */
    slash(color) {
      if (motion.reduced || motion.instant) return Promise.resolve();
      const U = BT.ult;
      slash.setTint(color).setAngle(U.bandAngle).setDisplaySize(W * 1.6, U.bandH).setPosition(-W * 0.3, H / 2).setAlpha(1);
      return motion.tween(slash, { x: W * 1.3, alpha: 0.2 }, 'fast', 'in').then(() => slash.setAlpha(0));
    },
    /** 충격파 원이 퍼짐 (광역) */
    shockwave(x, y, radius, color = 0xffffff) {
      if (motion.instant) return Promise.resolve();
      wave.setPosition(x, y).setTint(color).setScale(0.15).setAlpha(motion.reduced ? 0 : 0.9);
      if (motion.reduced) return Promise.resolve();
      return motion.tween(wave, { scale: (radius * 2) / 256, alpha: 0 }, 'base', 'out');
    },
    /** 빛 줄기: a → b로 날아감 (아군 대상 스킬) */
    beam(a, b, color, delay = 0) {
      if (motion.instant) return Promise.resolve();
      const bm = beams.find((x) => x.alpha === 0) || beams[0];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      bm.setPosition(a.x, a.y).setRotation(Math.atan2(dy, dx)).setTint(color).setScale(0.01, 3).setAlpha(1);
      return motion
        .tween(bm, { scaleX: len / 256 }, 'fast', 'in', { delay })
        .then(() => motion.tween(bm, { alpha: 0 }, 'fast', 'out'));
    },
    /** 빛 입자가 from에서 to로 빨려 들어감 (스킬 카드 → 공격자) */
    async streak(from, to, color, ms = BT.skill.absorb) {
      if (motion.instant) return;
      const list = motes.slice(0, low ? 7 : motes.length);
      list.forEach((d, i) => {
        d.setPosition(from.x + ((i % 5) - 2) * 18, from.y + (Math.floor(i / 5) - 1) * 30).setTint(color).setAlpha(1).setScale(0.35);
        motion.tween(d, { x: to.x, y: to.y, scale: 0.12, alpha: 0.2 }, ms, 'in', { delay: (i % 5) * 12 });
      });
      await motion.wait(ms + 60);
      list.forEach((d) => d.setAlpha(0));
    },
    /** 화면 가운데 띠: WAVE 2/3 · 페이즈 이름 · 광폭화 */
    async band(text, color = BT.color.text) {
      if (motion.instant) return;
      bandText.setText(text).setColor(color);
      bandBox.setAlpha(1).setScale(1, 0);
      bandText.setX(60).setAlpha(0);
      motion.tween(bandBox, { scaleY: 1 }, 'base', 'pop');
      await motion.tween(bandText, { x: 0, alpha: 1 }, 'base', 'out');
      await motion.wait(BT.wave.bandHold);
      motion.tween(bandText, { x: -60, alpha: 0 }, 'base', 'in');
      await motion.tween(bandBox, { scaleY: 0, alpha: 0 }, 'base', 'in');
    },
  };
  return fx;
}
