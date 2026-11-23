// 자원(스택) 얻기: 대상의 자원 +n (상한까지). 자원이 없는 유닛이면 아무 일 없음. 가득 차면 onStackFull 발동 (행동 끝에 한 번)
export function apply(b, ctx, src, tgt, eff) {
  b.addStacks(ctx, src, tgt, eff.n);
}
