// 캐릭터 프로필 편집 (CHARACTER_PROFILE.md 4-1장): facts · stories · lines · relations · voice 폼 + AI 초안(전체 / 이야기만 / 대사만 / 말투 카드만)
// AI 결과는 폼에 채우기만 하고 저장은 '저장' 버튼으로. 목록 칸은 줄바꿈으로 구분. 주인공은 voice만 (설정집 protagonist.voice)
import { h, toast, modal, busy } from './ui.js';
import { api, tryApi } from './api.js';
import { state, reloadData } from './state.js';
import { modelPicker } from './modelPicker.js';

const L = { fact: 40, factList: 5, storyTitle: 30, storyText: 600, line: 40, idle: 5, relations: 6, relationLabel: 20, relationNote: 60, voiceText: 120, voiceList: 5 };
const FACTS = [
  ['age', '나이'],
  ['height', '키'],
  ['origin', '출신'],
  ['affiliation', '소속'],
  ['hobby', '취미'],
];
const FACT_LISTS = [
  ['likes', '좋아하는 것'],
  ['dislikes', '싫어하는 것'],
];
const LINES = [
  ['obtain', '처음 만났을 때 (뽑기 컷인 대사가 비어 있으면 이걸 써요)'],
  ['team', '편성'],
  ['levelUp', '레벨 업'],
  ['breakthrough', '돌파'],
  ['battleStart', '전투 시작'],
  ['ultimate', '궁극기'],
];
const PROTAGONIST = 'protagonist';

/** JSON 보기용: 빈 문자열 · 빈 목록 · 빈 객체는 뺌 */
function prune(v) {
  if (Array.isArray(v)) return v.map(prune).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p === undefined || p === '' || (Array.isArray(p) && !p.length) || (p && typeof p === 'object' && !Array.isArray(p) && !Object.keys(p).length)) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}

/** 붙여넣은 글 → 프로필 객체. 프로필 그대로 / {profile: …} / 캐릭터 항목({id, name, profile}) / ```json 감싸기 모두 받음 */
export function parseProfileJson(text, selfId) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  if (!t) throw new Error('JSON이 비어 있어요');
  let data;
  try {
    data = JSON.parse(t);
  } catch (e) {
    throw new Error(`JSON 문법 오류: ${e.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 객체({ … })여야 해요');
  const notes = [];
  if (data.profile && typeof data.profile === 'object') {
    if (data.id && data.id !== selfId) notes.push(`다른 캐릭터(${data.id})의 항목이에요 — 프로필만 가져왔어요`);
    data = data.profile;
  }
  return { profile: data, notes };
}

const toLines = (v) => (Array.isArray(v) ? v.join('\n') : v || '');
const fromLines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);

/** 글자 수 표시가 붙은 입력칸 */
function counted(el, max) {
  const n = h('span', { class: 'muted small count' });
  const upd = () => {
    const len = el.value.length;
    n.textContent = `${len}/${max}`;
    n.classList.toggle('error', len > max);
  };
  el.addEventListener('input', upd);
  el._upd = upd;
  upd();
  return h('div', { class: 'counted' }, el, n);
}
const setVal = (el, v) => {
  el.value = v ?? '';
  el._upd?.();
};

/** 호칭 칸: "대상: 호칭" 줄 ↔ {id: 호칭} (대상 = 주인공/단장/protagonist, 캐릭터 이름 또는 id) */
function addressToText(addr) {
  return Object.entries(addr || {})
    .map(([k, v]) => `${k === PROTAGONIST ? '주인공' : state.data.characters.find((c) => c.id === k)?.name || k}: ${v}`)
    .join('\n');
}
function addressFromText(text) {
  const out = {};
  const bad = [];
  for (const line of fromLines(text)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const who = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    const id = ['주인공', '단장', PROTAGONIST].includes(who) ? PROTAGONIST : state.data.characters.find((c) => c.id === who || c.name === who)?.id;
    if (!id) bad.push(who);
    else if (val) out[id] = val;
  }
  return { address: out, bad };
}

/**
 * @param {object} opts
 * @param {object|'protagonist'} opts.target 캐릭터 (작업 공간 데이터) 또는 'protagonist'
 * @param {object} opts.profile 지금 프로필 (주인공이면 {voice})
 * @param {boolean} [opts.npc]
 */
export function profileEditor({ target, profile = {}, npc = false }) {
  const isProt = target === PROTAGONIST;
  const voiceOnly = isProt || npc;
  const selfId = isProt ? PROTAGONIST : target.id;
  const warnBox = h('div');

  // ── facts ──
  const facts = Object.fromEntries(FACTS.map(([k]) => [k, h('input', { maxlength: L.fact + 20 })]));
  const factLists = Object.fromEntries(FACT_LISTS.map(([k]) => [k, h('textarea', { rows: 2, placeholder: '줄마다 하나 (최대 5개)' })]));
  // ── stories ──
  const stories = [0, 1, 2].map((i) => ({
    title: h('input', { placeholder: `이야기 ${i + 1} 제목` }),
    unlock: h('select', {}, [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n }, `돌파 ${n}`))),
    text: h('textarea', { rows: 5, placeholder: '200~400자. 하나의 구체적인 장면을 담담하게 (비우면 이 칸은 없음)' }),
  }));
  // ── lines ──
  const lines = Object.fromEntries(LINES.map(([k]) => [k, h('input')]));
  const idle = h('textarea', { rows: 3, placeholder: '대기 대사 — 줄마다 하나 (최대 5개)' });
  // ── relations ──
  const relRows = h('div', { class: 'rel-rows' });
  const relAdd = h('button', { class: 'btn small', onclick: () => addRel() }, '+ 관계 추가');
  function addRel(r = { id: '', label: '', note: '' }) {
    if (relRows.children.length >= L.relations) return;
    const sel = h('select', {}, h('option', { value: '' }, '(캐릭터)'), state.data.characters.filter((c) => c.id !== selfId).map((c) => h('option', { value: c.id }, `${c.name} (${c.id})`)));
    sel.value = r.id;
    const label = h('input', { value: r.label || '', placeholder: '관계 이름 (예: 그 마녀)', maxlength: 40 });
    const note = h('input', { value: r.note || '', placeholder: '한 줄 (60자)' });
    const row = h('div', { class: 'rel-row' }, sel, label, counted(note, L.relationNote), h('button', { class: 'btn small', onclick: () => (row.remove(), (relAdd.disabled = false)) }, '✕'));
    row._get = () => ({ id: sel.value, label: label.value.trim(), note: note.value.trim() });
    relRows.append(row);
    relAdd.disabled = relRows.children.length >= L.relations;
  }
  // ── voice ──
  const v = {
    personality: h('textarea', { rows: 2 }),
    speech: h('textarea', { rows: 2 }),
    address: h('textarea', { rows: 3, placeholder: '대상: 호칭 — 줄마다 하나\n주인공: 단장\n이레나: 그 마녀' }),
    habits: h('textarea', { rows: 2, placeholder: '줄마다 하나' }),
    never: h('textarea', { rows: 2, placeholder: '절대 안 하는 말 — 줄마다 하나 (꼭 채우기)' }),
    weakness: h('input', { placeholder: '약한 부분 (꼭 채우기)' }),
    desire: h('input', { placeholder: '원하는 것' }),
    samples: h('textarea', { rows: 4, placeholder: '예시 대사 3~5개 — 줄마다 하나' }),
  };

  function fill(p = {}) {
    const f = p.facts || {};
    for (const [k] of FACTS) setVal(facts[k], f[k]);
    for (const [k] of FACT_LISTS) setVal(factLists[k], toLines(f[k]));
    stories.forEach((s, i) => {
      const st = (p.stories || [])[i] || {};
      setVal(s.title, st.title);
      s.unlock.value = String(st.unlock?.breakthrough || [1, 3, 6][i]);
      setVal(s.text, st.text);
    });
    const ln = p.lines || {};
    for (const [k] of LINES) setVal(lines[k], ln[k]);
    setVal(idle, toLines(ln.idle));
    relRows.replaceChildren();
    relAdd.disabled = false;
    (p.relations || []).forEach(addRel);
    const vo = p.voice || {};
    for (const k of ['personality', 'speech', 'weakness', 'desire']) setVal(v[k], vo[k]);
    for (const k of ['habits', 'never', 'samples']) setVal(v[k], toLines(vo[k]));
    setVal(v.address, addressToText(vo.address));
  }

  function getForm() {
    const { address, bad } = addressFromText(v.address.value);
    if (bad.length) toast(`호칭 대상을 찾지 못했어요: ${bad.join(', ')} (주인공 / 캐릭터 이름 / id)`, 'error');
    const voice = {
      personality: v.personality.value.trim(),
      speech: v.speech.value.trim(),
      address,
      habits: fromLines(v.habits.value),
      never: fromLines(v.never.value),
      weakness: v.weakness.value.trim(),
      desire: v.desire.value.trim(),
      samples: fromLines(v.samples.value),
    };
    if (voiceOnly) return { voice };
    return {
      facts: { ...Object.fromEntries(FACTS.map(([k]) => [k, facts[k].value.trim()])), ...Object.fromEntries(FACT_LISTS.map(([k]) => [k, fromLines(factLists[k].value)])) },
      stories: stories.filter((s) => s.text.value.trim()).map((s) => ({ title: s.title.value.trim(), text: s.text.value.trim(), unlock: { breakthrough: Number(s.unlock.value) } })),
      lines: { ...Object.fromEntries(LINES.map(([k]) => [k, lines[k].value.trim()])), idle: fromLines(idle.value) },
      relations: [...relRows.children].map((r) => r._get()).filter((r) => r.id),
      voice,
    };
  }

  // ── AI ──
  const model = modelPicker('profile');
  const feedback = h('input', { placeholder: '수정 요청 (예: 더 과묵하게, 이레나와 앙숙으로)' });
  async function ai(part) {
    const r = await busy(part === 'all' ? '프로필 쓰는 중…' : '다시 쓰는 중…', () =>
      tryApi(() => api.post('/api/char/profile', { id: selfId, part, feedback: feedback.value, current: get(), model: model.value })),
    );
    if (!r) return;
    fill(r.profile);
    syncJson(true);
    warnBox.replaceChildren(h('div', {},
      h('p', { class: 'muted small' }, `모델: ${r.model.label}${r.model.mock ? ' (모의)' : ''} · 아직 저장 안 됨 — 고친 뒤 저장`),
      r.warnings.length > 0 && h('ul', { class: 'warn-list' }, r.warnings.map((w) => h('li', { class: 'warn' }, w))),
    ));
    toast('초안을 채웠어요. 고친 뒤 저장해 주세요', 'success');
  }

  async function save() {
    let p;
    try {
      p = get();
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
    const r = isProt
      ? await tryApi(() => api.put('/api/story-bible/protagonist', { voice: p.voice }))
      : await tryApi(() => api.put(`/api/characters/${target.id}/profile`, { profile: p }));
    if (!r) return false;
    if (!isProt) await reloadData();
    toast('프로필을 저장했어요', 'success');
    return true;
  }

  const field = (label, el, max) => h('label', { class: 'field' }, label, max ? counted(el, max) : el);
  const voiceSection = h(
    'section',
    { class: 'pf-section' },
    h('h3', {}, '말투 카드 (작가용 · 게임 화면에 안 나옴 · 배포 때 빠짐)'),
    h('p', { class: 'muted small' }, '스토리 생성 · 검수가 이 카드를 최우선으로 따라요. 약한 부분과 절대 안 하는 말은 꼭 채워 주세요.'),
    h('div', { class: 'grid2' }, field('성격', v.personality, L.voiceText), field('말투 (존대/반말, 문장 길이, 어미, 욕설)', v.speech, L.voiceText)),
    h('div', { class: 'grid2' }, field('호칭', v.address), field('버릇', v.habits)),
    h('div', { class: 'grid2' }, field('절대 안 하는 말', v.never), field('예시 대사 (3~5개)', v.samples)),
    h('div', { class: 'grid2' }, field('약한 부분', v.weakness, L.voiceText), field('원하는 것', v.desire, L.voiceText)),
  );
  // ── JSON 원본 탭: 지금 폼 내용을 JSON으로 보기 · 복사 · 내려받기, 밖에서 고친 JSON을 붙여넣어 폼에 적용 ──
  const jsonArea = h('textarea', { class: 'pf-json', rows: 28, spellcheck: 'false' });
  const jsonInfo = h('div', { class: 'pf-json-info' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json,text/plain', hidden: true });
  let jsonDirty = false; // 붙여넣거나 고쳤는데 아직 폼에 적용 안 함
  jsonArea.addEventListener('input', () => {
    jsonDirty = true;
    jsonInfo.replaceChildren(h('p', { class: 'muted small' }, '고친 내용은 아직 폼에 적용 안 됨 — "폼에 적용"을 누르거나 그대로 저장하면 적용돼요'));
  });
  /** 폼 → JSON (force가 아니면 적용 안 한 편집은 덮어쓰지 않음) */
  function syncJson(force = false) {
    if (jsonDirty && !force) return;
    jsonArea.value = JSON.stringify(prune(getForm()), null, 2);
    jsonDirty = false;
  }
  /** JSON → 폼 (문법 오류면 예외). 서버 검사 결과(길이 · 형식 · 모르는 키)는 비동기로 아래에 표시 */
  function applyJson() {
    let { profile: p, notes } = parseProfileJson(jsonArea.value, selfId);
    // 말투 카드만 쓰는 대상(NPC · 주인공)은 voice 객체만 붙여넣어도 받음
    if (voiceOnly && !p.voice && ['personality', 'speech', 'samples', 'never'].some((k) => k in p)) p = { voice: p };
    fill(voiceOnly ? { voice: p.voice || {} } : p);
    jsonDirty = false;
    jsonArea.value = JSON.stringify(prune(getForm()), null, 2);
    jsonInfo.replaceChildren(h('p', { class: 'muted small' }, '폼에 적용했어요 (아직 저장 안 됨)'), ...notes.map((n) => h('p', { class: 'warn small' }, n)));
    tryApi(() => api.post('/api/char/profile/check', { id: selfId, profile: p })).then((r) => {
      if (!r) return;
      const rows = [
        ...r.issues.map((x) => h('li', { class: 'error' }, `저장 안 됨: ${x}`)),
        ...r.warnings.map((x) => h('li', { class: 'warn' }, x)),
        ...(r.unknown.length ? [h('li', { class: 'warn' }, `모르는 키라서 빠져요: ${r.unknown.join(', ')}`)] : []),
      ];
      jsonInfo.append(rows.length ? h('ul', { class: 'warn-list' }, rows) : h('p', { class: 'ok-text small' }, '✓ 형식 · 길이 문제 없음'));
    });
    return p;
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    jsonArea.value = await f.text();
    try {
      applyJson();
    } catch (e) {
      jsonDirty = true;
      jsonInfo.replaceChildren(h('p', { class: 'error small' }, e.message));
    }
  });
  const fileName = `${isProt ? 'protagonist' : target.id}-profile.json`;
  const jsonPane = h(
    'div',
    { class: 'pf-json-pane', hidden: true },
    h('p', { class: 'muted small' }, '지금 폼 내용을 JSON으로 보여 줘요 (빈 칸은 생략). 밖에서 고친 JSON을 통째로 붙여넣고 "폼에 적용"을 누르면 폼이 바뀌어요 — 저장은 아래 저장 버튼으로. 프로필 객체, {"profile": …}, 캐릭터 항목 그대로 모두 받아요.'),
    h(
      'div',
      { class: 'row wrap' },
      h(
        'button',
        {
          class: 'btn primary small',
          onclick: () => {
            try {
              applyJson();
              toast('폼에 적용했어요. 확인 후 저장해 주세요', 'success');
            } catch (e) {
              jsonInfo.replaceChildren(h('p', { class: 'error small' }, e.message));
            }
          },
        },
        '폼에 적용',
      ),
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(jsonArea.value);
              toast('JSON을 복사했어요', 'success');
            } catch {
              jsonArea.select();
              toast('복사 권한이 없어요 — 선택해 뒀으니 Ctrl+C', 'error');
            }
          },
        },
        '복사',
      ),
      h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            const url = URL.createObjectURL(new Blob([jsonArea.value], { type: 'application/json' }));
            const a = h('a', { href: url, download: fileName });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          },
        },
        '파일로 내려받기',
      ),
      h('button', { class: 'btn small', onclick: () => fileInput.click() }, '파일 불러오기'),
      h('button', { class: 'btn small', title: '적용 안 한 편집을 버리고 지금 폼 내용으로', onclick: () => (syncJson(true), jsonInfo.replaceChildren()) }, '폼 내용으로 되돌리기'),
      fileInput,
    ),
    jsonInfo,
    jsonArea,
  );

  const formPane = h(
    'div',
    { class: 'pf-form-pane' },
    h(
      'div',
      { class: 'row wrap pf-ai' },
      h('button', { class: 'btn primary small', onclick: () => ai('all') }, voiceOnly ? 'AI로 말투 카드 만들기' : 'AI로 프로필 만들기'),
      !voiceOnly && h('button', { class: 'btn small', onclick: () => ai('stories') }, '이야기만'),
      !voiceOnly && h('button', { class: 'btn small', onclick: () => ai('lines') }, '대사만'),
      !voiceOnly && h('button', { class: 'btn small', onclick: () => ai('voice') }, '말투 카드만'),
      model.el,
    ),
    h('div', { class: 'row' }, feedback),
    h('p', { class: 'muted small' }, '수정 요청을 적고 버튼을 누르면 지금 폼 내용 + 요청으로 다시 만들어요. 다른 캐릭터들의 말투 카드 요약과 주인공 카드, 이 캐릭터가 나온 대본 발췌를 함께 읽어요.'),
    warnBox,
    !voiceOnly &&
      h(
        'section',
        { class: 'pf-section' },
        h('h3', {}, '기본 정보 (보유하면 보임 · 빈 칸은 숨김)'),
        h('div', { class: 'grid2' }, FACTS.map(([k, label]) => field(label, facts[k], L.fact)), FACT_LISTS.map(([k, label]) => field(label, factLists[k]))),
      ),
    !voiceOnly &&
      h(
        'section',
        { class: 'pf-section' },
        h('h3', {}, '이야기 (돌파로 열림, 최대 3편)'),
        stories.map((s) => h('div', { class: 'pf-story' }, h('div', { class: 'row' }, s.title, s.unlock), counted(s.text, L.storyText))),
      ),
    !voiceOnly &&
      h(
        'section',
        { class: 'pf-section' },
        h('h3', {}, '상황별 대사 (40자)'),
        h('div', { class: 'grid2' }, LINES.map(([k, label]) => field(label, lines[k], L.line))),
        field('대기 (홈 대표 캐릭터를 누르면)', idle),
      ),
    !voiceOnly && h('section', { class: 'pf-section' }, h('h3', {}, '관계 (둘 다 보유하면 보임, 최대 6)'), relRows, relAdd),
    voiceSection,
  );

  const tabForm = h('button', { class: ['tab-s', 'active'], type: 'button', onclick: () => showTab('form') }, '폼');
  const tabJson = h('button', { class: 'tab-s', type: 'button', onclick: () => showTab('json') }, 'JSON 원본');
  function showTab(which) {
    if (which === 'json') syncJson();
    else if (jsonDirty) {
      try {
        applyJson(); // 붙여넣은 JSON을 폼으로 가져가면서 탭 전환
      } catch (e) {
        jsonInfo.replaceChildren(h('p', { class: 'error small' }, `${e.message} — 고치거나 "폼 내용으로 되돌리기"를 눌러 주세요`));
        return;
      }
    }
    formPane.hidden = which !== 'form';
    jsonPane.hidden = which !== 'json';
    tabForm.classList.toggle('active', which === 'form');
    tabJson.classList.toggle('active', which === 'json');
  }
  const el = h('div', { class: 'profile-form' }, h('div', { class: 'row pf-tabs' }, tabForm, tabJson), formPane, jsonPane);

  /** 저장 · 승인에 쓸 값: JSON 탭에 적용 안 한 편집이 있으면 먼저 적용 (문법 오류면 예외) */
  function get() {
    if (jsonDirty) applyJson();
    return getForm();
  }
  fill(profile);
  return { el, get, save, fill };
}

/** 프로필 편집 창 열기 (캐릭터 또는 주인공) */
export async function openProfileEditor(target, { npc = false, profile } = {}) {
  const isProt = target === PROTAGONIST;
  let current = profile;
  if (!current) current = isProt ? { voice: (await api.get('/api/story-bible')).protagonist?.voice || {} } : target.profile || {};
  const ed = profileEditor({ target, profile: current, npc });
  return modal({
    title: isProt ? '주인공 말투 카드' : `프로필 — ${target.name} (${target.id})${npc ? ' · NPC는 말투 카드만' : ''}`,
    wide: true,
    body: ed.el,
    buttons: [
      { label: '닫기', value: null },
      { label: '저장', value: 'saved', primary: true, onClick: ed.save },
    ],
  });
}
