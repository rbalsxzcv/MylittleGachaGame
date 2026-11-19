// 보호막: 시전자 능력치 × 배율. 겹치지 않고 더 큰 쪽을 남기며 지속 시간을 새로 고침
export function apply(b, ctx, src, tgt, eff, power) {
  const value = Math.floor(b.stat(src, eff.stat || 'def') * eff.mult * power);
  if (value <= 0) return;
  const cur = tgt.shield;
  tgt.shield = { value: Math.max(value, cur?.value ?? 0), turns: eff.turns, fresh: b.isActor(tgt) };
  src.stats.shielded += value;
  b.log({ t: 'shield', src: src.uid, tgt: tgt.uid, amount: tgt.shield.value, turns: eff.turns });
}
