// 적 · 스테이지 수치 재계산 (결정론, AI 없음) — 구조는 그대로 (id, 이름, 그림, NPC 연결, 행동 id/이름/아이콘, 페이즈 이름, 웨이브 구성)
import { ENEMY_TEMPLATES } from './archetypes.js';
import { cleanEnemyBehavior } from '../../js/battle/schema.js';

const ROUND = (x) => Math.max(1, Math.round(x));

/** 적 하나 다시 만들기 (archetype이 없으면 그대로) */
export function regenerateEnemy(e, archetype, balance, vocab) {
  const tpl = ENEMY_TEMPLATES[archetype];
  if (!tpl) return e;
  const base = balance.enemy.base;
  const mul = balance.enemy.archetypes[archetype];
  const stats = {
    atk: ROUND(base.atk * mul.atk),
    def: ROUND(base.def * mul.def),
    hp: ROUND(base.hp * mul.hp),
    spd: ROUND(base.spd * mul.spd),
    critRate: 0.05,
    critDmg: 0.5,
    ...(mul.effectRes ? { effectRes: mul.effectRes } : {}),
  };
  const actions = {};
  for (const [id, a] of Object.entries(e.actions || {})) {
    const slot = tpl.slots[id] || tpl.slots.basic; // 칸 이름이 다른 행동은 기본 공격 템플릿
    const t = slot[a.icon] || slot.default;
    actions[id] = { name: a.name, description: a.description || '', icon: a.icon || 'attack', ...structuredClone(t), ...(t.big ? { big: true } : {}) };
    if (!t.big) delete actions[id].big;
  }
  const ids = Object.keys(actions);
  const keep = (pattern) => {
    const p = pattern.filter((x) => ids.includes(x.action));
    return p.length ? structuredClone(p) : [{ action: ids[0] }];
  };
  const out = { ...e, archetype, stats, actions, pattern: keep(tpl.pattern) };
  // 보스 페이즈: 이름은 그대로, 패턴 · 들어갈 때 효과는 템플릿 (개수는 템플릿에 맞춤)
  if (tpl.phases) out.phases = tpl.phases.map((ph, i) => ({ hpBelow: ph.hpBelow, name: e.phases?.[i]?.name || `페이즈 ${i + 2}`, pattern: keep(ph.pattern), enterEffects: structuredClone(ph.enterEffects) }));
  else delete out.phases;
  if (tpl.enrage) out.enrage = structuredClone(tpl.enrage);
  else delete out.enrage;
  out.passives = (tpl.passives || []).map((p, i) => ({ ...structuredClone(p), name: e.passives?.[i]?.name || p.name, description: e.passives?.[i]?.description || '', conditions: [], modifiers: [] }));
  // 용어집 검사 통과 확인 (경고가 나오면 템플릿 오류)
  const issues = [];
  cleanEnemyBehavior(out, vocab, (m) => issues.push(m), e.id);
  return { enemy: out, issues };
}

/** 스테이지 종류: 보스 적 → boss, 정예 적 → elite, 아니면 normal */
export function stageTypeOf(stage, enemyMap) {
  const arch = stage.waves.flat().map((w) => enemyMap.get(w.enemyId)?.archetype);
  if (arch.includes('boss') || stage.waves.flat().some((w) => enemyMap.get(w.enemyId)?.boss)) return 'boss';
  if (arch.includes('elite')) return 'elite';
  return 'normal';
}

/** 기대 레벨 (스테이지 전체 순서 i, 0부터) */
export const expectedLevel = (i, balance) => Math.max(1, Math.round(balance.expected.levelStart + balance.expected.levelPerStage * i));

/** 스테이지 다시 계산: 적 레벨 = 기대 레벨, stageType, difficulty(없으면 1 — 튜너가 정함) */
export function regenerateStage(stage, index, enemyMap, balance) {
  const level = expectedLevel(index, balance);
  return {
    ...stage,
    waves: stage.waves.map((w) => w.map((x) => ({ enemyId: x.enemyId, level }))),
    stageType: stageTypeOf(stage, enemyMap),
    difficulty: stage.difficulty ?? 1,
  };
}
