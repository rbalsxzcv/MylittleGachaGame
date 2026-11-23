// 전투 데이터 폼: 게임의 용어집(vocab.json)으로 드롭다운/숫자 칸을 만듦 — 코드를 직접 쓰지 않음
// 폼은 넘겨받은 객체를 그 자리에서 고치고 onChange()를 부릅니다.
// 미리보기 문장은 게임과 같은 describe.js(/preview/js/battle/describe.js)로 만듭니다.
import { h } from './ui.js';

let vocab = null;
let gameMods = null;

/** 용어집 + 게임 모듈(설명 문장, 능력치 계산, 데이터 정리) 불러오기 */
export async function loadBattleKit() {
  if (vocab && gameMods) return { vocab, ...gameMods };
  const [v, describe, progression, data, schema] = await Promise.all([
    fetch('/preview/js/battle/vocab.json', { cache: 'no-store' }).then((r) => r.json()),
    import('/preview/js/battle/describe.js'),
    import('/preview/js/systems/progression.js'),
    import('/preview/js/core/data.js'),
    import('/preview/js/battle/schema.js'),
  ]);
  vocab = v;
  gameMods = { describe, progression, data, schema };
  return { vocab, ...gameMods };
}

const ACTION_LABEL = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기' };

/** 게임과 같은 규칙으로 조용히 정리 (경고는 버림) — 미리보기/전투력/시뮬레이션용 */
export function cleanEntity(raw, { enemy = false } = {}) {
  const { schema } = gameMods;
  const quiet = () => {};
  const out = { ...raw, stats: schema.cleanStats(raw.stats) };
  if (enemy) {
    // 적: 행동 + 패턴 + 페이즈 + 광폭화 (예전 kit도 변환) — 게임 data.js validateEnemies와 같음
    Object.assign(out, schema.cleanEnemyBehavior(raw, vocab, quiet, raw.id || '?'));
    delete out.kit;
    out.passives = schema.cleanPassiveList(raw.passives, vocab, quiet, 'passives', 8);
  } else {
    out.kit = schema.cleanKit(raw.kit, vocab, quiet, raw.id || '?');
    // 등급: 1–5 또는 'npc' (예전 'R'/'SR'/'SSR'은 3/4/5, pullable: false는 NPC) — 게임 data.js와 같음
    out.rarity = raw.pullable === false ? 'npc' : gameMods.data.normalizeGrade(raw.rarity) || 3;
    out.pullable = out.rarity !== 'npc';
    out.role = gameMods.data.ROLES.includes(raw.role) ? raw.role : 'attacker';
    out.statTweak = schema.cleanTweak(raw.statTweak);
    out.resource = schema.cleanResource(raw.resource);
    out.talents = schema.cleanPassiveList(raw.talents, vocab, quiet, 'talents', 4);
    out.bt2 = raw.bt2 ? schema.cleanPassive(raw.bt2, vocab, quiet, 'bt2') : null;
    out.bt6 = raw.bt6 ? schema.cleanPassive(raw.bt6, vocab, quiet, 'bt6') : null;
    out.breakthroughs = schema.cleanPassiveList(raw.breakthroughs, vocab, quiet, 'breakthroughs', 6);
  }
  return out;
}

function enumOptions(spec) {
  if (Array.isArray(spec.of)) return spec.of;
  return vocab.statGroups?.[spec.of] || [];
}
function enumLabel(spec, v) {
  if (spec.labels && typeof spec.labels === 'object') return spec.labels[v] ?? v;
  if (spec.labels === 'stats') return vocab.stats[v] ?? v;
  if (spec.labels === 'actions') return vocab.actions[v] ?? v;
  return v;
}
function targetingOptions(passive) {
  return Object.entries(vocab.targeting).filter(([, t]) => passive || !t.passiveOnly);
}

/** 기본값으로 채운 새 효과 */
export function newEffect(type = 'damage') {
  const def = vocab.effects[type];
  const e = { type };
  for (const [k, spec] of Object.entries(def.params || {})) e[k] = spec.kind === 'effects' ? [] : spec.default;
  return e;
}
export function newModifier(type) {
  const def = vocab.modifiers[type];
  const m = { type };
  for (const [k, spec] of Object.entries(def.params || {})) {
    if (k === 'count') continue;
    m[k] = spec.kind === 'effects' ? [newEffect('damage')] : spec.default;
  }
  return m;
}
export function newCondition(type) {
  const def = vocab.conditions[type];
  const c = { type };
  for (const [k, spec] of Object.entries(def.params || {})) c[k] = spec.default;
  return c;
}
export function blankPassive() {
  return { name: '', description: '', conditions: [], targeting: 'self', effects: [], modifiers: [] };
}

function select(options, value, onChange, extra = {}) {
  const el = h('select', { ...extra, onchange: (e) => onChange(e.target.value) }, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value ?? '';
  return el;
}

function numberInput(spec, value, onChange, extra = {}) {
  return h('input', {
    type: 'number',
    class: 'num-input',
    min: spec.min,
    max: spec.max,
    step: spec.step ?? (spec.kind === 'int' ? 1 : 0.05),
    value: value ?? '',
    placeholder: spec.default != null ? String(spec.default) : '',
    title: `${spec.label || ''} (${spec.min}~${spec.max})`,
    oninput: (e) => {
      // 빈 칸 → 기본값 (기본값이 없으면 null = '설정 안 함')
      if (e.target.value === '') return onChange(spec.default ?? null);
      const n = Number(e.target.value);
      if (Number.isFinite(n)) onChange(spec.kind === 'int' ? Math.round(n) : n);
    },
    ...extra,
  });
}

/** 파라미터 하나의 입력 칸 */
function paramField(spec, key, obj, onChange, { passive = false, rerender } = {}) {
  const set = (v) => {
    obj[key] = v;
    onChange();
  };
  let input;
  if (spec.kind === 'number' || spec.kind === 'int') input = numberInput(spec, obj[key], set);
  else if (spec.kind === 'enum') input = select(enumOptions(spec).map((v) => [v, enumLabel(spec, v)]), obj[key], set);
  else if (spec.kind === 'targeting') {
    input = select(targetingOptions(passive).map(([k, t]) => [k, t.label]), obj[key], (v) => (set(v), rerender?.()));
  } else if (spec.kind === 'effects') {
    obj[key] = obj[key] || [];
    return h('div', { class: 'bf-nested' }, h('div', { class: 'muted small' }, spec.label || '효과'), effectList(obj[key], { onChange, passive, nested: true }));
  }
  return h('label', { class: 'bf-param' }, h('span', {}, spec.label || key), input);
}

/** 효과 한 줄 편집 */
function effectEditor(eff, { onChange, onRemove, onMove, passive, allowTarget = true }) {
  const box = h('div', { class: 'bf-effect' });
  const render = () => {
    const def = vocab.effects[eff.type];
    const typeSel = select(
      Object.entries(vocab.effects).map(([k, e]) => [k, `${e.label} (${k})`]),
      eff.type,
      (v) => {
        for (const k of Object.keys(eff)) if (!['target', 'count', 'chance'].includes(k)) delete eff[k];
        Object.assign(eff, newEffect(v));
        onChange();
        render();
      },
    );
    const params = Object.entries(def?.params || {}).map(([k, spec]) => paramField(spec, k, eff, onChange, { passive }));
    const targetSel =
      allowTarget &&
      select(
        [['', '(행동의 대상)'], ...targetingOptions(passive).map(([k, t]) => [k, t.label])],
        eff.target || '',
        (v) => {
          if (v) eff.target = v;
          else delete eff.target;
          if (!vocab.targeting[v]?.count) delete eff.count;
          else eff.count = eff.count || vocab.count.default;
          onChange();
          render();
        },
      );
    const countInput = eff.target && vocab.targeting[eff.target]?.count && numberInput(vocab.count, eff.count, (n) => ((eff.count = n), onChange()));
    const chance = numberInput(vocab.effectCommon.chance, eff.chance ?? '', (n) => {
      if (!n || n >= 100) delete eff.chance;
      else eff.chance = n;
      onChange();
    });
    box.replaceChildren(
      h(
        'div',
        { class: 'row wrap' },
        typeSel,
        ...params,
        targetSel && h('label', { class: 'bf-param' }, h('span', {}, '대상'), targetSel),
        countInput && h('label', { class: 'bf-param' }, h('span', {}, '횟수'), countInput),
        h('label', { class: 'bf-param' }, h('span', {}, '확률%'), chance),
        h('span', { class: 'grow' }),
        onMove && h('button', { class: 'btn tiny', onclick: () => onMove(-1) }, '▲'),
        onMove && h('button', { class: 'btn tiny', onclick: () => onMove(1) }, '▼'),
        h('button', { class: 'btn tiny', onclick: onRemove }, '✕'),
      ),
    );
  };
  render();
  return box;
}

/** 효과 목록 (+ 효과 추가) */
export function effectList(list, { onChange, passive = false, nested = false }) {
  const host = h('div', { class: 'bf-effects' });
  const render = () => {
    host.replaceChildren(
      ...list.map((eff, i) =>
        effectEditor(eff, {
          passive,
          onChange,
          onRemove: () => (list.splice(i, 1), onChange(), render()),
          onMove: (d) => {
            const j = i + d;
            if (j < 0 || j >= list.length) return;
            [list[i], list[j]] = [list[j], list[i]];
            onChange();
            render();
          },
        }),
      ),
      h('button', { class: 'btn tiny', onclick: () => (list.push(newEffect('damage')), onChange(), render()) }, nested ? '+ 추가 효과' : '+ 효과'),
    );
  };
  render();
  return host;
}

/**
 * 스킬 폼 (기본 공격 / 스킬 / 궁극기)
 * @param {object} skill 고칠 객체
 * @param {'basic'|'skill'|'ultimate'|'enemy'} kind  enemy = 적 행동 (비용 없음)
 * @param {{onChange:()=>void, preview?:()=>string[], title?:string}} o
 */
export function skillForm(skill, kind, { onChange, preview, title }) {
  const box = h('div', { class: ['bf-skill', `bf-${kind}`] });
  const prev = h('ul', { class: 'bf-preview' });
  const changed = () => {
    onChange();
    refreshPreview();
  };
  const refreshPreview = () => prev.replaceChildren(...(preview?.() || []).map((t) => h('li', {}, t)));
  const render = () => {
    const tSel = select(
      targetingOptions(false).map(([k, t]) => [k, t.label]),
      skill.targeting,
      (v) => {
        skill.targeting = v;
        if (vocab.targeting[v].count) skill.count = skill.count || vocab.count.default;
        else delete skill.count;
        changed();
        render();
      },
    );
    box.replaceChildren(
      h('div', { class: 'bf-title' }, title || ACTION_LABEL[kind] || '행동', kind === 'skill' && h('span', { class: 'muted small' }, ' · 팀 SP 1 사용 (대기 시간 없음)')),
      h(
        'div',
        { class: 'row wrap' },
        h('label', { class: 'bf-param grow' }, h('span', {}, '이름'), h('input', { value: skill.name || '', oninput: (e) => ((skill.name = e.target.value), changed()) })),
        h('label', { class: 'bf-param' }, h('span', {}, '대상'), tSel),
        vocab.targeting[skill.targeting]?.count && h('label', { class: 'bf-param' }, h('span', {}, '횟수'), numberInput(vocab.count, skill.count, (n) => ((skill.count = n), changed()))),
        kind === 'ultimate' &&
          h(
            'label',
            { class: 'bf-param' },
            h('span', {}, '기력 소모'),
            numberInput({ kind: 'int', min: 0, max: 1000, default: null }, skill.cost ?? '', (n) => {
              if (n == null || Number.isNaN(n)) delete skill.cost;
              else skill.cost = n;
              changed();
            }, { placeholder: '기본(100)' }),
          ),
      ),
      h('label', { class: 'bf-param wide' }, h('span', {}, '설명'), h('input', { value: skill.description || '', oninput: (e) => ((skill.description = e.target.value), changed()) })),
      effectList(skill.effects, { onChange: changed }),
      prev,
    );
    refreshPreview();
  };
  render();
  return { el: box, refresh: refreshPreview };
}

/** 돌파 능력 / 적 패시브 폼 */
export function passiveForm(p, { onChange, preview, title }) {
  const box = h('div', { class: 'bf-passive' });
  const prev = h('ul', { class: 'bf-preview' });
  const refreshPreview = () => prev.replaceChildren(...(preview?.() || []).map((t) => h('li', {}, t)));
  const changed = () => {
    onChange();
    refreshPreview();
  };
  p.conditions = p.conditions || [];
  p.effects = p.effects || [];
  p.modifiers = p.modifiers || [];
  const render = () => {
    const trig = select(
      [['', '(상시 능력 — 수정자만)'], ...Object.entries(vocab.triggers).map(([k, t]) => [k, t.label.replace('{pct}', 'N')])],
      p.trigger || '',
      (v) => {
        if (v) p.trigger = v;
        else delete p.trigger;
        for (const [k, spec] of Object.entries(vocab.triggers[v]?.params || {})) p[k] = p[k] ?? spec.default;
        if (v !== 'onHpBelow') delete p.pct;
        if (!v) p.effects = [];
        changed();
        render();
      },
    );
    const tdef = p.trigger && vocab.triggers[p.trigger];
    const conds = h(
      'div',
      { class: 'bf-list' },
      p.conditions.map((c, i) =>
        h(
          'div',
          { class: 'row wrap bf-cond' },
          select(Object.entries(vocab.conditions).map(([k, cd]) => [k, cd.label.replace(/\{\w+\}/g, 'N')]), c.type, (v) => ((p.conditions[i] = newCondition(v)), changed(), render())),
          ...Object.entries(vocab.conditions[c.type]?.params || {}).map(([k, spec]) => paramField(spec, k, c, changed)),
          h('button', { class: 'btn tiny', onclick: () => (p.conditions.splice(i, 1), changed(), render()) }, '✕'),
        ),
      ),
      p.trigger && h('button', { class: 'btn tiny', onclick: () => (p.conditions.push(newCondition('chance')), changed(), render()) }, '+ 조건'),
    );
    const mods = h(
      'div',
      { class: 'bf-list' },
      p.modifiers.map((m, i) =>
        h(
          'div',
          { class: 'bf-mod' },
          h(
            'div',
            { class: 'row wrap' },
            select(Object.entries(vocab.modifiers).map(([k, md]) => [k, `${md.label} (${k})`]), m.type, (v) => ((p.modifiers[i] = newModifier(v)), changed(), render())),
            ...Object.entries(vocab.modifiers[m.type]?.params || {})
              .filter(([k, spec]) => spec.kind !== 'effects' && (k !== 'count' || vocab.targeting[m.targeting]?.count))
              .map(([k, spec]) => paramField(spec, k, m, changed, { rerender: render })),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn tiny', onclick: () => (p.modifiers.splice(i, 1), changed(), render()) }, '✕'),
          ),
          m.type === 'extra_effects' && effectList(m.effects, { onChange: changed, nested: true }),
        ),
      ),
      h('button', { class: 'btn tiny', onclick: () => (p.modifiers.push(newModifier('stat_bonus')), changed(), render()) }, '+ 수정자 (상시)'),
    );
    // replaceChildren은 undefined를 글자로 넣으므로 빈 칸은 걸러냄 (상시 능력이면 p.trigger 칸들이 비어 있음)
    box.replaceChildren(
      ...[
      title && h('div', { class: 'bf-title' }, title),
      h(
        'div',
        { class: 'row wrap' },
        h('label', { class: 'bf-param grow' }, h('span', {}, '이름'), h('input', { value: p.name || '', oninput: (e) => ((p.name = e.target.value), changed()) })),
        h('label', { class: 'bf-param' }, h('span', {}, '발동'), trig),
        tdef && Object.entries(tdef.params || {}).map(([k, spec]) => paramField(spec, k, p, changed)),
        p.trigger && h('label', { class: 'bf-param' }, h('span', {}, '대상'), select(targetingOptions(true).map(([k, t]) => [k, t.label]), p.targeting || 'self', (v) => ((p.targeting = v), changed()))),
        p.trigger &&
          h(
            'label',
            { class: 'bf-param' },
            h('span', {}, '전투당 횟수'),
            numberInput({ kind: 'int', min: 1, max: 99, default: null }, p.limit ?? '', (n) => {
              if (!n) delete p.limit;
              else p.limit = n;
              changed();
            }, { placeholder: '제한 없음' }),
          ),
      ),
      h('label', { class: 'bf-param wide' }, h('span', {}, '설명'), h('input', { value: p.description || '', oninput: (e) => ((p.description = e.target.value), changed()) })),
      p.trigger && h('div', { class: 'bf-sub' }, h('div', { class: 'muted small' }, '추가 조건 (모두 만족)'), conds),
      p.trigger && h('div', { class: 'bf-sub' }, h('div', { class: 'muted small' }, '발동 효과'), effectList(p.effects, { onChange: changed, passive: true })),
      h('div', { class: 'bf-sub' }, h('div', { class: 'muted small' }, '상시 수정자'), mods),
      prev,
      ].filter(Boolean),
    );
    refreshPreview();
  };
  render();
  return { el: box };
}

/**
 * 기본 능력치 폼. 빈 칸 = 희귀도 기본값 (적은 required로 모든 칸 필수)
 * @param {object} stats 고칠 객체 (빈 칸은 키를 지움)
 * @param {object} defaults 빈 칸일 때 쓰는 값 (자리 표시)
 */
export function statsForm(stats, defaults, { onChange }) {
  const row = (key, label, spec) =>
    h(
      'label',
      { class: 'bf-param' },
      h('span', {}, label),
      numberInput({ ...spec, default: null }, stats[key] ?? '', (n) => {
        if (n == null || Number.isNaN(n)) delete stats[key];
        else stats[key] = n;
        onChange();
      }, { placeholder: String(defaults[key] ?? '') }),
    );
  return h(
    'div',
    { class: 'row wrap bf-stats' },
    row('atk', '공격력', { kind: 'int', min: 0, max: 1e6 }),
    row('def', '방어력', { kind: 'int', min: 0, max: 1e6 }),
    row('hp', 'HP', { kind: 'int', min: 1, max: 1e7 }),
    row('spd', '속도', { kind: 'int', min: 1, max: 1000 }),
    row('critRate', '치명타 확률', { kind: 'number', min: 0, max: 1, step: 0.01 }),
    row('critDmg', '치명타 피해', { kind: 'number', min: 0, max: 10, step: 0.05 }),
  );
}

/** 검사 결과 목록 */
export function issueList(issues) {
  if (!issues?.length) return h('p', { class: 'ok-text small' }, '검사 통과 ✓');
  return h(
    'ul',
    { class: 'warn-list' },
    issues.map((i) => h('li', { class: i.level === 'error' ? 'error' : 'warn' }, `${i.level === 'error' ? '오류' : '주의'} · ${i.where}: ${i.message}`)),
  );
}

/** 전투력 이상치 경고: 같은 희귀도 평균보다 pct% 이상 높으면 문장 반환 */
export function powerWarning({ progression }, char, battle, others, balance) {
  const entity = { ...char, ...battle };
  const pw = progression.powerOf(progression.statsOf(entity, 1, 0, balance), balance);
  const same = others.filter((c) => c.rarity === char.rarity && c.id !== char.id);
  if (!same.length) return { power: pw, avg: null, warn: null };
  const avg = same.reduce((a, c) => a + progression.powerOf(progression.statsOf(c, 1, 0, balance), balance), 0) / same.length;
  const over = (pw / avg - 1) * 100;
  return { power: pw, avg: Math.round(avg), warn: over > balance.powerWarnPct ? `같은 희귀도(${char.rarity}★) 평균 ${Math.round(avg)}보다 ${Math.round(over)}% 높아요 (기준 ${balance.powerWarnPct}%)` : null };
}
