// 기력 획득 (음수면 감소). 0~최대 기력으로 잘림
export function apply(b, ctx, src, tgt, eff) {
  const before = tgt.energy;
  b.gainEnergy(tgt, eff.n);
  b.log({ t: 'energy', src: src.uid, tgt: tgt.uid, n: tgt.energy - before });
}
