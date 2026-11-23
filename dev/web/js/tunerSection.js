// 밸런스 탭: 자동 튜너 · 평가 (tools/balance — 순수 계산, AI 없음). 작업 공간 데이터로 브라우저에서 돌림
// 튜너: 스테이지마다 기준 팀으로 N판 → difficulty 이분 탐색 → 적용하면 스테이지 목록에 저장 / 보고서는 reports/에 저장
import { h, toast } from './ui.js';
import { api, tryApi } from './api.js';
import { state, reloadData } from './state.js';

const pct = (x) => (x == null ? '-' : `${Math.round(x * 1000) / 10}%`);
const stampNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '');
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

async function loadTools() {
  const [lib, tuner, evaluate] = await Promise.all([import('/preview/tools/lib/data.js'), import('/preview/tools/balance/tuner.js'), import('/preview/tools/balance/evaluate.js')]);
  const vocab = await fetch('/preview/js/battle/vocab.json', { cache: 'no-store' }).then((r) => r.json());
  const read = (p) => fetch(`/preview/${p}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${p} 없음`))));
  const data = await lib.loadToolData(read, 'data', vocab);
  return { data, tuner, evaluate };
}

export function tunerSection() {
  const runs = h('input', { type: 'number', class: 'num-input', min: 10, max: 2000, value: state.data.balance?.tuner?.runs ?? 300 });
  const progress = h('div', { class: 'muted small' });
  const out = h('div');
  let lastTune = null;

  async function runTune() {
    const { data, tuner } = await loadTools();
    const n = Math.max(10, parseInt(runs.value, 10) || 300);
    const stages = data.stages.filter((s) => !s.retired);
    const results = [];
    for (const [i, st] of stages.entries()) {
      progress.textContent = `튜닝 중… ${i + 1}/${stages.length} ${st.name}`;
      await nextFrame();
      results.push(tuner.tuneStage(st, data, { runs: n }));
    }
    progress.textContent = `끝 — 목표 안 ${results.filter((r) => r.ok).length}/${results.length}`;
    lastTune = { results, md: tuner.tuneReport(results, data.balance) };
    out.replaceChildren(
      h(
        'table',
        { class: 'sim-table' },
        h('tr', {}, ...['스테이지', '종류', '지금', '→ 난이도', '승률', '목표', '라운드'].map((t) => h('th', {}, t))),
        results.map((r) => h('tr', { class: r.ok ? '' : 'warn-row' }, h('td', {}, r.name || r.stageId), h('td', {}, r.stageType), h('td', {}, `×${data.stageMap.get(r.stageId)?.difficulty ?? 1}`), h('td', {}, `×${r.difficulty}`), h('td', {}, pct(r.winRate)), h('td', {}, pct(r.target)), h('td', {}, r.avgRounds))),
      ),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: applyTune }, '난이도 적용 (작업 공간 스테이지)'), h('button', { class: 'btn', onclick: () => saveReport('tune', lastTune.md, lastTune.results) }, '보고서 저장')),
    );
  }

  async function applyTune() {
    if (!lastTune) return;
    const by = new Map(lastTune.results.map((r) => [r.stageId, r.difficulty]));
    const list = state.data.stages.map((s) => (by.has(s.id) ? { ...s, difficulty: by.get(s.id) } : s));
    if ((await tryApi(() => api.put('/api/list/stages', list))) === null) return;
    await reloadData();
    toast(`스테이지 ${by.size}개 난이도를 저장했어요 (배포하면 게임에 반영)`, 'success');
  }

  async function runEval() {
    const { data, evaluate } = await loadTools();
    const n = Math.max(10, Math.round((parseInt(runs.value, 10) || 300) / 3));
    progress.textContent = '평가 중… (캐릭터 교체 테스트)';
    await nextFrame();
    const characters = evaluate.evaluateCharacters(data, { runs: n });
    progress.textContent = '평가 중… (추억 · 장비 · 조합)';
    await nextFrame();
    const report = { characters, memories: evaluate.evaluateMemories(data, { runs: n }), gear: evaluate.evaluateGear(data, { runs: n }), combos: evaluate.comboSearch(data, { teams: 150, runs: Math.max(10, Math.round(n / 3)) }) };
    progress.textContent = '평가 끝';
    const md = evaluate.evalReport(report);
    out.replaceChildren(
      h('h3', {}, '캐릭터 티어'),
      h(
        'table',
        { class: 'sim-table' },
        h('tr', {}, ...['티어', '캐릭터', '★', '아키타입', '돌0', '돌6', '전용 추억'].map((t) => h('th', {}, t))),
        characters.map((r) => h('tr', {}, h('td', {}, r.tier), h('td', {}, r.name), h('td', {}, r.rarity), h('td', {}, r.archetype), h('td', {}, `${pct(r.bt0.winRate)} · ${pct(r.bt0.share)}`), h('td', {}, `${pct(r.bt6.winRate)} · ${pct(r.bt6.share)}`), h('td', {}, r.sig ? pct(r.sig.winRate) : '-'))),
      ),
      h('h3', {}, '장비 곡선'),
      h('ul', {}, report.gear.map((g) => h('li', {}, `${g.chapter} T${g.regionTier}: 4칸 교체 기대 ${g.expectedRuns}판 · 첫 스테이지 승률 ${pct(g.winWithPrevTier)} → ${pct(g.winWithRegionTier)}`))),
      h('p', { class: 'muted small' }, '추억 교체 · 조합 상위 1%는 보고서에 있어요.'),
      h('button', { class: 'btn', onclick: () => saveReport('eval', md, report) }, '보고서 저장'),
    );
  }

  async function saveReport(kind, markdown, json) {
    const r = await tryApi(() => api.post('/api/reports', { name: `${kind}-${stampNow()}`, markdown, json }));
    if (r) toast(`저장했어요: ${r.path}`, 'success');
  }

  const guard = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      progress.textContent = `실패: ${e.message}`;
      console.error(e);
    }
  };
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, '자동 튜너 · 평가'),
    h('p', { class: 'muted small' }, '스테이지마다 기준 팀(기대 레벨 · 돌파 · 추억 · 장비, 챕터별 최고 희귀도)으로 시드 N판 AUTO 전투 → 난이도 배율을 목표 승률(일반 90 / 정예 75 / 보스 60%)에 맞춰요. CLI: node tools/balance/cli.js tune --apply'),
    h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, '판 수', runs), h('button', { class: 'btn primary', onclick: guard(runTune) }, '튜너 돌리기'), h('button', { class: 'btn', onclick: guard(runEval) }, '평가 돌리기')),
    progress,
    out,
  );
}
