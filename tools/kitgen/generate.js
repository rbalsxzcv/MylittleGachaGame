// 결정론 키트 생성기: 역할 + 희귀도 + 아키타입 + 변형 + 시드 → 완성 키트 (AI 없음)
// 같은 입력 = 같은 출력. 결과는 characters.json에 저장 → 다시 돌려도 저장한 키트는 안 바뀜 (명시적 '다시 생성'만)
// 게임(js/)은 이 파일을 쓰지 않음 (개발 도구 / 테스트 / tools CLI 전용)
import { ARCHETYPES, ARCHETYPE_MAP } from './archetypes.js';
import { solve, skillPoints, passivePoints, capFor, report } from './budget.js';
import { createRng } from '../../js/core/rng.js';
import { cleanSkill, cleanPassive } from '../../js/battle/schema.js';
import { ROLES, normalizeRarity } from '../../js/config.js';

export const GEN_VERSION = 1;
/** 패시브 예산이 모자랄 때 채우는 상시 능력치 (역할별) */
const FILLER_STAT = { attacker: 'atk', defender: 'hp', support: 'energyRegen', healer: 'healBonus' };
export { ARCHETYPES, ARCHETYPE_MAP };

/** 문자열 → 32비트 시드 (FNV-1a) */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

/** 변형 고르기 (지정한 건 그대로, 없는 칸만 시드로) → { bt2, bt6, sig } (변형 id) */
export function pickVariants(arch, seed, given = {}) {
  const rng = createRng(hashSeed(`${seed}:${arch.id}:variants`));
  const ok = (list, id) => list.some((v) => v.id === id);
  const choose = (list, id) => (ok(list, id) ? id : pick(rng, list).id);
  return { bt2: choose(arch.bt2, given.bt2), bt6: choose(arch.bt6, given.bt6), sig: choose(arch.signature, given.sig) };
}

/**
 * 키트 만들기
 * @param {object} o
 * @param {string} o.id 캐릭터 id (기본 시드)
 * @param {string} o.role attacker|defender|support|healer
 * @param {number} o.rarity 1–5
 * @param {string} o.archetype 아키타입 id
 * @param {{bt2?:string, bt6?:string, sig?:string}} [o.variants]
 * @param {number} [o.seed]
 * @param {object} o.balance loadConfig 결과
 * @param {object} o.vocab
 */
export function generateKit({ id, role, rarity, archetype, variants = {}, seed, balance, vocab }) {
  const arch = ARCHETYPE_MAP.get(archetype);
  if (!arch) throw new Error(`알 수 없는 아키타입: ${archetype}`);
  const B = balance.kitBudget;
  const r = normalizeRarity(rarity) || 3;
  const s = seed ?? hashSeed(id || archetype);
  const rng = createRng(hashSeed(`${s}:${arch.id}:names`));
  const issues = [];
  if (!ROLES.includes(role)) issues.push({ level: 'error', where: 'role', message: `역할을 알 수 없어요: ${role}` });
  else if (!arch.roles.includes(role)) issues.push({ level: 'warning', where: 'role', message: `${arch.label}은(는) 보통 ${arch.roles.join('/')} 역할이에요 (지금 ${role})` });

  const resName = arch.resource ? pick(rng, arch.resource.names) : '';
  const resource = arch.resource ? { name: resName, cap: arch.resource.cap, start: arch.resource.start || 0 } : null;
  const cap = resource?.cap || 0;
  const blurb = (t) => (t || '').replaceAll('{res}', resName || '자원');
  const quiet = (msg) => issues.push({ level: 'warning', where: 'schema', message: msg });
  const budget = {};

  // 스킬: 템플릿 → 칸 맞추기 → schema 정리 (vocab 규칙을 그대로 통과한 값만)
  const buildSkill = (tpl, kind, slotKey, where) => {
    const name = pick(rng, tpl.names);
    const toSkill = (inst) => cleanSkill({ name, description: blurb(tpl.blurb), targeting: inst.targeting, count: inst.count, effects: inst.effects, useIf: inst.useIf }, kind, vocab, quiet, where);
    const target = capFor(slotKey, r, B);
    const res = solve(tpl, (inst) => skillPoints(toSkill(inst), B, cap), target);
    budget[where] = report(res.points, target, B);
    return toSkill(res.value);
  };
  // 패시브: 칸을 다 키워도 모자라면 역할 주 능력치 상시 보너스로 채움 (결정론 — 모자란 점수 ÷ 능력치 점수)
  const buildPassive = (tpl, slotKey, where) => {
    const name = pick(rng, tpl.names);
    const toPassive = (inst) => cleanPassive({ ...inst, name, description: blurb(tpl.blurb) }, vocab, quiet, where);
    const target = capFor(slotKey, r, B);
    const res = solve(tpl, (inst) => passivePoints(toPassive(inst), B, cap), target, { preferUnder: true });
    let p = toPassive(res.value);
    let points = res.points;
    if (points < target * (1 - B.tolerancePct / 100)) {
      const stat = FILLER_STAT[role] || 'atk';
      const per = B.modifierPoints.stat_bonus * 2 * (B.statWeight[stat] ?? 1);
      const pct = Math.min(40, Math.round((target - points) / per));
      if (pct >= 1) {
        p = toPassive({ ...res.value, modifiers: [...(res.value.modifiers || []), { type: 'stat_bonus', stat, pct }] });
        points = passivePoints(p, B, cap);
      }
    }
    budget[where] = report(points, target, B);
    return p;
  };

  const kit = {
    basic: buildSkill(arch.basic, 'basic', 'basic', 'basic'),
    skill: buildSkill(arch.skill, 'skill', 'skill', 'skill'),
    ultimate: buildSkill(arch.ultimate, 'ultimate', 'ultimate', 'ultimate'),
  };
  if (arch.transformed) {
    kit.transformed = {};
    for (const [kind, tpl] of Object.entries(arch.transformed)) kit.transformed[kind] = buildSkill(tpl, kind, kind, `transformed.${kind}`);
  }
  const talents = (arch.talents || []).map((tpl, i) => buildPassive(tpl, 'talent', `talent${i + 1}`));
  const v = pickVariants(arch, s, variants);
  const bt2 = { ...buildPassive(arch.bt2.find((x) => x.id === v.bt2).passive, 'bt2', 'bt2') };
  const bt6 = { ...buildPassive(arch.bt6.find((x) => x.id === v.bt6).passive, 'bt6', 'bt6') };
  const sigTpl = arch.signature.find((x) => x.id === v.sig);
  // 전용 추억 패시브 (5★만 실제로 씀): 일반 부분 + 주인 보너스가 합쳐서 signature 상한
  const signature = {
    generic: buildPassive(sigTpl.generic, 'signature', 'signature.generic'),
    owner: buildPassive(sigTpl.owner, 'signature', 'signature.owner'),
  };
  for (const key of ['signature.generic', 'signature.owner']) budget[key] = report(budget[key].points, budget[key].cap, B); // 각각 상한 기준

  for (const [where, b] of Object.entries(budget)) if (!b.ok) issues.push({ level: 'warning', where, message: `예산 ${b.pct}% (점수 ${b.points} / 상한 ${b.cap}) — ±${B.tolerancePct}% 밖` });

  return {
    role,
    archetype: arch.id,
    kitGen: { archetype: arch.id, variants: v, seed: s, version: GEN_VERSION },
    resource,
    kit,
    talents,
    bt2,
    bt6,
    signature,
    budget,
    issues,
  };
}

/** 생성 결과 중 characters.json에 쓰는 칸만 */
export function kitFields(gen) {
  const out = { role: gen.role, archetype: gen.archetype, kitGen: gen.kitGen, kit: gen.kit, talents: gen.talents, bt2: gen.bt2, bt6: gen.bt6 };
  if (gen.resource) out.resource = gen.resource;
  return out;
}

/** 지금 키트의 예산 다시 계산 (수동 편집 뒤 검사용) → { 칸: report } */
export function budgetOf(c, balance) {
  const B = balance.kitBudget;
  const r = normalizeRarity(c.rarity) || 3;
  const cap = c.resource?.cap || 0;
  const out = {};
  for (const k of ['basic', 'skill', 'ultimate']) if (c.kit?.[k]) out[k] = report(skillPoints(c.kit[k], B, cap), capFor(k, r, B), B);
  for (const [k, sk] of Object.entries(c.kit?.transformed || {})) out[`transformed.${k}`] = report(skillPoints(sk, B, cap), capFor(k, r, B), B);
  (c.talents || []).forEach((p, i) => (out[`talent${i + 1}`] = report(passivePoints(p, B, cap), capFor('talent', r, B), B)));
  if (c.bt2) out.bt2 = report(passivePoints(c.bt2, B, cap), capFor('bt2', r, B), B);
  if (c.bt6) out.bt6 = report(passivePoints(c.bt6, B, cap), capFor('bt6', r, B), B);
  return out;
}

// ── 로스터 분포 ──────────────────────────────────────────
/** 아키타입별 캐릭터 수 (NPC 제외) → [{ id, label, no, count, ids }] (번호 순) */
export function archetypeSpread(characters) {
  const players = characters.filter((c) => c.rarity !== 'npc');
  return ARCHETYPES.map((a) => {
    const ids = players.filter((c) => (c.archetype || c.kitGen?.archetype) === a.id).map((c) => c.id);
    return { id: a.id, label: a.label, no: a.no, roles: a.roles, count: ids.length, ids };
  });
}

/** 덜 쓰인 아키타입 추천 (역할이 맞는 것 중 수가 적은 순, 같으면 번호 순 → 결정론) */
export function suggestArchetype(characters, role) {
  const spread = archetypeSpread(characters);
  const fit = spread.filter((a) => !role || a.roles.includes(role));
  return [...(fit.length ? fit : spread)].sort((a, b) => a.count - b.count || a.no - b.no)[0]?.id || ARCHETYPES[0].id;
}
