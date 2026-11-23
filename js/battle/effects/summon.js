// 소환(간이): 아이콘만 있는 토큰. 자기 속도(spd)로 타임라인에서 actions번 행동하며 effects를 실행 (시전자 능력치 기준).
// 대상이 될 수 없고 시전자가 쓰러지면 사라짐
export function apply(b, ctx, src, tgt, eff) {
  b.addToken(src, { kind: 'summon', name: ctx.skillName || '소환', icon: eff.icon, spd: eff.spd, targeting: eff.targeting, effects: eff.effects, actions: eff.actions });
}
