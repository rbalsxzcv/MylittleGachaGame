// 스토리 탭: 종류별 목록/순서 변경, 장면·대사 편집(화자, 선택지 분기), AI 초안, 배경 그림 생성, 게임 뷰어로 미리보기
import { h, toast, modal, confirmBox, promptBox, busy, dateField, slugOk, fmt, idBadge } from '../ui.js';
import { api, tryApi, newId } from '../api.js';
import { state, saveList, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { openPreview } from '../preview.js';
import { promptStep } from '../promptStep.js';

const KINDS = [
  ['main', '메인'],
  ['character', '캐릭터'],
  ['event', '이벤트'],
];

export function storiesTab(root, { select } = {}) {
  let kind = 'main';
  let current = null; // { meta, body, isNew }
  let dirty = false;
  let bgAssets = [];
  let bible = { world: '', style: '', chapters: {} }; // 세계관 / 장별 개요·요약 (dev/story_bible.json)
  let pendingBible = null; // 저장할 때 함께 기록할 { outline, recap }
  const sel = select && state.data.storyIndex.find((s) => s.id === select);
  if (sel) kind = sel.kind;

  const kindTabs = h('div', { class: 'tabs-small' });
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  root.replaceChildren(
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'col-left' }, h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, '스토리'), h('button', { class: 'btn primary small', onclick: () => newStory() }, '+ 새 스토리')), kindTabs, list), worldCard()),
      editor,
    ),
  );

  const charName = (id) => state.data.characters.find((c) => c.id === id)?.name || id;

  // ── 세계관 (모든 장을 만들 때 AI가 읽음) ──
  function worldCard() {
    const world = h('textarea', { rows: 12, placeholder: '예: 별빛을 실처럼 엮어 소원을 이루는 "직조사"들의 세계. 대륙 중앙의 별빛 도서관…\n주요 장소, 세력, 마법 규칙, 주인공의 목표, 앞으로의 큰 줄거리 등' });
    const style = h('textarea', { rows: 3, placeholder: '문체/톤 예: 따뜻하고 가벼운 판타지. 개그 반, 감동 반. 지문은 짧게' });
    const status = h('span', { class: 'muted small' });
    const fill = () => {
      world.value = bible.world || '';
      style.value = bible.style || '';
      status.textContent = bible.world ? `${bible.world.length}자` : '아직 비어 있어요';
    };
    worldCard.fill = fill;
    return h(
      'section',
      { class: 'card' },
      h(
        'details',
        {},
        h('summary', {}, h('b', {}, '세계관 · 문체 '), status),
        h('p', { class: 'muted small' }, 'AI가 모든 장을 쓸 때 이 내용을 먼저 읽어요. dev/story_bible.json에 저장되고 git에는 올라가지 않아요 (스포일러 보호).'),
        h('label', { class: 'field' }, '세계관 설명', world),
        h('label', { class: 'field' }, '문체 / 톤 (선택)', style),
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: async () => {
              const r = await tryApi(() => api.put('/api/story-bible', { world: world.value, style: style.value }));
              if (r) {
                bible = r;
                fill();
                toast('세계관을 저장했어요', 'success');
              }
            },
          },
          '세계관 저장',
        ),
      ),
    );
  }
  const groupKey = (s) => `${s.kind}|${s.kind === 'character' ? s.characterId || '' : ''}`;

  // ── 목록 + 순서 변경 ──
  function renderList() {
    kindTabs.replaceChildren(...KINDS.map(([k, label]) => h('button', { class: ['tab-s', k === kind && 'active'], onclick: () => ((kind = k), renderList()) }, label)));
    const items = state.data.storyIndex
      .filter((s) => s.kind === kind)
      .sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.chapter - b.chapter);
    list.replaceChildren(
      ...items.map((s) =>
        h(
          'div',
          { class: ['list-item', current?.meta.id === s.id && 'active'] },
          h(
            'button',
            { class: 'grow plain', onclick: () => open(s.id) },
            h('b', {}, `${s.kind === 'character' ? `${charName(s.characterId)} · ` : ''}${s.arc ? `[챕터 ${s.arc}] ` : ''}${s.chapter}장 ${s.title}`),
            h('div', { class: 'muted small' }, `${s.id} · 보상 ${s.reward?.gems ?? 0}`),
          ),
          h('div', { class: 'col-buttons' }, h('button', { class: 'btn tiny', title: '위로', onclick: () => move(s, -1) }, '▲'), h('button', { class: 'btn tiny', title: '아래로', onclick: () => move(s, 1) }, '▼')),
        ),
      ),
      ...(items.length ? [] : [h('p', { class: 'muted' }, '이 종류의 스토리가 없어요')]),
    );
  }

  /** 같은 묶음 안에서 순서를 바꾸고 장 번호를 1부터 다시 매김 */
  async function move(s, dir) {
    const group = state.data.storyIndex.filter((x) => groupKey(x) === groupKey(s)).sort((a, b) => a.chapter - b.chapter);
    const i = group.indexOf(s);
    const j = i + dir;
    if (j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    group.forEach((x, n) => (x.chapter = n + 1));
    await tryApi(() => saveList('storyIndex', state.data.storyIndex));
    if (current) current.meta.chapter = state.data.storyIndex.find((x) => x.id === current.meta.id)?.chapter ?? current.meta.chapter;
    renderList();
    toast('순서를 바꿨어요 (장 번호 다시 매김)');
  }

  async function confirmLeave() {
    return !dirty || (await confirmBox('저장하지 않은 변경', '저장하지 않은 내용이 있어요. 버리고 이동할까요?', { ok: '버리기', danger: true }));
  }

  async function open(id) {
    if (!(await confirmLeave())) return;
    const meta = structuredClone(state.data.storyIndex.find((s) => s.id === id));
    const body = await tryApi(() => api.get(`/api/stories/${id}`));
    if (!body) return;
    current = { meta, body: { id, title: body.title || meta.title, scenes: body.scenes || [] }, isNew: false };
    pendingBible = null;
    dirty = false;
    renderList();
    renderEditor();
  }

  async function newStory() {
    if (!(await confirmLeave())) return;
    const chapters = state.data.storyIndex.filter((s) => s.kind === kind).map((s) => s.chapter);
    const unlock = kind === 'main' ? [{ type: 'prevChapter' }] : kind === 'event' ? [{ type: 'period', startAt: null, endAt: null }] : [];
    const nextCh = (Math.max(0, ...chapters) || 0) + 1;
    current = {
      isNew: true,
      // id는 자동 (story_0001 …) — 처음 저장할 때 발급
      meta: { id: '', kind, chapter: nextCh, title: '', summary: '', characterId: null, unlock, reward: { gems: kind === 'event' ? 100 : 50 } },
      body: { id: '', title: '', scenes: [{ id: 's1', background: { type: 'color', value: '#1b1440' }, lines: [{ speaker: 'narrator', text: '' }] }] },
    };
    pendingBible = null;
    dirty = true;
    renderList();
    renderEditor();
  }

  // ── 편집기 ──
  function renderEditor() {
    const m = current.meta;
    const mark = () => (dirty = true);
    const id = idBadge(m.id);
    const title = h('input', { value: m.title, oninput: (e) => ((m.title = e.target.value), mark()) });
    const summary = h('input', { value: m.summary || '', oninput: (e) => ((m.summary = e.target.value), mark()) });
    const kindSel = h('select', { onchange: (e) => ((m.kind = e.target.value), mark(), renderEditor()) }, KINDS.map(([k, l]) => h('option', { value: k }, l)));
    kindSel.value = m.kind;
    const charSel = h('select', { onchange: (e) => ((m.characterId = e.target.value || null), mark()) }, h('option', { value: '' }, '(선택)'), state.data.characters.map((c) => h('option', { value: c.id }, `${c.name} (${c.id})`)));
    charSel.value = m.characterId || '';
    const chapter = h('input', { type: 'number', min: 1, value: m.chapter, oninput: (e) => ((m.chapter = Math.max(1, parseInt(e.target.value, 10) || 1)), mark()) });
    const gems = h('input', { type: 'number', min: 0, step: 10, value: m.reward?.gems ?? 0, oninput: (e) => ((m.reward = { gems: Math.max(0, parseInt(e.target.value, 10) || 0) }), mark()) });

    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, current.isNew ? '새 스토리' : `스토리 편집 — ${m.id}`),
        h('div', { class: 'grid3' }, h('div', { class: 'field' }, 'id (자동)', id), h('label', { class: 'field' }, '종류', kindSel), h('label', { class: 'field' }, '장 번호', chapter)),
        h('label', { class: 'field' }, '제목', title),
        h('label', { class: 'field' }, '한 줄 소개', summary),
        h('div', { class: 'grid2' }, m.kind === 'character' && h('label', { class: 'field' }, '대상 캐릭터', charSel), h('label', { class: 'field' }, '첫 읽기 보상 (보석)', gems)),
        unlockEditor(m, mark),
        h(
          'div',
          { class: 'row wrap sticky-actions' },
          h('button', { class: 'btn primary', onclick: save }, '저장'),
          h('button', { class: 'btn', onclick: preview }, '게임 뷰어로 미리보기'),
          !current.isNew && h('button', { class: 'btn danger-outline', onclick: remove }, '삭제'),
        ),
      ),
      draftPanel(),
      recapPanel(),
      h('section', { class: 'card' }, h('h2', {}, '장면 / 대사'), h('div', { id: 'scenes' })),
    );
    renderScenes();
  }

  /** 이 장 요약: 다음 장을 만들 때 AI가 '지금까지의 줄거리'로 읽음 */
  function recapPanel() {
    const m = current.meta;
    const saved = bible.chapters[m.id] || {};
    const recap = h('textarea', { rows: 3, placeholder: '이 장에서 일어난 일 3~6문장 (AI로 장을 만들면 자동으로 채워져요)', oninput: () => ((pendingBible = { ...(pendingBible || {}), recap: recap.value }), (dirty = true)) }, pendingBible?.recap ?? saved.recap ?? '');
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, '이 장 요약'), h('span', { class: 'muted small' }, saved.recapAt ? `저장: ${fmt(saved.recapAt)}` : '')),
      h('p', { class: 'muted small' }, '다음 장을 AI로 만들 때 "지금까지의 줄거리"로 들어가요. 대본을 고친 뒤 요약이 오래되면 다음 장을 만들 때 자동으로 다시 요약해요.'),
      recap,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn small',
            disabled: current.isNew,
            title: current.isNew ? '먼저 저장해 주세요' : '',
            onclick: async () => {
              const r = await busy('대본을 요약하는 중…', () => tryApi(() => api.post(`/api/stories/${m.id}/recap`, { title: m.title, scenes: current.body.scenes })));
              if (!r) return;
              recap.value = r.recap;
              bible.chapters[m.id] = { ...(bible.chapters[m.id] || {}), recap: r.recap, recapAt: new Date().toISOString() };
              pendingBible = pendingBible ? { ...pendingBible, recap: undefined } : null;
              toast('요약을 새로 만들었어요', 'success');
            },
          },
          '대본에서 다시 요약',
        ),
      ),
    );
  }

  function unlockEditor(m, mark) {
    const box = h('div', { class: 'unlock-box' });
    const draw = () => {
      box.replaceChildren(
        h('div', { class: 'label' }, '해금 조건 (모두 만족해야 열림)'),
        ...m.unlock.map((c, i) => {
          const del = h('button', { class: 'btn tiny', onclick: () => (m.unlock.splice(i, 1), mark(), draw()) }, '✕');
          if (c.type === 'prevChapter') return h('div', { class: 'row' }, '• 이전 장을 읽어야 함', del);
          if (c.type === 'ownsCharacter') {
            const s = h('select', { onchange: (e) => ((c.characterId = e.target.value), mark()) }, state.data.characters.map((x) => h('option', { value: x.id }, x.name)));
            s.value = c.characterId || state.data.characters[0]?.id || '';
            c.characterId = s.value;
            return h('div', { class: 'row' }, '• 캐릭터 보유: ', s, del);
          }
          const a = dateField('시작', c.startAt);
          const b = dateField('종료', c.endAt);
          const sync = () => ((c.startAt = a.get()), (c.endAt = b.get()), mark());
          a.el.addEventListener('change', sync);
          b.el.addEventListener('change', sync);
          return h('div', { class: 'row wrap' }, '• 기간 한정: ', a.el, b.el, del);
        }),
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn tiny', onclick: () => (m.unlock.push({ type: 'prevChapter' }), mark(), draw()) }, '+ 이전 장 읽기'),
          h('button', { class: 'btn tiny', onclick: () => (m.unlock.push({ type: 'ownsCharacter', characterId: state.data.characters[0]?.id }), mark(), draw()) }, '+ 캐릭터 보유'),
          h('button', { class: 'btn tiny', onclick: () => (m.unlock.push({ type: 'period', startAt: null, endAt: null }), mark(), draw()) }, '+ 기간'),
        ),
      );
    };
    draw();
    return box;
  }

  // ── 장면/대사 편집 ──
  function speakerOptions() {
    return [h('option', { value: 'narrator' }, '지문 (narrator)'), ...state.data.characters.map((c) => h('option', { value: c.id }, `${c.name} (${c.id})`))];
  }

  function renderScenes() {
    const host = editor.querySelector('#scenes');
    if (!host) return;
    const scenes = current.body.scenes;
    const mark = () => (dirty = true);
    const sceneIds = () => scenes.map((s) => s.id);
    const moveIn = (arr, i, d) => {
      const j = i + d;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      mark();
      renderScenes();
    };

    const sceneTools = (sc, si) => [
      h('button', { class: 'btn tiny', onclick: () => moveIn(scenes, si, -1) }, '▲'),
      h('button', { class: 'btn tiny', onclick: () => moveIn(scenes, si, 1) }, '▼'),
      h('button', { class: 'btn tiny', onclick: async () => (await confirmBox('장면 삭제', `장면 ${sc.id}를 삭제할까요?`, { ok: '삭제', danger: true })) && (scenes.splice(si, 1), mark(), renderScenes()) }, '장면 삭제'),
    ];
    const nextSelect = (sc) => {
      const next = h(
        'select',
        { onchange: (e) => ((sc.next = e.target.value || null), mark()) },
        h('option', { value: '' }, '다음 장면으로 (자동)'),
        h('option', { value: 'end' }, '스토리 끝'),
        sceneIds()
          .filter((x) => x !== sc.id)
          .map((x) => h('option', { value: x }, `→ ${x}`)),
      );
      next.value = sc.next || '';
      return next;
    };
    /** 전투 장면: 스테이지를 이겨야 다음으로 */
    const battleCard = (sc, si) => {
      const stageSel = h('select', { onchange: (e) => ((sc.stageId = e.target.value), mark(), renderScenes()) }, h('option', { value: '' }, '(스테이지 선택)'), (state.data.stages || []).map((st) => h('option', { value: st.id }, `${st.name} (${st.id})`)));
      stageSel.value = sc.stageId || '';
      const st = (state.data.stages || []).find((x) => x.id === sc.stageId);
      return h(
        'div',
        { class: 'scene-card battle-scene' },
        h(
          'div',
          { class: 'row wrap' },
          h('b', {}, `장면 ${si + 1} · 전투`),
          h('label', { class: 'inline' }, 'id', h('input', { class: 'small-input', value: sc.id, onchange: (e) => (renameScene(sc, e.target.value.trim()), mark(), renderScenes()) })),
          h('label', { class: 'inline' }, '스테이지', stageSel),
          st && h('a', { class: 'small', href: `#stages/${st.id}` }, '스테이지 편집'),
          h('label', { class: 'inline' }, '이기면', nextSelect(sc)),
          h('span', { class: 'grow' }),
          ...sceneTools(sc, si),
        ),
        h('p', { class: 'muted small' }, st ? `권장 전투력 ${st.recommendedPower} · 웨이브 ${st.waves.length} · 이겨야 다음 장면으로 진행 (전에 깬 플레이어는 건너뛰기 가능)` : '스테이지를 골라 주세요'),
      );
    };

    host.replaceChildren(
      ...scenes.map((sc, si) => {
        if (sc.type === 'battle') return battleCard(sc, si);
        // 배경
        const bgType = h('select', { onchange: (e) => ((sc.background = { type: e.target.value, value: e.target.value === 'color' ? '#1b1440' : bgAssets[0] || '' }), mark(), renderScenes()) }, h('option', { value: 'color' }, '색'), h('option', { value: 'image' }, '그림'));
        bgType.value = sc.background?.type || 'color';
        let bgValue;
        if (bgType.value === 'color') {
          bgValue = h('input', { type: 'color', value: sc.background?.value || '#1b1440', oninput: (e) => ((sc.background.value = e.target.value), mark()) });
        } else {
          bgValue = h('select', { onchange: (e) => ((sc.background.value = e.target.value), mark()) }, h('option', { value: '' }, '(그림 선택)'), bgAssets.map((p) => h('option', { value: p }, p.replace('assets/bg/', ''))));
          bgValue.value = sc.background?.value || '';
        }
        const next = h(
          'select',
          { onchange: (e) => ((sc.next = e.target.value || null), mark()) },
          h('option', { value: '' }, '다음 장면으로 (자동)'),
          h('option', { value: 'end' }, '스토리 끝'),
          sceneIds()
            .filter((x) => x !== sc.id)
            .map((x) => h('option', { value: x }, `→ ${x}`)),
        );
        next.value = sc.next || '';

        const lines = sc.lines.map((ln, li) => {
          const sp = h('select', { onchange: (e) => ((ln.speaker = e.target.value), mark()) }, speakerOptions());
          sp.value = ln.speaker || 'narrator';
          const nm = h('input', { class: 'small-input', placeholder: '표시 이름 (선택, 예: ???)', value: ln.name || '', oninput: (e) => ((ln.name = e.target.value || undefined), mark()) });
          const side = h('select', { onchange: (e) => ((ln.side = e.target.value || undefined), mark()) }, h('option', { value: '' }, '자리 자동'), h('option', { value: 'left' }, '왼쪽'), h('option', { value: 'right' }, '오른쪽'));
          side.value = ln.side || '';
          const txt = h('textarea', { rows: 2, oninput: (e) => ((ln.text = e.target.value), mark()) }, ln.text || '');
          const choices = (ln.choices || []).map((c, ci) => {
            const goto = h(
              'select',
              { onchange: (e) => ((c.goto = e.target.value), mark()) },
              h('option', { value: '' }, '다음 대사로 계속'),
              sceneIds().map((x) => h('option', { value: x }, `→ ${x}`)),
              h('option', { value: 'end' }, '스토리 끝'),
            );
            goto.value = c.goto || '';
            return h(
              'div',
              { class: 'row choice-row' },
              '선택지',
              h('input', { value: c.text || '', placeholder: '선택지 문구', oninput: (e) => ((c.text = e.target.value), mark()) }),
              goto,
              h('button', { class: 'btn tiny', onclick: () => (ln.choices.splice(ci, 1), ln.choices.length || delete ln.choices, mark(), renderScenes()) }, '✕'),
            );
          });
          return h(
            'div',
            { class: 'line-row' },
            h(
              'div',
              { class: 'row' },
              h('span', { class: 'muted small' }, `${li + 1}`),
              sp,
              nm,
              side,
              h('span', { class: 'grow' }),
              h('button', { class: 'btn tiny', title: '선택지 추가 (최대 4개)', onclick: () => ((ln.choices = ln.choices || []).length < 4 && ln.choices.push({ text: '', goto: '' }), mark(), renderScenes()) }, '+선택지'),
              h('button', { class: 'btn tiny', onclick: () => moveIn(sc.lines, li, -1) }, '▲'),
              h('button', { class: 'btn tiny', onclick: () => moveIn(sc.lines, li, 1) }, '▼'),
              h('button', { class: 'btn tiny', onclick: () => (sc.lines.splice(li + 1, 0, { speaker: ln.speaker, text: '' }), mark(), renderScenes()) }, '+아래에'),
              h('button', { class: 'btn tiny', onclick: () => (sc.lines.splice(li, 1), mark(), renderScenes()) }, '✕'),
            ),
            txt,
            choices,
          );
        });

        return h(
          'div',
          { class: 'scene-card' },
          h(
            'div',
            { class: 'row wrap scene-head' },
            h('b', {}, `장면 ${si + 1}`),
            h('label', { class: 'inline' }, 'id', h('input', { class: 'small-input', value: sc.id, onchange: (e) => (renameScene(sc, e.target.value.trim()), mark(), renderScenes()) })),
            h('label', { class: 'inline' }, '배경', bgType, bgValue),
            h('button', { class: 'btn tiny', onclick: () => genBackground(sc) }, '배경 그림 생성'),
            h('label', { class: 'inline' }, '끝나면', next),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn tiny', onclick: () => moveIn(scenes, si, -1) }, '▲'),
            h('button', { class: 'btn tiny', onclick: () => moveIn(scenes, si, 1) }, '▼'),
            h('button', { class: 'btn tiny', onclick: async () => (await confirmBox('장면 삭제', `장면 ${sc.id}를 삭제할까요?`, { ok: '삭제', danger: true })) && (scenes.splice(si, 1), mark(), renderScenes()) }, '장면 삭제'),
          ),
          lines,
          h('button', { class: 'btn small', onclick: () => (sc.lines.push({ speaker: 'narrator', text: '' }), mark(), renderScenes()) }, '+ 대사 추가'),
        );
      }),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            let n = scenes.length + 1;
            while (scenes.some((s) => s.id === `s${n}`)) n++;
            scenes.push({ id: `s${n}`, background: { type: 'color', value: '#1b1440' }, lines: [{ speaker: 'narrator', text: '' }] });
            mark();
            renderScenes();
          },
        },
        '+ 장면 추가',
      ),
      ' ',
      h(
        'button',
        {
          class: 'btn',
          disabled: !(state.data.stages || []).length,
          title: (state.data.stages || []).length ? '' : '스테이지 탭에서 먼저 스테이지를 만들어 주세요',
          onclick: () => {
            let n = 1;
            while (scenes.some((s) => s.id === `b${n}`)) n++;
            scenes.push({ id: `b${n}`, type: 'battle', stageId: state.data.stages[0]?.id || '' });
            mark();
            renderScenes();
          },
        },
        '+ 전투 장면',
      ),
    );
  }

  /** 장면 id를 바꾸면 그 장면을 가리키던 next/선택지도 함께 바꿈 */
  function renameScene(sc, sceneId) {
    if (!slugOk(sceneId) || current.body.scenes.some((s) => s !== sc && s.id === sceneId)) {
      toast('장면 id는 영문/숫자/_/-이고 중복되면 안 돼요', 'error');
      return;
    }
    const old = sc.id;
    sc.id = sceneId;
    for (const s of current.body.scenes) {
      if (s.next === old) s.next = sceneId;
      for (const ln of s.lines || []) for (const c of ln.choices || []) if (c.goto === old) c.goto = sceneId;
    }
  }

  async function loadBgAssets() {
    bgAssets = (await tryApi(() => api.get('/api/assets?dir=bg'))) || [];
  }

  /** 배경 그림 생성 (배경 제거 없음) → 승인하면 이 장면 배경으로 */
  function genBackground(sc) {
    const name = idBadge('', '뽑으면 자동으로 정해져요 (bg_0001 …)');
    const prompt = h('textarea', { rows: 3, placeholder: '장면 설명 예: 밤의 오래된 도서관, 높은 책장, 창밖 달빛' });
    const area = h('div');
    const bgInput = () => {
      if (!prompt.value.trim()) return toast('장면 설명을 입력해 주세요', 'error'), null;
      return { bgName: '', scene: prompt.value };
    };
    const go = async (gen) => {
      const input = bgInput();
      if (!input) return;
      const job = await tryApi(() => api.post('/api/bg/generate', { ...input, ...gen }));
      if (!job) return;
      area.replaceChildren(
        jobPanel(job, {
          approveLabel: '이 장면의 배경으로 사용',
          onApprove: async (n) => {
            const r = await tryApi(() => api.post(`/api/jobs/${job.id}/approve-image`, { attempt: n }));
            if (!r) return false;
            await loadBgAssets();
            sc.background = { type: 'image', value: r.path };
            dirty = true;
            renderScenes();
            toast('배경을 적용했어요. 스토리를 저장해 주세요', 'success');
            return true;
          },
        }).el,
      );
    };
    modal({
      title: '배경 그림 생성',
      wide: true,
      body: h(
        'div',
        {},
        h('p', { class: 'muted small' }, '공통 스타일: dev/style_bg.txt (인물 없이 풍경만)'),
        h('div', { class: 'grid2' }, h('div', { class: 'field' }, 'id (파일 이름, 자동)', name), h('label', { class: 'field' }, '장면 설명 (한국어 OK)', prompt)),
        promptStep({ kind: 'bg', getInput: bgInput, generate: go, generateLabel: '그림 뽑기' }).el,
        area,
      ),
    });
  }

  // ── AI 초안 ──
  /** AI로 장 만들기: 개요 → 대본 (세계관 + 앞 장 요약 + 직전 장 대본을 함께 읽음) */
  function draftPanel() {
    const m = current.meta;
    const used = new Set(current.body.scenes.flatMap((s) => (s.lines || []).map((l) => l.speaker)).filter((x) => x !== 'narrator'));
    if (m.characterId) used.add(m.characterId);
    const outline = h('textarea', { rows: 6, placeholder: '이번 장의 대략적인 줄거리\n예: 주인공이 별빛 도서관을 떠나 사막 도시로 간다. 그곳에서 모래 폭풍에 갇힌 대상(隊商)을 돕다가, 별빛 실의 흔적을 발견한다. 마지막에 누군가 주인공을 지켜보고 있다.' }, pendingBible?.outline ?? bible.chapters[m.id]?.outline ?? '');
    const length = h('select', {}, [['auto', '분량: AI가 판단'], ['short', '짧게 (장면 2~3)'], ['normal', '보통 (장면 3~5)'], ['long', '길게 (장면 5~8)']].map(([v, l]) => h('option', { value: v }, l)));
    const picks = state.data.characters.map((c) => ({ c, cb: h('input', { type: 'checkbox', checked: used.has(c.id) }) }));
    const stagesOk = (state.data.stages || []).length > 0;
    const allowBattles = h('input', { type: 'checkbox' });
    const out = h('div');
    let lastDraft = null;
    let lastOutline = '';

    // 이 장이 참고할 앞 장들 (같은 묶음, 장 번호가 더 작은 것)
    const prevChapters = state.data.storyIndex
      .filter((s) => s.kind === m.kind && (m.kind !== 'character' || s.characterId === m.characterId) && s.id !== m.id && s.chapter < m.chapter)
      .sort((a, b) => a.chapter - b.chapter);
    const contextLine = h(
      'div',
      { class: 'note small' },
      h('b', {}, 'AI가 함께 읽는 것: '),
      bible.world ? '세계관 ✓' : h('span', { class: 'error' }, '세계관 없음 (왼쪽 아래에서 적어 주세요)'),
      ' · ',
      prevChapters.length ? `앞 장 ${prevChapters.length}개의 요약 (${prevChapters.map((s) => `${s.chapter}장${bible.chapters[s.id]?.recap ? '' : '*'}`).join(', ')})` : '앞 장 없음 (첫 장)',
      prevChapters.length ? ` · 직전 ${prevChapters.at(-1).chapter}장 대본 전체` : '',
      prevChapters.some((s) => !bible.chapters[s.id]?.recap) ? h('div', { class: 'muted' }, '* 요약이 없는 장은 생성할 때 대본에서 먼저 요약해요') : null,
    );

    const request = async (feedback) => {
      const text = feedback ? lastOutline : outline.value.trim();
      if (!text) return toast('이번 장 개요를 적어 주세요', 'error');
      const body = {
        meta: { id: slugOk(m.id) && !current.isNew ? m.id : null, kind: m.kind, chapter: m.chapter, title: m.title, characterId: m.characterId },
        outline: text,
        length: length.value,
        characterIds: picks.filter((p) => p.cb.checked).map((p) => p.c.id),
        allowBattles: stagesOk && allowBattles.checked,
        feedback: feedback || '',
        previous: feedback ? lastDraft : null,
      };
      if (!feedback) lastOutline = text;
      const r = await busy(feedback ? '수정 요청을 반영해서 다시 쓰는 중…' : '세계관과 앞 장을 읽고 이번 장을 쓰는 중…', () => tryApi(() => api.post('/api/stories/draft', body)));
      if (!r) return;
      lastDraft = r.draft;
      pendingBible = { ...(pendingBible || {}), outline: text };
      if (r.context.recapsMade) {
        const b = await tryApi(() => api.get('/api/story-bible'));
        if (b) bible = b;
      }
      showDraft(r.draft, r.warnings, r.context);
    };

    const showDraft = (d, warnings, ctx) => {
      const lineCount = d.scenes.reduce((a, sc) => a + (sc.lines?.length || 0), 0);
      out.replaceChildren(
        h(
          'div',
          { class: 'draft-view' },
          h('h3', {}, `초안: ${d.title || '(제목 없음)'}`),
          d.summary && h('p', { class: 'muted' }, `한 줄 소개: ${d.summary}`),
          h('p', { class: 'muted small' }, `장면 ${d.scenes.length}개 · 대사 ${lineCount}줄 · 참고: ${ctx.world ? '세계관, ' : ''}앞 장 요약 ${ctx.previous.length}개${ctx.previousScript ? `, ${ctx.previousScript} 대본` : ''}${ctx.recapsMade ? ` (요약 ${ctx.recapsMade}개 새로 만듦)` : ''}`),
          d.recap && h('div', { class: 'card inner small' }, h('b', {}, '이 장 요약 (다음 장 참고용) '), d.recap),
          warnings.length > 0 && h('ul', { class: 'warn-list' }, warnings.map((w) => h('li', { class: 'warn' }, w))),
          d.scenes.map((sc) =>
            sc.type === 'battle'
              ? h('div', { class: 'draft-scene' }, h('b', { class: 'error' }, `⚔ 전투 장면 ${sc.id}: ${(state.data.stages || []).find((x) => x.id === sc.stageId)?.name || sc.stageId}`))
              : h(
                  'div',
                  { class: 'draft-scene' },
                  h('div', { class: 'muted small' }, `장면 ${sc.id} · 배경 ${sc.background.value}${sc.next ? ` · 끝나면 → ${sc.next}` : ''}`),
                  sc.lines.map((ln) =>
                    h(
                      'div',
                      { class: 'draft-line' },
                      h('b', {}, ln.speaker === 'narrator' ? ln.name || '지문' : charName(ln.speaker)),
                      ' ',
                      ln.text,
                      (ln.choices || []).map((c) => h('div', { class: 'draft-choice' }, `▶ ${c.text} → ${c.goto || '계속'}`)),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { class: 'row wrap' },
            h('button', { class: 'btn primary', onclick: () => applyDraft(d, true) }, '승인 (적용 후 저장)'),
            h('button', { class: 'btn', onclick: () => applyDraft(d, false) }, '편집기로 불러와서 고친 뒤 승인'),
            h(
              'button',
              {
                class: 'btn danger-outline',
                onclick: async () => {
                  const reason = await promptBox('거절하고 다시 쓰기', '무엇을 바꿀까요?', { placeholder: '예: 더 길게 / 사막 도시 장면을 늘려 줘 / 마지막을 더 긴장감 있게' });
                  if (reason) request(reason);
                },
              },
              '거절 + 사유 → 다시 쓰기',
            ),
          ),
        ),
      );
    };

    const applyDraft = async (d, saveNow) => {
      if (current.body.scenes.some((s) => (s.lines || []).some((l) => l.text)) && !(await confirmBox('초안 적용', '지금 편집 중인 장면/대사를 초안으로 바꿀까요?', { ok: '바꾸기' }))) return;
      current.body.scenes = structuredClone(d.scenes);
      if (!current.meta.title && d.title) current.meta.title = d.title;
      if (!current.meta.summary && d.summary) current.meta.summary = d.summary;
      pendingBible = { ...(pendingBible || {}), recap: d.recap || pendingBible?.recap };
      dirty = true;
      renderEditor();
      if (saveNow) await save();
      else toast('편집기에 불러왔어요. 고친 뒤 저장하면 승인 완료!');
    };

    return h(
      'section',
      { class: 'card' },
      h(
        'details',
        { open: current.isNew || !current.body.scenes.some((s) => (s.lines || []).some((l) => l.text)) },
        h('summary', {}, h('b', {}, 'AI로 이 장 만들기 (개요 → 대본)')),
        contextLine,
        h('label', { class: 'field' }, '이번 장 개요', outline),
        state.data.characters.length > 0 && h('div', { class: 'label' }, '등장 캐릭터 (고르지 않으면 전체를 알려 줘요. 목록에 없는 인물은 AI가 이름만 붙여 등장시켜요)'),
        state.data.characters.length > 0 && h('div', { class: 'row wrap' }, picks.map((p) => h('label', { class: 'inline' }, p.cb, p.c.name))),
        state.data.characters.length === 0 && h('p', { class: 'muted small' }, '등록된 캐릭터가 없어요. AI가 필요한 인물을 이름만 붙여 등장시켜요 (나중에 화자를 캐릭터로 바꿀 수 있어요).'),
        h(
          'div',
          { class: 'row wrap' },
          length,
          stagesOk && h('label', { class: 'inline' }, allowBattles, '어울리는 곳에 전투 장면 넣기'),
          h('button', { class: 'btn primary', onclick: () => request('') }, '이 장 생성'),
        ),
        out,
      ),
    );
  }

  // ── 저장 / 삭제 / 미리보기 ──
  async function save() {
    const m = current.meta;
    if (!m.title.trim()) return toast('제목을 입력해 주세요', 'error'), false;
    if (m.kind === 'character' && !m.characterId) return toast('대상 캐릭터를 골라 주세요', 'error'), false;
    if (m.kind !== 'character') delete m.characterId;
    const ids = current.body.scenes.map((s) => s.id);
    if (new Set(ids).size !== ids.length) return toast('장면 id가 중복돼요', 'error'), false;

    // 빈 값 정리
    for (const sc of current.body.scenes) {
      if (!sc.next) delete sc.next;
      if (sc.type === 'battle') {
        if (!sc.stageId) return toast(`전투 장면 ${sc.id}의 스테이지를 골라 주세요`, 'error'), false;
        delete sc.lines;
        delete sc.background;
        continue;
      }
      for (const ln of sc.lines) {
        if (!ln.name) delete ln.name;
        if (!ln.side) delete ln.side;
        if (ln.choices && !ln.choices.length) delete ln.choices;
      }
    }
    if (!m.id) {
      const nid = await tryApi(() => newId('story')); // id는 자동 (story_0001 …)
      if (!nid) return false;
      m.id = nid;
    }
    const body = { id: m.id, title: m.title, scenes: current.body.scenes };
    const ok1 = await tryApi(() => api.put(`/api/stories/${m.id}`, body));
    if (!ok1) return false;
    const index = state.data.storyIndex.filter((s) => s.id !== m.id);
    const pos = state.data.storyIndex.findIndex((s) => s.id === m.id);
    pos >= 0 ? index.splice(pos, 0, m) : index.push(m);
    const ok2 = await tryApi(() => saveList('storyIndex', structuredClone(index)));
    if (ok2 === null) return false;
    if (pendingBible && (pendingBible.outline != null || pendingBible.recap != null)) {
      const payload = {};
      if (pendingBible.outline != null) payload.outline = pendingBible.outline;
      if (pendingBible.recap != null) payload.recap = pendingBible.recap;
      const ch = await tryApi(() => api.put(`/api/story-bible/chapters/${m.id}`, payload));
      if (ch) bible.chapters[m.id] = ch;
    }
    pendingBible = null;
    current.isNew = false;
    dirty = false;
    kind = m.kind;
    renderList();
    renderEditor();
    toast('스토리를 저장했어요 (작업 공간)', 'success');
    return true;
  }

  async function remove() {
    if (!(await confirmBox('스토리 삭제', `「${current.meta.title}」를 삭제할까요? (파일은 dev/trash로 이동)`, { ok: '삭제', danger: true }))) return;
    await tryApi(() => api.del(`/api/stories/${current.meta.id}`));
    await reloadData();
    current = null;
    dirty = false;
    renderList();
    editor.replaceChildren(h('div', { class: 'empty' }, '삭제했어요'));
  }

  async function preview() {
    if (dirty && !(await save())) return;
    const period = current.meta.unlock.find((c) => c.type === 'period');
    const now = period?.startAt && Date.parse(period.startAt) > Date.now() ? new Date(Date.parse(period.startAt) + 60000).toISOString() : null;
    openPreview({ story: current.meta.id, now });
  }

  Promise.all([loadBgAssets(), tryApi(() => api.get('/api/story-bible')).then((b) => b && (bible = b))]).then(() => {
    worldCard.fill?.();
    renderList();
    if (sel) open(sel.id);
    else editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 스토리를 고르거나 새로 만들어 주세요.'));
  });
  return { refresh: renderList, isDirty: () => dirty };
}

export { fmt };
