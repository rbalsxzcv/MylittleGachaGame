// 회귀 스냅샷용 기준 팀 (실제 캐릭터 id — id는 바뀌지 않음). 팀을 바꾸면 스냅샷도 다시 만들어야 해요
const five = (level, breakthrough) =>
  ['ssr_valeria', 'sr_1', 'r_garrick', 'npc_broker_baran', 'npc_baron_hendrik'].map((charId) => ({ charId, level, breakthrough }));

export const REFERENCE_TEAMS = [
  { name: 'Lv1', members: five(1, 0) },
  { name: 'Lv20+돌파2', members: five(20, 2) },
];

/** 스테이지마다 돌릴 시드 */
export const SNAPSHOT_SEEDS = [1, 2, 3];
