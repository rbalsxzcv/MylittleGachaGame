// 밸런스 탭: 자동 튜너 · 평가 (tools/balance — 순수 계산, AI 없음). 작업 공간 데이터로 브라우저에서 돌림
// 튜너: 스테이지마다 기준 팀으로 N판 → difficulty(승률) · hpScale(라운드) 번갈아 맞춤 → 적용하면 스테이지 목록에 저장 / 보고서는 reports/에 저장
import { h, toast } from './ui.js';
import { api, tryApi } from './api.js';
import { state, reloadData } from './state.js';

const pct = (x) => (x == null ? '-' : `${Math.round(x * 1000) / 10}%`);
const stampNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '');
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

async function loadTools() {
  const [lib, tuner, evaluate, economy] = await Promise.all([import('/preview/tools/lib/data.js'), import('/preview/tools/balance/tuner.js'), import('/preview/tools/balance/evaluate.js'), import('/preview/tools/balance/economy.js')]);
  const vocab = await fetch('/preview/js/battle/vocab.json', { cache: 'no-store' }).then((r) => r.json());
  const read = (p) => fetch(`/preview/${p}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${p} 없음`))));
  const data = await lib.loadToolData(read, 'data', vocab);
  return { data, tuner, evaluate, economy };
}

export function tunerSection() {
  const runs = h('input', { type: 'number', class: 'num-input', min: 10, max: 2000, value: state.data.balance?.tuner?.runs ?? 300 });
  const progress = h('div', { class: 'muted small' });
  const out = h('div');
  let lastTune = null;

  async function runTune() {
    const { data, tuner, economy } = await loadTools();
    const n = Math.max(10, parseInt(runs.value, 10) || 300);
    const stages = data.stages.filter((s) => !s.retired);
    const results = [];
    for (const [i, st] of stages.entries()) {
      progress.textContent = `튜닝 중… ${i + 1}/${stages.length} ${st.name}`;
      await nextFrame();
      results.push(tuner.tuneStage(st, data, { runs: n }));
    }
    progress.textContent = `끝 — 목표 안 ${results.filter((r) => r.ok).length}/${results.length}`;
    const eco = economy.economyCheck(data);
    lastTune = { results, md: tuner.tuneReport(results, data.balance, eco) };
    const cur = (id) => data.stageMap.get(id) || {};
    out.replaceChildren(
      h(
        'table',
        { class: 'sim-table' },
        h('tr', {}, ...['스테이지', '종류', '권장 / 적 전투력', '100% 팀 Lv', '난이도 (지금 → 새)', 'HP 배율 (지금 → 새)', '내가 잡는 턴', '적이 잡는 턴', '승률 · 남은 HP', '1타 아군→적 · 적→아군', '전투력별 승률 (80·90·100·120·150%)', '상한 Lv'].map((t) => h('th', {}, t))),
        results.map((r) =>
          h(
            'tr',
            { class: r.ok ? '' : 'warn-row' },
            h('td', {}, r.name || r.stageId),
            h('td', {}, r.stageType),
            h('td', {}, `${r.recommended} / ${r.enemyPower}`),
            h('td', {}, `${r.teamLevel}${Math.abs(r.teamPowerRatio - 1) > 0.05 ? ` (${pct(r.teamPowerRatio)})` : ''}`),
            h('td', {}, `×${cur(r.stageId).difficulty ?? 1} → ×${r.difficulty}`),
            h('td', {}, `×${cur(r.stageId).hpScale ?? 1} → ×${r.hpScale}`),
            h('td', { class: r.okMy ? '' : 'warn' }, `${r.myKill ?? '-'} (${r.target.myMin}~${r.target.myMax})`),
            h('td', { class: r.okEnemy ? '' : 'warn' }, `${r.enemyKill} (${r.target.enemyMin}~${r.target.enemyMax})`),
            h('td', {}, `${pct(r.winRate)} · ${pct(r.hpLeft)}`),
            h('td', {}, `${pct(r.allyHit)} · ${pct(r.enemyHit)} (최대 ${pct(r.enemyMaxHit)})`),
            h('td', { class: r.powerOk === false ? 'warn' : '' }, (r.powerCheck || []).map((c) => `${pct(c.winRate)}${c.checked && !c.ok ? '⚠' : ''}`).join(' · ')),
            h('td', {}, r.atCap ? `Lv${r.atCap.level} ${pct(r.atCap.winRate)} · ${r.atCap.winRounds ?? '-'}` : '-'),
          ),
        ),
      ),
      h('h3', {}, '경제 (기준 팀 5명을 기대 레벨까지, 누적)'),
      h('ul', {}, eco.map((e) => h('li', { class: e.ok ? '' : 'warn' }, `${e.chapter} Lv${e.fromLevel}→${e.toLevel}: 티켓 ${e.costTickets.toLocaleString()} / 수입 ${e.incomeTickets.toLocaleString()} · 골드 ${e.costGold.toLocaleString()} / ${e.incomeGold.toLocaleString()}${e.ok ? '' : ' ⚠ 모자람'}`))),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: applyTune }, '난이도 · HP 배율 적용 (작업 공간 스테이지)'), h('button', { class: 'btn', onclick: () => saveReport('tune', lastTune.md, lastTune.results) }, '보고서 저장')),
    );
  }

  async function applyTune() {
    if (!lastTune) return;
    const by = new Map(lastTune.results.map((r) => [r.stageId, r]));
    const list = state.data.stages.map((s) => (by.has(s.id) ? { ...s, difficulty: by.get(s.id).difficulty, hpScale: by.get(s.id).hpScale } : s));
    if ((await tryApi(() => api.put('/api/list/stages', list))) === null) return;
    await reloadData();
    toast(`스테이지 ${by.size}개 난이도 · HP 배율을 저장했어요 (배포하면 게임에 반영)`, 'success');
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
    h('p', { class: 'muted small' }, '스테이지마다 기준 팀(돌파 · 추억 · 장비는 기대 상태, 레벨로 전투력을 맞춤)으로 시드 N판 AUTO 전투 → 「권장 전투력」(기대 전투력 ÷ 톱니 비율) 팀으로 처치 턴을 맞춰요 — 난이도 배율(적 공격력) → 적이 나를 잡는 턴, HP 배율 → 내가 적을 잡는 턴. 그다음 권장의 80 · 90 · 100 · 120 · 150% 팀 승률을 확인(정예 · 보스는 전부, 일반은 100% 이상). CLI: node tools/balance/cli.js tune --apply'),
    h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, '판 수', runs), h('button', { class: 'btn primary', onclick: guard(runTune) }, '튜너 돌리기'), h('button', { class: 'btn', onclick: guard(runEval) }, '평가 돌리기')),
    progress,
    out,
  );
}
