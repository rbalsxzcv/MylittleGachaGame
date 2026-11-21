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
    const [sim, selftest, gacha, rng] = await Promise.all([import('/preview/js/battle/sim.js'), import('/preview/js/battle/selftest.js'), import('/preview/js/systems/gacha.js'), import('/preview/js/core/rng.js')]);

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
          const sel = h('select', { onchange: (e) => ((team[i] = e.target.value ? { charId: e.target.value, level: m?.level || 1, breakthrough: m?.breakthrough || 0 } : null), renderTeam()) }, h('option', { value: '' }, '(빈 칸)'), chars.map((c) => h('option', { value: c.id }, `${c.name} (${c.rarity}★)`)));
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
      for (const rar of [5, 4, 3, 2, 1]) {
        const list = data.characters.filter((c) => c.rarity === rar).map((c) => ({ c, p: progression.powerOf(progression.statsOf(c, 1, 0, b), b) }));
        if (!list.length) continue;
        const avg = list.reduce((a, x) => a + x.p, 0) / list.length;
        rows.push(h('tr', { class: 'sim-group' }, h('td', { colspan: 3 }, h('b', {}, `${rar}★ · 평균 ${Math.round(avg)}`))));
        for (const { c, p } of list.sort((x, y) => y.p - x.p)) {
          const others = list.filter((x) => x.c !== c);
          const oAvg = others.length ? others.reduce((a, x) => a + x.p, 0) / others.length : p;
          const over = (p / oAvg - 1) * 100;
          rows.push(h('tr', {}, h('td', {}, c.name), h('td', {}, num(p)), h('td', { class: over > b.powerWarnPct ? 'error' : 'muted' }, others.length ? `${over >= 0 ? '+' : ''}${Math.round(over)}%${over > b.powerWarnPct ? ' ⚠' : ''}` : '-')));
        }
      }
      return h('section', { class: 'card' }, h('h2', {}, '전투력 (Lv.1 · 돌파 0)'), h('p', { class: 'muted small' }, `같은 희귀도의 다른 캐릭터 평균보다 ${b.powerWarnPct}% 넘게 높으면 ⚠. 전투력은 능력치만 보고 스킬 강도는 시뮬레이터로 확인하세요.`), h('table', { class: 'sim-table' }, rows));
    }

    // ── 가챠 시뮬레이터: N회 → 관측 확률 / 천장 / 픽업 (설정과 비교) ──
    function gachaSim() {
      const bannerSel = h('select', {}, state.data.banners.map((b) => h('option', { value: b.id }, `${b.title} (${b.type === 'pickup' ? '픽업' : '상시'})`)));
      const pulls = h('input', { type: 'number', class: 'num-input', min: 1000, max: 1000000, step: 10000, value: 100000 });
      const seed = h('input', { type: 'number', class: 'num-input', value: 1 });
      const out = h('div');
      const run = () => {
        const data = gameDataNow();
        const b = state.data.banners.find((x) => x.id === bannerSel.value) || { type: 'standard' };
        // 로테이션 픽업은 지금 시점의 픽업 캐릭터로
        const pickupIds = b.rotation ? data.characters.filter((c) => c.rarity === Number(b.rotation.rarity)).slice(0, b.rotation.count).map((c) => c.id) : b.pickupIds || [];
        const pools = gacha.buildPools(data.characters, { ...b, pickupIds });
        if (gacha.isPoolEmpty(pools)) return out.replaceChildren(h('p', { class: 'error' }, '뽑을 캐릭터가 없어요'));
        const g = data.balance.gacha;
        const t0 = performance.now();
        const r = gacha.simulateStats(pools, data.balance, { pulls: Math.max(1000, Number(pulls.value) || 100000), rand: rng.createRng(Number(seed.value) || 1) });
        const rows = [5, 4, 3, 2, 1].map((rar) =>
          h('tr', {}, h('td', {}, `${rar}★`), h('td', {}, `${g.rates[rar]}%`), h('td', {}, `${r.rates[rar].toFixed(2)}%`), h('td', { class: 'muted' }, `${pools[rar].length}명${pools[rar].length ? '' : ' (대체)'}`)),
        );
        const bad = (v, ok) => h('td', { class: ok ? 'ok-text' : 'error' }, String(v));
        out.replaceChildren(
          h('table', { class: 'sim-table' }, h('tr', {}, h('th', {}, ''), h('th', {}, '설정'), h('th', {}, '관측'), h('th', {}, '풀')), rows),
          h(
            'table',
            { class: 'sim-table' },
            h('tr', {}, h('td', {}, '뽑기 횟수'), h('td', {}, r.n.toLocaleString('ko-KR'))),
            h('tr', {}, h('td', {}, `천장(${g.pity}회) 발동`), h('td', {}, r.pityHits.toLocaleString('ko-KR'))),
            h('tr', {}, h('td', {}, `5★ 없이 최장 연속 (≤ ${g.pity - 1} 정상)`), bad(r.maxSinceTop, r.maxSinceTop < g.pity)),
            h('tr', {}, h('td', {}, `10연 ${g.tenGuaranteeMin}★+ 확정 발동`), h('td', {}, r.guaranteeHits.toLocaleString('ko-KR'))),
            h('tr', {}, h('td', {}, `${g.tenGuaranteeMin}★+ 없는 10연 (0 정상)`), bad(r.tenPullsWithoutHigh, r.tenPullsWithoutHigh === 0)),
            pools.pickup[5].length > 0 && h('tr', {}, h('td', {}, '5★ 중 픽업 비율 (50/50 + 확정 ≈ 66%)'), h('td', {}, `${((r.pickupWins / Math.max(1, r.counts[5])) * 100).toFixed(1)}%`)),
            pools.pickup[5].length > 0 && h('tr', {}, h('td', {}, '픽업 연속 실패 (0 정상)'), bad(r.lostTwiceInRow, r.lostTwiceInRow === 0)),
          ),
          h('p', { class: 'muted small' }, `천장과 10연 확정 때문에 실제 5★ 비율은 설정보다 조금 높아요. (${Math.round(performance.now() - t0)}ms)`),
        );
      };
      return h(
        'section',
        { class: 'card' },
        h('h2', {}, '가챠 시뮬레이터'),
        h('div', { class: 'row wrap' }, h('label', { class: 'field' }, '배너', bannerSel), h('label', { class: 'inline' }, '횟수', pulls), h('label', { class: 'inline' }, '시드', seed), h('button', { class: 'btn primary', onclick: run }, '돌리기')),
        out,
      );
    }

    // ── balance.json 편집 ──
    function balanceEditor() {
      const b = progression.validateBalance(state.data.balance, vocab, () => {});
      const work = structuredClone(b);
      const box = h('div');
      const field = (obj, key, label, step = 1) =>
        h('label', { class: 'bf-param' }, h('span', {}, label), h('input', { type: 'number', class: 'num-input', step, value: obj[key], oninput: (e) => (obj[key] = Number(e.target.value)) }));
      const issues = h('div');
      const R = [5, 4, 3, 2, 1];
      box.append(
        h('h3', {}, '뽑기'),
        h('div', { class: 'row wrap' }, ...R.map((r) => field(work.gacha.rates, r, `${r}★ 확률 %`, 0.1))),
        h('div', { class: 'row wrap' }, field(work.gacha.cost, 'single', '1회 보석'), field(work.gacha.cost, 'ten', '10회 보석'), field(work.gacha, 'pity', '천장 (회)'), field(work.gacha, 'tenGuaranteeMin', '10연 확정 ★'), field(work.gacha, 'pickupShare', '픽업 확률 (0~1)', 0.05)),
        h('h3', {}, '성장 · 레벨업'),
        h('div', { class: 'row wrap' }, field(work.stats, 'growth', '레벨당 성장률', 0.01), field(work.level, 'costBase', '레벨업 비용 base'), field(work.level, 'costExp', '비용 지수 exp', 0.05), field(work.level, 'goldPerTicket', '레벨업 골드 (티켓당)'), field(work.daily, 'tickets', '출석 티켓'), field(work.daily, 'gold', '출석 골드'), field(work, 'powerWarnPct', '전투력 경고 %')),
        h('p', { class: 'muted small' }, `능력치(공격/방어/HP) = 기본 × (1 + 성장률 × (레벨 − 1)) · 속도/치명타는 레벨과 무관 · 레벨업 티켓 = ceil(base × lv^exp) → lv1: ${Math.ceil(work.level.costBase)}, lv10: ${Math.ceil(work.level.costBase * 10 ** work.level.costExp)} · 골드 = 티켓 × ${work.level.goldPerTicket}`),
        h('h3', {}, '희귀도 기본 능력치 (Lv.1)'),
        ...R.map((r) => h('div', { class: 'row wrap' }, h('b', { class: 'rar-label' }, `${r}★`), field(work.stats.byRarity[r], 'atk', '공격'), field(work.stats.byRarity[r], 'def', '방어'), field(work.stats.byRarity[r], 'hp', 'HP'), field(work.stats.byRarity[r], 'spd', '속도'))),
        h('div', { class: 'row wrap' }, field(work.stats, 'critRate', '치명타 확률', 0.01), field(work.stats, 'critDmg', '치명타 피해', 0.05)),
        h('h3', {}, '전투'),
        h('div', { class: 'row wrap' }, field(work.combat.energy, 'max', '기력 최대'), field(work.combat.energy, 'basic', '기본 공격 기력'), field(work.combat.energy, 'skill', '스킬 기력'), field(work.combat.energy, 'hit', '피격 기력'), field(work.combat.energy, 'ultimateCost', '궁극기 소모')),
        h('div', { class: 'row wrap' }, field(work.combat.sp, 'start', 'SP 시작'), field(work.combat.sp, 'max', 'SP 최대'), field(work.combat.sp, 'basicGain', '기본 공격 SP +'), field(work.combat.sp, 'skillCost', '스킬 SP −'), field(work.combat, 'maxRounds', '최대 라운드')),
        h('div', { class: 'row wrap' }, field(work.combat, 'avBase', '행동 수치 기준 (÷속도)'), field(work.combat, 'roundAv', '1라운드 길이'), field(work.combat, 'queuePreview', '행동 순서 표시 인원'), field(work.combat.enemyLevel, 'refPower', '적 레벨 기준 전투력'), field(work.combat.enemyLevel, 'perLevel', '레벨당 전투력'), field(work.combat.fx, 'actionMs', '행동 연출 ms'), field(work.combat.fx, 'cutinMs', '컷인 ms')),
        h('h3', {}, '정수 → 티켓 (돌파 + 정수가 최대일 때)'),
        h('div', { class: 'row wrap' }, ...R.map((r) => field(work.essence.overflowTickets, r, `${r}★`)), field(work.essence, 'maxBreakthrough', '최대 돌파')),
        h('h3', {}, '전투력 가중치'),
        h('div', { class: 'row wrap' }, field(work.power, 'atk', '공격', 0.1), field(work.power, 'def', '방어', 0.1), field(work.power, 'hp', 'HP', 0.05), field(work.power, 'spd', '속도', 0.1), field(work.power, 'critRate', '치명타 확률'), field(work.power, 'critDmg', '치명타 피해')),
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
      gachaSim(),
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
