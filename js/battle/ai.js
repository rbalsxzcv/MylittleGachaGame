// 자동 전투 AI (아군 AUTO, 개발 도구 시뮬레이터). 적은 패턴(예고)대로 움직여서 여기 없음
//
// 궁극기 (아군 입력 중, 준비된 아군마다):
//   - 피해가 있는 궁극기: 적이 큰 공격(big)을 예고 중이거나, 이 궁극기로 적을 쓰러뜨릴 수 있으면 사용
//   - 피해가 없는 궁극기(치유/보호막/강화): 큰 공격 예고 중이거나 HP 50% 미만 아군이 있으면 사용
// 지금 차례 아군:
//   - 스킬: SP를 낼 수 있고 (SP ≥ 2 이거나, 치유/보호막 스킬인데 HP 50% 미만 아군이 있으면)
//   - 아니면 기본 공격
// 대상: 적 1명은 도발 중인 적 → 이 행동으로 쓰러뜨릴 수 있는 적(HP 낮은 순) → HP가 가장 낮은 적
//       아군 1명은 HP 비율이 가장 낮은 아군
// 행동에 useIf(조건 목록)가 있으면 그 조건이 맞을 때 씀 (예: 자원이 가득할 때 스킬). 스킬은 SP가 가득이면 조건과 상관없이 씀
import { TARGETING, lowestHp, lowestHpRatio, tauntersOf } from './targeting.js';

const HURT = 0.5;
const hasType = (skill, types) => !!skill?.effects.some((e) => types.includes(e.type));
const hasDamage = (skill) => hasType(skill, ['damage']);
const isSupport = (skill) => hasType(skill, ['heal', 'shield']);
const anyHurt = (b, u) => b.alliesOf(u).some((x) => x.hp / x.maxHp < HURT);
const bigIncoming = (b, u) => b.opponentsOf(u).some((e) => e.intent?.big && !e.intent.interrupted);

/** 치명타 없이 계산한 예상 피해 (피해 효과만) */
export function estimateDamage(b, src, tgt, skill) {
  let sum = 0;
  for (const e of skill.effects) {
    if (e.type !== 'damage' || (e.target && !e.target.startsWith('enemy'))) continue;
    const S = b.stat(src, e.stat || 'atk');
    const D = b.stat(tgt, 'def');
    const dealt = Math.max(0, 1 + b.stat(src, 'dmgDealt'));
    const taken = Math.max(0, 1 + b.stat(tgt, 'dmgTaken'));
    sum += Math.max(1, Math.floor(S * e.mult * b.mitigation(src, D) * dealt * taken)) * (e.hits || 1);
  }
  return sum;
}

const killable = (b, u, skill, t) => estimateDamage(b, u, t, skill) >= t.hp + (t.shield?.value || 0);

/** 행동의 대상 고르기 → uid 또는 null (고를 필요 없음) */
export function targetFor(b, u, skill) {
  const pick = TARGETING[skill.targeting]?.pick;
  if (pick === 'enemy') {
    const opp = b.opponentsOf(u);
    const taunt = tauntersOf(opp);
    if (taunt.length) return taunt[0].uid;
    const kills = opp.filter((t) => killable(b, u, skill, t)).sort((a, c) => a.hp - c.hp);
    return (kills[0] || lowestHp(opp))?.uid ?? null;
  }
  if (pick === 'ally') return lowestHpRatio(b.alliesOf(u))?.uid ?? null;
  return null;
}

/** 이 궁극기로 적을 쓰러뜨릴 수 있는지 (단일이면 고른 대상, 광역이면 아무나) */
function ultimateKills(b, u, skill) {
  const opp = b.opponentsOf(u);
  if (TARGETING[skill.targeting]?.pick === 'enemy') {
    const t = b.unitOf(targetFor(b, u, skill));
    return !!t && killable(b, u, skill, t);
  }
  if (skill.targeting === 'enemy_all') return opp.some((t) => killable(b, u, skill, t));
  return false;
}

/** 지금 쓸 궁극기들 → [{ uid, target }] (칸 순서) */
export function chooseUltimates(b) {
  const out = [];
  const allies = b.state.allies.filter((a) => a.alive && b.canUse(a, 'ultimate'));
  for (const a of allies) {
    const ult = a.kit.ultimate;
    const target = targetFor(b, a, ult);
    let use;
    if (ult.useIf?.length) use = b.check(a, ult.useIf, b.unitOf(target));
    else {
      const big = bigIncoming(b, a);
      use = hasDamage(ult) ? big || ultimateKills(b, a, ult) : big || anyHurt(b, a) || !isSupport(ult);
    }
    if (use) out.push({ uid: a.uid, target });
  }
  return out;
}

/** 지금 차례 아군의 기본 공격/스킬 → { action, target } */
export function chooseAction(b, u) {
  const skill = u.kit.skill;
  if (skill && b.canUse(u, 'skill')) {
    const target = targetFor(b, u, skill);
    if (skill.useIf?.length) {
      if (b.check(u, skill.useIf, b.unitOf(target)) || b.state.sp.ally >= b.state.spMax) return { action: 'skill', target };
    } else {
      const need = isSupport(skill) && anyHurt(b, u);
      if (b.state.sp.ally >= 2 || need) return { action: 'skill', target };
    }
  }
  return { action: 'basic', target: targetFor(b, u, u.kit.basic) };
}
