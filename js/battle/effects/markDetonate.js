// 표식 터뜨리기: 대상에 붙은 시전자의 표식 개수 × 배율만큼 공격력 피해 → 표식 제거
import { apply as damage } from './damage.js';

export function apply(b, ctx, src, tgt, eff, power) {
  const n = b.marksFrom(src, tgt);
  if (!n) return;
  b.clearMarks(src, tgt);
  b.log({ t: 'detonate', src: src.uid, tgt: tgt.uid, n });
  damage(b, ctx, src, tgt, { mult: eff.mult * n, stat: 'atk', hits: 1 }, power);
}
