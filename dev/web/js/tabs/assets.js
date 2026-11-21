// 에셋 탭: 스토리 배경 · 적 · 소품 그림을 한곳에서 뽑기
// - 모든 그림은 "AI로 프롬프트 쓰기" 또는 "직접 쓰기"로 프롬프트를 정한 뒤 ComfyUI로 그려요 (promptStep)
// - 승인하면 작업 공간에 저장: 배경 assets/bg/<이름>.jpg (+ 설정집 배경 목록), 적 assets/enemies/<id>.png (+ enemies.json),
//   소품 assets/props/<id>.png (+ props.json — 개발 도구 전용 목록. 그림은 상점 상품 등에서 골라 써요)
import { h, toast, modal, confirmBox, slugOk, wsImage } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData, saveList } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { promptStep } from '../promptStep.js';

/**
 * 그림 뽑기 모달 공통: 입력 칸 + 프롬프트 단계(AI로 쓰기 / 직접 쓰기) + 결과 검토(jobPanel)
 * @param {object} o
 * @param {'bg'|'enemy'|'prop'} o.kind
 * @param {string} o.title
 * @param {Node[]} [o.fields] 입력 칸들
 * @param {()=>object|null} o.getInput 생성 입력값 (검사 실패 시 null)
 * @param {string} o.endpoint 생성 API (예: '/api/prop/generate')
 * @param {string} [o.note]
 * @param {string} [o.approveLabel]
 * @param {(path:string, input:object)=>Promise<void>|void} [o.onApproved] 승인 후 (작업 공간에 저장된 경로)
 * @param {Node} [o.extra] 프롬프트 단계 아래에 덧붙일 요소 (예: 파일 올리기)
 */
export function openAssetGenerator({ kind, title, fields = [], getInput, endpoint, note, approveLabel = '승인 → 저장', onApproved, extra }) {
  const area = h('div');
  const step = promptStep({
    kind,
    getInput,
    generateLabel: '그림 뽑기',
    generate: async (gen) => {
      const input = getInput();
      if (!input) return;
      const job = await tryApi(() => api.post(endpoint, { ...input, ...gen }));
      if (!job) return;
      area.replaceChildren(
        jobPanel(job, {
          approveLabel,
          onApprove: async (n) => {
            const r = await tryApi(() => api.post(`/api/jobs/${job.id}/approve-image`, { attempt: n }));
            if (!r) return false;
            await onApproved?.(r.path, input);
            toast(`저장했어요: ${r.path} (작업 공간)`, 'success');
            return true;
          },
        }).el,
      );
    },
  });
  modal({ title, wide: true, body: h('div', {}, note && h('p', { class: 'muted small' }, note), ...fields, step.el, extra, area) });
}

/** dataURL 읽기 (그림 올리기용) */
export function readFileAsDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/**
 * 적 그림 뽑기 (적 탭에서도 사용)
 * @param {object} enemy 저장된 적 (id 필요)
 * @param {(path:string)=>void} [onDone]
 */
export function openEnemyGenerator(enemy, onDone) {
  const keywords = h('textarea', { rows: 3, placeholder: '외형 (한국어 OK) 예: 녹슨 쇠사슬 갑옷을 입은 거구의 도적 두목, 외눈, 커다란 도끼' }, enemy.keywords || '');
  const extra = h('input', { placeholder: '추가 요청 (선택) 예: 더 어둡게, 늑대 같은 실루엣' });
  openAssetGenerator({
    kind: 'enemy',
    title: `적 그림 뽑기 — ${enemy.name || enemy.id}${enemy.boss ? ' (보스)' : ''}`,
    note: `공통 스타일: dev/style.txt · 흰 배경으로 그린 뒤 배경을 지워 assets/enemies/${enemy.id}.png 로 저장하고 이 적에 연결해요.`,
    fields: [h('label', { class: 'field' }, '외형 키워드 (적의 메모로도 저장돼요)', keywords), h('label', { class: 'field' }, '추가 요청', extra)],
    getInput: () => ({ enemyId: enemy.id, keywords: keywords.value.trim(), extra: extra.value.trim() }),
    endpoint: '/api/enemy/generate',
    approveLabel: '승인 → 이 적의 그림으로',
    onApproved: async (path, input) => {
      await reloadData();
      // 바꾼 외형 키워드를 적 메모에 남겨 두면 다음에(일괄 생성 포함) 그대로 이어받아요
      const cur = state.data.enemies.find((x) => x.id === enemy.id);
      if (cur && (cur.keywords || '') !== input.keywords) {
        const items = state.data.enemies.map((x) => (x.id === enemy.id ? { ...x, keywords: input.keywords } : x));
        await tryApi(() => saveList('enemies', items));
      }
      onDone?.(path);
    },
  });
}

/**
 * 소품 그림 뽑기 / 올리기 (상점 탭에서도 사용)
 * @param {{id?:string, label?:string, prompt?:string, lockId?:boolean, title?:string}} init
 * @param {(path:string)=>void} [onDone]
 */
export function openPropGenerator(init = {}, onDone) {
  const id = h('input', { value: init.id || '', placeholder: '영문 id 예: gold_pouch (파일 이름이 돼요)', disabled: !!init.lockId });
  const label = h('input', { value: init.label || '', placeholder: '이름 예: 금화 주머니' });
  const prompt = h('textarea', { rows: 3, placeholder: '어떤 물건인지 (한국어 OK) 예: 금화가 넘칠 듯 담긴 낡은 가죽 주머니, 놋쇠 장식' }, init.prompt || '');
  const extra = h('input', { placeholder: '추가 요청 (선택) 예: 더 화려하게, 따뜻한 빛' });
  const input = () => {
    const pid = id.value.trim();
    if (!slugOk(pid)) return toast('소품 id를 영문/숫자/_/-로 정해 주세요', 'error'), null;
    return { propId: pid, label: label.value.trim() || pid, description: prompt.value.trim(), extra: extra.value.trim() };
  };
  const upload = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    onchange: async (ev) => {
      const file = ev.target.files?.[0];
      const inp = input();
      if (!file || !inp) return;
      const data = await readFileAsDataUrl(file);
      const r = await tryApi(() => api.post('/api/assets/upload', { dir: 'props', name: inp.propId, label: inp.label, data }));
      if (!r) return;
      await reloadData();
      toast(`그림을 올렸어요: ${r.path} (긴 변 384px PNG)`, 'success');
      onDone?.(r.path);
    },
  });
  openAssetGenerator({
    kind: 'prop',
    title: init.title || (init.id ? `소품 그림 — ${init.label || init.id}` : '새 소품 그림'),
    note: '공통 스타일: dev/style_icon.txt · 흰 배경으로 그린 뒤 배경을 지워 투명 PNG(긴 변 384px)로 assets/props/<id>.png 에 저장해요.',
    fields: [h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'id', id), h('label', { class: 'field' }, '이름', label)), h('label', { class: 'field' }, '물건 설명', prompt), h('label', { class: 'field' }, '추가 요청', extra)],
    getInput: input,
    endpoint: '/api/prop/generate',
    approveLabel: '승인 → 소품으로 저장',
    extra: h('div', { class: 'card inner' }, h('b', {}, '또는 그림 파일 올리기 '), upload, h('span', { class: 'muted small' }, ' (투명 PNG 권장, 위 id로 저장)')),
    onApproved: async (path) => {
      await reloadData();
      onDone?.(path);
    },
  });
}

/**
 * 스토리 배경 그림 뽑기 (설정집에 배경으로 등록 → 스토리 AI와 일괄 생성이 씀)
 * @param {{name?:string, label?:string, prompt?:string}} init
 */
function openBgGenerator(init = {}, onDone) {
  const name = h('input', { value: init.name || '', disabled: !!init.name, placeholder: '영문 이름 예: night_harbor (파일 이름이 돼요)' });
  const label = h('input', { value: init.label || '', placeholder: '장소 이름 예: 밤의 항구' });
  const prompt = h('textarea', { rows: 3, placeholder: '장면 설명 (한국어 OK) 예: 비 내리는 밤의 낡은 항구, 젖은 나무 부두, 흔들리는 등불' }, init.prompt || '');
  const getInput = () => {
    const n = name.value.trim();
    if (!slugOk(n)) return toast('배경 이름을 영문/숫자/_/-로 정해 주세요', 'error'), null;
    if (!prompt.value.trim()) return toast('장면 설명을 적어 주세요', 'error'), null;
    return { bgName: n, scene: prompt.value.trim(), label: label.value.trim() || n };
  };
  openAssetGenerator({
    kind: 'bg',
    title: init.name ? `배경 그림 — ${init.label || init.name}` : '새 스토리 배경',
    note: '공통 스타일: dev/style_bg.txt (인물 없이 풍경만) · 1280×720 JPG로 assets/bg/<이름>.jpg 에 저장하고 설정집 배경 목록에 등록해요.',
    fields: [h('div', { class: 'grid2' }, h('label', { class: 'field' }, '파일 이름', name), h('label', { class: 'field' }, '장소 이름', label)), h('label', { class: 'field' }, '장면 설명', prompt)],
    getInput,
    endpoint: '/api/bg/generate',
    approveLabel: '승인 → 배경으로 저장',
    onApproved: async (path, input) => {
      await tryApi(() => api.put(`/api/story-bible/backgrounds/${input.bgName}`, { label: input.label, prompt: input.scene }));
      onDone?.(path);
    },
  });
}

export function assetsTab(root) {
  const bgHost = h('div');
  const enemyHost = h('div');
  const propHost = h('div');
  let bible = { backgrounds: {} };
  let bgFiles = [];

  root.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '에셋 — 스토리 배경 · 적 · 소품'),
      h('p', {}, '그림마다 "AI로 프롬프트 쓰기"(Gemini가 에셋 종류별 규칙에 맞춰 작성) 또는 "직접 쓰기"(처음부터 입력)로 프롬프트를 정하고 ComfyUI로 그려요.'),
      h('p', { class: 'muted small' }, '승인한 그림은 작업 공간에 저장돼요. 배포 탭에서 배포해야 실제 게임에 반영돼요. 여러 개를 한 번에 뽑으려면 일괄 생성 탭을 쓰세요.'),
    ),
    bgHost,
    enemyHost,
    propHost,
  );

  const card = ({ path, label, sub, png, actions, ratio }) =>
    h(
      'div',
      { class: 'slot-card' },
      h(
        'div',
        { class: ['slot-preview', png && 'checker', ratio] },
        path ? h('img', { src: wsImage(path), alt: label, onerror: (e) => e.target.replaceWith(h('span', { class: 'muted' }, '파일 없음')) }) : h('span', { class: 'muted small' }, '그림 없음'),
      ),
      h('b', {}, label),
      sub && h('div', { class: 'muted small asset-sub' }, sub),
      h('div', { class: 'row wrap' }, actions),
    );

  // ── 배경 ──
  async function loadBg() {
    const [b, files] = await Promise.all([tryApi(() => api.get('/api/story-bible')), tryApi(() => api.get('/api/assets?dir=bg'))]);
    bible = b || bible;
    bgFiles = files || [];
    renderBg();
  }

  function renderBg() {
    const names = new Map(Object.entries(bible.backgrounds || {}).map(([n, v]) => [n, { name: n, ...v }]));
    for (const f of bgFiles) {
      const n = f.replace(/^assets\/bg\//, '').replace(/\.[a-z]+$/i, '');
      if (!names.has(n)) names.set(n, { name: n, label: n, prompt: '', looseFile: f });
    }
    const list = [...names.values()].map((b) => ({ ...b, path: bgFiles.find((f) => f === `assets/bg/${b.name}.jpg`) || b.looseFile || '' }));
    bgHost.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `스토리 배경 (${list.length})`), h('button', { class: 'btn primary small', onclick: () => openBgGenerator({}, loadBg) }, '+ 새 배경')),
        h('p', { class: 'muted small' }, '설정집에 등록된 배경은 스토리 AI가 장면 배경으로 골라 써요. 스토리 탭의 장면 편집에서도 이 그림들을 고를 수 있어요.'),
        list.length
          ? h(
              'div',
              { class: 'slot-grid' },
              list.map((b) =>
                card({
                  path: b.path,
                  label: b.label || b.name,
                  sub: `${b.name}${b.arc ? ` · 챕터 ${b.arc}` : ''}${b.prompt ? ` — ${b.prompt}` : b.looseFile ? ' — (설정집에 없는 파일)' : ''}`,
                  actions: [h('button', { class: 'btn small primary', onclick: () => openBgGenerator(b, loadBg) }, b.path ? '다시 뽑기' : '뽑기'), h('button', { class: 'btn small', onclick: () => editBg(b) }, '설명 고치기')],
                }),
              ),
            )
          : h('p', { class: 'muted' }, '아직 배경이 없어요'),
      ),
    );
  }

  function editBg(b) {
    const label = h('input', { value: b.label || '' });
    const prompt = h('textarea', { rows: 4 }, b.prompt || '');
    modal({
      title: `배경 설명 — ${b.name}`,
      body: h('div', {}, h('label', { class: 'field' }, '장소 이름', label), h('label', { class: 'field' }, '장면 설명 (그림 프롬프트 재료)', prompt)),
      buttons: [
        { label: '취소', value: null },
        {
          label: '저장',
          primary: true,
          onClick: async () => {
            const r = await tryApi(() => api.put(`/api/story-bible/backgrounds/${b.name}`, { label: label.value.trim(), prompt: prompt.value.trim() }));
            if (!r) return false;
            await loadBg();
            toast('설정집에 저장했어요', 'success');
          },
        },
      ],
    });
  }

  // ── 적 ──
  function renderEnemies() {
    const list = state.data.enemies || [];
    enemyHost.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `적 (${list.length})`), h('a', { class: 'btn small', href: '#enemies' }, '적 탭에서 만들기 / 고치기')),
        h('p', { class: 'muted small' }, '흰 배경으로 그린 뒤 배경을 지워 투명 PNG로 저장하고, 그 적의 그림으로 바로 연결해요.'),
        list.length
          ? h(
              'div',
              { class: 'slot-grid icons' },
              list.map((e) =>
                card({
                  path: e.image,
                  png: true,
                  label: `${e.name}${e.boss ? ' (보스)' : ''}`,
                  sub: `${e.id}${e.keywords ? ` — ${e.keywords}` : ''}`,
                  actions: [h('button', { class: 'btn small primary', onclick: () => openEnemyGenerator(e, renderEnemies) }, e.image ? '다시 뽑기' : '뽑기')],
                }),
              ),
            )
          : h('p', { class: 'muted' }, '아직 적이 없어요. 적 탭에서 먼저 만들어 주세요.'),
      ),
    );
  }

  // ── 소품 ──
  function propUsedIn(p) {
    const shop = state.data.shop || {};
    return [...(shop.gold || []), ...(shop.cash || [])].filter((it) => it.image && it.image === p.image);
  }

  function renderProps() {
    const list = state.data.props || [];
    propHost.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `소품 (${list.length})`), h('button', { class: 'btn primary small', onclick: () => openPropGenerator({}, renderProps) }, '+ 새 소품')),
        h('p', { class: 'muted small' }, '아이템 그림 라이브러리예요 (투명 PNG). 상점 탭에서 상품 그림으로 골라 쓸 수 있어요. 목록은 개발 도구 전용이고, 상품 등에 쓰인 그림만 배포돼요.'),
        list.length
          ? h(
              'div',
              { class: 'slot-grid icons' },
              list.map((p) => {
                const used = propUsedIn(p);
                return card({
                  path: p.image,
                  png: true,
                  label: p.label || p.id,
                  sub: `${p.id}${used.length ? ` · 상품 ${used.length}개에 사용` : ''}${p.prompt ? ` — ${p.prompt}` : ''}`,
                  actions: [
                    h('button', { class: 'btn small primary', onclick: () => openPropGenerator({ ...p, lockId: true }, renderProps) }, p.image ? '다시 뽑기' : '뽑기'),
                    h('button', { class: 'btn small danger-outline', onclick: () => removeProp(p) }, '목록에서 빼기'),
                  ],
                });
              }),
            )
          : h('p', { class: 'muted' }, '아직 소품이 없어요'),
      ),
    );
  }

  async function removeProp(p) {
    const used = propUsedIn(p);
    const msg = used.length ? `이 그림을 쓰는 상품이 있어요:\n- ${used.map((x) => x.name).join('\n- ')}\n\n목록에서 빼도 그림 파일과 상품 연결은 그대로 남아요.` : '목록에서 뺄까요? (그림 파일은 그대로 남아요)';
    if (!(await confirmBox(`「${p.label || p.id}」 빼기`, msg, { ok: '빼기', danger: true }))) return;
    if ((await tryApi(() => saveList('props', state.data.props.filter((x) => x.id !== p.id)))) === null) return;
    renderProps();
  }

  async function refresh() {
    await tryApi(() => reloadData());
    renderEnemies();
    renderProps();
    await loadBg();
  }

  renderEnemies();
  renderProps();
  loadBg();
  return { refresh };
}
