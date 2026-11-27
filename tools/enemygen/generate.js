// 적 · 스테이지 수치 재계산 (결정론, AI 없음) — 구조는 그대로 (id, 이름, 그림, NPC 연결, 행동 id/이름/아이콘, 페이즈 이름, 웨이브 구성)
import { ENEMY_TEMPLATES } from './archetypes.js';
import { cleanEnemyBehavior } from '../../js/battle/schema.js';
import { levelCapFor } from '../../js/config.js';

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
    critRate: balance.enemy.critRate,
    critDmg: balance.enemy.critDmg,
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

/** 예비 기대 레벨 곡선 (챕터 정보가 없을 때): 스테이지 전체 순서 i(0부터) */
export const expectedLevel = (i, balance) => Math.max(1, Math.round(balance.expected.levelStart + balance.expected.levelPerStage * i));

/**
 * 기대 레벨 = 레벨 상한 기준 경사. 챕터 c(0부터)를 하는 동안 상한 = levelCapFor(c) (앞 챕터 c개를 다 깼으므로)
 * 챕터 시작 = 첫 챕터면 levelStart, 아니면 이전 챕터 상한 − capGap → 챕터 끝(마지막 스테이지) = 이 챕터 상한 − capGap, 사이는 선형
 * @param {number} c 챕터 순서 @param {number} pos 챕터 안 순서(은퇴 제외) @param {number} n 챕터 스테이지 수(은퇴 제외)
 */
export function expectedLevelIn(c, pos, n, balance) {
  const E = balance.expected;
  const cap = (k) => levelCapFor(k, balance);
  const start = c <= 0 ? E.levelStart : cap(c - 1) - E.capGap;
  const end = Math.max(start, cap(c) - E.capGap);
  const t = n > 1 ? Math.min(1, pos / (n - 1)) : 1;
  return Math.max(1, Math.round(start + (end - start) * t));
}

/** 스테이지의 챕터 자리 {c, pos, n} (은퇴 스테이지는 세지 않음, 은퇴 스테이지 자신은 바로 앞 자리) — 챕터에 없으면 null */
export function chapterSlot(stageId, chapters, stageMap = null) {
  for (let c = 0; c < (chapters || []).length; c++) {
    const ids = chapters[c].stageIds || [];
    if (!ids.includes(stageId)) continue;
    const live = ids.filter((id) => id === stageId || !stageMap?.get(id)?.retired);
    const liveCount = ids.filter((id) => !stageMap?.get(id)?.retired).length;
    return { c, pos: live.indexOf(stageId), n: Math.max(1, liveCount) };
  }
  return null;
}

/** 스테이지 id → 기대 레벨 (챕터 경사, 챕터에 없으면 예비 곡선 0번) */
export function expectedLevelOf(stageId, chapters, balance, stageMap = null) {
  const s = chapterSlot(stageId, chapters, stageMap);
  return s ? expectedLevelIn(s.c, s.pos, s.n, balance) : expectedLevel(0, balance);
}

/** 웨이브 채우기: 최소 size명이 되게 그 웨이브의 보스 아닌 적을 앞에서부터 돌아가며 복제 (빼지는 않음, 최대 6, 보스뿐이면 그대로) */
export function padWave(wave, size, enemyMap) {
  const pool = wave.filter((x) => !enemyMap.get(x.enemyId)?.boss);
  const out = [...wave];
  for (let i = 0; out.length < Math.min(6, size) && pool.length; i++) out.push({ ...pool[i % pool.length] });
  return out;
}

/** 스테이지 다시 계산: 적 레벨 = 기대 레벨(level), stageType, 웨이브 최소 인원(enemy.waveSize[종류]), 라운드 제한 = tuner.roundLimit[종류], difficulty · hpScale(없으면 1 — 튜너가 정함) */
export function regenerateStage(stage, level, enemyMap, balance) {
  const stageType = stageTypeOf(stage, enemyMap);
  const size = balance.enemy.waveSize?.[stageType] ?? 0;
  return {
    ...stage,
    waves: stage.waves.map((w) => padWave(w, size, enemyMap).map((x) => ({ enemyId: x.enemyId, level }))),
    stageType,
    roundLimit: balance.tuner.roundLimit[stageType] ?? stage.roundLimit ?? null,
    difficulty: stage.difficulty ?? 1,
    hpScale: stage.hpScale ?? 1,
  };
}
