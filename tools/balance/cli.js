// 밸런스 툴킷 CLI (Node, AI 없음)
//   node tools/balance/cli.js tune [--apply] [--runs N]   — 자동 튜너 (작업 공간 데이터로 계산) → reports/tune-<날짜>.md/.json, --apply면 difficulty를 작업 공간 + data/ 스테이지 파일에
//   node tools/balance/cli.js eval [--runs N]             — 캐릭터 · 추억 · 장비 · 조합 평가 → reports/eval-<날짜>.md/.json
import fs from 'node:fs';
import { loadToolData } from '../lib/data.js';
import { tuneAll, tuneReport } from './tuner.js';
import { evaluateCharacters, evaluateMemories, evaluateGear, comboSearch, evalReport } from './evaluate.js';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const vocab = readJson('js/battle/vocab.json');
const WS = 'dev/workspace/data';
const data = await loadToolData(async (p) => readJson(p), WS, vocab);
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '');
fs.mkdirSync('reports', { recursive: true });

if (cmd === 'tune') {
  const runs = opt('--runs', data.balance.tuner.runs);
  const t0 = Date.now();
  const results = tuneAll(data, { runs }, (i, n, r) => console.log(`[${i}/${n}] ${r.stageId} ${r.stageType} → ×${r.difficulty} 승률 ${Math.round(r.winRate * 1000) / 10}% (목표 ${r.target * 100}%)${r.ok ? '' : ' ⚠'} · ${r.iterations}번`));
  const md = tuneReport(results, data.balance);
  fs.writeFileSync(`reports/tune-${stamp}.md`, md);
  fs.writeFileSync(`reports/tune-${stamp}.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(`보고서: reports/tune-${stamp}.md (${Math.round((Date.now() - t0) / 1000)}초)`);
  if (flag('--apply')) {
    const byId = new Map(results.map((r) => [r.stageId, r.difficulty]));
    for (const dir of [WS, 'data']) {
      for (const ch of readJson(`${dir}/stages/index.json`)) {
        const p = `${dir}/stages/${ch}.json`;
        const j = readJson(p);
        for (const st of j.stages) if (byId.has(st.id)) st.difficulty = byId.get(st.id);
        fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
      }
    }
    console.log('difficulty를 작업 공간 + data/ 스테이지 파일에 저장했어요');
  }
} else if (cmd === 'eval') {
  const runs = opt('--runs', 100);
  const t0 = Date.now();
  const report = { characters: evaluateCharacters(data, { runs }), memories: evaluateMemories(data, { runs }), gear: evaluateGear(data, { runs }), combos: comboSearch(data, { teams: 200, runs: Math.max(10, Math.round(runs / 3)) }) };
  fs.writeFileSync(`reports/eval-${stamp}.md`, evalReport(report));
  fs.writeFileSync(`reports/eval-${stamp}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`보고서: reports/eval-${stamp}.md (${Math.round((Date.now() - t0) / 1000)}초)`);
} else {
  console.log('사용법: node tools/balance/cli.js tune [--apply] [--runs N] | eval [--runs N]');
  process.exit(1);
}
