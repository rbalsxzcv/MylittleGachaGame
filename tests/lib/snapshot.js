// 회귀 스냅샷: 모든 스테이지 × 기준 팀 × 시드 → 자동 전투 결과 (승패, 라운드, 캐릭터별 피해)
// 엔진/데이터/밸런스가 바뀌면 결과가 달라짐 → 커밋 전에 바뀐 내용을 확인하고 일부러 바꾼 거면 스냅샷 갱신
import { createBattle } from '../../js/battle/engine.js';
import { REFERENCE_TEAMS, SNAPSHOT_SEEDS } from '../fixtures/teams.js';
import { memoryPassives } from '../../js/systems/memories.js';
import { GEAR_SLOTS } from '../../js/config.js';

/** 기준 팀 멤버의 equip 설명 → extras (역할 기본 추억 + 장비 4칸) */
function withExtras(m, data) {
  if (!m.equip) return m;
  const c = data.charMap.get(m.charId);
  const mem = (data.memories || []).find((x) => x.kind === 'default' && x.role === c?.role);
  const inst = { lv: m.equip.memoryLevel, r: m.equip.refine };
  const extras = { gear: Object.fromEntries(GEAR_SLOTS.map((s) => [s, { ...m.equip.gear }])) };
  if (mem) Object.assign(extras, { memory: { entity: mem, level: inst.lv, refine: inst.r }, passives: memoryPassives(mem, inst, m.charId, data.balance) });
  return { charId: m.charId, level: m.level, breakthrough: m.breakthrough, extras };
}

export const SNAPSHOT_PATH = 'tests/snapshots/stages.json';

/** 지금 데이터로 스냅샷 계산 → { [stageId]: { [팀]: ['win 5r 120/88/…', …시드별] } } */
export function computeSnapshot(data) {
  const out = {};
  for (const stage of data.stages) {
    const row = {};
    for (const team of REFERENCE_TEAMS) {
      const members = team.members.filter((m) => data.charMap.has(m.charId)).map((m) => withExtras(m, data));
      row[team.name] = SNAPSHOT_SEEDS.map((seed) => {
        const b = createBattle({ team: members, stage, data, seed });
        b.runToEnd();
        const s = b.summary();
        return `${s.result} ${s.rounds}r ${s.units.map((u) => u.dealt).join('/')}`;
      });
    }
    out[stage.id] = row;
  }
  return out;
}

/** 두 스냅샷 비교 → 바뀐 줄 목록 (비면 같음) */
export function diffSnapshot(before, after) {
  const lines = [];
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const id of ids) {
    if (!before?.[id]) {
      lines.push(`+ ${id} (새 스테이지)`);
      continue;
    }
    if (!after?.[id]) {
      lines.push(`- ${id} (없어진 스테이지)`);
      continue;
    }
    for (const team of new Set([...Object.keys(before[id]), ...Object.keys(after[id])])) {
      const a = before[id][team] || [];
      const b = after[id][team] || [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) lines.push(`${id} [${team}] 시드${SNAPSHOT_SEEDS[i] ?? i + 1}: ${a[i] ?? '-'} → ${b[i] ?? '-'}`);
      }
    }
  }
  return lines;
}
