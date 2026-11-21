// 테스트/시연용 샘플 캐릭터 — 실제 게임 데이터(data/characters.json)에는 넣지 않습니다.
// 1★~5★ 각 2명 + 은퇴(retired) 1명 + 스토리 전용(pullable:false) 1명

const mk = (id, name, rarity, extra = {}) => ({ id, name, rarity, title: '', description: '', image: '', addedAt: '2026-01-01T00:00:00+09:00', pullable: true, retired: false, ...extra });

export const SAMPLE_CHARACTERS = [
  mk('fx_c1_a', '견습 병사', 1),
  mk('fx_c1_b', '떠돌이 일꾼', 1),
  mk('fx_c2_a', '사냥꾼', 2),
  mk('fx_c2_b', '약초꾼', 2),
  mk('fx_r_a', '석궁잡이', 3),
  mk('fx_r_b', '방패병', 3),
  mk('fx_sr_a', '도적', 4),
  mk('fx_sr_b', '사제', 4),
  mk('fx_ssr_a', '성기사', 5, { nameEn: 'Paladin', themeColor: '#d9a441', quote: '밥값은 한다.' }),
  mk('fx_ssr_b', '대마법사', 5, { nameEn: 'Archmage', themeColor: '#6fb7ff', quote: '불꽃이여.' }),
  mk('fx_ssr_retired', '은퇴한 영웅', 5, { retired: true }),
  mk('fx_npc', '마을 사람', 3, { pullable: false }),
];

/** 희귀도별 id */
export const byRarity = (r) => SAMPLE_CHARACTERS.filter((c) => c.rarity === r && c.pullable && !c.retired);
