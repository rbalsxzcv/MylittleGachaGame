// 전투 데이터 정리(sanitize): 스킬 / 효과 / 돌파(패시브) / 능력치를 vocab.json 기준으로 정리합니다.
// - 모르는 효과·대상·발동 조건은 버리고 경고(warn)만 남깁니다. 나머지는 그대로 동작해요.
// - 숫자는 vocab의 min/max로 자르고, 빠진 값은 default로 채웁니다.
// 게임(data.js)과 개발 도구(폼 미리보기, 밸런스 시뮬레이터)가 같이 씁니다. DOM을 쓰지 않습니다.

export const ACTIONS = ['basic', 'skill', 'ultimate'];
export const STAT_KEYS = ['atk', 'def', 'hp', 'critRate', 'critDmg'];
const MAX_EFFECTS = 8;
const MAX_LIST = 8;

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** enum 파라미터의 선택지 목록 */
export function enumOptions(spec, vocab) {
  if (Array.isArray(spec.of)) return spec.of;
  return vocab.statGroups?.[spec.of] || [];
}

/** enum 값의 표시 이름 */
export function enumLabel(spec, value, vocab) {
  if (spec.labels && typeof spec.labels === 'object') return spec.labels[value] ?? value;
  if (spec.labels === 'stats') return vocab.stats[value] ?? value;
  if (spec.labels === 'actions') return vocab.actions[value] ?? value;
  return value;
}

/** 대상 지정 값이 쓸 수 있는지 (passiveOnly는 패시브에서만) */
export function targetingOk(value, vocab, { passive = false } = {}) {
  const t = vocab.targeting[value];
  return !!t && (passive || !t.passiveOnly);
}

function cleanNumber(v, spec, int) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n)) return spec.default ?? spec.min ?? 0;
  const x = int ? Math.round(n) : Math.round(n * 1000) / 1000;
  return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, x));
}

/** 파라미터 하나 정리 */
export function cleanParam(v, spec, vocab, ctx) {
  switch (spec.kind) {
    case 'number':
      return cleanNumber(v, spec, false);
    case 'int':
      return cleanNumber(v, spec, true);
    case 'enum': {
      const opts = enumOptions(spec, vocab);
      return opts.includes(v) ? v : spec.default ?? opts[0];
    }
    case 'targeting':
      return targetingOk(v, vocab, ctx) ? v : spec.default ?? 'self';
    case 'effects':
      return cleanEffectList(v, vocab, ctx.warn, `${ctx.where}.effects`, { ...ctx, nested: true });
    default:
      return v;
  }
}

/**
 * 효과 하나: { type, ...params, target?, count?, chance? }
 * @returns {object|null}
 */
export function cleanEffect(raw, vocab, warn, where, ctx = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const def = vocab.effects[raw.type];
  if (!def) {
    warn?.(`${where}: 알 수 없는 효과 '${raw.type}' → 건너뜀`);
    return null;
  }
  const out = { type: raw.type };
  for (const [key, spec] of Object.entries(def.params || {})) {
    out[key] = cleanParam(raw[key], spec, vocab, { ...ctx, warn, where });
  }
  if (raw.target != null && raw.target !== '') {
    if (targetingOk(raw.target, vocab, ctx)) out.target = raw.target;
    else warn?.(`${where}: 알 수 없는 대상 '${raw.target}' → 행동의 대상 사용`);
  }
  if (out.target && vocab.targeting[out.target]?.count) out.count = cleanNumber(raw.count, vocab.count, true);
  if (raw.chance != null && raw.chance !== '') {
    const c = cleanNumber(raw.chance, vocab.effectCommon.chance, true);
    if (c < 100) out.chance = c;
  }
  return out;
}

export function cleanEffectList(list, vocab, warn, where, ctx = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.slice(0, MAX_EFFECTS).forEach((e, i) => {
    // 효과 목록에는 효과(vocab.effects)만 들어감 → 추가 효과 안에 수정자가 또 들어갈 수 없음
    const c = cleanEffect(e, vocab, warn, `${where}[${i}]`, ctx);
    if (c) out.push(c);
  });
  return out;
}

/**
 * 스킬: { name, description, targeting, count?, cooldown?, initialCooldown?, cost?, effects[] }
 * 효과가 하나도 없으면 null
 */
export function cleanSkill(raw, kind, vocab, warn, where) {
  if (!raw || typeof raw !== 'object') return null;
  const targeting = targetingOk(raw.targeting, vocab) ? raw.targeting : null;
  if (!targeting) {
    warn?.(`${where}: 대상(targeting) '${raw.targeting}'을(를) 알 수 없음 → 건너뜀`);
    return null;
  }
  const effects = cleanEffectList(raw.effects, vocab, warn, `${where}.effects`);
  if (!effects.length) {
    warn?.(`${where}: 효과가 없음 → 건너뜀`);
    return null;
  }
  const out = { name: str(raw.name, 40) || vocab.actions[kind], description: str(raw.description), targeting, effects };
  if (vocab.targeting[targeting].count) out.count = cleanNumber(raw.count, vocab.count, true);
  if (kind === 'skill') {
    out.cooldown = cleanNumber(raw.cooldown, { min: 0, max: 20, default: 2 }, true);
    const ic = cleanNumber(raw.initialCooldown, { min: 0, max: 20, default: 0 }, true);
    if (ic) out.initialCooldown = ic;
  }
  if (kind === 'ultimate' && raw.cost != null && raw.cost !== '') {
    out.cost = cleanNumber(raw.cost, { min: 0, max: 1000, default: 100 }, true);
  }
  return out;
}

/** 조건 하나: { type, ...params } */
export function cleanCondition(raw, vocab, warn, where) {
  const def = raw && vocab.conditions[raw.type];
  if (!def) {
    warn?.(`${where}: 알 수 없는 조건 '${raw?.type}' → 건너뜀`);
    return null;
  }
  const out = { type: raw.type };
  for (const [key, spec] of Object.entries(def.params || {})) out[key] = cleanParam(raw[key], spec, vocab, { warn, where });
  return out;
}

/** 수정자 하나: { type, ...params } */
export function cleanModifier(raw, vocab, warn, where) {
  const def = raw && vocab.modifiers[raw.type];
  if (!def) {
    warn?.(`${where}: 알 수 없는 수정자 '${raw?.type}' → 건너뜀`);
    return null;
  }
  const out = { type: raw.type };
  for (const [key, spec] of Object.entries(def.params || {})) {
    if (key === 'count' && !vocab.targeting[out.targeting]?.count) continue;
    out[key] = cleanParam(raw[key], spec, vocab, { warn, where });
  }
  if (raw.type === 'extra_effects') {
    if (!out.effects.length) {
      warn?.(`${where}: 추가 효과가 비어 있음 → 건너뜀`);
      return null;
    }
    if (raw.target != null && targetingOk(raw.target, vocab)) out.target = raw.target;
  }
  return out;
}

/**
 * 돌파 능력 / 적 패시브
 * { name, description, trigger?, pct?, conditions[], targeting, count?, effects[], modifiers[], limit? }
 * - trigger가 없으면 modifiers만 쓰는 상시 능력
 * - 효과도 수정자도 없으면 이름/설명만 있는 능력 (돌파 표시는 됨)
 */
export function cleanPassive(raw, vocab, warn, where) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { name: str(raw.name, 40) || '돌파 능력', description: str(raw.description) };
  if (raw.trigger != null && raw.trigger !== '') {
    const tdef = vocab.triggers[raw.trigger];
    if (!tdef) warn?.(`${where}: 알 수 없는 발동 조건 '${raw.trigger}' → 발동 효과 없음`);
    else {
      out.trigger = raw.trigger;
      for (const [key, spec] of Object.entries(tdef.params || {})) out[key] = cleanParam(raw[key], spec, vocab, { warn, where });
    }
  }
  out.conditions = (Array.isArray(raw.conditions) ? raw.conditions.slice(0, MAX_LIST) : [])
    .map((c, i) => cleanCondition(c, vocab, warn, `${where}.conditions[${i}]`))
    .filter(Boolean);
  out.targeting = targetingOk(raw.targeting, vocab, { passive: true }) ? raw.targeting : 'self';
  if (vocab.targeting[out.targeting].count) out.count = cleanNumber(raw.count, vocab.count, true);
  out.effects = out.trigger ? cleanEffectList(raw.effects, vocab, warn, `${where}.effects`, { passive: true }) : [];
  if (!out.trigger && Array.isArray(raw.effects) && raw.effects.length) warn?.(`${where}: 발동 조건(trigger) 없이 effects가 있어서 무시함 (상시 능력은 modifiers 사용)`);
  out.modifiers = (Array.isArray(raw.modifiers) ? raw.modifiers.slice(0, MAX_LIST) : [])
    .map((m, i) => cleanModifier(m, vocab, warn, `${where}.modifiers[${i}]`))
    .filter(Boolean);
  if (raw.limit != null && raw.limit !== '') out.limit = cleanNumber(raw.limit, { min: 1, max: 99, default: 1 }, true);
  return out;
}

/**
 * 스킬 세트 { basic, skill, ultimate }. 빠졌거나 잘못된 칸은 fallback의 같은 칸 (없으면 null)
 * null 칸은 실행할 때 progression.kitOf가 기본 스킬로 채움 (적은 없는 대로)
 */
export function cleanKit(raw, vocab, warn, where, fallback = null) {
  if (!raw || typeof raw !== 'object') return null;
  const kit = {};
  for (const kind of ACTIONS) {
    const v = raw[kind];
    const cleaned = v == null ? null : cleanSkill(v, kind, vocab, warn, `${where}.${kind}`);
    kit[kind] = cleaned || (fallback?.[kind] ? structuredClone(fallback[kind]) : null);
  }
  return kit;
}

/** 기본 능력치(일부만 있어도 됨) → 숫자만 남김 */
export function cleanStats(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const lim = { atk: [0, 1e6], def: [0, 1e6], hp: [1, 1e7], critRate: [0, 1], critDmg: [0, 10] };
  for (const k of STAT_KEYS) {
    const n = Number(raw[k]);
    if (raw[k] != null && raw[k] !== '' && Number.isFinite(n)) out[k] = Math.min(lim[k][1], Math.max(lim[k][0], k.startsWith('crit') ? n : Math.round(n)));
  }
  return Object.keys(out).length ? out : null;
}

export function cleanPassiveList(list, vocab, warn, where, max = 5) {
  if (!Array.isArray(list)) return [];
  if (list.length > max) warn?.(`${where}: ${max}개까지만 사용 (${list.length}개)`);
  // 순서가 곧 돌파 단계라서, 잘못된 항목도 빈 능력으로 자리를 지킴
  return list
    .slice(0, max)
    .map((p, i) => cleanPassive(p, vocab, warn, `${where}[${i}]`) || { name: '돌파 능력', description: '', conditions: [], targeting: 'self', effects: [], modifiers: [] });
}
