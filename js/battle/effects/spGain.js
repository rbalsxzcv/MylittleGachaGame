// 팀 SP 획득 (음수면 감소). 대상이 속한 편의 SP가 바뀜 (적에게는 SP가 없어서 아무 일 없음)
export function apply(b, ctx, src, tgt, eff) {
  b.gainSp(tgt.side, eff.n, src);
}
