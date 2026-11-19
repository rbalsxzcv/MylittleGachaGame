// 치유: 시전자 능력치 × 배율 (최대 HP까지)
export function apply(b, ctx, src, tgt, eff, power) {
  b.heal(ctx, src, tgt, Math.floor(b.stat(src, eff.stat || 'atk') * eff.mult * power));
}
