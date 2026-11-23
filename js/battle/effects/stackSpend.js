// 자원(스택) 쓰기: n개 (0이면 전부). 같은 행동에서 앞에 둔 perStack 피해/치유는 쓰기 전 개수로 계산됨
export function apply(b, ctx, src, tgt, eff) {
  if (!tgt.res) return;
  b.addStacks(ctx, src, tgt, -(eff.n > 0 ? eff.n : tgt.res.value));
}
