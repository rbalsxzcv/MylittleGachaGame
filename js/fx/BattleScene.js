// 전투 화면 (Phaser) — 카드형 화면, 기준 문서 BATTLE_UI.md. 규칙은 전부 js/battle/engine.js
//
// 이 장면은 엔진을 부르고, 엔진이 돌려준 이벤트를 battleChoreo.groupBeats로 장면 단위로 묶어
// 컴포넌트 메서드를 순서대로 await만 함 (숫자는 battleTheme, 움직임은 motion).
//   BattleCard(카드) · TurnQueue(행동 순서) · ActionHand + SpGauge(손패 · SP) · TargetArrow/IntentArrows(화살표)
//   InfoOverlay(정보창) · battleFx(입자 · 떠오르는 숫자 · 섬광 · 띠) · CutIn(궁극기 컷인)
// 연출 중에는 입력 잠금 (건너뛰기 · 일시정지 · AUTO · 2배속 · 즉시 결과 · 정보창만)
// 끝나면 data.finish({ summary, record, quit }) → HTML(js/ui/battleView.js)이 보상/결과 화면

import { FONT, FX_W, FX_H, assetUrl, fxQuality, rarityColor, hexToInt } from './phaserHost.js';
import { ensureFxTextures, ensureBattleTextures } from './textures.js';
import { playCutIn, queueCharTexture, charTextureKey } from './CutIn.js';
import { BT } from './battleTheme.js';
import { createMotion } from './motion.js';
import { groupBeats, rowLayout } from './battleChoreo.js';
import { ensureBattleIcons, preloadBattleIcons, iconKey, statIcon, actionIcon } from './icons.js';
import { ensureNumberFonts } from './numberFont.js';
import { createBattleFx } from './battleFx.js';
import { BattleCard } from './BattleCard.js';
import { TurnQueue } from './TurnQueue.js';
import { TargetArrow, IntentArrows } from './TargetArrow.js';
import { ActionHand, SpGauge } from './ActionHand.js';
import { InfoOverlay } from './InfoOverlay.js';

const enemyKey = (id) => `enemy:${id}`;
const BG_KEY = 'battle-bg';
const COL = BT.color;

export function createBattleScene(Phaser) {
  return class BattleScene extends Phaser.Scene {
    constructor() {
      super('Battle');
    }

    /**
     * backgrounds: 전투 배경 후보 (앞에서부터, 못 불러오면 다음 — adventure.battleBackgrounds)
     * @param {{battle:object, data:object, stage:object, backgrounds?:string[], speed?:1|2, auto?:boolean, reduced?:boolean,
     *          dev?:boolean, onSettings?:(patch:object)=>void, onReady?:(scene)=>void, finish:(r:object)=>void}} data
     */
    init(data) {
      this.opts = data;
      this.battle = data.battle;
      this.speed = data.speed === 2 ? 2 : 1;
      this.auto = !!data.auto;
      this.reduced = !!data.reduced;
      this.mode = 'busy'; // busy | input | target | ended
      this.instant = false;
      this.paused = false;
      this.ended = false;
      this.playing = false;
      this.finished = false;
      this.endReady = false;
      this.cards = new Map(); // uid → BattleCard
      this.looks = new Map();
      this.dispShield = new Map();
      this.pick = null; // 궁극기 조준: { action:'ultimate', uid, uids }
      this.cutin = null;
      this.press = null;
    }

    preload() {
      this.load.on('loaderror', (file) => console.warn('[battle] 불러오지 못했어요:', file?.src));
      for (const u of this.battle.state.allies) queueCharTexture(this, { id: u.refId }, assetUrl(u.image));
      const seen = new Set();
      for (const wave of this.opts.stage.waves) {
        for (const e of wave) {
          const ent = this.opts.data.enemyMap.get(e.enemyId);
          if (!ent?.image || seen.has(ent.id) || this.textures.exists(enemyKey(ent.id))) continue;
          seen.add(ent.id);
          this.load.image(enemyKey(ent.id), assetUrl(ent.image));
        }
      }
      // 배경: 첫 후보를 불러오고, 실패하면 다음 후보 (스테이지 전용 → 스토리 배경 → 기본 배경)
      // (텍스처는 게임 전체가 같이 쓰므로 지난 전투의 배경을 먼저 지움)
      if (this.textures.exists(BG_KEY)) this.textures.remove(BG_KEY);
      const bgs = (this.opts.backgrounds || []).filter(Boolean);
      let bgAt = 0;
      const tryBg = () => bgAt < bgs.length && this.load.image(BG_KEY, assetUrl(bgs[bgAt++]));
      if (this.bgRetry) this.load.off('loaderror', this.bgRetry);
      this.bgRetry = (file) => file?.key === BG_KEY && tryBg();
      this.load.on('loaderror', this.bgRetry);
      tryBg();
      preloadBattleIcons(this);
    }

    create() {
      const C = BT.card;
      ensureFxTextures(this);
      ensureBattleTextures(this, { ally: C.ally, enemy: C.enemy, boss: C.boss, hand: C.hand }, { pad: BT.shadow.pad, radius: C.radius, edgeBlur: BT.state.activeEdge.blur });
      ensureBattleIcons(this);
      ensureNumberFonts(this);
      this.quality = fxQuality(this.game);
      this.applySpeed();
      this.cameras.main.setZoom(1).setScroll(0, 0);
      this.m = createMotion(this, { speed: this.speed, reduced: this.reduced });

      // 배경: 밝기 60% + 비네트 (카드가 항상 더 밝게)
      this.add.rectangle(0, 0, FX_W, FX_H, COL.bg, 1).setOrigin(0).setDepth(BT.depth.bg);
      if (this.textures.exists(BG_KEY)) {
        const bg = this.add.image(FX_W / 2, FX_H / 2, BG_KEY).setDepth(BT.depth.bg);
        const src = bg.texture.getSourceImage();
        const v = Math.round(255 * BT.background.brightness);
        bg.setScale(Math.max(FX_W / src.width, FX_H / src.height)).setTint((v << 16) | (v << 8) | v);
      }
      this.add.image(FX_W / 2, FX_H / 2, 'bfx-vignette').setDisplaySize(FX_W, FX_H).setAlpha(BT.background.vignette).setDepth(BT.depth.bg);

      this.enemyLayer = this.add.container(0, 0).setDepth(BT.depth.enemy);
      this.allyLayer = this.add.container(0, 0).setDepth(BT.depth.ally);
      this.fx = createBattleFx(this, this.m, this.quality);
      this.intentArrows = new IntentArrows(this, this.m);
      this.arrow = new TargetArrow(this, this.m);
      this.queue = new TurnQueue(this, this.m, {
        info: (id) => this.look(id),
        onTap: (uid) => this.cards.get(uid)?.pulse(),
      });
      this.sp = new SpGauge(this, this.m, this.battle.state.spMax, this.fx);
      this.hand = new ActionHand(this, this.m, {
        arrow: this.arrow,
        canAct: () => this.mode === 'input' && !this.auto && !this.info.open,
        targetsOf: (a) => this.targetsOf(a),
        aimAt: (a, x, y) => this.aimAt(this.targetsOf(a).uids, x, y),
        onArm: (a) => this.showTargets(a ? this.targetsOf(a).uids : null),
        onCommit: (a, uid) => this.commit({ kind: 'act', action: a, target: uid }),
        centerOf: (uid) => this.cards.get(uid)?.center() ?? { x: FX_W / 2, y: FX_H / 2 },
      });
      this.info = new InfoOverlay(this, this.m, { battle: this.battle, data: this.opts.data });
      this.popIcons = Array.from({ length: 4 }, () => this.add.image(0, 0, iconKey(this, 'resist')).setDepth(BT.depth.numbers).setAlpha(0));
      this.makeTopBar();
      this.makeCards('ally', true);
      this.makeCards('enemy', true);
      this.makePressRing();

      this.input.on('pointerdown', (p, over) => {
        if (p.rightButtonDown()) {
          if (this.info.open) this.info.hide();
          else this.cancelAim();
          return;
        }
        if (this.cutin && !over.some((o) => o.getData?.('ui'))) this.cutin.skip();
        if (this.mode === 'ended' && this.endReady) this.finish(false);
      });
      this.input.on('pointermove', (p) => this.pressMove(p));
      this.input.on('pointerup', () => this.pressUp());
      this.input.mouse?.disableContextMenu();
      this.input.keyboard?.on('keydown', (e) => this.onKey(e));
      this.events.once('shutdown', () => this.cleanup());

      if (this.opts.dev) this.makeFps();
      this.syncAll({ instant: true });
      if (this.battle.state.result) this.showEnd();
      else this.afterBatch();
      this.opts.onReady?.(this);
    }

    // ── 공통 ──
    applySpeed() {
      this.tweens.timeScale = this.speed;
      this.time.timeScale = this.speed;
      if (this.m) this.m.speed = this.speed;
    }
    text(x, y, str, size = BT.minText, color = COL.text, bold = true) {
      return this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? BT.font.bold : BT.font.body, color });
    }
    unitOf(uid) {
      return this.battle.unit(uid);
    }
    sideOf(uid) {
      return this.battle.unit(uid)?.side ?? null;
    }

    /** 유닛의 그림 · 색 정보 (카드 · 칩 · 손패 공용) */
    look(uid) {
      if (this.looks.has(uid)) return this.looks.get(uid);
      const u = this.unitOf(uid);
      if (!u) return null;
      const d = this.opts.data;
      let out;
      if (u.side === 'ally') {
        const ent = d.allCharMap?.get(u.refId) || d.charMap?.get(u.refId);
        const sk = u.kit?.skill;
        const types = new Set((sk?.effects || []).map((e) => e.type));
        const skillIcon = types.has('heal') ? 'heal' : types.has('shield') ? 'shield' : /ally|self/.test(sk?.targeting || '') ? 'buff' : 'attack';
        out = { refId: u.refId, side: 'ally', artKey: charTextureKey(u.refId), cropY: ent?.cardCrop?.y ?? 0, theme: hexToInt(u.themeColor, COL.ally), line: rarityColor(u.rarity || 3), skillIcon };
      } else {
        const ent = d.enemyMap.get(u.refId);
        const own = enemyKey(u.refId);
        const art = this.textures.exists(own) ? own : ent?.charId && this.textures.exists(charTextureKey(ent.charId)) ? charTextureKey(ent.charId) : null;
        out = { refId: u.refId, side: 'enemy', artKey: art, cropY: ent?.cardCrop?.y ?? 0, theme: COL.enemy, line: u.boss ? COL.hpLow : 0x8a5a4a, skillIcon: 'attack' };
      }
      this.looks.set(uid, out);
      return out;
    }

    // ── 위 막대 ──
    makeTopBar() {
      const T = BT.area.top;
      const bar = (this.topBar = this.add.container(0, 0).setDepth(BT.depth.top));
      bar.add(this.add.rectangle(T.x, T.y, T.w, T.h, 0x07040f, 0.62).setOrigin(0));
      bar.add(this.add.rectangle(T.x, T.h, T.w, 1, 0xffffff, 0.1).setOrigin(0));
      const cy = T.h / 2;
      this.pauseBtn = this.iconButton(36, cy, 'pause', '', () => this.togglePause());
      this.stageText = this.text(80, cy, this.opts.stage.name || '전투').setOrigin(0, 0.5);
      this.waveText = this.text(80 + this.stageText.width + 20, cy, '', BT.minText, COL.textMid, false).setOrigin(0, 0.5);
      this.autoBtn = this.iconButton(FX_W - 330, cy, 'auto', 'AUTO', () => this.toggleAuto());
      this.speedBtn = this.iconButton(FX_W - 220, cy, 'speed', '2x', () => this.toggleSpeed());
      this.instantBtn = this.iconButton(FX_W - 86, cy, 'skip', '즉시 결과', () => this.instantResult());
      bar.add([this.pauseBtn.c, this.stageText, this.waveText, this.autoBtn.c, this.speedBtn.c, this.instantBtn.c]);
      this.autoBtn.setOn(this.auto);
      this.speedBtn.setOn(this.speed === 2);
    }
    /** 아이콘 버튼 (터치 영역 88px 이상) */
    iconButton(x, y, icon, label, onClick) {
      const c = this.add.container(x, y);
      const tx = label ? this.text(14, 0, label, BT.minText).setOrigin(0, 0.5) : null;
      const w = Math.max(48, 44 + (tx ? tx.width + 10 : 0));
      const bgOff = this.add.graphics().fillStyle(0x231a3a, 0.92).fillRoundedRect(-w / 2, -20, w, 40, BT.radius.badge).lineStyle(2, 0x5a4b80, 1).strokeRoundedRect(-w / 2, -20, w, 40, BT.radius.badge);
      const bgOn = this.add.graphics().fillStyle(0x17405a, 0.95).fillRoundedRect(-w / 2, -20, w, 40, BT.radius.badge).lineStyle(2, COL.ally, 1).strokeRoundedRect(-w / 2, -20, w, 40, BT.radius.badge).setAlpha(0);
      const ic = this.add.image(tx ? -w / 2 + 22 : 0, 0, iconKey(this, icon)).setDisplaySize(22, 22);
      if (tx) tx.setX(-w / 2 + 40);
      c.add([bgOff, bgOn, ic, ...(tx ? [tx] : [])]);
      const zone = this.add.zone(0, 0, Math.max(w, BT.minTouch), BT.minTouch).setInteractive({ useHandCursor: true });
      zone.setData('ui', true);
      zone.on('pointerdown', (p, lx, ly, ev) => {
        ev?.stopPropagation?.();
        if (p.rightButtonDown()) return;
        this.m.tween(c, { scale: BT.state.pressScale }, 'instant').then(() => this.m.tween(c, { scale: 1 }, 'fast', 'pop'));
        onClick();
      });
      c.add(zone);
      return { c, setOn: (on) => this.m.tween(bgOn, { alpha: on ? 1 : 0 }, 'fast') };
    }
    updateTopBar() {
      const st = this.battle.state;
      const s = `웨이브 ${st.wave + 1}/${st.waveCount} · 라운드 ${st.round}${st.roundLimit ? `/${st.roundLimit}` : ''}`;
      if (this.waveText.text === s) return;
      this.waveText.setText(s);
      if (!this.m.instant) {
        this.waveText.setAlpha(0.3);
        this.m.tween(this.waveText, { alpha: 1 }, 'fast');
      }
    }

    // ── 카드 ──
    cardKind(u) {
      return u.side === 'ally' ? 'ally' : u.boss ? 'boss' : 'enemy';
    }
    makeCard(u, slot) {
      const lk = this.look(u.uid);
      const kind = this.cardKind(u);
      const size = BT.card[kind];
      const card = new BattleCard(this, this.m, u, {
        layer: u.side === 'ally' ? this.allyLayer : this.enemyLayer,
        x: slot.x,
        y: slot.y,
        scale: slot.scale,
        kind,
        w: size.w,
        h: size.h,
        artKey: lk.artKey,
        artTop: u.side === 'ally' ? BT.card.artTop : BT.card.artTopEnemy,
        cropY: lk.cropY,
        theme: lk.theme,
        line: lk.line,
        role: u.side === 'ally' ? `role_${u.role || 'attacker'}` : null,
        fx: this.fx,
        idle: !this.reduced && this.quality >= 0.5,
      });
      this.wireCard(card);
      this.cards.set(u.uid, card);
      this.dispShield.set(u.uid, u.shield?.value || 0);
      return card;
    }
    /** 한 진영의 카드 만들기 (적은 웨이브가 바뀌면 다시) */
    makeCards(side, instant = false) {
      const st = this.battle.state;
      const units = (side === 'ally' ? st.allies : st.enemies).filter((u) => u.alive);
      if (side === 'enemy') {
        for (const [uid, c] of this.cards) {
          if (c.side !== 'enemy') continue;
          c.destroy();
          this.cards.delete(uid);
        }
      }
      const slots = rowLayout(units, side);
      const made = units.map((u, i) => this.makeCard(u, slots[i]));
      if (!instant) for (const c of made) c.root.setAlpha(0);
      return made;
    }
    /** 쓰러진 뒤 남은 카드가 빈자리를 메움 (base, 30ms 시차) */
    reflow(side) {
      const list = (side === 'ally' ? this.battle.state.allies : this.battle.state.enemies).filter((u) => this.cards.get(u.uid)?.alive);
      const slots = rowLayout(list, side);
      return Promise.all(list.map((u, i) => this.cards.get(u.uid).moveTo(slots[i].x, slots[i].y, slots[i].scale, 'base', 'out', i * BT.death.reflowStagger)));
    }
    livingCards() {
      return [...this.cards.values()].filter((c) => c.alive);
    }

    // ── 탭 · 길게 누르기 (5장) ──
    makePressRing() {
      this.ring = this.add.graphics().setDepth(BT.depth.drag);
    }
    wireCard(card) {
      const z = card.zone;
      z.on('pointerover', (p) => {
        if (!p.wasTouch && card.alive) card.setState({ hover: true });
        this.hovered = card;
      });
      z.on('pointerout', () => {
        card.setState({ hover: false });
        if (this.hovered === card) this.hovered = null;
      });
      z.on('pointerdown', (p, lx, ly, ev) => {
        ev?.stopPropagation?.();
        if (this.info.open || !card.alive) return;
        if (p.rightButtonDown()) return this.openInfo(card);
        this.pressDown(card, p);
      });
    }
    /** 실제 ms → 장면 시간 (배속과 무관하게 길게 누르기 400ms) */
    realMs(ms) {
      return ms * this.time.timeScale;
    }
    pressDown(card, p) {
      this.pressCancel();
      card.setState({ press: true });
      const P = BT.press;
      const pr = (this.press = { card, x: p.x, y: p.y, long: false, cancelled: false, timers: [] });
      pr.timers.push(
        this.time.delayedCall(this.realMs(P.ringDelay), () => {
          // 150ms 지나면 진행 원이 차오르기 시작 (그 전에 떼면 안 보임 → 탭할 때 깜빡이지 않음)
          const prog = { t: 0 };
          pr.ringTween = this.tweens.add({
            targets: prog,
            t: 1,
            duration: this.realMs(P.long - P.ringDelay),
            ease: BT.ease.linear, // 진행 표시 (예외)
            onUpdate: () => this.drawRing(card, prog.t),
          });
        }),
      );
      pr.timers.push(
        this.time.delayedCall(this.realMs(P.long), () => {
          pr.long = true;
          this.ring.clear();
          card.setState({ press: false });
          this.openInfo(card);
        }),
      );
    }
    drawRing(card, t) {
      const c = card.center();
      const P = BT.press;
      this.ring.clear();
      this.ring.lineStyle(P.ringW, 0xffffff, 0.25).strokeCircle(c.x, c.y, P.ringR);
      this.ring.lineStyle(P.ringW, 0xffffff, 1).beginPath();
      this.ring.arc(c.x, c.y, P.ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      this.ring.strokePath();
    }
    pressMove(p) {
      const pr = this.press;
      if (!pr || pr.cancelled) return;
      if (Math.hypot(p.x - pr.x, p.y - pr.y) > BT.press.slop) {
        // 12px 넘게 움직이면 길게 누르기 취소 (탭도 아님)
        pr.cancelled = true;
        this.pressCancel();
      }
    }
    pressUp() {
      const pr = this.press;
      if (!pr) return;
      const tap = !pr.long && !pr.cancelled;
      this.pressCancel();
      if (tap) this.onCardTap(pr.card);
    }
    pressCancel() {
      const pr = this.press;
      if (!pr) return;
      for (const t of pr.timers) t.remove(false);
      pr.ringTween?.remove();
      this.ring.clear();
      pr.card.setState({ press: false });
      this.press = null;
    }
    openInfo(card) {
      if (!card || this.cutin || this.ended || this.paused) return;
      this.pressCancel();
      this.info.show(card);
    }

    // ── 대상 고르기 ──
    targetsOf(action, uid = null) {
      const t = this.battle.targets(action, uid);
      if (!t) return { none: true, uids: [] };
      const uids = t.uids.filter((x) => this.cards.get(x)?.alive);
      return { none: false, uids, single: uids.length === 1, support: t.pick === 'ally' };
    }
    /** 대상 표시: 가능 = 맥박, 불가 = 어둡게, null = 끔 */
    showTargets(uids) {
      for (const c of this.livingCards()) c.setState({ target: !uids ? 'none' : uids.includes(c.uid) ? 'ok' : 'no' });
    }
    /** 손가락 근처(카드 + 20px)의 대상 → 조준 표시 */
    aimAt(uids, x, y) {
      let hit = null;
      for (const uid of uids) {
        const c = this.cards.get(uid);
        if (c?.alive && c.contains(x, y, BT.arrow.snap)) {
          hit = uid;
          break;
        }
      }
      for (const uid of uids) this.cards.get(uid)?.setState({ target: uid === hit ? 'aim' : 'ok' });
      return hit;
    }
    onCardTap(card) {
      if (!card.alive) return;
      const inputOn = this.mode === 'input' || this.mode === 'target';
      if (!inputOn || this.auto) return;
      // 궁극기 조준 중 → 대상
      if (this.mode === 'target' && this.pick) {
        if (this.pick.uids.includes(card.uid)) return this.commit({ kind: 'ult', uid: this.pick.uid, target: card.uid });
        return this.cancelAim();
      }
      // 손패 행동 조준 중 → 대상
      if (this.hand.armed) {
        const t = this.targetsOf(this.hand.armed);
        if (t.uids.includes(card.uid)) return this.hand.commit(this.hand.armed, card.uid);
        return this.cancelAim();
      }
      // 아군 카드: 궁극기 준비됐으면 궁극기
      const u = this.unitOf(card.uid);
      if (u?.side !== 'ally' || !u.kit?.ultimate || u.energy < u.ultCost) return;
      const t = this.targetsOf('ultimate', u.uid);
      if (t.none) return this.commit({ kind: 'ult', uid: u.uid, target: null });
      if (t.single) return this.commit({ kind: 'ult', uid: u.uid, target: t.uids[0] });
      this.pick = { action: 'ultimate', uid: u.uid, uids: t.uids };
      this.mode = 'target';
      this.hand.cancel(true);
      this.showTargets(t.uids);
    }
    cancelAim() {
      const had = !!this.pick || !!this.hand.armed || !!this.hand.press;
      this.pick = null;
      if (this.mode === 'target') this.mode = 'input';
      this.hand.cancel(true);
      this.showTargets(null);
      return had;
    }
    /** 키보드 1/2: 손패 카드 누른 것과 같음 */
    chooseAction(action) {
      if (this.mode !== 'input' || this.auto) return;
      const opt = this.battle.options();
      if (!opt?.[action]?.ok) return this.hand.shake(this.hand.cards[action]);
      const t = this.targetsOf(action);
      if (t.none) return this.commit({ kind: 'act', action, target: null });
      if (t.single) return this.commit({ kind: 'act', action, target: t.uids[0] });
      this.hand.cancel(true);
      this.hand.armed = action;
      this.hand.lift(this.hand.cards[action], true);
      this.showTargets(t.uids);
    }
    commit(choice) {
      this.pick = null;
      this.mode = 'busy';
      this.hand.armed = null;
      const events = choice.kind === 'ult' ? this.battle.ultimate({ uid: choice.uid, target: choice.target }) : this.battle.act({ action: choice.action, target: choice.target });
      this.play(events);
    }

    // ── 키보드 ──
    onKey(e) {
      if (this.ended) {
        if (this.endReady && ['Space', 'Enter', 'Escape'].includes(e.code)) this.finish(false);
        return;
      }
      if (this.info.open) {
        if (['Escape', 'KeyI', 'Space', 'Enter'].includes(e.code)) this.info.hide();
        return;
      }
      if (e.code === 'Escape') {
        if (this.cutin) return this.cutin.skip();
        if (!this.cancelAim()) this.togglePause();
        return;
      }
      if (this.paused) return;
      if (e.code === 'KeyI') return this.openInfo(this.hovered || this.cards.get(this.battle.state.pendingUid || this.battle.state.actorUid));
      if (e.code === 'KeyA') return this.toggleAuto();
      if (e.code === 'KeyR') return this.instantResult();
      if (e.code === 'KeyX') return this.toggleSpeed();
      if (e.code === 'Space' && this.cutin) return this.cutin.skip();
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m) return;
      const n = Number(m[1]);
      const aiming = this.pick?.uids || (this.hand.armed && this.targetsOf(this.hand.armed).uids);
      if (aiming) {
        const uid = aiming[n - 1];
        if (!uid) return;
        if (this.pick) this.commit({ kind: 'ult', uid: this.pick.uid, target: uid });
        else this.hand.commit(this.hand.armed, uid);
      } else if (this.mode === 'input') {
        if (n === 1) this.chooseAction('basic');
        if (n === 2) this.chooseAction('skill');
      }
    }

    toggleAuto() {
      this.auto = !this.auto;
      this.autoBtn.setOn(this.auto);
      this.opts.onSettings?.({ battleAuto: this.auto });
      if (this.auto && (this.mode === 'input' || this.mode === 'target')) {
        this.cancelAim();
        this.hand.hide();
        this.mode = 'busy';
        this.stepAuto();
      } else if (!this.auto && !this.playing) this.afterBatch();
    }
    toggleSpeed() {
      this.speed = this.speed === 2 ? 1 : 2;
      this.applySpeed();
      this.speedBtn.setOn(this.speed === 2);
      this.opts.onSettings?.({ battleSpeed: this.speed });
    }
    togglePause() {
      if (this.ended || this.info.open) return;
      this.paused = !this.paused;
      if (this.paused) {
        this.pressCancel();
        this.pauseFrozen = this.m.freeze();
        this.time.paused = true;
        const c = (this.pauseLayer = this.add.container(0, 0).setDepth(BT.depth.pause).setAlpha(0));
        const dim = this.add.rectangle(0, 0, FX_W, FX_H, 0x000000, 0.66).setOrigin(0).setInteractive();
        dim.setData('ui', true);
        c.add(dim);
        c.add(this.text(FX_W / 2, 250, '일시정지', 44).setOrigin(0.5));
        const resume = this.panelButton(FX_W / 2 - 120, 360, '계속하기', () => this.togglePause(), COL.ally);
        const quit = this.panelButton(FX_W / 2 + 120, 360, '포기하기', () => this.finish(true), COL.hpLow);
        c.add([resume, quit]);
        this.tweens.add({ targets: c, alpha: 1, duration: BT.motion.fast, ease: BT.ease.out });
      } else {
        this.time.paused = false;
        this.m.thaw(this.pauseFrozen);
        this.pauseFrozen = null;
        const c = this.pauseLayer;
        this.pauseLayer = null;
        this.m.tween(c, { alpha: 0 }, 'fast').then(() => c?.destroy(true));
      }
    }
    panelButton(x, y, label, onClick, color) {
      const c = this.add.container(x, y);
      const w = 200;
      const h = 60;
      c.add(this.add.graphics().fillStyle(0x1d1530, 0.96).fillRoundedRect(-w / 2, -h / 2, w, h, BT.radius.panel).lineStyle(2, color, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, BT.radius.panel));
      c.add(this.text(0, 0, label, 22).setOrigin(0.5));
      const z = this.add.zone(0, 0, w, Math.max(h, BT.minTouch)).setInteractive({ useHandCursor: true });
      z.setData('ui', true);
      z.on('pointerdown', (p, lx, ly, ev) => {
        ev?.stopPropagation?.();
        onClick();
      });
      c.add(z);
      return c;
    }

    // ── 진행 ──
    afterBatch() {
      this.syncAll({ instant: this.instant });
      if (this.battle.state.result) return this.showEnd();
      const cur = this.battle.current();
      this.setActive(cur?.uid ?? null);
      if (!cur) return;
      if (this.auto) {
        this.mode = 'busy';
        this.hand.hide();
        this.time.delayedCall(BT.motion.slow, () => this.stepAuto());
        return;
      }
      this.mode = 'input';
      const opt = this.battle.options();
      this.hand.showFor(cur, this.look(cur.uid), opt);
    }
    stepAuto() {
      if (!this.auto || this.ended || this.mode !== 'busy' || !this.battle.current() || this.playing) return;
      this.play(this.battle.auto());
    }
    setActive(uid) {
      for (const c of this.cards.values()) if (c.alive) c.setState({ active: c.uid === uid });
    }

    async play(events) {
      this.playing = true;
      this.mode = 'busy';
      this.hand.hide();
      this.showTargets(null);
      const beats = groupBeats(events, (uid) => this.sideOf(uid));
      for (const beat of beats) {
        if (this.ended || this.instant) break;
        await this.playBeat(beat);
      }
      // 즉시 결과를 눌렀으면 끝까지 돌리고 최종 상태로
      if (this.instant && !this.battle.state.result) this.battle.runToEnd();
      this.playing = false;
      if (!this.ended) this.afterBatch();
    }

    instantResult() {
      if (this.ended || this.instant) return;
      this.instant = true;
      this.m.instant = true;
      this.cutin?.destroy();
      this.cutin = null;
      this.cancelAim();
      this.hand.hide();
      if (this.info.open) this.info.hide();
      if (!this.playing) {
        this.battle.runToEnd();
        this.afterBatch();
      }
    }

    // ── 장면 하나 ──
    async playBeat(beat) {
      if (beat.kind === 'action') return this.playAction(beat);
      if (beat.kind === 'turn') {
        const uid = beat.head.uid;
        if (this.cards.get(uid)?.alive) {
          this.queue.advance(uid);
          this.setActive(uid);
        }
        return this.applyEvents(beat.events);
      }
      if (beat.kind === 'wave') return this.playWave(beat);
      return this.applyEvents(beat.events);
    }

    /** 행동 (기본 공격 · 스킬 · 궁극기 · 반응 · 토큰) — 7장 시간표 */
    async playAction(beat) {
      const card = this.cards.get(beat.actor);
      const u = this.unitOf(beat.actor);
      if (!card || !u) return this.applyEvents(beat.events);
      const lk = this.look(beat.actor);
      const isUlt = beat.action === 'ultimate';
      if (!beat.reaction && !beat.token && !isUlt) {
        this.queue.advance(beat.actor);
        this.setActive(beat.actor);
      } else card.glint();

      if (isUlt && u.side === 'ally') {
        // 궁극기: 컷인 → 흰 섬광 + 히트스톱 100 + 흔들림 + 참격 띠
        this.cutin = playCutIn(this, { id: u.refId, name: u.name, nameEn: u.nameEn, title: u.title, themeColor: u.themeColor, rarity: u.rarity }, { short: true, label: beat.name, reduced: this.reduced, quality: this.quality });
        await this.cutin.done;
        this.cutin = null;
        if (this.instant) return;
        this.fx.screenFlash();
        this.m.shake(BT.ult.shake, BT.ult.shakeDur);
        this.fx.slash(lk.theme);
        await this.m.hitStop(BT.ult.stop);
      } else if (beat.action === 'skill' && u.side === 'ally' && !beat.reaction) {
        // 스킬: 카드가 가운데로 → 빛 입자로 흩어지며 공격자에게
        const img = await this.hand.flyToCenter(u, lk, beat.name, this.battle.options()?.skill?.cost ?? 1);
        const to = card.center();
        this.m.tween(img, { alpha: 0, scale: img.scale * 0.8 }, BT.skill.absorb, 'in').then(() => img.destroy());
        await this.fx.streak({ x: img.x, y: img.y }, to, lk.theme);
      } else if (u.side === 'enemy') await this.intentArrows.flash(beat.actor);

      const consumed = new Set(beat.hits);
      if (beat.targets.length === 1 && !isUlt) await this.strikeSingle(card, beat);
      else if (beat.targets.length) await this.strikeMany(card, beat, isUlt);
      else if (beat.supportTargets.length) {
        // 아군 대상: 돌진 없이 빛 줄기
        const from = card.center();
        await this.m.stagger(beat.supportTargets, (uid, i) => this.fx.beam(from, this.cards.get(uid)?.center() ?? from, u.side === 'ally' ? lk.theme : COL.enemy), BT.hit.aoeStagger);
      }
      await this.applyEvents(beat.events.filter((e) => !consumed.has(e)));
      if (isUlt && beat.total > 0) this.fx.number(null, FX_W / 2, FX_H / 2 - 40, beat.total, 'total');
    }

    /** 단일 대상: 물러남 → 돌진 → 타격(히트스톱) → 복귀 */
    async strikeSingle(card, beat) {
      const tgt = this.cards.get(beat.targets[0]);
      if (!tgt) return;
      const a = card.center();
      const b = tgt.center();
      const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      await card.windup(dir.x, dir.y);
      await card.dash(b.x, b.y);
      const hits = beat.hitsByTarget.get(tgt.uid) || [];
      for (let i = 0; i < hits.length; i++) {
        const last = i === hits.length - 1;
        await this.hitOne(tgt, hits[i], dir, last);
        if (!last) await this.m.wait(BT.hit.multiGap);
      }
      card.goHome();
      await this.m.wait(BT.hit.ret * 0.6);
    }

    /** 광역 / 궁극기: 진영 가운데 앞으로 → 충격파 → 왼쪽부터 40ms 시차 */
    async strikeMany(card, beat, isUlt) {
      const targets = beat.targets.map((uid) => this.cards.get(uid)).filter(Boolean).sort((p, q) => p.root.x - q.root.x);
      if (!targets.length) return;
      const a = card.center();
      const side = targets[0].side;
      const area = BT.area[side];
      const front = { x: area.x + area.w / 2, y: card.root.y + (card.side === 'ally' ? -BT.aoe.forward : BT.aoe.forward) };
      if (!isUlt) await card.stepForward(front.x, front.y);
      const rowY = targets[0].root.y;
      this.fx.shockwave(area.x + area.w / 2, rowY, area.w / 2, card.side === 'ally' ? this.look(card.uid).theme : COL.enemy);
      let stopped = isUlt;
      await this.m.stagger(
        targets,
        async (tgt) => {
          const b = tgt.center();
          const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
          const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
          const hits = beat.hitsByTarget.get(tgt.uid) || [];
          for (let i = 0; i < hits.length; i++) {
            const last = i === hits.length - 1;
            // 히트스톱은 한 번만 (궁극기는 컷인 끝에 이미)
            const stop = last && !stopped;
            if (stop) stopped = true;
            await this.hitOne(tgt, hits[i], dir, stop);
            if (!last) await this.m.wait(BT.hit.multiGap);
          }
        },
        BT.hit.aoeStagger,
      );
      if (!isUlt) await card.goHome();
    }

    /** 타격 하나: HP · 숫자 · 번쩍 · 불꽃 · 밀림 (+ 마지막이면 히트스톱 · 흔들림) */
    async hitOne(tgt, e, dir, stop) {
      const u = this.unitOf(tgt.uid);
      const H = BT.hit;
      const c = tgt.center();
      const absorbed = e.absorbed || 0;
      const dmg = Math.max(0, (e.amount || 0) - absorbed);
      tgt.setHp(e.hp / Math.max(1, u?.maxHp || 1));
      const top = c.y - (tgt.h * tgt.root.scale) / 2 + 20;
      if (absorbed) {
        this.fx.number(tgt.uid, c.x, top, absorbed, 'absorb');
        const left = (this.dispShield.get(tgt.uid) || 0) - absorbed;
        this.dispShield.set(tgt.uid, Math.max(0, left));
        if (left <= 0) tgt.setShield(false);
      }
      if (dmg) this.fx.number(tgt.uid, c.x, top, dmg, e.crit ? 'crit' : 'dmg');
      this.fx.sparks(c.x - dir.x * tgt.h * 0.3, c.y - dir.y * tgt.h * 0.3, e.crit);
      tgt.playHit(dir.x, dir.y);
      if (stop) {
        this.m.shake(e.crit ? H.critShake : H.shake);
        await this.m.hitStop(e.crit ? H.critStop : H.stop);
      } else await this.m.wait(H.flash);
    }

    /** 웨이브 전환: 띠 → 새 적이 위에서 떨어짐 (60ms 시차) */
    async playWave(beat) {
      const ev = beat.head;
      if (ev.wave > 1) {
        this.intentArrows.clear();
        await this.fx.band(`WAVE ${ev.wave}/${ev.total}`);
        const made = this.makeCards('enemy', this.instant);
        if (!this.instant) await this.m.stagger(made, (c, i) => c.dropIn(0), BT.wave.stagger);
        this.updateTopBar();
      }
      await this.applyEvents(beat.events);
    }

    // ── 나머지 이벤트 (순서대로, 짧게) ──
    async applyEvents(list) {
      for (const ev of list) {
        if (this.instant || this.ended) return;
        await this.applyEvent(ev);
      }
    }
    async applyEvent(ev) {
      const card = this.cards.get(ev.tgt || ev.uid);
      const u = this.unitOf(ev.tgt || ev.uid);
      switch (ev.t) {
        case 'damage': {
          if (!card || !u) return;
          const c = card.center();
          const top = c.y - (card.h * card.root.scale) / 2 + 20;
          card.setHp(ev.hp / Math.max(1, u.maxHp));
          const absorbed = ev.absorbed || 0;
          if (absorbed) {
            this.fx.number(card.uid, c.x, top, absorbed, 'absorb');
            const left = (this.dispShield.get(card.uid) || 0) - absorbed;
            this.dispShield.set(card.uid, Math.max(0, left));
            if (left <= 0) card.setShield(false);
          }
          const dmg = Math.max(0, ev.amount - absorbed);
          if (ev.dot) {
            card.shakeIcons();
            this.fx.number(card.uid, c.x, top, dmg, 'dot');
            return this.m.wait('fast');
          }
          this.fx.number(card.uid, c.x, top, dmg, ev.crit ? 'crit' : 'dmg');
          card.playHit(0, card.side === 'ally' ? 1 : -1);
          return this.m.wait('fast');
        }
        case 'heal': {
          if (!card || !u || !ev.amount) return;
          const c = card.center();
          card.setHp(ev.hp / Math.max(1, u.maxHp), { heal: true });
          this.fx.healRise(c.x, c.y + (card.h * card.root.scale) / 2 - 10, card.w * card.root.scale);
          this.fx.number(card.uid, c.x, c.y - (card.h * card.root.scale) / 2 + 20, ev.amount, 'heal');
          return this.m.wait('fast');
        }
        case 'shield':
          if (!card) return;
          this.dispShield.set(card.uid, ev.amount);
          card.setShield(true);
          return this.m.wait('instant');
        case 'status':
          if (!card || !u) return;
          if (ev.kind === 'buff') card.flashBuff();
          else card.smoke();
          card.setEffects(this.effectsOf(u));
          return this.m.wait('instant');
        case 'dot':
          if (!card || !u) return;
          card.smoke();
          card.setEffects(this.effectsOf(u));
          return this.m.wait('instant');
        case 'mark':
        case 'cleanse':
          if (card && u) card.setEffects(this.effectsOf(u));
          return;
        case 'detonate': {
          if (!card) return;
          const c = card.center();
          this.fx.shards(c.x, c.y, 0xff6fb5);
          if (u) card.setEffects(this.effectsOf(u));
          return this.m.wait('fast');
        }
        case 'taunt':
          card?.setTaunt(true);
          if (card && u) card.setEffects(this.effectsOf(u));
          return;
        case 'stack':
          card?.setResource(ev.value, ev.cap);
          return;
        case 'energy':
          if (card && u && u.side === 'ally' && ev.n < 0) card.setEnergy(0, !!u.kit?.ultimate);
          return;
        case 'sp':
          this.sp.set(ev.sp);
          return;
        case 'transform':
          return card?.setTransformed(true);
        case 'transform_end':
          return card?.setTransformed(false);
        case 'interrupt':
          if (!ev.ok || !card) return;
          return card.breakBadge();
        case 'stagger': {
          if (!card) return;
          card.setState({ stun: true });
          await this.m.wait('slow');
          card.setState({ stun: false });
          return;
        }
        case 'resist':
          return this.popIcon(card, 'resist', 0xcfd8ff);
        case 'passive':
          card?.glint();
          return;
        case 'token_add':
          this.cards.get(ev.owner)?.glint();
          return;
        case 'death': {
          if (!card?.alive) return;
          if (this.press?.card === card) this.pressCancel();
          await card.playDeath();
          await this.reflow(card.side);
          return;
        }
        case 'intent': {
          const it = this.unitOf(ev.uid)?.actions?.[ev.action];
          const c = this.cards.get(ev.uid);
          if (c && it) c.setIntent({ icon: actionIcon(it.icon), big: ev.big, eta: c.lastEta ?? null });
          return;
        }
        case 'phase':
          return this.fx.band(ev.name || '', '#ff9a9a');
        case 'enrage':
          this.m.shake(BT.hit.critShake, BT.ult.shakeDur);
          return this.fx.band('광폭화', '#ff6070');
        case 'round':
          this.updateTopBar();
          return;
        default:
          return;
      }
    }

    /** 저항 등: 카드 위에 아이콘이 팝 */
    popIcon(card, name, tint) {
      if (!card || this.m.instant) return;
      const img = this.popIcons.find((x) => x.alpha === 0) || this.popIcons[0];
      const c = card.center();
      img.setTexture(iconKey(this, name)).setTint(tint).setPosition(c.x, c.y - 20).setAlpha(1).setScale(0);
      const s = 40 / 64;
      return this.m
        .tween(img, { scale: s * 1.2 }, 'fast', 'pop')
        .then(() => this.m.tween(img, { scale: s }, 'instant'))
        .then(() => this.m.tween(img, { alpha: 0, y: img.y - 20 }, 'slow', 'out'));
    }

    /** 카드 효과 아이콘 목록 (변신 · 도발 · 강화/약화 · 지속 피해 · 표식) */
    effectsOf(u) {
      const list = [];
      if (u.transform) list.push({ key: 'transform', icon: 'transform', kind: 'buff', dots: u.transform.turns });
      if (u.taunt) list.push({ key: 'taunt', icon: 'taunt', kind: 'buff', dots: u.taunt.turns });
      const buffs = (u.statuses || []).filter((s) => s.kind === 'buff');
      const debuffs = (u.statuses || []).filter((s) => s.kind !== 'buff');
      for (const s of [...buffs, ...debuffs]) list.push({ key: s.key || `${s.kind}:${s.stat}`, icon: statIcon(s.stat), kind: s.kind === 'buff' ? 'buff' : 'debuff', dots: s.turns });
      if (u.dots?.length) list.push({ key: 'dot', icon: 'dot', kind: 'debuff', dots: Math.max(...u.dots.map((d) => d.turns)) });
      const marks = (u.marks || []).reduce((n, m) => n + m.n, 0);
      if (marks) list.push({ key: 'mark', icon: 'mark', kind: 'debuff', dots: marks });
      return list;
    }

    // ── 엔진 상태에 맞추기 (한 묶음이 끝날 때) ──
    syncAll({ instant = false } = {}) {
      const st = this.battle.state;
      // 웨이브가 바뀌었는데 카드가 없음 (즉시 결과) → 적 카드 다시
      if (st.enemies.some((u) => u.alive && !this.cards.has(u.uid))) this.makeCards('enemy', true);
      let reflow = new Set();
      for (const u of [...st.allies, ...st.enemies]) {
        const card = this.cards.get(u.uid);
        if (!card) continue;
        if (!u.alive) {
          if (card.alive) {
            card.playDeath();
            reflow.add(card.side);
          }
          continue;
        }
        card.setHp(u.hp / Math.max(1, u.maxHp), { instant });
        if (u.side === 'ally') card.setEnergy(u.energy / Math.max(1, u.ultCost), !!u.kit?.ultimate);
        card.setEffects(this.effectsOf(u));
        card.setShield(!!u.shield, { instant });
        this.dispShield.set(u.uid, u.shield?.value || 0);
        card.setTaunt(!!u.taunt);
        card.setTransformed(!!u.transform, { instant });
        if (u.res) card.setResource(u.res.value, u.res.cap);
      }
      for (const side of reflow) this.reflow(side);
      this.sp.set(st.sp.ally, { animate: !instant });
      this.updateTopBar();
      this.updateIntents();
      this.updateQueue(instant);
    }
    updateQueue(instant = false) {
      const st = this.battle.state;
      const cur = this.battle.current() || (st.actorUid && this.unitOf(st.actorUid));
      const items = this.battle.queueItems(BT.queue.count - (cur ? 1 : 0));
      this.queue.set([...(cur?.alive ? [{ kind: 'unit', id: cur.uid }] : []), ...items], { instant });
    }
    updateIntents() {
      const intents = this.battle.intents();
      const byUid = new Map(intents.map((it) => [it.uid, it]));
      const etas = intents.map((it) => it.eta).filter((x) => x != null);
      const nextEta = etas.length ? Math.min(...etas) : null;
      const list = [];
      for (const c of this.cards.values()) {
        if (c.side !== 'enemy' || !c.alive) continue;
        const it = byUid.get(c.uid);
        c.lastEta = it?.eta ?? null;
        c.setIntent(it ? { icon: actionIcon(it.icon), big: it.big, eta: it.eta, interrupted: it.interrupted } : null);
        if (!it || it.interrupted) continue;
        const tc = it.targetUid && this.cards.get(it.targetUid);
        const b = c.bounds();
        const from = { x: b.x + b.w / 2, y: b.y + b.h + 4 };
        const to = tc?.alive ? (() => { const tb = tc.bounds(); return { x: tb.x + tb.w / 2, y: tb.y - 6 }; })() : null;
        list.push({ uid: c.uid, from, to: it.aoe ? null : to, aoe: !!it.aoe, live: it.eta != null && it.eta === nextEta, big: it.big });
      }
      this.intentArrows.set(list);
    }

    // ── 끝 ──
    showEnd() {
      if (this.mode === 'ended') return;
      this.mode = 'ended';
      this.ended = true;
      this.cancelAim();
      this.hand.hide();
      this.setActive(null);
      if (this.info.open) this.info.hide();
      const st = this.battle.state;
      const win = st.result === 'win';
      const c = this.add.container(0, 0).setDepth(BT.depth.end).setAlpha(0);
      c.add(this.add.rectangle(0, 0, FX_W, FX_H, 0x000000, 0.68).setOrigin(0));
      const title = this.text(FX_W / 2, 250, win ? '승리!' : '패배', 96, win ? '#ffd36b' : '#ff8a9a').setOrigin(0.5).setStroke(COL.textStroke, 10);
      const sub = this.text(FX_W / 2, 338, win ? `${st.round}라운드 만에 클리어` : st.reason === 'timeout' ? `라운드 제한(${st.roundLimit || st.maxRounds})을 넘겼어요` : '아군이 모두 쓰러졌어요', 24, COL.textMid, false).setOrigin(0.5);
      const tap = this.text(FX_W / 2, 386, '탭하여 계속', BT.minText, COL.textMid, false).setOrigin(0.5).setAlpha(0);
      c.add([title, sub, tap]);
      if (win && !this.reduced && !this.instant && this.quality > 0.3) {
        const conf = this.add.particles(FX_W / 2, 230, 'fx-spark', { speed: { min: 120, max: 520 }, angle: { min: 200, max: 340 }, gravityY: 400, lifespan: 1600, scale: { start: 1, end: 0.2 }, tint: [0xffc23d, 0xffffff, 0x7dc8ff], emitting: false });
        c.add(conf);
        conf.explode(Math.min(BT.particles.max / 2, Math.round(70 * this.quality)));
      }
      const quick = this.instant;
      this.m.instant = false; // 끝 화면은 짧게라도 보여 줌
      this.m.tween(c, { alpha: 1 }, 'fast');
      if (!quick && !this.reduced) {
        title.setScale(1.6);
        this.m.tween(title, { scale: 1 }, 'dramatic', 'pop');
      }
      this.time.delayedCall(quick ? 150 : 700, () => {
        this.endReady = true;
        this.m.tween(tap, { alpha: 1 }, 'base');
      });
      this.time.delayedCall(quick ? 900 : 2600, () => this.finish(false));
    }

    finish(quit) {
      if (this.finished) return;
      this.finished = true;
      this.cutin?.destroy();
      this.time.paused = false;
      this.opts.finish?.({ quit, summary: this.battle.summary(), record: this.battle.record() });
    }

    cleanup() {
      for (const c of this.cards.values()) c.destroy();
      this.cards.clear();
      this.arrow?.hide();
      this.fpsTimer?.remove();
    }

    // ── 개발 모드: FPS ──
    makeFps() {
      const t = this.text(FX_W - 8, FX_H - 8, '', BT.minText, '#7dffb0', false).setOrigin(1, 1).setDepth(BT.depth.end + 1);
      this.fpsTimer = this.time.addEvent({ delay: 500, loop: true, callback: () => t.setText(`${Math.round(this.game.loop.actualFps)} fps`) });
    }
  };
}
