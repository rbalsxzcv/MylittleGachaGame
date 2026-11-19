// 배너 탭: 픽업 캐릭터 고르기, 기간(KST), 키 아트 생성(승인/거절/다시 생성), 관련 스토리, 게임 화면 미리보기
import { h, toast, confirmBox, busy, dateField, wsImage, slugOk, fmt } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, saveList, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { openPreview } from '../preview.js';

const blank = () => ({ id: '', title: '', type: 'pickup', pickupIds: [], startAt: null, endAt: null, bannerImage: '', description: '', relatedStoryId: null });

export function bannersTab(root, { select } = {}) {
  let selectedId = select || null;
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  root.replaceChildren(
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'col-left' }, h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, '배너'), h('button', { class: 'btn primary small', onclick: () => edit(null) }, '+ 새 배너')), list)),
      editor,
    ),
  );

  function status(b) {
    const now = Date.now();
    const s = b.startAt ? Date.parse(b.startAt) : -Infinity;
    const e = b.endAt ? Date.parse(b.endAt) : Infinity;
    if (now < s) return ['예정', 'warn'];
    if (now >= e) return ['종료', ''];
    return ['진행 중', 'ok'];
  }

  function renderList() {
    const items = [...state.data.banners].sort((a, b) => (Date.parse(a.startAt || 0) || 0) - (Date.parse(b.startAt || 0) || 0));
    list.replaceChildren(
      ...items.map((b) => {
        const [label, cls] = status(b);
        return h(
          'button',
          { class: ['list-item', b.id === selectedId && 'active'], onclick: () => edit(b) },
          h('div', {}, h('b', {}, b.title), ' ', h('span', { class: `chip ${cls}` }, label), ' ', h('span', { class: 'chip' }, b.type === 'pickup' ? '픽업' : '상시')),
          h('div', { class: 'muted small' }, `${fmt(b.startAt)} ~ ${fmt(b.endAt)}`),
        );
      }),
      ...(items.length ? [] : [h('p', { class: 'muted' }, '배너가 없어요')]),
    );
  }

  function edit(b) {
    const isNew = !b;
    const v = structuredClone(b || blank());
    selectedId = v.id || null;
    renderList();

    const id = h('input', { value: v.id, placeholder: '예: pickup_lumi_2612', disabled: !isNew });
    const title = h('input', { value: v.title });
    const type = h('select', {}, h('option', { value: 'pickup' }, '픽업'), h('option', { value: 'standard' }, '상시'));
    type.value = v.type;
    const start = dateField('시작', v.startAt);
    const end = dateField('종료 (이 시각에 끝남)', v.endAt);
    const desc = h('textarea', { rows: 3 }, v.description);
    const related = h('select', {}, h('option', { value: '' }, '(없음)'), state.data.storyIndex.map((s) => h('option', { value: s.id }, `[${s.kind}] ${s.title}`)));
    related.value = v.relatedStoryId || '';
    const image = h('input', { value: v.bannerImage, placeholder: 'assets/banners/<id>.jpg (그림 승인 시 자동 입력)' });
    const imgPreview = h('div', { class: 'banner-preview' });
    const showImg = () => imgPreview.replaceChildren(image.value ? h('img', { src: wsImage(image.value), onerror: (e) => e.target.replaceWith(h('span', { class: 'muted' }, '파일 없음')) }) : h('span', { class: 'muted' }, '그림 없음 (게임에서는 기본 그라데이션)'));
    image.oninput = showImg;
    showImg();

    // 픽업 캐릭터 선택
    const picked = new Set(v.pickupIds);
    const pickGrid = h(
      'div',
      { class: 'pick-grid' },
      state.data.characters.map((c) => {
        const cb = h('input', { type: 'checkbox', checked: picked.has(c.id), onchange: (e) => (e.target.checked ? picked.add(c.id) : picked.delete(c.id)) });
        return h('label', { class: `pick r-${c.rarity}` }, cb, h('div', { class: 'thumb checker' }, c.image ? h('img', { src: wsImage(c.image), onerror: (e) => e.target.remove() }) : ''), h('span', {}, `${c.name} (${c.rarity})`));
      }),
    );
    const pickWrap = h('div', {}, h('div', { class: 'label' }, '픽업 캐릭터 (SSR이 나오면 50% 확률로 픽업)'), pickGrid);
    const syncType = () => (pickWrap.hidden = type.value !== 'pickup');
    type.onchange = syncType;
    syncType();

    // 키 아트 생성
    const extra = h('input', { placeholder: '추가 연출 (예: 밤하늘 축제 등불, 따뜻한 분위기)' });
    const jobArea = h('div');
    async function genArt() {
      if (!collect(false)) return;
      const job = await busy('배너 그림 생성 중… (픽업 캐릭터 그림을 참고 이미지로 사용)', () =>
        tryApi(() => api.post('/api/banner/generate', { bannerId: id.value.trim(), title: title.value, description: desc.value, pickupIds: [...picked], extra: extra.value })),
      );
      if (!job) return;
      const panel = jobPanel(job, {
        approveLabel: '이 그림을 배너에 사용',
        onApprove: async (n) => {
          // 배너가 아직 저장 전이면 먼저 저장해야 그림 경로가 연결됨
          if (!(await save(true))) return false;
          const r = await tryApi(() => api.post(`/api/jobs/${job.id}/approve-image`, { attempt: n }));
          if (!r) return false;
          image.value = r.path;
          showImg();
          await reloadData();
          toast('배너 그림을 저장했어요', 'success');
          return true;
        },
      });
      jobArea.replaceChildren(panel.el);
    }

    function collect(strict = true) {
      const data = {
        id: id.value.trim(),
        title: title.value.trim(),
        type: type.value,
        pickupIds: type.value === 'pickup' ? [...picked] : [],
        startAt: start.get(),
        endAt: end.get(),
        bannerImage: image.value.trim(),
        description: desc.value,
        relatedStoryId: related.value || null,
      };
      if (!slugOk(data.id)) return toast('id를 영문/숫자/_/-로 정해 주세요', 'error'), null;
      if (strict && !data.title) return toast('제목을 입력해 주세요', 'error'), null;
      if (isNew && state.data.banners.some((x) => x.id === data.id) && data.id !== selectedId) return toast('이미 있는 id예요', 'error'), null;
      if (data.startAt && data.endAt && Date.parse(data.startAt) >= Date.parse(data.endAt)) return toast('시작이 종료보다 늦어요', 'error'), null;
      return data;
    }

    async function save(quiet = false) {
      const data = collect();
      if (!data) return false;
      const items = state.data.banners.filter((x) => x.id !== data.id);
      const idx = state.data.banners.findIndex((x) => x.id === data.id);
      idx >= 0 ? items.splice(idx, 0, data) : items.push(data);
      const ok = await tryApi(() => saveList('banners', items));
      if (ok === null) return false;
      selectedId = data.id;
      renderList();
      if (!quiet) toast('배너를 저장했어요 (작업 공간)', 'success');
      if (isNew) id.disabled = true;
      return true;
    }

    async function remove() {
      if (!(await confirmBox('배너 삭제', `「${v.title || v.id}」를 삭제할까요?`, { ok: '삭제', danger: true }))) return;
      await tryApi(() => saveList('banners', state.data.banners.filter((x) => x.id !== v.id)));
      selectedId = null;
      renderList();
      editor.replaceChildren(h('div', { class: 'empty' }, '삭제했어요'));
    }

    async function preview() {
      if (!(await save(true))) return;
      // 아직 시작 전이면 시작 1분 뒤로 시간 이동해서 미리보기
      const s = start.get();
      const now = s && Date.parse(s) > Date.now() ? new Date(Date.parse(s) + 60000).toISOString() : null;
      openPreview({ banner: id.value.trim(), now });
    }

    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, isNew ? '새 배너' : `배너 편집 — ${v.id}`),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'id (바꾸지 않기)', id), h('label', { class: 'field' }, '종류', type)),
        h('label', { class: 'field' }, '제목', title),
        h('div', { class: 'grid2' }, start.el, end.el),
        pickWrap,
        h('label', { class: 'field' }, '설명 (배너 화면과 상세에 표시)', desc),
        h('label', { class: 'field' }, '관련 이벤트 스토리', related),
        h('label', { class: 'field' }, '배너 그림 경로', image),
        imgPreview,
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn primary', onclick: () => save() }, '저장'),
          h('button', { class: 'btn', onclick: preview }, '게임 화면으로 미리보기'),
          !isNew && h('button', { class: 'btn danger-outline', onclick: remove }, '삭제'),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '키 아트 생성 (Vertex AI)'),
        h('p', { class: 'muted small' }, '픽업 캐릭터의 승인된 그림과 소개문을 참고해서 16:9 그림을 만들어요. 공통 스타일: dev/style_banner.txt'),
        h('div', { class: 'row' }, extra, h('button', { class: 'btn', onclick: genArt }, '그림 생성')),
        jobArea,
      ),
    );
  }

  renderList();
  const first = selectedId && state.data.banners.find((b) => b.id === selectedId);
  if (first) edit(first);
  else editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 배너를 고르거나 새 배너를 만들어 주세요.'));
  return { refresh: renderList };
}
