// 차단: 대상(적)이 예고한 큰 공격(big)을 취소 → 그 차례는 '흐트러짐'으로 아무것도 못 함
// 예고가 큰 공격이 아니면, 대상이 놓은 큰 차지(big charge 토큰)를 대신 끊음. 둘 다 없으면 효과 없음 (기록만 남김)
export function apply(b, ctx, src, tgt) {
  const it = tgt.intent;
  let ok = !!it && it.big && !it.interrupted;
  if (ok) it.interrupted = true;
  else ok = b.interruptToken(tgt);
  b.log({ t: 'interrupt', src: src.uid, tgt: tgt.uid, ok });
}
