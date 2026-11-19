// 약화: 능력치 −pct% (받는 피해는 +pct%)
export function apply(b, ctx, src, tgt, eff) {
  const value = eff.stat === 'dmgTaken' ? eff.pct : -eff.pct;
  b.addStatus(ctx, src, tgt, { kind: 'debuff', stat: eff.stat, value, turns: eff.turns });
}
