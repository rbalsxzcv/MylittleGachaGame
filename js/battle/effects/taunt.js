// 도발: 상대의 단일 대상 행동이 이 유닛을 노림
export function apply(b, ctx, src, tgt, eff) {
  tgt.taunt = { turns: eff.turns, fresh: b.isActor(tgt) };
  b.log({ t: 'taunt', src: src.uid, tgt: tgt.uid, turns: eff.turns });
}
