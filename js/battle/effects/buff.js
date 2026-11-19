// 강화: 능력치 +pct% (받는 피해는 −pct%가 좋은 쪽이라 부호가 반대)
export function apply(b, ctx, src, tgt, eff) {
  const value = eff.stat === 'dmgTaken' ? -eff.pct : eff.pct;
  b.addStatus(ctx, src, tgt, { kind: 'buff', stat: eff.stat, value, turns: eff.turns });
}
