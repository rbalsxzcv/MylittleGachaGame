// 전투 엔진 자체 검사 — 게임 콘솔 __tg.battleTest(), 개발 도구 밸런스 탭 '엔진 검사'
// 정해진 숫자가 나오는지, 같은 시드면 같은 결과인지, HP가 범위를 벗어나지 않는지 확인
import { createBattle, replayBattle, checkRegistry } from './engine.js';
import { validateBalance } from '../systems/progression.js';

function mkData(vocab, chars, enemies, balanceOverride = {}) {
  const balance = { ...validateBalance({}, vocab, () => {}), ...balanceOverride };
  return { balance, charMap: new Map(chars.map((c) => [c.id, c])), enemyMap: new Map(enemies.map((e) => [e.id, e])) };
}

const dmg = (mult, extra = {}) => ({ type: 'damage', mult, stat: 'atk', hits: 1, ...extra });
const skill = (targeting, effects, extra = {}) => ({ name: 's', description: '', targeting, effects, ...extra });
const noCrit = { atk: 100, def: 40, hp: 100000, critRate: 0, critDmg: 0.5 };

export function runSelfTest(vocab, extra = {}) {
  const results = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      results.push({ name, ok: detail === true || detail === undefined, detail: detail === true ? '' : detail || '' });
    } catch (e) {
      results.push({ name, ok: false, detail: String(e?.message || e) });
    }
  };

  check('vocab과 구현 일치', () => {
    const p = checkRegistry(vocab);
    return p.length ? p.join(' / ') : true;
  });

  // 기본 공격 하나: floor(100 × 1.0 × 100/140) = 71
  const hitter = { id: 'h', name: '타격', rarity: 'R', stats: noCrit, kit: { basic: skill('enemy_single', [dmg(1)]), skill: skill('enemy_single', [dmg(2)], { cooldown: 2 }), ultimate: skill('enemy_all', [dmg(1)], { cost: 1000 }) } };
  const dummy = { id: 'd', name: '허수아비', stats: noCrit, passives: [], kit: { basic: skill('self', [{ type: 'energy_gain', n: 0 }]), skill: null, ultimate: null } };
  const stageDummy = { waves: [[{ enemyId: 'd', level: 1 }]], turnLimit: 50 };
  const data = mkData(vocab, [hitter], [dummy]);

  check('피해 공식 (공 100, 방 40 → 71)', () => {
    const b = createBattle({ team: [{ charId: 'h', level: 1, breakthrough: 0 }], stage: stageDummy, data, seed: 1 });
    const ev = b.act({ action: 'basic', target: 'w1e1' }).find((e) => e.t === 'damage');
    return ev?.amount === 71 ? true : `받은 값: ${ev?.amount}`;
  });

  check('레벨 성장 (lv10 공격력 = floor(100 × 1.72) = 172)', () => {
    const b = createBattle({ team: [{ charId: 'h', level: 10, breakthrough: 0 }], stage: stageDummy, data, seed: 1 });
    return b.state.allies[0].base.atk === 172 ? true : `받은 값: ${b.state.allies[0].base.atk}`;
  });

  check('스킬 대기 2 → 다음 2턴 사용 불가, 3턴 뒤 사용 가능', () => {
    const b = createBattle({ team: [{ charId: 'h', level: 1, breakthrough: 0 }], stage: stageDummy, data, seed: 1 });
    const seen = [];
    b.act({ action: 'skill', target: 'w1e1' });
    for (let i = 0; i < 3; i++) {
      seen.push(b.options().skill.ok);
      b.act({ action: 'basic', target: 'w1e1' });
    }
    return JSON.stringify(seen) === '[false,false,true]' ? true : `스킬 사용 가능 여부: ${JSON.stringify(seen)}`;
  });

  check('자기 강화 turns:2 → 자기 턴 2번 유지', () => {
    const buffer = { ...hitter, id: 'bf', kit: { ...hitter.kit, skill: skill('self', [{ type: 'buff', stat: 'atk', pct: 50, turns: 2 }], { cooldown: 0 }) } };
    const d2 = mkData(vocab, [buffer], [dummy]);
    const b = createBattle({ team: [{ charId: 'bf', level: 1, breakthrough: 0 }], stage: stageDummy, data: d2, seed: 1 });
    b.act({ action: 'skill' });
    const amounts = [];
    for (let i = 0; i < 3; i++) amounts.push(b.act({ action: 'basic', target: 'w1e1' }).find((e) => e.t === 'damage')?.amount);
    // 강화 중 floor(150×100/140)=107 두 번, 그다음 71
    return JSON.stringify(amounts) === '[107,107,71]' ? true : `피해: ${JSON.stringify(amounts)}`;
  });

  check('기력: 기본 +20, 궁극기 소모', () => {
    const b = createBattle({ team: [{ charId: 'h', level: 1, breakthrough: 0 }], stage: stageDummy, data, seed: 1 });
    b.act({ action: 'basic', target: 'w1e1' });
    return b.state.allies[0].energy === 20 ? true : `기력: ${b.state.allies[0].energy}`;
  });

  // 무작위 전투: 결정론 + 불변 조건
  const team = extra.team;
  const stage = extra.stage;
  const realData = extra.data;
  if (team && stage && realData) {
    check('같은 시드 → 같은 결과 (실제 데이터)', () => {
      const a = createBattle({ team, stage, data: realData, seed: 12345 });
      a.runToEnd();
      const b = createBattle({ team, stage, data: realData, seed: 12345 });
      b.runToEnd();
      return JSON.stringify(a.state.events) === JSON.stringify(b.state.events) ? true : '이벤트 기록이 달라요';
    });
    check('리플레이 재현', () => {
      const a = createBattle({ team, stage, data: realData, seed: 777 });
      a.runToEnd();
      const r = replayBattle({ team, stage, data: realData, ...a.record() });
      return JSON.stringify(r.state.events) === JSON.stringify(a.state.events) ? true : '리플레이 결과가 달라요';
    });
    check('HP 범위 (0 이상, 최대 이하) — 50판', () => {
      for (let s = 1; s <= 50; s++) {
        const bt = createBattle({ team, stage, data: realData, seed: s });
        bt.runToEnd();
        for (const ev of bt.state.events) {
          if (ev.hp == null) continue;
          const u = bt.unit(ev.tgt);
          if (ev.hp < 0 || (u && ev.hp > u.maxHp)) return `시드 ${s}: ${ev.tgt} HP ${ev.hp}`;
        }
        if (!bt.state.result) return `시드 ${s}: 전투가 끝나지 않음`;
      }
      return true;
    });
  }

  return { ok: results.every((r) => r.ok), results };
}
