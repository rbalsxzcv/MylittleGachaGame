// 대상 지정 등록표: { pick, resolve(b, unit, opts) → 유닛 배열 }
//   pick: 'ally' | 'enemy' | null — 수동 조작에서 대상을 골라야 하는지
//   opts: { chosen, count, triggerTarget }

const ratio = (u) => u.hp / u.maxHp;

/** HP 비율이 가장 낮은 유닛 (같으면 앞쪽) */
export function lowestHpRatio(list) {
  let best = null;
  for (const u of list) if (!best || ratio(u) < ratio(best)) best = u;
  return best;
}

/** 현재 HP가 가장 낮은 유닛 (같으면 앞쪽) */
export function lowestHp(list) {
  let best = null;
  for (const u of list) if (!best || u.hp < best.hp) best = u;
  return best;
}

/** 도발 중인 상대가 있으면 그 유닛들만 */
export function tauntersOf(list) {
  return list.filter((u) => u.taunt);
}

function pickEnemy(b, u, chosen) {
  const opp = b.opponentsOf(u);
  const taunters = tauntersOf(opp);
  const pool = taunters.length ? taunters : opp;
  if (chosen && pool.includes(chosen)) return [chosen];
  return taunters.length ? [taunters[0]] : opp.length ? [lowestHp(opp)] : [];
}

function pickAlly(b, u, chosen) {
  const allies = b.alliesOf(u);
  if (chosen && allies.includes(chosen)) return [chosen];
  return allies.length ? [lowestHpRatio(allies)] : [];
}

export const TARGETING = {
  self: { pick: null, resolve: (b, u) => (u.alive ? [u] : []) },
  ally_single: { pick: 'ally', resolve: (b, u, o) => pickAlly(b, u, o.chosen) },
  ally_all: { pick: null, resolve: (b, u) => b.alliesOf(u) },
  ally_lowest_hp: { pick: null, resolve: (b, u) => pickAlly(b, u, null) },
  enemy_single: { pick: 'enemy', resolve: (b, u, o) => pickEnemy(b, u, o.chosen) },
  enemy_all: { pick: null, resolve: (b, u) => b.opponentsOf(u) },
  enemy_random_n: {
    pick: null,
    resolve: (b, u, o) => {
      const opp = b.opponentsOf(u);
      if (!opp.length) return [];
      const out = [];
      for (let i = 0; i < (o.count || 1); i++) out.push(opp[Math.floor(b.rng() * opp.length)]);
      return out;
    },
  },
  trigger_target: { pick: null, resolve: (b, u, o) => (o.triggerTarget?.alive ? [o.triggerTarget] : []) },
};

/** 수동 조작: 고를 수 있는 대상 uid 목록 (고를 필요 없으면 null) */
export function selectable(b, u, targeting) {
  const pick = TARGETING[targeting]?.pick;
  if (pick === 'enemy') {
    const opp = b.opponentsOf(u);
    const taunters = tauntersOf(opp);
    return { pick, uids: (taunters.length ? taunters : opp).map((x) => x.uid) };
  }
  if (pick === 'ally') return { pick, uids: b.alliesOf(u).map((x) => x.uid) };
  return null;
}
