// 치유: 시전자 능력치 × (배율 + perStack × 자원) × (1 + 치유 보너스) (최대 HP까지)
export function apply(b, ctx, src, tgt, eff, power) {
  const mult = eff.mult + (eff.perStack || 0) * (src.res?.value || 0);
  b.heal(ctx, src, tgt, Math.floor(b.stat(src, eff.stat || 'atk') * mult * power * (1 + b.stat(src, 'healBonus'))));
}
