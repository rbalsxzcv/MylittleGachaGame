// 스테이지 탭 (모험): 챕터, 연결 스토리(storyId), 웨이브 편집(적 + 레벨), 라운드 제한, 보상/첫 클리어 보상, 권장 전투력
// 모험 규칙: 스테이지 1개 = 메인 스토리 1개 + 그 스토리 안의 전투 장면 1개
import { h, toast, confirmBox, idBadge } from '../ui.js';
import { api, tryApi, newId } from '../api.js';
import { state, reloadData } from '../state.js';
import { loadBattleKit, cleanEntity } from '../battleForm.js';

const MAX_PER_WAVE = 6;

export function stagesTab(root, { select } = {}) {
  let editing = null;
  let dirty = false;
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  root.replaceChildren(
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'col-left' }, h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, `스테이지 (${state.data.stages.length})`), h('button', { class: 'btn primary small', onclick: () => edit(null) }, '+ 새 스테이지')), list)),
      editor,
    ),
  );

  function renderList() {
    list.replaceChildren(
      ...state.data.stages.map((st) =>
        h(
          'button',
          { class: ['list-item', editing?.v.id === st.id && 'active'], onclick: () => edit(st) },
          h('b', {}, st.name),
          h('div', { class: 'muted small' }, `${st.chapter || 'ch01'} · ${st.id} · ${st.storyId || '스토리 없음'} · 웨이브 ${(st.waves || []).length} · 권장 ${st.recommendedPower ?? 0}`),
        ),
      ),
      ...(state.data.stages.length ? [] : [h('p', { class: 'muted' }, '아직 스테이지가 없어요')]),
    );
  }

  async function edit(st) {
    if (dirty && !(await confirmBox('저장하지 않은 변경', '버리고 이동할까요?', { ok: '버리기', danger: true }))) return;
    const { vocab, progression } = await loadBattleKit();
    const balance = progression.validateBalance(state.data.balance, vocab, () => {});
    const isNew = !st;
    const firstEnemy = state.data.enemies[0]?.id || '';
    const v = structuredClone(
      st || { id: '', name: '', chapter: state.data.stages.at(-1)?.chapter || 'ch01', storyId: '', recommendedPower: 0, waves: [[{ enemyId: firstEnemy, level: 1 }]], roundLimit: 20, rewards: { tickets: 40, gems: 0, gold: 400 }, firstClearRewards: { tickets: 150, gems: 50, gold: 1500 } },
    );
    // 예전 이름 turnLimit → roundLimit
    if (v.turnLimit !== undefined) {
      v.roundLimit ??= v.turnLimit;
      delete v.turnLimit;
    }
    v.chapter ||= 'ch01';
    v.rewards = v.rewards || { tickets: 0, gems: 0 };
    v.firstClearRewards = v.firstClearRewards || { tickets: 0, gems: 0 };
    editing = { v, isNew };
    dirty = false;
    renderList();
    const mark = () => {
      dirty = true;
      renderPowerHint();
    };

    // 레벨을 비우면 게임이 추천 전투력으로 계산 (config.enemyLevelFor와 같은 식)
    const autoLevel = () => Math.max(1, Math.round(1 + ((v.recommendedPower || 0) / 5 - balance.combat.enemyLevel.refPower) / balance.combat.enemyLevel.perLevel));
    const enemyById = new Map(state.data.enemies.map((e) => [e.id, cleanEntity(e, { enemy: true })]));
    const enemyPower = (e) => {
      const en = enemyById.get(e.enemyId);
      return en ? progression.powerOf(progression.statsOf(en, e.level || autoLevel(e), 0, balance), balance) : 0;
    };

    const num = (obj, key, opts = {}) =>
      h('input', {
        type: 'number',
        class: 'num-input',
        min: opts.min ?? 0,
        value: obj[key] ?? '',
        placeholder: opts.placeholder || '',
        oninput: (ev) => {
          const raw = ev.target.value;
          if (raw === '' && opts.nullable) obj[key] = null;
          else obj[key] = Math.max(opts.min ?? 0, parseInt(raw, 10) || 0);
          mark();
        },
      });

    const id = h('div', {}, idBadge(v.id));
    const name = h('input', { value: v.name, oninput: (ev) => ((v.name = ev.target.value), mark()) });
    const rec = num(v, 'recommendedPower');
    const powerHint = h('span', { class: 'muted small' });
    const renderPowerHint = () => {
      const waves = v.waves.map((w) => w.reduce((a, e) => a + enemyPower(e), 0));
      const strongest = Math.max(0, ...waves);
      const suggest = Math.round((strongest * 1.2) / 100) * 100; // 가장 센 웨이브의 1.2배
      powerHint.replaceChildren(`웨이브별 적 전투력: ${waves.join(' / ') || '-'} → 제안 ${suggest} `, h('button', { class: 'btn tiny', onclick: () => ((v.recommendedPower = suggest), (rec.value = suggest), mark()) }, '제안값 넣기'));
    };

    const wavesBox = h('div');
    const renderWaves = () => {
      wavesBox.replaceChildren(
        ...v.waves.map((wave, wi) =>
          h(
            'div',
            { class: 'scene-card' },
            h(
              'div',
              { class: 'row wrap scene-head' },
              h('b', {}, `웨이브 ${wi + 1}`),
              h('span', { class: 'muted small' }, `${wave.length}/${MAX_PER_WAVE}명 · 전투력 ${wave.reduce((a, e) => a + enemyPower(e), 0)}`),
              h('span', { class: 'grow' }),
              h('button', { class: 'btn tiny', onclick: () => moveWave(wi, -1) }, '▲'),
              h('button', { class: 'btn tiny', onclick: () => moveWave(wi, 1) }, '▼'),
              h('button', { class: 'btn tiny', disabled: v.waves.length <= 1, onclick: () => (v.waves.splice(wi, 1), mark(), renderWaves()) }, '웨이브 삭제'),
            ),
            ...wave.map((e, ei) => {
              const sel = h('select', { onchange: (ev) => ((e.enemyId = ev.target.value), mark(), renderWaves()) }, h('option', { value: '' }, '(적 선택)'), state.data.enemies.map((x) => h('option', { value: x.id }, `${x.name}${x.boss ? ' (보스)' : ''} · ${x.id}`)));
              sel.value = e.enemyId || '';
              return h(
                'div',
                { class: 'row' },
                h('span', { class: 'muted small' }, `${ei + 1}`),
                sel,
                h('label', { class: 'inline' }, 'Lv', h('input', { type: 'number', class: 'num-input', min: 1, value: e.level ?? '', placeholder: `자동 ${autoLevel()}`, onchange: (ev) => (ev.target.value === '' ? delete e.level : (e.level = Math.max(1, parseInt(ev.target.value, 10) || 1)), mark(), renderWaves()) })),
                h('span', { class: 'muted small' }, `전투력 ${enemyPower(e)}`),
                h('span', { class: 'grow' }),
                h('button', { class: 'btn tiny', disabled: wave.length <= 1, onclick: () => (wave.splice(ei, 1), mark(), renderWaves()) }, '✕'),
              );
            }),
            h('button', { class: 'btn tiny', disabled: wave.length >= MAX_PER_WAVE, onclick: () => (wave.push({ enemyId: wave.at(-1)?.enemyId || firstEnemy, level: wave.at(-1)?.level || 1 }), mark(), renderWaves()) }, '+ 적'),
          ),
        ),
        h('button', { class: 'btn small', onclick: () => (v.waves.push([{ enemyId: firstEnemy, level: 1 }]), mark(), renderWaves()) }, '+ 웨이브'),
      );
      renderPowerHint();
    };
    const moveWave = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= v.waves.length) return;
      [v.waves[i], v.waves[j]] = [v.waves[j], v.waves[i]];
      mark();
      renderWaves();
    };
    renderWaves();

    const refsBox = h('div', { class: 'muted small' }, '불러오는 중…');
    if (!isNew) {
      tryApi(() => api.get(`/api/stages/${v.id}/refs`)).then((refs) => {
        refsBox.replaceChildren(
          ...(refs?.length
            ? refs.map((r) => h('div', {}, h('a', { href: `#stories/${r.storyId}` }, `「${r.title}」`), ` 장면 ${r.sceneId}`))
            : [h('span', { class: 'warn-text' }, '아직 어느 스토리에도 없어요. 스토리 탭에서 "+ 전투 장면"으로 넣어 주세요 (게임에서는 스토리 안에서만 싸워요).')]),
        );
      });
    } else refsBox.textContent = '저장한 뒤 스토리 탭에서 전투 장면으로 넣어 주세요.';

    async function save() {
      if (!v.name.trim()) return toast('이름을 입력해 주세요', 'error');
      if (v.waves.some((w) => w.some((e) => !e.enemyId))) return toast('적을 고르지 않은 칸이 있어요', 'error');
      if (!v.storyId) return toast('연결할 메인 스토리를 골라 주세요 (스테이지 1개 = 스토리 1개 + 전투 1개)', 'error');
      if (!v.id) {
        const nid = await tryApi(() => newId('stage')); // id는 자동 (stage_0001 …)
        if (!nid) return;
        v.id = nid;
        id.replaceChildren(idBadge(v.id));
      }
      const item = structuredClone(v);
      if (item.roundLimit === '' || item.roundLimit === 0) item.roundLimit = null;
      if (!item.storyId) return toast('연결할 메인 스토리를 골라 주세요 (스테이지 1개 = 스토리 1개 + 전투 1개)', 'error');
      const other = state.data.stages.find((x) => x.id !== item.id && x.storyId === item.storyId);
      if (other) return toast(`이 스토리는 이미 「${other.name}」(${other.id})가 쓰고 있어요`, 'error');
      const items = state.data.stages.filter((x) => x.id !== item.id);
      const pos = state.data.stages.findIndex((x) => x.id === item.id);
      pos >= 0 ? items.splice(pos, 0, item) : items.push(item);
      if ((await tryApi(() => api.put('/api/list/stages', items))) === null) return;
      await reloadData();
      dirty = false;
      editing.isNew = false;
      renderList();
      toast('스테이지를 저장했어요 (작업 공간)', 'success');
    }

    async function remove() {
      const refs = (await tryApi(() => api.get(`/api/stages/${v.id}/refs`))) || [];
      const msg = refs.length ? `이 스테이지를 쓰는 스토리가 있어요:\n- ${refs.map((r) => r.title).join('\n- ')}\n\n삭제하면 검사에서 오류가 나요.` : '삭제할까요?';
      if (!(await confirmBox(`「${v.name}」 삭제`, msg, { ok: '삭제', danger: true }))) return;
      if ((await tryApi(() => api.put('/api/list/stages', state.data.stages.filter((x) => x.id !== v.id)))) === null) return;
      await reloadData();
      editing = null;
      dirty = false;
      editor.replaceChildren(h('div', { class: 'empty' }, '삭제했어요'));
      renderList();
    }

    const turnLimit = num(v, 'roundLimit', { min: 1, nullable: true, placeholder: '제한 없음' });
    const chapters = [...new Set([...state.data.stages.map((x) => x.chapter || 'ch01'), v.chapter])];
    // 챕터: 있는 챕터에서 고르거나 '새 챕터' (번호는 자동: 마지막 챕터 + 1)
    const nextChapter = `ch${String(Math.max(0, ...chapters.map((c) => parseInt(String(c).replace(/\D/g, ''), 10) || 0)) + 1).padStart(2, '0')}`;
    const chapterSel = h(
      'select',
      { onchange: (ev) => ((v.chapter = ev.target.value), mark()) },
      chapters.sort().map((c) => h('option', { value: c }, c)),
      h('option', { value: nextChapter }, `${nextChapter} (새 챕터)`),
    );
    chapterSel.value = v.chapter;
    const chapterList = null;
    const mains = state.data.storyIndex.filter((s) => s.kind === 'main');
    const storySel = h(
      'select',
      { onchange: (ev) => ((v.storyId = ev.target.value), mark()) },
      h('option', { value: '' }, '(메인 스토리 선택)'),
      mains.map((s) => {
        const used = state.data.stages.find((x) => x.id !== v.id && x.storyId === s.id);
        return h('option', { value: s.id, disabled: !!used }, `${s.id} 「${s.title}」${used ? ` — ${used.id} 사용 중` : ''}`);
      }),
    );
    storySel.value = v.storyId || '';
    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, isNew ? '새 스테이지' : `스테이지 편집 — ${v.id}`),
        !state.data.enemies.length && h('p', { class: 'note' }, '적 탭에서 먼저 적을 만들어 주세요.'),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'id (자동)', id), h('label', { class: 'field' }, '이름', name)),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '챕터 (모험 탭 묶음, 예: ch01)', chapterSel, chapterList), h('label', { class: 'field' }, '연결 스토리 (이 스토리 안에 이 스테이지 전투 장면을 넣어요)', storySel)),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '권장 전투력', rec, powerHint), h('label', { class: 'field' }, '라운드 제한 (비우면 없음)', turnLimit)),
        h('h3', {}, '웨이브 (앞 웨이브를 모두 쓰러뜨리면 다음 웨이브)'),
        wavesBox,
        h('h3', {}, '보상'),
        h(
          'div',
          { class: 'grid2' },
          h('div', { class: 'card inner' }, h('b', {}, '클리어할 때마다'), h('label', { class: 'field' }, '티켓', num(v.rewards, 'tickets')), h('label', { class: 'field' }, '보석', num(v.rewards, 'gems')), h('label', { class: 'field' }, '골드', num(v.rewards, 'gold'))),
          h('div', { class: 'card inner' }, h('b', {}, '첫 클리어 (한 번만)'), h('label', { class: 'field' }, '티켓', num(v.firstClearRewards, 'tickets')), h('label', { class: 'field' }, '보석', num(v.firstClearRewards, 'gems')), h('label', { class: 'field' }, '골드', num(v.firstClearRewards, 'gold'))),
        ),
        h('h3', {}, '이 스테이지를 쓰는 스토리'),
        refsBox,
        h(
          'div',
          { class: 'row wrap sticky-actions' },
          h('button', { class: 'btn primary', onclick: save }, '저장'),
          !isNew && h('a', { class: 'btn', href: `#balance/${v.id}` }, '밸런스 시뮬레이션'),
          !isNew && h('button', { class: 'btn danger-outline', onclick: remove }, '삭제'),
        ),
      ),
    );
  }

  renderList();
  const sel = select && state.data.stages.find((x) => x.id === select);
  if (sel) edit(sel);
  else editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 스테이지를 고르거나 새로 만들어 주세요.'));
  return { refresh: renderList, isDirty: () => dirty };
}
