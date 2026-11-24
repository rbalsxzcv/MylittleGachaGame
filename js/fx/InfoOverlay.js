// 정보창 (BATTLE_UI.md 10장) — 길게 누르기 / 우클릭 / I 키
// 전투 위에 덮개로 열고(화면은 그대로), 열려 있는 동안 전투 연출은 일시정지(tweens.pauseAll + time.paused)
// 열기: 덮개 0 → 0.72(fast) · 카드가 왼쪽 가운데로 2.2배(base) · 패널이 40px 오른쪽에서(base, 60ms 늦게). 닫기는 반대로(fast)
// 자세한 숫자는 여기에만 (카드 앞면에는 없음). HTML 없이 Phaser로만.
import { FONT } from './phaserHost.js';
import { BT } from './battleTheme.js';
import { iconKey, statIcon, actionIcon } from './icons.js';
import { describeSkill, describePassive } from '../battle/describe.js';
import { formatBig } from '../config.js';

const I = BT.info;
const ROLE_NAME = { attacker: '공격', defender: '방어', support: '지원', healer: '치유' };
const ACTION_NAME = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기' };
const STAT_ORDER = ['atk', 'def', 'spd', 'critRate', 'critDmg', 'effectHit', 'effectRes', 'energyRegen', 'healBonus', 'shieldBonus'];
const PCT = new Set(['critRate', 'critDmg', 'energyRegen', 'effectHit', 'effectRes', 'healBonus', 'shieldBonus']);
const num = (n) => formatBig(n);

export class InfoOverlay {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} motion
   * @param {{ battle:object, data:object }} o
   */
  constructor(scene, motion, o) {
    this.scene = scene;
    this.m = motion;
    this.o = o;
    this.open = false;
    this.root = null;
  }

  get vocab() {
    return this.o.data.vocab;
  }

  text(x, y, str, size = BT.minText, color = BT.color.text, bold = false, wrap = 0) {
    const style = { fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? BT.font.bold : BT.font.body, color, lineSpacing: 4 };
    if (wrap) style.wordWrap = { width: wrap, useAdvancedWrap: true };
    return this.scene.add.text(x, y, str, style);
  }

  /** 카드(BattleCard)의 정보창 열기 */
  show(card) {
    if (this.open || !card) return;
    const unit = this.o.battle.unit(card.uid);
    if (!unit) return;
    this.open = true;
    this.card = card;
    const scene = this.scene;
    // 전투 연출 일시정지: 돌고 있던 트윈만 멈춤(정보창 트윈은 돌아야 함) + 시간 멈춤
    this.wasPaused = scene.time.paused;
    this.frozen = this.m.freeze();
    scene.time.paused = true;
    const D = BT.depth.info;
    const root = (this.root = scene.add.container(0, 0).setDepth(D));
    // 1. 덮개
    const dim = scene.add.rectangle(0, 0, BT.W, BT.H, 0x000000, 1).setOrigin(0).setAlpha(0).setInteractive();
    dim.setData('ui', true);
    dim.on('pointerdown', (p, lx, ly, ev) => {
      ev?.stopPropagation?.();
      this.hide();
    });
    root.add(dim);
    this.dim = dim;
    this.m.tween(dim, { alpha: I.dim }, 'fast');
    // 2. 카드가 왼쪽 가운데로 2.2배 (원래 자리엔 빈 틀)
    const c = card.center();
    const s0 = card.root.scale / BT.card.res;
    const fly = scene.add.image(c.x, c.y, card.body.texture.key).setScale(s0);
    const b = card.bounds();
    const frame = scene.add.graphics().lineStyle(2, 0xffffff, 0.45).strokeRoundedRect(b.x, b.y, b.w, b.h, BT.radius.card).setAlpha(0);
    root.add([frame, fly]);
    this.fly = fly;
    this.frame = frame;
    this.home = { x: c.x, y: c.y, scale: s0 };
    card.root.setAlpha(0);
    this.m.tween(frame, { alpha: 1 }, 'fast');
    this.m.tween(fly, { x: I.cardX, y: BT.H / 2, scale: (card.w * I.cardScale) / (card.w * BT.card.res) }, 'base', 'out');
    // 3. 오른쪽 패널
    const P = I.panel;
    const panel = (this.panel = scene.add.container(P.x + I.slide, P.y).setAlpha(0));
    panel.add(scene.add.graphics().fillStyle(BT.color.panel, 0.97).fillRoundedRect(0, 0, P.w, P.h, BT.radius.panel).lineStyle(2, BT.color.panelLine, 1).strokeRoundedRect(0, 0, P.w, P.h, BT.radius.panel));
    const content = (this.content = scene.add.container(0, 0));
    panel.add(content);
    const maskG = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(P.x, P.y + 6, P.w, P.h - 12);
    content.setMask(maskG.createGeometryMask());
    this.maskG = maskG;
    this.fill(content, unit);
    root.add(panel);
    this.m.tween(panel, { x: P.x, alpha: 1 }, 'base', 'out', { delay: I.delay });
    // 넘치면 휠 · 끌기로 내림
    this.scrollMax = Math.max(0, this.contentH - (P.h - I.pad));
    this.onWheel = (p, over, dx, dy) => this.scroll(dy);
    scene.input.on('wheel', this.onWheel);
    const drag = scene.add.zone(P.x, P.y, P.w, P.h).setOrigin(0).setInteractive();
    drag.setData('ui', true);
    let lastY = null;
    drag.on('pointerdown', (p, lx, ly, ev) => {
      ev?.stopPropagation?.();
      lastY = p.y;
    });
    drag.on('pointermove', (p) => {
      if (lastY == null || !p.isDown) return;
      this.scroll(lastY - p.y);
      lastY = p.y;
    });
    drag.on('pointerup', () => (lastY = null));
    root.add(drag);
  }

  scroll(dy) {
    if (!this.content || !this.scrollMax) return;
    this.content.y = Math.max(-this.scrollMax, Math.min(0, this.content.y - dy));
  }

  async hide() {
    if (!this.open || this.closing) return;
    this.closing = true;
    const P = I.panel;
    this.scene.input.off('wheel', this.onWheel);
    this.m.tween(this.panel, { x: P.x + I.slide, alpha: 0 }, 'fast', 'in');
    this.m.tween(this.dim, { alpha: 0 }, 'fast');
    this.m.tween(this.frame, { alpha: 0 }, 'fast');
    await this.m.tween(this.fly, { x: this.home.x, y: this.home.y, scale: this.home.scale }, 'fast', 'out');
    this.card.root.setAlpha(1);
    this.root.destroy(true);
    this.maskG.destroy();
    this.root = null;
    this.open = false;
    this.closing = false;
    if (!this.wasPaused) this.scene.time.paused = false;
    this.m.thaw(this.frozen);
    this.frozen = null;
  }

  /** 패널 내용 */
  fill(box, u) {
    const P = I.panel;
    const pad = I.pad;
    const W = P.w - pad * 2;
    const C = BT.color;
    const battle = this.o.battle;
    const stat = (k) => battle.tools?.stat?.(u, k) ?? u.base?.[k] ?? 0;
    let y = pad;
    const add = (obj, dy) => {
      box.add(obj);
      y += dy ?? obj.height;
      return obj;
    };
    const gap = (n = 10) => (y += n);
    const head = (str) => {
      gap(14);
      add(this.text(pad, y, str, 22, C.textMid, true), 30);
    };

    // 이름 · 칭호 · 희귀도 · 역할
    add(this.text(pad, y, u.name, 34, C.text, true), 44);
    const sub = u.side === 'ally' ? [u.title, u.rarity === 'npc' ? 'NPC' : `${u.rarity}성`, ROLE_NAME[u.role] || ''].filter(Boolean).join(' · ') : [u.boss ? '보스' : '', `Lv.${u.level}`].filter(Boolean).join(' · ');
    if (sub) add(this.text(pad, y, sub, BT.minText, C.textMid), 30);
    gap(6);

    // HP 현재 / 최대 + 막대, 기력
    const barW = W - 260;
    box.add(this.scene.add.image(pad + 14, y + 14, iconKey(this.scene, 'stat_hp')).setDisplaySize(24, 24).setTint(0xff8aa0));
    box.add(this.text(pad + 36, y, `HP ${num(u.hp)} / ${num(u.maxHp)}`, BT.minText, C.text, true));
    box.add(this.scene.add.rectangle(pad + 260, y + 14, barW, 10, C.hpBg).setOrigin(0, 0.5));
    box.add(this.scene.add.rectangle(pad + 260, y + 14, barW * (u.hp / Math.max(1, u.maxHp)), 10, u.side === 'ally' ? C.ally : C.enemy).setOrigin(0, 0.5));
    y += 34;
    if (u.side === 'ally') add(this.text(pad + 36, y, `기력 ${Math.floor(u.energy)} / ${u.ultCost}`, BT.minText, C.textMid), 32);
    if (u.shield) add(this.text(pad + 36, y, `보호막 ${num(u.shield.value)} · ${u.shield.turns}턴`, BT.minText, '#9fd8ff'), 32);
    if (u.res) add(this.text(pad + 36, y, `${u.res.name} ${u.res.value} / ${u.res.cap}`, BT.minText, C.textMid), 32);

    // 능력치 표 (2열)
    head('능력치');
    const keys = STAT_ORDER.filter((k) => !['healBonus', 'shieldBonus'].includes(k) || stat(k));
    const colW = W / 2;
    keys.forEach((k, i) => {
      const cx = pad + (i % 2) * colW;
      const cy = y + Math.floor(i / 2) * 32;
      const v = stat(k);
      const label = this.vocab?.stats?.[k] || k;
      box.add(this.scene.add.image(cx + 12, cy + 14, iconKey(this.scene, statIcon(k))).setDisplaySize(22, 22).setTint(0xc9c4d6));
      box.add(this.text(cx + 32, cy, label, BT.minText, C.textMid));
      box.add(this.text(cx + colW - 24, cy, PCT.has(k) ? `${Math.round(v * 1000) / 10}%` : num(v), BT.minText, C.text, true).setOrigin(1, 0));
    });
    y += Math.ceil(keys.length / 2) * 32;

    if (u.side === 'ally') {
      // 기본 공격 / 스킬 / 궁극기
      for (const a of ['basic', 'skill', 'ultimate']) {
        const sk = u.kit?.[a];
        if (!sk) continue;
        head(`${ACTION_NAME[a]} — ${sk.name}`);
        const lines = this.vocab ? describeSkill(sk, this.vocab) : [];
        add(this.text(pad, y, lines.join('\n') || sk.description || '', BT.minText, C.text, false, W), undefined);
        gap(4);
      }
    } else {
      // 적: 행동 패턴 (다음 행동 강조) · 페이즈 · 패시브
      head('행동 패턴');
      const next = u.intent?.action;
      (u.pattern || []).forEach((p, i) => {
        const act = u.actions?.[p.action];
        if (!act) return;
        const isNext = i === u.patternIdx % Math.max(1, u.pattern.length) && p.action === next;
        box.add(this.scene.add.image(pad + 14, y + 14, iconKey(this.scene, actionIcon(act.icon))).setDisplaySize(24, 24).setTint(isNext ? 0xffffff : 0x8a8499));
        const desc = this.vocab ? describeSkill(act, this.vocab).join(', ') : '';
        add(this.text(pad + 36, y, `${act.name}${act.big ? ' (큰 공격)' : ''}${desc ? ` — ${desc}` : ''}`, BT.minText, isNext ? C.text : C.textDim, isNext, W - 36), undefined);
        gap(6);
      });
      if (u.phases?.length) {
        head('페이즈');
        for (const ph of u.phases) add(this.text(pad, y, `HP ${ph.hpBelow}% 미만 — ${ph.name || ''}`, BT.minText, C.text, false, W), undefined);
      }
      if (u.enrage) add(this.text(pad, y + 6, `${u.enrage.round}라운드부터 광폭화`, BT.minText, '#ff9a9a', false, W), 36);
      const ent = this.o.data.enemyMap?.get(u.refId);
      const pas = (ent?.passives || []).flatMap((p) => (this.vocab ? describePassive(p, this.vocab) : []).map((t) => `${p.name ? `${p.name}: ` : ''}${t}`));
      if (pas.length) {
        head('패시브');
        add(this.text(pad, y, pas.join('\n'), BT.minText, C.text, false, W), undefined);
      }
    }

    // 걸린 효과
    const fx = effectRows(u, this.vocab);
    if (fx.length) {
      head('걸린 효과');
      for (const r of fx) {
        box.add(this.scene.add.image(pad + 14, y + 14, iconKey(this.scene, r.icon)).setDisplaySize(24, 24).setTint(r.kind === 'buff' ? C.gold : C.debuff));
        add(this.text(pad + 36, y, r.text, BT.minText, C.text, false, W - 36), undefined);
        gap(6);
      }
    }
    this.contentH = y + pad;
  }
}

/** 걸린 효과 줄: 아이콘 + 이름 + 남은 턴 + 설명 */
export function effectRows(u, vocab) {
  const rows = [];
  const label = (k) => vocab?.stats?.[k] || (k === 'dmgDealt' ? '주는 피해' : k === 'dmgTaken' ? '받는 피해' : k);
  if (u.transform) rows.push({ icon: 'transform', kind: 'buff', text: `변신 · ${u.transform.turns}턴` });
  if (u.taunt) rows.push({ icon: 'taunt', kind: 'buff', text: `도발 · ${u.taunt.turns}턴 — 적이 이 캐릭터를 노림` });
  // 강화/약화 값은 모두 % (비율 능력치는 % 포인트)
  for (const s of u.statuses || []) rows.push({ icon: statIcon(s.stat), kind: s.kind, text: `${label(s.stat)} ${s.value > 0 ? `+${s.value}` : s.value}% · ${s.turns}턴` });
  for (const d of u.dots || []) rows.push({ icon: 'dot', kind: 'debuff', text: `지속 피해 ${formatBig(d.dmg || 0)} · ${d.turns}턴` });
  const marks = (u.marks || []).reduce((n, m) => n + m.n, 0);
  if (marks) rows.push({ icon: 'mark', kind: 'debuff', text: `표식 ${marks}` });
  return rows;
}
