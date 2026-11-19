// 스토리 탭: 종류별 목록/순서 변경, 장면·대사 편집(화자, 선택지 분기), AI 초안, 배경 그림 생성, 게임 뷰어로 미리보기
import { h, toast, modal, confirmBox, promptBox, busy, dateField, slugOk, fmt } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, saveList, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { openPreview } from '../preview.js';

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
  const sel = select && state.data.storyIndex.find((s) => s.id === select);
  if (sel) kind = sel.kind;

  const kindTabs = h('div', { class: 'tabs-small' });
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  root.replaceChildren(
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'col-left' }, h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, '스토리'), h('button', { class: 'btn primary small', onclick: () => newStory() }, '+ 새 스토리')), kindTabs, list)),
      editor,
    ),
  );

  const charName = (id) => state.data.characters.find((c) => c.id === id)?.name || id;
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
            h('b', {}, `${s.kind === 'character' ? `${charName(s.characterId)} · ` : ''}${s.chapter}장 ${s.title}`),
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
    dirty = false;
    renderList();
    renderEditor();
  }

  async function newStory() {
    if (!(await confirmLeave())) return;
    const chapters = state.data.storyIndex.filter((s) => s.kind === kind).map((s) => s.chapter);
    const unlock = kind === 'main' ? [{ type: 'prevChapter' }] : kind === 'event' ? [{ type: 'period', startAt: null, endAt: null }] : [];
    current = {
      isNew: true,
      meta: { id: '', kind, chapter: (Math.max(0, ...chapters) || 0) + 1, title: '', summary: '', characterId: null, unlock, reward: { gems: kind === 'event' ? 100 : 50 } },
      body: { id: '', title: '', scenes: [{ id: 's1', background: { type: 'color', value: '#1b1440' }, lines: [{ speaker: 'narrator', text: '' }] }] },
    };
    dirty = true;
    renderList();
    renderEditor();
  }

  // ── 편집기 ──
  function renderEditor() {
    const m = current.meta;
    const mark = () => (dirty = true);
    const id = h('input', { value: m.id, placeholder: '예: main_04', disabled: !current.isNew, oninput: (e) => ((m.id = e.target.value.trim()), mark()) });
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
        h('div', { class: 'grid3' }, h('label', { class: 'field' }, 'id (파일 이름)', id), h('label', { class: 'field' }, '종류', kindSel), h('label', { class: 'field' }, '장 번호', chapter)),
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
      h('section', { class: 'card' }, h('h2', {}, '장면 / 대사'), h('div', { id: 'scenes' })),
    );
    renderScenes();
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

    host.replaceChildren(
      ...scenes.map((sc, si) => {
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
    );
  }

  /** 장면 id를 바꾸면 그 장면을 가리키던 next/선택지도 함께 바꿈 */
  function renameScene(sc, newId) {
    if (!slugOk(newId) || current.body.scenes.some((s) => s !== sc && s.id === newId)) {
      toast('장면 id는 영문/숫자/_/-이고 중복되면 안 돼요', 'error');
      return;
    }
    const old = sc.id;
    sc.id = newId;
    for (const s of current.body.scenes) {
      if (s.next === old) s.next = newId;
      for (const ln of s.lines) for (const c of ln.choices || []) if (c.goto === old) c.goto = newId;
    }
  }

  async function loadBgAssets() {
    bgAssets = (await tryApi(() => api.get('/api/assets?dir=bg'))) || [];
  }

  /** 배경 그림 생성 (배경 제거 없음) → 승인하면 이 장면 배경으로 */
  function genBackground(sc) {
    const name = h('input', { placeholder: '파일 이름 (영문) 예: night_library' });
    const prompt = h('textarea', { rows: 3, placeholder: '장면 설명 예: 밤의 오래된 도서관, 높은 책장, 창밖 달빛' });
    const area = h('div');
    const go = async () => {
      const job = await busy('배경 그림 생성 중…', () => tryApi(() => api.post('/api/bg/generate', { bgName: name.value.trim(), prompt: prompt.value })));
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
      body: h('div', {}, h('p', { class: 'muted small' }, '공통 스타일: dev/style_bg.txt (인물 없이 풍경만)'), h('div', { class: 'grid2' }, h('label', { class: 'field' }, '파일 이름', name), h('label', { class: 'field' }, '장면 설명', prompt)), h('button', { class: 'btn primary', onclick: go }, '생성'), area),
    });
  }

  // ── AI 초안 ──
  function draftPanel() {
    const m = current.meta;
    const used = new Set(current.body.scenes.flatMap((s) => s.lines.map((l) => l.speaker)).filter((x) => x !== 'narrator'));
    if (m.characterId) used.add(m.characterId);
    const outline = h('textarea', { rows: 3, placeholder: '줄거리 개요 예: 미나가 도서관에서 설이를 만나 별빛의 문에 대한 책을 찾는다. 마지막에 책이 스스로 빛난다.' });
    const count = h('input', { type: 'number', min: 1, max: 8, value: 3 });
    const picks = state.data.characters.map((c) => ({ c, cb: h('input', { type: 'checkbox', checked: used.has(c.id) }) }));
    const out = h('div');
    let lastDraft = null;
    let lastOutline = '';

    const request = async (feedback) => {
      const body = {
        meta: { kind: m.kind, title: m.title },
        outline: feedback ? lastOutline : outline.value,
        characterIds: picks.filter((p) => p.cb.checked).map((p) => p.c.id),
        sceneCount: parseInt(count.value, 10) || 3,
        feedback: feedback || '',
        previous: feedback ? lastDraft : null,
      };
      if (!feedback) lastOutline = outline.value;
      const r = await busy(feedback ? '수정 요청을 반영해서 다시 쓰는 중…' : '초안 쓰는 중… (캐릭터 소개문을 참고해요)', () => tryApi(() => api.post('/api/stories/draft', body)));
      if (!r) return;
      lastDraft = r.draft;
      showDraft(r.draft, r.warnings);
    };

    const showDraft = (d, warnings) => {
      out.replaceChildren(
        h(
          'div',
          { class: 'draft-view' },
          h('h3', {}, `초안: ${d.title || '(제목 없음)'}`),
          warnings.length > 0 && h('ul', { class: 'warn-list' }, warnings.map((w) => h('li', {}, w))),
          d.scenes.map((sc) =>
            h(
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
                  const reason = await promptBox('거절하고 다시 쓰기', '무엇을 바꿀까요?', { placeholder: '예: 도하의 말투를 더 장난스럽게 / 선택지를 넣어 줘 / 더 짧게' });
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
      if (current.body.scenes.some((s) => s.lines.some((l) => l.text)) && !(await confirmBox('초안 적용', '지금 편집 중인 장면/대사를 초안으로 바꿀까요?', { ok: '바꾸기' }))) return;
      current.body.scenes = structuredClone(d.scenes);
      if (!current.meta.title && d.title) current.meta.title = d.title;
      dirty = true;
      renderEditor();
      if (saveNow) await save();
      else toast('편집기에 불러왔어요. 고친 뒤 저장하면 승인 완료!');
    };

    return h(
      'section',
      { class: 'card' },
      h('details', {}, h('summary', {}, h('b', {}, 'AI 초안 쓰기 (Vertex Gemini)')), h('label', { class: 'field' }, '줄거리 개요', outline), h('div', { class: 'label' }, '등장 캐릭터 (소개문을 참고해서 말투를 맞춰요)'), h('div', { class: 'row wrap' }, picks.map((p) => h('label', { class: 'inline' }, p.cb, p.c.name))), h('div', { class: 'row' }, h('label', { class: 'inline' }, '장면 수', count), h('button', { class: 'btn', onclick: () => request('') }, '초안 생성')), out),
    );
  }

  // ── 저장 / 삭제 / 미리보기 ──
  async function save() {
    const m = current.meta;
    if (!slugOk(m.id)) return toast('id를 영문/숫자/_/-로 정해 주세요', 'error'), false;
    if (current.isNew && state.data.storyIndex.some((s) => s.id === m.id)) return toast('이미 있는 id예요', 'error'), false;
    if (!m.title.trim()) return toast('제목을 입력해 주세요', 'error'), false;
    if (m.kind === 'character' && !m.characterId) return toast('대상 캐릭터를 골라 주세요', 'error'), false;
    if (m.kind !== 'character') delete m.characterId;
    const ids = current.body.scenes.map((s) => s.id);
    if (new Set(ids).size !== ids.length) return toast('장면 id가 중복돼요', 'error'), false;

    // 빈 값 정리
    for (const sc of current.body.scenes) {
      if (!sc.next) delete sc.next;
      for (const ln of sc.lines) {
        if (!ln.name) delete ln.name;
        if (!ln.side) delete ln.side;
        if (ln.choices && !ln.choices.length) delete ln.choices;
      }
    }
    const body = { id: m.id, title: m.title, scenes: current.body.scenes };
    const ok1 = await tryApi(() => api.put(`/api/stories/${m.id}`, body));
    if (!ok1) return false;
    const index = state.data.storyIndex.filter((s) => s.id !== m.id);
    const pos = state.data.storyIndex.findIndex((s) => s.id === m.id);
    pos >= 0 ? index.splice(pos, 0, m) : index.push(m);
    const ok2 = await tryApi(() => saveList('storyIndex', structuredClone(index)));
    if (ok2 === null) return false;
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

  loadBgAssets().then(() => {
    renderList();
    if (sel) open(sel.id);
    else editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 스토리를 고르거나 새로 만들어 주세요.'));
  });
  return { refresh: renderList, isDirty: () => dirty };
}

export { fmt };
