// 자동 전투 AI (아군·적 공용)
// 1) 아군 중 HP 50% 미만이 있고, 쓸 수 있는 행동에 치유가 있으면 → 그 행동으로 HP 비율이 가장 낮은 아군
// 2) 궁극기 → 3) 스킬 → 4) 기본 공격
// 대상: 적 1명은 도발 중인 적 → 없으면 현재 HP가 가장 낮은 적 / 아군 1명은 HP 비율이 가장 낮은 아군
import { TARGETING, lowestHp, lowestHpRatio, tauntersOf } from './targeting.js';

const ORDER = ['ultimate', 'skill', 'basic'];

const hasHeal = (skill) => !!skill?.effects.some((e) => e.type === 'heal');

function targetFor(b, u, skill) {
  const pick = TARGETING[skill.targeting]?.pick;
  if (pick === 'enemy') {
    const opp = b.opponentsOf(u);
    const t = tauntersOf(opp);
    return (t[0] || lowestHp(opp))?.uid ?? null;
  }
  if (pick === 'ally') return lowestHpRatio(b.alliesOf(u))?.uid ?? null;
  return null;
}

/** → { action, target } */
export function chooseAction(b, u) {
  const ready = ORDER.filter((a) => b.canUse(u, a));
  if (!ready.length) return { action: 'basic', target: null };
  const hurt = b.alliesOf(u).some((x) => x.hp / x.maxHp < 0.5);
  if (hurt) {
    for (const a of ready) {
      if (hasHeal(u.kit[a])) return { action: a, target: targetFor(b, u, u.kit[a]) };
    }
  }
  const a = ready[0];
  return { action: a, target: targetFor(b, u, u.kit[a]) };
}
