// 기존 캐릭터 일괄 배정 (계획서 9 "Batch bootstrap") — 설정/소개 문구를 보고 정한 역할 · 아키타입, 한 아키타입에 한 명
// 새 캐릭터는 개발 도구가 덜 쓰인 아키타입을 추천 (generate.suggestArchetype)
export const BOOTSTRAP = {
  char_0002: { role: 'attacker', archetype: 'stack_burst' }, // 발레리아 — 파문당한 성기사, 대검 한 방
  char_0008: { role: 'attacker', archetype: 'transform_carry' }, // 이레나 — 흑마법, 악마 소환
  char_0012: { role: 'defender', archetype: 'counter_tank' }, // 아이린 — 호위기사
  char_0007: { role: 'support', archetype: 'sp_battery' }, // 루미 — 살림꾼, '돈 주는 사람'
  char_0001: { role: 'attacker', archetype: 'mark_hunter' }, // 시논 — 도적 소녀
  char_0006: { role: 'healer', archetype: 'sustain_healer' }, // 안나 — 셰프
  char_0011: { role: 'support', archetype: 'timeline' }, // 레일라 — 계산 속도
  char_0003: { role: 'attacker', archetype: 'follow_up' }, // 가린 — 석궁 사수
  char_0004: { role: 'support', archetype: 'dot_spreader' }, // 바바루아 — 시궁창 정보상
  char_0009: { role: 'defender', archetype: 'shield_converter' }, // 뜨내기 용병
};
