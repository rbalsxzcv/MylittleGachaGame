// 피해: S × 배율 × 100/(100+방어) × 치명타 × (1+주는 피해) × (1+받는 피해), 내림, 최소 1
// 배율 = mult + perStack × 시전자 자원 개수, × (1 + vsMarked% × 대상에 붙은 시전자 표식 개수)
// 타수(hits)마다 치명타를 따로 굴립니다. 보호막이 먼저 막아요.
export function apply(b, ctx, src, tgt, eff, power) {
  const hits = eff.hits || 1;
  const mult = (eff.mult + (eff.perStack || 0) * (src.res?.value || 0)) * (1 + ((eff.vsMarked || 0) / 100) * b.marksFrom(src, tgt));
  for (let i = 0; i < hits && tgt.alive; i++) {
    const S = b.stat(src, eff.stat || 'atk');
    const D = b.stat(tgt, 'def');
    const crit = b.rng() < b.stat(src, 'critRate');
    const critMul = crit ? 1 + b.stat(src, 'critDmg') : 1;
    const dealt = Math.max(0, 1 + b.stat(src, 'dmgDealt'));
    const taken = Math.max(0, 1 + b.stat(tgt, 'dmgTaken'));
    const amount = Math.max(1, Math.floor(S * mult * power * (100 / (100 + D)) * critMul * dealt * taken));
    b.hit(ctx, src, tgt, amount, crit);
  }
}
