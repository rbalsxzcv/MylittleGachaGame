// 밸런스 툴킷 CLI (Node, AI 없음)
//   node tools/balance/cli.js tune [--apply] [--runs N] [--only id,…] — 자동 튜너 (작업 공간 데이터로 계산) → reports/tune-<날짜>.md/.json,
//                                                       --apply면 difficulty · hpScale을 작업 공간 + data/ 스테이지 파일에
//   node tools/balance/cli.js pace [--runs N]         — 지금 배율 그대로 권장 전투력 팀의 처치 턴 · 승률 · 남은 HP · 1타 비율 + 경제 표 (튜닝 없음, 출력만)
//   node tools/balance/cli.js eval [--runs N]         — 캐릭터 · 추억 · 장비 · 조합 평가 → reports/eval-<날짜>.md/.json
import fs from 'node:fs';
import { loadToolData } from '../lib/data.js';
import { tuneAll, tuneReport, winRateAt, economyReport, enemyParty } from './tuner.js';
import { economyCheck } from './economy.js';
import { recommendedPower, teamAtPower, sawtoothRatio } from './expected.js';
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
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
fs.mkdirSync('reports', { recursive: true });

if (cmd === 'tune') {
  const runs = opt('--runs', data.balance.tuner.runs);
  const t0 = Date.now();
  const only = flag('--only') ? new Set(String(args[args.indexOf('--only') + 1]).split(',')) : null;
  const tuneData = only ? { ...data, stages: data.stages.filter((s) => only.has(s.id)) } : data;
  const results = tuneAll(tuneData, { runs }, (i, n, r) =>
    console.log(
      `[${i}/${n}] ${r.stageId} ${r.stageType} 권장 ${r.recommended} (100% 팀 Lv${r.teamLevel}) → 난이도 ×${r.difficulty} HP ×${r.hpScale} · 내가 잡는 턴 ${r.myKill} (${r.target.myMin}~${r.target.myMax}) · 적이 잡는 턴 ${r.enemyKill} (${r.target.enemyMin}~${r.target.enemyMax >= 50 ? '' : r.target.enemyMax}) · 승률 ${pct(r.winRate)} · 남은 HP ${pct(r.hpLeft)}${r.ok ? '' : ' ⚠'} · 전투력 검사 ${(r.powerCheck || []).map((c) => `${Math.round(c.ratio * 100)}:${pct(c.winRate)}${c.ok ? '' : '⚠'}`).join(' ')} · ${r.iterations}번`,
    ),
  );
  const md = tuneReport(results, data.balance, economyCheck(data));
  fs.writeFileSync(`reports/tune-${stamp}.md`, md);
  fs.writeFileSync(`reports/tune-${stamp}.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(`보고서: reports/tune-${stamp}.md (${Math.round((Date.now() - t0) / 1000)}초)`);
  if (flag('--apply')) {
    const byId = new Map(results.map((r) => [r.stageId, r]));
    for (const dir of [WS, 'data']) {
      for (const ch of readJson(`${dir}/stages/index.json`)) {
        const p = `${dir}/stages/${ch}.json`;
        const j = readJson(p);
        for (const st of j.stages) {
          const r = byId.get(st.id);
          if (r) Object.assign(st, { difficulty: r.difficulty, hpScale: r.hpScale });
        }
        fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
      }
    }
    console.log('difficulty · hpScale을 작업 공간 + data/ 스테이지 파일에 저장했어요');
  }
} else if (cmd === 'pace') {
  const runs = opt('--runs', 60);
  for (const st of data.stages.filter((s) => !s.retired)) {
    const R = recommendedPower(st, data);
    const t = teamAtPower(st, data, R);
    const r = winRateAt(st, st.difficulty ?? 1, t.team, data, runs);
    console.log(
      `${st.id} ${st.stageType} 톱니 ${Math.round(sawtoothRatio(st, data) * 100)}% 권장 ${R} 적 ${enemyParty(st, data).power} (100% 팀 Lv${t.level}) ×${st.difficulty ?? 1}/HP×${st.hpScale ?? 1}` +
        ` · 내가 잡는 턴 ${r.myKill} · 적이 잡는 턴 ${r.enemyKill} · 승률 ${pct(r.winRate)} 남은 HP ${pct(r.hpLeft)} 라운드 ${r.winRounds} 사망 ${r.deaths} · 1타 아군→적 ${pct(r.allyHit)} 적→아군 ${pct(r.enemyHit)} (최대 ${pct(r.enemyMaxHit)})`,
    );
  }
  console.log(economyReport(economyCheck(data)).join('\n'));
} else if (cmd === 'eval') {
  const runs = opt('--runs', 100);
  const t0 = Date.now();
  const report = { characters: evaluateCharacters(data, { runs }), memories: evaluateMemories(data, { runs }), gear: evaluateGear(data, { runs }), combos: comboSearch(data, { teams: 200, runs: Math.max(10, Math.round(runs / 3)) }) };
  fs.writeFileSync(`reports/eval-${stamp}.md`, evalReport(report));
  fs.writeFileSync(`reports/eval-${stamp}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`보고서: reports/eval-${stamp}.md (${Math.round((Date.now() - t0) / 1000)}초)`);
} else {
  console.log('사용법: node tools/balance/cli.js tune [--apply] [--runs N] [--only id,…] | pace [--runs N] | eval [--runs N]');
  process.exit(1);
}
