// 핵심 메커니즘 아키타입 10종 — 키트 생성기(generate.js)의 템플릿 (데이터만, AI 없음)
// 게임(js/)은 이 파일을 읽지 않음. 생성 결과가 characters.json에 저장되고 게임은 그걸 씀.
//
// 형식
//   S(id, base, min, max, step) = 숫자 칸. 예산 계산기(budget.js)가 한 묶음(스킬 하나/패시브 하나)의 칸을 같은 배율로 키우거나 줄여서
//                                 희귀도 상한 ±5%에 맞춤. 칸이 아닌 숫자는 그대로.
//   스킬 템플릿   { names[], blurb, targeting, count?, effects[], useIf? }
//   패시브 템플릿 { names[], blurb, trigger?, pct?, conditions?, targeting?, count?, effects?, modifiers?, limit?, perRound? }
//   변형          { id, label, passive }        (bt2 ≥3, bt6 ≥3)
//   전용 추억     { id, label, generic, owner } (≥2) — generic은 누가 장착해도, owner는 이 아키타입 주인이 장착했을 때만
//   blurb의 {res} = 자원 이름
export const S = (id, base, min, max, step = 0.05) => ({ $: id, base, min, max, step });

const dmg = (mult, extra = {}) => ({ type: 'damage', mult, stat: 'atk', hits: 1, ...extra });
const self = { target: 'self' };

export const ARCHETYPES = [
  // 1 ── 스택 폭발: 자원을 모았다가 스킬로 한 번에
  {
    id: 'stack_burst',
    no: 1,
    label: '스택 폭발',
    roles: ['attacker', 'defender'],
    resource: { names: ['투지', '기세', '분노'], cap: 5, start: 0, rule: '기본 공격·피격으로 얻고 스킬에서 전부 씀' },
    basic: { names: ['대검 베기', '내려치기', '돌진 베기'], blurb: '베면서 {res}을(를) 모아요.', targeting: 'enemy_single', effects: [dmg(S('m', 1, 0.3, 1.6)), { type: 'stack_gain', n: 1, ...self }] },
    skill: {
      names: ['분쇄 일격', '대검 해방', '참격 폭발'],
      blurb: '모은 {res}을(를) 전부 터뜨려 큰 피해를 줘요.',
      targeting: 'enemy_single',
      effects: [dmg(S('m', 1.2, 0.6, 3), { perStack: S('p', 0.25, 0.1, 0.6) }), { type: 'stack_spend', n: 0, ...self }],
      useIf: [{ type: 'stacks_at_least', n: 3 }],
    },
    ultimate: { names: ['폭렬 참', '심판의 대검', '끝없는 투지'], blurb: '{res}을(를) 가득 채우고 적 전체를 벱니다.', targeting: 'enemy_all', effects: [{ type: 'stack_gain', n: 5, ...self }, dmg(S('m', 1.2, 0.6, 3))] },
    talents: [{ names: ['맞을수록 단단히'], blurb: '공격받으면 {res} +1 (라운드당 2번).', trigger: 'onHit', targeting: 'self', perRound: 2, effects: [{ type: 'stack_gain', n: S('n', 1, 1, 2, 1) }] }],
    bt2: [
      { id: 'cap', label: '자원 상한 +2', passive: { names: ['넘치는 투지'], modifiers: [{ type: 'resource_cap', delta: 2 }, { type: 'stat_bonus', stat: 'atk', pct: S('a', 4, 0, 12, 1) }] } },
      { id: 'start', label: '자원 2개로 시작', passive: { names: ['준비된 칼날'], trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'stack_gain', n: S('n', 2, 1, 4, 1) }] } },
      { id: 'skillpow', label: '스킬 피해 강화', passive: { names: ['무거운 일격'], modifiers: [{ type: 'effect_power', action: 'skill', effect: 'damage', pct: S('p', 20, 5, 40, 1) }] } },
    ],
    bt6: [
      { id: 'ultall', label: '궁극기가 기력 30 돌려줌', passive: { names: ['멈추지 않는 칼'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'energy_gain', n: 30, target: 'self' }] }, { type: 'effect_power', action: 'ultimate', effect: 'damage', pct: S('p', 20, 0, 60, 1) }] } },
      { id: 'killfull', label: '처치하면 자원 가득', passive: { names: ['피의 축제'], trigger: 'onKill', targeting: 'self', effects: [{ type: 'stack_gain', n: 5 }, { type: 'buff', stat: 'atk', pct: S('a', 20, 5, 50, 1), turns: 2 }] } },
      { id: 'fullbuff', label: '가득 차면 크게 강화', passive: { names: ['폭주'], trigger: 'onStackFull', targeting: 'self', effects: [{ type: 'buff', stat: 'critDmg', pct: S('c', 40, 10, 100, 1), turns: 2 }, { type: 'advance_action', pct: 30 }] } },
    ],
    signature: [
      { id: 'burst', label: '폭발 강화', generic: { names: ['칼날의 기억'], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: S('a', 12, 4, 24, 1) }] }, owner: { names: ['투지의 맹세'], modifiers: [{ type: 'effect_power', action: 'skill', effect: 'damage', pct: S('p', 30, 10, 60, 1) }] } },
      { id: 'start', label: '자원 시작', generic: { names: ['결전 전야'], modifiers: [{ type: 'stat_bonus', stat: 'critDmg', pct: S('c', 20, 8, 40, 1) }] }, owner: { names: ['처음부터 전력'], trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'stack_gain', n: S('n', 3, 1, 5, 1) }] } },
    ],
  },

  // 2 ── 표식 사냥: 표식을 쌓고 표식 대상에게 큰 피해
  {
    id: 'mark_hunter',
    no: 2,
    label: '표식 사냥',
    roles: ['attacker'],
    resource: null,
    marks: { max: 3, rule: '기본 공격으로 표식, 스킬은 표식 대상에게 강함, 궁극기로 터뜨림' },
    basic: { names: ['단검 찌르기', '그림자 베기', '표적 지정'], blurb: '찌르면서 표식을 새겨요.', targeting: 'enemy_single', effects: [dmg(S('m', 0.9, 0.3, 1.5)), { type: 'mark', turns: 2, max: 3 }] },
    skill: {
      names: ['급소 찌르기', '사냥꾼의 눈', '약점 공략'],
      blurb: '표식이 많을수록 더 아프게 찔러요.',
      targeting: 'enemy_single',
      effects: [dmg(S('m', 1.3, 0.6, 3), { vsMarked: S('v', 25, 10, 60, 1) }), { type: 'mark', turns: 2, max: 3 }],
      useIf: [{ type: 'target_marked', n: 2 }],
    },
    ultimate: { names: ['처형', '그림자 폭풍', '사냥의 끝'], blurb: '적 전체에 표식을 새긴 뒤 한꺼번에 터뜨려요.', targeting: 'enemy_all', effects: [{ type: 'mark', turns: 2, max: 3 }, { type: 'mark_detonate', mult: S('m', 0.7, 0.3, 2) }] },
    talents: [{ names: ['놓치지 않는 눈'], blurb: '치명타를 내면 그 적에게 표식 +1.', trigger: 'onCrit', targeting: 'trigger_target', effects: [{ type: 'mark', turns: 2, max: 3 }, { type: 'energy_gain', n: S('e', 5, 0, 15, 1), target: 'self' }] }],
    bt2: [
      { id: 'turns', label: '표식 지속 +1턴', passive: { names: ['깊은 표식'], modifiers: [{ type: 'mark_turns', delta: 1 }, { type: 'stat_bonus', stat: 'critRate', pct: S('c', 3, 0, 8, 1) }] } },
      { id: 'double', label: '기본 공격 표식 2개', passive: { names: ['겹표식'], modifiers: [{ type: 'extra_effects', action: 'basic', effects: [{ type: 'mark', turns: 2, max: 3 }] }, { type: 'stat_bonus', stat: 'atk', pct: S('a', 2, 0, 8, 1) }] } },
      { id: 'crit', label: '치명타 강화', passive: { names: ['급소 감각'], modifiers: [{ type: 'stat_bonus', stat: 'critRate', pct: S('c', 8, 3, 15, 1) }] } },
    ],
    bt6: [
      { id: 'spread', label: '처치하면 표식 퍼짐', passive: { names: ['사냥감 전염'], trigger: 'onKill', targeting: 'enemy_all', effects: [{ type: 'mark', turns: 2, max: 3 }, { type: 'damage', mult: S('m', 0.4, 0.1, 1), stat: 'atk', hits: 1 }] } },
      { id: 'detonate', label: '스킬이 표식을 터뜨림', passive: { names: ['연쇄 처형'], trigger: 'onSkill', targeting: 'trigger_target', effects: [{ type: 'mark_detonate', mult: S('m', 0.5, 0.2, 1.2) }] } },
      { id: 'ultpow', label: '궁극기 강화 + 기력', passive: { names: ['사냥 본능'], modifiers: [{ type: 'effect_power', action: 'ultimate', effect: 'damage', pct: S('p', 35, 10, 80, 1) }, { type: 'ultimate_cost', delta: -10 }] } },
    ],
    signature: [
      { id: 'hunt', label: '표식 피해', generic: { names: ['밤의 기억'], modifiers: [{ type: 'stat_bonus', stat: 'critDmg', pct: S('c', 20, 8, 40, 1) }] }, owner: { names: ['사냥꾼의 증표'], modifiers: [{ type: 'effect_power', action: 'skill', effect: 'damage', pct: S('p', 25, 10, 50, 1) }] } },
      { id: 'mark', label: '표식 지속', generic: { names: ['그림자 발자국'], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: S('a', 10, 4, 20, 1) }] }, owner: { names: ['지워지지 않는 표식'], modifiers: [{ type: 'mark_turns', delta: 1 }, { type: 'stat_bonus', stat: 'critRate', pct: S('c', 6, 2, 12, 1) }] } },
    ],
  },

  // 3 ── 추가 공격: 아군이 공격하면 따라 쏨
  {
    id: 'follow_up',
    no: 3,
    label: '추가 공격',
    roles: ['attacker', 'support'],
    resource: null,
    basic: { names: ['석궁 사격', '견제 사격', '속사'], blurb: '빠르게 한 발 쏘아요.', targeting: 'enemy_single', effects: [dmg(S('m', 1, 0.3, 1.6))] },
    skill: { names: ['저격', '관통 볼트', '조준 사격'], blurb: '조준해서 쏘고 다음 사격의 치명타를 높여요.', targeting: 'enemy_single', effects: [dmg(S('m', 1.5, 0.6, 3)), { type: 'buff', stat: 'critRate', pct: S('c', 12, 4, 25, 1), turns: 2, ...self }] },
    ultimate: { names: ['화살비', '난사', '볼트 폭풍'], blurb: '무작위 적에게 여러 발을 쏟아부어요.', targeting: 'enemy_random_n', count: 4, effects: [dmg(S('m', 0.6, 0.2, 1.5))] },
    talents: [{ names: ['엄호 사격'], blurb: '다른 아군이 공격하면 같은 적을 따라 쏘아요 (라운드당 1번).', trigger: 'onAllyAttack', targeting: 'trigger_target', perRound: 1, effects: [{ type: 'follow_up', mult: S('m', 0.5, 0.2, 1.2), stat: 'atk' }] }],
    bt2: [
      { id: 'limit', label: '추가 공격 +1번', passive: { names: ['재장전'], trigger: 'onAllyAttack', targeting: 'trigger_target', perRound: 1, effects: [{ type: 'follow_up', mult: S('m', 0.3, 0.1, 0.8), stat: 'atk' }] } },
      { id: 'crit', label: '치명타 확률', passive: { names: ['숙련된 손'], modifiers: [{ type: 'stat_bonus', stat: 'critRate', pct: S('c', 8, 3, 15, 1) }] } },
      { id: 'energy', label: '따라 쏠 때 기력', passive: { names: ['호흡 맞추기'], trigger: 'onAllyAttack', targeting: 'self', perRound: 2, effects: [{ type: 'energy_gain', n: S('e', 8, 3, 20, 1) }] } },
    ],
    bt6: [
      { id: 'kill', label: '처치하면 한 번 더', passive: { names: ['확인 사살'], trigger: 'onKill', targeting: 'enemy_single', effects: [{ type: 'follow_up', mult: S('m', 0.9, 0.3, 2), stat: 'atk' }] } },
      { id: 'tempo', label: '궁극기가 아군을 당김', passive: { names: ['돌격 신호'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'advance_action', pct: S('a', 15, 5, 30, 1), target: 'ally_all' }] }] } },
      { id: 'double', label: '추가 공격이 강해짐', passive: { names: ['명사수'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'damage', pct: S('p', 15, 5, 35, 1) }] } },
    ],
    signature: [
      { id: 'cover', label: '엄호 강화', generic: { names: ['사수의 기억'], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: S('a', 10, 4, 20, 1) }] }, owner: { names: ['두 번째 볼트'], trigger: 'onAllyAttack', targeting: 'trigger_target', perRound: 1, effects: [{ type: 'follow_up', mult: S('m', 0.3, 0.1, 0.8), stat: 'atk' }] } },
      { id: 'crit', label: '치명타', generic: { names: ['조준경'], modifiers: [{ type: 'stat_bonus', stat: 'critRate', pct: S('c', 8, 3, 15, 1) }] }, owner: { names: ['급소 저격'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'damage', pct: S('p', 15, 5, 30, 1) }] } },
    ],
  },

  // 4 ── 반격 탱커: 도발하고 맞으면 받아침
  {
    id: 'counter_tank',
    no: 4,
    label: '반격 탱커',
    roles: ['defender'],
    resource: null,
    basic: { names: ['방패 치기', '검자루 타격', '밀쳐내기'], blurb: '방어력으로 밀어붙여요.', targeting: 'enemy_single', effects: [dmg(S('m', 1.2, 0.3, 2), { stat: 'def' })] },
    skill: { names: ['도발', '수호의 맹세', '굳건한 자세'], blurb: '적의 공격을 끌어오고 보호막을 둘러요.', targeting: 'self', effects: [{ type: 'taunt', turns: 2 }, { type: 'shield', mult: S('m', 1.5, 0.5, 4), stat: 'def', turns: 2 }] },
    ultimate: { names: ['철벽', '불굴의 방진', '충의의 방패'], blurb: '아군 전체에 보호막, 자신은 도발.', targeting: 'ally_all', effects: [{ type: 'shield', mult: S('m', 1.2, 0.4, 3), stat: 'def', turns: 2 }, { type: 'taunt', turns: 2, ...self }] },
    talents: [{ names: ['받아치기'], blurb: '공격받으면 그 적에게 반격 (라운드당 2번).', trigger: 'onHit', targeting: 'trigger_target', perRound: 2, effects: [{ type: 'counter', mult: S('m', 0.8, 0.3, 2), stat: 'def' }] }],
    bt2: [
      { id: 'def', label: '방어력', passive: { names: ['단련된 몸'], modifiers: [{ type: 'stat_bonus', stat: 'def', pct: S('d', 12, 5, 25, 1) }] } },
      { id: 'energy', label: '맞으면 기력', passive: { names: ['고통을 힘으로'], modifiers: [{ type: 'energy_gain', source: 'hit', delta: S('e', 5, 2, 12, 1) }] } },
      { id: 'guard', label: '스킬이 받는 피해 감소', passive: { names: ['단단한 각오'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'buff', stat: 'dmgTaken', pct: S('t', 20, 5, 40, 1), turns: 2, target: 'self' }] }] } },
    ],
    bt6: [
      { id: 'drain', label: '반격하며 회복', passive: { names: ['피의 맹세'], trigger: 'onHit', targeting: 'self', perRound: 2, effects: [{ type: 'heal', mult: S('m', 0.06, 0.02, 0.15, 0.01), stat: 'hp' }] } },
      { id: 'last', label: '위기에 큰 보호막', passive: { names: ['최후의 방벽'], trigger: 'onHpBelow', pct: 40, targeting: 'self', limit: 1, effects: [{ type: 'shield', mult: S('m', 3, 1, 6), stat: 'def', turns: 3 }, { type: 'buff', stat: 'def', pct: 30, turns: 3 }] } },
      { id: 'power', label: '반격 강화', passive: { names: ['응징'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'damage', pct: S('p', 30, 10, 60, 1) }] } },
    ],
    signature: [
      { id: 'wall', label: '보호막', generic: { names: ['방패의 기억'], modifiers: [{ type: 'stat_bonus', stat: 'hp', pct: S('h', 12, 4, 24, 1) }] }, owner: { names: ['충의의 증표'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'shield', pct: S('p', 25, 4, 50, 1) }] } },
      { id: 'counter', label: '반격', generic: { names: ['굳은 결의'], modifiers: [{ type: 'stat_bonus', stat: 'def', pct: S('d', 12, 4, 24, 1) }] }, owner: { names: ['검의 응답'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'damage', pct: S('p', 30, 4, 60, 1) }] } },
    ],
  },

  // 5 ── 타임라인 조작: 아군을 당기고 적을 밂
  {
    id: 'timeline',
    no: 5,
    label: '타임라인 조작',
    roles: ['support'],
    resource: null,
    basic: { names: ['계산된 일격', '발목 걸기', '견제'], blurb: '때리면서 적의 행동을 조금 밀어요.', targeting: 'enemy_single', effects: [dmg(S('m', 0.9, 0.3, 1.5)), { type: 'delay_action', pct: S('d', 10, 4, 20, 1) }] },
    skill: { names: ['지휘', '선수 치기', '작전 지시'], blurb: '아군 한 명을 당기고 속도를 올려요.', targeting: 'ally_single', effects: [{ type: 'advance_action', pct: S('a', 40, 20, 100, 1) }, { type: 'buff', stat: 'spd', pct: S('s', 12, 5, 30, 1), turns: 2 }] },
    ultimate: { names: ['시간 계산', '총공격 명령', '판 뒤집기'], blurb: '아군 전체를 당기고 적 전체를 밀어요.', targeting: 'ally_all', effects: [{ type: 'advance_action', pct: S('a', 25, 10, 60, 1) }, { type: 'delay_action', pct: S('d', 20, 5, 50, 1), target: 'enemy_all' }] },
    talents: [{ names: ['선제 계산'], blurb: '전투 시작 때 아군 전체 행동을 당겨요.', trigger: 'onBattleStart', targeting: 'ally_all', effects: [{ type: 'advance_action', pct: S('a', 20, 5, 50, 1) }] }],
    bt2: [
      { id: 'spd', label: '속도', passive: { names: ['재빠른 머리'], modifiers: [{ type: 'stat_bonus', stat: 'spd', pct: S('s', 8, 3, 15, 1) }] } },
      { id: 'energy', label: '스킬이 기력도 줌', passive: { names: ['몰아주기'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'energy_gain', n: S('e', 10, 3, 25, 1) }] }] } },
      { id: 'delay', label: '기본 공격 밀기 강화', passive: { names: ['발 묶기'], modifiers: [{ type: 'extra_effects', action: 'basic', effects: [{ type: 'delay_action', pct: S('d', 10, 5, 25, 1) }] }] } },
    ],
    bt6: [
      { id: 'sp', label: '궁극기가 SP 2', passive: { names: ['완벽한 계획'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'sp_gain', n: 2, target: 'self' }] }, { type: 'stat_bonus', stat: 'spd', pct: S('s', 4, 0, 10, 1) }] } },
      { id: 'cleanse', label: '궁극기가 정화', passive: { names: ['정리 정돈'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'cleanse', target: 'ally_all' }, { type: 'buff', stat: 'atk', pct: S('a', 15, 5, 30, 1), turns: 2, target: 'ally_all' }] }] } },
      { id: 'tick', label: '매 턴 약한 아군 당기기', passive: { names: ['보이지 않는 손'], trigger: 'onTurnStart', targeting: 'ally_lowest_hp', effects: [{ type: 'advance_action', pct: S('a', 15, 5, 30, 1) }] } },
    ],
    signature: [
      { id: 'tempo', label: '속도', generic: { names: ['회중시계'], modifiers: [{ type: 'stat_bonus', stat: 'spd', pct: S('s', 8, 3, 15, 1) }] }, owner: { names: ['한 수 앞'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'energy_gain', n: S('e', 15, 5, 30, 1) }] }] } },
      { id: 'start', label: '선제', generic: { names: ['출발 신호'], trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'advance_action', pct: S('a', 30, 10, 60, 1) }] }, owner: { names: ['전원 출격'], trigger: 'onBattleStart', targeting: 'ally_all', effects: [{ type: 'advance_action', pct: S('b', 15, 5, 30, 1) }] } },
    ],
  },

  // 6 ── 보호막 전환: 보호막을 두르고 버틴 만큼 되갚음
  {
    id: 'shield_converter',
    no: 6,
    label: '보호막 전환',
    roles: ['defender', 'support'],
    resource: { names: ['반동', '충격', '버팀'], cap: 5, start: 0, rule: '보호막을 두르거나 맞으면 얻고 궁극기로 전부 씀' },
    basic: { names: ['몽둥이질', '어깨 치기', '막고 치기'], blurb: '방어력으로 때려요.', targeting: 'enemy_single', effects: [dmg(S('m', 1.1, 0.3, 2), { stat: 'def' })] },
    skill: { names: ['방패벽', '버티기', '막아서기'], blurb: '아군 전체에 보호막을 두르고 {res}을(를) 얻어요.', targeting: 'ally_all', effects: [{ type: 'shield', mult: S('m', 0.8, 0.3, 2), stat: 'def', turns: 2 }, { type: 'stack_gain', n: 1, ...self }] },
    ultimate: { names: ['반동 폭발', '되갚기', '충격파'], blurb: '쌓인 {res}만큼 강해지는 광역 공격.', targeting: 'enemy_all', effects: [dmg(S('m', 1, 0.4, 2.5), { stat: 'def', perStack: S('p', 0.25, 0.1, 0.6) }), { type: 'stack_spend', n: 0, ...self }] },
    talents: [{ names: ['충격 흡수'], blurb: '공격받으면 {res} +1 (라운드당 1번).', trigger: 'onHit', targeting: 'self', perRound: 1, effects: [{ type: 'stack_gain', n: 1 }, { type: 'shield', mult: S('m', 0.4, 0.1, 1), stat: 'def', turns: 1 }] }],
    bt2: [
      { id: 'shield', label: '보호막 보너스', passive: { names: ['두꺼운 방패'], modifiers: [{ type: 'stat_bonus', stat: 'shieldBonus', pct: S('s', 12, 5, 25, 1) }] } },
      { id: 'start', label: '시작 보호막', passive: { names: ['선제 방어'], trigger: 'onBattleStart', targeting: 'ally_all', effects: [{ type: 'shield', mult: S('m', 0.6, 0.2, 1.5), stat: 'def', turns: 2 }] } },
      { id: 'cap', label: '자원 상한 +2', passive: { names: ['더 버티기'], modifiers: [{ type: 'resource_cap', delta: 2 }, { type: 'stat_bonus', stat: 'def', pct: S('d', 4, 0, 12, 1) }] } },
    ],
    bt6: [
      { id: 'reshield', label: '궁극기 뒤 보호막', passive: { names: ['끝나지 않는 방벽'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'shield', mult: S('m', 0.7, 0.2, 1.6), stat: 'def', turns: 2, target: 'ally_all' }] }] } },
      { id: 'full', label: '가득 차면 도발 + 보호막', passive: { names: ['인간 방패'], trigger: 'onStackFull', targeting: 'self', effects: [{ type: 'taunt', turns: 2 }, { type: 'shield', mult: S('m', 2, 0.5, 4), stat: 'def', turns: 2 }] } },
      { id: 'power', label: '궁극기 피해', passive: { names: ['되갚음'], modifiers: [{ type: 'effect_power', action: 'ultimate', effect: 'damage', pct: S('p', 35, 10, 70, 1) }] } },
    ],
    signature: [
      { id: 'wall', label: '보호막', generic: { names: ['낡은 방패'], modifiers: [{ type: 'stat_bonus', stat: 'shieldBonus', pct: S('s', 12, 5, 25, 1) }] }, owner: { names: ['반동의 기억'], modifiers: [{ type: 'effect_power', action: 'ultimate', effect: 'damage', pct: S('p', 30, 10, 60, 1) }] } },
      { id: 'tough', label: '체력', generic: { names: ['버팀목'], modifiers: [{ type: 'stat_bonus', stat: 'hp', pct: S('h', 12, 4, 24, 1) }] }, owner: { names: ['쌓인 충격'], trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'stack_gain', n: S('n', 2, 1, 4, 1) }] } },
    ],
  },

  // 7 ── 지속 치유: 꾸준히 채우는 치유사
  {
    id: 'sustain_healer',
    no: 7,
    label: '지속 치유',
    roles: ['healer', 'support'],
    resource: null,
    basic: { names: ['식칼 휘두르기', '국자 치기', '칼질'], blurb: '가볍게 때려요.', targeting: 'enemy_single', effects: [dmg(S('m', 0.9, 0.3, 1.5))] },
    skill: { names: ['따뜻한 수프', '응급 처치', '든든한 한 끼'], blurb: 'HP가 가장 낮은 아군을 치유해요.', targeting: 'ally_lowest_hp', effects: [{ type: 'heal', mult: S('m', 1.6, 0.6, 4), stat: 'atk' }] },
    ultimate: { names: ['만찬', '잔치', '특제 요리'], blurb: '아군 전체를 치유하고 받는 피해를 줄여요.', targeting: 'ally_all', effects: [{ type: 'heal', mult: S('m', 1.1, 0.4, 3), stat: 'atk' }, { type: 'buff', stat: 'dmgTaken', pct: S('t', 15, 5, 30, 1), turns: 2 }] },
    talents: [{ names: ['간식 챙기기'], blurb: '자기 턴 시작마다 HP가 가장 낮은 아군을 조금 치유.', trigger: 'onTurnStart', targeting: 'ally_lowest_hp', effects: [{ type: 'heal', mult: S('m', 0.4, 0.1, 1), stat: 'atk' }] }],
    bt2: [
      { id: 'bonus', label: '치유 보너스', passive: { names: ['손맛'], modifiers: [{ type: 'stat_bonus', stat: 'healBonus', pct: S('h', 12, 5, 25, 1) }] } },
      { id: 'cleanse', label: '스킬이 정화', passive: { names: ['해독 요리'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'cleanse' }, { type: 'energy_gain', n: S('e', 5, 0, 15, 1), target: 'self' }] }] } },
      { id: 'energy', label: '궁극기가 기력 나눔', passive: { names: ['나눠 먹기'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'energy_gain', n: S('e', 10, 3, 20, 1), target: 'ally_all' }] }] } },
    ],
    bt6: [
      { id: 'shield', label: '궁극기 보호막', passive: { names: ['포만감'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'shield', mult: S('m', 0.8, 0.2, 2), stat: 'atk', turns: 2, target: 'ally_all' }] }] } },
      { id: 'support', label: '아군 공격에 치유', passive: { names: ['응원 도시락'], trigger: 'onAllyAttack', targeting: 'ally_lowest_hp', perRound: 2, effects: [{ type: 'heal', mult: S('m', 0.3, 0.1, 0.8), stat: 'atk' }] } },
      { id: 'save', label: '위기 대응', passive: { names: ['비상식량'], trigger: 'onHpBelow', pct: 50, targeting: 'ally_all', limit: 2, effects: [{ type: 'heal', mult: S('m', 1.2, 0.4, 3), stat: 'atk' }] } },
    ],
    signature: [
      { id: 'heal', label: '치유', generic: { names: ['손때 묻은 앞치마'], modifiers: [{ type: 'stat_bonus', stat: 'healBonus', pct: S('h', 12, 5, 25, 1) }] }, owner: { names: ['어머니의 레시피'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'heal', pct: S('p', 25, 4, 50, 1) }] } },
      { id: 'hp', label: '체력', generic: { names: ['따뜻한 부엌'], modifiers: [{ type: 'stat_bonus', stat: 'hp', pct: S('a', 12, 4, 24, 1) }] }, owner: { names: ['한 그릇 더'], trigger: 'onTurnStart', targeting: 'ally_lowest_hp', effects: [{ type: 'heal', mult: S('m', 0.25, 0.1, 0.6), stat: 'atk' }] } },
    ],
  },

  // 8 ── 지속 피해 확산: 독/불을 퍼뜨림
  {
    id: 'dot_spreader',
    no: 8,
    label: '지속 피해 확산',
    roles: ['attacker', 'support'],
    resource: null,
    basic: { names: ['독침', '더러운 수작', '녹슨 칼'], blurb: '찌르고 독을 남겨요.', targeting: 'enemy_single', effects: [dmg(S('m', 0.8, 0.3, 1.4)), { type: 'dot', mult: S('d', 0.25, 0.1, 0.8, 0.01), turns: 2 }] },
    skill: { names: ['독 안개', '오물 투척', '썩은 거래'], blurb: '적 전체에 독을 뿌리고 효과 저항을 낮춰요.', targeting: 'enemy_all', effects: [{ type: 'dot', mult: S('d', 0.3, 0.1, 1, 0.01), turns: 3 }, { type: 'debuff', stat: 'effectRes', pct: S('r', 10, 4, 25, 1), turns: 2 }] },
    ultimate: { names: ['역병', '독살 계약', '시궁창의 선물'], blurb: '적 전체를 공격하고 진한 독을 남겨요.', targeting: 'enemy_all', effects: [dmg(S('m', 0.7, 0.3, 2)), { type: 'dot', mult: S('d', 0.5, 0.2, 1.4), turns: 2 }] },
    talents: [{ names: ['전염'], blurb: '적을 쓰러뜨리면 남은 적 전체에 독.', trigger: 'onKill', targeting: 'enemy_all', effects: [{ type: 'dot', mult: S('d', 0.4, 0.1, 1), turns: 2 }] }],
    bt2: [
      { id: 'hit', label: '효과 적중', passive: { names: ['교묘한 손'], modifiers: [{ type: 'stat_bonus', stat: 'effectHit', pct: S('h', 15, 5, 30, 1) }] } },
      { id: 'power', label: '지속 피해 강화', passive: { names: ['진한 독'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'dot', pct: S('p', 20, 5, 40, 1) }] } },
      { id: 'weaken', label: '기본 공격 방어 약화', passive: { names: ['약점 소문'], modifiers: [{ type: 'extra_effects', action: 'basic', effects: [{ type: 'debuff', stat: 'def', pct: S('d', 10, 5, 20, 1), turns: 2 }] }] } },
    ],
    bt6: [
      { id: 'armor', label: '궁극기 방어 약화', passive: { names: ['갑옷 부식'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'debuff', stat: 'def', pct: S('d', 20, 5, 40, 1), turns: 2 }] }] } },
      { id: 'tick', label: '매 턴 무작위 독', passive: { names: ['뒷거래'], trigger: 'onTurnStart', targeting: 'enemy_random_n', count: 2, effects: [{ type: 'dot', mult: S('d', 0.3, 0.1, 0.8), turns: 2 }] } },
      { id: 'taken', label: '독이 받는 피해를 늘림', passive: { names: ['상처 벌리기'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'debuff', stat: 'dmgTaken', pct: S('t', 15, 5, 30, 1), turns: 2 }] }] } },
    ],
    signature: [
      { id: 'poison', label: '지속 피해', generic: { names: ['정보상의 장부'], modifiers: [{ type: 'stat_bonus', stat: 'effectHit', pct: S('h', 15, 5, 30, 1) }] }, owner: { names: ['독의 기억'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'dot', pct: S('p', 30, 10, 60, 1) }] } },
      { id: 'atk', label: '공격', generic: { names: ['녹슨 단검'], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: S('a', 10, 4, 20, 1) }] }, owner: { names: ['퍼지는 소문'], trigger: 'onSkill', targeting: 'enemy_all', effects: [{ type: 'debuff', stat: 'def', pct: S('d', 10, 5, 20, 1), turns: 2 }] } },
    ],
  },

  // 9 ── 변신 캐리: 궁극기로 변신해서 몰아침
  {
    id: 'transform_carry',
    no: 9,
    label: '변신 캐리',
    roles: ['attacker'],
    resource: null,
    basic: { names: ['흑마법 화살', '저주 탄', '마력 구체'], blurb: '마력 구체를 던져요.', targeting: 'enemy_single', effects: [dmg(S('m', 1, 0.3, 1.6))] },
    skill: { names: ['어둠의 창', '악마의 손톱', '저주 폭발'], blurb: '강한 흑마법 한 방.', targeting: 'enemy_single', effects: [dmg(S('m', 1.7, 0.8, 3.5))] },
    ultimate: { names: ['악마 강림', '금기 해방', '계약 이행'], blurb: '적 전체를 치고 2턴 동안 악마의 모습으로 변신해요.', targeting: 'enemy_all', effects: [dmg(S('m', 1, 0.4, 2.5)), { type: 'transform', turns: 2, ...self }, { type: 'buff', stat: 'atk', pct: S('a', 20, 5, 40, 1), turns: 2, ...self }] },
    transformed: {
      basic: { names: ['악마의 숨결', '지옥불', '검은 불꽃'], blurb: '변신 중: 기본 공격이 적 전체를 태워요.', targeting: 'enemy_all', effects: [dmg(S('m', 0.7, 0.3, 1.4))] },
      skill: { names: ['멸망의 창', '심연의 손', '종말의 저주'], blurb: '변신 중: 아주 강한 한 방 + 기력.', targeting: 'enemy_single', effects: [dmg(S('m', 2.4, 1, 5)), { type: 'energy_gain', n: 10, ...self }] },
    },
    talents: [{ names: ['계약의 대가'], blurb: '변신 중에 적을 쓰러뜨리면 기력을 얻어요.', trigger: 'onKill', conditions: [{ type: 'is_transformed' }], targeting: 'self', effects: [{ type: 'energy_gain', n: S('e', 15, 5, 30, 1) }] }],
    bt2: [
      { id: 'crit', label: '궁극기 치명타 피해', passive: { names: ['광기'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'buff', stat: 'critDmg', pct: S('c', 30, 10, 60, 1), turns: 2, target: 'self' }] }] } },
      { id: 'energy', label: '기본 공격 기력', passive: { names: ['마력 순환'], modifiers: [{ type: 'energy_gain', source: 'basic', delta: S('e', 6, 2, 12, 1) }] } },
      { id: 'atk', label: '공격력', passive: { names: ['금단의 지식'], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: S('a', 8, 3, 15, 1) }] } },
    ],
    bt6: [
      { id: 'sp', label: '변신이 팀 SP 2', passive: { names: ['악마의 축복'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'sp_gain', n: 2, target: 'self' }] }, { type: 'stat_bonus', stat: 'atk', pct: S('a', 4, 0, 10, 1) }] } },
      { id: 'longer', label: '변신 3턴', passive: { names: ['깊은 계약'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'transform', turns: 3, target: 'self' }] }, { type: 'effect_power', action: 'any', effect: 'damage', pct: S('p', 8, 0, 20, 1) }] } },
      { id: 'tempo', label: '궁극기 뒤 바로 행동', passive: { names: ['멈추지 않는 마력'], trigger: 'onUltimate', targeting: 'self', effects: [{ type: 'advance_action', pct: S('a', 50, 20, 100, 1) }] } },
    ],
    signature: [
      { id: 'demon', label: '변신 강화', generic: { names: ['깨진 마탑 열쇠'], modifiers: [{ type: 'stat_bonus', stat: 'critDmg', pct: S('c', 20, 8, 40, 1) }] }, owner: { names: ['악마와의 내기'], modifiers: [{ type: 'effect_power', action: 'any', effect: 'damage', pct: S('p', 18, 6, 35, 1) }] } },
      { id: 'energy', label: '기력', generic: { names: ['수치의 칭호'], modifiers: [{ type: 'stat_bonus', stat: 'atk', pct: S('a', 10, 4, 20, 1) }] }, owner: { names: ['계약 갱신'], modifiers: [{ type: 'ultimate_cost', delta: S('u', -15, -30, -5, 1) }] } },
    ],
  },

  // 10 ── SP 배터리/버퍼: SP를 채우고 아군을 강화
  {
    id: 'sp_battery',
    no: 10,
    label: 'SP 배터리 / 버퍼',
    roles: ['support', 'healer'],
    resource: null,
    basic: { names: ['장부 내려치기', '잔소리', '견제 공격'], blurb: '때리면서 SP를 채워요 (라운드당 1번 추가).', targeting: 'enemy_single', effects: [dmg(S('m', 0.9, 0.3, 1.5))] },
    skill: { names: ['특별 수당', '격려', '보너스 지급'], blurb: '아군 한 명의 공격력과 기력을 올려요.', targeting: 'ally_single', effects: [{ type: 'buff', stat: 'atk', pct: S('a', 30, 10, 60, 1), turns: 2 }, { type: 'energy_gain', n: S('e', 15, 5, 30, 1) }] },
    ultimate: { names: ['월급날', '대목', '전원 회식'], blurb: '아군 전체 강화 + 팀 SP.', targeting: 'ally_all', effects: [{ type: 'buff', stat: 'atk', pct: S('a', 20, 5, 40, 1), turns: 2 }, { type: 'sp_gain', n: 2 }] },
    talents: [{ names: ['살림꾼'], blurb: '기본 공격 뒤 팀 SP +1 (라운드당 1번).', trigger: 'onBasic', targeting: 'self', perRound: 1, effects: [{ type: 'sp_gain', n: 1 }, { type: 'energy_gain', n: S('e', 5, 0, 15, 1) }] }],
    bt2: [
      { id: 'cost', label: '스킬 SP 소모 −1', passive: { names: ['알뜰 살림'], modifiers: [{ type: 'sp_cost', delta: -1 }] } },
      { id: 'crit', label: '스킬이 치명타 피해도', passive: { names: ['성과급'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'buff', stat: 'critDmg', pct: S('c', 20, 5, 40, 1), turns: 2 }] }] } },
      { id: 'regen', label: '기력 회복', passive: { names: ['꼼꼼한 계산'], modifiers: [{ type: 'stat_bonus', stat: 'energyRegen', pct: S('r', 12, 5, 25, 1) }] } },
    ],
    bt6: [
      { id: 'tempo', label: '궁극기가 아군을 당김', passive: { names: ['전원 출근'], modifiers: [{ type: 'extra_effects', action: 'ultimate', effects: [{ type: 'advance_action', pct: S('a', 20, 5, 40, 1) }] }] } },
      { id: 'energy', label: '궁극기 뒤 아군 기력', passive: { names: ['상여금'], trigger: 'onUltimate', targeting: 'ally_all', effects: [{ type: 'energy_gain', n: S('e', 12, 5, 25, 1) }] } },
      { id: 'start', label: '시작 SP +2', passive: { names: ['비상금'], trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'sp_gain', n: 2 }, { type: 'energy_gain', n: S('e', 20, 5, 50, 1) }] } },
    ],
    signature: [
      { id: 'buff', label: '강화', generic: { names: ['귀족의 인장'], modifiers: [{ type: 'stat_bonus', stat: 'energyRegen', pct: S('r', 10, 4, 20, 1) }] }, owner: { names: ['어머니의 장부'], modifiers: [{ type: 'extra_effects', action: 'skill', effects: [{ type: 'buff', stat: 'critRate', pct: S('c', 10, 4, 20, 1), turns: 2 }] }] } },
      { id: 'sp', label: 'SP', generic: { names: ['몰락 귀족의 품위'], modifiers: [{ type: 'stat_bonus', stat: 'spd', pct: S('s', 6, 2, 12, 1) }] }, owner: { names: ['살림 비법'], trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'sp_gain', n: 1 }, { type: 'energy_gain', n: S('e', 20, 5, 40, 1) }] } },
    ],
  },
];

export const ARCHETYPE_MAP = new Map(ARCHETYPES.map((a) => [a.id, a]));
