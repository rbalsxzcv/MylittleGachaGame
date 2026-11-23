// 적 · 스테이지 수치 재계산 CLI (Node): node tools/enemygen/cli.js [--apply]
//   적: archetype(없으면 ENEMY_BOOTSTRAP) → 능력치 · 행동 효과 · 패턴 · 페이즈 · 광폭화 · 패시브 다시 (id/이름/그림/행동 이름/아이콘 유지)
//   스테이지: 적 레벨 = 기대 레벨, stageType, difficulty(있으면 유지), recommendedPower = 기대 전투력
//   작업 공간(dev/workspace/data)과 공개(data/)를 각각 따로 계산 (공개 안 한 그림이 공개 파일로 넘어가지 않게)
import fs from 'node:fs';
import { loadConfig } from '../../js/config.js';
import { regenerateEnemy, regenerateStage } from './generate.js';
import { ENEMY_BOOTSTRAP } from './archetypes.js';
import { loadToolData } from '../lib/data.js';
import { expectedPower } from '../balance/expected.js';

const apply = process.argv.includes('--apply');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readAsync = async (p) => readJson(p);
const write = (p, j) => fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
const vocab = readJson('js/battle/vocab.json');

for (const dir of ['dev/workspace/data', 'data']) {
  const balance = loadConfig(readJson(`${dir}/balance.json`), vocab);
  const enemies = readJson(`${dir}/enemies.json`);
  const out = [];
  for (const e of enemies) {
    const arch = e.archetype || ENEMY_BOOTSTRAP[e.id];
    if (!arch) {
      out.push(e);
      continue;
    }
    const { enemy, issues } = regenerateEnemy(e, arch, balance, vocab);
    out.push(enemy);
    console.log(`${dir} ${e.id} ${e.name} → ${arch} · 공 ${enemy.stats.atk} 방 ${enemy.stats.def} HP ${enemy.stats.hp} 속 ${enemy.stats.spd} · 패턴 ${enemy.pattern.map((p) => p.action).join('/')}`);
    for (const i of issues) console.log(`   경고: ${i}`);
  }
  const enemyMap = new Map(out.map((e) => [e.id, e]));
  const index = readJson(`${dir}/stages/index.json`);
  const files = index.map((id) => ({ id, path: `${dir}/stages/${id}.json`, json: readJson(`${dir}/stages/${id}.json`) }));
  let i = 0;
  for (const f of files) f.json.stages = f.json.stages.map((st) => regenerateStage(st, i++, enemyMap, balance));
  if (!apply) {
    console.log(`${dir}: 미리보기 (--apply로 저장)`);
    continue;
  }
  write(`${dir}/enemies.json`, out);
  for (const f of files) write(f.path, f.json);
  // 추천 전투력 = 기대 전투력 (새 적/스테이지로 다시 불러서 계산)
  const data = await loadToolData(readAsync, dir, vocab);
  for (const f of files) {
    for (const st of f.json.stages) {
      const s = data.stageMap.get(st.id);
      if (s) st.recommendedPower = expectedPower(s, data);
    }
    write(f.path, f.json);
  }
  console.log(`${dir}: 적 ${out.length}종 · 스테이지 ${i}개 저장`);
  for (const f of files) console.log('  ', f.id, f.json.stages.map((s) => `${s.id.slice(-2)}:${s.stageType[0]} Lv${s.waves[0][0].level} 추천 ${s.recommendedPower}`).join(' '));
}
