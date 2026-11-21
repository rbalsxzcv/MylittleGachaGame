// 가챠 연출 장면 (Phaser) — 결과가 정해진 뒤에 보여 주기만 함 (결과는 js/systems/gacha.js가 이미 결정)
//
// 순서
//  1. 진입: 배너에서 카메라 줌/페이드, 서로 다른 속도로 도는 마법진 여러 겹, 가운데로 모이는 빛 입자
//  2. 희귀도 암시: 모이는 빛이 최고 희귀도 색으로. 5★는 30% 확률로 보라 → 금 '승급' 연출.
//     4★ 이상은 카메라 흔들림 + 진동(5★는 더 세게)
//  3. 폭발: 흰 섬광, 회전하는 빛줄기(가산 혼합), 퍼지는 충격파 링, Bloom
//  4. 카드: 1회 = 가운데 큰 카드 자동 뒤집기 / 10회 = 차례로 날아와 격자, 탭하면 모두 뒤집기
//     뒤집기는 scaleX 1→0 → 앞면으로 바꿈 → 0→1. 높은 희귀도일수록 Shine 강하게, 4★+ Glow 테두리,
//     별이 하나씩 찍히고 5★의 마지막 별에서 입자 폭발
//  5. 컷인: 모든 5★와 새로 얻은 4★ (js/fx/CutIn.js)
//  6. 끝: data.finish({ skipped }) → 호스트가 'gachaFxComplete'를 알림 → HTML 결과 격자
// 어느 단계에서든 SKIP / 탭으로 진행, 2배속(설정에 저장), 기기 성능에 따라 입자 수 조절,
// prefers-reduced-motion이면 페이드만.

import { FONT, assetUrl, fxQuality, rarityColor } from './phaserHost.js';
import { ensureFxTextures } from './textures.js';
import { playCutIn, queueCharTexture, charTextureKey } from './CutIn.js';

const TAU = Math.PI * 2;

/** 컷인을 보여 줄 결과인지: 모든 5★ + 새 4★ */
export const needsCutIn = (r) => r.rarity >= 5 || (r.rarity === 4 && r.isNew);

/** 카드 테두리 텍스처 (크기별로 한 번) */
function frameTexture(scene, w, h) {
  const key = `fx-frame-${w}x${h}`;
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(6, 0xffffff, 1);
    g.strokeRoundedRect(4, 4, w - 8, h - 8, 16);
    g.generateTexture(key, w, h);
    g.destroy();
  }
  return key;
}

export function createGachaFxScene(Phaser) {
  return class GachaFxScene extends Phaser.Scene {
    constructor() {
      super('GachaFx');
    }

    /**
     * @param {{results:Array, speed?:1|2, reduced?:boolean, fakeout?:boolean|null, onSpeed?:(s:number)=>void, finish:(r:object)=>void}} data
     *   fakeout: true/false로 강제 (fx-test), null이면 5★일 때 30% 확률
     */
    init(data) {
      this.opts = data;
      this.results = data.results || [];
      this.speed = data.speed === 2 ? 2 : 1;
      this.reduced = !!data.reduced;
      this.top = Math.max(1, ...this.results.map((r) => r.rarity));
      this.phase = 'intro';
      this.ended = false;
      this.cards = [];
      this.emitters = [];
      this.cutin = null;
    }

    preload() {
      this.load.on('loaderror', (file) => console.warn('[fx] 그림을 불러오지 못했어요:', file?.src));
      for (const r of this.results) queueCharTexture(this, r.char, assetUrl(r.char.cutout || r.char.image));
    }

    create() {
      ensureFxTextures(this);
      this.quality = fxQuality(this.game);
      this.webgl = this.game.renderer.type === Phaser.WEBGL;
      this.applySpeed();
      const W = this.scale.width;
      const H = this.scale.height;
      this.cameras.main.setZoom(1).setScroll(0, 0);

      this.add.rectangle(0, 0, W, H, 0x07040f, 1).setOrigin(0);
      this.add.image(W / 2, H / 2, 'fx-dot').setScale(26).setTint(0x2a1550).setAlpha(0.8);
      this.add.image(W * 0.2, H * 0.9, 'fx-dot').setScale(14).setTint(0x1a2a55).setAlpha(0.6);

      this.makeButtons();
      this.input.on('pointerdown', (pointer, over) => {
        if (over.some((o) => o.getData?.('ui'))) return;
        this.advance();
      });
      this.input.keyboard?.on('keydown', (e) => {
        if (e.code === 'Escape' || e.code === 'KeyS') this.finish(true);
        else if (e.code === 'Space' || e.code === 'Enter') this.advance();
      });

      if (this.reduced) this.startCards();
      else this.startIntro();
    }

    // ── 공통 ──
    applySpeed() {
      this.tweens.timeScale = this.speed;
      this.time.timeScale = this.speed;
      for (const e of this.emitters) e.timeScale = this.speed;
    }
    /** 카메라 효과처럼 timeScale이 안 먹는 시간 */
    ms(v) {
      return v / this.speed;
    }
    addEmitter(x, y, tex, cfg) {
      const e = this.add.particles(x, y, tex, cfg);
      e.timeScale = this.speed;
      this.emitters.push(e);
      return e;
    }
    vibrate(pattern) {
      try {
        navigator.vibrate?.(pattern);
      } catch {}
    }

    makeButtons() {
      const W = this.scale.width;
      const mk = (x, label, onClick) => {
        const t = this.add
          .text(x, 28, label, { fontFamily: FONT, fontSize: '22px', fontStyle: '800', color: '#ffffff', backgroundColor: 'rgba(20,12,40,0.72)', padding: { x: 16, y: 8 } })
          .setOrigin(1, 0)
          .setDepth(1000)
          .setInteractive({ useHandCursor: true });
        t.setData('ui', true);
        t.on('pointerdown', onClick);
        return t;
      };
      mk(W - 24, 'SKIP ▶▶', () => this.finish(true));
      this.speedBtn = mk(W - 170, '', () => {
        this.speed = this.speed === 2 ? 1 : 2;
        this.applySpeed();
        this.updateSpeedBtn();
        this.opts.onSpeed?.(this.speed);
      });
      this.updateSpeedBtn();
      this.hint = this.add.text(W / 2, this.scale.height - 34, '', { fontFamily: FONT, fontSize: '22px', fontStyle: '700', color: '#e8dcff' }).setOrigin(0.5).setDepth(900).setAlpha(0);
    }
    updateSpeedBtn() {
      this.speedBtn.setText(this.speed === 2 ? '2배속 ON' : '2배속');
      this.speedBtn.setColor(this.speed === 2 ? '#ffd36b' : '#ffffff');
    }
    showHint(text) {
      this.hint.setText(text);
      this.tweens.killTweensOf(this.hint);
      this.hint.setAlpha(0);
      if (!text) return;
      this.tweens.add({ targets: this.hint, alpha: { from: 0.35, to: 1 }, duration: 700, yoyo: true, repeat: -1 });
    }

    /** 탭/스페이스: 지금 단계를 건너뛰고 다음으로 */
    advance() {
      if (this.ended) return;
      if (this.phase === 'intro') return this.startCards();
      if (this.phase === 'cards') return this.flipAll();
      if (this.phase === 'cutin') return this.cutin?.skip();
      if (this.phase === 'done') return this.finish(false);
    }

    finish(skipped) {
      if (this.ended) return;
      this.ended = true;
      this.cutin?.destroy();
      this.cameras.main.resetFX();
      this.opts.finish?.({ skipped });
    }

    // ── 1~3. 진입 · 암시 · 폭발 ──
    startIntro() {
      const W = this.scale.width;
      const H = this.scale.height;
      const cx = W / 2;
      const cy = H / 2;
      const cam = this.cameras.main;
      const q = this.quality;
      const fake = this.top >= 5 && (this.opts.fakeout ?? Math.random() < 0.3);
      const hint = fake ? rarityColor(4) : rarityColor(this.top);
      const neutral = 0xb9a8ff;

      const c = (this.intro = this.add.container(0, 0));
      cam.setZoom(1.18);
      cam.fadeIn(this.ms(450), 7, 4, 15);
      this.tweens.add({ targets: cam, zoom: 1, duration: 1300, ease: 'Cubic.out' });

      // 마법진 3겹 (서로 다른 속도/방향)
      const rings = [
        this.add.image(cx, cy, 'fx-circle1').setScale(0.55).setAlpha(0),
        this.add.image(cx, cy, 'fx-circle2').setScale(0.5).setAlpha(0),
        this.add.image(cx, cy, 'fx-circle1').setScale(0.26).setAlpha(0),
      ];
      rings.forEach((r, i) => {
        r.setTint(neutral).setBlendMode('ADD');
        c.add(r);
        this.tweens.add({ targets: r, alpha: 0.85 - i * 0.15, scale: r.scale * 1.7, duration: 900, ease: 'Cubic.out', delay: i * 120 });
        this.tweens.add({ targets: r, rotation: (i % 2 ? -1 : 1) * TAU, duration: [9000, 5200, 2600][i], repeat: -1 });
      });

      // 가운데로 모이는 빛 입자
      const conv = this.addEmitter(cx, cy, 'fx-dot', {
        emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, 560), quantity: 64 },
        moveToX: cx,
        moveToY: cy,
        lifespan: 900,
        frequency: Math.round(18 / q),
        quantity: q < 0.5 ? 1 : 2,
        scale: { start: 0.45, end: 0.08 },
        alpha: { start: 0.2, end: 1 },
        tint: neutral,
        blendMode: 'ADD',
      });
      c.add(conv);

      const orb = this.add.image(cx, cy, 'fx-dot').setScale(0).setTint(neutral).setBlendMode('ADD');
      c.add(orb);

      // 2. 희귀도 암시
      const tint = (col) => {
        rings.forEach((r) => r.setTint(col));
        orb.setTint(col);
        conv.setParticleTint(col);
      };
      this.time.delayedCall(1050, () => {
        tint(hint);
        this.tweens.add({ targets: orb, scale: 3.2, duration: 700, ease: 'Sine.out' });
        if (this.top >= 4) {
          cam.shake(this.ms(this.top >= 5 ? 650 : 420), this.top >= 5 ? 0.011 : 0.005);
          this.vibrate(this.top >= 5 ? [90, 50, 180] : [60]);
        }
      });
      if (fake) {
        // 보라 → 금 '승급'
        this.time.delayedCall(1850, () => {
          cam.flash(this.ms(180), 255, 230, 160);
          tint(rarityColor(5));
          this.tweens.add({ targets: orb, scale: 4.4, duration: 260, yoyo: true, ease: 'Back.out' });
          cam.shake(this.ms(380), 0.014);
          this.vibrate([40, 30, 220]);
        });
      }

      // 3. 폭발
      this.time.delayedCall(fake ? 2550 : 2250, () => {
        const col = rarityColor(this.top);
        conv.stop();
        cam.flash(this.ms(320), 255, 255, 255);
        const rays = this.add.image(cx, cy, 'fx-rays').setTint(col).setBlendMode('ADD').setScale(0.2).setAlpha(0.95);
        c.add(rays);
        this.tweens.add({ targets: rays, scale: 1.7, duration: 600, ease: 'Cubic.out' });
        this.tweens.add({ targets: rays, rotation: TAU / 3, duration: 1600 });
        const wave = this.add.image(cx, cy, 'fx-ring').setTint(col).setBlendMode('ADD').setScale(0.2);
        c.add(wave);
        this.tweens.add({ targets: wave, scale: 6, alpha: 0, duration: 520, ease: 'Cubic.out' });
        const burst = this.addEmitter(cx, cy, 'fx-spark', {
          speed: { min: 260, max: 760 },
          lifespan: 900,
          scale: { start: 1.2, end: 0 },
          tint: [col, 0xffffff],
          blendMode: 'ADD',
          emitting: false,
        });
        c.add(burst);
        burst.explode(Math.round(60 * q));
        if (this.webgl && cam.postFX && q >= 0.45) {
          const bloom = cam.postFX.addBloom(0xffffff, 1, 1, 1.1, 1.3);
          this.time.delayedCall(650, () => cam.postFX.remove(bloom));
        }
        this.time.delayedCall(620, () => this.startCards());
      });
    }

    // ── 4. 카드 ──
    startCards() {
      if (this.phase !== 'intro' || this.ended) return;
      this.phase = 'cards';
      const cam = this.cameras.main;
      this.tweens.killTweensOf(cam);
      cam.resetFX();
      cam.setZoom(1);
      this.time.removeAllEvents();
      if (this.intro) {
        const intro = this.intro;
        this.tweens.killTweensOf(intro.list); // 무한 회전하는 마법진 등
        for (const e of this.emitters) e.stop();
        this.tweens.add({ targets: intro, alpha: 0, duration: 350, onComplete: () => intro.destroy(true) });
        this.intro = null;
      }

      const W = this.scale.width;
      const n = this.results.length;
      const single = n === 1;
      const cw = single ? 300 : 180;
      const ch = single ? 450 : 270;
      const slots = single
        ? [{ x: W / 2, y: 360 }]
        : this.results.map((_, i) => ({ x: W / 2 + ((i % 5) - 2) * (cw + 26), y: i < 5 ? 218 : 506 }));

      this.cards = this.results.map((r, i) => this.makeCard(r, slots[i], cw, ch, i));
      if (this.reduced) {
        // 페이드만: 이미 앞면인 카드가 서서히 나타남
        for (const c of this.cards) {
          c.back.setVisible(false);
          c.front.setVisible(true);
          c.flipped = true;
          c.stars.forEach((s) => s.setAlpha(1).setScale(1));
          c.root.setPosition(c.slot.x, c.slot.y).setScale(1).setAlpha(0);
          this.tweens.add({ targets: c.root, alpha: 1, duration: 400 });
        }
        this.time.delayedCall(450, () => this.afterFlips());
        return;
      }
      this.cards.forEach((c, i) => {
        c.root.setPosition(W / 2, 360).setScale(0.15).setAlpha(0).setRotation((i % 2 ? -1 : 1) * 0.5);
        this.tweens.add({ targets: c.root, x: c.slot.x, y: c.slot.y, scale: 1, alpha: 1, rotation: 0, duration: 420, delay: i * 70, ease: 'Back.out' });
      });
      const landed = 420 + (n - 1) * 70;
      if (single) this.time.delayedCall(landed + 350, () => this.flipAll());
      else this.time.delayedCall(landed, () => this.phase === 'cards' && this.showHint('탭하여 모두 열기'));
    }

    makeCard(r, slot, w, h, index) {
      const root = this.add.container(slot.x, slot.y).setDepth(10 + index);
      const col = rarityColor(r.rarity);
      const back = this.add.image(0, 0, 'fx-card-back').setDisplaySize(w, h);
      if (r.rarity >= 4) back.setTint(r.rarity >= 5 ? 0xffe7a8 : 0xe5d2ff);
      const front = this.add.container(0, 0).setVisible(false);

      // 뒤쪽 빛 (높은 희귀도일수록 크게)
      if (r.rarity >= 3) {
        const aura = this.add.image(0, 0, 'fx-dot').setTint(col).setBlendMode('ADD').setScale((w / 64) * (1 + r.rarity * 0.12)).setAlpha(0.25 + r.rarity * 0.08);
        front.add(aura);
      }
      front.add(this.add.rectangle(0, 0, w - 8, h - 8, 0x140c26, 1));

      // 캐릭터 그림: 카드를 꽉 채우고(cover) 위쪽(얼굴) 기준으로 자름
      const key = charTextureKey(r.char.id);
      let art = null;
      if (this.textures.exists(key)) {
        art = this.add.image(0, 0, key).setOrigin(0, 0);
        const src = art.texture.getSourceImage();
        const iw = w - 12;
        const ih = h - 12;
        const s = Math.max(iw / src.width, ih / src.height);
        const cropW = iw / s;
        const cropH = ih / s;
        const cx = (src.width - cropW) / 2;
        art.setScale(s).setCrop(cx, 0, cropW, cropH).setPosition(-iw / 2 - cx * s, -ih / 2);
        front.add(art);
        if (this.webgl && art.preFX && r.rarity >= 3) {
          // Shine: 희귀도가 높을수록 빠르고 넓게
          art.preFX.addShine(0.35 + (r.rarity - 3) * 0.3, 0.25 + (r.rarity - 3) * 0.12, 3 + r.rarity);
        }
      } else {
        front.add(this.add.rectangle(0, 0, w - 12, h - 12, col, 0.35));
        front.add(this.add.text(0, -20, r.char.name.slice(0, 2), { fontFamily: FONT, fontSize: `${Math.round(w / 3)}px`, fontStyle: '800', color: '#ffffff' }).setOrigin(0.5));
      }

      // 이름 판
      const plateH = Math.round(h * 0.2);
      front.add(this.add.rectangle(0, h / 2 - plateH / 2 - 6, w - 12, plateH, 0x000000, 0.62));
      front.add(
        this.add
          .text(0, h / 2 - plateH * 0.64 - 6, r.char.name, { fontFamily: FONT, fontSize: `${Math.round(w / 8.5)}px`, fontStyle: '800', color: '#ffffff' })
          .setOrigin(0.5),
      );

      // 테두리 (4★+ Glow)
      const frame = this.add.image(0, 0, frameTexture(this, w, h)).setTint(col);
      if (this.webgl && frame.preFX && r.rarity >= 4) frame.preFX.addGlow(col, r.rarity >= 5 ? 10 : 6, 0, false, 0.1, 16);
      front.add(frame);

      // 별 (희귀도 개수) — 뒤집은 뒤 하나씩 찍힘
      const starSize = Math.round(w / 9);
      const stars = [];
      for (let i = 0; i < r.rarity; i++) {
        const sx = (i - (r.rarity - 1) / 2) * (starSize * 0.95);
        const st = this.add.image(sx, h / 2 - plateH * 0.24 - 6, 'fx-star').setDisplaySize(starSize, starSize).setTint(col).setAlpha(0);
        stars.push(st);
        front.add(st);
      }

      // 배지: NEW / 정수 +1 / 티켓 +n, 픽업
      const badgeText = r.isNew ? 'NEW' : r.essence ? '정수 +1' : r.tickets ? `티켓 +${r.tickets}` : '';
      if (badgeText) {
        front.add(
          this.add
            .text(w / 2 - 10, -h / 2 + 10, badgeText, { fontFamily: FONT, fontSize: `${Math.round(w / 12)}px`, fontStyle: '800', color: '#ffffff', backgroundColor: r.isNew ? '#ff3d6e' : '#3d2b6b', padding: { x: 8, y: 3 } })
            .setOrigin(1, 0),
        );
      }
      if (r.isPickup) {
        front.add(this.add.text(-w / 2 + 10, -h / 2 + 10, 'PICKUP', { fontFamily: FONT, fontSize: `${Math.round(w / 13)}px`, fontStyle: '800', color: '#3a2200', backgroundColor: '#ffd36b', padding: { x: 6, y: 2 } }));
      }

      root.add([back, front]);
      return { r, root, back, front, stars, slot, flipped: false };
    }

    /** 카드 하나 뒤집기 → Promise (별 찍기까지) */
    flip(card, delay = 0) {
      if (card.flipped) return Promise.resolve();
      card.flipped = true;
      return new Promise((resolve) => {
        this.tweens.add({
          targets: card.root,
          scaleX: 0,
          duration: 120,
          delay,
          ease: 'Quad.in',
          onComplete: () => {
            card.back.setVisible(false);
            card.front.setVisible(true);
            if (card.r.rarity >= 4) {
              this.cameras.main.flash(this.ms(120), 255, 255, 255, true);
            }
            this.tweens.add({ targets: card.root, scaleX: 1, duration: 160, ease: 'Back.out', onComplete: () => this.stampStars(card).then(resolve) });
          },
        });
      });
    }

    stampStars(card) {
      return new Promise((resolve) => {
        const n = card.stars.length;
        if (!n) return resolve();
        card.stars.forEach((st, i) => {
          const target = st.scaleX;
          st.setScale(target * 2.4);
          this.tweens.add({
            targets: st,
            alpha: 1,
            scaleX: target,
            scaleY: target,
            duration: 160,
            delay: i * 80,
            ease: 'Back.out',
            onComplete: () => {
              if (i < n - 1) return;
              if (card.r.rarity >= 5 && this.quality > 0.2) {
                const m = card.root.getWorldTransformMatrix();
                const p = m.transformPoint(st.x, st.y);
                const b = this.addEmitter(p.x, p.y, 'fx-spark', { speed: { min: 80, max: 320 }, lifespan: 600, scale: { start: 0.8, end: 0 }, tint: [rarityColor(5), 0xffffff], blendMode: 'ADD', emitting: false });
                b.setDepth(50);
                b.explode(Math.round(26 * this.quality));
              }
              resolve();
            },
          });
        });
      });
    }

    flipAll() {
      if (this.phase !== 'cards') return;
      this.phase = 'flipping';
      this.showHint('');
      const pending = this.cards.filter((c) => !c.flipped);
      Promise.all(pending.map((c, i) => this.flip(c, i * 90))).then(() => this.afterFlips());
    }

    // ── 5. 컷인 → 6. 끝 ──
    async afterFlips() {
      if (this.ended) return;
      this.phase = 'cutin';
      for (const r of this.results.filter(needsCutIn)) {
        if (this.ended) return;
        this.cutin = playCutIn(this, r.char, { isNew: r.isNew, reduced: this.reduced, quality: this.quality });
        await this.cutin.done;
        this.cutin = null;
      }
      if (this.ended) return;
      this.phase = 'done';
      this.showHint('탭하여 결과 보기');
      this.time.delayedCall(this.results.length === 1 ? 900 : 1600, () => this.finish(false));
    }
  };
}
