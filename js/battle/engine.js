// 전투 엔진 — 턴제, 시드 난수로 완전히 재현 가능 (같은 시드 + 같은 결정 = 같은 결과)
// DOM, Date, Math.random을 쓰지 않습니다. 게임 화면(Phaser BattleScene) / 개발 도구 시뮬레이터 / 테스트가 같이 씁니다.
//
// 진행 (숫자는 balance.combat)
//   - 속도 타임라인: 유닛마다 행동 수치 av = avBase ÷ 속도. 가장 작은 av가 행동 → 모두 그만큼 줄고,
//     행동한 유닛은 다시 avBase ÷ 속도. 동점은 아군 → 적, 칸 순서. 속도가 바뀌면 남은 av × (이전 속도 ÷ 새 속도)
//   - 라운드: 타임라인이 roundAv만큼 흐를 때마다 +1 (라운드 제한 / 광폭화 / 조건 round_at_least)
//   - 아군 차례: 입력을 기다림 (시간 제한 없음). 기본 공격(SP +1) 또는 스킬(SP −1, 0이면 불가) → 대상
//     궁극기: 기력이 비용 이상이면 아군 입력 중 아무 때나 (초상 탭). 턴을 쓰지 않음, 여러 명 연달아 가능
//     기력: 기본 +20, 스킬 +30, 맞으면 +10
//   - 적 차례: 미리 예고한 행동(intent)을 자동 실행. 패턴 순서대로 반복, 보스는 HP 기준 페이즈 / N라운드 광폭화
//     예고된 큰 공격(big)은 interrupt 효과로 끊을 수 있음 → 그 차례는 '흐트러짐'
//   - 지속 시간(강화/약화/보호막/도발)은 가진 유닛의 턴이 끝날 때 1 줄어듦 (자기 턴 중 받은 효과는 그 턴엔 안 줄어듦)
//   - 지속 피해는 가진 유닛의 턴 시작에 터짐
//   - 패시브에서 나온 효과는 다른 발동 조건을 다시 부르지 않음 (무한 반복 방지)

import { createRng } from '../core/rng.js';
import { enemyLevelFor } from '../config.js';
import { buildUnit } from './units.js';
import { EFFECTS } from './effects/index.js';
import { TARGETING, selectable, lowestHp } from './targeting.js';
import { CONDITIONS } from './conditions.js';
import { MODIFIERS } from './modifiers.js';
import { chooseAction, chooseUltimates } from './ai.js';

export const TRIGGERS = ['onBattleStart', 'onTurnStart', 'onBasic', 'onSkill', 'onUltimate', 'onCrit', 'onKill', 'onHit', 'onHpBelow'];
const ACTION_TRIGGER = { basic: 'onBasic', skill: 'onSkill', ultimate: 'onUltimate' };

/** vocab.json과 구현이 맞는지 → 빠진 것 목록 (비어 있으면 정상) */
export function checkRegistry(vocab) {
  const problems = [];
  const cmp = (label, vocabKeys, implKeys) => {
    for (const k of vocabKeys) if (!implKeys.includes(k)) problems.push(`${label} '${k}': vocab에는 있는데 구현이 없음`);
    for (const k of implKeys) if (!vocabKeys.includes(k)) problems.push(`${label} '${k}': 구현은 있는데 vocab에 없음`);
  };
  cmp('효과', Object.keys(vocab.effects), Object.keys(EFFECTS));
  cmp('대상', Object.keys(vocab.targeting), Object.keys(TARGETING));
  cmp('발동 조건', Object.keys(vocab.triggers), TRIGGERS);
  cmp('조건', Object.keys(vocab.conditions), Object.keys(CONDITIONS));
  cmp('수정자', Object.keys(vocab.modifiers), Object.keys(MODIFIERS));
  return problems;
}

/** 적 행동이 상대 한 명을 노리는지 (예고에 대상 칸 표시) */
const singleOpponent = (skill) => TARGETING[skill?.targeting]?.pick === 'enemy';
/** 적 행동이 상대 전체를 노리는지 (예고에 '광역') */
const aoeOpponent = (skill) => skill?.targeting === 'enemy_all' || skill?.targeting === 'enemy_random_n';

/**
 * 전투 만들기
 * @param {object} o
 * @param {Array<{charId:string, level:number, breakthrough:number}|null>} o.team 최대 5칸 (빈 칸은 null)
 * @param {{id?:string, name?:string, recommendedPower?:number, waves:Array<Array<{enemyId:string, level?:number|null}>>, roundLimit?:number|null}} o.stage
 * @param {{charMap:Map, enemyMap:Map, balance:object}} o.data
 * @param {number} o.seed
 */
export function createBattle({ team, stage, data, seed = 1 }) {
  const { balance } = data;
  const C = balance.combat;
  const rng = createRng(seed);
  const state = {
    seed: seed >>> 0,
    round: 1,
    elapsed: 0, // 지금까지 흐른 타임라인
    roundLimit: stage.roundLimit ?? stage.turnLimit ?? null,
    maxRounds: C.maxRounds,
    wave: -1,
    waveCount: stage.waves.length,
    allies: [],
    enemies: [],
    sp: { ally: C.sp.start, enemy: 0 },
    spMax: C.sp.max,
    actorUid: null, // 지금 행동 중인 유닛
    pendingUid: null, // 입력을 기다리는 아군
    result: null, // 'win' | 'lose'
    reason: null, // 'wipe' | 'timeout'
    events: [],
    actions: [], // 아군 결정 기록 (리플레이용): {type:'act', action, target} | {type:'ult', uid, target}
  };

  const log = (ev) => state.events.push(ev);
  const all = () => [...state.allies, ...state.enemies];
  const living = () => all().filter((u) => u.alive);
  const registry = new Map(); // 지난 웨이브 적까지 모든 유닛 (기록의 이름 표시용)
  const unitOf = (uid) => registry.get(uid) || null;
  const alliesOf = (u) => (u.side === 'ally' ? state.allies : state.enemies).filter((x) => x.alive);
  const opponentsOf = (u) => (u.side === 'ally' ? state.enemies : state.allies).filter((x) => x.alive);

  /** 전투 중 실제 능력치 (강화/약화 반영) */
  function stat(u, key) {
    const sum = u.statuses.reduce((acc, s) => (s.stat === key ? acc + s.value : acc), 0);
    if (key === 'atk' || key === 'def') return Math.max(0, Math.floor(u.base[key] * (1 + sum / 100)));
    if (key === 'spd') return Math.max(1, Math.floor(u.base.spd * (1 + sum / 100)));
    if (key === 'hp') return u.maxHp;
    if (key === 'critRate' || key === 'critDmg') return Math.max(0, u.base[key] + sum / 100);
    return sum / 100; // dmgDealt / dmgTaken (기본 0)
  }

  // ── 타임라인 ──
  const turnLength = (u) => C.avBase / stat(u, 'spd');

  /** 속도가 바뀌었으면 남은 행동 수치를 비율대로 조정 */
  function syncSpeed(u) {
    const cur = stat(u, 'spd');
    if (cur === u.spdNow) return;
    u.av = (u.av * u.spdNow) / cur;
    u.spdNow = cur;
  }

  /** 행동 당기기(음수)/밀기(양수): pct% × 한 턴 길이 */
  function shiftAction(u, pct, src) {
    if (!u.alive) return;
    if (state.actorUid === u.uid) {
      // 지금 행동 중인 유닛은 턴이 끝나면 av가 다시 정해지므로, 다음 턴에 반영
      u.pendingShift = (u.pendingShift || 0) + pct;
      log({ t: 'av', src: src?.uid ?? null, tgt: u.uid, pct, delta: null, next: true });
      return;
    }
    const before = u.av;
    u.av = Math.max(0, u.av + (pct / 100) * turnLength(u));
    log({ t: 'av', src: src?.uid ?? null, tgt: u.uid, pct, delta: u.av - before });
  }

  /** 다음 행동 순서 비교: av → 아군 먼저 → 칸 */
  const order = (a, b) => a.av - b.av || (a.side === b.side ? a.slot - b.slot : a.side === 'ally' ? -1 : 1);

  /** 시간 흐르기 → 라운드 넘김 / 광폭화 / 라운드 제한 */
  function advanceTime(dt) {
    if (dt > 0) {
      for (const u of living()) u.av = Math.max(0, u.av - dt);
      state.elapsed += dt;
    }
    const round = Math.max(1, Math.ceil(state.elapsed / C.roundAv - 1e-9));
    while (state.round < round && !state.result) {
      state.round += 1;
      log({ t: 'round', round: state.round });
      if ((state.roundLimit && state.round > state.roundLimit) || state.round > state.maxRounds) return end('lose', 'timeout');
      for (const e of state.enemies) checkEnrage(e);
    }
  }

  function gainEnergy(u, n) {
    if (!u.alive || !n || u.side !== 'ally') return;
    u.energy = Math.min(C.energy.max, Math.max(0, u.energy + n));
  }

  function gainSp(side, n, src) {
    if (side !== 'ally' || !n) return;
    const before = state.sp.ally;
    state.sp.ally = Math.min(state.spMax, Math.max(0, state.sp.ally + n));
    if (state.sp.ally !== before) log({ t: 'sp', src: src?.uid ?? null, sp: state.sp.ally, delta: state.sp.ally - before });
  }

  const skillCost = (u) => Math.max(0, C.sp.skillCost + u.spCostDelta);

  function kill(ctx, tgt, src) {
    tgt.alive = false;
    tgt.hp = 0;
    tgt.statuses = [];
    tgt.dots = [];
    tgt.shield = null;
    tgt.taunt = null;
    tgt.intent = null;
    log({ t: 'death', uid: tgt.uid, by: src?.uid ?? null });
    ctx?.kills.push(tgt);
    // 이 유닛을 노리던 적 예고는 새 대상으로
    if (tgt.side === 'ally') for (const e of state.enemies) if (e.alive && e.intent?.targetUid === tgt.uid) e.intent.targetUid = pickIntentTarget(e, e.intent.rule)?.uid ?? null;
  }

  /** 보호막 → HP 순서로 피해 적용. 반환: 실제로 깎인 양(보호막 포함) */
  function applyRaw(tgt, amount) {
    let rest = amount;
    let absorbed = 0;
    if (tgt.shield) {
      absorbed = Math.min(tgt.shield.value, rest);
      tgt.shield.value -= absorbed;
      rest -= absorbed;
      if (tgt.shield.value <= 0) tgt.shield = null;
    }
    const before = tgt.hp;
    tgt.hp = Math.max(0, tgt.hp - rest);
    return { absorbed, lost: before - tgt.hp };
  }

  // 효과 모듈이 쓰는 도구 모음
  const b = {
    state,
    rng,
    balance,
    log,
    stat,
    alliesOf,
    opponentsOf,
    gainEnergy,
    gainSp,
    syncSpeed,
    shiftAction,
    unitOf,
    isActor: (u) => state.actorUid === u.uid,
    canUse: (u, a) => canUse(u, a),
    skillCost,
    /** 직접 피해 (공격받음 → 기력 +, 발동 조건 기록) */
    hit(ctx, src, tgt, amount, crit) {
      const { absorbed, lost } = applyRaw(tgt, amount);
      src.stats.dealt += absorbed + lost;
      tgt.stats.taken += absorbed + lost;
      log({ t: 'damage', src: src.uid, tgt: tgt.uid, amount, absorbed, crit, hp: tgt.hp });
      ctx.hits.push({ src, tgt });
      if (crit) {
        ctx.crit = true;
        ctx.critTarget ??= tgt;
      }
      gainEnergy(tgt, tgt.energyGain.hit);
      if (tgt.hp <= 0) kill(ctx, tgt, src);
    },
    heal(ctx, src, tgt, amount) {
      if (!tgt.alive || amount <= 0) return;
      const before = tgt.hp;
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
      src.stats.healed += tgt.hp - before;
      log({ t: 'heal', src: src.uid, tgt: tgt.uid, amount: tgt.hp - before, hp: tgt.hp });
    },
    /** 강화/약화: 같은 시전자·같은 출처·같은 능력치면 새로 고침, 다르면 겹침 */
    addStatus(ctx, src, tgt, { kind, stat: key, value, turns }) {
      const sourceKey = `${src.uid}:${ctx.sourceKey}:${key}:${kind}`;
      tgt.statuses = tgt.statuses.filter((s) => s.key !== sourceKey);
      tgt.statuses.push({ key: sourceKey, kind, stat: key, value, turns, fresh: state.actorUid === tgt.uid, src: src.uid });
      if (key === 'spd') syncSpeed(tgt);
      log({ t: 'status', src: src.uid, tgt: tgt.uid, kind, stat: key, value, turns });
    },
  };

  // ── 웨이브 ──
  function spawnWave(i) {
    state.wave = i;
    state.enemies = (stage.waves[i] || [])
      .map((e, j) => {
        const entity = data.enemyMap.get(e.enemyId);
        if (!entity) return null;
        const u = buildUnit({ entity, level: enemyLevelFor(e, stage, balance), side: 'enemy', slot: j, uid: `w${i + 1}e${j + 1}`, balance });
        u.av = turnLength(u); // 지금부터 한 턴 뒤에 첫 행동
        return u;
      })
      .filter(Boolean);
    for (const u of state.enemies) registry.set(u.uid, u);
    log({ t: 'wave', wave: i + 1, total: state.waveCount, uids: state.enemies.map((u) => u.uid) });
    for (const u of state.enemies) firePassives(u, 'onBattleStart', {});
    for (const u of state.enemies) telegraph(u);
  }

  function end(result, reason = null) {
    if (state.result) return;
    state.result = result;
    state.reason = reason;
    state.pendingUid = null;
    log({ t: 'end', result, reason, round: state.round });
  }

  /** 전멸 판정 → 다음 웨이브 / 승리 / 패배 */
  function checkEnd() {
    if (state.result) return;
    for (let guard = 0; guard < 50 && !state.result; guard++) {
      if (!state.allies.some((u) => u.alive)) return end('lose', 'wipe');
      if (state.enemies.some((u) => u.alive)) return;
      if (state.wave + 1 >= state.waveCount) return end('win');
      spawnWave(state.wave + 1);
    }
  }

  // ── 적: 예고 / 패턴 / 페이즈 / 광폭화 ──
  /** 대상 규칙으로 상대 한 명 고르기 (무작위는 시드 난수) */
  function pickIntentTarget(e, rule) {
    const opp = opponentsOf(e);
    if (!opp.length) return null;
    if (rule === 'lowest_hp') return lowestHp(opp);
    if (rule === 'highest_atk') return opp.reduce((a, x) => (stat(x, 'atk') > stat(a, 'atk') ? x : a));
    if (/^slot\d$/.test(rule || '')) {
      const want = Number(rule.slice(4)) - 1;
      return opp.find((x) => x.slot === want) || lowestHp(opp);
    }
    return opp[Math.floor(rng() * opp.length)];
  }

  /** 다음 행동 예고 (패턴의 지금 칸) */
  function telegraph(e) {
    if (!e.alive || !e.pattern.length) return;
    const entry = e.pattern[e.patternIdx % e.pattern.length];
    const act = e.actions[entry.action];
    if (!act) return;
    const rule = entry.target || 'random';
    e.intent = {
      action: entry.action,
      name: act.name,
      icon: act.icon || 'attack',
      big: !!act.big,
      aoe: aoeOpponent(act),
      rule,
      targetUid: singleOpponent(act) ? pickIntentTarget(e, rule)?.uid ?? null : null,
      interrupted: false,
    };
    log({ t: 'intent', uid: e.uid, action: entry.action, name: act.name, big: e.intent.big, target: e.intent.targetUid });
  }

  /** 예고 대상 (도발 중인 아군이 있으면 그쪽) */
  function intentTarget(e) {
    if (!e.intent?.targetUid && !singleOpponent(e.actions?.[e.intent?.action])) return null;
    const taunter = opponentsOf(e).find((x) => x.taunt);
    if (taunter) return taunter;
    const t = unitOf(e.intent.targetUid);
    return t?.alive ? t : null;
  }

  function checkPhases() {
    for (const e of state.enemies) {
      if (!e.alive || !e.phases.length) continue;
      let next = e.phaseIdx;
      e.phases.forEach((ph, i) => {
        if (i > e.phaseIdx && e.hp * 100 < ph.hpBelow * e.maxHp) next = i;
      });
      if (next === e.phaseIdx) continue;
      e.phaseIdx = next;
      const ph = e.phases[next];
      e.pattern = ph.pattern;
      e.patternIdx = 0;
      log({ t: 'phase', uid: e.uid, name: ph.name, index: next + 1 });
      const ctx = newCtx(e, 'phase', `phase${next}`, true);
      for (const eff of ph.enterEffects) applyEffect(ctx, e, eff, [e], null);
      telegraph(e);
    }
  }

  function checkEnrage(e) {
    if (!e.alive || e.enraged || !e.enrage || state.round < e.enrage.round) return;
    e.enraged = true;
    log({ t: 'enrage', uid: e.uid, round: state.round });
    const ctx = newCtx(e, 'enrage', 'enrage', true);
    for (const eff of e.enrage.effects) applyEffect(ctx, e, eff, [e], null);
  }

  // ── 패시브 ──
  function runPassive(u, p, triggerTarget) {
    if (p.limit && p.fired >= p.limit) return;
    if (!p.conditions.every((c) => CONDITIONS[c.type]?.(b, u, c, { target: triggerTarget }))) return;
    p.fired += 1;
    log({ t: 'passive', uid: u.uid, name: p.name });
    const ctx = newCtx(u, 'passive', `p${p.idx}`, true);
    ctx.triggerTarget = triggerTarget;
    const targets = resolve(u, p.targeting, { triggerTarget, count: p.count });
    for (const eff of p.effects) applyEffect(ctx, u, eff, targets, null);
  }

  function firePassives(u, trigger, { triggerTarget = null } = {}) {
    if (!u.alive) return;
    for (const p of u.passives) if (p.trigger === trigger) runPassive(u, p, triggerTarget);
  }

  /** HP가 기준 아래로 내려갔는지 확인 (내려가는 순간 한 번, 다시 올라가면 재무장) + 보스 페이즈 */
  function checkHpBelow() {
    for (const u of all()) {
      if (!u.alive) continue;
      for (const p of u.passives) {
        if (p.trigger !== 'onHpBelow') continue;
        const below = u.hp * 100 < p.pct * u.maxHp;
        if (below && !p.below) {
          p.below = true;
          runPassive(u, p, null);
        } else if (!below) p.below = false;
      }
    }
    checkPhases();
  }

  // ── 행동 ──
  function newCtx(actor, action, sourceKey, fromPassive = false) {
    return { actor, action, sourceKey, fromPassive, crit: false, critTarget: null, kills: [], hits: [], triggerTarget: null };
  }

  function resolve(u, targeting, opts) {
    return TARGETING[targeting]?.resolve(b, u, opts) ?? [];
  }

  function powerFor(u, type, action) {
    let pct = 0;
    for (const m of u.effectPower) if (m.effect === type && (m.action === 'any' || m.action === action)) pct += m.pct;
    return Math.max(0, 1 + pct / 100);
  }

  function applyEffect(ctx, u, eff, primary, chosen) {
    const fn = EFFECTS[eff.type];
    if (!fn) return;
    if (eff.chance != null && rng() * 100 >= eff.chance) return;
    const targets = eff.target ? resolve(u, eff.target, { chosen, count: eff.count, triggerTarget: ctx.triggerTarget }) : primary;
    const power = powerFor(u, eff.type, ctx.action);
    for (const t of targets) if (t.alive) fn(b, ctx, u, t, eff, power);
  }

  /** 아군이 지금 이 행동을 쓸 수 있는지 */
  function canUse(u, action) {
    if (!u?.alive || u.side !== 'ally') return false;
    const s = u.kit[action];
    if (!s) return false;
    if (action === 'skill') return state.sp.ally >= skillCost(u);
    if (action === 'ultimate') return u.energy >= u.ultCost;
    return true;
  }

  /** 스킬 하나 실행 (자원 처리는 부른 쪽에서). kind: 발동 조건/효과 강화용 이름 */
  function runSkill(u, kind, skill, chosen) {
    log({ t: 'action', uid: u.uid, action: kind, name: skill.name, side: u.side });
    const ctx = newCtx(u, kind, kind);
    const primary = resolve(u, skill.targeting, { chosen, count: skill.count });
    for (const eff of skill.effects) applyEffect(ctx, u, eff, primary, chosen);
    return { ctx, first: primary.find(Boolean) || null };
  }

  /** 행동 뒤 발동 조건들 */
  function afterAction(u, trigger, { ctx, first }) {
    firePassives(u, trigger, { triggerTarget: first });
    if (ctx.crit) firePassives(u, 'onCrit', { triggerTarget: ctx.critTarget ?? first });
    for (const k of ctx.kills) if (k.side !== u.side) firePassives(u, 'onKill', { triggerTarget: k });
    for (const h of ctx.hits) if (h.tgt.alive && h.tgt !== u) firePassives(h.tgt, 'onHit', { triggerTarget: h.src });
    checkHpBelow();
    checkEnd();
  }

  /** 아군 기본 공격 / 스킬 (턴을 씀) */
  function allyAct(u, action, targetUid) {
    if (action !== 'skill' || !canUse(u, 'skill')) action = 'basic';
    const skill = u.kit[action];
    if (action === 'skill') gainSp('ally', -skillCost(u), u);
    const r = runSkill(u, action, skill, targetUid ? unitOf(targetUid) : null);
    if (action === 'basic') gainSp('ally', C.sp.basicGain, u);
    gainEnergy(u, u.energyGain[action]);
    afterAction(u, ACTION_TRIGGER[action], r);
  }

  /** 아군 궁극기 (턴을 쓰지 않음) */
  function allyUltimate(u, targetUid) {
    u.energy = Math.max(0, u.energy - u.ultCost);
    log({ t: 'energy', src: u.uid, tgt: u.uid, n: -u.ultCost });
    const r = runSkill(u, 'ultimate', u.kit.ultimate, targetUid ? unitOf(targetUid) : null);
    afterAction(u, 'onUltimate', r);
  }

  /** 적 차례: 예고한 행동 실행 → 패턴 다음 칸 → 새 예고 */
  function enemyAct(e) {
    const it = e.intent;
    if (it?.interrupted) {
      log({ t: 'stagger', uid: e.uid, name: it.name });
    } else if (it) {
      const act = e.actions[it.action];
      const r = runSkill(e, it.action, act, intentTarget(e));
      afterAction(e, ACTION_TRIGGER[it.action] || 'onSkill', r);
    }
    if (!e.alive || state.result) return;
    e.patternIdx = (e.patternIdx + 1) % Math.max(1, e.pattern.length);
    telegraph(e);
  }

  // ── 턴 ──
  function beginTurn(u) {
    state.actorUid = u.uid;
    log({ t: 'turn', uid: u.uid, round: state.round });
    if (u.dots.length) {
      for (const d of u.dots) {
        if (!u.alive) break;
        const amount = Math.max(1, Math.floor(d.dmg * Math.max(0, 1 + stat(u, 'dmgTaken'))));
        const { absorbed, lost } = applyRaw(u, amount);
        const src = unitOf(d.src);
        if (src) src.stats.dealt += absorbed + lost;
        u.stats.taken += absorbed + lost;
        log({ t: 'damage', src: d.src, tgt: u.uid, amount, absorbed, crit: false, dot: true, hp: u.hp });
        d.turns -= 1;
        if (u.hp <= 0) kill(null, u, src);
      }
      u.dots = u.dots.filter((d) => d.turns > 0);
      checkHpBelow();
      checkEnd();
    }
    if (u.alive && !state.result) {
      firePassives(u, 'onTurnStart', {});
      checkHpBelow();
      checkEnd();
    }
  }

  function tick(x) {
    if (!x) return x;
    if (x.fresh) {
      x.fresh = false;
      return x;
    }
    x.turns -= 1;
    return x.turns > 0 ? x : null;
  }

  function endTurn(u) {
    state.actorUid = null;
    if (!u.alive) return;
    u.statuses = u.statuses.map(tick).filter(Boolean);
    u.shield = tick(u.shield);
    u.taunt = tick(u.taunt);
    u.spdNow = stat(u, 'spd');
    u.av = Math.max(0, turnLength(u) * (1 + (u.pendingShift || 0) / 100)); // 다음 행동까지 한 턴 (± 이번 턴에 받은 당기기/밀기)
    u.pendingShift = 0;
  }

  /** 다음에 행동할 유닛 → 시간을 그만큼 흘림 */
  function nextActor() {
    const list = living().sort(order);
    const u = list[0];
    if (!u) return null;
    advanceTime(u.av);
    return state.result ? null : u;
  }

  /** 아군의 결정이 필요하거나 전투가 끝날 때까지 진행 */
  function proceed() {
    for (let guard = 0; guard < 100000 && !state.result && !state.pendingUid; guard++) {
      const u = nextActor();
      if (!u) {
        if (!state.result) checkEnd();
        continue;
      }
      beginTurn(u);
      if (state.result) return;
      if (!u.alive) {
        endTurn(u);
        continue;
      }
      if (u.side === 'ally') {
        state.pendingUid = u.uid;
        return;
      }
      enemyAct(u);
      endTurn(u);
      checkEnd();
    }
  }

  /** 앞으로 행동할 순서 (지금 차례인 유닛은 빼고) — 타임라인 복사본으로 미리 돌려 봄 */
  function simulateQueue(n) {
    const sims = living().map((u) => ({ u, av: u.av, len: turnLength(u), side: u.side, slot: u.slot }));
    const cur = state.pendingUid || state.actorUid;
    for (const s of sims) if (s.u.uid === cur) s.av = Math.max(0, s.len * (1 + (s.u.pendingShift || 0) / 100)); // 지금 차례가 끝나면 한 턴 뒤
    const out = [];
    for (let i = 0; i < n && sims.length; i++) {
      sims.sort(order);
      const s = sims[0];
      const dt = s.av;
      for (const x of sims) x.av -= dt;
      out.push(s.u);
      s.av = s.len;
    }
    return out;
  }

  // ── 시작 ──
  state.allies = team
    .map((m, slot) => {
      if (!m) return null;
      const entity = data.charMap.get(m.charId);
      return entity ? buildUnit({ entity, level: m.level || 1, breakthrough: m.breakthrough || 0, side: 'ally', slot, uid: `a${slot + 1}`, balance }) : null;
    })
    .filter(Boolean);
  for (const u of state.allies) {
    u.av = turnLength(u);
    registry.set(u.uid, u);
  }
  log({ t: 'round', round: 1 });
  spawnWave(0);
  for (const u of state.allies) firePassives(u, 'onBattleStart', {});
  checkHpBelow();
  checkEnd();
  proceed();

  // ── 바깥에서 쓰는 API ──
  const api = {
    state,
    unit: unitOf,
    /** 결정을 기다리는 아군 (없으면 null) */
    current: () => (state.pendingUid ? unitOf(state.pendingUid) : null),
    /** 현재 입력 선택지: 차례인 아군의 기본/스킬 + 궁극기를 쓸 수 있는 아군 목록 */
    options() {
      const u = api.current();
      if (!u) return null;
      const opt = (a) => u.kit[a] && { name: u.kit[a].name, ok: canUse(u, a), targeting: u.kit[a].targeting };
      return {
        uid: u.uid,
        sp: state.sp.ally,
        spMax: state.spMax,
        basic: opt('basic'),
        skill: u.kit.skill && { ...opt('skill'), cost: skillCost(u) },
        ultimates: state.allies
          .filter((a) => a.alive && a.kit.ultimate)
          .map((a) => ({ uid: a.uid, name: a.kit.ultimate.name, ok: canUse(a, 'ultimate'), energy: a.energy, cost: a.ultCost, targeting: a.kit.ultimate.targeting })),
      };
    },
    /** 행동의 대상 선택지 → { pick, uids } 또는 null(고를 필요 없음). uid를 주면 그 아군(궁극기용) */
    targets(action, uid = null) {
      const u = uid ? unitOf(uid) : api.current();
      return u?.kit?.[action] ? selectable(b, u, u.kit[action].targeting) : null;
    },
    /** 차례인 아군의 기본 공격/스킬 → 다음 결정 지점까지 진행. 이번에 생긴 이벤트 반환 */
    act({ action, target = null }) {
      const u = api.current();
      if (!u) return [];
      const from = state.events.length;
      state.actions.push({ type: 'act', action, target });
      state.pendingUid = null;
      allyAct(u, action, target);
      endTurn(u);
      proceed();
      return state.events.slice(from);
    },
    /** 궁극기 (아군 입력 중에만, 턴을 쓰지 않음). 못 쓰면 빈 배열 */
    ultimate({ uid, target = null }) {
      const u = unitOf(uid);
      if (!state.pendingUid || state.result || !canUse(u, 'ultimate')) return [];
      const from = state.events.length;
      state.actions.push({ type: 'ult', uid, target });
      allyUltimate(u, target);
      return state.events.slice(from);
    },
    /** AI가 궁극기들 → 지금 아군 행동을 고름 */
    auto() {
      const from = state.events.length;
      for (let guard = 0; guard < 10 && state.pendingUid && !state.result; guard++) {
        const ult = chooseUltimates(b)[0];
        if (!ult) break;
        api.ultimate(ult);
      }
      const u = api.current();
      if (u) api.act(chooseAction(b, u));
      return state.events.slice(from);
    },
    /** 끝까지 자동 진행 */
    runToEnd() {
      const from = state.events.length;
      for (let guard = 0; guard < 100000 && !state.result; guard++) api.auto();
      return state.events.slice(from);
    },
    /** 다음에 행동할 n명 (왼쪽 행동 순서 표시). 지금 차례 유닛은 current()로 */
    queue: (n = C.queuePreview) => simulateQueue(n).map((u) => u.uid),
    /** 적 예고: 무엇을, 누구에게, 몇 번 뒤에 (eta 0 = 다음 차례) */
    intents() {
      const q = simulateQueue(Math.max(20, living().length * 3)).map((u) => u.uid);
      return state.enemies
        .filter((e) => e.alive && e.intent)
        .map((e) => {
          const t = intentTarget(e);
          const eta = q.indexOf(e.uid);
          return { uid: e.uid, ...e.intent, targetUid: t?.uid ?? null, targetSlot: t ? t.slot + 1 : null, eta: eta < 0 ? null : eta };
        });
    },
    /** 캐릭터별 기록 */
    summary() {
      return {
        result: state.result,
        reason: state.reason,
        rounds: state.round,
        seed: state.seed,
        units: state.allies.map((u) => ({ uid: u.uid, refId: u.refId, name: u.name, alive: u.alive, hp: u.hp, maxHp: u.maxHp, ...u.stats })),
      };
    },
    /** 리플레이 기록 */
    record: () => ({ seed: state.seed, actions: [...state.actions] }),
    /** 효과 모듈 도구 (테스트/디버그용) */
    tools: b,
  };
  return api;
}

/** 리플레이: 같은 시드 + 같은 결정 → 같은 결과 */
export function replayBattle({ team, stage, data, seed, actions }) {
  const battle = createBattle({ team, stage, data, seed });
  for (const a of actions) {
    if (battle.state.result) break;
    if (a.type === 'ult') battle.ultimate(a);
    else battle.act(a);
  }
  return battle;
}
