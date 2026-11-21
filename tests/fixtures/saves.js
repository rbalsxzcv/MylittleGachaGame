// 세이브 마이그레이션 테스트용 예전 세이브 (JSON 그대로의 모양)

/** v1: 중복은 count로만 기록, 희귀도는 데이터 쪽 (R/SR/SSR → 지금은 3/4/5) */
export const SAVE_V1 = {
  v: 1,
  gems: 500,
  createdAt: '2026-11-01T10:00:00+09:00',
  lastLoginDate: '2026-11-10',
  owned: {
    fx_ssr_a: { count: 9, firstAt: '2026-11-01T10:05:00+09:00' }, // 중복 8 → 정수 5 + 넘침 3 × 200 = 600 티켓
    fx_sr_a: { count: 2, firstAt: '2026-11-01T10:06:00+09:00' }, // 중복 1 → 정수 1
    fx_r_a: { count: 7, firstAt: '2026-11-01T10:07:00+09:00' }, // 중복 6 → 정수 5 + 넘침 1 × 30 = 30 티켓
    deleted_char: { count: 3, firstAt: '2026-11-01T10:08:00+09:00' }, // 데이터에 없는 id → 지우지 않음 (3★ 기준 환산)
  },
  pity: { standard: 12, pickup: 3 },
  guaranteed: { pickup: true },
  stats: { pulls: 40 },
};

/** v2: 정수/돌파/레벨이 있음, settings 없음 */
export const SAVE_V2 = {
  v: 2,
  gems: 1200,
  createdAt: '2026-11-01T10:00:00+09:00',
  lastLoginDate: '2026-11-20',
  owned: {
    fx_ssr_a: { level: 12, essence: 1, breakthrough: 2, count: 4, firstAt: '2026-11-01T10:05:00+09:00' },
    ghost_id: { level: 3, essence: 0, breakthrough: 0, count: 1, firstAt: '2026-11-01T10:05:00+09:00' },
  },
  pity: { standard: 33, pickup: 0 },
  guaranteed: { pickup: false },
  tickets: 777,
  gold: 12345,
  teams: { active: 1, presets: [{ name: '주력', slots: ['fx_ssr_a', null, null, null, null] }, { name: '두 번째', slots: [] }] },
  stages: { st_01_04: { clears: 2, firstClaimed: true, bestRounds: 5 } },
};
