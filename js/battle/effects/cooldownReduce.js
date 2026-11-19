// 스킬 대기 시간 감소
export function apply(b, ctx, src, tgt, eff) {
  if (!tgt.kit.skill) return;
  const before = tgt.cd;
  tgt.cd = Math.max(0, tgt.cd - eff.n);
  b.log({ t: 'cooldown', src: src.uid, tgt: tgt.uid, n: before - tgt.cd });
}
