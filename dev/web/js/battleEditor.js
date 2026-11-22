// 캐릭터 전투 데이터 편집기 (모달): 능력치 / 기본·스킬·궁극기 / 돌파 1~5 / AI 초안
// AI 초안: 설정 + 희귀도 → Gemini가 JSON 제안 → 검사 → 승인 / 거절+사유→다시 생성 / 수정 후 승인
import { h, toast, modal, confirmBox, promptBox, busy, rarLabel, gradeOf } from './ui.js';
import { api, tryApi } from './api.js';
import { state, reloadData } from './state.js';
import { loadBattleKit, skillForm, passiveForm, statsForm, issueList, blankPassive, powerWarning, cleanEntity } from './battleForm.js';

const ACTIONS = ['basic', 'skill', 'ultimate'];
const MAX_BT = 5;

/** 이름/설명/효과가 하나도 없는 돌파 칸인지 */
const isBlank = (p) => !p.name && !p.description && !p.trigger && !(p.effects || []).length && !(p.modifiers || []).length;

export async function openCharBattleEditor(c, { onSaved } = {}) {
  const kitMods = await loadBattleKit();
  const { vocab, describe, progression } = kitMods;
  const balance = progression.validateBalance(state.data.balance, vocab, () => {});

  // 작업용 사본
  const work = { stats: {}, kit: {}, breakthroughs: [] };
  const load = (src) => {
    work.stats = structuredClone(src.stats || {});
    work.kit = {};
    for (const a of ACTIONS) work.kit[a] = structuredClone(src.kit?.[a] || balance.defaultKit[a]);
    work.breakthroughs = structuredClone(src.breakthroughs || []).slice(0, MAX_BT);
    while (work.breakthroughs.length < MAX_BT) work.breakthroughs.push(blankPassive());
  };
  load(c);
  let dirty = false;

  /** 게임과 똑같이 정리한 캐릭터 (미리보기 문장/전투력 계산용) */
  const cleaned = () => ({ ch: cleanEntity({ ...c, ...payload() }) });
  const payload = () => ({
    stats: Object.keys(work.stats).length ? work.stats : undefined,
    kit: work.kit,
    breakthroughs: trimBlank(work.breakthroughs),
  });
  const trimBlank = (list) => {
    const out = [...list];
    while (out.length && isBlank(out[out.length - 1])) out.pop();
    return out;
  };

  const summary = h('div', { class: 'be-summary' });
  const issuesBox = h('div', { class: 'be-issues' });
  const formsBox = h('div', { class: 'be-forms' });
  const aiBox = h('div', { class: 'be-ai' });

  function updateSummary() {
    const { ch } = cleaned();
    const others = state.data.characters.map((x) => cleanEntity(x)).filter((x) => x.rarity !== 'npc');
    const pw = powerWarning(kitMods, ch, {}, others, balance);
    summary.replaceChildren(
      ...[
        h('span', { class: `chip r-${gradeOf(c)}` }, rarLabel(gradeOf(c))),
        h('b', {}, ` 전투력 ${pw.power.toLocaleString('ko-KR')}`),
        h('span', { class: 'muted small' }, ' (Lv.1 · 돌파 0 기준)'),
        pw.avg != null && h('span', { class: 'muted small' }, ` · 같은 희귀도 평균 ${pw.avg.toLocaleString('ko-KR')}`),
        pw.warn && h('div', { class: 'warn-text' }, `⚠ ${pw.warn}`),
      ].filter(Boolean),
    );
  }
  const onChange = () => {
    dirty = true;
    updateSummary();
  };

  function renderForms() {
    const statsDefault = { ...(balance.stats.byRarity[c.rarity] || balance.stats.byRarity[3]), critRate: balance.stats.critRate, critDmg: balance.stats.critDmg };
    const skillPreview = (a) => () => {
      const { ch } = cleaned();
      const stats = progression.statsOf(ch, 1, 0, balance);
      return describe.describeSkill(progression.kitOf(ch, balance)[a], vocab, { stats, action: a });
    };
    const btPreview = (i) => () => {
      const { ch } = cleaned();
      const p = ch.breakthroughs?.[i];
      return p ? describe.describePassive(p, vocab) : [];
    };
    formsBox.replaceChildren(
      h('section', {}, h('h3', {}, '기본 능력치 (Lv.1)'), h('p', { class: 'muted small' }, '빈 칸은 희귀도 기본값 (balance.json)을 써요.'), statsForm(work.stats, statsDefault, { onChange })),
      h('section', {}, h('h3', {}, '스킬'), h('div', { class: 'be-skills' }, ACTIONS.map((a) => skillForm(work.kit[a], a, { onChange, preview: skillPreview(a) }).el))),
      h(
        'section',
        {},
        h('h3', {}, '돌파 능력 (1~5)'),
        h('p', { class: 'muted small' }, '돌파 N단계에서 N번째 능력이 켜져요. 단순 능력치 상승보다 캐릭터의 전투 방식을 살리는 능력을 권장해요.'),
        work.breakthroughs.map((p, i) => passiveForm(p, { onChange, preview: btPreview(i), title: `돌파 ${i + 1}` }).el),
      ),
    );
    updateSummary();
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

  // ── AI 초안 ──
  const lore = h('textarea', { rows: 3, placeholder: '캐릭터 설정 (소개문이 기본으로 들어가요)' }, c.description || '');
  let lastDraft = null;
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
    const ch = cleanEntity({ ...c, ...d });
    const stats = progression.statsOf(ch, 1, 0, balance);
    const errors = r.issues.filter((i) => i.level === 'error');
    aiBox.replaceChildren(
      h(
        'div',
        { class: 'draft-view' },
        h('div', { class: 'row between' }, h('b', {}, 'AI 초안'), r.retried && h('span', { class: 'chip warn' }, '오류가 있어 한 번 다시 썼어요')),
        d.stats && Object.keys(d.stats).length > 0 && h('p', { class: 'small' }, `능력치: ${Object.entries(d.stats).map(([k, v]) => `${k} ${v}`).join(' · ')}`),
        ACTIONS.map((a) =>
          h(
            'div',
            { class: 'draft-scene' },
            h('b', {}, `${vocab.actions[a]} 「${d.kit?.[a]?.name || '-'}」`),
            d.kit?.[a]?.description && h('span', { class: 'muted small' }, ` ${d.kit[a].description}`),
            h('ul', { class: 'bf-preview' }, describe.describeSkill(progression.kitOf(ch, balance)[a], vocab, { stats, action: a }).map((t) => h('li', {}, t))),
          ),
        ),
        (d.breakthroughs || []).map((p, i) =>
          h('div', { class: 'draft-scene' }, h('b', {}, `돌파 ${i + 1} 「${p.name || '-'}」`), p.description && h('span', { class: 'muted small' }, ` ${p.description}`), h('ul', { class: 'bf-preview' }, (ch.breakthroughs[i] ? describe.describePassive(ch.breakthroughs[i], vocab) : []).map((t) => h('li', {}, t)))),
        ),
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
                load({ ...c, ...d });
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
                load({ ...c, ...d });
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
                const reason = await promptBox('거절 사유', '무엇을 바꿀까요? (예: 궁극기를 치유로, 돌파 3을 더 독특하게)', { multiline: true });
                if (reason) draft(reason);
              },
            },
            '거절 + 사유 → 다시 생성',
          ),
        ),
      ),
    );
  }

  const body = h(
    'div',
    { class: 'battle-editor' },
    summary,
    h(
      'details',
      { class: 'card inner', open: !c.kit },
      h('summary', {}, h('b', {}, 'AI 초안 (설정 → 스킬 3개 + 돌파 5개)')),
      h('label', { class: 'field' }, '설정', lore),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => draft() }, 'AI 초안 만들기'), state.status?.ai?.mock && h('span', { class: 'chip warn' }, '모의 모드: 가짜 초안')),
      aiBox,
    ),
    formsBox,
    issuesBox,
  );
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
