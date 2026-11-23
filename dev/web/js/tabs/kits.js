// 키트 일괄 탭 (계획서 9 "Batch bootstrap"): 모든 캐릭터 → 아키타입 키트 생성(AI 없음) → 검토 격자 → 전체 승인 / 카드별 승인
// 이미 저장한 키트(kitGen)는 그대로 보여 주고, '다시 생성'을 눌러야 바뀜 (같은 입력 = 같은 결과)
import { h, toast, confirmBox, busy, rarLabel, gradeOf, isNpc } from '../ui.js';
import { api } from '../api.js';
import { state, reloadData } from '../state.js';
import { loadKitTools, gameDataWith, quickSim, budgetLine } from '../kitTools.js';
import { openCharBattleEditor } from '../battleEditor.js';

const ROLE_LABEL = { attacker: '딜러', defender: '탱커', support: '지원', healer: '치유' };

export function kitsTab(root) {
  root.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));
  let kt = null;
  const drafts = new Map(); // id → 생성 결과 (아직 저장 안 함)

  (async () => {
    kt = await loadKitTools();
    render();
  })();

  const players = () => state.data.characters.filter((c) => !isNpc(c));

  function spreadBox() {
    const spread = kt.gen.archetypeSpread(players().map((c) => (drafts.has(c.id) ? { ...c, archetype: drafts.get(c.id).archetype } : c)));
    return h(
      'section',
      { class: 'card' },
      h('h3', {}, '아키타입 분포'),
      h('div', { class: 'row wrap' }, ...spread.map((a) => h('span', { class: ['chip', a.count === 0 ? 'warn' : 'ok'], title: a.ids.join(', ') || '아직 없음' }, `${a.no}. ${a.label} ${a.count}`))),
      h('p', { class: 'muted small' }, '0명인 아키타입(노란색)을 새 캐릭터에 먼저 추천해요.'),
    );
  }

  function card(c) {
    const { gen, balance, vocab, describe } = kt;
    const draft = drafts.get(c.id);
    const cur = draft ? { ...c, ...gen.kitFields(draft) } : c;
    const has = !!(cur.kitGen || cur.kit?.basic);
    const roleSel = h('select', {}, Object.entries(ROLE_LABEL).map(([k, l]) => h('option', { value: k }, l)));
    roleSel.value = cur.role || 'attacker';
    const archSel = h('select', {}, gen.ARCHETYPES.map((a) => h('option', { value: a.id }, `${a.no}. ${a.label}`)));
    archSel.value = cur.archetype || cur.kitGen?.archetype || gen.suggestArchetype(players(), roleSel.value);
    const generate = () => {
      const g = gen.generateKit({ id: c.id, role: roleSel.value, rarity: c.rarity, archetype: archSel.value, balance, vocab });
      drafts.set(c.id, g);
      render();
    };
    const lines = (skill) => (skill ? describe.describeSkill(skill, vocab).join(' / ') : '-');
    const cleaned = kt.data.validateCharacters([cur], vocab)[0] || cur;
    const budget = draft ? draft.budget : gen.budgetOf(cleaned, balance);
    let sim = null;
    if (has) {
      try {
        sim = quickSim(kt, gameDataWith(kt, draft ? { id: c.id, ...gen.kitFields(draft) } : null), c.id, { runs: 10 });
      } catch {
        sim = null;
      }
    }
    return h(
      'div',
      { class: ['card', 'kit-card', draft && 'is-draft'] },
      h('div', { class: 'row between' }, h('b', {}, `${c.name} `), h('span', { class: `chip r-${gradeOf(c)}` }, rarLabel(gradeOf(c)))),
      h('div', { class: 'muted small' }, `${c.id} · ${c.title || ''}`),
      h('div', { class: 'row wrap' }, h('label', { class: 'field' }, '역할', roleSel), h('label', { class: 'field' }, '아키타입', archSel)),
      has
        ? h(
            'div',
            { class: 'small' },
            draft && h('span', { class: 'chip warn' }, '새로 생성 (저장 전)'),
            cur.resource && h('div', {}, `자원: ${cur.resource.name} (상한 ${cur.resource.cap})`),
            ['basic', 'skill', 'ultimate'].map((k) => h('div', {}, h('b', {}, `${vocab.actions[k]} 「${cur.kit?.[k]?.name || '-'}」 `), h('span', { class: 'muted' }, lines(cur.kit?.[k])))),
            cur.kit?.transformed && h('div', { class: 'muted' }, `변신: ${Object.values(cur.kit.transformed).map((s) => s.name).join(' · ')}`),
            (cur.talents || []).map((p) => h('div', {}, h('b', {}, `특성 「${p.name}」 `), h('span', { class: 'muted' }, describe.describePassive(p, vocab).join(' / ')))),
            cur.bt2 && h('div', {}, h('b', {}, `돌파 2 「${cur.bt2.name}」 `), h('span', { class: 'muted' }, describe.describePassive(cur.bt2, vocab).join(' / '))),
            cur.bt6 && h('div', {}, h('b', {}, `돌파 6 「${cur.bt6.name}」 `), h('span', { class: 'muted' }, describe.describePassive(cur.bt6, vocab).join(' / '))),
            h('div', { class: 'muted' }, `예산: ${budgetLine(budget)}`),
            sim && h('div', {}, ...sim.map((r) => h('span', { class: 'chip' }, `${r.stage.name} ${Math.round(r.winRate * 100)}% · 기여 ${Math.round(r.share * 100)}%`))),
            draft?.issues?.filter((i) => i.where !== 'schema').map((i) => h('div', { class: i.level === 'error' ? 'error' : 'warn-text' }, `${i.where}: ${i.message}`)),
          )
        : h('p', { class: 'muted small' }, '키트 없음 (기본 스킬)'),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: generate }, has ? '다시 생성' : '생성'),
        draft && h('button', { class: 'btn small primary', onclick: () => approve([c.id]) }, '승인 (저장)'),
        draft && h('button', { class: 'btn small', onclick: () => (drafts.delete(c.id), render()) }, '버리기'),
        h('button', { class: 'btn small', onclick: () => openCharBattleEditor(c, { onSaved: render }) }, '편집기'),
      ),
    );
  }

  async function approve(ids) {
    const list = ids.filter((id) => drafts.has(id));
    if (!list.length) return;
    let saved = 0;
    await busy(`키트 ${list.length}개 저장 중…`, async () => {
      for (const id of list) {
        const c = state.data.characters.find((x) => x.id === id);
        const fields = kt.gen.kitFields(drafts.get(id));
        try {
          // 손조정/능력치는 그대로, 예전 방식 돌파(breakthroughs)는 비움
          await api.put(`/api/characters/${id}/battle`, { ...fields, statTweak: c.statTweak, stats: c.stats });
          drafts.delete(id);
          saved += 1;
        } catch (e) {
          toast(`${c.name}: ${e.message}`, 'error');
        }
      }
      await reloadData();
    });
    toast(`키트 ${saved}개를 저장했어요 (작업 공간)`, 'success');
    render();
  }

  function render() {
    if (!kt) return;
    const list = players();
    root.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `키트 일괄 (${list.length}명)`), h('div', { class: 'row' }, h('button', {
          class: 'btn small',
          onclick: async () => {
            const targets = list.filter((c) => !c.kitGen);
            if (!targets.length && !(await confirmBox('모두 다시 생성', '모든 캐릭터가 이미 키트를 가지고 있어요. 전부 다시 생성할까요? (저장 전까지는 그대로)', { ok: '다시 생성' }))) return;
            for (const c of targets.length ? targets : list) {
              const role = c.role || 'attacker';
              drafts.set(c.id, kt.gen.generateKit({ id: c.id, role, rarity: c.rarity, archetype: c.archetype || kt.gen.suggestArchetype(list, role), balance: kt.balance, vocab: kt.vocab }));
            }
            render();
          },
        }, '키트 없는 캐릭터 전부 생성'), h('button', { class: 'btn small primary', disabled: !drafts.size, onclick: () => approve([...drafts.keys()]) }, `전체 승인 (${drafts.size})`))),
        h('p', { class: 'muted small' }, '아키타입 템플릿 + 역할 + 희귀도로 결정론 생성 (AI 없음). 예산 %는 희귀도 상한 대비 — 100% ± 5%가 목표. 빠른 시뮬은 Lv.20 · 돌파 2, 다른 역할 4명과 챕터 마지막 스테이지 10판.'),
      ),
      spreadBox(),
      h('div', { class: 'kit-grid' }, ...list.map(card)),
    );
  }

  return { refresh: render, isDirty: () => drafts.size > 0 };
}
