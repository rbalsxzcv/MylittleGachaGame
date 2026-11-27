// 추억 생성기 (결정론, AI 없음): 일반 라이브러리 + 5★ 캐릭터마다 전용 추억 1장
// 결과는 memories.json 항목 (id는 부르는 쪽이 발급 — genKey로 다시 돌려도 같은 항목에 붙음)
import { GENERIC_MEMORIES, SIGNATURE_SECONDARY } from './library.js';
import { solve, passivePoints, capFor, report } from '../kitgen/budget.js';
import { generateKit, hashSeed, fillName } from '../kitgen/generate.js';
import { ARCHETYPE_MAP } from '../kitgen/archetypes.js';
import { cleanPassive } from '../../js/battle/schema.js';
import { normalizeRarity } from '../../js/config.js';

/** 템플릿 → 정리된 패시브 (상한에 맞추고, 모자라면 fillStat 상시 보너스로 채움) */
function buildPassive(tpl, { cap, B, vocab, fillStat, issues, where }) {
  const name = tpl.names[0];
  const quiet = (msg) => issues.push({ level: 'warning', where, message: msg });
  const toPassive = (inst) => cleanPassive({ ...inst, name, description: fillName(tpl.blurb, '자원') }, vocab, quiet, where);
  const res = solve(tpl, (inst) => passivePoints(toPassive(inst), B), cap, { preferUnder: true });
  let p = toPassive(res.value);
  let points = res.points;
  if (points < cap * (1 - B.tolerancePct / 100) && fillStat) {
    const pct = Math.min(40, Math.round((cap - points) / (B.modifierPoints.stat_bonus * 2 * (B.statWeight[fillStat] ?? 1))));
    if (pct >= 1) {
      p = toPassive({ ...res.value, modifiers: [...(res.value.modifiers || []), { type: 'stat_bonus', stat: fillStat, pct }] });
      points = passivePoints(p, B);
    }
  }
  return { passive: p, budget: report(points, cap, B) };
}

/**
 * 추억 항목 만들기
 * @param {{characters:Array, balance:object, vocab:object}} o characters: 원본(characters.json) — 5★ + kitGen 있는 캐릭터마다 전용 추억
 * @returns {Array<object>} memories.json 항목 (id/image/addedAt 없음, genKey 있음) + budget, issues
 */
export function generateMemories({ characters, balance, vocab }) {
  const B = balance.kitBudget;
  const out = [];
  for (const m of GENERIC_MEMORIES) {
    const issues = [];
    const cap = capFor('signature', m.rarity, B);
    const { passive, budget } = buildPassive(m.passive, { cap, B, vocab, fillStat: m.secondary.stat, issues, where: m.key });
    out.push({
      genKey: `generic:${m.key}`,
      name: m.name,
      rarity: m.rarity,
      kind: m.role ? 'default' : 'generic',
      ...(m.role ? { role: m.role } : {}),
      secondary: { stat: m.secondary.stat },
      passive: { generic: passive },
      theme: m.theme,
      budget: { generic: budget },
      issues,
    });
  }
  // 전용 추억: 5★ 캐릭터의 아키타입 signature 변형 (키트 생성기와 같은 시드 → 같은 결과)
  for (const c of characters) {
    if (normalizeRarity(c.rarity) !== 5 || !c.kitGen?.archetype) continue;
    const arch = ARCHETYPE_MAP.get(c.kitGen.archetype);
    if (!arch) continue;
    const g = generateKit({ id: c.id, role: c.role || arch.roles[0], rarity: 5, archetype: arch.id, variants: c.kitGen.variants, seed: c.kitGen.seed ?? hashSeed(c.id), balance, vocab });
    const sig = arch.signature.find((v) => v.id === g.kitGen.variants.sig);
    out.push({
      genKey: `signature:${c.id}`,
      name: sig?.generic?.names?.[0] || `${c.name}의 기억`,
      rarity: 5,
      kind: 'signature',
      signatureOf: c.id,
      featuredCharacterId: c.id,
      secondary: { stat: SIGNATURE_SECONDARY[arch.id] || 'atk' },
      passive: { generic: g.signature.generic, owner: g.signature.owner },
      theme: [`${sig?.label || arch.label}`, c.title || '', 'signature moment'],
      budget: { generic: g.budget['signature.generic'], owner: g.budget['signature.owner'] },
      issues: g.issues.filter((i) => i.where.startsWith('signature')),
    });
  }
  return out;
}

/** 생성 결과 → memories.json에 쓰는 칸 (budget/issues 제외, 있던 id · 그림 · 공개 시각은 유지)
 *  생성 결과는 다 채워진 카드라 빈 칸 표시(draft)는 지움 */
export function memoryFields(gen, existing = null) {
  const { budget, issues, ...fields } = gen;
  const out = { ...(existing || {}), ...fields, id: existing?.id, image: existing?.image || '', thumb: existing?.thumb || '', addedAt: existing?.addedAt || '' };
  delete out.draft;
  return out;
}

/** 생성기 결과를 지금 목록에 합치기 (웹 '생성기로 다시 만들기' · cli.js 공용, id 발급은 부르는 쪽)
 *  genKey가 같으면 같은 항목에 (id · 그림 · 공개 시각 유지). 생성기가 이번에 만들지 않은 genKey 항목은 지우지 않고 그대로 둠
 *  (예: 키트가 아직 없는 5★의 빈 전용 칸, 5★가 아니게 된 캐릭터의 전용 추억 — 지우면 가진 카드가 사라지고 id가 삭제로 남음)
 *  @returns {{entries:Array, fresh:Array, kept:Array}} entries = 새 목록(새 항목은 id 없음), fresh = 새 항목, kept = 그대로 둔 genKey 항목 */
export function mergeGenerated(existing, gens) {
  const byKey = new Map(existing.filter((m) => m.genKey).map((m) => [m.genKey, m]));
  const made = new Set(gens.map((g) => g.genKey));
  const entries = existing.filter((m) => !m.genKey || !made.has(m.genKey));
  const kept = existing.filter((m) => m.genKey && !made.has(m.genKey));
  const fresh = [];
  for (const g of gens) {
    const prev = byKey.get(g.genKey);
    const entry = memoryFields(g, prev);
    if (!prev) fresh.push(entry);
    entries.push(entry);
  }
  return { entries, fresh, kept };
}
