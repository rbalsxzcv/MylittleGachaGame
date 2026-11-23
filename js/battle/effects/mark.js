// 표식: 대상에게 시전자의 표식 +1 (최대 max개), 지속 시간 새로 고침. 대상의 턴 끝에 −1턴, 쓰러지면 사라짐
// 상대에게 거는 효과라 효과 적중/저항 판정을 받음 (engine applyEffect)
export function apply(b, ctx, src, tgt, eff) {
  b.addMark(src, tgt, eff.turns, eff.max);
}
