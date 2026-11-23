// 추가 공격: 지금 행동이 끝난 뒤 시전자가 대상에게 능력치 × 배율 피해 (턴/SP를 쓰지 않음, 반응 큐)
// 보통 패시브(onAllyAttack, 발동 대상)에 넣음. 반응은 다른 발동 조건을 부르지 않아요 (무한 반복 방지)
export function apply(b, ctx, src, tgt, eff) {
  b.queueReaction({ kind: 'follow_up', uid: src.uid, target: tgt.uid, mult: eff.mult, stat: eff.stat || 'atk' });
}
