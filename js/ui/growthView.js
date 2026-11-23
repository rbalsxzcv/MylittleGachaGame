// 육성 화면: 보유 캐릭터 목록(전투력/레벨/희귀도 정렬) → 상세 (레벨업 / 스킬 / 돌파)
import { h, ticketIcon, goldIcon } from './dom.js';
import { toast } from './toast.js';
import { go } from './router.js';
import { charArt, rarityBadge, starRow } from './charCard.js';
import { formatGems } from '../systems/economy.js';
import {
  breakthroughNodes,
  statsOf,
  powerOf,
  costFor,
  goldCostFor,
  maxAffordable,
  levelUp,
  doBreakthrough,
  canBreakthrough,
  essenceTicketRate,
} from '../systems/progression.js';
import { buildUnit } from '../battle/units.js';
import { extrasOf } from '../systems/teams.js';
import { findMemory, holderOf, equipMemory, levelUpMemory, memoryCostFor, memoryPassives } from '../systems/memories.js';
import { memoryStats, gearPieceStats } from '../systems/stats.js';
import { memoryCard } from './memoryCard.js';
import { bagList, equipGear, unequipGear, autoEquip, enhanceEquipped, enhanceCost, salvage, salvageValue, bulkSalvage, toggleLock, parsePiece } from '../systems/gear.js';
import { formatBig, RATIO_STATS, GEAR_SLOTS } from '../config.js';
import { describeSkill, describePassive, describeModifier } from '../battle/describe.js';

const SORTS = [
  { id: 'power', label: '전투력' },
  { id: 'level', label: '레벨' },
  { id: 'rarity', label: '희귀도' },
];
const TABS = [
  { id: 'level', label: '레벨업' },
  { id: 'skills', label: '스킬' },
  { id: 'break', label: '돌파' },
  { id: 'memory', label: '추억' },
  { id: 'gear', label: '장비' },
];
const SLOT_LABEL = { hp: '체력', def: '방어', crit: '치명', atk: '공격' };
const STAT_ROWS = [
  ['atk', '공격력'],
  ['def', '방어력'],
  ['hp', 'HP'],
  ['spd', '속도'],
  ['critRate', '치명타 확률'],
  ['critDmg', '치명타 피해'],
  ['energyRegen', '기력 회복'],
  ['effectHit', '효과 적중'],
  ['effectRes', '효과 저항'],
  ['healBonus', '치유 보너스'],
  ['shieldBonus', '보호막 보너스'],
];
/** 기본값이면 표에서 숨기는 능력치 (기력 회복 100%, 나머지 0%) */
const HIDE_DEFAULT = { energyRegen: 1, effectHit: 0, effectRes: 0, healBonus: 0, shieldBonus: 0 };
const ACTION_LABEL = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기' };

const num = (n) => Number(n).toLocaleString('ko-KR');
const fmtStat = (key, v) => (RATIO_STATS.includes(key) ? `${Math.round(v * 1000) / 10}%` : num(v));

/** 이 수정자가 어떤 행동에 영향을 주는지 (스킬 탭의 "돌파 N 적용" 표시용) */
function modifierAction(m) {
  if (m.type === 'action_targeting' || m.type === 'extra_effects') return m.action;
  if (m.type === 'effect_power') return m.action;
  if (m.type === 'sp_cost') return 'skill';
  if (m.type === 'ultimate_cost') return 'ultimate';
  if (m.type === 'energy_gain') return m.source === 'hit' ? null : m.source;
  return null;
}

export function growthScreen(ctx) {
  // 화면을 다시 열어도 정렬/탭 유지
  let sort = 'power';
  let tab = 'level';

  return {
    title: '육성',
    mount(el, params = {}) {
      const { balance, vocab } = ctx.data;
      let selectedId = params.id || null;
      let mode = '1'; // 레벨업 미리보기: '1' | '10' | 'max'

      const owned = () => ctx.data.characters.filter((c) => ctx.save.owned[c.id]);
      const powerOfChar = (c) => powerOf(statsOf(c, ctx.save.owned[c.id].level, ctx.save.owned[c.id].breakthrough, balance, extrasOf(ctx, c.id)), balance);

      const sortTabs = h('div', { class: 'filter-tabs' });
      const list = h('div', { class: 'grow-list' });
      const detail = h('div', { class: 'grow-detail' });

      function sorted() {
        const arr = owned().map((c) => ({ c, e: ctx.save.owned[c.id], p: powerOfChar(c) }));
        const by = {
          power: (a, b) => b.p - a.p,
          level: (a, b) => b.e.level - a.e.level || b.p - a.p,
          rarity: (a, b) => b.c.rarity - a.c.rarity || b.p - a.p,
        }[sort];
        return arr.sort((a, b) => by(a, b) || a.c.name.localeCompare(b.c.name, 'ko'));
      }

      function renderList() {
        sortTabs.replaceChildren(
          ...SORTS.map((s) =>
            h('button', { class: ['filter-tab', sort === s.id && 'active'], type: 'button', onclick: () => ((sort = s.id), renderList()) }, s.label),
          ),
        );
        const rows = sorted();
        if (!selectedId || !ctx.save.owned[selectedId]) selectedId = rows[0]?.c.id ?? null;
        list.replaceChildren(
          ...rows.map(({ c, e, p }) =>
            h(
              'button',
              { class: ['grow-row', `rar-${c.rarity}`, c.id === selectedId && 'active'], type: 'button', onclick: () => select(c.id) },
              h('div', { class: 'grow-thumb' }, charArt(c)),
              h(
                'div',
                { class: 'grow-row-main' },
                h('div', { class: 'grow-row-name' }, rarityBadge(c.rarity), c.name),
                h('div', { class: 'grow-row-sub' }, `Lv.${e.level}`, starRow(e.breakthrough)),
                h('div', { class: 'grow-row-power' }, `전투력 ${formatBig(p)}`),
              ),
              canBreakthrough(e, balance) && h('span', { class: 'menu-dot' }),
            ),
          ),
        );
        if (!rows.length) {
          list.append(
            h('div', { class: 'grow-empty' }, h('p', {}, '아직 함께하는 동료가 없어요'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('gacha') }, '뽑기로 가기')),
          );
        }
      }

      function select(id) {
        selectedId = id;
        mode = '1';
        renderList();
        renderDetail();
      }

      // ── 상세 ──
      function renderDetail() {
        const c = selectedId && ctx.data.charMap.get(selectedId);
        const e = c && ctx.save.owned[c.id];
        if (!c || !e) {
          detail.replaceChildren(h('div', { class: 'grow-none muted' }, '캐릭터를 골라 주세요'));
          return;
        }
        const extras = extrasOf(ctx, c.id);
        const stats = statsOf(c, e.level, e.breakthrough, balance, extras);
        const head = h(
          'div',
          { class: `grow-head rar-${c.rarity}` },
          h('div', { class: 'grow-art' }, charArt(c)),
          h(
            'div',
            { class: 'grow-head-info' },
            h('div', { class: 'detail-top' }, rarityBadge(c.rarity), starRow(e.breakthrough)),
            c.title && h('div', { class: 'muted' }, c.title),
            h('div', { class: 'grow-name' }, c.name),
            h('div', { class: 'grow-meta' }, h('b', {}, `Lv.${e.level}`), h('span', {}, `전투력 ${formatBig(powerOf(stats, balance))}`), h('span', {}, `정수 ${e.essence}`)),
          ),
        );
        const tabBar = h(
          'div',
          { class: 'grow-tabs', role: 'tablist' },
          TABS.map((t) =>
            h('button', { class: ['grow-tab', tab === t.id && 'active'], type: 'button', role: 'tab', onclick: () => ((tab = t.id), renderDetail()) }, t.label),
          ),
        );
        const body = tab === 'level' ? levelTab(c, e, stats, extras) : tab === 'skills' ? skillsTab(c, e) : tab === 'memory' ? memoryTab(c, e) : tab === 'gear' ? gearTab(c) : breakTab(c, e);
        detail.replaceChildren(head, tabBar, h('div', { class: 'grow-body' }, body));
      }

      function levelTab(c, e, stats, extras) {
        const gold = ctx.save.gold || 0;
        const max = maxAffordable(e.level, ctx.save.tickets, balance, 100000, gold);
        const n = mode === '10' ? 10 : mode === 'max' ? Math.max(1, max.n) : 1;
        const cost = costFor(e.level, n, balance);
        const goldCost = goldCostFor(e.level, n, balance);
        const after = statsOf(c, e.level + n, e.breakthrough, balance, extras);
        const okTickets = ctx.save.tickets >= cost;
        const okGold = gold >= goldCost;
        const can = okTickets && okGold;
        const pick = (v) => {
          mode = v;
          renderDetail();
        };
        const statTable = h(
          'table',
          { class: 'grow-stats' },
          h('tr', {}, h('th', {}, ''), h('th', {}, `Lv.${e.level}`), h('th', {}, `Lv.${e.level + n}`)),
          STAT_ROWS.filter(([k]) => !(k in HIDE_DEFAULT) || stats[k] !== HIDE_DEFAULT[k]).map(([k, label]) =>
            h('tr', {}, h('td', {}, label), h('td', {}, fmtStat(k, stats[k])), h('td', { class: after[k] > stats[k] ? 'up' : '' }, fmtStat(k, after[k]))),
          ),
          h('tr', { class: 'power-row' }, h('td', {}, '전투력'), h('td', {}, num(powerOf(stats, balance))), h('td', { class: 'up' }, num(powerOf(after, balance)))),
        );
        return h(
          'div',
          { class: 'grow-level' },
          h(
            'div',
            { class: 'grow-level-left' },
            h('div', { class: 'grow-pick' },
              h('button', { class: ['btn', mode === '1' && 'btn-selected'], type: 'button', onclick: () => pick('1') }, '+1'),
              h('button', { class: ['btn', mode === '10' && 'btn-selected'], type: 'button', onclick: () => pick('10') }, '+10'),
              h('button', { class: ['btn', mode === 'max' && 'btn-selected'], type: 'button', disabled: max.n < 1, onclick: () => pick('max') }, `MAX (+${max.n})`),
            ),
            h('div', { class: 'grow-cost' }, h('span', { class: 'muted' }, '필요 티켓'), h('b', { class: okTickets ? '' : 'bad' }, ticketIcon(), formatGems(cost)), h('span', { class: 'muted small' }, `보유 ${formatGems(ctx.save.tickets)}`)),
            goldCost > 0 && h('div', { class: 'grow-cost' }, h('span', { class: 'muted' }, '필요 골드'), h('b', { class: okGold ? '' : 'bad' }, goldIcon(), formatGems(goldCost)), h('span', { class: 'muted small' }, `보유 ${formatGems(gold)}`)),
            h(
              'button',
              {
                class: 'btn btn-primary grow-confirm',
                type: 'button',
                disabled: !can,
                onclick: () => {
                  if (!levelUp(ctx.save, c.id, n, balance)) return toast(okTickets ? '골드가 부족해요' : '티켓이 부족해요', { type: 'error' });
                  ctx.commit();
                  toast(`${c.name} Lv.${e.level}!`, { type: 'success' });
                  mode = '1';
                  renderList();
                  renderDetail();
                },
              },
              `레벨업 (Lv.${e.level} → ${e.level + n})`,
            ),
            !can &&
              h(
                'p',
                { class: 'muted small' },
                '티켓 · 골드는 스토리 전투, 매일 출석, 우편, ',
                h('button', { class: 'link-btn', type: 'button', onclick: () => go('shop') }, '상점'),
                '에서 얻어요',
              ),
          ),
          statTable,
        );
      }

      function skillsTab(c, e) {
        const unit = buildUnit({ entity: c, level: e.level, breakthrough: e.breakthrough, side: 'ally', slot: 0, uid: 'p', balance });
        // 지금 켜진 상시 능력 중 수정자가 있는 것 (특성 · 돌파 2/6 · 예전 돌파)
        const unlocked = [
          ...(c.talents || []).map((p) => ({ p, label: '특성' })),
          ...(c.bt2 && e.breakthrough >= 2 ? [{ p: c.bt2, label: '돌파 2' }] : []),
          ...(c.bt6 && e.breakthrough >= 6 ? [{ p: c.bt6, label: '돌파 6' }] : []),
          ...(c.breakthroughs || []).slice(0, e.breakthrough).map((p, i) => ({ p, label: `돌파 ${i + 1}` })),
        ];
        const res = c.resource;
        return h(
          'div',
          { class: 'grow-skills' },
          // 핵심 메커니즘 먼저: 자원 · 특성
          (res || (c.talents || []).length) &&
            h(
              'section',
              { class: 'skill-card skill-core' },
              h('div', { class: 'skill-head' }, h('span', { class: 'skill-kind' }, '핵심'), h('b', {}, res ? `${res.name} (최대 ${unit.res?.cap ?? res.cap})` : '특성')),
              (c.talents || []).map((p) => h('div', {}, h('b', { class: 'small' }, p.name), p.description && h('p', { class: 'skill-desc' }, p.description), h('ul', { class: 'skill-effects' }, describePassive(p, vocab).map((t) => h('li', {}, t))))),
            ),
          ['basic', 'skill', 'ultimate'].map((a) => {
            const s = unit.kit[a];
            if (!s) return null;
            const spCost = Math.max(0, balance.combat.sp.skillCost + unit.spCostDelta);
            const meta =
              a === 'skill'
                ? `SP ${spCost} 소모 · 기력 +${unit.energyGain.skill}`
                : a === 'ultimate'
                  ? `기력 ${unit.ultCost} · 턴을 쓰지 않음`
                  : `SP +${balance.combat.sp.basicGain} · 기력 +${unit.energyGain.basic}`;
            const applied = [];
            for (const { p, label } of unlocked) {
              for (const m of p.modifiers || []) {
                const act = modifierAction(m);
                if (act === a || (act === 'any' && m.type === 'effect_power')) applied.push(`${label} 적용: ${describeModifier(m, vocab)}`);
              }
            }
            return h(
              'section',
              { class: ['skill-card', `skill-${a}`] },
              h('div', { class: 'skill-head' }, h('span', { class: 'skill-kind' }, ACTION_LABEL[a]), h('b', {}, s.name), h('span', { class: 'muted small' }, meta)),
              s.description && h('p', { class: 'skill-desc' }, s.description),
              h('ul', { class: 'skill-effects' }, describeSkill(s, vocab, { stats: unit.base, effectPower: unit.effectPower, action: a }).map((t) => h('li', {}, t))),
              applied.length > 0 && h('ul', { class: 'skill-applied' }, applied.map((t) => h('li', {}, t))),
            );
          }),
        );
      }

      // ── 추억: 장착/교체 · 레벨업 · 재련 · 전용 보너스 ──
      let memMode = '1';
      function memoryTab(c) {
        const cur = ctx.save.equips?.[c.id]?.m;
        const inst = cur ? findMemory(ctx.save, cur) : null;
        const mem = inst && ctx.data.memoryMap.get(inst.id);
        const passiveLines = (p) => describePassive(p, vocab).map((t) => h('li', {}, t));
        let current;
        if (mem) {
          const ms = memoryStats(mem, inst.lv, balance);
          const ownerHere = mem.signatureOf === c.id;
          const owner = mem.signatureOf && ctx.data.allCharMap.get(mem.signatureOf);
          const maxLv = balance.memory.maxLevel;
          const n = Math.max(1, Math.min(maxLv - inst.lv, memMode === '10' ? 10 : memMode === 'max' ? maxLv - inst.lv : 1));
          const cost = memoryCostFor(inst.lv, n, ctx.save, balance);
          const can = inst.lv < maxLv && ctx.save.tickets >= cost.tickets && (ctx.save.gold || 0) >= cost.gold;
          const scaled = memoryPassives(mem, inst, c.id, balance);
          current = h(
            'div',
            { class: 'mem-current' },
            h('div', { class: 'mem-current-card' }, memoryCard(mem, { inst, owner })),
            h(
              'div',
              { class: 'mem-current-info' },
              h('div', { class: 'mem-stat-line' }, `공격력 +${num(ms.atk)}`, ms.secondary && ` · ${vocab.stats[ms.secondary.stat] || ms.secondary.stat} +${ms.secondary.pct}${RATIO_STATS.includes(ms.secondary.stat) ? '%p' : '%'}`),
              h('div', { class: 'muted small' }, `재련 R${inst.r}/5 — 같은 추억을 또 뽑으면 재련돼요 (패시브 수치 ×${balance.memory.refineScale[inst.r - 1]})`),
              h('h4', {}, '패시브'),
              scaled[0] && h('ul', { class: 'skill-effects' }, passiveLines(scaled[0])),
              mem.passive.owner &&
                h(
                  'div',
                  { class: ['mem-owner-bonus', ownerHere && 'is-on'] },
                  h('b', {}, ownerHere ? `★ 주인 보너스 (${c.name})` : `주인 보너스 — ${owner?.name || '주인'}이(가) 장착하면`),
                  h('ul', { class: 'skill-effects' }, passiveLines(ownerHere ? scaled[1] : mem.passive.owner)),
                ),
              h(
                'div',
                { class: 'level-modes' },
                [
                  ['1', '+1'],
                  ['10', '+10'],
                  ['max', 'MAX'],
                ].map(([v, label]) => h('button', { class: ['btn btn-ghost', memMode === v && 'active'], type: 'button', onclick: () => ((memMode = v), renderDetail()) }, label)),
              ),
              h('div', { class: 'small' }, `필요: 티켓 ${num(cost.tickets)} · 골드 ${num(cost.gold)}${cost.material ? ` · 추억 재료 ${num(cost.material)}` : ''} (보유 재료 ${num(ctx.save.memMat || 0)})`),
              h(
                'div',
                { class: 'row' },
                h(
                  'button',
                  {
                    class: 'btn btn-primary',
                    type: 'button',
                    disabled: !can,
                    onclick: () => {
                      if (!levelUpMemory(ctx.save, inst.u, n, balance)) return;
                      ctx.commit();
                      renderList();
                      renderDetail();
                    },
                  },
                  inst.lv >= maxLv ? '최대 레벨' : `추억 레벨업 (Lv.${inst.lv} → ${inst.lv + n})`,
                ),
                h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (equipMemory(ctx.save, c.id, null), ctx.commit(), renderList(), renderDetail()) }, '해제'),
              ),
            ),
          );
        } else current = h('p', { class: 'muted' }, '장착한 추억이 없어요. 아래에서 골라 주세요 — 역할 제한 없이 누구나 장착할 수 있어요.');

        // 가진 추억 (이 캐릭터 전용 먼저 → 희귀도 → 레벨)
        const owned = ctx.save.memories
          .map((m) => ({ m, d: ctx.data.memoryMap.get(m.id) }))
          .filter((x) => x.d)
          .sort((a, b) => (b.d.signatureOf === c.id) - (a.d.signatureOf === c.id) || b.d.rarity - a.d.rarity || b.m.lv - a.m.lv || a.m.u.localeCompare(b.m.u, 'en', { numeric: true }));
        const grid = h(
          'div',
          { class: 'mem-grid' },
          owned.map(({ m, d }) => {
            const holder = holderOf(ctx.save, m.u);
            const holderName = holder && holder !== c.id ? ctx.data.allCharMap.get(holder)?.name : null;
            return h(
              'button',
              {
                class: ['mem-pick', m.u === cur && 'is-equipped'],
                type: 'button',
                title: holderName ? `${holderName}이(가) 장착 중 — 누르면 옮겨요` : '',
                onclick: () => {
                  if (m.u === cur) return;
                  equipMemory(ctx.save, c.id, m.u);
                  ctx.commit();
                  if (holderName) toast(`「${d.name}」을(를) ${holderName}에게서 옮겼어요`, { type: 'info' });
                  renderList();
                  renderDetail();
                },
              },
              memoryCard(d, { inst: m, small: true, badge: m.u === cur ? '장착' : holderName ? holderName : '', badgeClass: m.u === cur ? 'badge-new' : 'badge-max' }),
            );
          }),
        );
        return h('div', { class: 'grow-memory' }, current, h('h4', {}, `가진 추억 ${owned.length}장`), owned.length ? grid : h('p', { class: 'muted' }, '추억 뽑기에서 얻을 수 있어요.'));
      }

      // ── 장비: 4칸(티어 테두리) · 강화 · 자동 장착 · 가방(장착/잠금/분해/일괄 분해) ──
      let salvageTier = 1;
      function gearTab(c) {
        const g = ctx.save.equips?.[c.id]?.g || {};
        const refresh = () => (ctx.commit(), renderList(), renderDetail());
        const statText = (slot, tier, enh) =>
          Object.entries(gearPieceStats(slot, tier, enh, balance))
            .map(([k, v]) => `${vocab.stats[k] || k} +${RATIO_STATS.includes(k) ? `${Math.round(v * 1000) / 10}%p` : num(v)}`)
            .join(' · ');
        const slots = GEAR_SLOTS.map((slot) => {
          const cur = parsePiece(g[slot]);
          const cost = cur && cur.enh < balance.gear.maxEnh ? enhanceCost(cur.tier, cur.enh, balance) : null;
          return h(
            'div',
            { class: ['gear-slot', cur && `tier-${cur.tier}`] },
            h('div', { class: 'gear-slot-head' }, h('b', {}, SLOT_LABEL[slot]), cur ? h('span', { class: 'gear-tier' }, `T${cur.tier} +${cur.enh}`) : h('span', { class: 'muted' }, '비어 있음')),
            cur && h('div', { class: 'small' }, statText(slot, cur.tier, cur.enh)),
            cur &&
              h(
                'div',
                { class: 'row' },
                h('button', { class: 'btn btn-primary', type: 'button', disabled: cost == null || (ctx.save.gearMat || 0) < cost, onclick: () => enhanceEquipped(ctx.save, c.id, slot, balance) && refresh() }, cost == null ? '최대 강화' : `강화 (강화석 ${num(cost)})`),
                h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => unequipGear(ctx.save, c.id, slot) && refresh() }, '해제'),
              ),
          );
        });
        const bag = bagList(ctx.save);
        const bagEl = h(
          'div',
          { class: 'gear-bag' },
          bag.length
            ? bag.map((x) =>
                h(
                  'div',
                  { class: ['gear-row', `tier-${x.tier}`] },
                  h('b', {}, `${SLOT_LABEL[x.slot]} T${x.tier} +${x.enh}`),
                  h('span', { class: 'muted small' }, `×${x.n} · ${statText(x.slot, x.tier, x.enh)}`),
                  h('span', { class: 'grow' }),
                  h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => equipGear(ctx.save, c.id, x.slot, x.tier, x.enh) && refresh() }, '장착'),
                  h('button', { class: ['btn btn-ghost', x.lock && 'active'], type: 'button', title: '잠그면 분해되지 않아요', onclick: () => (toggleLock(ctx.save, x.key), refresh()) }, x.lock ? '🔒' : '🔓'),
                  h('button', { class: 'btn btn-ghost', type: 'button', disabled: x.lock, onclick: () => salvage(ctx.save, x.key, 1, balance) && refresh() }, `분해 +${salvageValue(x.tier, x.enh, balance)}`),
                ),
              )
            : h('p', { class: 'muted' }, '가방이 비어 있어요. 스테이지를 클리어하면 장비가 나와요 (반복 전투 · 소탕으로 파밍).'),
        );
        const tierSel = h('select', { onchange: (ev) => (salvageTier = Number(ev.target.value)) }, Array.from({ length: balance.gear.tiers }, (_, i) => h('option', { value: i + 1 }, `T${i + 1} 이하`)));
        tierSel.value = String(salvageTier);
        return h(
          'div',
          { class: 'grow-gear' },
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => (autoEquip(ctx.save, c.id) ? refresh() : toast('더 좋은 장비가 없어요', { type: 'info' })) }, '자동 장착'),
            h('span', { class: 'muted small' }, `강화석 ${num(ctx.save.gearMat || 0)}`),
          ),
          h('div', { class: 'gear-slots' }, slots),
          h(
            'div',
            { class: 'row' },
            h('h4', {}, `가방 (${bag.reduce((a, x) => a + x.n, 0)}개)`),
            h('span', { class: 'grow' }),
            tierSel,
            h(
              'button',
              {
                class: 'btn btn-ghost',
                type: 'button',
                onclick: () => {
                  const r = bulkSalvage(ctx.save, salvageTier, balance);
                  if (!r.pieces) return toast('분해할 장비가 없어요 (잠금 제외)', { type: 'info' });
                  toast(`${r.pieces}개 분해 → 강화석 +${num(r.mat)}`, { type: 'success' });
                  refresh();
                },
              },
              '일괄 분해 (잠금 제외)',
            ),
          ),
          bagEl,
        );
      }

      function breakTab(c, e) {
        const nodes = breakthroughNodes(c, balance);
        const max = balance.essence.maxBreakthrough;
        const rate = essenceTicketRate(c.rarity, balance);
        return h(
          'div',
          { class: 'grow-break' },
          h(
            'div',
            { class: 'break-info' },
            h('span', {}, '정수 ', h('b', {}, e.essence)),
            h('span', { class: 'muted small' }, `중복 획득 시 정수 +1 · 돌파 + 정수가 ${max}이면 그 뒤로는 티켓 ${rate}장`),
          ),
          h(
            'ol',
            { class: 'break-nodes' },
            Array.from({ length: max }, (_, i) => {
              const node = nodes[i];
              const p = node?.kind === 'passive' ? node.passive : node?.kind === 'stat' ? { name: `${vocab.stats[node.stat] || node.stat} +${node.pct}${RATIO_STATS.includes(node.stat) ? '%p' : '%'}`, description: '' } : null;
              const state = i < e.breakthrough ? 'unlocked' : i === e.breakthrough && e.essence >= 1 ? 'ready' : 'locked';
              const stateLabel = { unlocked: '해금', ready: '돌파 가능', locked: '잠김' }[state];
              const lines = node?.kind === 'passive' ? describePassive(p, vocab) : [];
              return h(
                'li',
                { class: ['break-node', `is-${state}`] },
                h('div', { class: 'break-step' }, `돌파 ${i + 1}`, node?.kind === 'passive' && (i === 1 || i === 5) && h('span', { class: 'break-tag' }, i === 1 ? '강화' : '변형')),
                h(
                  'div',
                  { class: 'break-main' },
                  h('b', {}, p?.name || '능력 준비 중'),
                  p?.description && h('div', { class: 'small' }, p.description),
                  lines.length > 0 && h('ul', { class: 'break-lines' }, lines.map((t) => h('li', {}, t))),
                ),
                state === 'ready'
                  ? h(
                      'button',
                      {
                        class: 'btn btn-primary',
                        type: 'button',
                        onclick: () => {
                          if (!doBreakthrough(ctx.save, c.id, balance)) return;
                          ctx.commit();
                          toast(`${c.name} 돌파 ${i + 1}: ${p?.name || '해금'}`, { type: 'success' });
                          renderList();
                          renderDetail();
                        },
                      },
                      '돌파 (정수 1)',
                    )
                  : h('span', { class: 'break-state' }, stateLabel),
              );
            }),
          ),
        );
      }

      el.append(h('div', { class: 'grow-layout' }, h('aside', { class: 'grow-side' }, sortTabs, list), detail));
      renderList();
      renderDetail();
      return {
        onKey(e) {
          const tabKeys = { Digit1: 'level', Digit2: 'skills', Digit3: 'break', Digit4: 'memory', Digit5: 'gear' };
          if (tabKeys[e.code]) {
            tab = tabKeys[e.code];
            renderDetail();
            return true;
          }
          if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
            const rows = sorted();
            const i = rows.findIndex((r) => r.c.id === selectedId);
            const next = rows[(i + (e.code === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
            if (next) select(next.c.id);
            return true;
          }
          return false;
        },
      };
    },
  };
}
