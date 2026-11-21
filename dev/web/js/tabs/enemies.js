// 적 탭: 목록 / 만들기 / 고치기 / 지우기 — 능력치, 스킬(같은 효과 엔진), 패시브, 그림
import { h, toast, confirmBox, slugOk, wsImage } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';
import { loadBattleKit, skillForm, passiveForm, statsForm, issueList, blankPassive, cleanEntity } from '../battleForm.js';
import { openEnemyGenerator } from './assets.js';

const ACTIONS = ['basic', 'skill', 'ultimate'];

export function enemiesTab(root, { select } = {}) {
  let editing = null; // { v, isNew }
  let dirty = false;
  let images = [];
  const list = h('div', { class: 'item-list' });
  const editor = h('div', { class: 'col-right' });
  root.replaceChildren(
    h(
      'div',
      { class: 'two-col' },
      h('div', { class: 'col-left' }, h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, `적 (${state.data.enemies.length})`), h('button', { class: 'btn primary small', onclick: () => edit(null) }, '+ 새 적')), list)),
      editor,
    ),
  );

  function usedIn(id) {
    return (state.data.stages || []).filter((st) => (st.waves || []).some((w) => w.some((e) => e.enemyId === id)));
  }

  function renderList() {
    list.replaceChildren(
      ...state.data.enemies.map((e) =>
        h(
          'button',
          { class: ['list-item', editing?.v.id === e.id && 'active'], onclick: () => edit(e) },
          h('div', { class: 'row' }, h('div', { class: 'thumb small-thumb checker' }, e.image ? h('img', { src: wsImage(e.image), alt: '', onerror: (ev) => ev.target.remove() }) : '없음'), h('div', { class: 'grow' }, h('b', {}, e.name), e.boss && h('span', { class: 'chip warn' }, ' 보스'), h('div', { class: 'muted small' }, `${e.id} · 스테이지 ${usedIn(e.id).length}곳`))),
        ),
      ),
      ...(state.data.enemies.length ? [] : [h('p', { class: 'muted' }, '아직 적이 없어요')]),
    );
  }

  async function edit(e) {
    if (dirty && !(await confirmBox('저장하지 않은 변경', '버리고 이동할까요?', { ok: '버리기', danger: true }))) return;
    const kitMods = await loadBattleKit();
    const { vocab, describe, progression } = kitMods;
    const balance = progression.validateBalance(state.data.balance, vocab, () => {});
    const isNew = !e;
    const v = structuredClone(
      e || {
        id: '',
        name: '',
        image: '',
        boss: false,
        stats: { atk: 70, def: 20, hp: 500 },
        kit: { basic: structuredClone(balance.defaultKit.basic), skill: null, ultimate: null },
        passives: [],
      },
    );
    v.kit = v.kit || { basic: structuredClone(balance.defaultKit.basic), skill: null, ultimate: null };
    v.passives = v.passives || [];
    v.stats = v.stats || {};
    editing = { v, isNew };
    dirty = false;
    renderList();
    images = (await tryApi(() => api.get('/api/assets?dir=enemies'))) || [];

    const mark = () => {
      dirty = true;
      powerLine();
    };
    const cleaned = () => cleanEntity(v, { enemy: true });
    const power = h('div', { class: 'be-summary' });
    const powerLine = () => {
      const ce = cleaned();
      const at = (lv) => progression.powerOf(progression.statsOf(ce, lv, 0, balance), balance);
      power.replaceChildren(h('b', {}, '전투력 '), `Lv.1 ${at(1)} · Lv.5 ${at(5)} · Lv.10 ${at(10)}`, h('span', { class: 'muted small' }, ' (스테이지에서 레벨을 정해요)'));
    };
    const issuesBox = h('div');

    const id = h('input', { value: v.id, disabled: !isNew, placeholder: '영문 id 예: slime_star', oninput: (ev) => ((v.id = ev.target.value.trim()), mark()) });
    const name = h('input', { value: v.name, oninput: (ev) => ((v.name = ev.target.value), mark()) });
    const boss = h('input', { type: 'checkbox', checked: v.boss, onchange: (ev) => ((v.boss = ev.target.checked), mark()) });
    const imgSel = h('select', { onchange: (ev) => ((v.image = ev.target.value), mark(), renderImg()) }, h('option', { value: '' }, '(그림 없음 — 기본 카드)'), images.map((p) => h('option', { value: p }, p.replace('assets/enemies/', ''))));
    imgSel.value = v.image || '';
    const imgBox = h('div', { class: 'thumb big-thumb checker' });
    const renderImg = () => imgBox.replaceChildren(v.image ? h('img', { src: wsImage(v.image), alt: '' }) : h('span', {}, '그림 없음'));
    renderImg();
    const upload = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      onchange: async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        if (!slugOk(v.id)) return toast('먼저 id를 정해 주세요 (그림 파일 이름이 돼요)', 'error');
        const data = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(file);
        });
        const r = await tryApi(() => api.post('/api/assets/upload', { dir: 'enemies', name: v.id, data }));
        if (!r) return;
        images = [...new Set([...images, r.path])];
        imgSel.append(h('option', { value: r.path }, r.path.replace('assets/enemies/', '')));
        v.image = r.path;
        imgSel.value = r.path;
        mark();
        renderImg();
        toast('그림을 올렸어요 (긴 변 512px PNG)', 'success');
      },
    });

    // AI로 그리기: 저장된 적에만 연결할 수 있어요 (그림 파일 이름 = id)
    const drawAi = h(
      'button',
      {
        class: 'btn small',
        onclick: () => {
          if (editing.isNew || !state.data.enemies.some((x) => x.id === v.id)) return toast('먼저 적을 저장해 주세요 (그림은 저장된 적에 연결돼요)', 'error');
          openEnemyGenerator({ ...(state.data.enemies.find((x) => x.id === v.id) || {}), name: v.name, boss: v.boss }, (path) => {
            if (!images.includes(path)) {
              images.push(path);
              imgSel.append(h('option', { value: path }, path.replace('assets/enemies/', '')));
            }
            v.image = path; // 서버에서 이미 이 적에 연결됨 → 저장 안 해도 유지
            imgSel.value = path;
            renderImg();
            renderList();
          });
        },
      },
      'AI로 그리기',
    );

    const kitBox = h('div', { class: 'be-skills' });
    const renderKit = () => {
      kitBox.replaceChildren(
        ...ACTIONS.map((a) => {
          if (!v.kit[a]) {
            return h('div', { class: 'bf-skill empty-skill' }, h('div', { class: 'bf-title' }, vocab.actions[a]), h('p', { class: 'muted small' }, a === 'basic' ? '기본 공격을 쓰려면 추가해 주세요' : '없음'), h('button', { class: 'btn small', onclick: () => ((v.kit[a] = structuredClone(balance.defaultKit[a])), mark(), renderKit()) }, `+ ${vocab.actions[a]}`));
          }
          const form = skillForm(v.kit[a], a, {
            onChange: mark,
            preview: () => describe.describeSkill(cleaned().kit?.[a], vocab, { stats: progression.statsOf(cleaned(), 1, 0, balance), action: a }),
          });
          return h('div', {}, form.el, a !== 'basic' && h('button', { class: 'btn tiny danger-outline', onclick: () => ((v.kit[a] = null), mark(), renderKit()) }, `${vocab.actions[a]} 없애기`));
        }),
      );
    };
    renderKit();

    const passBox = h('div');
    const renderPassives = () => {
      passBox.replaceChildren(
        ...v.passives.map((p, i) =>
          h('div', {}, passiveForm(p, { onChange: mark, title: `패시브 ${i + 1} (항상 켜짐)`, preview: () => describe.describePassive(cleaned().passives[i] || p, vocab) }).el, h('button', { class: 'btn tiny danger-outline', onclick: () => (v.passives.splice(i, 1), mark(), renderPassives()) }, '패시브 삭제')),
        ),
        h('button', { class: 'btn small', onclick: () => (v.passives.push(blankPassive()), mark(), renderPassives()) }, '+ 패시브'),
      );
    };
    renderPassives();

    async function save() {
      if (!slugOk(v.id)) return toast('id를 영문/숫자/_/-로 정해 주세요', 'error');
      if (!v.name.trim()) return toast('이름을 입력해 주세요', 'error');
      if (isNew && state.data.enemies.some((x) => x.id === v.id)) return toast('이미 있는 id예요', 'error');
      const item = structuredClone(v);
      if (!item.image) delete item.image;
      if (!item.boss) delete item.boss;
      const items = state.data.enemies.filter((x) => x.id !== item.id);
      const pos = state.data.enemies.findIndex((x) => x.id === item.id);
      pos >= 0 ? items.splice(pos, 0, item) : items.push(item);
      try {
        await api.put('/api/list/enemies', items);
      } catch (err) {
        issuesBox.replaceChildren(h('h3', {}, '저장하지 못했어요'), issueList(err.data?.issues || [{ level: 'error', where: v.id, message: err.message }]));
        return;
      }
      await reloadData();
      dirty = false;
      editing.isNew = false;
      id.disabled = true;
      const chk = await tryApi(() => api.post('/api/battle/check', { ...item, enemy: true }));
      issuesBox.replaceChildren(h('h3', {}, '저장했어요'), issueList(chk?.issues));
      renderList();
      toast('적을 저장했어요 (작업 공간)', 'success');
    }

    async function remove() {
      const used = usedIn(v.id);
      const msg = used.length ? `이 적을 쓰는 스테이지가 있어요:\n- ${used.map((s) => s.name).join('\n- ')}\n\n삭제하면 검사에서 오류가 나요.` : '삭제할까요?';
      if (!(await confirmBox(`「${v.name}」 삭제`, msg, { ok: '삭제', danger: true }))) return;
      if ((await tryApi(() => api.put('/api/list/enemies', state.data.enemies.filter((x) => x.id !== v.id)))) === null) return;
      await reloadData();
      editing = null;
      dirty = false;
      editor.replaceChildren(h('div', { class: 'empty' }, '삭제했어요'));
      renderList();
    }

    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, isNew ? '새 적' : `적 편집 — ${v.id}`),
        h('div', { class: 'row', style: { gap: '16px', alignItems: 'flex-start' } }, imgBox, h('div', { class: 'grow' }, h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'id (바꾸지 않기)', id), h('label', { class: 'field' }, '이름', name)), h('label', { class: 'inline' }, boss, '보스 (카드가 크게 표시)'), h('label', { class: 'field' }, '그림 (assets/enemies) — 올리기 또는 AI로 그리기', h('div', { class: 'row wrap' }, imgSel, upload, drawAi)))),
        power,
        h('h3', {}, '기본 능력치 (Lv.1, 레벨에 따라 성장)'),
        statsForm(v.stats, { ...balance.rarityStats.R, critRate: balance.crit.rate, critDmg: balance.crit.dmg }, { onChange: mark }),
        h('h3', {}, '스킬 (적도 같은 AI: 궁극기 → 스킬 → 기본)'),
        kitBox,
        h('h3', {}, '패시브'),
        passBox,
        issuesBox,
        h('div', { class: 'row wrap sticky-actions' }, h('button', { class: 'btn primary', onclick: save }, '저장'), !isNew && h('button', { class: 'btn danger-outline', onclick: remove }, '삭제')),
      ),
    );
    powerLine();
    editor.scrollTop = 0;
  }

  renderList();
  const sel = select && state.data.enemies.find((x) => x.id === select);
  if (sel) edit(sel);
  else editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 적을 고르거나 새로 만들어 주세요.'));
  return { refresh: renderList, isDirty: () => dirty };
}
