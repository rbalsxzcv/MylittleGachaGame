// 행동 당기기: 남은 행동 수치 −(pct% × 대상의 한 턴 길이). 0 아래로는 안 내려감
export function apply(b, ctx, src, tgt, eff) {
  b.shiftAction(tgt, -eff.pct, src);
}
