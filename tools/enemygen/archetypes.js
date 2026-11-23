// 적 아키타입 8종 — 적 생성기(generate.js)의 템플릿 (데이터만, AI 없음)
// 능력치 = balance.enemy.base × balance.enemy.archetypes[아키타입] (레벨 성장은 캐릭터와 같음), 스테이지 difficulty는 엔진이 곱함
// 행동: 칸(basic/skill/ultimate)마다 기존 행동의 아이콘에 맞는 템플릿 (없으면 default) → 행동 id · 이름 · 아이콘은 그대로, 효과만 새로
// pattern: 행동 id 순서 (적에게 있는 행동만 남김), target = 대상 규칙
const dmg = (mult, extra = {}) => ({ type: 'damage', mult, stat: 'atk', hits: 1, ...extra });
const single = (effects, extra = {}) => ({ targeting: 'enemy_single', effects, ...extra });
const all = (effects, extra = {}) => ({ targeting: 'enemy_all', effects, ...extra });

export const ENEMY_TEMPLATES = {
  grunt: {
    label: '잡몹',
    slots: {
      basic: { default: single([dmg(1)]) },
      skill: { default: single([dmg(1.5)]), aoe: all([dmg(0.7)]) },
      ultimate: { default: all([dmg(1.2)], { big: true }) },
    },
    pattern: [{ action: 'basic' }, { action: 'basic' }, { action: 'skill' }],
  },
  brute: {
    label: '중장',
    slots: {
      basic: { default: single([dmg(1.25)]) },
      skill: { default: single([dmg(2)], { big: true }), buff: { targeting: 'self', effects: [{ type: 'buff', stat: 'def', pct: 30, turns: 2 }, { type: 'taunt', turns: 1 }] } },
      ultimate: { default: all([dmg(1.4)], { big: true }) },
    },
    pattern: [{ action: 'skill' }, { action: 'basic' }, { action: 'basic' }],
  },
  caster: {
    label: '술사',
    slots: {
      basic: { default: single([dmg(0.9), { type: 'dot', mult: 0.25, turns: 2 }]) },
      skill: {
        default: single([dmg(1.2), { type: 'debuff', stat: 'effectRes', pct: 15, turns: 2 }, { type: 'dot', mult: 0.35, turns: 2 }]),
        aoe: all([dmg(0.55), { type: 'dot', mult: 0.3, turns: 2 }]),
      },
      ultimate: { default: all([dmg(1.1)], { big: true }) },
    },
    pattern: [{ action: 'basic' }, { action: 'skill' }],
  },
  healer: {
    label: '치유사',
    slots: {
      basic: { default: single([dmg(0.8)]) },
      skill: { default: { targeting: 'ally_lowest_hp', effects: [{ type: 'heal', mult: 1.4, stat: 'atk' }] } },
      ultimate: { default: { targeting: 'ally_all', effects: [{ type: 'heal', mult: 0.8, stat: 'atk' }] } },
    },
    pattern: [{ action: 'basic' }, { action: 'skill' }],
  },
  shielder: {
    label: '방패병',
    slots: {
      basic: { default: single([dmg(0.9)]) },
      skill: { default: { targeting: 'ally_all', effects: [{ type: 'shield', mult: 1.2, stat: 'def', turns: 2 }, { type: 'taunt', turns: 1, target: 'self' }] } },
      ultimate: { default: all([dmg(1)], { big: true }) },
    },
    pattern: [{ action: 'skill' }, { action: 'basic' }, { action: 'basic' }],
  },
  assassin: {
    label: '암살자',
    slots: {
      basic: { default: single([dmg(0.6, { hits: 2 })]) },
      skill: { default: single([dmg(1.8)]), aoe: { targeting: 'enemy_random_n', count: 2, effects: [dmg(0.9)] } },
      ultimate: { default: single([dmg(2.4)], { big: true }) },
    },
    pattern: [
      { action: 'basic', target: 'lowest_hp' },
      { action: 'basic', target: 'lowest_hp' },
      { action: 'skill', target: 'lowest_hp' },
    ],
  },
  elite: {
    label: '정예',
    slots: {
      basic: { default: single([dmg(1.1)]) },
      skill: { default: single([dmg(1.6), { type: 'debuff', stat: 'def', pct: 15, turns: 2 }]), aoe: all([dmg(0.8), { type: 'debuff', stat: 'atk', pct: 10, turns: 2 }]) },
      ultimate: { default: all([dmg(1.4)], { big: true }) },
    },
    pattern: [{ action: 'basic' }, { action: 'skill' }, { action: 'basic' }, { action: 'ultimate' }],
    passives: [{ name: '분노', trigger: 'onHpBelow', pct: 50, targeting: 'self', limit: 1, effects: [{ type: 'buff', stat: 'atk', pct: 25, turns: 3 }] }],
  },
  boss: {
    label: '보스',
    slots: {
      basic: { default: single([dmg(1.1)]) },
      skill: { default: single([dmg(1.5), { type: 'debuff', stat: 'def', pct: 15, turns: 2 }]), aoe: all([dmg(0.8), { type: 'dot', mult: 0.3, turns: 2 }]) },
      // 큰 공격 = 차지: 예고(차단 가능) → 시전하면 반 턴 뒤 터지는 큰 차지 토큰(이것도 차단 가능)
      ultimate: { default: { targeting: 'self', big: true, effects: [{ type: 'charge', delayPct: 50, big: 'big', targeting: 'enemy_all', effects: [dmg(1.8)] }] } },
    },
    pattern: [{ action: 'basic' }, { action: 'skill' }, { action: 'basic' }, { action: 'ultimate' }],
    phases: [{ hpBelow: 50, pattern: [{ action: 'skill' }, { action: 'ultimate' }, { action: 'basic' }], enterEffects: [{ type: 'buff', stat: 'atk', pct: 20, turns: 3 }, { type: 'shield', mult: 2, stat: 'def', turns: 2 }] }],
    enrage: { round: 15, effects: [{ type: 'buff', stat: 'atk', pct: 50, turns: 20 }] },
    passives: [{ name: '분노', trigger: 'onHpBelow', pct: 30, targeting: 'self', limit: 1, effects: [{ type: 'heal', mult: 0.08, stat: 'hp' }] }],
  },
};

/** 기존 적 배정 (계획서 8 — 이름/행동으로 고름) */
export const ENEMY_BOOTSTRAP = {
  enemy_0001: 'grunt', // 시체 약탈꾼
  enemy_0002: 'assassin', // 역병 사냥개 (빠름)
  enemy_0003: 'grunt', // 탈영병 창병
  enemy_0004: 'brute', // 남작 근위대 중장병 (철벽 방진)
  enemy_0005: 'boss', // 탐욕의 헨드릭 남작
  enemy_0006: 'caster', // 광휘교단 이단 사냥꾼 (정화의 낙인)
  enemy_0007: 'grunt', // 숙부파 사설 경비병
  enemy_0008: 'shielder', // 이웃 영지 정규 방패병
  enemy_0009: 'caster', // 약탈 부대 방화범 (기름병)
  enemy_0010: 'elite', // 강철송곳니 용병대장
  enemy_0011: 'boss', // 발도르프 버스튼
};
