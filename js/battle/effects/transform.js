// 변신: turns턴 동안 키트의 transformed 칸(기본/스킬/궁극기)으로 바뀜. 자기 턴 끝에 −1, 끝나면 원래 키트
export function apply(b, ctx, src, tgt, eff) {
  b.setTransform(tgt, eff.turns);
}
