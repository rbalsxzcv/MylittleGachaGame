// 정화: 약화 효과와 지속 피해를 모두 지움
export function apply(b, ctx, src, tgt) {
  const n = tgt.statuses.filter((s) => s.kind === 'debuff').length + tgt.dots.length;
  tgt.statuses = tgt.statuses.filter((s) => s.kind !== 'debuff');
  tgt.dots = [];
  b.log({ t: 'cleanse', src: src.uid, tgt: tgt.uid, n });
}
