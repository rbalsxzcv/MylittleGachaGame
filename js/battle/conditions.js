// 패시브 발동 조건 등록표: (b, unit, cond, { target }) → true/false
const pct = (u) => (u.hp / u.maxHp) * 100;

export const CONDITIONS = {
  self_hp_below: (b, u, c) => pct(u) < c.pct,
  self_hp_above: (b, u, c) => pct(u) >= c.pct,
  target_hp_below: (b, u, c, o) => !!o.target && o.target.alive && pct(o.target) < c.pct,
  target_has_debuff: (b, u, c, o) => !!o.target && (o.target.dots.length > 0 || o.target.statuses.some((s) => s.kind === 'debuff')),
  enemies_alive_at_least: (b, u, c) => b.opponentsOf(u).length >= c.n,
  allies_alive_at_least: (b, u, c) => b.alliesOf(u).length >= c.n,
  round_at_least: (b, u, c) => b.state.round >= c.n,
  chance: (b, u, c) => b.rng() * 100 < c.pct,
};
