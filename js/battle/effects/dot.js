// 지속 피해: 걸 때의 시전자 공격력 × 배율. 대상의 턴 시작마다 터짐 (방어/치명타 무시)
export function apply(b, ctx, src, tgt, eff, power) {
  const dmg = Math.max(1, Math.floor(b.stat(src, 'atk') * eff.mult * power));
  tgt.dots.push({ src: src.uid, dmg, turns: eff.turns });
  b.log({ t: 'dot', src: src.uid, tgt: tgt.uid, dmg, turns: eff.turns });
}
