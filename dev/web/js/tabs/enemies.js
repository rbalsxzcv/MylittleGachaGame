// 적 탭: 목록 / 만들기 / 고치기 / 지우기 — 능력치, 행동(같은 효과 엔진) + 패턴(예고 순서) + 보스 페이즈/광폭화, 패시브, 그림
import { h, toast, confirmBox, slugOk, wsImage } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';
import { loadBattleKit, skillForm, passiveForm, statsForm, issueList, blankPassive, cleanEntity, effectList, newEffect } from '../battleForm.js';
import { openEnemyGenerator } from './assets.js';

const ICONS = { attack: '⚔ 공격', aoe: '✸ 광역', buff: '▲ 강화', heal: '✚ 치유', debuff: '▼ 약화' };
const TARGET_RULES = { random: '무작위', lowest_hp: 'HP 가장 낮은', highest_atk: '공격력 가장 높은', slot1: '1번 칸', slot2: '2번 칸', slot3: '3번 칸', slot4: '4번 칸', slot5: '5번 칸' };
const pick = (options, value, onChange) => {
  const s = h('select', { onchange: (e) => onChange(e.target.value) }, Object.entries(options).map(([k, label]) => h('option', { value: k }, label)));
  s.value = value;
  return s;
};

/** 패턴 편집기: [{action, target?}] — 순서대로 반복 */
function patternEditor(list, actionIds, onChange, { hint = '' } = {}) {
  const host = h('div', { class: 'pattern-list' });
  const render = () => {
    host.replaceChildren(
      ...list.map((p, i) =>
        h(
          'div',
          { class: 'row wrap pattern-row' },
          h('b', { class: 'muted small' }, `${i + 1}.`),
          pick(Object.fromEntries(actionIds().map((a) => [a, a])), p.action, (v) => ((p.action = v), onChange())),
          pick({ '': '(대상 규칙: 무작위)', ...TARGET_RULES }, p.target || '', (v) => (v ? (p.target = v) : delete p.target, onChange())),
          h('button', { class: 'btn tiny', disabled: i === 0, onclick: () => ([list[i - 1], list[i]] = [list[i], list[i - 1]], onChange(), render()) }, '↑'),
          h('button', { class: 'btn tiny danger-outline', disabled: list.length <= 1 && !hint, onclick: () => (list.splice(i, 1), onChange(), render()) }, '✕'),
        ),
      ),
      h('button', { class: 'btn tiny', onclick: () => (list.push({ action: actionIds()[0] }), onChange(), render()) }, '+ 순서 추가'),
      hint && h('span', { class: 'muted small' }, ` ${hint}`),
    );
  };
  render();
  return { el: host, render };
}

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
        stats: { atk: 70, def: 20, hp: 500, spd: 100 },
        actions: { basic: { ...structuredClone(balance.defaultKit.basic), icon: 'attack' } },
        pattern: [{ action: 'basic' }],
        passives: [],
      },
    );
    // 예전 형식(kit)이면 행동 + 패턴으로 바꿔서 편집 (저장하면 새 형식)
    if (!v.actions || !Object.keys(v.actions).length) {
      const conv = kitMods.schema.cleanEnemyBehavior(v, vocab, () => {}, v.id || 'new');
      Object.assign(v, { actions: conv.actions, pattern: conv.pattern });
      delete v.kit;
    }
    v.pattern = v.pattern?.length ? v.pattern : [{ action: Object.keys(v.actions)[0] }];
    v.phases = v.phases || [];
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

    // ── 행동 (적이 할 수 있는 것) ──
    const actionIds = () => Object.keys(v.actions);
    const kitBox = h('div', { class: 'be-skills' });
    const renderActions = () => {
      kitBox.replaceChildren(
        ...actionIds().map((aid) => {
          const a = v.actions[aid];
          const form = skillForm(a, 'enemy', {
            title: `행동 '${aid}'`,
            onChange: mark,
            preview: () => describe.describeSkill(cleaned().actions?.[aid], vocab, { stats: progression.statsOf(cleaned(), 1, 0, balance), action: aid }),
          });
          const used = v.pattern.some((p) => p.action === aid) || v.phases.some((ph) => ph.pattern.some((p) => p.action === aid));
          return h(
            'div',
            { class: 'enemy-action' },
            h(
              'div',
              { class: 'row wrap' },
              h('label', { class: 'bf-param' }, h('span', {}, '예고 아이콘'), pick({ '': '(자동)', ...ICONS }, a.icon || '', (x) => (x ? (a.icon = x) : delete a.icon, mark()))),
              h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!a.big, onchange: (e) => (e.target.checked ? (a.big = true) : delete a.big, mark()) }), '큰 공격 (빨간 예고, 차단 가능)'),
              h('button', { class: 'btn tiny danger-outline', disabled: actionIds().length <= 1 || used, title: used ? '패턴에서 먼저 빼 주세요' : '', onclick: () => (delete v.actions[aid], mark(), renderActions()) }, '행동 삭제'),
            ),
            form.el,
          );
        }),
        h(
          'div',
          { class: 'row wrap' },
          h('input', { class: 'small-input', placeholder: '새 행동 id (예: slam)', id: 'new-action-id' }),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                const inp = kitBox.querySelector('#new-action-id');
                const nid = (inp.value || '').trim();
                if (!/^[a-z0-9_]{1,24}$/.test(nid)) return toast('행동 id는 영문 소문자/숫자/_ (24자까지)', 'error');
                if (v.actions[nid]) return toast('이미 있는 행동이에요', 'error');
                v.actions[nid] = { name: nid, description: '', targeting: 'enemy_single', effects: [newEffect('damage')], icon: 'attack' };
                mark();
                renderActions();
                pattern.render();
                renderPhases();
              },
            },
            '+ 행동',
          ),
        ),
      );
    };
    renderActions();

    // ── 패턴 (예고 순서, 반복) ──
    const pattern = patternEditor(v.pattern, actionIds, mark);

    // ── 보스 페이즈 / 광폭화 ──
    const phaseBox = h('div');
    const renderPhases = () => {
      phaseBox.replaceChildren(
        ...v.phases.map((ph, i) =>
          h(
            'div',
            { class: 'scene-card' },
            h(
              'div',
              { class: 'row wrap' },
              h('b', {}, `페이즈 ${i + 2}`),
              h('label', { class: 'bf-param' }, h('span', {}, 'HP % 미만'), h('input', { type: 'number', class: 'num-input', min: 1, max: 99, value: ph.hpBelow, oninput: (e) => ((ph.hpBelow = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 50))), mark()) })),
              h('label', { class: 'bf-param grow' }, h('span', {}, '이름 (배너)'), h('input', { value: ph.name || '', oninput: (e) => ((ph.name = e.target.value), mark()) })),
              h('button', { class: 'btn tiny danger-outline', onclick: () => (v.phases.splice(i, 1), mark(), renderPhases()) }, '페이즈 삭제'),
            ),
            h('div', { class: 'muted small' }, '이 페이즈의 패턴'),
            patternEditor(ph.pattern, actionIds, mark).el,
            h('div', { class: 'muted small' }, '들어갈 때 효과 (대상 미지정 = 자신)'),
            effectList((ph.enterEffects ||= []), { onChange: mark }),
          ),
        ),
        h('button', { class: 'btn small', onclick: () => (v.phases.push({ hpBelow: 50, name: `페이즈 ${v.phases.length + 2}`, pattern: structuredClone(v.pattern), enterEffects: [] }), mark(), renderPhases()) }, '+ 페이즈 (보스)'),
      );
    };
    renderPhases();

    const enrageBox = h('div');
    const renderEnrage = () => {
      const on = !!v.enrage;
      enrageBox.replaceChildren(
        h(
          'label',
          { class: 'inline' },
          h('input', { type: 'checkbox', checked: on, onchange: (e) => ((v.enrage = e.target.checked ? { round: 15, effects: [{ type: 'buff', stat: 'atk', pct: 50, turns: 20 }] } : null), mark(), renderEnrage()) }),
          '광폭화 (정한 라운드부터 효과)',
        ),
        on && h('label', { class: 'bf-param' }, h('span', {}, '라운드'), h('input', { type: 'number', class: 'num-input', min: 1, max: 999, value: v.enrage.round, oninput: (e) => ((v.enrage.round = Math.max(1, parseInt(e.target.value, 10) || 15)), mark()) })),
        on && effectList(v.enrage.effects, { onChange: mark }),
      );
    };
    renderEnrage();

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
      if (!item.phases?.length) delete item.phases;
      if (!item.enrage) delete item.enrage;
      delete item.kit;
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
        statsForm(v.stats, { ...balance.stats.byRarity[3], critRate: balance.stats.critRate, critDmg: balance.stats.critDmg }, { onChange: mark }),
        h('h3', {}, '행동 (적이 할 수 있는 것 — 아군과 같은 효과 엔진)'),
        kitBox,
        h('h3', {}, '패턴 (이 순서대로 예고하고 반복)'),
        h('p', { class: 'muted small' }, '대상 규칙은 적 1명을 노리는 행동에만 쓰여요. 도발한 아군이 있으면 그쪽으로 바뀌어요.'),
        pattern.el,
        h('h3', {}, '보스: 페이즈 / 광폭화'),
        phaseBox,
        enrageBox,
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
