// 전투 화면 (Phaser) — 규칙은 전부 js/battle/engine.js. 여기는 보여 주고 입력만 받음
//
// 배치 (1280×720)
//   위: 일시정지 · 스테이지 이름 · 웨이브 x/y · 라운드 | SP 점 | AUTO · 2x · 즉시 결과
//   왼쪽: 행동 순서 (지금 차례 + 다음 7명)
//   가운데: 적 정면 입상 (보스는 크게), HP 막대, 강화/약화, 예고 배지 (아이콘 + ⏱N + 대상 칸 또는 '광역') + 대상 초상까지 선
//   아래: 아군 초상 5칸 (HP, 기력, 강화/약화, 역할). 궁극기 준비되면 빛남 → 탭하면 궁극기 (턴을 쓰지 않음)
//         차례인 아군 위에 [기본 공격] [스킬 (SP)]
// 연출: 행동마다 0.5초 이하, 떠오르는 피해 숫자(치명타는 크고 금색), 맞은 초상 흔들림 + 붉은 번쩍임,
//       궁극기는 짧은 컷인(js/fx/CutIn.js, 탭하면 넘김), 쓰러지면 페이드 + 입자, 웨이브/승리/패배 배너. 2x = 시간 절반
// 끝나면 data.finish({ summary, record, quit }) → HTML(js/ui/battleView.js)이 보상/결과 화면

import { FONT, FX_W, FX_H, assetUrl, fxQuality, rarityColor, hexToInt } from './phaserHost.js';
import { ensureFxTextures } from './textures.js';
import { playCutIn, queueCharTexture, charTextureKey } from './CutIn.js';

const ICON = { attack: '⚔', aoe: '✸', buff: '▲', heal: '✚', debuff: '▼' };
const ROLE = { attacker: '공', defender: '방', support: '지', healer: '치' };
const STAT_SHORT = { atk: '공', def: '방', spd: '속', critRate: '치확', critDmg: '치피', dmgDealt: '주피', dmgTaken: '받피' };
const enemyKey = (id) => `enemy:${id}`;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

const PANEL_W = 196;
const PANEL_H = 150;
const PANEL_Y = 630; // 아군 초상 가운데
const panelX = (slot) => 238 + slot * 210;
const ENEMY_FEET = 438; // 적 입상 발 위치

export function createBattleScene(Phaser) {
  return class BattleScene extends Phaser.Scene {
    constructor() {
      super('Battle');
    }

    /**
     * @param {{battle:object, data:object, stage:object, background?:string|null, speed?:1|2, auto?:boolean, reduced?:boolean,
     *          onSettings?:(patch:object)=>void, finish:(r:object)=>void}} data
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
      this.allyViews = new Map();
      this.enemyViews = new Map();
      this.dispHp = new Map();
      this.pick = null; // 대상 고르는 중: { kind:'act'|'ult', action, uid, uids }
      this.cutin = null;
    }

    preload() {
      this.load.on('loaderror', (file) => console.warn('[battle] 그림을 불러오지 못했어요:', file?.src));
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
      if (this.opts.background) this.load.image('battle-bg', assetUrl(this.opts.background));
    }

    create() {
      ensureFxTextures(this);
      this.quality = fxQuality(this.game);
      this.applySpeed();
      this.cameras.main.setZoom(1).setScroll(0, 0);

      // 배경
      this.add.rectangle(0, 0, FX_W, FX_H, 0x0b0812, 1).setOrigin(0);
      if (this.textures.exists('battle-bg')) {
        const bg = this.add.image(FX_W / 2, FX_H / 2, 'battle-bg');
        const src = bg.texture.getSourceImage();
        bg.setScale(Math.max(FX_W / src.width, FX_H / src.height)).setAlpha(0.55);
      }
      this.add.rectangle(0, FX_H - 210, FX_W, 210, 0x000000, 0.45).setOrigin(0);

      this.lines = this.add.graphics().setDepth(5);
      this.enemyLayer = this.add.container(0, 0).setDepth(10);
      this.allyLayer = this.add.container(0, 0).setDepth(20);
      this.fxLayer = this.add.container(0, 0).setDepth(40);
      this.uiLayer = this.add.container(0, 0).setDepth(60);

      this.makeTopBar();
      this.makeQueue();
      this.makeAllies();
      this.makeEnemies();
      this.makeActionButtons();
      this.hint = this.add.text(FX_W / 2, 78, '', { fontFamily: FONT, fontSize: '17px', fontStyle: '700', color: '#ffe9a8', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(70);

      this.input.on('pointerdown', (p, over) => {
        if (this.cutin && !over.some((o) => o.getData?.('ui'))) this.cutin.skip();
        if (this.mode === 'ended' && this.endReady) this.finish(false);
      });
      this.input.mouse?.disableContextMenu();
      this.input.on('pointerdown', (p) => p.rightButtonDown() && this.cancelPick());
      this.input.keyboard?.on('keydown', (e) => this.onKey(e));

      this.refreshAll();
      if (this.battle.state.result) this.showEnd();
      else this.afterBatch();
    }

    // ── 공통 도우미 ──
    applySpeed() {
      this.tweens.timeScale = this.speed;
      this.time.timeScale = this.speed;
    }
    wait(ms) {
      if (this.instant) return Promise.resolve();
      return new Promise((r) => this.time.delayedCall(ms, r));
    }
    text(x, y, str, size = 18, color = '#ffffff', extra = {}) {
      return this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: '700', color, ...extra });
    }
    /** 버튼 (Phaser 사각형 + 글자). ui 표시 → 화면 탭 처리에서 제외 */
    button(x, y, w, h, label, onClick, { size = 18, color = 0x2b1f48, border = 0x8f78d6 } = {}) {
      const c = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, w, h, color, 0.92).setStrokeStyle(2, border);
      const tx = this.text(0, 0, label, size).setOrigin(0.5);
      c.add([bg, tx]);
      c.setSize(w, h);
      c.setInteractive({ useHandCursor: true });
      c.setData('ui', true);
      c.on('pointerdown', (p, lx, ly, ev) => {
        ev?.stopPropagation?.();
        if (c.getData('disabled')) return;
        onClick();
      });
      const api = {
        c,
        bg,
        tx,
        setLabel: (s) => tx.setText(s),
        setOn: (on) => bg.setFillStyle(on ? 0x6b4a1d : color, 0.92).setStrokeStyle(2, on ? 0xffc23d : border),
        setEnabled: (on) => {
          c.setData('disabled', !on);
          c.setAlpha(on ? 1 : 0.4);
        },
      };
      return api;
    }

    // ── 위쪽 바 ──
    makeTopBar() {
      const bar = this.add.container(0, 0).setDepth(80);
      bar.add(this.add.rectangle(0, 0, FX_W, 58, 0x000000, 0.55).setOrigin(0));
      const pause = this.button(36, 29, 48, 40, 'Ⅱ', () => this.togglePause(), { size: 20 });
      this.stageText = this.text(72, 29, this.opts.stage.name || '전투', 20).setOrigin(0, 0.5);
      this.waveText = this.text(72 + this.stageText.width + 18, 29, '', 17, '#d8c9ff').setOrigin(0, 0.5);
      this.spPips = [];
      const spMax = this.battle.state.spMax;
      const sx = FX_W / 2 - ((spMax - 1) * 30) / 2;
      bar.add(this.text(sx - 44, 29, 'SP', 17, '#ffe08a').setOrigin(0.5));
      for (let i = 0; i < spMax; i++) {
        const pip = this.add.circle(sx + i * 30, 29, 10, 0xffc23d).setStrokeStyle(2, 0xfff1c2);
        this.spPips.push(pip);
        bar.add(pip);
      }
      this.autoBtn = this.button(FX_W - 306, 29, 92, 40, 'AUTO', () => this.toggleAuto());
      this.speedBtn = this.button(FX_W - 204, 29, 92, 40, '2x', () => this.toggleSpeed());
      this.instantBtn = this.button(FX_W - 82, 29, 136, 40, '즉시 결과', () => this.instantResult(), { size: 17 });
      bar.add([pause.c, this.stageText, this.waveText, this.autoBtn.c, this.speedBtn.c, this.instantBtn.c]);
      this.autoBtn.setOn(this.auto);
      this.speedBtn.setOn(this.speed === 2);
    }

    // ── 행동 순서 (왼쪽) ──
    makeQueue() {
      this.queueLayer = this.add.container(0, 0).setDepth(30);
      this.queueLayer.add(this.text(52, 72, '순서', 15, '#c9b8f2').setOrigin(0.5));
    }
    portraitOf(unit, size) {
      const c = this.add.container(0, 0);
      const color = unit.side === 'ally' ? 0x4f9dff : 0xff5d6c;
      c.add(this.add.circle(0, 0, size / 2 + 3, color));
      const key = unit.side === 'ally' ? charTextureKey(unit.refId) : enemyKey(unit.refId);
      if (this.textures.exists(key)) {
        const img = this.add.image(0, 0, key).setOrigin(0, 0);
        const src = img.texture.getSourceImage();
        // 얼굴 쪽(가운데 위)을 정사각형으로 잘라 동그랗게 — 잘린 칸의 가운데가 (0,0)
        const cw = src.width * 0.5;
        const cx = (src.width - cw) / 2;
        const cy = src.height * 0.04;
        const s = size / cw;
        img.setCrop(cx, cy, cw, cw).setScale(s).setPosition(-(cx + cw / 2) * s, -(cy + cw / 2) * s);
        const mask = this.make.graphics({}, false).fillCircle(0, 0, size / 2);
        img.setMask(mask.createGeometryMask());
        c.add(img);
        c.setData('mask', mask);
      } else {
        c.add(this.add.circle(0, 0, size / 2, 0x2a1f45));
        c.add(this.text(0, 0, unit.name.slice(0, 1), size * 0.45).setOrigin(0.5));
      }
      return c;
    }
    refreshQueue() {
      for (const ch of this.queueLayer.list.slice(1)) {
        ch.getData?.('mask')?.destroy();
      }
      this.queueLayer.removeBetween(1, undefined, true);
      const cur = this.battle.current() || (this.battle.state.actorUid && this.battle.unit(this.battle.state.actorUid));
      let y = 120;
      if (cur) {
        const p = this.portraitOf(cur, 66);
        p.setPosition(52, y);
        // 마스크는 화면 좌표 → 컨테이너 위치에 맞춤
        p.getData('mask')?.setPosition(52, y);
        this.queueLayer.add(p);
        this.queueLayer.add(this.text(52, y + 44, '지금', 13, '#ffe08a').setOrigin(0.5));
        y += 92;
      }
      for (const uid of this.battle.queue(Math.max(1, this.opts.data.balance.combat.queuePreview - 1))) {
        const u = this.battle.unit(uid);
        if (!u) continue;
        const p = this.portraitOf(u, 46);
        p.setPosition(52, y);
        p.getData('mask')?.setPosition(52, y);
        this.queueLayer.add(p);
        y += 58;
        if (y > 560) break;
      }
    }

    // ── 아군 초상 (아래) ──
    makeAllies() {
      for (const u of this.battle.state.allies) {
        const x = panelX(u.slot);
        const c = this.add.container(x, PANEL_Y);
        const col = rarityColor(u.rarity || 3);
        const glow = this.add.rectangle(0, 0, PANEL_W + 14, PANEL_H + 14, 0xffc23d, 0).setStrokeStyle(4, 0xffc23d, 0);
        const frame = this.add.rectangle(0, 0, PANEL_W, PANEL_H, 0x140d22, 0.95).setStrokeStyle(3, col);
        c.add([glow, frame]);
        const key = charTextureKey(u.refId);
        if (this.textures.exists(key)) {
          // 가슴 위(bust) 부분만
          const img = this.add.image(0, 0, key).setOrigin(0, 0);
          const src = img.texture.getSourceImage();
          const iw = PANEL_W - 8;
          const ih = PANEL_H - 52;
          const cropW = src.width * 0.62;
          const s = iw / cropW;
          const cropH = Math.min(src.height, ih / s);
          const cx = (src.width - cropW) / 2;
          const cy = src.height * 0.03;
          img.setScale(s).setCrop(cx, cy, cropW, cropH).setPosition(-iw / 2 - cx * s, -PANEL_H / 2 + 4 - cy * s);
          c.add(img);
        } else {
          c.add(this.text(0, -24, u.name, 26).setOrigin(0.5));
        }
        c.add(this.add.rectangle(0, PANEL_H / 2 - 24, PANEL_W - 4, 46, 0x000000, 0.72));
        const name = this.text(-PANEL_W / 2 + 10, PANEL_H / 2 - 44, u.name, 16).setOrigin(0, 0);
        const role = this.text(PANEL_W / 2 - 10, -PANEL_H / 2 + 8, ROLE[u.role] || '공', 14, '#ffffff', { backgroundColor: hex(col), padding: { x: 5, y: 1 } }).setOrigin(1, 0);
        const slotNo = this.text(-PANEL_W / 2 + 8, -PANEL_H / 2 + 6, String(u.slot + 1), 18, '#ffe08a', { stroke: '#000', strokeThickness: 4 });
        const hpBg = this.add.rectangle(-PANEL_W / 2 + 10, PANEL_H / 2 - 17, PANEL_W - 20, 9, 0x3a1020).setOrigin(0, 0.5);
        const hpFill = this.add.rectangle(-PANEL_W / 2 + 10, PANEL_H / 2 - 17, PANEL_W - 20, 9, 0x5fd38a).setOrigin(0, 0.5);
        const shieldFill = this.add.rectangle(-PANEL_W / 2 + 10, PANEL_H / 2 - 21, 0, 3, 0x9fd8ff).setOrigin(0, 0.5);
        const enBg = this.add.rectangle(-PANEL_W / 2 + 10, PANEL_H / 2 - 7, PANEL_W - 20, 5, 0x1d1733).setOrigin(0, 0.5);
        const enFill = this.add.rectangle(-PANEL_W / 2 + 10, PANEL_H / 2 - 7, 0, 5, 0xffc23d).setOrigin(0, 0.5);
        const hpText = this.text(PANEL_W / 2 - 10, PANEL_H / 2 - 44, '', 13, '#cfe8d8').setOrigin(1, 0);
        const status = this.text(-PANEL_W / 2 + 8, -PANEL_H / 2 + 32, '', 12, '#ffffff', { backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 4, y: 2 }, wordWrap: { width: PANEL_W - 16 } });
        const ult = this.text(0, -PANEL_H / 2 - 16, '궁극기 준비! (탭)', 14, '#ffe08a', { stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setVisible(false);
        const flash = this.add.rectangle(0, 0, PANEL_W, PANEL_H, 0xff2a3d, 0);
        c.add([name, role, slotNo, hpBg, hpFill, shieldFill, enBg, enFill, hpText, status, ult, flash]);
        c.setSize(PANEL_W, PANEL_H).setInteractive({ useHandCursor: true });
        c.setData('ui', true);
        c.on('pointerdown', (p, lx, ly, ev) => {
          ev?.stopPropagation?.();
          this.onAllyTap(u.uid);
        });
        this.allyLayer.add(c);
        this.allyViews.set(u.uid, { c, glow, frame, hpFill, shieldFill, enFill, hpText, status, ult, flash, x, y: PANEL_Y });
        this.dispHp.set(u.uid, u.hp);
      }
    }

    // ── 적 (가운데) ──
    makeEnemies() {
      for (const v of this.enemyViews.values()) v.c.destroy(true);
      this.enemyViews.clear();
      const list = this.battle.state.enemies;
      const n = list.length;
      const gap = Math.min(240, 1000 / Math.max(1, n));
      list.forEach((u, i) => {
        const x = 700 + (i - (n - 1) / 2) * gap;
        const c = this.add.container(x, ENEMY_FEET);
        const H = u.boss ? 290 : 240;
        let sprite;
        const key = enemyKey(u.refId);
        if (this.textures.exists(key)) {
          sprite = this.add.image(0, 0, key).setOrigin(0.5, 1);
          const src = sprite.texture.getSourceImage();
          sprite.setScale(Math.min(H / src.height, (u.boss ? 300 : 190) / src.width));
        } else {
          sprite = this.add.container(0, 0);
          sprite.add(this.add.rectangle(0, -H / 2, u.boss ? 220 : 150, H, 0x3a2140, 0.9).setStrokeStyle(3, 0xff5d6c));
          sprite.add(this.text(0, -H / 2, u.name.slice(0, 2), u.boss ? 54 : 40).setOrigin(0.5));
        }
        const name = this.text(0, 14, u.name + (u.boss ? ' (보스)' : ''), u.boss ? 18 : 15, u.boss ? '#ffb4b4' : '#ffffff', { stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0);
        const barW = u.boss ? 240 : 160;
        const hpBg = this.add.rectangle(-barW / 2, 44, barW, 10, 0x3a1020).setOrigin(0, 0.5).setStrokeStyle(1, 0x000000);
        const hpFill = this.add.rectangle(-barW / 2, 44, barW, 10, 0xff5d6c).setOrigin(0, 0.5);
        const shieldFill = this.add.rectangle(-barW / 2, 38, 0, 3, 0x9fd8ff).setOrigin(0, 0.5);
        const status = this.text(0, 54, '', 12, '#ffffff', { backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 4, y: 1 } }).setOrigin(0.5, 0);
        // 예고 배지
        const badge = this.add.container(0, -H - 34);
        const badgeBg = this.add.rectangle(0, 0, 150, 46, 0x1b1030, 0.92).setStrokeStyle(2, 0xff8a8a);
        const badgeTop = this.text(0, -10, '', 15).setOrigin(0.5);
        const badgeBottom = this.text(0, 11, '', 15, '#ffd0d0').setOrigin(0.5);
        badge.add([badgeBg, badgeTop, badgeBottom]);
        const ring = this.add.image(0, -H / 2, 'fx-ring').setScale((u.boss ? 1.6 : 1.2) * 1).setTint(0xffe08a).setAlpha(0).setBlendMode('ADD');
        c.add([ring, sprite, name, hpBg, hpFill, shieldFill, status, badge]);
        const hit = this.add.zone(0, -H / 2, u.boss ? 260 : 180, H + 40).setInteractive({ useHandCursor: true });
        hit.setData('ui', true);
        hit.on('pointerdown', (p, lx, ly, ev) => {
          ev?.stopPropagation?.();
          this.onEnemyTap(u.uid);
        });
        c.add(hit);
        this.enemyLayer.add(c);
        this.enemyViews.set(u.uid, { c, sprite, hpFill, shieldFill, barW, status, badge, badgeBg, badgeTop, badgeBottom, ring, x, H });
        this.dispHp.set(u.uid, u.hp);
      });
    }

    // ── 행동 버튼 ──
    makeActionButtons() {
      this.actBasic = this.button(0, 0, 150, 46, '기본 공격', () => this.chooseAction('basic'), { size: 18 });
      this.actSkill = this.button(0, 0, 150, 46, '스킬', () => this.chooseAction('skill'), { size: 17, color: 0x24324f, border: 0x7fb0ff });
      this.actBasic.c.setDepth(75);
      this.actSkill.c.setDepth(75);
    }

    // ── 화면 갱신 ──
    statusText(u) {
      const parts = [];
      if (u.shield) parts.push(`보호막 ${u.shield.value}`);
      for (const s of u.statuses) parts.push(`${STAT_SHORT[s.stat] || s.stat}${(s.kind === 'buff') !== (s.stat === 'dmgTaken') ? '↑' : '↓'}${s.turns}`);
      if (u.dots.length) parts.push(`지속${Math.max(...u.dots.map((d) => d.turns))}`);
      if (u.taunt) parts.push(`도발${u.taunt.turns}`);
      return parts.join(' ');
    }

    refreshAll() {
      const st = this.battle.state;
      this.waveText.setText(`웨이브 ${st.wave + 1}/${st.waveCount} · 라운드 ${st.round}${st.roundLimit ? `/${st.roundLimit}` : ''}`);
      this.spPips.forEach((p, i) => p.setFillStyle(i < st.sp.ally ? 0xffc23d : 0x2a2140).setStrokeStyle(2, i < st.sp.ally ? 0xfff1c2 : 0x5a4b80));
      const inputOn = this.mode === 'input' || this.mode === 'target';
      for (const u of st.allies) {
        const v = this.allyViews.get(u.uid);
        if (!v) continue;
        const hp = this.dispHp.get(u.uid) ?? u.hp;
        v.hpFill.width = Math.max(0, (PANEL_W - 20) * (hp / u.maxHp));
        v.shieldFill.width = Math.min(PANEL_W - 20, (PANEL_W - 20) * ((u.shield?.value || 0) / u.maxHp));
        v.enFill.width = (PANEL_W - 20) * Math.min(1, u.energy / Math.max(1, u.ultCost));
        v.hpText.setText(`${Math.max(0, Math.round(hp)).toLocaleString('ko-KR')}`);
        v.status.setText(this.statusText(u)).setVisible(!!this.statusText(u));
        const ready = u.alive && u.kit.ultimate && u.energy >= u.ultCost;
        v.ult.setVisible(ready && inputOn && !this.auto);
        v.glow.setStrokeStyle(4, 0xffc23d, ready ? 1 : 0);
        if (ready && !v.glowTween && !this.reduced) v.glowTween = this.tweens.add({ targets: v.glow, alpha: { from: 1, to: 0.35 }, duration: 520, yoyo: true, repeat: -1 });
        if (!ready && v.glowTween) {
          v.glowTween.remove();
          v.glowTween = null;
          v.glow.setAlpha(1);
        }
        const picking = this.mode === 'target' && this.pick?.uids.includes(u.uid);
        v.frame.setStrokeStyle(picking ? 5 : 3, picking ? 0x7dffb0 : rarityColor(u.rarity || 3));
        v.c.setAlpha(u.alive ? 1 : 0.38);
        const isCur = st.pendingUid === u.uid || st.actorUid === u.uid;
        v.c.y = PANEL_Y - (isCur ? 10 : 0);
      }
      const intents = new Map(this.battle.intents().map((it) => [it.uid, it]));
      this.lines.clear();
      for (const u of st.enemies) {
        const v = this.enemyViews.get(u.uid);
        if (!v) continue;
        const hp = this.dispHp.get(u.uid) ?? u.hp;
        v.hpFill.width = Math.max(0, v.barW * (hp / u.maxHp));
        v.shieldFill.width = Math.min(v.barW, v.barW * ((u.shield?.value || 0) / u.maxHp));
        const s = this.statusText(u);
        v.status.setText(s).setVisible(!!s);
        const it = intents.get(u.uid);
        v.badge.setVisible(!!it && u.alive);
        if (it && u.alive) {
          const cut = it.interrupted;
          v.badgeTop.setText(`${ICON[it.icon] || '⚔'} ${it.name}`);
          v.badgeBottom.setText(cut ? '흐트러짐 예정' : `⏱${it.eta ?? '-'}  →  ${it.aoe ? '광역' : it.targetSlot ? `${it.targetSlot}번` : '자신'}`);
          const w = Math.max(130, v.badgeTop.width + 24, v.badgeBottom.width + 24);
          v.badgeBg.setSize(w, 46).setFillStyle(cut ? 0x2a2a2a : it.big ? 0x5a0f1c : 0x1b1030, 0.92).setStrokeStyle(it.big ? 3 : 2, cut ? 0x888888 : it.big ? 0xff3d55 : 0xff8a8a);
          if (it.big && !cut && !v.badgeTween && !this.reduced) v.badgeTween = this.tweens.add({ targets: v.badge, scale: { from: 1, to: 1.08 }, duration: 420, yoyo: true, repeat: -1 });
          if ((!it.big || cut) && v.badgeTween) {
            v.badgeTween.remove();
            v.badgeTween = null;
            v.badge.setScale(1);
          }
          // 대상 초상까지 선
          const tv = it.targetUid && this.allyViews.get(it.targetUid);
          if (tv && !cut && !it.aoe) {
            this.lines.lineStyle(it.big ? 4 : 2, it.big ? 0xff3d55 : 0xff8a8a, 0.55);
            this.lines.lineBetween(v.x, ENEMY_FEET - v.H - 10, tv.x, PANEL_Y - PANEL_H / 2 - 6);
          }
        }
        const picking = this.mode === 'target' && this.pick?.uids.includes(u.uid);
        v.ring.setAlpha(picking ? 0.9 : 0);
        v.c.setAlpha(u.alive ? 1 : 0);
      }
      this.refreshQueue();
      this.refreshButtons();
    }

    refreshButtons() {
      const cur = this.battle.current();
      const show = !!cur && (this.mode === 'input' || this.mode === 'target') && !this.auto;
      this.actBasic.c.setVisible(show);
      this.actSkill.c.setVisible(show);
      if (!show) return this.hint.setText(this.auto && cur && !this.ended ? 'AUTO 진행 중' : '');
      const v = this.allyViews.get(cur.uid);
      const opt = this.battle.options();
      this.actBasic.c.setPosition(v.x - 78, PANEL_Y - PANEL_H / 2 - 44);
      this.actSkill.c.setPosition(v.x + 78, PANEL_Y - PANEL_H / 2 - 44);
      this.actBasic.setLabel(`기본 공격 (SP+)`);
      this.actSkill.setLabel(`${opt.skill?.name || '스킬'} (SP ${opt.skill?.cost ?? 1})`);
      this.actSkill.setEnabled(!!opt.skill?.ok);
      this.actBasic.setOn(this.pick?.action === 'basic');
      this.actSkill.setOn(this.pick?.action === 'skill');
      if (this.mode === 'target') this.hint.setText(this.pick.kind === 'ult' ? '궁극기 대상을 고르세요 (취소: 우클릭 / Esc)' : '대상을 고르세요 (취소: 우클릭 / Esc)');
      else this.hint.setText(`${cur.name}의 차례 — 1 기본 공격 · 2 스킬 · 빛나는 초상 = 궁극기`);
    }

    // ── 입력 ──
    chooseAction(action) {
      if (!(this.mode === 'input' || this.mode === 'target') || this.auto) return;
      const t = this.battle.targets(action);
      if (!t) return this.commit({ kind: 'act', action, target: null });
      // 대상이 하나뿐이면 바로
      if (t.uids.length === 1) return this.commit({ kind: 'act', action, target: t.uids[0] });
      this.pick = { kind: 'act', action, uids: t.uids };
      this.mode = 'target';
      this.refreshAll();
    }
    onAllyTap(uid) {
      if (this.mode === 'target' && this.pick?.uids.includes(uid)) return this.commit({ ...this.pick, target: uid });
      if (!(this.mode === 'input' || this.mode === 'target') || this.auto) return;
      const u = this.battle.unit(uid);
      if (!u?.alive || !u.kit.ultimate || u.energy < u.ultCost) return;
      const t = this.battle.targets('ultimate', uid);
      if (!t) return this.commit({ kind: 'ult', uid, target: null });
      if (t.uids.length === 1) return this.commit({ kind: 'ult', uid, target: t.uids[0] });
      this.pick = { kind: 'ult', action: 'ultimate', uid, uids: t.uids };
      this.mode = 'target';
      this.refreshAll();
    }
    onEnemyTap(uid) {
      if (this.mode === 'target' && this.pick?.uids.includes(uid)) this.commit({ ...this.pick, target: uid });
    }
    cancelPick() {
      if (this.mode !== 'target') return false;
      this.pick = null;
      this.mode = 'input';
      this.refreshAll();
      return true;
    }
    commit(choice) {
      this.pick = null;
      this.mode = 'busy';
      const events = choice.kind === 'ult' ? this.battle.ultimate({ uid: choice.uid, target: choice.target }) : this.battle.act({ action: choice.action, target: choice.target });
      this.play(events);
    }

    onKey(e) {
      if (this.ended) {
        if (this.endReady && ['Space', 'Enter', 'Escape'].includes(e.code)) this.finish(false);
        return;
      }
      if (e.code === 'Escape') {
        if (this.cutin) return this.cutin.skip();
        if (!this.cancelPick()) this.togglePause();
        return;
      }
      if (this.paused) return;
      if (e.code === 'KeyA') return this.toggleAuto();
      if (e.code === 'KeyR') return this.instantResult();
      if (e.code === 'KeyX') return this.toggleSpeed();
      if (e.code === 'Space' && this.cutin) return this.cutin.skip();
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m) return;
      const n = Number(m[1]);
      if (this.mode === 'target') {
        const uid = this.pick.uids[n - 1];
        if (uid) this.commit({ ...this.pick, target: uid });
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
        this.pick = null;
        this.mode = 'busy';
        this.stepAuto();
      }
      this.refreshAll();
    }
    toggleSpeed() {
      this.speed = this.speed === 2 ? 1 : 2;
      this.applySpeed();
      this.speedBtn.setOn(this.speed === 2);
      this.opts.onSettings?.({ battleSpeed: this.speed });
    }
    togglePause() {
      if (this.ended) return;
      this.paused = !this.paused;
      if (this.paused) {
        this.tweens.pauseAll();
        this.time.paused = true;
        const c = (this.pauseLayer = this.add.container(0, 0).setDepth(900));
        c.add(this.add.rectangle(0, 0, FX_W, FX_H, 0x000000, 0.66).setOrigin(0).setInteractive());
        c.add(this.text(FX_W / 2, 250, '일시정지', 44).setOrigin(0.5));
        const resume = this.button(FX_W / 2 - 110, 360, 190, 56, '계속하기', () => this.togglePause(), { size: 20 });
        const quit = this.button(FX_W / 2 + 110, 360, 190, 56, '포기하기', () => this.finish(true), { size: 20, color: 0x4a1622, border: 0xff7a8a });
        c.add([resume.c, quit.c]);
      } else {
        this.tweens.resumeAll();
        this.time.paused = false;
        this.pauseLayer?.destroy(true);
        this.pauseLayer = null;
      }
    }

    // ── 진행 ──
    afterBatch() {
      this.syncDisplay();
      if (this.battle.state.result) return this.showEnd();
      if (this.battle.current()) {
        this.mode = this.auto ? 'busy' : 'input';
        this.refreshAll();
        if (this.auto) this.time.delayedCall(260, () => this.stepAuto());
      } else this.refreshAll();
    }
    stepAuto() {
      if (!this.auto || this.ended || this.mode !== 'busy' || !this.battle.current() || this.playing) return;
      this.play(this.battle.auto());
    }
    syncDisplay() {
      for (const u of [...this.battle.state.allies, ...this.battle.state.enemies]) this.dispHp.set(u.uid, u.hp);
    }

    async play(events) {
      this.playing = true;
      this.mode = 'busy';
      this.refreshAll();
      for (const ev of events) {
        if (this.ended) break;
        await this.playEvent(ev);
      }
      this.playing = false;
      if (!this.ended) this.afterBatch();
    }

    instantResult() {
      if (this.ended) return;
      this.instant = true;
      this.cutin?.destroy();
      this.pick = null;
      if (!this.playing) {
        this.battle.runToEnd();
        this.afterBatch();
      } else {
        // 재생 중이면 남은 연출을 건너뛰고 끝까지
        this.time.delayedCall(0, () => {
          this.battle.runToEnd();
          this.afterBatch();
        });
      }
    }

    // ── 이벤트 하나 연출 ──
    async playEvent(ev) {
      const fast = this.instant;
      switch (ev.t) {
        case 'action': {
          const u = this.battle.unit(ev.uid);
          if (!u || fast) return;
          if (ev.action === 'ultimate' && u.side === 'ally') {
            this.cutin = playCutIn(this, { id: u.refId, name: u.name, nameEn: u.nameEn, title: u.title, themeColor: u.themeColor, rarity: u.rarity }, { short: true, label: ev.name, reduced: this.reduced, quality: this.quality });
            await this.cutin.done;
            this.cutin = null;
          }
          this.banner(`${u.name} · ${ev.name}`, u.side === 'ally' ? '#bfe0ff' : '#ffc0c0');
          if (u.side === 'enemy') {
            const v = this.enemyViews.get(u.uid);
            if (v && !this.reduced) this.tweens.add({ targets: v.c, y: ENEMY_FEET + 16, duration: 90, yoyo: true });
          } else {
            const v = this.allyViews.get(u.uid);
            if (v && !this.reduced) this.tweens.add({ targets: v.c, y: PANEL_Y - 26, duration: 90, yoyo: true });
          }
          return this.wait(180);
        }
        case 'damage': {
          this.dispHp.set(ev.tgt, ev.hp);
          if (fast) return;
          this.hitFx(ev.tgt, ev.amount, ev.crit, ev.dot);
          this.refreshBars(ev.tgt);
          return this.wait(ev.dot ? 120 : 90);
        }
        case 'heal':
          this.dispHp.set(ev.tgt, ev.hp);
          if (fast || !ev.amount) return;
          this.floatText(ev.tgt, `+${ev.amount.toLocaleString('ko-KR')}`, '#7dffb0', 26);
          this.refreshBars(ev.tgt);
          return this.wait(60);
        case 'shield':
          if (fast) return;
          this.floatText(ev.tgt, `보호막 ${ev.amount}`, '#9fd8ff', 20);
          return this.wait(50);
        case 'status':
          if (fast) return;
          this.floatText(ev.tgt, `${STAT_SHORT[ev.stat] || ev.stat}${ev.value > 0 === (ev.stat !== 'dmgTaken') ? '↑' : '↓'}`, ev.kind === 'buff' ? '#ffe08a' : '#d7a6ff', 18, 18);
          return this.wait(40);
        case 'interrupt':
          if (fast || !ev.ok) return;
          this.floatText(ev.tgt, '차단!', '#ffffff', 30);
          return this.wait(200);
        case 'stagger':
          if (fast) return;
          this.floatText(ev.uid, '흐트러짐!', '#cccccc', 28);
          return this.wait(260);
        case 'av':
          if (fast) return;
          this.floatText(ev.tgt, ev.pct < 0 ? '행동 ▲' : '행동 ▼', ev.pct < 0 ? '#9fffcf' : '#ffb08a', 18, 30);
          return this.wait(60);
        case 'death':
          if (fast) return;
          this.deathFx(ev.uid);
          return this.wait(240);
        case 'wave':
          if (ev.wave > 1) {
            this.syncDisplay();
            if (!fast) {
              this.bigBanner('웨이브 클리어!', '#ffe08a');
              await this.wait(520);
            }
            this.makeEnemies();
            this.refreshAll();
            if (!fast) {
              this.bigBanner(`WAVE ${ev.wave}/${ev.total}`, '#ffffff');
              await this.wait(420);
            }
          }
          return;
        case 'phase':
          if (fast) return;
          this.bigBanner(ev.name, '#ff9a9a');
          return this.wait(520);
        case 'enrage':
          if (fast) return;
          this.bigBanner('광폭화!', '#ff4d5e');
          this.cameras.main.shake(260 / this.speed, 0.006);
          return this.wait(420);
        case 'round':
        case 'intent':
        case 'sp':
          return;
        default:
          return;
      }
    }

    refreshBars(uid) {
      const u = this.battle.unit(uid);
      const hp = this.dispHp.get(uid) ?? u?.hp ?? 0;
      const av = this.allyViews.get(uid);
      if (av && u) av.hpFill.width = Math.max(0, (PANEL_W - 20) * (hp / u.maxHp));
      const ev = this.enemyViews.get(uid);
      if (ev && u) ev.hpFill.width = Math.max(0, ev.barW * (hp / u.maxHp));
    }

    /** 유닛 위 좌표 (숫자 띄우는 곳) */
    posOf(uid) {
      const av = this.allyViews.get(uid);
      if (av) return { x: av.x, y: PANEL_Y - PANEL_H / 2 - 10 };
      const ev = this.enemyViews.get(uid);
      if (ev) return { x: ev.x, y: ENEMY_FEET - ev.H * 0.6 };
      return { x: FX_W / 2, y: FX_H / 2 };
    }

    floatText(uid, str, color, size = 28, dy = 0) {
      const p = this.posOf(uid);
      const t = this.text(p.x + (Math.random() * 30 - 15), p.y - dy, str, size, color, { stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(90);
      this.tweens.add({ targets: t, y: t.y - 60, alpha: 0, duration: 760, ease: 'Cubic.out', onComplete: () => t.destroy() });
    }

    hitFx(uid, amount, crit, dot) {
      const str = `${crit ? '치명! ' : ''}${amount.toLocaleString('ko-KR')}`;
      const ally = this.allyViews.get(uid);
      this.floatText(uid, str, crit ? '#ffc23d' : dot ? '#d7a6ff' : ally ? '#ff8a8a' : '#ffffff', crit ? 40 : 28);
      if (this.reduced) return;
      if (ally) {
        ally.flash.setFillStyle(0xff2a3d, 0.45);
        this.tweens.add({ targets: ally.flash, fillAlpha: 0, duration: 260 });
        this.tweens.add({ targets: ally.c, x: ally.x + 8, duration: 40, yoyo: true, repeat: 2, onComplete: () => ally.c.setX(ally.x) });
        return;
      }
      const ev = this.enemyViews.get(uid);
      if (!ev) return;
      this.tweens.add({ targets: ev.c, x: ev.x + 10, duration: 40, yoyo: true, repeat: 2, onComplete: () => ev.c.setX(ev.x) });
      if (ev.sprite.setTintFill) {
        ev.sprite.setTintFill(0xffffff);
        this.time.delayedCall(70, () => ev.sprite.clearTint?.());
      }
      if (this.quality > 0.3) {
        const p = this.posOf(uid);
        const burst = this.add.particles(p.x, p.y + 40, 'fx-spark', { speed: { min: 80, max: crit ? 320 : 200 }, lifespan: 380, scale: { start: crit ? 0.9 : 0.6, end: 0 }, tint: crit ? [0xffc23d, 0xffffff] : [0xffffff, 0xffb0b0], blendMode: 'ADD', emitting: false }).setDepth(85);
        burst.explode(crit ? 18 : 8);
        this.time.delayedCall(500, () => burst.destroy());
      }
    }

    deathFx(uid) {
      const ev = this.enemyViews.get(uid);
      if (ev) {
        if (!this.reduced && this.quality > 0.3) {
          const p = this.posOf(uid);
          const burst = this.add.particles(p.x, p.y, 'fx-dot', { speed: { min: 40, max: 160 }, lifespan: 700, scale: { start: 0.6, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [0x8a7a99, 0xffffff], emitting: false }).setDepth(85);
          burst.explode(24);
          this.time.delayedCall(800, () => burst.destroy());
        }
        this.tweens.add({ targets: ev.c, alpha: 0, y: ENEMY_FEET + 24, duration: 360 });
        return;
      }
      const av = this.allyViews.get(uid);
      if (av) this.tweens.add({ targets: av.c, alpha: 0.38, duration: 300 });
    }

    banner(str, color) {
      this.bannerText?.destroy();
      const t = (this.bannerText = this.text(FX_W / 2 + 40, 505, str, 22, color, { backgroundColor: 'rgba(0,0,0,0.6)', padding: { x: 16, y: 6 } }).setOrigin(0.5).setDepth(85));
      this.tweens.add({ targets: t, alpha: { from: 0, to: 1 }, duration: 90 });
      this.time.delayedCall(700, () => t.active && this.tweens.add({ targets: t, alpha: 0, duration: 200, onComplete: () => t.destroy() }));
    }

    bigBanner(str, color) {
      const t = this.text(FX_W / 2, 300, str, 54, color, { stroke: '#000', strokeThickness: 8 }).setOrigin(0.5).setDepth(95).setAlpha(0).setScale(1.3);
      this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 200, ease: 'Back.out' });
      this.time.delayedCall(620, () => this.tweens.add({ targets: t, alpha: 0, duration: 200, onComplete: () => t.destroy() }));
    }

    // ── 끝 ──
    showEnd() {
      if (this.mode === 'ended') return;
      this.mode = 'ended';
      this.ended = true;
      this.syncDisplay();
      this.refreshAll();
      this.hint.setText('');
      const st = this.battle.state;
      const win = st.result === 'win';
      const c = this.add.container(0, 0).setDepth(950);
      c.add(this.add.rectangle(0, 0, FX_W, FX_H, 0x000000, 0.55).setOrigin(0));
      const title = this.text(FX_W / 2, 300, win ? '승리!' : '패배', 96, win ? '#ffd36b' : '#ff8a9a', { stroke: '#000', strokeThickness: 10 }).setOrigin(0.5);
      const sub = this.text(FX_W / 2, 390, win ? `${st.round}라운드 만에 클리어` : st.reason === 'timeout' ? `라운드 제한(${st.roundLimit || st.maxRounds})을 넘겼어요` : '아군이 모두 쓰러졌어요', 24).setOrigin(0.5);
      const tap = this.text(FX_W / 2, 470, '탭하여 계속', 20, '#d8c9ff').setOrigin(0.5).setAlpha(0);
      c.add([title, sub, tap]);
      if (win && !this.reduced && this.quality > 0.3) {
        const conf = this.add.particles(FX_W / 2, 280, 'fx-spark', { speed: { min: 120, max: 520 }, angle: { min: 200, max: 340 }, gravityY: 400, lifespan: 1600, scale: { start: 1, end: 0.2 }, tint: [0xffc23d, 0xffffff, 0x7dc8ff], emitting: false });
        c.add(conf);
        conf.explode(Math.round(70 * this.quality));
      }
      if (!this.instant && !this.reduced) {
        title.setScale(1.6).setAlpha(0);
        this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 320, ease: 'Back.out' });
      }
      this.time.delayedCall(this.instant ? 150 : 700, () => {
        this.endReady = true;
        tap.setAlpha(1);
      });
      this.time.delayedCall(this.instant ? 900 : 2600, () => this.finish(false));
    }

    finish(quit) {
      if (this.finished) return;
      this.finished = true;
      this.cutin?.destroy();
      this.time.paused = false;
      this.opts.finish?.({ quit, summary: this.battle.summary(), record: this.battle.record() });
    }
  };
}
