// 키트 생성기 CLI (Node): node tools/kitgen/cli.js bootstrap [--apply] [--force]
//   bootstrap: BOOTSTRAP 표대로 기존 캐릭터에 키트 생성 → 작업 공간(dev/workspace/data)과 공개(data/) characters.json 둘 다
//   이미 kitGen이 있는 캐릭터는 그대로 (승인한 내용은 안 바뀜) — --force면 다시 생성. --apply 없으면 미리보기만
import fs from 'node:fs';
import { loadConfig } from '../../js/config.js';
import { generateKit, kitFields } from './generate.js';
import { BOOTSTRAP } from './bootstrap.js';

const args = process.argv.slice(2);
const cmd = args[0];
const apply = args.includes('--apply');
const force = args.includes('--force');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const vocab = readJson('js/battle/vocab.json');

if (cmd !== 'bootstrap') {
  console.log('사용법: node tools/kitgen/cli.js bootstrap [--apply] [--force]');
  process.exit(1);
}

for (const file of ['dev/workspace/data/characters.json', 'data/characters.json']) {
  if (!fs.existsSync(file)) continue;
  const balance = loadConfig(readJson(file.replace('characters.json', 'balance.json')), vocab);
  const chars = readJson(file);
  let changed = 0;
  for (const c of chars) {
    const a = BOOTSTRAP[c.id];
    if (!a || (c.kitGen && !force)) continue;
    const g = generateKit({ id: c.id, role: a.role, rarity: c.rarity, archetype: a.archetype, balance, vocab });
    Object.assign(c, kitFields(g));
    changed += 1;
    const pct = Object.entries(g.budget).map(([k, b]) => `${k} ${b.pct}%`).join(', ');
    console.log(`${file} ${c.id} ${c.name} (${c.rarity}★ ${a.role} / ${a.archetype}): ${g.kit.basic.name} · ${g.kit.skill.name} · ${g.kit.ultimate.name}`);
    console.log(`   예산: ${pct}`);
    for (const i of g.issues) console.log(`   ${i.level}: ${i.where} ${i.message}`);
  }
  if (apply && changed) fs.writeFileSync(file, JSON.stringify(chars, null, 2) + '\n');
  console.log(`${file}: ${changed}명 ${apply ? '저장' : '(미리보기 — --apply로 저장)'}`);
}
