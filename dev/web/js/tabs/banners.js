// 배너 탭: 픽업 캐릭터 고르기, 기간(KST), 키 아트 생성(승인/거절/다시 생성), 관련 스토리, 게임 화면 미리보기
// 추억 배너: 목록의 '+ 추억 배너' 또는 캐릭터 픽업 배너의 '이 배너의 추억 배너 만들기'(pickupFrom = 그 배너) — 그림은 픽업 추억의 주인 캐릭터 · 추억 장면으로
import { h, toast, confirmBox, busy, dateField, wsImage, fmt, nowIso, rarOf, rarLabel, raritySelect, idBadge, gradeOf, isNpc } from '../ui.js';
import { api, tryApi, newId } from '../api.js';
import { state, saveList, reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { openPreview } from '../preview.js';
import { promptStep } from '../promptStep.js';

const blank = () => ({ id: '', title: '', type: 'pickup', pickupIds: [], startAt: null, endAt: null, bannerImage: '', description: '', relatedStoryId: null });

export function bannersTab(root, { select } = {}) {
  let selectedId = select || null;
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  root.replaceChildren(
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'col-left' }, h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, '배너'), h('div', { class: 'row' }, h('button', { class: 'btn primary small', onclick: () => edit(null) }, '+ 새 배너'), h('button', { class: 'btn small', onclick: () => edit(null, { category: 'memory' }) }, '+ 추억 배너'))), list)),
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
          h('div', {}, h('b', {}, b.title), ' ', h('span', { class: `chip ${cls}` }, label), ' ', b.category === 'memory' && h('span', { class: 'chip ok' }, '추억'), ' ', h('span', { class: 'chip' }, b.rotation ? `로테이션 ${rarLabel(b.rotation.rarity)} ${b.rotation.count}명/${b.rotation.days}일` : b.type === 'pickup' ? '픽업' : '상시')),
          h('div', { class: 'muted small' }, `${fmt(b.startAt)} ~ ${fmt(b.endAt)}`),
        );
      }),
      ...(items.length ? [] : [h('p', { class: 'muted' }, '배너가 없어요')]),
    );
  }

  /** b = null이면 새 배너 (preset: 처음 값 — 추억 배너 초안 등) */
  function edit(b, preset = null) {
    const isNew = !b;
    const v = structuredClone(b || { ...blank(), ...(preset || {}) });
    selectedId = v.id || null;
    renderList();

    // id는 자동 (banner_0001 …): 처음 저장하거나 그림을 뽑을 때 발급
    let bid = v.id || '';
    const id = h('div', {}, idBadge(bid));
    const ensureId = async () => {
      if (!bid) {
        bid = (await tryApi(() => newId('banner'))) || '';
        id.replaceChildren(idBadge(bid));
      }
      return bid;
    };
    const title = h('input', { value: v.title });
    const type = h('select', {}, h('option', { value: 'pickup' }, '픽업'), h('option', { value: 'standard' }, '상시'));
    type.value = v.type;
    // 종류: 캐릭터 뽑기 / 추억 뽑기 (추억은 따로 천장 · balance.memoryGacha 확률)
    const category = h('select', {}, h('option', { value: 'character' }, '캐릭터 뽑기'), h('option', { value: 'memory' }, '추억 뽑기'));
    category.value = v.category === 'memory' ? 'memory' : 'character';
    const charBanners = state.data.banners.filter((b) => b.category !== 'memory' && b.type === 'pickup' && b.id !== v.id);
    const pickupFrom = h('select', {}, h('option', { value: '' }, '(직접 고르기)'), charBanners.map((b) => h('option', { value: b.id }, `${b.title} — 그 픽업 캐릭터의 전용 추억 (자동)`)));
    pickupFrom.value = v.pickupFrom || '';
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

    // 픽업 선택: 캐릭터 / 추억 따로 (그림 요청 · 저장에 섞이지 않게)
    const isMemId = (id) => String(id).startsWith('memory_');
    const pickedChars = new Set((v.pickupIds || []).filter((id) => !isMemId(id)));
    const pickedMems = new Set((v.pickupIds || []).filter(isMemId));
    const memories = state.data.memories || [];
    // 빈 칸(draft) · 은퇴 추억은 뽑기에 안 나와서 후보에서 뺌 (이미 골라져 있으면 빼낼 수 있게 ⚠와 함께)
    const memChecks = new Map();
    const memGrid = h(
      'div',
      { class: 'pick-grid' },
      [...memories]
        .filter((m) => (m.draft !== true && !m.retired) || pickedMems.has(m.id))
        .sort((a, b) => (b.kind === 'signature') - (a.kind === 'signature') || b.rarity - a.rarity)
        .map((m) => {
          const cb = h('input', { type: 'checkbox', checked: pickedMems.has(m.id), onchange: (e) => (e.target.checked ? pickedMems.add(m.id) : pickedMems.delete(m.id)) });
          memChecks.set(m.id, cb);
          const owner = m.signatureOf && state.data.characters.find((c) => c.id === m.signatureOf);
          const bad = m.draft === true ? '빈 칸' : m.retired ? '은퇴' : '';
          return h('label', { class: ['pick', `r-${m.rarity}`, bad && 'is-npc'], title: bad ? `${bad} 추억은 뽑기에 안 나와요 → 픽업에서 빼 주세요` : '' }, cb, h('div', { class: 'thumb checker' }, m.thumb || m.image ? h('img', { src: wsImage(m.thumb || m.image), onerror: (e) => e.target.remove() }) : '✦'), h('span', {}, `${m.name} (${m.rarity}★)${owner ? ` · ${owner.name} 전용` : ''}${bad ? ` ⚠${bad}` : ''}`));
        }),
    );
    const syncFromChars = h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        onclick: () => {
          const from = state.data.banners.find((b) => b.id === pickupFrom.value) || charBanners[0];
          if (!from) return toast('픽업 캐릭터 배너가 없어요', 'error');
          const ids = memories.filter((m) => m.signatureOf && m.draft !== true && !m.retired && (from.pickupIds || []).includes(m.signatureOf)).map((m) => m.id);
          pickedMems.clear();
          ids.forEach((id) => pickedMems.add(id));
          for (const [id, cb] of memChecks) cb.checked = pickedMems.has(id);
          toast(ids.length ? `「${from.title}」 픽업의 전용 추억 ${ids.length}장을 골랐어요` : '그 배너의 픽업 캐릭터에게 (완성된) 전용 추억이 없어요', ids.length ? 'success' : 'error');
        },
      },
      '캐릭터 픽업과 맞추기',
    );
    const pickGrid = h(
      'div',
      { class: 'pick-grid' },
      // NPC 등급은 뽑기에 안 나와서 픽업 후보에서 뺌 (이미 골라져 있으면 빼낼 수 있게 경고와 함께 보여 줌)
      state.data.characters
        .filter((c) => !isNpc(c) || pickedChars.has(c.id))
        .map((c) => {
          const cb = h('input', { type: 'checkbox', checked: pickedChars.has(c.id), onchange: (e) => (e.target.checked ? pickedChars.add(c.id) : pickedChars.delete(c.id)) });
          const npc = isNpc(c);
          return h('label', { class: ['pick', `r-${gradeOf(c)}`, npc && 'is-npc'], title: npc ? 'NPC 등급이라 뽑기에 안 나와요 → 픽업에서 빼 주세요' : '' }, cb, h('div', { class: 'thumb checker' }, c.image ? h('img', { src: wsImage(c.image), onerror: (e) => e.target.remove() }) : ''), h('span', {}, `${c.name} (${rarLabel(gradeOf(c))})${npc ? ' ⚠' : ''}`));
        }),
    );
    // 자동 로테이션: 최고 등급 캐릭터 N명이 기간마다 돌아가며 픽업
    const rot = v.rotation || { rarity: 5, count: 2, days: 7, anchor: null };
    const rotOn = h('input', { type: 'checkbox', checked: !!v.rotation });
    const rotRarity = raritySelect(rot.rarity, { npc: false });
    const rotCount = h('input', { type: 'number', class: 'small-input', min: 1, max: 4, value: rot.count });
    const rotDays = h('input', { type: 'number', class: 'small-input', min: 1, max: 60, value: rot.days });
    const rotAnchor = dateField('로테이션 기준 시각 (이 시각부터 기간마다 교대)', rot.anchor || nowIso(), { allowEmpty: false });
    const rotPreview = h('div', { class: 'muted small' });
    const rotation = () => ({ rarity: rarOf(rotRarity.value), count: Math.min(4, Math.max(1, parseInt(rotCount.value, 10) || 2)), days: Math.min(60, Math.max(1, parseInt(rotDays.value, 10) || 7)), anchor: rotAnchor.get() });
    async function showRotation() {
      const { rotationSchedule } = await import('/preview/js/systems/banners.js');
      const list = rotationSchedule({ ...v, rotation: rotation() }, state.data.characters, 4, new Date());
      const name = (id) => state.data.characters.find((c) => c.id === id)?.name || id;
      rotPreview.replaceChildren(
        ...(list.length
          ? [h('b', {}, '앞으로의 로테이션 '), h('ul', { class: 'warn-list' }, list.map((r, i) => h('li', {}, `${i === 0 ? '지금' : `${i}번 뒤`} · ${fmt(r.startAt)} ~ ${fmt(r.endAt)} · ${r.pickupIds.map(name).join(', ')}`)))]
          : [h('span', { class: 'error' }, `뽑을 수 있는 ${rotRarity.value} 캐릭터가 없어서 배너가 숨겨져요`)]),
      );
    }
    for (const el of [rotRarity, rotCount, rotDays, rotAnchor.el]) el.addEventListener('change', showRotation);
    const rotBox = h(
      'div',
      { class: 'card inner' },
      h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, '희귀도', rotRarity), h('label', { class: 'inline' }, '한 번에', rotCount, '명'), h('label', { class: 'inline' }, rotDays, '일마다 교대')),
      rotAnchor.el,
      h('p', { class: 'muted small' }, '대상은 그 희귀도의 뽑을 수 있는 캐릭터 전체 (공개 시각 → id 순서). 새 캐릭터가 추가되면 자동으로 순서에 들어가요. 남은 시간은 지금 로테이션이 끝나는 시각으로 보여요.'),
      rotPreview,
    );
    const pickWrap = h('div', {}, h('div', { class: 'label' }, '픽업 캐릭터 (5★가 나오면 50% 확률로 픽업)'), pickGrid);
    const memPickWrap = h('div', {}, h('label', { class: 'field' }, '추억 픽업 따라가기', pickupFrom), h('div', { class: 'row wrap' }, h('div', { class: 'label' }, '픽업 추억 (직접 고를 때)'), syncFromChars), memGrid);
    const rotWrap = h('div', {}, h('label', { class: 'inline' }, rotOn, h('b', {}, '자동 로테이션 픽업')), rotBox);
    const syncType = () => {
      const pickup = type.value === 'pickup';
      const memory = category.value === 'memory';
      rotWrap.hidden = !pickup || memory;
      rotBox.hidden = !rotOn.checked;
      pickWrap.hidden = !pickup || rotOn.checked || memory;
      memPickWrap.hidden = !pickup || !memory;
      memGrid.hidden = !!pickupFrom.value;
      if (pickup && rotOn.checked && !memory) showRotation();
    };
    type.onchange = syncType;
    rotOn.onchange = syncType;
    category.onchange = syncType;
    pickupFrom.onchange = syncType;
    syncType();

    // 키 아트 생성
    const extra = h('input', { placeholder: '추가 연출 (예: 밤하늘 축제 등불, 따뜻한 분위기)' });
    const jobArea = h('div');
    // 추억 배너는 서버(batch.banner_input)가 픽업 추억 / pickupFrom → 주인 캐릭터 · 추억 이름 · 장면 태그로 바꿔서 그림 요청에 넣음
    const bannerInput = () => {
      const d = collect(false);
      return d ? { bannerId: bid || 'banner_new', title: d.title, description: d.description, category: d.category, pickupIds: d.pickupIds, pickupFrom: d.pickupFrom || null, extra: extra.value } : null;
    };
    const artStep = promptStep({ kind: 'banner', getInput: bannerInput, generateLabel: '그림 뽑기', generate: (gen) => genArt(gen) });
    async function genArt(gen) {
      if (!bannerInput() || !(await ensureId())) return;
      const input = bannerInput();
      const job = await tryApi(() => api.post('/api/banner/generate', { ...input, ...gen }));
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
      const memory = category.value === 'memory';
      const data = {
        id: bid,
        title: title.value.trim(),
        type: type.value,
        category: category.value,
        pickupIds: type.value === 'pickup' && (memory ? !pickupFrom.value : !rotOn.checked) ? (memory ? [...pickedMems].filter((id) => memories.some((m) => m.id === id)) : [...pickedChars]) : [],
        ...(type.value === 'pickup' && rotOn.checked && !memory ? { rotation: rotation() } : {}),
        ...(memory && type.value === 'pickup' && pickupFrom.value ? { pickupFrom: pickupFrom.value } : {}),
        startAt: start.get(),
        endAt: end.get(),
        bannerImage: image.value.trim(),
        description: desc.value,
        relatedStoryId: related.value || null,
      };
      if (strict && !data.title) return toast('제목을 입력해 주세요', 'error'), null;
      if (data.startAt && data.endAt && Date.parse(data.startAt) >= Date.parse(data.endAt)) return toast('시작이 종료보다 늦어요', 'error'), null;
      return data;
    }

    async function save(quiet = false) {
      if (!collect()) return false;
      if (!(await ensureId())) return false;
      const data = collect();
      const items = state.data.banners.filter((x) => x.id !== data.id);
      const idx = state.data.banners.findIndex((x) => x.id === data.id);
      idx >= 0 ? items.splice(idx, 0, data) : items.push(data);
      const ok = await tryApi(() => saveList('banners', items));
      if (ok === null) return false;
      selectedId = data.id;
      renderList();
      if (!quiet) toast('배너를 저장했어요 (작업 공간)', 'success');
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
      openPreview({ banner: bid, now });
    }

    // 캐릭터 픽업 배너 ↔ 추억 배너 (pickupFrom = 이 배너 → 그때그때 픽업 캐릭터의 전용 추억이 픽업)
    const linked = v.id ? state.data.banners.filter((x) => x.category === 'memory' && x.pickupFrom === v.id) : [];
    const memLink =
      !isNew &&
      v.category !== 'memory' &&
      v.type === 'pickup' &&
      h(
        'div',
        { class: 'card inner' },
        h('b', {}, '추억 픽업 '),
        h('span', { class: 'muted small' }, '— 이 배너의 픽업 캐릭터 전용 추억을 픽업하는 추억 배너 (로테이션도 따라감)'),
        h(
          'div',
          { class: 'row wrap' },
          ...linked.map((x) => h('button', { class: 'btn small', onclick: () => edit(x) }, `추억 배너 열기: ${x.title}`)),
          h(
            'button',
            {
              class: ['btn small', !linked.length && 'primary'],
              onclick: () =>
                edit(null, { title: `${v.title} · 추억`, type: 'pickup', category: 'memory', pickupFrom: v.id, startAt: v.startAt, endAt: v.endAt, description: v.description, relatedStoryId: v.relatedStoryId }),
            },
            linked.length ? '+ 추억 배너 하나 더' : '이 배너의 추억 배너 만들기',
          ),
        ),
      );

    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, isNew ? (v.category === 'memory' ? '새 추억 배너' : '새 배너') : `배너 편집 — ${v.id}`),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'id (자동)', id), h('div', { class: 'row' }, h('label', { class: 'field' }, '뽑기', category), h('label', { class: 'field' }, '종류', type))),
        h('label', { class: 'field' }, '제목', title),
        h('div', { class: 'grid2' }, start.el, end.el),
        rotWrap,
        pickWrap,
        memPickWrap,
        memLink,
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
        h('h2', {}, '키 아트 생성'),
        h('p', { class: 'muted small' }, '픽업 캐릭터의 소개문과, 승인된 캐릭터 그림을 만들 때 쓴 외형 태그를 이어받아 Gemini가 프롬프트를 써요. 추억 배너는 픽업 추억(또는 따라가는 캐릭터 배너의 전용 추억)의 주인 캐릭터 + 추억 이름 · 장면 태그로 그려요. 공통 스타일: dev/style_banner.txt'),
        h('label', { class: 'field' }, '추가 연출', extra),
        artStep.el,
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
