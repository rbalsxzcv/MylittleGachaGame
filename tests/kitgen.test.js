// tools/kitgen: 아키타입 10종 템플릿 + 결정론 키트 생성기 + 예산 (개발 도구 전용, 게임은 안 씀)
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { loadConfig, ROLES } from '../js/config.js';
import { createBattle } from '../js/battle/engine.js';
import { enemy, mkData, stageOf } from '../js/battle/testkit.js';
import { ARCHETYPES, generateKit, kitFields, budgetOf, archetypeSpread, suggestArchetype, hashSeed } from '../tools/kitgen/generate.js';
import { hasSlots } from '../tools/kitgen/budget.js';

const vocab = await loadJson('js/battle/vocab.json');
const balance = loadConfig(await loadJson('data/balance.json'), vocab);

/** 모든 아키타입 × 맞는 역할 × 희귀도 1–5 × 시드 */
function* everyKit(seeds = [1, 2, 3]) {
  for (const a of ARCHETYPES) for (const role of a.roles) for (let r = 1; r <= 5; r++) for (const seed of seeds) yield { a, role, r, seed, g: generateKit({ id: `char_9${r}${seed}`, role, rarity: r, archetype: a.id, seed, balance, vocab }) };
}

describe('키트 생성기: 아키타입 템플릿', () => {
  it('10종, 번호 1–10, id 겹침 없음, 역할은 4가지 중', () => {
    expect(ARCHETYPES.length).toBe(10);
    expect(ARCHETYPES.map((a) => a.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(ARCHETYPES.map((a) => a.id)).size).toBe(10);
    for (const a of ARCHETYPES) for (const r of a.roles) expect(ROLES.includes(r), `${a.id} ${r}`).toBe(true);
  });
  it('돌파2 변형 ≥3 · 돌파6 변형 ≥3 · 전용 추억 변형 ≥2 (id 겹침 없음)', () => {
    for (const a of ARCHETYPES) {
      expect(a.bt2.length >= 3, `${a.id} bt2`).toBe(true);
      expect(a.bt6.length >= 3, `${a.id} bt6`).toBe(true);
      expect(a.signature.length >= 2, `${a.id} signature`).toBe(true);
      for (const list of [a.bt2, a.bt6, a.signature]) expect(new Set(list.map((v) => v.id)).size, a.id).toBe(list.length);
    }
  });
  it('모든 변형 조합이 용어집 검사를 경고 없이 통과 (schema가 아무것도 버리지 않음)', () => {
    for (const a of ARCHETYPES) {
      for (const bt2 of a.bt2) for (const bt6 of a.bt6) for (const sig of a.signature) {
        const g = generateKit({ id: 'x', role: a.roles[0], rarity: 5, archetype: a.id, variants: { bt2: bt2.id, bt6: bt6.id, sig: sig.id }, balance, vocab });
        const schema = g.issues.filter((i) => i.where === 'schema');
        expect(schema.map((i) => i.message), `${a.id} ${bt2.id}/${bt6.id}/${sig.id}`).toEqual([]);
        expect(g.kitGen.variants).toEqual({ bt2: bt2.id, bt6: bt6.id, sig: sig.id });
      }
    }
  });
});

describe('키트 생성기: 결정론 · 예산', () => {
  it('같은 입력 → 같은 키트 (JSON 그대로), 시드가 없으면 id 해시', () => {
    const o = { id: 'char_0002', role: 'attacker', rarity: 5, archetype: 'stack_burst', balance, vocab };
    expect(JSON.stringify(generateKit(o))).toBe(JSON.stringify(generateKit(o)));
    expect(generateKit(o).kitGen.seed).toBe(hashSeed('char_0002'));
  });
  it('예산: 전체 97% 이상이 상한 ±5% 안, 4★/5★는 숫자 칸이 있는 템플릿이면 모두 안', () => {
    let total = 0;
    let ok = 0;
    const highMiss = [];
    for (const { a, role, r, seed, g } of everyKit()) {
      for (const [where, b] of Object.entries(g.budget)) {
        total += 1;
        if (b.ok) ok += 1;
        else if (r >= 4) {
          const tpl = where.startsWith('bt') ? a[where].find((v) => v.id === g.kitGen.variants[where]).passive : null;
          if (!tpl || hasSlots(tpl)) highMiss.push(`${a.id}/${role}/${r}★/시드${seed}/${where} ${b.pct}%`);
        }
      }
    }
    expect(ok / total >= 0.97, `${ok}/${total}`).toBe(true);
    expect(highMiss).toEqual([]);
  });
  it('희귀도가 낮을수록 상한이 작음 (3★ ≈ 5★의 70%)', () => {
    const g3 = generateKit({ id: 'x', role: 'attacker', rarity: 3, archetype: 'transform_carry', balance, vocab });
    const g5 = generateKit({ id: 'x', role: 'attacker', rarity: 5, archetype: 'transform_carry', balance, vocab });
    expect(g3.budget.skill.cap / g5.budget.skill.cap).toBeCloseTo(0.7, 1e-9);
    expect(g3.kit.skill.effects[0].mult < g5.kit.skill.effects[0].mult).toBe(true);
  });
  it('budgetOf: 저장한 키트의 예산을 다시 계산하면 생성 때와 같음', () => {
    const g = generateKit({ id: 'x', role: 'defender', rarity: 4, archetype: 'counter_tank', balance, vocab });
    const again = budgetOf({ rarity: 4, ...kitFields(g) }, balance);
    for (const k of ['basic', 'skill', 'ultimate', 'talent1', 'bt2', 'bt6']) expect(again[k].pct, k).toBe(g.budget[k].pct);
  });
});

describe('키트 생성기: 전투에서 실제로 돌아감', () => {
  it('모든 아키타입 × 희귀도: 돌파 6 키트로 자동 전투가 예외 없이 끝남', () => {
    const foe = enemy(vocab, 'f', { stats: { atk: 60, def: 20, hp: 4000, spd: 95 }, actions: { hit: { name: '공격', targeting: 'enemy_single', effects: [{ type: 'damage', mult: 1, stat: 'atk', hits: 1 }] } } });
    for (const { a, role, r, g } of everyKit([1])) {
      const c = { id: 'k', name: 'k', rarity: r, ...kitFields(g) };
      const team = [{ charId: 'k', level: 20, breakthrough: 6 }];
      const b = createBattle({ team, stage: stageOf(['f'], { roundLimit: 60 }), data: mkData(vocab, [c], [foe]), seed: 7 });
      b.runToEnd();
      expect(!!b.state.result, `${a.id}/${role}/${r}★`).toBe(true);
    }
  });
});

describe('키트 생성기: 로스터 분포', () => {
  it('아키타입별 수 + 덜 쓰인 것 추천 (역할이 맞는 것 중, 같으면 번호 순)', () => {
    const chars = [
      { id: 'a', rarity: 5, archetype: 'stack_burst' },
      { id: 'b', rarity: 4, kitGen: { archetype: 'mark_hunter' } },
      { id: 'n', rarity: 'npc', archetype: 'timeline' },
    ];
    const spread = archetypeSpread(chars);
    expect(spread.find((x) => x.id === 'stack_burst').count).toBe(1);
    expect(spread.find((x) => x.id === 'timeline').count).toBe(0); // NPC 제외
    expect(suggestArchetype(chars, 'attacker')).toBe('follow_up'); // 1·2번은 이미 있음 → 3번
    expect(suggestArchetype(chars, 'healer')).toBe('sustain_healer');
  });
});

describe('번들 분리', () => {
  it('게임(js/)은 tools/ · dev/를 import하지 않음', async () => {
    // 폴더를 직접 읽어야 해서 Node 러너에서만 (브라우저는 건너뜀)
    if (typeof process === 'undefined' || !process.versions?.node) return;
    const fs = await import('node:fs');
    const path = await import('node:path');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
    const bad = [];
    for (const f of walk('js')) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)) if (/(^|\/)(tools|dev)\//.test(m[1])) bad.push(`${f}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});
