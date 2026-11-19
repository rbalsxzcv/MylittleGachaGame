// 전투 엔진 — 턴제, 시드 난수로 완전히 재현 가능 (같은 시드 + 같은 행동 = 같은 결과)
// DOM, Date, Math.random을 쓰지 않습니다. 게임 화면과 개발 도구 시뮬레이터가 같이 씁니다.
//
// 진행: 라운드마다 아군 1→5번, 그다음 적(웨이브 순서). 쓰러진 유닛은 건너뜀.
//   - 지속 시간(버프/보호막/도발)은 '가진 유닛의 턴이 끝날 때' 1 줄어듦.
//     자기 턴 중에 받은 효과는 그 턴에는 줄지 않음 → turns: 2 = 자기 턴 2번 동안
//   - 스킬 대기: 사용하면 cd = cooldown, 다음 자기 턴들이 끝날 때마다 1 감소
//   - 지속 피해: 가진 유닛의 턴 시작에 터지고 1 감소
//   - 패시브에서 나온 효과는 다른 발동 조건을 다시 부르지 않음 (무한 반복 방지)

import { createRng } from '../core/rng.js';
import { buildUnit } from './units.js';
import { EFFECTS } from './effects/index.js';
import { TARGETING, selectable } from './targeting.js';
import { CONDITIONS } from './conditions.js';
import { MODIFIERS } from './modifiers.js';
import { chooseAction } from './ai.js';

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

/**
 * 전투 만들기
 * @param {object} o
 * @param {Array<{charId:string, level:number, breakthrough:number}|null>} o.team 최대 5칸 (빈 칸은 null)
 * @param {{waves:Array<Array<{enemyId:string, level:number}>>, turnLimit?:number|null}} o.stage
 * @param {{charMap:Map, enemyMap:Map, balance:object}} o.data
 * @param {number} o.seed
 */
export function createBattle({ team, stage, data, seed = 1 }) {
  const { balance } = data;
  const rng = createRng(seed);
  const state = {
    seed: seed >>> 0,
    round: 1,
    turnLimit: stage.turnLimit || null,
    maxRounds: balance.maxRounds || 200,
    wave: -1,
    waveCount: stage.waves.length,
    allies: [],
    enemies: [],
    cursor: { side: 'ally', i: 0 },
    actorUid: null,
    pendingUid: null,
    result: null, // 'win' | 'lose'
    reason: null, // 'wipe' | 'timeout'
    events: [],
    actions: [], // 아군 결정 기록 (리플레이용)
  };

  const log = (ev) => state.events.push(ev);
  const all = () => [...state.allies, ...state.enemies];
  const registry = new Map(); // 지난 웨이브 적까지 모든 유닛 (기록의 이름 표시용)
  const unitOf = (uid) => registry.get(uid) || null;
  const alliesOf = (u) => (u.side === 'ally' ? state.allies : state.enemies).filter((x) => x.alive);
  const opponentsOf = (u) => (u.side === 'ally' ? state.enemies : state.allies).filter((x) => x.alive);

  /** 전투 중 실제 능력치 (버프/약화 반영) */
  function stat(u, key) {
    const sum = u.statuses.reduce((acc, s) => (s.stat === key ? acc + s.value : acc), 0);
    if (key === 'atk' || key === 'def') return Math.max(0, Math.floor(u.base[key] * (1 + sum / 100)));
    if (key === 'hp') return u.maxHp;
    if (key === 'critRate' || key === 'critDmg') return Math.max(0, u.base[key] + sum / 100);
    return sum / 100; // dmgDealt / dmgTaken (기본 0)
  }

  function gainEnergy(u, n) {
    if (!u.alive || !n) return;
    u.energy = Math.min(balance.energy.max, Math.max(0, u.energy + n));
  }

  function kill(ctx, tgt, src) {
    tgt.alive = false;
    tgt.hp = 0;
    tgt.statuses = [];
    tgt.dots = [];
    tgt.shield = null;
    tgt.taunt = null;
    log({ t: 'death', uid: tgt.uid, by: src?.uid ?? null });
    ctx?.kills.push(tgt);
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
    isActor: (u) => state.actorUid === u.uid,
    canUse: (u, a) => canUse(u, a),
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
      log({ t: 'status', src: src.uid, tgt: tgt.uid, kind, stat: key, value, turns });
    },
  };

  // ── 웨이브 ──
  function spawnWave(i) {
    state.wave = i;
    state.enemies = (stage.waves[i] || [])
      .map((e, j) => {
        const entity = data.enemyMap.get(e.enemyId);
        return entity ? buildUnit({ entity, level: e.level || 1, side: 'enemy', slot: j, uid: `w${i + 1}e${j + 1}`, balance }) : null;
      })
      .filter(Boolean);
    for (const u of state.enemies) registry.set(u.uid, u);
    log({ t: 'wave', wave: i + 1, total: state.waveCount, uids: state.enemies.map((u) => u.uid) });
    // 적 차례 중에 나온 새 웨이브는 다음 라운드부터 행동
    if (state.cursor.side === 'enemy') state.cursor.i = state.enemies.length;
    for (const u of state.enemies) firePassives(u, 'onBattleStart', {});
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

  /** HP가 기준 아래로 내려갔는지 확인 (내려가는 순간 한 번, 다시 올라가면 재무장) */
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

  function canUse(u, action) {
    const s = u.kit[action];
    if (!s || !u.alive) return false;
    if (action === 'skill') return u.cd <= 0;
    if (action === 'ultimate') return u.energy >= u.ultCost;
    return true;
  }

  function perform(u, action, targetUid) {
    if (!canUse(u, action)) action = 'basic';
    const skill = u.kit[action];
    if (action === 'ultimate') u.energy = Math.max(0, u.energy - u.ultCost);
    log({ t: 'action', uid: u.uid, action, name: skill.name });
    const ctx = newCtx(u, action, action);
    const chosen = targetUid ? unitOf(targetUid) : null;
    const primary = resolve(u, skill.targeting, { chosen, count: skill.count });
    for (const eff of skill.effects) applyEffect(ctx, u, eff, primary, chosen);
    if (action === 'basic') gainEnergy(u, u.energyGain.basic);
    if (action === 'skill') {
      gainEnergy(u, u.energyGain.skill);
      u.cd = skill.cooldown || 0;
      u.cdFresh = u.cd > 0;
    }
    // 발동 조건 (행동에서 나온 것만)
    const first = primary.find(Boolean) || null;
    firePassives(u, ACTION_TRIGGER[action], { triggerTarget: first });
    if (ctx.crit) firePassives(u, 'onCrit', { triggerTarget: ctx.critTarget ?? first });
    for (const k of ctx.kills) if (k.side !== u.side) firePassives(u, 'onKill', { triggerTarget: k });
    for (const h of ctx.hits) if (h.tgt.alive && h.tgt !== u) firePassives(h.tgt, 'onHit', { triggerTarget: h.src });
    checkHpBelow();
    checkEnd();
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
    if (u.cdFresh) u.cdFresh = false;
    else if (u.cd > 0) u.cd -= 1;
  }

  /** 다음에 행동할 유닛 (라운드 넘김, 턴 제한 판정 포함) */
  function nextActor() {
    const c = state.cursor;
    for (let guard = 0; guard < 8; guard++) {
      const list = c.side === 'ally' ? state.allies : state.enemies;
      while (c.i < list.length) {
        const u = list[c.i++];
        if (u.alive) return u;
      }
      if (c.side === 'ally') {
        c.side = 'enemy';
        c.i = 0;
        continue;
      }
      if ((state.turnLimit && state.round >= state.turnLimit) || state.round >= state.maxRounds) {
        end('lose', 'timeout');
        return null;
      }
      state.round += 1;
      log({ t: 'round', round: state.round });
      c.side = 'ally';
      c.i = 0;
    }
    return null;
  }

  /** 아군의 결정이 필요하거나 전투가 끝날 때까지 진행 */
  function proceed() {
    for (let guard = 0; guard < 100000 && !state.result && !state.pendingUid; guard++) {
      const u = nextActor();
      if (!u) continue;
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
      const choice = chooseAction(b, u);
      perform(u, choice.action, choice.target);
      endTurn(u);
    }
  }

  // ── 시작 ──
  state.allies = team
    .map((m, slot) => {
      if (!m) return null;
      const entity = data.charMap.get(m.charId);
      return entity ? buildUnit({ entity, level: m.level || 1, breakthrough: m.breakthrough || 0, side: 'ally', slot, uid: `a${slot + 1}`, balance }) : null;
    })
    .filter(Boolean);
  for (const u of state.allies) registry.set(u.uid, u);
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
    /** 현재 아군이 쓸 수 있는 행동 */
    options() {
      const u = api.current();
      if (!u) return null;
      const opt = (a) => u.kit[a] && { name: u.kit[a].name, ok: canUse(u, a), targeting: u.kit[a].targeting };
      return {
        uid: u.uid,
        basic: opt('basic'),
        skill: u.kit.skill && { ...opt('skill'), cd: u.cd },
        ultimate: u.kit.ultimate && { ...opt('ultimate'), energy: u.energy, cost: u.ultCost },
      };
    },
    /** 행동의 대상 선택지 → { pick, uids } 또는 null(고를 필요 없음) */
    targets(action) {
      const u = api.current();
      return u?.kit[action] ? selectable(b, u, u.kit[action].targeting) : null;
    },
    /** 현재 아군의 행동 → 다음 결정 지점까지 진행. 이번에 생긴 이벤트 반환 */
    act({ action, target = null }) {
      const u = api.current();
      if (!u) return [];
      const from = state.events.length;
      state.actions.push({ action, target });
      state.pendingUid = null;
      perform(u, action, target);
      endTurn(u);
      proceed();
      return state.events.slice(from);
    },
    /** AI가 현재 아군 행동을 고름 */
    auto() {
      const u = api.current();
      return u ? api.act(chooseAction(b, u)) : [];
    },
    /** 끝까지 자동 진행 */
    runToEnd() {
      const from = state.events.length;
      for (let guard = 0; guard < 100000 && !state.result; guard++) api.auto();
      return state.events.slice(from);
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
  };
  return api;
}

/** 리플레이: 같은 시드 + 같은 결정 → 같은 결과 */
export function replayBattle({ team, stage, data, seed, actions }) {
  const battle = createBattle({ team, stage, data, seed });
  for (const a of actions) {
    if (battle.state.result) break;
    battle.act(a);
  }
  return battle;
}
