// 추억 생성기 CLI (Node): node tools/memgen/cli.js [--apply]
//   일반 라이브러리 + 5★ 전용 추억을 만들어 memories.json에 (작업 공간 + data/ 둘 다, 같은 id)
//   이미 있는 항목(genKey가 같음)은 id · 그림 · 공개 시각을 그대로 두고 수치만 다시 씀. 새 항목은 dev/ids.json에서 id 발급
import fs from 'node:fs';
import { loadConfig } from '../../js/config.js';
import { generateMemories, memoryFields } from './generate.js';

const apply = process.argv.includes('--apply');
const readJson = (p, def) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : def);
const vocab = readJson('js/battle/vocab.json');
const WS = 'dev/workspace/data';
const balance = loadConfig(readJson(`${WS}/balance.json`), vocab);
const characters = readJson(`${WS}/characters.json`, []);
const existing = readJson(`${WS}/memories.json`, []);
const ids = readJson('dev/ids.json');

const byKey = new Map(existing.filter((m) => m.genKey).map((m) => [m.genKey, m]));
const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00';
let next = Number(ids.next.memory || 1);
const out = [...existing.filter((m) => !m.genKey)]; // 손으로 만든 추억은 그대로
for (const g of generateMemories({ characters, balance, vocab })) {
  const prev = byKey.get(g.genKey);
  const entry = memoryFields(g, prev);
  if (!entry.id) entry.id = `memory_${String(next++).padStart(4, '0')}`;
  if (!entry.addedAt) entry.addedAt = now;
  out.push(entry);
  const b = Object.entries(g.budget).map(([k, v]) => `${k} ${v.pct}%`).join(', ');
  console.log(`${entry.id} ${prev ? '(유지)' : '(새로)'} ${g.rarity}★ ${g.kind} 「${g.name}」 · 부옵션 ${g.secondary.stat} · 예산 ${b}`);
  for (const i of g.issues) console.log(`   ${i.level}: ${i.where} ${i.message}`);
}
out.sort((a, b) => a.id.localeCompare(b.id));
if (apply) {
  ids.next.memory = next;
  fs.writeFileSync('dev/ids.json', JSON.stringify(ids, null, 2) + '\n');
  fs.writeFileSync(`${WS}/memories.json`, JSON.stringify(out, null, 2) + '\n');
  // 공개 파일에는 개발 도구 전용 칸(그림 장면 태그) 빼기 — publish.py DEV_ONLY_FIELDS와 같음
  const pub = out.map(({ theme, scene, ...rest }) => rest);
  fs.writeFileSync('data/memories.json', JSON.stringify(pub, null, 2) + '\n');
  console.log(`추억 ${out.length}개 저장 (${WS}, data) · 다음 id 번호 ${next}`);
} else console.log(`추억 ${out.length}개 (미리보기 — --apply로 저장)`);
