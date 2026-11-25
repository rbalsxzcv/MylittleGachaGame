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

  function get() {
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
    warnBox.replaceChildren(h('div', {},
      h('p', { class: 'muted small' }, `모델: ${r.model.label}${r.model.mock ? ' (모의)' : ''} · 아직 저장 안 됨 — 고친 뒤 저장`),
      r.warnings.length > 0 && h('ul', { class: 'warn-list' }, r.warnings.map((w) => h('li', { class: 'warn' }, w))),
    ));
    toast('초안을 채웠어요. 고친 뒤 저장해 주세요', 'success');
  }

  async function save() {
    const p = get();
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
  const el = h(
    'div',
    { class: 'profile-form' },
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
