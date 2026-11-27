// 추억 탭: 추억 카드 목록 / 새 추억 / 편집(이름 · 희귀도 · 종류 · 주인 · 부옵션 · 패시브) / 생성기로 다시 만들기 / 카드 그림(ComfyUI)
// 빈 칸(draft: true): 새 추억 · 5★ 전용 빈 칸(서버 memslots.py가 캐릭터를 만들 때 자동)은 일반 패시브를 채워 저장할 때까지 배포에서 보류, 게임은 무시
// 일반 라이브러리 + 5★ 전용 추억은 tools/memgen(결정론, AI 없음)이 만들고 genKey로 같은 항목에 다시 붙음 (id · 그림 · 공개 시각 유지)
// 그림: 장면 프롬프트(AI 또는 테마 태그) + 주인 캐릭터 외형 슬롯 그대로 → 1차만 → 카드 WebP(높이 1024) + 썸네일(256)
//       마음에 드는 시도만 '하이레스로 다듬기'(검토 패널, 1.25× · 13스텝 img2img 한 번)
import { h, toast, confirmBox, busy, wsImage, idBadge, rarLabel, dateField, nowIso, gradeOf } from '../ui.js';
import { api, tryApi, newId } from '../api.js';
import { state, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { promptStep } from '../promptStep.js';
import { passiveForm, blankPassive } from '../battleForm.js';
import { loadKitTools } from '../kitTools.js';

const KIND_LABEL = { default: '역할 기본', generic: '일반', signature: '전용 (5★)' };
const ROLE_LABEL = { attacker: '딜러', defender: '탱커', support: '지원', healer: '치유' };
const blankMemory = () => ({ id: '', name: '', rarity: 4, kind: 'generic', secondary: { stat: 'atk' }, passive: {}, theme: [], image: '', thumb: '', addedAt: '', draft: true });
/** 일반 패시브에 효과나 수정자가 하나라도 있으면 채워진 카드 (빈 칸 풀림) */
const filled = (m) => !!((m.passive?.generic?.effects || []).length || (m.passive?.generic?.modifiers || []).length);

export function memoriesTab(root, { select } = {}) {
  let kt = null;
  let mg = null;
  let budget = null;
  let selectedId = select || null;
  let dirty = false;
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  const title = h('h2', {});
  const slotBtn = h('button', { class: 'btn small', onclick: makeSlots, hidden: true });
  root.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));

  (async () => {
    kt = await loadKitTools();
    [mg, budget] = await Promise.all([import('/preview/tools/memgen/generate.js'), import('/preview/tools/kitgen/budget.js')]);
    root.replaceChildren(
      h(
        'div',
        { class: 'two-col' },
        h(
          'div',
          { class: 'col-left' },
          h(
            'section',
            { class: 'card' },
            h('div', { class: 'row between' }, title, h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => edit(null) }, '+ 새 추억'), h('button', { class: 'btn small', onclick: regenerate }, '생성기로 다시 만들기'))),
            h('p', { class: 'muted small' }, '생성기 = 일반 라이브러리 + 5★ 캐릭터마다 전용 추억 (키트의 전용 추억 변형). 있던 카드는 id · 그림 · 공개 시각을 그대로 두고 수치만 새로 써요. 「빈 칸」은 패시브를 채워 저장하기 전까지 배포에서 빠져요.'),
            slotBtn,
            list,
          ),
        ),
        editor,
      ),
    );
    renderList();
    const sel = mems().find((m) => m.id === selectedId);
    if (sel) edit(sel);
    else editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 추억을 골라 주세요.'));
  })();

  const mems = () => state.data.memories || [];
  const charName = (id) => state.data.characters.find((c) => c.id === id)?.name || id;
  /** 전용 추억(빈 칸 포함)이 없는 5★ (NPC · 은퇴 제외) — 서버 memslots.needs_slot과 같은 규칙 */
  const missingSlots = () => state.data.characters.filter((c) => gradeOf(c) === 5 && !c.retired && !mems().some((m) => m.signatureOf === c.id));

  async function makeSlots() {
    const r = await tryApi(() => api.post('/api/memories/slots', {}));
    if (!r) return;
    await reloadData();
    renderList();
    toast(r.made.length ? `전용 추억 빈 칸 ${r.made.length}장을 만들었어요` : '만들 빈 칸이 없어요', 'success');
  }

  function renderList() {
    title.textContent = `추억 (${mems().length})`;
    const miss = missingSlots();
    slotBtn.hidden = !miss.length;
    slotBtn.textContent = `빈 전용 칸 만들기 (${miss.map((c) => c.name).join(', ')})`;
    list.replaceChildren(
      ...[...mems()]
        .sort((a, b) => (b.draft === true) - (a.draft === true) || b.rarity - a.rarity || a.id.localeCompare(b.id))
        .map((m) =>
          h(
            'button',
            { class: ['list-item', m.id === selectedId && 'active'], onclick: () => edit(m) },
            h(
              'div',
              { class: 'row' },
              h('div', { class: 'thumb small-thumb' }, m.thumb || m.image ? h('img', { src: wsImage(m.thumb || m.image), alt: '', onerror: (e) => e.target.remove() }) : '✦'),
              h('div', { class: 'grow' }, h('b', {}, m.name), ' ', h('span', { class: `chip r-${m.rarity}` }, rarLabel(m.rarity)), ' ', h('span', { class: 'chip' }, KIND_LABEL[m.kind] || m.kind), m.draft === true && h('span', { class: 'chip warn', title: '패시브를 채워 저장하기 전까지 배포에서 빠져요' }, '빈 칸'), h('div', { class: 'muted small' }, `${m.id}${m.signatureOf ? ` · ${charName(m.signatureOf)} 전용` : m.role ? ` · ${ROLE_LABEL[m.role]} 기본` : ''}${m.image ? '' : ' · 그림 없음'}`)),
            ),
          ),
        ),
    );
  }

  /** 생성기 결과를 지금 목록에 합침 (genKey가 같으면 id/그림/공개 시각 유지, 새 항목은 id 발급) */
  async function regenerate() {
    if (dirty && !(await confirmBox('저장하지 않은 변경', '버리고 다시 만들까요?', { ok: '버리기', danger: true }))) return;
    const gens = mg.generateMemories({ characters: state.data.characters, balance: kt.balance, vocab: kt.vocab });
    const { entries: out, fresh, kept } = mg.mergeGenerated(mems(), gens);
    const keptNote = kept.length ? ` 생성기가 이번에 안 만드는 ${kept.length}장(${kept.map((m) => m.name).join(', ')})은 그대로 둬요.` : '';
    if (!(await confirmBox('생성기로 다시 만들기', `${gens.length}장 (새로 ${fresh.length}장). 손으로 고친 수치는 생성기 값으로 돌아가요.${keptNote} 계속할까요?`, { ok: '다시 만들기' }))) return;
    await busy('추억 다시 만드는 중…', async () => {
      const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00';
      for (const entry of out) {
        if (!entry.id) entry.id = await newId('memory');
        if (!entry.addedAt) entry.addedAt = now;
      }
      out.sort((a, b) => a.id.localeCompare(b.id));
      await api.put('/api/list/memories', out);
      await reloadData();
    });
    dirty = false;
    toast('추억을 다시 만들었어요 (작업 공간)', 'success');
    renderList();
  }

  /** src = null이면 새 추억 (id는 처음 저장/그림 뽑기 때 발급). keepDirty = 생성기로 채운 폼처럼 아직 저장 안 된 값 */
  async function edit(src, { keepDirty = false } = {}) {
    if (!keepDirty && dirty && !(await confirmBox('저장하지 않은 변경', '버리고 이동할까요?', { ok: '버리기', danger: true }))) return;
    const isNew = !src?.id;
    selectedId = src?.id || null;
    dirty = keepDirty || isNew;
    renderList();
    const v = structuredClone(src || blankMemory());
    v.passive ||= {};
    v.passive.generic ||= blankPassive();
    const mark = () => ((dirty = true), showBudget());
    const idEl = h('div', {}, idBadge(v.id));
    const ensureId = async () => {
      if (!v.id) {
        v.id = (await tryApi(() => newId('memory'))) || '';
        idEl.replaceChildren(idBadge(v.id));
      }
      return v.id;
    };
    const added = dateField('공개 시각 (이 시각부터 뽑기 · 도감에 나옴)', v.addedAt || nowIso(), { allowEmpty: false });
    added.el.addEventListener('change', mark);
    const field = (label, el) => h('label', { class: 'field' }, label, el);
    const sel = (opts, value, onChange) => {
      const s = h('select', { onchange: (e) => (onChange(e.target.value), mark()) }, opts.map(([k, l]) => h('option', { value: k }, l)));
      s.value = value ?? '';
      return s;
    };
    const name = h('input', { value: v.name, oninput: (e) => ((v.name = e.target.value), mark()) });
    const rarity = sel([[3, '3★'], [4, '4★'], [5, '5★']], v.rarity, (x) => (v.rarity = Number(x)));
    const kind = sel(Object.entries(KIND_LABEL), v.kind, (x) => (v.kind = x));
    const role = sel([['', '(없음)'], ...Object.entries(ROLE_LABEL)], v.role || '', (x) => (x ? (v.role = x) : delete v.role));
    const players = state.data.characters.filter((c) => c.rarity !== 'npc');
    const owner = sel([['', '(없음)'], ...players.map((c) => [c.id, `${c.name} (${rarLabel(c.rarity)})`])], v.signatureOf || '', (x) => (x ? (v.signatureOf = x) : delete v.signatureOf));
    const featured = sel([['', '(없음 — 장면/물건만)'], ...state.data.characters.map((c) => [c.id, c.name])], v.featuredCharacterId || '', (x) => (x ? (v.featuredCharacterId = x) : delete v.featuredCharacterId));
    const sec = sel(Object.entries(kt.vocab.stats).filter(([k]) => !['dmgDealt', 'dmgTaken'].includes(k)), v.secondary?.stat || 'atk', (x) => (v.secondary = { stat: x }));
    const theme = h('input', { value: (v.theme || []).join(', '), placeholder: '그림 장면 태그 (쉼표) — AI가 꺼져 있으면 이 태그로 장면을 만들어요', oninput: (e) => ((v.theme = e.target.value.split(',').map((t) => t.trim()).filter(Boolean)), mark()) });
    const budgetBox = h('div', { class: 'small' });
    const showBudget = () => {
      const B = kt.balance.kitBudget;
      const clean = (p) => (p ? kt.schema.cleanPassive(p, kt.vocab, () => {}, 'p') : null);
      const cap = budget.capFor('signature', v.rarity, B);
      const rep = (p) => budget.report(budget.passivePoints(clean(p), B), cap, B);
      const g = rep(v.passive.generic);
      const o = v.passive.owner ? rep(v.passive.owner) : null;
      budgetBox.replaceChildren(`예산: 일반 ${g.pct}%${g.ok ? '' : '⚠'}`, o ? ` · 주인 보너스 ${o.pct}%${o.ok ? '' : '⚠'}` : '', h('span', { class: 'muted' }, ` (상한 ${Math.round(cap)}점 = 전용 추억 상한 × ${v.rarity}★ 계수)`));
    };
    const preview = (get) => () => {
      const p = get();
      return p ? kt.describe.describePassive(kt.schema.cleanPassive(p, kt.vocab, () => {}, 'p'), kt.vocab) : [];
    };
    const ownerBox = h('div');
    const renderOwner = () =>
      ownerBox.replaceChildren(
        v.passive.owner
          ? h('div', {}, passiveForm(v.passive.owner, { onChange: mark, preview: preview(() => v.passive.owner), title: '주인 보너스 (signatureOf가 장착했을 때만)' }).el, h('button', { class: 'btn tiny danger-outline', onclick: () => (delete v.passive.owner, mark(), renderOwner()) }, '주인 보너스 삭제'))
          : h('button', { class: 'btn small', onclick: () => ((v.passive.owner = blankPassive()), mark(), renderOwner()) }, '+ 주인 보너스'),
      );
    renderOwner();

    // 빈 칸 안내 + 전용 칸이면 생성기로 채우기 (주인 캐릭터에 키트 아키타입이 있을 때)
    const ownerChar = v.signatureOf && state.data.characters.find((c) => c.id === v.signatureOf);
    const canGen = v.kind === 'signature' && ownerChar && gradeOf(ownerChar) === 5 && ownerChar.kitGen?.archetype;
    function fillFromGenerator() {
      const g = mg.generateMemories({ characters: [ownerChar], balance: kt.balance, vocab: kt.vocab }).find((x) => x.genKey === `signature:${ownerChar.id}`);
      if (!g) return toast('생성기가 이 캐릭터의 전용 추억을 만들지 못했어요', 'error');
      const entry = mg.memoryFields(g, { ...v, genKey: g.genKey });
      edit(entry, { keepDirty: true });
      toast('생성기 값으로 채웠어요 — 저장하면 빈 칸이 풀려요', 'success');
    }
    const draftNote =
      v.draft === true &&
      h(
        'div',
        { class: 'card inner draft-box' },
        h('b', {}, '빈 칸'),
        ' — 일반 패시브에 효과를 채우고 저장하면 빈 칸이 풀려서 배포에 들어가요 (그 전에는 배포에서 보류, 게임에 안 나옴).',
        v.kind === 'signature' &&
          (canGen
            ? h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: fillFromGenerator }, '생성기로 채우기'), h('span', { class: 'muted small' }, `${ownerChar.name}의 키트(${ownerChar.kitGen.archetype}) 전용 추억 변형`))
            : h('p', { class: 'muted small' }, '주인 캐릭터의 키트(아키타입)를 캐릭터 전투 편집기에서 정하면 「생성기로 채우기」를 쓸 수 있어요. 지금은 아래에서 직접 채워 주세요.')),
      );

    const imgBox = h('div', { class: 'mem-preview' }, v.image ? h('img', { src: wsImage(v.image), alt: '' }) : h('span', { class: 'muted' }, '그림 없음'));
    const extra = h('input', { placeholder: '추가 연출 (예: 노을 진 성벽 위, 바람에 날리는 망토)' });
    const img2img = h('input', { type: 'checkbox', checked: !!state.settings?.comfy?.memoryImg2img });
    const jobArea = h('div');
    const memInput = () => ({ memoryId: v.id, extra: extra.value, img2img: img2img.checked });
    const artStep = promptStep({ kind: 'memory', getInput: memInput, generateLabel: '카드 그림 뽑기', generate: (gen) => genArt(gen) });
    async function genArt(gen) {
      if ((dirty || !v.id) && !(await save())) return;
      const job = await tryApi(() => api.post('/api/memory/generate', { ...memInput(), ...gen }));
      if (!job) return;
      const panel = jobPanel(job, {
        approveLabel: '이 그림을 카드로 사용',
        onApprove: async (n) => {
          const r = await tryApi(() => api.post(`/api/jobs/${job.id}/approve-image`, { attempt: n }));
          if (!r) return false;
          await reloadData();
          const now = mems().find((m) => m.id === v.id);
          imgBox.replaceChildren(h('img', { src: `${wsImage(now?.image || r.path)}?t=${Date.now()}`, alt: '' }));
          renderList();
          toast('추억 카드 그림을 저장했어요 (카드 + 썸네일)', 'success');
          return true;
        },
      });
      jobArea.replaceChildren(panel.el);
    }

    async function save() {
      if (!v.name.trim()) return toast('이름을 입력해 주세요', 'error'), false;
      if (v.kind === 'signature' && !v.signatureOf) return toast('전용 추억은 주인 캐릭터를 골라 주세요', 'error'), false;
      if (v.kind === 'default' && !v.role) return toast('역할 기본 추억은 역할을 골라 주세요', 'error'), false;
      const owner = v.kind === 'signature' && mems().find((m) => m.id !== v.id && m.signatureOf === v.signatureOf);
      if (owner) return toast(`${charName(v.signatureOf)}의 전용 추억은 이미 있어요 (${owner.name} · ${owner.id})`, 'error'), false;
      if (!(await ensureId())) return false;
      v.addedAt = added.get() || nowIso();
      const wasDraft = v.draft === true;
      if (filled(v)) delete v.draft;
      else v.draft = true;
      const exists = mems().some((m) => m.id === v.id);
      const items = exists ? mems().map((m) => (m.id === v.id ? v : m)) : [...mems(), v].sort((a, b) => a.id.localeCompare(b.id));
      const ok = await tryApi(() => api.put('/api/list/memories', items));
      if (ok === null) return false;
      await reloadData();
      dirty = false;
      selectedId = v.id;
      renderList();
      if (v.draft) toast('저장했어요 — 아직 빈 칸이에요 (일반 패시브에 효과를 넣으면 배포에 들어가요)', 'success');
      else toast(wasDraft ? '저장했어요 — 빈 칸이 풀렸어요' : '추억을 저장했어요 (작업 공간)', 'success');
      if (wasDraft !== (v.draft === true) || !exists) edit(mems().find((m) => m.id === v.id));
      return true;
    }
    async function remove() {
      if (!v.id || !mems().some((m) => m.id === v.id)) {
        dirty = false;
        selectedId = null;
        editor.replaceChildren(h('div', { class: 'empty' }, '만들기를 취소했어요'));
        return renderList();
      }
      const used = state.data.banners.filter((b) => (b.pickupIds || []).includes(v.id)).map((b) => b.title);
      const msg = `${used.length ? `이 추억을 픽업하는 배너: ${used.join(', ')} — 배포 검사에서 오류가 나요.\n` : ''}플레이어가 이미 가진 카드는 세이브에 남지만 화면에서 안 보여요. 보통은 은퇴(retired)를 권장해요.`;
      if (!(await confirmBox(`「${v.name}」 삭제`, msg, { ok: '삭제', danger: true }))) return;
      if ((await tryApi(() => api.put('/api/list/memories', mems().filter((m) => m.id !== v.id)))) === null) return;
      await reloadData();
      selectedId = null;
      dirty = false;
      editor.replaceChildren(h('div', { class: 'empty' }, '삭제했어요'));
      renderList();
    }
    const retired = h('input', { type: 'checkbox', checked: !!v.retired, onchange: (e) => (e.target.checked ? (v.retired = true) : delete v.retired, mark()) });

    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, isNew ? '새 추억' : `추억 편집 — ${v.id}`),
        draftNote,
        h(
          'div',
          { class: 'row', style: { gap: '16px', alignItems: 'flex-start' } },
          imgBox,
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'grid2' }, field('id (자동)', idEl), field('이름', name)),
            h('div', { class: 'grid2' }, field('희귀도', rarity), field('종류', kind)),
            h('div', { class: 'grid2' }, field('역할 기본 (kind: 역할 기본)', role), field('전용 주인 (5★, owner 보너스)', owner)),
            h('div', { class: 'grid2' }, field('그림에 나오는 캐릭터', featured), field('부옵션 능력치 (값은 balance.memory)', sec)),
            field('장면 태그', theme),
            added.el,
            h('label', { class: 'inline' }, retired, '은퇴 (뽑기에서 빠짐, 가진 카드는 계속 씀)'),
            v.genKey && h('p', { class: 'muted small' }, `생성기 항목 (${v.genKey}) — '생성기로 다시 만들기'를 누르면 수치가 생성기 값으로 돌아가요`),
          ),
        ),
        budgetBox,
        h('h3', {}, '패시브 (재련 R1–R5: 숫자 × balance.memory.refineScale)'),
        passiveForm(v.passive.generic, { onChange: mark, preview: preview(() => v.passive.generic), title: '일반 (누가 장착해도)' }).el,
        ownerBox,
        h('h3', {}, '카드 그림'),
        h('p', { class: 'muted small' }, '832×1216 한 번만 그려요 → 카드 WebP(높이 1024) + 썸네일(256). 마음에 드는 시도는 검토 패널의 「하이레스로 다듬기」로 키워서 짧게 한 번 더 그릴 수 있어요. 등장 캐릭터가 있으면 그 캐릭터 승인 그림의 외형 태그(머리/눈/옷/소품)를 그대로 넣고, AI는 장면만 써요. 테두리는 게임 화면이 그려요.'),
        h('div', { class: 'row wrap' }, extra, h('label', { class: 'inline', title: '승인한 컷아웃을 대충 그린 배경에 합성해서 시작 (denoise는 설정 탭)' }, img2img, '컷아웃으로 시작 (img2img)')),
        artStep.el,
        jobArea,
        h('div', { class: 'row wrap sticky-actions' }, h('button', { class: 'btn primary', onclick: save }, '저장'), h('button', { class: 'btn danger-outline', onclick: remove }, isNew ? '취소' : '삭제')),
      ),
    );
    showBudget();
  }

  return { refresh: renderList, isDirty: () => dirty };
}
