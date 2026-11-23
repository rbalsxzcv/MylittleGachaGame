// 일반 추억 라이브러리 (3★/4★, 누구나 장착) — 추억 생성기(generate.js)의 템플릿 (데이터만, AI 없음)
// role: 역할 기본 추억 (캐릭터를 처음 얻을 때 그 역할의 기본 추억 1장 지급)
// secondary.stat: 부옵션 능력치 (값은 balance.memory.secondary[희귀도] × 레벨 성장)
// passive: 패시브 템플릿 (숫자 칸 S는 balance.kitBudget.caps.signature × 희귀도 계수에 맞춰 채움)
// theme: 카드 그림 장면 태그 (AI가 꺼져 있으면 이 태그로 장면 프롬프트를 만듦)
import { S } from '../kitgen/archetypes.js';

export const GENERIC_MEMORIES = [
  // ── 역할 기본 (3★) ──
  { key: 'default_attacker', role: 'attacker', rarity: 3, name: '첫 의뢰의 칼자국', secondary: { stat: 'atk' }, theme: ['rusty dagger on a tavern table', 'candle light', 'notice board'], passive: { names: ['첫 의뢰'], blurb: '전투 시작 때 공격력이 잠깐 올라요.', trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'buff', stat: 'atk', pct: S('a', 15, 5, 40, 1), turns: 2 }] } },
  { key: 'default_defender', role: 'defender', rarity: 3, name: '찌그러진 방패', secondary: { stat: 'hp' }, theme: ['dented round shield leaning on a wall', 'rain', 'barracks'], passive: { names: ['버텨 낸 밤'], blurb: '처음 HP가 절반 아래로 떨어지면 보호막.', trigger: 'onHpBelow', pct: 50, targeting: 'self', limit: 1, effects: [{ type: 'shield', mult: S('m', 1.5, 0.5, 4), stat: 'def', turns: 2 }] } },
  { key: 'default_support', role: 'support', rarity: 3, name: '구겨진 작전 지도', secondary: { stat: 'spd' }, theme: ['crumpled map with ink marks', 'compass', 'campfire'], passive: { names: ['길잡이'], blurb: '전투 시작 때 행동이 조금 빨라져요.', trigger: 'onBattleStart', targeting: 'self', effects: [{ type: 'advance_action', pct: S('a', 20, 5, 50, 1) }] } },
  { key: 'default_healer', role: 'healer', rarity: 3, name: '약초 주머니', secondary: { stat: 'healBonus' }, theme: ['herb pouch and bandages', 'wooden table', 'morning light'], passive: { names: ['응급 약초'], blurb: '스킬을 쓰면 자신도 조금 회복.', trigger: 'onSkill', targeting: 'self', effects: [{ type: 'heal', mult: S('m', 0.3, 0.1, 0.8), stat: 'atk' }] } },
  // ── 3★ ──
  { key: 'tavern_brawl', rarity: 3, name: '술집 난투의 밤', secondary: { stat: 'critRate' }, theme: ['broken mugs', 'overturned tavern table', 'night'], passive: { names: ['주먹다짐'], blurb: '적을 쓰러뜨리면 기력.', trigger: 'onKill', targeting: 'self', effects: [{ type: 'energy_gain', n: S('e', 15, 5, 40, 1) }] } },
  { key: 'muddy_road', rarity: 3, name: '진흙길 행군', secondary: { stat: 'def' }, theme: ['muddy road', 'marching boots', 'grey sky'], passive: { names: ['꾸역꾸역'], blurb: '받는 피해가 조금 줄어요.', modifiers: [{ type: 'stat_bonus', stat: 'def', pct: S('d', 10, 3, 25, 1) }] } },
  // ── 4★ ──
  { key: 'first_pay', rarity: 4, name: '첫 월급 봉투', secondary: { stat: 'atk' }, theme: ['coin pouch', 'ledger', 'smiling mercenaries silhouettes'], passive: { names: ['두둑한 봉투'], blurb: '궁극기를 쓰면 팀 SP +1.', trigger: 'onUltimate', targeting: 'self', effects: [{ type: 'sp_gain', n: 1 }, { type: 'energy_gain', n: S('e', 5, 0, 20, 1) }] } },
  { key: 'border_sunrise', rarity: 4, name: '국경의 해돋이', secondary: { stat: 'energyRegen' }, theme: ['sunrise over a border fortress', 'banner flags', 'mist'], passive: { names: ['새 아침'], blurb: '자기 턴 시작마다 기력.', trigger: 'onTurnStart', targeting: 'self', effects: [{ type: 'energy_gain', n: S('e', 5, 2, 15, 1) }] } },
  { key: 'black_market', rarity: 4, name: '암시장 뒷거래', secondary: { stat: 'effectHit' }, theme: ['dark alley stall', 'vials', 'hooded merchant hands'], passive: { names: ['뒷거래'], blurb: '약화를 거는 확률이 올라가요.', modifiers: [{ type: 'stat_bonus', stat: 'effectHit', pct: S('h', 15, 5, 30, 1) }] } },
  { key: 'oath_rain', rarity: 4, name: '빗속의 맹세', secondary: { stat: 'hp' }, theme: ['kneeling knight silhouette in rain', 'sword planted in ground'], passive: { names: ['빗속의 맹세'], blurb: '공격받으면 받는 피해를 줄여요 (라운드당 1번).', trigger: 'onHit', targeting: 'self', perRound: 1, effects: [{ type: 'buff', stat: 'dmgTaken', pct: S('t', 10, 4, 25, 1), turns: 1 }] } },
  { key: 'war_drum', rarity: 4, name: '전장의 북소리', secondary: { stat: 'critDmg' }, theme: ['war drum', 'torches', 'army camp at night'], passive: { names: ['북소리'], blurb: '궁극기를 쓰면 아군 전체 공격력 상승.', trigger: 'onUltimate', targeting: 'ally_all', effects: [{ type: 'buff', stat: 'atk', pct: S('a', 8, 3, 20, 1), turns: 2 }] } },
  { key: 'healer_lamp', rarity: 4, name: '야전 병원의 등불', secondary: { stat: 'healBonus' }, theme: ['oil lamp in a field hospital tent', 'cots', 'warm light'], passive: { names: ['밤샘 간호'], blurb: '치유가 강해져요.', modifiers: [{ type: 'effect_power', action: 'any', effect: 'heal', pct: S('p', 15, 5, 35, 1) }] } },
  { key: 'shield_wall', rarity: 4, name: '방패벽의 기억', secondary: { stat: 'def' }, theme: ['shield wall formation', 'arrows in shields', 'dust'], passive: { names: ['방패벽'], blurb: '보호막이 단단해져요.', modifiers: [{ type: 'stat_bonus', stat: 'shieldBonus', pct: S('s', 15, 5, 30, 1) }] } },
  { key: 'lucky_coin', rarity: 4, name: '행운의 동전', secondary: { stat: 'critRate' }, theme: ['spinning coin in the air', 'dice', 'card table'], passive: { names: ['앞면'], blurb: '치명타를 내면 기력.', trigger: 'onCrit', targeting: 'self', perRound: 1, effects: [{ type: 'energy_gain', n: S('e', 8, 3, 20, 1) }] } },
];

/** 역할 → 기본 추억 key */
export const DEFAULT_MEMORY_KEY = Object.fromEntries(GENERIC_MEMORIES.filter((m) => m.role).map((m) => [m.role, m.key]));

/** 전용 추억(5★) 부옵션 — 아키타입 주 능력치 */
export const SIGNATURE_SECONDARY = {
  stack_burst: 'critDmg',
  mark_hunter: 'critRate',
  follow_up: 'atk',
  counter_tank: 'def',
  timeline: 'spd',
  shield_converter: 'shieldBonus',
  sustain_healer: 'healBonus',
  dot_spreader: 'effectHit',
  transform_carry: 'atk',
  sp_battery: 'energyRegen',
};
