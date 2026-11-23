// 스킬/돌파 설명 문장 만들기 — vocab.json의 text 틀에 숫자를 채웁니다.
// 틀 문법: {param} 값 채우기, [[ ... ]] 선택 구간 (안의 값이 비었거나 모두 기본값이면 생략)
// 특별 토큰: {target} 대상, {value} 지금 능력치로 계산한 수치, {delta} 강화/약화 증감
import { enumLabel } from './schema.js';

const VALUE_TYPES = { damage: true, heal: true, shield: true, dot: true };
/** 비율 능력치: 강화/약화가 % 포인트 (+20 → +0.20) */
const RATIO_STATS = new Set(['critRate', 'critDmg', 'energyRegen', 'effectHit', 'effectRes', 'healBonus', 'shieldBonus']);

function fmtNumber(n) {
  return Number.isInteger(n) ? n.toLocaleString('ko-KR') : String(Math.round(n * 100) / 100);
}

/** 파라미터 하나를 글자로 */
function fmtParam(spec, value, vocab) {
  if (value == null) return '';
  if (spec.kind === 'enum') return enumLabel(spec, value, vocab);
  if (spec.kind === 'targeting') return targetText(value, null, vocab);
  if (spec.format === 'pct') return `${Math.round(value * 1000) / 10}%`;
  if (spec.format === 'signed') return `${value > 0 ? '+' : ''}${fmtNumber(value)}`;
  return fmtNumber(value);
}

export function targetText(targeting, count, vocab) {
  if (!targeting) return '대상'; // 추가 효과처럼 행동의 대상을 따를 때
  const t = vocab.targeting[targeting];
  if (!t) return targeting;
  return t.text.replace('{count}', String(count ?? vocab.count.default));
}

/**
 * 틀 채우기
 * @param {string} template
 * @param {Record<string, any>} params 실제 값
 * @param {Record<string, object>} specs 파라미터 정의
 * @param {Record<string, string>} special 특별 토큰 (이미 글자)
 */
function render(template, params, specs, special, vocab) {
  const token = (name) => {
    if (name in special) return special[name] ?? '';
    const spec = specs[name];
    return spec ? fmtParam(spec, params[name], vocab) : '';
  };
  const withOptional = template.replace(/\[\[(.*?)\]\]/g, (_, inner) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (names.some((n) => token(n) === '')) return '';
    const paramNames = names.filter((n) => specs[n]);
    if (paramNames.length && paramNames.every((n) => params[n] === specs[n].default)) return '';
    return inner;
  });
  return withOptional.replace(/\{(\w+)\}/g, (_, n) => token(n));
}

/** 효과 강화 배율 (effect_power 수정자) */
function powerOf(effectPower, type, action) {
  let pct = 0;
  for (const m of effectPower || []) if (m.effect === type && (m.action === 'any' || m.action === action)) pct += m.pct;
  return Math.max(0, 1 + pct / 100);
}

/**
 * 효과 한 줄
 * @param {object} eff
 * @param {object} vocab
 * @param {{targeting?:string, count?:number, stats?:object, effectPower?:Array, action?:string}} [o]
 *   stats를 주면 "(현재 156)"처럼 실제 수치를 붙임
 */
export function describeEffect(eff, vocab, o = {}) {
  const def = vocab.effects[eff.type];
  if (!def) return `알 수 없는 효과 (${eff.type})`;
  const special = { target: targetText(eff.target || o.targeting, eff.target ? eff.count : o.count, vocab), value: '' };
  if (o.stats && VALUE_TYPES[eff.type]) {
    const key = eff.type === 'dot' ? 'atk' : eff.stat || def.params.stat?.default || 'atk';
    special.value = fmtNumber(Math.floor((o.stats[key] ?? 0) * eff.mult * powerOf(o.effectPower, eff.type, o.action)));
  }
  if (eff.type === 'buff' || eff.type === 'debuff') {
    const sign = (eff.type === 'buff') !== (eff.stat === 'dmgTaken') ? '+' : '−';
    const ratio = RATIO_STATS.has(eff.stat);
    special.delta = `${sign}${eff.pct}${ratio ? '%p' : '%'}`;
  }
  if (eff.type === 'stack_spend') special.spend = eff.n > 0 ? `−${eff.n}` : '전부 사용';
  // 안에 효과 목록이 있는 효과 (차지/소환)
  if (Array.isArray(eff.effects)) special.effects = eff.effects.map((e) => describeEffect(e, vocab, { ...o, targeting: eff.targeting })).join(', ') || '없음';
  let text = render(def.text, eff, def.params || {}, special, vocab);
  if (eff.chance != null && eff.chance < 100) text = `${eff.chance}% 확률로 ${text}`;
  return text;
}

/** 스킬의 효과 문장들 */
export function describeSkill(skill, vocab, o = {}) {
  if (!skill) return [];
  return skill.effects.map((e) => describeEffect(e, vocab, { ...o, targeting: skill.targeting, count: skill.count }));
}

export function describeCondition(c, vocab) {
  const def = vocab.conditions[c.type];
  return def ? render(def.label, c, def.params || {}, {}, vocab) : c.type;
}

export function describeModifier(m, vocab) {
  const def = vocab.modifiers[m.type];
  if (!def) return m.type;
  const special = {};
  if (m.type === 'extra_effects') {
    special.effects = m.effects.map((e) => describeEffect(e, vocab, { targeting: m.target })).join(', ');
  }
  if (m.type === 'action_targeting') special.targeting = targetText(m.targeting, m.count, vocab);
  return render(def.text, m, def.params || {}, special, vocab);
}

/** 패시브(돌파 능력) → 문장 목록 */
export function describePassive(p, vocab, o = {}) {
  const lines = [];
  if (p.trigger) {
    const tdef = vocab.triggers[p.trigger];
    let head = tdef ? render(tdef.label, p, tdef.params || {}, {}, vocab) : p.trigger;
    if (p.conditions?.length) head += ` (${p.conditions.map((c) => describeCondition(c, vocab)).join(', ')})`;
    const effects = p.effects.map((e) => describeEffect(e, vocab, { ...o, targeting: p.targeting, count: p.count, action: 'passive' }));
    if (effects.length) lines.push(`${head}: ${effects.join(', ')}`);
    else lines.push(head);
    if (p.limit) lines[lines.length - 1] += ` (전투당 ${p.limit}회)`;
    if (p.perRound) lines[lines.length - 1] += ` (라운드당 ${p.perRound}회)`;
  }
  for (const m of p.modifiers || []) lines.push(describeModifier(m, vocab));
  return lines;
}
