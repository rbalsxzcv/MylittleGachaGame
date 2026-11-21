// 전투 테스트 도우미 — 엔진 자체 검사(selftest.js)와 tests/*.test.js가 같이 씀
// 실제 데이터와 똑같이 schema 정리를 거친 가짜 캐릭터/적/스테이지를 만듭니다.
import { loadConfig } from '../config.js';
import { cleanKit, cleanPassiveList, cleanEnemyBehavior, cleanStats } from './schema.js';

/** 치명타 없는 기본 능력치 (계산을 손으로 맞추기 쉽게) */
export const NO_CRIT = { atk: 100, def: 40, hp: 100000, spd: 100, critRate: 0, critDmg: 0.5 };

export const dmg = (mult, extra = {}) => ({ type: 'damage', mult, stat: 'atk', hits: 1, ...extra });
export const skill = (targeting, effects, extra = {}) => ({ name: extra.name || 's', description: '', targeting, effects, ...extra });

/** 캐릭터 하나 (kit/breakthroughs는 정리됨) */
export function char(vocab, id, { stats = {}, kit = {}, breakthroughs = [], rarity = 3 } = {}) {
  const raw = {
    basic: kit.basic || skill('enemy_single', [dmg(1)], { name: '기본' }),
    skill: kit.skill || skill('enemy_single', [dmg(2)], { name: '스킬' }),
    ultimate: kit.ultimate || skill('enemy_all', [dmg(1)], { name: '궁극', cost: 1000 }),
  };
  return {
    id,
    name: id,
    rarity,
    stats: cleanStats({ ...NO_CRIT, ...stats }),
    kit: cleanKit(raw, vocab, null, id),
    breakthroughs: cleanPassiveList(breakthroughs, vocab, null, id, 5),
  };
}

/** 적 하나 (actions/pattern/phases/enrage 정리됨). 기본: 아무것도 안 하는 허수아비, 속도 50 */
export function enemy(vocab, id, { stats = {}, actions, pattern, phases, enrage, passives = [], boss = false } = {}) {
  const behavior = cleanEnemyBehavior(
    { actions: actions || { idle: skill('self', [{ type: 'energy_gain', n: 0 }], { name: '대기', icon: 'buff' }) }, pattern, phases, enrage },
    vocab,
    null,
    id,
  );
  return { id, name: id, boss, stats: cleanStats({ ...NO_CRIT, spd: 50, ...stats }), ...behavior, passives: cleanPassiveList(passives, vocab, null, id, 8) };
}

/** 전투 데이터 묶음 */
export function mkData(vocab, chars, enemies, balanceOverride = {}) {
  const balance = loadConfig(balanceOverride, vocab);
  return { balance, charMap: new Map(chars.map((c) => [c.id, c])), enemyMap: new Map(enemies.map((e) => [e.id, e])) };
}

/** 적 한 마리짜리 스테이지 */
export const stageOf = (enemyIds, extra = {}) => ({ id: 'test', name: '테스트', waves: [enemyIds.map((enemyId) => ({ enemyId, level: 1 }))], roundLimit: 50, ...extra });

export const teamOf = (...ids) => ids.map((charId) => ({ charId, level: 1, breakthrough: 0 }));
