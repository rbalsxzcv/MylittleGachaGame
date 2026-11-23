// 보호막: 시전자 능력치 × (배율 + perStack × 자원) × (1 + 보호막 보너스). 겹치지 않고 더 큰 쪽을 남기며 지속 시간을 새로 고침
export function apply(b, ctx, src, tgt, eff, power) {
  const mult = eff.mult + (eff.perStack || 0) * (src.res?.value || 0);
  const value = Math.floor(b.stat(src, eff.stat || 'def') * mult * power * (1 + b.stat(src, 'shieldBonus')));
  if (value <= 0) return;
  const cur = tgt.shield;
  tgt.shield = { value: Math.max(value, cur?.value ?? 0), turns: eff.turns, fresh: b.isActor(tgt) };
  src.stats.shielded += value;
  b.log({ t: 'shield', src: src.uid, tgt: tgt.uid, amount: tgt.shield.value, turns: eff.turns });
}
