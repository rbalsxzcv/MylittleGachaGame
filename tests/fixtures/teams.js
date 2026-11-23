// 회귀 스냅샷용 기준 팀 (실제 캐릭터 id — id는 바뀌지 않음). 팀을 바꾸면 스냅샷도 다시 만들어야 해요
// 탱커(아이린) · 딜러 2(발레리아, 시논) · 치유(안나) · 지원(레일라) — 역할을 섞어서 키트 메커니즘이 다 돌아가게
const five = (level, breakthrough) =>
  ['char_0012', 'char_0002', 'char_0001', 'char_0006', 'char_0011'].map((charId) => ({ charId, level, breakthrough }));

export const REFERENCE_TEAMS = [
  { name: 'Lv1', members: five(1, 0) },
  { name: 'Lv20+돌파2', members: five(20, 2) },
  // 장착품까지: 역할 기본 추억 Lv.16 R2 + 장비 4칸 T2+2 (snapshot.js가 데이터로 풀어 줌)
  { name: 'Lv30+돌파3+장비', members: five(30, 3).map((m) => ({ ...m, equip: { memory: 'default', memoryLevel: 16, refine: 2, gear: { tier: 2, enh: 2 } } })) },
];

/** 스테이지마다 돌릴 시드 */
export const SNAPSHOT_SEEDS = [1, 2, 3];
