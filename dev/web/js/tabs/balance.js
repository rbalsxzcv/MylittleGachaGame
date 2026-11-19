// 밸런스 탭
// 1) 시뮬레이터: 팀(캐릭터·레벨·돌파) vs 스테이지, 시드 1..N 자동 전투 → 승률, 평균 라운드, 캐릭터별 피해
//    게임과 같은 전투 엔진(/preview/js/battle/)을 작업 공간 데이터로 돌림 → 같은 시드면 항상 같은 결과
// 2) 전투력 표: 희귀도별 평균보다 크게 높은 캐릭터 경고
// 3) balance.json 편집 (성장률, 레벨업 비용, 기력, 전투력 가중치, 기본 스킬…)
import { h, toast } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';
import { loadBattleKit, cleanEntity, skillForm, issueList } from '../battleForm.js';

const CHUNK = 20;
const num = (n) => Number(n).toLocaleString('ko-KR');

// 탭을 다시 열어도 마지막 팀 유지
let lastTeam = null;

export function balanceTab(root, { select } = {}) {
  let destroyed = false;
  const left = h('div', { class: 'col-left' });
  const right = h('div', { class: 'col-right' });
  root.replaceChildren(h('div', { class: 'two-col' }, left, right));
  left.append(h('p', { class: 'muted' }, '불러오는 중…'));

  (async () => {
    const kitMods = await loadBattleKit();
    const { vocab, progression, data: gameData } = kitMods;
    const [sim, selftest] = await Promise.all([import('/preview/js/battle/sim.js'), import('/preview/js/battle/selftest.js')]);

    /** 작업 공간 데이터 → 게임과 같은 모양 */
    function gameDataNow() {
      const balance = progression.validateBalance(state.data.balance, vocab, () => {});
      const characters = state.data.characters.map((c) => cleanEntity(c));
      const enemies = state.data.enemies.map((e) => cleanEntity(e, { enemy: true }));
      const stages = gameData.validateStages(state.data.stages);
      return { balance, characters, stages, charMap: new Map(characters.map((c) => [c.id, c])), enemyMap: new Map(enemies.map((e) => [e.id, e])) };
    }

    // ── 팀 / 스테이지 고르기 ──
    const chars = state.data.characters;
    const team =
      lastTeam ||
      chars
        .slice(0, 5)
        .map((c) => ({ charId: c.id, level: 1, breakthrough: 0 }))
        .concat(Array(Math.max(0, 5 - chars.length)).fill(null))
        .slice(0, 5);
    lastTeam = team;
    const stageSel = h('select', {}, state.data.stages.map((st) => h('option', { value: st.id }, `${st.name} (${st.id})`)));
    if (select && state.data.stages.some((s) => s.id === select)) stageSel.value = select;
    const runs = h('input', { type: 'number', class: 'num-input', min: 1, max: 5000, value: 200 });
    const seedStart = h('input', { type: 'number', class: 'num-input', min: 1, value: 1 });
    const teamBox = h('div', { class: 'sim-team' });

    function renderTeam() {
      teamBox.replaceChildren(
        ...team.map((m, i) => {
          const sel = h('select', { onchange: (e) => ((team[i] = e.target.value ? { charId: e.target.value, level: m?.level || 1, breakthrough: m?.breakthrough || 0 } : null), renderTeam()) }, h('option', { value: '' }, '(빈 칸)'), chars.map((c) => h('option', { value: c.id }, `${c.name} (${c.rarity})`)));
          sel.value = m?.charId || '';
          return h(
            'div',
            { class: 'row' },
            h('b', {}, `${i + 1}`),
            sel,
            m && h('label', { class: 'inline' }, 'Lv', h('input', { type: 'number', class: 'num-input', min: 1, value: m.level, oninput: (e) => (m.level = Math.max(1, parseInt(e.target.value, 10) || 1)) })),
            m && h('label', { class: 'inline' }, '돌파', h('input', { type: 'number', class: 'num-input', min: 0, max: 5, value: m.breakthrough, oninput: (e) => (m.breakthrough = Math.min(5, Math.max(0, parseInt(e.target.value, 10) || 0))) })),
          );
        }),
        h(
          'div',
          { class: 'row wrap' },
          h('span', { class: 'muted small' }, '한꺼번에:'),
          ...[1, 5, 10, 20].map((lv) => h('button', { class: 'btn tiny', onclick: () => (team.forEach((m) => m && (m.level = lv)), renderTeam()) }, `Lv.${lv}`)),
          ...[0, 5].map((bt) => h('button', { class: 'btn tiny', onclick: () => (team.forEach((m) => m && (m.breakthrough = bt)), renderTeam()) }, `돌파 ${bt}`)),
        ),
      );
    }
    renderTeam();

    const progress = h('div', { class: 'progress' }, h('i', { style: { width: '0%' } }));
    const result = h('div');
    let running = false;

    async function runSim() {
      if (running) return;
      const data = gameDataNow();
      const stage = data.stages.find((s) => s.id === stageSel.value);
      if (!stage) return toast('스테이지를 골라 주세요 (스테이지 탭에서 먼저 만들기)', 'error');
      const members = team.map((m) => (m && data.charMap.has(m.charId) ? { ...m } : null));
      if (!members.some(Boolean)) return toast('팀에 캐릭터를 넣어 주세요', 'error');
      const n = Math.min(5000, Math.max(1, parseInt(runs.value, 10) || 200));
      const s0 = Math.max(1, parseInt(seedStart.value, 10) || 1);
      running = true;
      const out = [];
      for (let i = 0; i < n && !destroyed; i += CHUNK) {
        for (let k = i; k < Math.min(n, i + CHUNK); k++) out.push(sim.runOne({ team: members, stage, data, seed: s0 + k }));
        progress.firstChild.style.width = `${(out.length / n) * 100}%`;
        await new Promise((r) => setTimeout(r, 0));
      }
      running = false;
      if (destroyed) return;
      const agg = sim.aggregate(out);
      const teamPower = members.reduce((a, m) => (m ? a + progression.powerOf(progression.statsOf(data.charMap.get(m.charId), m.level, m.breakthrough, data.balance), data.balance) : a), 0);
      const maxDealt = Math.max(1, ...agg.units.map((u) => u.dealt));
      result.replaceChildren(
        h(
          'div',
          { class: 'sim-stats' },
          h('div', {}, h('div', { class: 'muted small' }, '승률'), h('b', { class: agg.winRate >= 0.8 ? 'ok-text' : agg.winRate < 0.4 ? 'error' : '' }, `${(agg.winRate * 100).toFixed(1)}%`)),
          h('div', {}, h('div', { class: 'muted small' }, '평균 라운드 (승리)'), h('b', {}, agg.avgRoundsWin ?? '-')),
          h('div', {}, h('div', { class: 'muted small' }, '평균 라운드 (전체)'), h('b', {}, agg.avgRounds)),
          h('div', {}, h('div', { class: 'muted small' }, '턴 초과 패배'), h('b', {}, agg.timeouts)),
          h('div', {}, h('div', { class: 'muted small' }, '팀 전투력 / 권장'), h('b', {}, `${num(teamPower)} / ${num(stage.recommendedPower)}`)),
        ),
        h('p', { class: 'muted small' }, `${agg.runs}판 · 시드 ${s0}~${s0 + agg.runs - 1} (같은 시드면 같은 결과)`),
        h(
          'table',
          { class: 'sim-table' },
          h('tr', {}, ['캐릭터', '평균 피해', '', '치유', '보호막', '받은 피해', '생존율'].map((t) => h('th', {}, t))),
          agg.units.map((u) =>
            h(
              'tr',
              {},
              h('td', {}, u.name),
              h('td', {}, num(u.dealt)),
              h('td', {}, h('span', { class: 'dmg-bar', style: { width: `${(u.dealt / maxDealt) * 160}px` } })),
              h('td', {}, num(u.healed)),
              h('td', {}, num(u.shielded)),
              h('td', {}, num(u.taken)),
              h('td', {}, `${Math.round(u.surviveRate * 100)}%`),
            ),
          ),
        ),
      );
    }

    async function engineTest() {
      const data = gameDataNow();
      const stage = data.stages.find((s) => s.id === stageSel.value);
      const members = team.map((m) => (m && data.charMap.has(m.charId) ? { ...m } : null));
      const r = selftest.runSelfTest(vocab, stage && members.some(Boolean) ? { team: members, stage, data } : {});
      result.replaceChildren(
        h('h3', {}, r.ok ? '엔진 검사 통과 ✓' : '엔진 검사 실패'),
        h('ul', { class: 'warn-list' }, r.results.map((x) => h('li', { class: x.ok ? '' : 'error' }, `${x.ok ? '✓' : '✕'} ${x.name}${x.detail ? ` — ${x.detail}` : ''}`))),
      );
    }

    // ── 전투력 표 ──
    function powerTable() {
      const data = gameDataNow();
      const b = data.balance;
      const rows = [];
      for (const rar of ['SSR', 'SR', 'R']) {
        const list = data.characters.filter((c) => c.rarity === rar).map((c) => ({ c, p: progression.powerOf(progression.statsOf(c, 1, 0, b), b) }));
        if (!list.length) continue;
        const avg = list.reduce((a, x) => a + x.p, 0) / list.length;
        rows.push(h('tr', { class: 'sim-group' }, h('td', { colspan: 3 }, h('b', {}, `${rar} · 평균 ${Math.round(avg)}`))));
        for (const { c, p } of list.sort((x, y) => y.p - x.p)) {
          const others = list.filter((x) => x.c !== c);
          const oAvg = others.length ? others.reduce((a, x) => a + x.p, 0) / others.length : p;
          const over = (p / oAvg - 1) * 100;
          rows.push(h('tr', {}, h('td', {}, c.name), h('td', {}, num(p)), h('td', { class: over > b.powerWarnPct ? 'error' : 'muted' }, others.length ? `${over >= 0 ? '+' : ''}${Math.round(over)}%${over > b.powerWarnPct ? ' ⚠' : ''}` : '-')));
        }
      }
      return h('section', { class: 'card' }, h('h2', {}, '전투력 (Lv.1 · 돌파 0)'), h('p', { class: 'muted small' }, `같은 희귀도의 다른 캐릭터 평균보다 ${b.powerWarnPct}% 넘게 높으면 ⚠. 전투력은 능력치만 보고 스킬 강도는 시뮬레이터로 확인하세요.`), h('table', { class: 'sim-table' }, rows));
    }

    // ── balance.json 편집 ──
    function balanceEditor() {
      const b = progression.validateBalance(state.data.balance, vocab, () => {});
      const work = structuredClone(b);
      const box = h('div');
      const field = (obj, key, label, step = 1) =>
        h('label', { class: 'bf-param' }, h('span', {}, label), h('input', { type: 'number', class: 'num-input', step, value: obj[key], oninput: (e) => (obj[key] = Number(e.target.value)) }));
      const issues = h('div');
      box.append(
        h('div', { class: 'row wrap' }, field(work, 'growth', '레벨당 성장률', 0.01), field(work.levelCost, 'base', '레벨업 비용 base'), field(work.levelCost, 'exp', '비용 지수 exp', 0.05), field(work, 'dailyTickets', '출석 티켓'), field(work, 'maxRounds', '최대 라운드'), field(work, 'powerWarnPct', '전투력 경고 %')),
        h('p', { class: 'muted small' }, `능력치 = 기본 × (1 + 성장률 × (레벨 − 1)) · 레벨업 비용 = ceil(base × lv^exp) → lv1: ${Math.ceil(work.levelCost.base)}, lv10: ${Math.ceil(work.levelCost.base * 10 ** work.levelCost.exp)}`),
        h('h3', {}, '희귀도 기본 능력치 (Lv.1)'),
        ...['SSR', 'SR', 'R'].map((r) => h('div', { class: 'row wrap' }, h('b', { class: 'rar-label' }, r), field(work.rarityStats[r], 'atk', '공격'), field(work.rarityStats[r], 'def', '방어'), field(work.rarityStats[r], 'hp', 'HP'))),
        h('div', { class: 'row wrap' }, field(work.crit, 'rate', '치명타 확률', 0.01), field(work.crit, 'dmg', '치명타 피해', 0.05)),
        h('h3', {}, '기력'),
        h('div', { class: 'row wrap' }, field(work.energy, 'max', '최대'), field(work.energy, 'basic', '기본 공격'), field(work.energy, 'skill', '스킬'), field(work.energy, 'hit', '피격'), field(work.energy, 'ultimateCost', '궁극기 소모')),
        h('h3', {}, '정수 → 티켓 (돌파 + 정수가 최대일 때)'),
        h('div', { class: 'row wrap' }, field(work.essenceTickets, 'SSR', 'SSR'), field(work.essenceTickets, 'SR', 'SR'), field(work.essenceTickets, 'R', 'R'), field(work, 'maxBreakthrough', '최대 돌파')),
        h('h3', {}, '전투력 가중치'),
        h('div', { class: 'row wrap' }, field(work.power, 'atk', '공격', 0.1), field(work.power, 'def', '방어', 0.1), field(work.power, 'hp', 'HP', 0.05), field(work.power, 'critRate', '치명타 확률'), field(work.power, 'critDmg', '치명타 피해')),
        h('details', {}, h('summary', {}, h('b', {}, '기본 스킬 (스킬이 없는 캐릭터용)')), h('div', { class: 'be-skills' }, ['basic', 'skill', 'ultimate'].map((a) => skillForm(work.defaultKit[a], a, { onChange: () => {} }).el))),
        issues,
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                try {
                  await api.put('/api/balance', work);
                } catch (e) {
                  issues.replaceChildren(issueList(e.data?.issues || [{ level: 'error', where: 'balance', message: e.message }]));
                  return;
                }
                await reloadData();
                issues.replaceChildren(h('p', { class: 'ok-text' }, '저장했어요 (작업 공간) — 배포하면 게임에 반영돼요'));
                powerHost.replaceChildren(powerTable());
                toast('밸런스를 저장했어요', 'success');
              },
            },
            'balance.json 저장',
          ),
        ),
      );
      return h('section', { class: 'card' }, h('h2', {}, '밸런스 숫자 (data/balance.json)'), box);
    }

    const powerHost = h('div', {}, powerTable());
    left.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '시뮬레이터'),
        h('label', { class: 'field' }, '스테이지', stageSel),
        h('div', { class: 'label' }, '팀 (1번부터 행동)'),
        teamBox,
        h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, '판 수', runs), h('label', { class: 'inline' }, '시작 시드', seedStart)),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: runSim }, '자동 전투 돌리기'), h('button', { class: 'btn', onclick: engineTest }, '엔진 검사')),
        progress,
      ),
      powerHost,
    );
    right.replaceChildren(h('section', { class: 'card' }, h('h2', {}, '결과'), result), balanceEditor());
    result.append(h('p', { class: 'muted' }, '왼쪽에서 팀과 스테이지를 고르고 "자동 전투 돌리기"를 눌러 주세요.'));
    if (!state.data.stages.length) result.replaceChildren(h('p', { class: 'note' }, '스테이지가 없어요. 스테이지 탭에서 먼저 만들어 주세요.'));
  })().catch((e) => {
    console.error(e);
    left.replaceChildren(h('p', { class: 'error' }, `불러오지 못했어요: ${e.message}`));
  });

  return {
    destroy() {
      destroyed = true;
    },
  };
}
