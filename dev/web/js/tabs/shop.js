// 상점 탭: 골드 상점 / 가상 캐시 상점 상품 편집 (data/shop.json)
// - 상품 추가 · 수정 · 복제 · 순서 변경 · 삭제, VIP 단계
// - 상품 그림: 새로 그리기(소품 생성 → assets/props) 또는 기존 그림에서 고르기
// 고친 내용은 "저장"을 눌러야 작업 공간에 저장되고, 배포 탭에서 배포해야 게임에 반영돼요.
import { h, toast, modal, confirmBox, slugOk, wsImage } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData } from '../state.js';
import { openPreview } from '../preview.js';
import { issueList } from '../battleForm.js';
import { openPropGenerator } from './assets.js';

// 게임의 js/core/data.js 와 같은 값
const ICONS = [
  ['gem', '보석'],
  ['ticket', '티켓'],
  ['gold', '골드'],
  ['scroll', '모집 증서'],
  ['gift', '선물'],
  ['chest', '상자'],
  ['cart', '마차'],
  ['crown', '왕관'],
  ['moon', '달'],
  ['sprout', '새싹'],
];
const CATEGORIES = [
  ['featured', '추천'],
  ['package', '패키지'],
  ['growth', '성장'],
  ['gems', '보석'],
  ['pass', '월정액'],
];
const TIERS = [
  ['normal', '일반'],
  ['rare', '희귀'],
  ['legend', '전설'],
  ['truck', '트럭 (초대형 연출)'],
];
const PERS = [
  ['', '제한 없음'],
  ['day', '매일'],
  ['week', '매주'],
  ['month', '매월'],
  ['once', '계정당'],
];
const REWARDS = [
  ['gems', '보석'],
  ['tickets', '티켓'],
  ['gold', '골드'],
  ['scrolls', '모집 증서'],
];
const ICON_HINT = { gem: '빛나는 보석 더미', ticket: '레벨업 티켓 묶음', gold: '금화 더미', scroll: '봉인된 양피지 증서', gift: '리본 묶은 선물 꾸러미', chest: '보물 상자', cart: '짐을 가득 실은 마차', crown: '보석 박힌 왕관', moon: '은은한 달빛 부적', sprout: '새싹이 돋은 화분' };

const num = (v) => Math.max(0, Math.floor(Number(v) || 0));
const krw = (n) => `₩${Number(n || 0).toLocaleString('ko-KR')}`;
const comma = (n) => Number(n || 0).toLocaleString('ko-KR');
const opts = (list, value) => list.map(([v, l]) => h('option', { value: v, selected: v === value }, l));

function rewardSummary(r) {
  return REWARDS.filter(([k]) => r?.[k] > 0)
    .map(([k, l]) => `${l} ${comma(r[k])}`)
    .join(' · ');
}

function priceSummary(tab, it) {
  if (tab === 'cash') return krw(it.priceKRW);
  const c = it.cost || {};
  if (!c.gold && !c.gems) return '무료';
  return [c.gold > 0 && `골드 ${comma(c.gold)}`, c.gems > 0 && `보석 ${comma(c.gems)}`].filter(Boolean).join(' + ');
}

function blankItem(tab, category) {
  const id = `${tab}_${Date.now().toString(36)}`;
  const base = { id, name: '', desc: '', icon: 'chest', rewards: { gems: 100 }, limit: { per: 'day', count: 1 } };
  return tab === 'gold' ? { ...base, cost: { gold: 1000 } } : { ...base, category, tier: 'normal', priceKRW: 1200 };
}

export function shopTab(root, { select: selectId } = {}) {
  let shop = { gold: [], cash: [], vip: [] };
  let savedIds = new Set(); // 저장된 적 있는 id (id를 바꾸면 구매 기록이 끊겨서 잠금)
  let tab = 'cash';
  let category = 'featured';
  let selected = null; // { tab, id }
  let dirty = false;
  let vipRender = null; // VIP 칸 다시 그리기 (vipCard가 채움)

  const head = h('div', { class: 'row between shop-ed-head' });
  const list = h('div');
  const editor = h('div', { class: 'col-right' });
  const issuesBox = h('div');
  root.replaceChildren(
    h('div', { class: 'two-col' }, h('div', { class: 'col-left' }, h('section', { class: 'card' }, head, list), vipCard()), h('div', {}, issuesBox, editor)),
  );

  function markDirty() {
    dirty = true;
    renderHead();
  }

  function renderHead() {
    head.replaceChildren(
      h('h2', {}, '상점'),
      h(
        'div',
        { class: 'row' },
        dirty && h('span', { class: 'chip warn' }, '저장 안 됨'),
        h('button', { class: 'btn small', onclick: preview }, '게임 미리보기'),
        h('button', { class: ['btn', 'small', dirty && 'primary'], onclick: save }, '저장'),
      ),
    );
  }

  const items = (t = tab) => shop[t];
  const current = () => selected && shop[selected.tab].find((x) => x.id === selected.id);

  // ── 왼쪽 목록 ──
  function renderList() {
    const tabs = h(
      'div',
      { class: 'row seg' },
      [
        ['gold', `골드 상점 (${shop.gold.length})`],
        ['cash', `캐시 상점 (${shop.cash.length})`],
      ].map(([id, label]) => h('button', { class: ['btn', 'small', tab === id && 'primary'], onclick: () => ((tab = id), renderList()) }, label)),
    );
    const cats =
      tab === 'cash' &&
      h(
        'div',
        { class: 'row wrap seg' },
        CATEGORIES.map(([id, label]) => h('button', { class: ['btn', 'tiny', category === id && 'primary'], onclick: () => ((category = id), renderList()) }, `${label} ${shop.cash.filter((x) => x.category === id).length}`)),
      );
    const shown = tab === 'cash' ? shop.cash.filter((x) => x.category === category) : shop.gold;
    list.replaceChildren(
      tabs,
      cats || '',
      h(
        'div',
        { class: 'item-list shop-ed-list' },
        shown.map((it) =>
          h(
            'div',
            { class: ['list-item', 'shop-ed-item', selected?.tab === tab && selected.id === it.id && 'active'], onclick: () => select(tab, it.id) },
            h('div', { class: 'thumb small-thumb checker' }, it.image ? h('img', { src: wsImage(it.image), alt: '', onerror: (e) => e.target.remove() }) : h('span', {}, ICONS.find(([k]) => k === it.icon)?.[1] || '')),
            h('div', { class: 'grow' }, h('b', {}, it.name || '(이름 없음)'), h('div', { class: 'muted small' }, `${priceSummary(tab, it)} · ${rewardSummary(it.rewards) || '보상 없음'}`)),
            h(
              'div',
              { class: 'shop-ed-move' },
              h('button', { class: 'btn tiny', title: '위로', onclick: (e) => (e.stopPropagation(), move(it, -1)) }, '▲'),
              h('button', { class: 'btn tiny', title: '아래로', onclick: (e) => (e.stopPropagation(), move(it, 1)) }, '▼'),
            ),
          ),
        ),
        shown.length ? null : h('p', { class: 'muted' }, '상품이 없어요'),
      ),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary small', onclick: add }, '+ 새 상품')),
      h('p', { class: 'muted small' }, '게임 상점에는 이 순서대로 보여요. 캐시 상점은 분류마다 따로 나와요.'),
    );
  }

  /** 같은 목록(캐시는 같은 분류) 안에서 위/아래로 */
  function move(it, dir) {
    const arr = items();
    const peers = arr.filter((x) => tab !== 'cash' || x.category === it.category);
    const j = peers.indexOf(it) + dir;
    if (j < 0 || j >= peers.length) return;
    const a = arr.indexOf(it);
    const b = arr.indexOf(peers[j]);
    [arr[a], arr[b]] = [arr[b], arr[a]];
    markDirty();
    renderList();
  }

  function add() {
    const it = blankItem(tab, category);
    items().push(it);
    markDirty();
    select(tab, it.id);
  }

  function select(t, id) {
    selected = { tab: t, id };
    tab = t;
    const it = current();
    if (it?.category) category = it.category;
    renderList();
    renderEditor();
  }

  // ── 오른쪽 편집 폼 (상품 객체를 바로 고치고, 저장은 상점 전체) ──
  function renderEditor() {
    const it = current();
    if (!it) {
      editor.replaceChildren(h('div', { class: 'empty' }, '왼쪽에서 상품을 고르거나 새로 만들어 주세요.'));
      return;
    }
    const t = selected.tab;
    const on = (fn) => (e) => {
      fn(e.target);
      markDirty();
      renderList();
    };
    const numIn = (value, set, attrs = {}) => h('input', { type: 'number', min: 0, value: value ?? 0, oninput: on((el) => set(num(el.value))), ...attrs });

    // 기본 정보
    const idLocked = savedIds.has(it.id);
    const idIn = h('input', {
      value: it.id,
      disabled: idLocked,
      title: idLocked ? '저장된 상품의 id를 바꾸면 플레이어의 구매 기록이 끊겨요' : '',
      onchange: (e) => {
        const v = e.target.value.trim();
        if (!slugOk(v)) return toast('id를 영문/숫자/_/-로 정해 주세요', 'error'), (e.target.value = it.id);
        if ([...shop.gold, ...shop.cash].some((x) => x !== it && x.id === v)) return toast('이미 있는 id예요', 'error'), (e.target.value = it.id);
        it.id = v;
        selected.id = v;
        markDirty();
        renderList();
      },
    });
    const basics = h(
      'div',
      {},
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, `id${idLocked ? ' (저장됨 — 바꾸지 않기)' : ''}`, idIn), h('label', { class: 'field' }, '이름 (40자)', h('input', { value: it.name, maxlength: 40, oninput: on((el) => (it.name = el.value)) }))),
      h('label', { class: 'field' }, '설명 (200자)', h('input', { value: it.desc || '', maxlength: 200, oninput: on((el) => (it.desc = el.value)) })),
      h(
        'div',
        { class: 'grid2' },
        h('label', { class: 'field' }, '아이콘 종류 (그림이 없을 때 기본 모양)', h('select', { onchange: on((el) => (it.icon = el.value)) }, opts(ICONS, it.icon))),
        h(
          'label',
          { class: 'field' },
          '배지 (쉼표로 구분, 최대 3개 · 각 12자)',
          h('input', {
            value: (it.badges || []).join(', '),
            placeholder: '예: BEST, 월 1회',
            oninput: on((el) => {
              const b = el.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3);
              if (b.length) it.badges = b;
              else delete it.badges;
            }),
          }),
        ),
      ),
    );

    // 상품 그림
    const artBox = h('div', { class: 'thumb big-thumb checker' }, it.image ? h('img', { src: wsImage(it.image), alt: '', onerror: (e) => e.target.replaceWith(h('span', { class: 'error' }, '파일 없음')) }) : h('span', {}, '그림 없음'));
    const setImage = (path) => {
      if (path) it.image = path;
      else delete it.image;
      markDirty();
      renderList();
      renderEditor();
    };
    const art = h(
      'div',
      { class: 'card inner' },
      h('h3', { style: { marginTop: 0 } }, '상품 그림'),
      h(
        'div',
        { class: 'row', style: { gap: '16px', alignItems: 'flex-start' } },
        artBox,
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'muted small' }, it.image || '그림이 없으면 게임에서 아이콘 종류별 기본 모양(UI 에셋 shop_<아이콘> 또는 CSS 메달)으로 보여요.'),
          h(
            'div',
            { class: 'row wrap', style: { marginTop: '8px' } },
            h('button', { class: 'btn primary small', onclick: () => drawNew(it, setImage) }, '새로 그리기'),
            h('button', { class: 'btn small', onclick: () => pickExisting(it, setImage) }, '기존 그림에서 고르기'),
            it.image && h('button', { class: 'btn small danger-outline', onclick: () => setImage(null) }, '그림 빼기'),
          ),
          h('p', { class: 'muted small' }, '새로 그리면 소품(assets/props)으로 저장돼서 다른 상품에서도 고를 수 있어요. 프롬프트는 "AI로 프롬프트 쓰기" 또는 "직접 쓰기"로 정해요.'),
        ),
      ),
    );

    // 가격
    let price;
    if (t === 'gold') {
      it.cost = it.cost || {};
      price = h(
        'div',
        {},
        h('h3', {}, '가격 (둘 다 0이면 무료 — 홈 상점 메뉴에 빨간 점)'),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '골드', numIn(it.cost.gold, (v) => (it.cost.gold = v), { step: 500 })), h('label', { class: 'field' }, '보석', numIn(it.cost.gems, (v) => (it.cost.gems = v), { step: 10 }))),
      );
    } else {
      price = h(
        'div',
        {},
        h('h3', {}, '가격 · 분류 (가상 결제 — 실제로 돈이 나가지 않아요)'),
        h(
          'div',
          { class: 'grid2' },
          h(
            'label',
            { class: 'field' },
            '분류',
            h('select', { onchange: on((el) => ((it.category = el.value), (category = el.value))) }, opts(CATEGORIES, it.category)),
          ),
          h('label', { class: 'field' }, '등급 (카드 색 · 연출)', h('select', { onchange: on((el) => (it.tier = el.value)) }, opts(TIERS, it.tier))),
        ),
        h(
          'div',
          { class: 'grid3' },
          h('label', { class: 'field' }, '원화 가격 (100 ~ 10,000,000)', numIn(it.priceKRW, (v) => (it.priceKRW = v), { step: 100 })),
          h('label', { class: 'field' }, '정가 (0 = 표시 안 함)', numIn(it.originalKRW, (v) => (v > 0 ? (it.originalKRW = v) : delete it.originalKRW), { step: 100 })),
          h('label', { class: 'field' }, '가치 문구 (10자)', h('input', { value: it.value || '', maxlength: 10, placeholder: '예: 800%', oninput: on((el) => (el.value.trim() ? (it.value = el.value.trim()) : delete it.value)) })),
        ),
      );
    }

    // 보상
    it.rewards = it.rewards || {};
    const rewardIn = (obj, key) => numIn(obj[key], (v) => (v > 0 ? (obj[key] = v) : delete obj[key]), { step: key === 'gold' ? 1000 : key === 'scrolls' ? 1 : 10 });
    const rewards = h('div', {}, h('h3', {}, '구성품'), h('div', { class: 'grid4' }, REWARDS.map(([k, l]) => h('label', { class: 'field' }, l, rewardIn(it.rewards, k)))));

    // 첫 구매 보너스 / 월정액 (캐시 전용)
    let cashExtras = null;
    if (t === 'cash') {
      const bonusOn = h('input', { type: 'checkbox', checked: !!it.firstBonus });
      const bonusBox = h('div', { class: 'grid4', hidden: !it.firstBonus });
      const renderBonus = () => bonusBox.replaceChildren(...(it.firstBonus ? REWARDS.map(([k, l]) => h('label', { class: 'field' }, l, rewardIn(it.firstBonus, k))) : []));
      renderBonus();
      bonusOn.onchange = () => {
        if (bonusOn.checked) it.firstBonus = { ...it.rewards };
        else delete it.firstBonus;
        bonusBox.hidden = !bonusOn.checked;
        renderBonus();
        markDirty();
      };
      const passOn = h('input', { type: 'checkbox', checked: !!it.pass });
      const passBox = h('div', { class: 'grid3', hidden: !it.pass });
      const renderPass = () =>
        passBox.replaceChildren(
          ...(it.pass
            ? [
                h('label', { class: 'field' }, '기간 (일)', numIn(it.pass.days, (v) => (it.pass.days = v))),
                h('label', { class: 'field' }, '매일 보석', numIn(it.pass.dailyGems, (v) => (it.pass.dailyGems = v), { step: 10 })),
                h('label', { class: 'field' }, '최대 연장 (일)', numIn(it.pass.maxDays, (v) => (it.pass.maxDays = v), { step: 30 })),
              ]
            : []),
        );
      renderPass();
      passOn.onchange = () => {
        if (passOn.checked) it.pass = { days: 30, dailyGems: 100, maxDays: 180 };
        else delete it.pass;
        passBox.hidden = !passOn.checked;
        renderPass();
        markDirty();
      };
      cashExtras = h(
        'div',
        {},
        h('div', {}, h('label', { class: 'inline' }, bonusOn, ' 첫 구매 보너스 (처음 한 번 더 주는 양 — 보통 구성품과 같게 = "첫 구매 2배")')),
        bonusBox,
        h('div', { style: { marginTop: '6px' } }, h('label', { class: 'inline' }, passOn, ' 월정액 (산 날부터 매일 보석 — 접속하면 자동 지급)')),
        passBox,
      );
    }

    // 구매 제한 · 해금
    const per = h('select', {
      onchange: on((el) => {
        if (el.value) it.limit = { per: el.value, count: it.limit?.count || 1 };
        else delete it.limit;
        renderEditor();
      }),
    }, opts(PERS, it.limit?.per || ''));
    const limits = h(
      'div',
      {},
      h('h3', {}, '구매 제한 · 해금'),
      h(
        'div',
        { class: 'grid3' },
        h('label', { class: 'field' }, '초기화 주기 (한국 시간 자정)', per),
        h('label', { class: 'field' }, '횟수', it.limit ? numIn(it.limit.count, (v) => (it.limit.count = Math.max(1, v)), { min: 1 }) : h('input', { disabled: true, placeholder: '제한 없음' })),
        h('label', { class: 'field' }, '해금: 스토리 전투 클리어 수 (0 = 처음부터)', numIn(it.requires?.stagesCleared, (v) => (v > 0 ? (it.requires = { stagesCleared: v }) : delete it.requires))),
      ),
    );

    editor.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, `${t === 'gold' ? '골드 상점' : '캐시 상점'} 상품 — ${it.name || it.id}`), h('span', { class: 'muted small' }, savedIds.has(it.id) ? '' : '새 상품')),
        basics,
        art,
        price,
        rewards,
        cashExtras,
        limits,
        h(
          'div',
          { class: 'row wrap sticky-actions' },
          h('button', { class: ['btn', dirty && 'primary'], onclick: save }, '저장'),
          h('button', { class: 'btn', onclick: () => duplicate(it) }, '복제'),
          h('button', { class: 'btn', onclick: preview }, '게임 미리보기'),
          h('button', { class: 'btn danger-outline', onclick: () => remove(it) }, '삭제'),
        ),
      ),
    );
  }

  function duplicate(it) {
    const copy = structuredClone(it);
    let n = 2;
    while ([...shop.gold, ...shop.cash].some((x) => x.id === `${it.id}_${n}`)) n++;
    copy.id = `${it.id}_${n}`;
    copy.name = `${it.name} (복사)`.slice(0, 40);
    const arr = shop[selected.tab];
    arr.splice(arr.indexOf(it) + 1, 0, copy);
    markDirty();
    select(selected.tab, copy.id);
  }

  async function remove(it) {
    const warn = savedIds.has(it.id) ? '\n이미 공개한 상품이라면 플레이어의 구매 기록은 남지만 상점에서 사라져요.' : '';
    if (!(await confirmBox(`「${it.name || it.id}」 삭제`, `삭제할까요? (저장을 눌러야 반영돼요)${warn}`, { ok: '삭제', danger: true }))) return;
    const arr = shop[selected.tab];
    arr.splice(arr.indexOf(it), 1);
    selected = null;
    markDirty();
    renderList();
    renderEditor();
  }

  // ── 상품 그림 ──
  function drawNew(it, setImage) {
    const parts = [it.name, it.desc, ICON_HINT[it.icon], rewardSummary(it.rewards) && `구성품: ${rewardSummary(it.rewards)}`].filter(Boolean);
    openPropGenerator({ id: `shop_${it.id}`, label: it.name || it.id, prompt: `상점 상품 그림. ${parts.join('. ')}`, title: `상품 그림 새로 그리기 — ${it.name || it.id}` }, (path) => setImage(path));
  }

  async function pickExisting(it, setImage) {
    const [props, ui] = await Promise.all([tryApi(() => api.get('/api/assets?dir=props')), tryApi(() => api.get('/api/assets?dir=ui'))]);
    const labelOf = new Map((state.data.props || []).map((p) => [p.image, p.label]));
    const groups = [
      ['소품 (assets/props)', props || []],
      ['UI 아이콘 (assets/ui, 투명 PNG)', (ui || []).filter((p) => p.endsWith('.png'))],
    ];
    modal({
      title: `기존 그림에서 고르기 — ${it.name || it.id}`,
      wide: true,
      body: (close) =>
        h(
          'div',
          {},
          ...groups.map(([title, paths]) =>
            h(
              'div',
              {},
              h('h3', {}, title),
              paths.length
                ? h(
                    'div',
                    { class: 'pick-grid' },
                    paths.map((p) =>
                      h(
                        'button',
                        { class: ['pick', 'shop-pick', p === it.image && 'active'], type: 'button', title: p, onclick: () => (setImage(p), close(p)) },
                        h('div', { class: 'thumb checker' }, h('img', { src: wsImage(p), alt: '' })),
                        h('span', {}, labelOf.get(p) || p.split('/').pop()),
                      ),
                    ),
                  )
                : h('p', { class: 'muted small' }, '그림이 없어요'),
            ),
          ),
        ),
    });
  }

  // ── VIP ──
  function vipCard() {
    const box = h('div');
    const render = () => {
      const input = h('input', {
        value: (shop.vip || []).join(', '),
        oninput: (e) => {
          shop.vip = e.target.value
            .split(/[,\s]+/)
            .map((x) => num(x))
            .filter((x) => x > 0);
          markDirty();
        },
      });
      box.replaceChildren(h('label', { class: 'field' }, '누적 결제 금액(원)을 쉼표로 — 첫 번째 = VIP 1', input), h('p', { class: 'muted small' }, (shop.vip || []).map((v, i) => `VIP ${i + 1}: ${krw(v)}`).join(' · ') || '없음'));
    };
    vipRender = render;
    return h('section', { class: 'card' }, h('h2', {}, '후원 등급 (VIP)'), box);
  }

  // ── 저장 / 미리보기 ──
  async function save() {
    // 비어 있는 값 정리: 골드 가격은 둘 다 0이면 {gold: 0}
    for (const it of shop.gold) {
      const c = it.cost || {};
      it.cost = {};
      if (c.gold > 0) it.cost.gold = c.gold;
      if (c.gems > 0) it.cost.gems = c.gems;
      if (!it.cost.gold && !it.cost.gems) it.cost.gold = 0;
    }
    try {
      const r = await api.put('/api/shop', shop);
      issuesBox.replaceChildren(...(r.issues?.length ? [h('section', { class: 'card' }, h('h3', {}, '저장했어요 — 확인할 점'), issueList(r.issues))] : []));
    } catch (err) {
      issuesBox.replaceChildren(h('section', { class: 'card' }, h('h3', { class: 'error' }, '저장하지 못했어요'), issueList(err.data?.issues || [{ level: 'error', where: 'shop', message: err.message }])));
      return;
    }
    dirty = false;
    savedIds = new Set([...shop.gold, ...shop.cash].map((x) => x.id));
    await tryApi(() => reloadData());
    renderHead();
    renderList();
    renderEditor();
    vipRender?.();
    toast('상점을 저장했어요 (작업 공간)', 'success');
  }

  async function preview() {
    if (dirty && !(await confirmBox('저장하지 않은 변경', '미리보기는 저장된 작업 공간 데이터로 보여요. 먼저 저장할까요?', { ok: '저장하고 보기' }))) return;
    if (dirty) {
      await save();
      if (dirty) return;
    }
    openPreview({ shop: selected?.tab || tab, category: (selected?.tab || tab) === 'cash' ? category : '' });
  }

  async function load() {
    const r = await tryApi(() => api.get('/api/shop'));
    if (!r) return;
    shop = r;
    shop.vip = shop.vip || [];
    savedIds = new Set([...shop.gold, ...shop.cash].map((x) => x.id));
    dirty = false;
    renderHead();
    renderList();
    renderEditor();
    vipRender?.();
  }

  renderHead();
  load().then(() => {
    // 주소 #shop/<상품id>로 들어오면 그 상품 열기
    const t = selectId && ['gold', 'cash'].find((k) => shop[k].some((x) => x.id === selectId));
    if (t) select(t, selectId);
  });
  return { isDirty: () => dirty, refresh: () => !dirty && load() };
}
