// 차지: 타임라인에 토큰을 놓음 → 시전자의 한 턴 × delayPct% 뒤에 effects 실행 (대상: targeting).
// big이면 큰 공격 예고처럼 표시되고 차단(interrupt)으로 끊을 수 있음. 시전자가 쓰러지면 사라짐
export function apply(b, ctx, src, tgt, eff) {
  b.addToken(src, { kind: 'charge', name: ctx.skillName || '차지', delayPct: eff.delayPct, targeting: eff.targeting, effects: eff.effects, big: eff.big === 'big', actions: 1 });
}
