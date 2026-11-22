// 캐릭터 탭: 생성 → 검토(원본/배경 제거) → 승인/거절/다시 생성, 소개문 AI 작성, 기존 캐릭터 수정/삭제
import { h, toast, modal, confirmBox, busy, wsImage, nowIso, isoToLocal, localToIso, rarOf, rarLabel, raritySelect, idBadge, gradeOf, rarRank, NPC } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { openPreview } from '../preview.js';
import { promptStep } from '../promptStep.js';
import { openCharBattleEditor } from '../battleEditor.js';

export function charactersTab(root) {
  let activeJob = null; // 지금 검토 중인 작업
  const left = h('div', { class: 'col-left' });
  const right = h('div', { class: 'col-right' });
  root.replaceChildren(h('div', { class: 'two-col' }, left, right));

  // ── 생성 폼 ──
  const f = {
    name: h('input', { placeholder: '예: 루미' }),
    rarity: raritySelect(3),
    title: h('input', { placeholder: '예: 별을 엮는 무녀' }),
    keywords: h('textarea', { rows: 3, placeholder: '예: 은발 긴 머리, 별 장식 머리핀, 남색 무녀복, 금색 눈' }),
    lore: h('textarea', { rows: 3, placeholder: '예: 별빛을 실처럼 엮어 소원을 들어주는 무녀. 단 것을 좋아함' }),
  };
  let replacingId = null;
  const replaceNote = h('p', { class: 'note', hidden: true });

  // 입력값 확인 → Gemini가 그림 프롬프트 작성 → (확인/수정) → ComfyUI로 생성
  const charInput = () => {
    const payload = { name: f.name.value.trim(), rarity: rarOf(f.rarity.value), title: f.title.value, keywords: f.keywords.value.trim(), lore: f.lore.value, charId: replacingId };
    if (!payload.name) return toast('이름을 입력해 주세요', 'error'), null;
    if (!payload.keywords) return toast('외형 키워드를 입력해 주세요', 'error'), null;
    return payload;
  };
  const step = promptStep({
    kind: 'char',
    getInput: charInput,
    generateLabel: '그림 뽑기',
    generate: async (gen) => {
      const job = await tryApi(() => api.post('/api/char/generate', { ...charInput(), ...gen }));
      if (job) openJob(job);
    },
  });

  function setReplacing(c) {
    replacingId = c?.id || null;
    replaceNote.hidden = !c;
    replaceNote.textContent = c ? `「${c.name}」(${c.id})의 그림을 교체합니다. 승인하면 기존 그림을 덮어써요.` : '';
    if (c) {
      f.name.value = c.name;
      f.rarity.value = String(gradeOf(c));
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
      name: h('input', { value: existing?.name || inp.name }),
      rarity: raritySelect(existing ? gradeOf(existing) : inp.rarity),
      title: h('input', { value: existing?.title || inp.title }),
      description: h('textarea', { rows: 4 }, existing?.description || ''),
      feedback: h('input', { placeholder: '소개문 수정 요청 (예: 더 귀엽게, 존댓말로)' }),
      addedAt: h('input', { type: 'datetime-local', value: isoToLocal(existing?.addedAt || nowIso()) }),
    };

    const writeDesc = async (withFeedback) => {
      const r = await busy('소개문 쓰는 중…', () =>
        tryApi(() =>
          api.post('/api/char/describe', {
            name: a.name.value,
            rarity: rarOf(a.rarity.value),
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
        h('div', { class: 'field' }, 'id', idBadge(existing?.id, '승인하면 자동으로 정해져요 (char_0001 …)')),
        h('label', { class: 'field' }, '이름', a.name),
        h('label', { class: 'field' }, '등급', a.rarity),
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
        // id는 서버가 정함 (그림 교체면 그 캐릭터, 새 캐릭터면 새 id)
        const r = await tryApi(() =>
          api.post('/api/char/approve', {
            jobId: job.id,
            attempt: n,
            character: { name: a.name.value, rarity: rarOf(a.rarity.value), title: a.title.value, description: a.description.value, addedAt: localToIso(a.addedAt.value) },
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
    const chars = [...state.data.characters].sort((x, y) => rarRank(gradeOf(y)) - rarRank(gradeOf(x)) || x.id.localeCompare(y.id));
    list.replaceChildren(
      ...chars.map((c) =>
        h(
          'div',
          { class: `char-item r-${gradeOf(c)}` },
          h('div', { class: 'thumb checker' }, c.image ? h('img', { src: wsImage(c.image), alt: '', onerror: (e) => e.target.remove() }) : h('span', {}, '그림 없음')),
          h(
            'div',
            { class: 'grow' },
            h('b', {}, `${c.name} `),
            h('span', { class: `chip r-${gradeOf(c)}` }, rarLabel(gradeOf(c))),
            ' ',
            gradeOf(c) === NPC
              ? linkedEnemies(c).map((e) => h('a', { class: 'chip', href: `#enemies/${e.id}`, title: '이 NPC와 연결된 적' }, `적: ${e.name}`))
              : c.kit
                ? h('span', { class: 'chip ok', title: `돌파 능력 ${(c.breakthroughs || []).length}개` }, `전투 ✓ 돌파 ${(c.breakthroughs || []).length}`)
                : h('span', { class: 'chip warn' }, '기본 스킬'),
            h('div', { class: 'muted small' }, `${c.id} · ${c.title || ''}`),
          ),
          h(
            'div',
            { class: 'col-buttons' },
            gradeOf(c) !== NPC && h('button', { class: 'btn small', onclick: () => openCharBattleEditor(c, { onSaved: renderList }) }, '전투 데이터'),
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

  /** 이 NPC와 연결된 적 (적 탭 'NPC 연결') */
  const linkedEnemies = (c) => (state.data.enemies || []).filter((e) => e.charId === c.id);

  /** 등급을 바꿀 때 확인: NPC ↔ 1–5 (가챠 풀/로테이션/도감에 들어가거나 빠짐) */
  async function confirmGradeChange(c, next) {
    const prev = gradeOf(c);
    if (prev === next || (prev !== NPC && next !== NPC)) return true;
    if (next === NPC) {
      const pickups = (state.data.banners || []).filter((b) => (b.pickupIds || []).includes(c.id)).map((b) => `「${b.title}」`);
      const msg =
        `「${c.name}」을(를) NPC로 바꾸면 뽑기(상시/픽업/로테이션)와 도감·육성·편성에서 빠져요.\n` +
        `이미 이 캐릭터를 가진 플레이어도 화면에서 볼 수 없게 돼요 (세이브 기록은 보관 → 다시 등급을 바꾸면 그대로 돌아와요).\n` +
        `뽑기에서만 빼고 가진 사람은 계속 쓰게 하려면 NPC 대신 '은퇴'를 써 주세요.` +
        (pickups.length ? `\n\n픽업 배너 ${pickups.join(', ')}에 들어 있어요 → 배포 전에 픽업에서 빼야 해요 (검사 오류).` : '');
      return confirmBox('NPC로 바꾸기', msg, { ok: 'NPC로 바꾸기' });
    }
    const msg = `「${c.name}」이(가) ${rarLabel(next)} 캐릭터로 뽑기(상시/로테이션)와 도감에 들어가요.${c.image ? '' : '\n그림이 아직 없어요 → 배포 검사에서 경고가 나요.'}${c.kit ? '' : '\n전투 데이터가 없어서 기본 스킬을 써요.'}`;
    return confirmBox('뽑기 캐릭터로 바꾸기', msg, { ok: '바꾸기' });
  }

  async function editChar(c) {
    const e = {
      name: h('input', { value: c.name }),
      rarity: raritySelect(gradeOf(c)),
      title: h('input', { value: c.title || '' }),
      description: h('textarea', { rows: 5 }, c.description || ''),
      feedback: h('input', { placeholder: '수정 요청 (예: 더 짧게)' }),
      addedAt: h('input', { type: 'datetime-local', value: isoToLocal(c.addedAt) }),
    };
    const rewrite = async () => {
      const r = await busy('소개문 다시 쓰는 중…', () =>
        tryApi(() => api.post('/api/char/describe', { name: e.name.value, rarity: rarOf(e.rarity.value), title: e.title.value, current: e.description.value, feedback: e.feedback.value })),
      );
      if (r) e.description.value = r.description;
    };
    const ok = await modal({
      title: `캐릭터 수정 — ${c.id}`,
      body: h(
        'div',
        {},
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '이름', e.name), h('label', { class: 'field' }, '등급', e.rarity), h('label', { class: 'field' }, '칭호', e.title), h('label', { class: 'field' }, '공개 시각 (KST)', e.addedAt)),
        h('label', { class: 'field' }, '소개문', e.description),
        h('div', { class: 'row' }, e.feedback, h('button', { class: 'btn small', onclick: rewrite }, 'AI로 다시 쓰기')),
      ),
      buttons: [
        { label: '취소', value: null },
        { label: '저장', value: 'save', primary: true },
      ],
    });
    if (ok !== 'save') return;
    if (!(await confirmGradeChange(c, rarOf(e.rarity.value)))) return;
    const r = await tryApi(() =>
      api.put(`/api/characters/${c.id}`, { name: e.name.value, rarity: rarOf(e.rarity.value), title: e.title.value, description: e.description.value, addedAt: localToIso(e.addedAt.value) }),
    );
    if (r) {
      await reloadData();
      renderList();
      toast('저장했어요', 'success');
    }
  }

  async function deleteChar(c) {
    const refs = (await tryApi(() => api.get(`/api/characters/${c.id}/refs`))) || [];
    const after = `\n\n배포하면 공개 그림도 지워져요. 이 캐릭터를 가진 플레이어에게는 어디에도 보이지 않게 정리되고(세이브 기록은 보관), 같은 id(${c.id})는 다시 쓸 수 없어요. 그림 파일은 dev/trash로 옮겨져요.`;
    const msg = (refs.length ? `이 캐릭터를 쓰는 곳이 있어요:\n- ${refs.join('\n- ')}\n\n그래도 삭제하면 검사에서 오류가 나서 고칠 때까지 배포할 수 없어요.` : '삭제할까요?') + after;
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
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, '이름', f.name), h('label', { class: 'field' }, '등급', f.rarity)),
      h('p', { class: 'muted small' }, 'NPC 등급: 뽑기/도감/육성/편성에 안 나오고 스토리 화자나 적(적 탭의 NPC 연결)으로만 나와요. 나중에 등급을 바꾸면 가챠 풀에 바로 들어가요/빠져요.'),
      h('label', { class: 'field' }, '칭호', f.title),
      h('label', { class: 'field' }, '외형 키워드 (그림에 반영)', f.keywords),
      h('label', { class: 'field' }, '설정 메모 (표정/포즈 참고, 소개문 재료)', f.lore),
      step.el,
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => (setReplacing(null), step.reset()) }, '새로 입력')),
      h('p', { class: 'muted small' }, 'Anima 캐릭터 규칙: 배경 없는 전신, 성격에 맞는 포즈. 공통 스타일(dev/style.txt)이 모든 프롬프트 뒤에 붙어요.'),
    ),
    h('section', { class: 'card' }, h('h2', {}, `캐릭터 (${state.data.characters.length})`), list),
    h('section', { class: 'card' }, h('h2', {}, '최근 생성 기록'), jobsBox),
  );
  right.append(h('div', { class: 'empty' }, '왼쪽에서 캐릭터를 생성하거나 최근 기록을 열면 여기서 검토해요.'));
  renderList();
  renderJobs();
  return { refresh: () => (renderList(), renderJobs()) };
}
