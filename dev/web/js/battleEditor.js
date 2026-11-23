// 캐릭터 전투 데이터 편집기 (모달): 역할 · 능력치 손조정 · 자원 · 기본/스킬/궁극기(+변신) · 특성 · 돌파 2/6
// 키트 생성기(아키타입 템플릿, AI 없음)로 만들거나 손으로 고침 → 고칠 때마다 예산 + 빠른 시뮬
// AI 초안(선택): 설정 + 희귀도 → Gemini가 JSON 제안 → 검사 → 승인 / 거절+사유→다시 생성 / 수정 후 승인
// 돌파 1·3·4·5는 역할별 공식(balance.breakthrough)이라 여기서 고치지 않음
import { h, toast, modal, confirmBox, promptBox, busy, rarLabel, gradeOf } from './ui.js';
import { api, tryApi } from './api.js';
import { state, reloadData } from './state.js';
import { skillForm, passiveForm, statsForm, issueList, blankPassive, powerWarning, cleanEntity } from './battleForm.js';
import { loadKitTools, gameDataWith, quickSim, budgetLine } from './kitTools.js';

const ACTIONS = ['basic', 'skill', 'ultimate'];
const ROLE_LABEL = { attacker: '딜러', defender: '탱커', support: '지원', healer: '치유' };

/** 이름/설명/효과가 하나도 없는 패시브인지 */
const isBlank = (p) => !p || (!p.name && !p.description && !p.trigger && !(p.effects || []).length && !(p.modifiers || []).length);

export async function openCharBattleEditor(c, { onSaved } = {}) {
  const kt = await loadKitTools();
  const { vocab, describe, progression, balance, gen } = kt;

  // 작업용 사본
  const work = {};
  const load = (src) => {
    work.role = src.role || 'attacker';
    work.archetype = src.archetype || src.kitGen?.archetype || '';
    work.kitGen = structuredClone(src.kitGen || null);
    work.statTweak = structuredClone(src.statTweak || {});
    work.stats = structuredClone(src.stats || {});
    work.resource = src.resource ? structuredClone(src.resource) : null;
    work.kit = {};
    for (const a of ACTIONS) work.kit[a] = structuredClone(src.kit?.[a] || balance.defaultKit[a]);
    work.transformed = src.kit?.transformed ? structuredClone(src.kit.transformed) : null;
    work.talents = structuredClone(src.talents || []);
    work.bt2 = structuredClone(src.bt2 || blankPassive());
    work.bt6 = structuredClone(src.bt6 || blankPassive());
    // 예전 방식(breakthroughs 1~5)은 그대로 보관만 (새 방식으로 바꾸면 비워짐)
    work.breakthroughs = structuredClone(src.breakthroughs || []);
  };
  load(c);
  let dirty = false;

  const payload = () => {
    const out = {
      role: work.role,
      archetype: work.archetype || undefined,
      kitGen: work.kitGen || undefined,
      statTweak: Object.keys(work.statTweak).filter((k) => work.statTweak[k]).length ? work.statTweak : undefined,
      stats: Object.keys(work.stats).length ? work.stats : undefined,
      resource: work.resource || undefined,
      kit: { ...work.kit, ...(work.transformed ? { transformed: work.transformed } : {}) },
      talents: work.talents.filter((p) => !isBlank(p)),
      bt2: isBlank(work.bt2) ? undefined : work.bt2,
      bt6: isBlank(work.bt6) ? undefined : work.bt6,
      breakthroughs: work.bt2 || work.bt6 ? undefined : work.breakthroughs.length ? work.breakthroughs : undefined,
    };
    return out;
  };
  /** 게임과 똑같이 정리한 캐릭터 (미리보기 문장/전투력/예산/시뮬용) */
  const cleaned = () => cleanEntity({ ...c, ...payload() });

  const summary = h('div', { class: 'be-summary' });
  const budgetBox = h('div', { class: 'be-budget small' });
  const simBox = h('div', { class: 'be-sim small' });
  const issuesBox = h('div', { class: 'be-issues' });
  const formsBox = h('div', { class: 'be-forms' });
  const aiBox = h('div', { class: 'be-ai' });
  const genBox = h('div', { class: 'be-gen' });

  function updateSummary() {
    const ch = cleaned();
    const others = state.data.characters.map((x) => cleanEntity(x)).filter((x) => x.rarity !== 'npc');
    const pw = powerWarning(kt, ch, {}, others, balance);
    summary.replaceChildren(
      ...[
        h('span', { class: `chip r-${gradeOf(c)}` }, rarLabel(gradeOf(c))),
        h('span', { class: 'chip' }, ROLE_LABEL[work.role] || work.role),
        work.archetype && h('span', { class: 'chip ok' }, gen.ARCHETYPE_MAP.get(work.archetype)?.label || work.archetype),
        h('b', {}, ` 전투력 ${pw.power.toLocaleString('ko-KR')}`),
        h('span', { class: 'muted small' }, ' (Lv.1 · 돌파 0 기준)'),
        pw.avg != null && h('span', { class: 'muted small' }, ` · 같은 희귀도 평균 ${pw.avg.toLocaleString('ko-KR')}`),
        pw.warn && h('div', { class: 'warn-text' }, `⚠ ${pw.warn}`),
      ].filter(Boolean),
    );
    budgetBox.replaceChildren(h('b', {}, '예산 '), budgetLine(gen.budgetOf(ch, balance)), h('span', { class: 'muted' }, ` (상한 ±${balance.kitBudget.tolerancePct}%가 목표)`));
  }
  let simTimer = null;
  function scheduleSim() {
    clearTimeout(simTimer);
    simTimer = setTimeout(runSim, 400);
  }
  function runSim() {
    try {
      const data = gameDataWith(kt, { id: c.id, ...payload() });
      const rows = quickSim(kt, data, c.id, { runs: 20 });
      simBox.replaceChildren(
        h('b', {}, '빠른 시뮬 '),
        h('span', { class: 'muted' }, '(Lv.20 · 돌파 2, 다른 역할 4명과 · 챕터마다 마지막 스테이지 20판) '),
        ...rows.map((r) => h('span', { class: 'chip' }, `${r.stage.name}: 승률 ${Math.round(r.winRate * 100)}% · ${r.avgRounds}라운드 · 기여 ${Math.round(r.share * 100)}%`)),
      );
    } catch (e) {
      simBox.replaceChildren(h('span', { class: 'error' }, `시뮬 실패: ${e.message}`));
    }
  }
  const onChange = () => {
    dirty = true;
    updateSummary();
    scheduleSim();
  };

  // ── 키트 생성기 (아키타입 템플릿) ──
  function renderGen() {
    const arch = gen.ARCHETYPE_MAP.get(work.archetype) || null;
    const archSel = h('select', {}, h('option', { value: '' }, '(아키타입 고르기)'), gen.ARCHETYPES.map((a) => h('option', { value: a.id }, `${a.no}. ${a.label} (${a.roles.map((r) => ROLE_LABEL[r]).join('/')})`)));
    archSel.value = work.archetype || gen.suggestArchetype(state.data.characters, work.role);
    const variantSel = (key, list, cur) => {
      const s = h('select', {}, list.map((v) => h('option', { value: v.id }, v.label)));
      s.value = cur || list[0].id;
      return s;
    };
    const a = gen.ARCHETYPE_MAP.get(archSel.value);
    const v = work.kitGen?.variants || {};
    const bt2Sel = variantSel('bt2', a.bt2, v.bt2);
    const bt6Sel = variantSel('bt6', a.bt6, v.bt6);
    const sigSel = variantSel('sig', a.signature, v.sig);
    archSel.onchange = () => {
      work.archetype = archSel.value;
      work.kitGen = null;
      renderGen();
    };
    const seed = h('input', { type: 'number', class: 'num-input', value: work.kitGen?.seed ?? gen.hashSeed(c.id) });
    genBox.replaceChildren(
      h('div', { class: 'row wrap' }, h('label', { class: 'field' }, '아키타입', archSel), h('label', { class: 'field' }, '돌파 2', bt2Sel), h('label', { class: 'field' }, '돌파 6', bt6Sel), h('label', { class: 'field' }, '전용 추억 (5★)', sigSel), h('label', { class: 'field' }, '시드', seed)),
      arch && h('p', { class: 'muted small' }, `지금: ${arch.label}${work.kitGen ? ` · 변형 ${Object.values(work.kitGen.variants || {}).join('/')} · 시드 ${work.kitGen.seed}` : ' (손으로 고친 키트)'}`),
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            if (dirty && !(await confirmBox('다시 생성', '폼의 스킬/특성/돌파를 생성 결과로 바꿀까요? (저장 전까지는 되돌릴 수 있어요)', { ok: '바꾸기' }))) return;
            const g = gen.generateKit({ id: c.id, role: work.role, rarity: c.rarity, archetype: archSel.value, variants: { bt2: bt2Sel.value, bt6: bt6Sel.value, sig: sigSel.value }, seed: Number(seed.value) || undefined, balance, vocab });
            load({ ...c, ...payload(), ...gen.kitFields(g), stats: work.stats, statTweak: work.statTweak, breakthroughs: [] });
            if (!g.resource) work.resource = null;
            dirty = true;
            renderForms();
            renderGen();
            issuesBox.replaceChildren(h('h3', {}, '생성 결과'), issueList(g.issues.length ? g.issues : [{ level: 'info', where: c.id, message: '예산 안에 들어왔어요' }]));
          },
        },
        '이 설정으로 생성해서 폼에 넣기',
      ),
    );
  }

  function renderForms() {
    const tweakDefault = Object.fromEntries(['atk', 'def', 'hp', 'spd'].map((k) => [k, 0]));
    const stats = () => progression.statsOf(cleaned(), 1, 0, balance);
    const skillPreview = (a, alt = false) => () => describe.describeSkill(alt ? cleaned().kit?.transformed?.[a] : progression.kitOf(cleaned(), balance)[a], vocab, { stats: stats(), action: a });
    const passivePreview = (get) => () => {
      const p = get(cleaned());
      return p ? describe.describePassive(p, vocab) : [];
    };
    const roleSel = h('select', { onchange: (e) => ((work.role = e.target.value), onChange(), renderGen()) }, Object.entries(ROLE_LABEL).map(([k, l]) => h('option', { value: k }, `${l} (${k})`)));
    roleSel.value = work.role;
    const resBox = h('div', { class: 'row wrap' });
    const renderRes = () => {
      if (!work.resource) {
        resBox.replaceChildren(h('span', { class: 'muted small' }, '자원 없음 '), h('button', { class: 'btn tiny', onclick: () => ((work.resource = { name: '자원', cap: 5, start: 0 }), onChange(), renderRes()) }, '+ 자원'));
        return;
      }
      const num = (key, min, max) => h('input', { type: 'number', class: 'num-input', min, max, value: work.resource[key], oninput: (e) => ((work.resource[key] = Math.round(Number(e.target.value) || 0)), onChange()) });
      resBox.replaceChildren(
        h('label', { class: 'bf-param' }, h('span', {}, '이름'), h('input', { value: work.resource.name, oninput: (e) => ((work.resource.name = e.target.value), onChange()) })),
        h('label', { class: 'bf-param' }, h('span', {}, '상한'), num('cap', 1, 99)),
        h('label', { class: 'bf-param' }, h('span', {}, '시작'), num('start', 0, 99)),
        h('button', { class: 'btn tiny danger-outline', onclick: () => ((work.resource = null), onChange(), renderRes()) }, '자원 삭제'),
      );
    };
    renderRes();
    const talentsBox = h('div');
    const renderTalents = () =>
      talentsBox.replaceChildren(
        ...work.talents.map((p, i) => h('div', {}, passiveForm(p, { onChange, preview: passivePreview((ch) => ch.talents?.[i]), title: `특성 ${i + 1} (늘 켜짐)` }).el, h('button', { class: 'btn tiny danger-outline', onclick: () => (work.talents.splice(i, 1), onChange(), renderTalents()) }, '특성 삭제'))),
        work.talents.length < 4 && h('button', { class: 'btn small', onclick: () => (work.talents.push(blankPassive()), onChange(), renderTalents()) }, '+ 특성'),
      );
    renderTalents();
    const nodes = balance.breakthrough.statNodes[work.role] || [];
    formsBox.replaceChildren(
      h('section', {}, h('h3', {}, '역할 · 능력치'), h('div', { class: 'row wrap' }, h('label', { class: 'field' }, '역할 (능력치 템플릿)', roleSel)), h('p', { class: 'muted small' }, `기본 능력치 = 역할 템플릿 × 희귀도 배율 (balance.json). 손조정은 % — ±${balance.stats.tweakWarnPct}%를 넘으면 경고`), statsForm(work.statTweak, tweakDefault, { onChange })),
      h('section', {}, h('h3', {}, '자원 (스택)'), resBox),
      h('section', {}, h('h3', {}, '스킬'), h('div', { class: 'be-skills' }, ACTIONS.map((a) => skillForm(work.kit[a], a, { onChange, preview: skillPreview(a) }).el))),
      work.transformed &&
        h('section', {}, h('h3', {}, '변신 중 스킬 (transform 효과가 켜는 칸)'), h('div', { class: 'be-skills' }, Object.keys(work.transformed).map((a) => skillForm(work.transformed[a], a, { onChange, preview: skillPreview(a, true), title: `변신 ${vocab.actions[a]}` }).el))),
      h('section', {}, h('h3', {}, '특성 (늘 켜짐)'), talentsBox),
      h(
        'section',
        {},
        h('h3', {}, '돌파'),
        h('p', { class: 'muted small' }, `돌파 1·3·4·5는 역할 공식: ${nodes.map((n, i) => `${[1, 3, 4, 5][i]}단계 ${vocab.stats[n.stat] || n.stat} +${n.pct}`).join(' · ')} (× 낮은 희귀도 보정)`),
        passiveForm(work.bt2, { onChange, preview: passivePreview((ch) => ch.bt2), title: '돌파 2 (핵심 메커니즘 강화)' }).el,
        passiveForm(work.bt6, { onChange, preview: passivePreview((ch) => ch.bt6), title: '돌파 6 (메커니즘 변형)' }).el,
        work.breakthroughs.length > 0 && h('p', { class: 'warn-text small' }, `예전 방식 돌파 능력 ${work.breakthroughs.length}개가 있어요 — 돌파 2/6을 넣고 저장하면 지워져요`),
      ),
    );
    updateSummary();
    scheduleSim();
  }

  async function check() {
    const r = await tryApi(() => api.post('/api/battle/check', { id: c.id, ...payload() }));
    if (r) issuesBox.replaceChildren(h('h3', {}, '검사 결과'), issueList(r.issues));
    return r?.issues || null;
  }

  async function save() {
    const r = await busy('저장 중…', async () => {
      try {
        return await api.put(`/api/characters/${c.id}/battle`, payload());
      } catch (e) {
        issuesBox.replaceChildren(h('h3', {}, '저장하지 못했어요'), issueList(e.data?.issues || [{ level: 'error', where: c.id, message: e.message }]));
        return null;
      }
    });
    if (!r) return false;
    dirty = false;
    await reloadData();
    issuesBox.replaceChildren(h('h3', {}, '저장했어요'), issueList(r.issues));
    toast(`「${c.name}」 전투 데이터를 저장했어요 (작업 공간)`, 'success');
    onSaved?.();
    return true;
  }

  // ── AI 초안 (선택 — 손으로 다시 쓰고 싶을 때) ──
  const lore = h('textarea', { rows: 3, placeholder: '캐릭터 설정 (소개문이 기본으로 들어가요)' }, c.description || '');
  let lastDraft = null;
  /** AI 초안(예전 형식: breakthroughs 5개) → 새 형식 (돌파 2 = 2번째, 돌파 6 = 5번째) */
  const fromDraft = (d) => ({ ...c, ...payload(), kit: d.kit, stats: d.stats || work.stats, bt2: d.breakthroughs?.[1] || null, bt6: d.breakthroughs?.[4] || null, talents: d.breakthroughs?.[0] ? [d.breakthroughs[0]] : work.talents, breakthroughs: [], kitGen: null });
  async function draft(feedback = '') {
    const r = await busy('AI가 스킬 세트를 짜는 중…', () =>
      tryApi(() => api.post('/api/char/kit-draft', { charId: c.id, name: c.name, rarity: c.rarity, title: c.title, lore: lore.value, feedback, previous: feedback ? lastDraft : null })),
    );
    if (!r) return;
    lastDraft = r.draft;
    renderDraft(r);
  }
  function renderDraft(r) {
    const d = r.draft;
    const ch = cleanEntity(fromDraft(d));
    const stats = progression.statsOf(ch, 1, 0, balance);
    const errors = r.issues.filter((i) => i.level === 'error');
    aiBox.replaceChildren(
      h(
        'div',
        { class: 'draft-view' },
        h('div', { class: 'row between' }, h('b', {}, 'AI 초안'), r.retried && h('span', { class: 'chip warn' }, '오류가 있어 한 번 다시 썼어요')),
        ACTIONS.map((a) =>
          h(
            'div',
            { class: 'draft-scene' },
            h('b', {}, `${vocab.actions[a]} 「${d.kit?.[a]?.name || '-'}」`),
            d.kit?.[a]?.description && h('span', { class: 'muted small' }, ` ${d.kit[a].description}`),
            h('ul', { class: 'bf-preview' }, describe.describeSkill(progression.kitOf(ch, balance)[a], vocab, { stats, action: a }).map((t) => h('li', {}, t))),
          ),
        ),
        [
          ['특성', ch.talents?.[0]],
          ['돌파 2', ch.bt2],
          ['돌파 6', ch.bt6],
        ].map(([label, p]) => p && h('div', { class: 'draft-scene' }, h('b', {}, `${label} 「${p.name || '-'}」`), h('ul', { class: 'bf-preview' }, describe.describePassive(p, vocab).map((t) => h('li', {}, t))))),
        h('p', { class: 'small' }, `예산: ${budgetLine(gen.budgetOf(ch, balance))}`),
        h('h3', {}, '검사'),
        issueList(r.issues),
        h(
          'div',
          { class: 'row wrap' },
          h(
            'button',
            {
              class: 'btn primary',
              disabled: errors.length > 0,
              title: errors.length ? '오류가 있어서 바로 승인할 수 없어요. 수정 후 승인을 쓰세요' : '',
              onclick: async () => {
                load(fromDraft(d));
                renderForms();
                if (await save()) aiBox.replaceChildren(h('p', { class: 'ok-text' }, '초안을 승인하고 저장했어요 ✓'));
              },
            },
            '승인 (저장)',
          ),
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                load(fromDraft(d));
                dirty = true;
                renderForms();
                aiBox.replaceChildren(h('p', { class: 'note' }, '초안을 아래 폼에 넣었어요. 고친 뒤 저장을 누르면 승인돼요.'));
              },
            },
            '수정 후 승인',
          ),
          h(
            'button',
            {
              class: 'btn danger-outline',
              onclick: async () => {
                const reason = await promptBox('거절 사유', '무엇을 바꿀까요? (예: 궁극기를 치유로, 돌파를 더 독특하게)', { multiline: true });
                if (reason) draft(reason);
              },
            },
            '거절 + 사유 → 다시 생성',
          ),
        ),
      ),
    );
  }

  const aiOff = state.settings?.ai === false;
  const body = h(
    'div',
    { class: 'battle-editor' },
    summary,
    budgetBox,
    simBox,
    h('details', { class: 'card inner', open: !c.kitGen && !c.kit }, h('summary', {}, h('b', {}, '키트 생성기 (아키타입 템플릿 — AI 없음)')), genBox),
    !aiOff &&
      h(
        'details',
        { class: 'card inner' },
        h('summary', {}, h('b', {}, 'AI로 다시 쓰기 (선택)')),
        h('label', { class: 'field' }, '설정', lore),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => draft() }, 'AI 초안 만들기'), state.status?.ai?.mock && h('span', { class: 'chip warn' }, '모의 모드: 가짜 초안')),
        aiBox,
      ),
    formsBox,
    issuesBox,
  );
  renderGen();
  renderForms();
  dirty = false;

  await modal({
    title: `전투 데이터 — ${c.name} (${c.id})`,
    body,
    wide: true,
    buttons: [
      { label: '닫기', value: null, onClick: async () => !dirty || (await confirmBox('저장하지 않은 변경', '저장하지 않은 내용이 있어요. 닫을까요?', { ok: '닫기', danger: true })) },
      { label: '검사', value: null, onClick: async () => (await check(), false) },
      { label: '저장', value: 'save', primary: true, onClick: async () => (await save(), false) },
    ],
  });
}
