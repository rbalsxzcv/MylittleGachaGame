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

/** 생성 결과 → memories.json에 쓰는 칸 (budget/issues 제외, 있던 id · 그림 · 공개 시각은 유지) */
export function memoryFields(gen, existing = null) {
  const { budget, issues, ...fields } = gen;
  return { ...(existing || {}), ...fields, id: existing?.id, image: existing?.image || '', thumb: existing?.thumb || '', addedAt: existing?.addedAt || '' };
}
