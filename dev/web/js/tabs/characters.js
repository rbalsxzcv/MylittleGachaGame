// 캐릭터 탭: 생성 → 검토(원본/배경 제거) → 승인/거절/다시 생성, 소개문 AI 작성, 기존 캐릭터 수정/삭제
import { h, toast, modal, confirmBox, busy, wsImage, slugOk, nowIso, isoToLocal, localToIso, RARITIES } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { openPreview } from '../preview.js';

export function charactersTab(root) {
  let activeJob = null; // 지금 검토 중인 작업
  const left = h('div', { class: 'col-left' });
  const right = h('div', { class: 'col-right' });
  root.replaceChildren(h('div', { class: 'two-col' }, left, right));

  // ── 생성 폼 ──
  const f = {
    name: h('input', { placeholder: '예: 루미' }),
    rarity: h('select', {}, RARITIES.map((r) => h('option', { value: r }, r))),
    title: h('input', { placeholder: '예: 별을 엮는 무녀' }),
    keywords: h('textarea', { rows: 3, placeholder: '예: 은발 긴 머리, 별 장식 머리핀, 남색 무녀복, 금색 눈' }),
    lore: h('textarea', { rows: 3, placeholder: '예: 별빛을 실처럼 엮어 소원을 들어주는 무녀. 단 것을 좋아함' }),
  };
  let replacingId = null;
  const replaceNote = h('p', { class: 'note', hidden: true });

  async function generate() {
    const payload = { name: f.name.value, rarity: f.rarity.value, title: f.title.value, keywords: f.keywords.value, lore: f.lore.value, charId: replacingId };
    const job = await busy('그림 생성 + 배경 제거 중… (최대 1분)', () => tryApi(() => api.post('/api/char/generate', payload)));
    if (job) openJob(job);
  }

  function setReplacing(c) {
    replacingId = c?.id || null;
    replaceNote.hidden = !c;
    replaceNote.textContent = c ? `「${c.name}」(${c.id})의 그림을 교체합니다. 승인하면 기존 그림을 덮어써요.` : '';
    if (c) {
      f.name.value = c.name;
      f.rarity.value = c.rarity;
      f.title.value = c.title || '';
      f.lore.value = c.description || '';
      f.keywords.focus();
    }
  }

  // ── 검토 + 승인 ──
  function openJob(job) {
    const inp = job.input;
    const existing = inp.charId ? state.data.characters.find((c) => c.id === inp.charId) : null;
    const a = {
      id: h('input', { value: existing?.id || '', placeholder: '영문 id 예: ssr_lumi', disabled: !!existing }),
      name: h('input', { value: existing?.name || inp.name }),
      rarity: h('select', {}, RARITIES.map((r) => h('option', { value: r }, r))),
      title: h('input', { value: existing?.title || inp.title }),
      description: h('textarea', { rows: 4 }, existing?.description || ''),
      feedback: h('input', { placeholder: '소개문 수정 요청 (예: 더 귀엽게, 존댓말로)' }),
      addedAt: h('input', { type: 'datetime-local', value: isoToLocal(existing?.addedAt || nowIso()) }),
    };
    a.rarity.value = existing?.rarity || inp.rarity;
    if (!existing) a.id.value = `${inp.rarity.toLowerCase()}_`;

    const writeDesc = async (withFeedback) => {
      const r = await busy('소개문 쓰는 중…', () =>
        tryApi(() =>
          api.post('/api/char/describe', {
            name: a.name.value,
            rarity: a.rarity.value,
            title: a.title.value,
            keywords: inp.keywords,
            lore: inp.lore,
            current: withFeedback ? a.description.value : '',
            feedback: withFeedback ? a.feedback.value : '',
          }),
        ),
      );
      if (r) a.description.value = r.description;
    };

    const extra = h(
      'div',
      { class: 'approve-form' },
      h('h3', {}, '승인할 때 저장할 정보'),
      h(
        'div',
        { class: 'grid2' },
        h('label', { class: 'field' }, 'id (파일 이름, 바꾸지 않기)', a.id),
        h('label', { class: 'field' }, '이름', a.name),
        h('label', { class: 'field' }, '희귀도', a.rarity),
        h('label', { class: 'field' }, '칭호', a.title),
      ),
      h('label', { class: 'field' }, '소개문', a.description),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => writeDesc(false) }, 'AI로 소개문 쓰기'),
        a.feedback,
        h('button', { class: 'btn small', onclick: () => writeDesc(true) }, '요청 반영해서 다시 쓰기'),
      ),
      h('label', { class: 'field' }, '공개 시각 addedAt (KST) — 이 시각 전에는 게임에 안 나옴 (픽업 데뷔용)', a.addedAt),
    );

    const panel = jobPanel(job, {
      approveLabel: existing ? '그림 교체 승인' : '승인 → 캐릭터 추가',
      approveExtra: extra,
      onApprove: async (n) => {
        const id = a.id.value.trim();
        if (!slugOk(id) || id.endsWith('_')) {
          toast('id를 영문/숫자/_/-로 정해 주세요 (예: ssr_lumi)', 'error');
          return false;
        }
        const r = await tryApi(() =>
          api.post('/api/char/approve', {
            jobId: job.id,
            attempt: n,
            character: { id, name: a.name.value, rarity: a.rarity.value, title: a.title.value, description: a.description.value, addedAt: localToIso(a.addedAt.value) },
          }),
        );
        if (!r) return false;
        await reloadData();
        renderList();
        setReplacing(null);
        right.prepend(deployHint(r.character));
        toast(r.created ? `「${r.character.name}」 추가 완료` : `「${r.character.name}」 그림 교체 완료`, 'success');
        return true;
      },
    });
    activeJob = panel;
    right.replaceChildren(panel.el);
    right.scrollTop = 0;
  }

  function deployHint(c) {
    return h(
      'div',
      { class: 'hint' },
      h('b', {}, `✓ 「${c.name}」 저장 완료 (작업 공간)`),
      h('p', {}, '게임에 공개하려면: ', h('b', {}, '배포 탭'), ' → 검사 → 배포하기 → 아래 명령으로 GitHub에 올리기'),
      h('pre', {}, 'git add data assets\ngit commit -m "새 캐릭터 추가"\ngit push'),
      h('button', { class: 'btn small', onclick: () => openPreview() }, '게임 미리보기'),
    );
  }

  // ── 기존 캐릭터 목록 ──
  const list = h('div', { class: 'char-list' });
  const jobsBox = h('div', { class: 'jobs-box' });

  function renderList() {
    const order = { SSR: 0, SR: 1, R: 2 };
    const chars = [...state.data.characters].sort((x, y) => order[x.rarity] - order[y.rarity] || x.id.localeCompare(y.id));
    list.replaceChildren(
      ...chars.map((c) =>
        h(
          'div',
          { class: `char-item r-${c.rarity}` },
          h('div', { class: 'thumb checker' }, c.image ? h('img', { src: wsImage(c.image), alt: '', onerror: (e) => e.target.remove() }) : h('span', {}, '그림 없음')),
          h('div', { class: 'grow' }, h('b', {}, `${c.name} `), h('span', { class: `chip r-${c.rarity}` }, c.rarity), h('div', { class: 'muted small' }, `${c.id} · ${c.title || ''}`)),
          h(
            'div',
            { class: 'col-buttons' },
            h('button', { class: 'btn small', onclick: () => editChar(c) }, '정보 수정'),
            h('button', { class: 'btn small', onclick: () => setReplacing(c) }, '그림 교체'),
            h('button', { class: 'btn small danger-outline', onclick: () => deleteChar(c) }, '삭제'),
          ),
        ),
      ),
    );
  }

  async function renderJobs() {
    const items = (await tryApi(() => api.get('/api/jobs?kind=char'))) || [];
    jobsBox.replaceChildren(
      ...items.slice(0, 12).map((j) =>
        h(
          'button',
          { class: 'job-item', onclick: async () => openJob(await api.get(`/api/jobs/${j.id}`)) },
          j.thumb && h('img', { class: 'checker', src: `/history/${j.id}/${j.thumb}` }),
          h('span', {}, `${j.label} · ${j.attempts}회${j.status === 'approved' ? ' ✓' : ''}`),
        ),
      ),
      ...(items.length ? [] : [h('p', { class: 'muted small' }, '아직 기록이 없어요')]),
    );
  }

  async function editChar(c) {
    const e = {
      name: h('input', { value: c.name }),
      rarity: h('select', {}, RARITIES.map((r) => h('option', { value: r }, r))),
      title: h('input', { value: c.title || '' }),
      description: h('textarea', { rows: 5 }, c.description || ''),
      feedback: h('input', { placeholder: '수정 요청 (예: 더 짧게)' }),
      addedAt: h('input', { type: 'datetime-local', value: isoToLocal(c.addedAt) }),
    };
    e.rarity.value = c.rarity;
    const rewrite = async () => {
      const r = await busy('소개문 다시 쓰는 중…', () =>
        tryApi(() => api.post('/api/char/describe', { name: e.name.value, rarity: e.rarity.value, title: e.title.value, current: e.description.value, feedback: e.feedback.value })),
      );
      if (r) e.description.value = r.description;
    };
    const ok = await modal({
      title: `캐릭터 수정 — ${c.id}`,
      body: h(
        'div',
        {},
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '이름', e.name), h('label', { class: 'field' }, '희귀도', e.rarity), h('label', { class: 'field' }, '칭호', e.title), h('label', { class: 'field' }, '공개 시각 (KST)', e.addedAt)),
        h('label', { class: 'field' }, '소개문', e.description),
        h('div', { class: 'row' }, e.feedback, h('button', { class: 'btn small', onclick: rewrite }, 'AI로 다시 쓰기')),
      ),
      buttons: [
        { label: '취소', value: null },
        { label: '저장', value: 'save', primary: true },
      ],
    });
    if (ok !== 'save') return;
    const r = await tryApi(() =>
      api.put(`/api/characters/${c.id}`, { name: e.name.value, rarity: e.rarity.value, title: e.title.value, description: e.description.value, addedAt: localToIso(e.addedAt.value) }),
    );
    if (r) {
      await reloadData();
      renderList();
      toast('저장했어요', 'success');
    }
  }

  async function deleteChar(c) {
    const refs = (await tryApi(() => api.get(`/api/characters/${c.id}/refs`))) || [];
    const msg = refs.length ? `이 캐릭터를 쓰는 곳이 있어요:\n- ${refs.join('\n- ')}\n\n그래도 삭제하면 검사에서 오류가 나요.` : '그림 파일은 dev/trash로 옮겨져요.';
    if (!(await confirmBox(`「${c.name}」 삭제`, msg, { ok: '삭제', danger: true }))) return;
    const r = await tryApi(() => api.del(`/api/characters/${c.id}${refs.length ? '?force=1' : ''}`));
    if (r) {
      await reloadData();
      renderList();
      toast('삭제했어요');
    }
  }

  left.append(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '새 캐릭터 만들기'),
      replaceNote,
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, '이름', f.name), h('label', { class: 'field' }, '희귀도', f.rarity)),
      h('label', { class: 'field' }, '칭호', f.title),
      h('label', { class: 'field' }, '외형 키워드 (그림에 반영)', f.keywords),
      h('label', { class: 'field' }, '설정 메모 (표정/포즈 참고, 소개문 재료)', f.lore),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: generate }, '생성'), h('button', { class: 'btn', onclick: () => setReplacing(null) }, '새로 입력')),
      h('p', { class: 'muted small' }, '공통 스타일(dev/style.txt)이 모든 프롬프트 뒤에 붙어요.'),
    ),
    h('section', { class: 'card' }, h('h2', {}, `캐릭터 (${state.data.characters.length})`), list),
    h('section', { class: 'card' }, h('h2', {}, '최근 생성 기록'), jobsBox),
  );
  right.append(h('div', { class: 'empty' }, '왼쪽에서 캐릭터를 생성하거나 최근 기록을 열면 여기서 검토해요.'));
  renderList();
  renderJobs();
  return { refresh: () => (renderList(), renderJobs()) };
}
