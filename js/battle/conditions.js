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
  // 자원 / 표식 / 변신 / SP (키트 아키타입용)
  stacks_at_least: (b, u, c) => (u.res?.value || 0) >= c.n,
  stacks_full: (b, u) => !!u.res && u.res.value >= u.res.cap,
  target_marked: (b, u, c, o) => !!o.target && o.target.alive && b.marksFrom(u, o.target) >= (c.n || 1),
  is_transformed: (b, u) => !!u.transform,
  sp_at_least: (b, u, c) => u.side === 'ally' && b.state.sp.ally >= c.n,
};
