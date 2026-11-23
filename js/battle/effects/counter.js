// 반격: 지금 행동이 끝난 뒤 시전자가 대상(보통 공격한 적)에게 능력치 × 배율 피해 (반응 큐, onHit 패시브에서)
export function apply(b, ctx, src, tgt, eff) {
  b.queueReaction({ kind: 'counter', uid: src.uid, target: tgt.uid, mult: eff.mult, stat: eff.stat || 'atk' });
}
