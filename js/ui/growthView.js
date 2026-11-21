// 육성 화면: 보유 캐릭터 목록(전투력/레벨/희귀도 정렬) → 상세 (레벨업 / 스킬 / 돌파)
import { h, ticketIcon, goldIcon } from './dom.js';
import { toast } from './toast.js';
import { go } from './router.js';
import { charArt, rarityBadge, starRow } from './charCard.js';
import { formatGems } from '../systems/economy.js';
import {
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
import { formatBig } from '../config.js';
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
];
const STAT_ROWS = [
  ['atk', '공격력'],
  ['def', '방어력'],
  ['hp', 'HP'],
  ['spd', '속도'],
  ['critRate', '치명타 확률'],
  ['critDmg', '치명타 피해'],
];
const ACTION_LABEL = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기' };

const num = (n) => Number(n).toLocaleString('ko-KR');
const fmtStat = (key, v) => (key.startsWith('crit') ? `${Math.round(v * 1000) / 10}%` : num(v));

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
      const powerOfChar = (c) => powerOf(statsOf(c, ctx.save.owned[c.id].level, ctx.save.owned[c.id].breakthrough, balance), balance);

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
        const stats = statsOf(c, e.level, e.breakthrough, balance);
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
        const body = tab === 'level' ? levelTab(c, e, stats) : tab === 'skills' ? skillsTab(c, e) : breakTab(c, e);
        detail.replaceChildren(head, tabBar, h('div', { class: 'grow-body' }, body));
      }

      function levelTab(c, e, stats) {
        const gold = ctx.save.gold || 0;
        const max = maxAffordable(e.level, ctx.save.tickets, balance, 100000, gold);
        const n = mode === '10' ? 10 : mode === 'max' ? Math.max(1, max.n) : 1;
        const cost = costFor(e.level, n, balance);
        const goldCost = goldCostFor(e.level, n, balance);
        const after = statsOf(c, e.level + n, e.breakthrough, balance);
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
          STAT_ROWS.map(([k, label]) =>
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
        const unlocked = (c.breakthroughs || []).slice(0, e.breakthrough);
        return h(
          'div',
          { class: 'grow-skills' },
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
            unlocked.forEach((p, i) => {
              for (const m of p.modifiers || []) {
                const act = modifierAction(m);
                if (act === a || (act === 'any' && m.type === 'effect_power')) applied.push(`돌파 ${i + 1} 적용: ${describeModifier(m, vocab)}`);
              }
            });
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

      function breakTab(c, e) {
        const nodes = c.breakthroughs || [];
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
              const p = nodes[i];
              const state = i < e.breakthrough ? 'unlocked' : i === e.breakthrough && e.essence >= 1 ? 'ready' : 'locked';
              const stateLabel = { unlocked: '해금', ready: '돌파 가능', locked: '잠김' }[state];
              const lines = p ? describePassive(p, vocab) : [];
              return h(
                'li',
                { class: ['break-node', `is-${state}`] },
                h('div', { class: 'break-step' }, `돌파 ${i + 1}`),
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
          const tabKeys = { Digit1: 'level', Digit2: 'skills', Digit3: 'break' };
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
