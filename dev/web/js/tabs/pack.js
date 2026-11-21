// 챕터 팩 탭: 챕터 개요 하나로 "챕터(12장) + 등장 캐릭터 + 배경 + 적 + 스테이지"를 한 번에
// 1) 개요 → AI 구성안 (고치기 / 사유와 함께 다시 만들기)
// 2) 팩 만들기: 서버가 차례대로 만들고 12장 대본을 씀 (진행 상황을 여기서 확인, 중간에 멈춰도 이어서 가능)
import { h, toast, confirmBox, busy } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';

const ROLES = [
  ['minion', '잡몹'],
  ['elite', '정예'],
  ['boss', '보스'],
];
const STYLES = [
  ['physical', '물리'],
  ['dot', '지속 피해'],
  ['heal', '치유'],
  ['tank', '방어'],
  ['debuff', '약화'],
];
const STATUS = { pending: '대기', running: '진행 중…', done: '완료', skipped: '건너뜀', error: '오류', cancelled: '중단' };

// 탭을 다시 열어도 편집 중이던 구성안 유지
let draft = null;

export function packTab(root) {
  let timer = null;
  let destroyed = false;
  let warnings = [];
  const left = h('div', { class: 'col-left' });
  const right = h('div', { class: 'col-right' });
  root.replaceChildren(h('div', { class: 'two-col' }, left, right));

  const arcInput = h('input', { type: 'number', class: 'small-input', min: 1, value: 1 });
  const outline = h('textarea', { rows: 10, placeholder: '챕터 전체의 대략적인 줄거리\n예: 주인공 일행이 별빛 도서관을 떠나 남쪽 사막 도시로 간다. 모래 폭풍 속에서 도적단과 얽히고, 도적단의 두목이 사실은 사라진 별빛 직조사의 제자였다는 걸 알게 된다. 마지막에 사막 깊은 곳의 고대 유적에서 거대한 모래 골렘과 싸운다.' });
  const savedBox = h('div', { class: 'item-list' });
  const planBox = h('div');
  const progressBox = h('div');

  // ── 구성안 만들기 ──
  async function makePlan(feedback = '') {
    if (!outline.value.trim() && !draft?.outline) return toast('챕터 개요를 적어 주세요', 'error');
    const r = await busy(feedback ? '수정 요청을 반영해서 구성안을 다시 짜는 중…' : '세계관과 지금까지의 이야기를 읽고 12장 구성안을 짜는 중…', () =>
      tryApi(() => api.post('/api/pack/plan', { arc: parseInt(arcInput.value, 10) || 1, outline: feedback ? draft.outline : outline.value.trim(), feedback, previous: feedback ? draft : null })),
    );
    if (!r) return;
    draft = r.plan;
    warnings = r.warnings;
    renderPlan();
    refresh();
  }

  // ── 구성안 편집 ──
  function renderPlan() {
    if (!draft) {
      planBox.replaceChildren(h('div', { class: 'empty' }, '왼쪽에 챕터 개요를 적고 "구성안 만들기"를 눌러 주세요.'));
      return;
    }
    const p = draft;
    const input = (obj, key, attrs = {}) => h('input', { value: obj[key] ?? '', oninput: (e) => (obj[key] = e.target.value), ...attrs });
    const area = (obj, key, rows = 2, attrs = {}) => h('textarea', { rows, oninput: (e) => (obj[key] = e.target.value), ...attrs }, obj[key] ?? '');
    const sel = (obj, key, options) => {
      const s = h('select', { onchange: (e) => ((obj[key] = e.target.value), renderPlan()) }, options.map(([v, l]) => h('option', { value: v }, l)));
      s.value = obj[key];
      return s;
    };
    const remove = (list, i) => h('button', { class: 'btn tiny', onclick: () => (list.splice(i, 1), renderPlan()) }, '✕');
    const charName = (id) => p.characters.find((c) => c.id === id)?.name || state.data.characters.find((c) => c.id === id)?.name || id;
    const enemyName = (id) => p.enemies.find((e) => e.id === id)?.name || state.data.enemies.find((e) => e.id === id)?.name || id;

    const chars = p.characters.map((c, i) =>
      h(
        'div',
        { class: 'scene-card' },
        h(
          'div',
          { class: 'row wrap' },
          h('label', { class: 'bf-param' }, h('span', {}, '이름'), input(c, 'name')),
          h('label', { class: 'bf-param' }, h('span', {}, 'id'), input(c, 'id', { class: 'small-input' })),
          h('label', { class: 'bf-param' }, h('span', {}, '희귀도'), sel(c, 'rarity', [5, 4, 3, 2, 1].map((r) => [String(r), `${r}★`]))),
          h('label', { class: 'bf-param grow' }, h('span', {}, '칭호'), input(c, 'title')),
          h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: c.pullable, onchange: (e) => (c.pullable = e.target.checked) }), '뽑기 동료'),
          remove(p.characters, i),
        ),
        h('label', { class: 'field' }, '외형 키워드 (그림 만들 때 씀)', area(c, 'keywords')),
        h('label', { class: 'field' }, '공개 소개문 (도감)', area(c, 'description')),
        h('label', { class: 'field' }, '작가용 설정 메모 (공개되지 않음)', area(c, 'lore')),
      ),
    );
    const bgs = p.backgrounds.map((b, i) =>
      h('div', { class: 'row wrap pack-row' }, h('label', { class: 'bf-param' }, h('span', {}, '이름(영문)'), input(b, 'name', { class: 'small-input' })), h('label', { class: 'bf-param' }, h('span', {}, '장소'), input(b, 'label')), h('label', { class: 'bf-param grow' }, h('span', {}, '그림 설명'), input(b, 'prompt')), remove(p.backgrounds, i)),
    );
    const enemies = p.enemies.map((e, i) =>
      h(
        'div',
        { class: 'scene-card' },
        h(
          'div',
          { class: 'row wrap' },
          h('label', { class: 'bf-param' }, h('span', {}, '이름'), input(e, 'name')),
          h('label', { class: 'bf-param' }, h('span', {}, 'id'), input(e, 'id', { class: 'small-input' })),
          h('label', { class: 'bf-param' }, h('span', {}, '역할'), sel(e, 'role', ROLES)),
          h('label', { class: 'bf-param' }, h('span', {}, '스타일'), sel(e, 'style', STYLES)),
          h('label', { class: 'bf-param grow' }, h('span', {}, '설명'), input(e, 'description')),
          remove(p.enemies, i),
        ),
        h('div', { class: 'row wrap' }, ...['basic', 'skill', 'ultimate'].map((k) => h('label', { class: 'bf-param' }, h('span', {}, { basic: '기본 기술', skill: '스킬', ultimate: '필살기 (보스)' }[k]), input(e.skills, k)))),
      ),
    );
    const firstEnemy = p.enemies[0]?.id || state.data.enemies[0]?.id;
    const chapters = p.chapters.map((c) =>
      h(
        'div',
        { class: ['scene-card', c.battle && 'battle-scene'] },
        h('div', { class: 'row wrap' }, h('b', {}, `${c.n}장`), h('label', { class: 'bf-param grow' }, h('span', {}, '제목'), input(c, 'title'))),
        area(c, 'outline', 3),
        h('div', { class: 'muted small' }, '등장: ', c.characters.length ? c.characters.map(charName).join(', ') : '(전체)'),
        c.battle
          ? h(
              'div',
              { class: 'row wrap small' },
              h('b', {}, `⚔ ${c.battle.name}`),
              h('span', { class: 'muted' }, c.battle.waves.map((w, wi) => `웨이브${wi + 1}: ${w.map(enemyName).join(', ')}`).join(' / ')),
              h('button', { class: 'btn tiny', onclick: () => ((c.battle = null), renderPlan()) }, '전투 빼기'),
            )
          : firstEnemy && h('button', { class: 'btn tiny', onclick: () => ((c.battle = { name: `${c.n}장 전투`, waves: [[firstEnemy, firstEnemy]] }), renderPlan()) }, '+ 전투 넣기'),
      ),
    );

    const feedback = h('textarea', { rows: 2, placeholder: '예: 6장에 반전을 넣어 줘 / 적을 사막 생물 위주로 / SSR 동료를 한 명 더' });
    const length = h('select', {}, [['auto', '장 분량: AI가 판단'], ['short', '짧게'], ['normal', '보통'], ['long', '길게']].map(([v, l]) => h('option', { value: v }, l)));
    const autoBg = h('input', { type: 'checkbox', checked: true });
    const overwrite = h('input', { type: 'checkbox' });
    const battles = p.chapters.filter((c) => c.battle).length;

    planBox.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `구성안 — 챕터 ${p.arc}`),
        warnings.length > 0 && h('ul', { class: 'warn-list' }, warnings.map((w) => h('li', { class: 'warn' }, w))),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '챕터 제목', input(p, 'title')), h('label', { class: 'field' }, '한 줄 소개', input(p, 'summary'))),
        h('p', { class: 'muted small' }, `새 캐릭터 ${p.characters.length}명 · 배경 ${p.backgrounds.length}개 · 적 ${p.enemies.length}종 · 전투 ${battles}장 · 12장`),
      ),
      h('section', { class: 'card' }, h('h2', {}, `새 캐릭터 (${p.characters.length})`), h('p', { class: 'muted small' }, '그림 없이 외형 키워드와 설정만 메모된 캐릭터로 만들어져요. 그림은 나중에 캐릭터 탭이나 일괄 생성 탭에서 (키워드가 자동으로 들어가요). "뽑기 동료"를 끄면 스토리 전용 인물(뽑기·도감에 안 나옴)이에요.'), chars),
      h('section', { class: 'card' }, h('h2', {}, `배경 (${p.backgrounds.length})`), bgs, h('button', { class: 'btn tiny', onclick: () => (p.backgrounds.push({ name: `a${String(p.arc).padStart(2, '0')}_new${p.backgrounds.length + 1}`, label: '', prompt: '' }), renderPlan()) }, '+ 배경')),
      h('section', { class: 'card' }, h('h2', {}, `적 (${p.enemies.length})`), h('p', { class: 'muted small' }, '역할(잡몹/정예/보스)과 스타일로 스킬·능력치가 정해져요. 만든 뒤 적 탭에서 자세히 고칠 수 있어요.'), enemies),
      h('section', { class: 'card' }, h('h2', {}, '12장 구성'), chapters),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '다시 만들기 / 팩 만들기'),
        h('label', { class: 'field' }, '수정 요청', feedback),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn danger-outline', onclick: () => (feedback.value.trim() ? makePlan(feedback.value.trim()) : toast('수정 요청을 적어 주세요', 'error')) }, '거절 + 사유 → 구성안 다시 만들기')),
        h('hr'),
        h('div', { class: 'row wrap' }, length, h('label', { class: 'inline' }, autoBg, '배경 그림도 바로 일괄 생성 (ComfyUI)'), h('label', { class: 'inline' }, overwrite, '이미 만든 장도 다시 쓰기')),
        h('p', { class: 'muted small' }, '12장 대본을 차례대로 써요 (앞 장이 저장돼야 다음 장이 그 내용을 읽어요). Gemini를 12번 이상 불러서 몇 분 걸릴 수 있어요. 중간에 멈춰도 같은 구성안으로 다시 누르면 만든 것은 건너뛰고 이어서 해요.'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              if (!(await confirmBox('챕터 팩 만들기', `챕터 ${p.arc} 「${p.title}」\n캐릭터 ${p.characters.length}명, 적 ${p.enemies.length}종, 스테이지 ${battles}개, 배경 ${p.backgrounds.length}개를 작업 공간에 만들고 12장 대본을 써요.`, { ok: '만들기' }))) return;
              const r = await tryApi(() => api.post('/api/pack/start', { plan: p, options: { length: length.value, autoBackgrounds: autoBg.checked, overwrite: overwrite.checked } }));
              if (r) {
                renderProgress(r.pack);
                poll();
              }
            },
          },
          '챕터 팩 만들기',
        ),
      ),
    );
  }

  // ── 진행 상황 ──
  function renderProgress(pk) {
    if (!pk) return progressBox.replaceChildren();
    const done = pk.steps.filter((s) => ['done', 'skipped'].includes(s.status)).length;
    progressBox.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `챕터 ${pk.arc} 만들기 ${pk.running ? '진행 중' : pk.stopReason ? (pk.stopReason === 'cancelled' ? '— 중단됨' : '— 멈춤 (오류)') : '— 완료'}`), pk.running && h('button', { class: 'btn small danger-outline', disabled: pk.cancelRequested, onclick: () => tryApi(() => api.post('/api/pack/cancel')) }, pk.cancelRequested ? '멈추는 중…' : '중단')),
        h('div', { class: 'progress' }, h('i', { style: { width: `${(done / pk.steps.length) * 100}%` } })),
        pk.warnings?.length > 0 && h('ul', { class: 'warn-list' }, pk.warnings.map((w) => h('li', { class: 'warn' }, w))),
        h(
          'div',
          { class: 'batch-list' },
          pk.steps.map((s) => h('div', { class: ['batch-item', s.status] }, h('span', { class: 'chip' }, STATUS[s.status] || s.status), h('span', { class: 'grow' }, s.label), s.note && h('span', { class: s.status === 'error' ? 'error small' : 'muted small' }, s.note))),
        ),
        !pk.running &&
          h(
            'div',
            { class: 'row wrap' },
            h('a', { class: 'btn small', href: '#stories' }, '스토리 탭에서 보기'),
            h('a', { class: 'btn small', href: '#batch' }, '일괄 생성 (배경 / 캐릭터 그림)'),
            h('a', { class: 'btn small', href: '#stages' }, '스테이지'),
            h('a', { class: 'btn small', href: '#balance' }, '밸런스 확인'),
            pk.stopReason && h('span', { class: 'muted small' }, '구성안 그대로 "챕터 팩 만들기"를 다시 누르면 이어서 해요'),
          ),
      ),
    );
  }

  async function refresh() {
    const r = await tryApi(() => api.get('/api/pack'));
    if (!r || destroyed) return null;
    if (!draft) arcInput.value = r.nextArc;
    const saved = Object.entries(r.saved || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    savedBox.replaceChildren(
      ...saved.map(([arc, s]) =>
        h(
          'button',
          {
            class: ['list-item', draft?.arc === Number(arc) && 'active'],
            onclick: () => {
              draft = structuredClone(s.plan);
              warnings = [];
              arcInput.value = arc;
              outline.value = draft.outline || '';
              renderPlan();
              refresh();
            },
          },
          h('b', {}, `챕터 ${arc} · ${s.plan?.title || ''}`),
          h('div', { class: 'muted small' }, { draft: '구성안', building: '만드는 중', done: '완료', error: '멈춤 (이어서 가능)', cancelled: '중단 (이어서 가능)' }[s.status] || s.status),
        ),
      ),
      ...(saved.length ? [] : [h('p', { class: 'muted small' }, '아직 없어요')]),
    );
    renderProgress(r.pack);
    return r.pack;
  }

  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const pk = await refresh();
      if (pk?.running) poll();
      else if (pk) {
        await reloadData();
        toast(pk.stopReason ? '챕터 팩 만들기가 멈췄어요' : `챕터 ${pk.arc} 팩을 만들었어요`, pk.stopReason ? 'error' : 'success', 5000);
      }
    }, 1500);
  }

  left.append(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '새 챕터 팩'),
      h('p', { class: 'muted small' }, '챕터 개요 하나로 12장 + 등장 캐릭터 + 배경 + 적 + 스테이지를 한 번에 만들어요. 스토리 탭의 세계관과 지금까지의 메인 스토리를 함께 읽어요.'),
      h('label', { class: 'inline' }, '챕터 번호', arcInput),
      h('label', { class: 'field' }, '챕터 개요', outline),
      h('button', { class: 'btn primary', onclick: () => makePlan() }, '구성안 만들기'),
    ),
    h('section', { class: 'card' }, h('h2', {}, '저장된 구성안'), savedBox),
  );
  right.append(progressBox, planBox);
  if (draft) outline.value = draft.outline || '';
  renderPlan();
  refresh().then((pk) => pk?.running && poll());

  return {
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
