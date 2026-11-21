// 편성 화면: 프리셋 3개 × 5칸, 칸을 누르면 캐릭터 고르기, 총 전투력
// teamPanel / openTeamEditor는 스토리 전투 전 화면에서도 씀 (스토리를 떠나지 않고 편성 변경)
import { h } from './dom.js';
import { openModal, closeTopModal, promptModal } from './modal.js';
import { charArt, rarityBadge, starRow } from './charCard.js';
import { charPower } from '../systems/progression.js';
import { presetOf, setActive, setSlot, renamePreset, teamPower } from '../systems/teams.js';

import { formatBig } from '../config.js';

// 전투력은 큰 숫자 표기 (12,345 → 1.2만)
const num = (n) => formatBig(n);

/** 캐릭터 고르기 모달 → 고른 id, '' (비우기), null (취소) */
export async function pickCharacter(ctx, { presetIdx, slot }) {
  const { balance } = ctx.data;
  const slots = presetOf(ctx.save, presetIdx).slots;
  const current = slots[slot];
  const list = ctx.data.characters
    .filter((c) => ctx.save.owned[c.id])
    .map((c) => ({ c, e: ctx.save.owned[c.id], p: charPower(c, ctx.save.owned[c.id], balance) }))
    .sort((a, b) => b.p - a.p);
  let picked = null;
  const grid = h(
    'div',
    { class: 'pick-grid' },
    list.map(({ c, e, p }) => {
      const at = slots.indexOf(c.id);
      return h(
        'button',
        {
          class: ['pick-card', `rar-${c.rarity}`, c.id === current && 'is-current'],
          type: 'button',
          onclick: () => {
            picked = c.id;
            closeTopModal();
          },
        },
        h('div', { class: 'pick-art' }, charArt(c)),
        rarityBadge(c.rarity),
        at >= 0 && h('span', { class: 'pick-slot' }, `${at + 1}번`),
        h('div', { class: 'pick-name' }, c.name),
        h('div', { class: 'pick-sub' }, `Lv.${e.level} · ${num(p)}`),
      );
    }),
    list.length === 0 && h('p', { class: 'muted' }, '보유한 캐릭터가 없어요'),
  );
  const result = await openModal({
    title: `${slot + 1}번 칸`,
    body: grid,
    className: 'modal-wide modal-pick',
    dismissValue: 'cancel',
    buttons: [
      { label: '취소', value: 'cancel' },
      { label: '비우기', value: 'clear', disabled: !current },
    ],
  });
  if (picked) return picked;
  if (result === 'clear') return '';
  return null;
}

/**
 * 편성 패널 (프리셋 탭 + 5칸 + 총 전투력)
 * @param {object} ctx
 * @param {{onChange?:()=>void}} [opts]
 */
export function teamPanel(ctx, { onChange } = {}) {
  let view = ctx.save.teams.active; // 보고 있는 프리셋
  const root = h('div', { class: 'team-panel' });

  const changed = () => {
    ctx.commit();
    render();
    onChange?.();
  };

  function render() {
    const preset = presetOf(ctx.save, view);
    const isActive = ctx.save.teams.active === view;
    const tabs = h(
      'div',
      { class: 'filter-tabs team-tabs' },
      ctx.save.teams.presets.map((p, i) =>
        h(
          'button',
          { class: ['filter-tab', view === i && 'active'], type: 'button', onclick: () => ((view = i), render()) },
          p.name,
          ctx.save.teams.active === i && h('span', { class: 'team-using' }, '사용 중'),
        ),
      ),
    );
    const actions = h(
      'div',
      { class: 'team-actions' },
      h('div', { class: 'team-power' }, '총 전투력 ', h('b', {}, num(teamPower(ctx, view)))),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            const name = await promptModal('편성 이름', preset.name, { maxLength: 12 });
            if (name) {
              renamePreset(ctx.save, view, name);
              changed();
            }
          },
        },
        '이름 바꾸기',
      ),
      h(
        'button',
        { class: ['btn', !isActive && 'btn-primary'], type: 'button', disabled: isActive, onclick: () => (setActive(ctx.save, view), changed()) },
        isActive ? '전투에 사용 중' : '이 편성 사용',
      ),
    );
    const slots = h(
      'div',
      { class: 'team-slots' },
      preset.slots.map((id, slot) => {
        const c = id && ctx.data.charMap.get(id);
        const e = c && ctx.save.owned[id];
        const onClick = async () => {
          const r = await pickCharacter(ctx, { presetIdx: view, slot });
          if (r === null) return;
          setSlot(ctx.save, view, slot, r || null);
          changed();
        };
        if (!c || !e) {
          return h('button', { class: 'team-slot is-empty', type: 'button', onclick: onClick }, h('span', { class: 'slot-no' }, slot + 1), h('span', { class: 'slot-plus' }, '+'), h('span', { class: 'muted small' }, '비어 있음'));
        }
        return h(
          'button',
          { class: ['team-slot', `rar-${c.rarity}`], type: 'button', onclick: onClick },
          h('span', { class: 'slot-no' }, slot + 1),
          h('div', { class: 'slot-art' }, charArt(c)),
          rarityBadge(c.rarity),
          h('div', { class: 'slot-plate' }, h('div', { class: 'slot-name' }, c.name), h('div', { class: 'slot-sub' }, `Lv.${e.level}`, starRow(e.breakthrough)), h('div', { class: 'slot-power' }, num(charPower(c, e, ctx.data.balance)))),
        );
      }),
    );
    root.replaceChildren(tabs, slots, actions);
  }

  render();
  return { el: root, render };
}

/** 모달로 편성 바꾸기 (스토리 전투 전) */
export async function openTeamEditor(ctx) {
  const panel = teamPanel(ctx);
  await openModal({ title: '편성', body: panel.el, className: 'modal-team', dismissValue: null, buttons: [{ label: '완료', value: null, primary: true }] });
}

export function teamScreen(ctx) {
  return {
    title: '편성',
    mount(el) {
      const panel = teamPanel(ctx);
      el.append(
        h(
          'div',
          { class: 'team-screen' },
          panel.el,
          h('p', { class: 'muted small team-note' }, '칸을 눌러 캐릭터를 넣거나 바꿔요. 스토리 전투에는 "사용 중" 편성이 나가요. 1번 칸부터 차례로 행동해요.'),
        ),
      );
      return {
        onKey(e) {
          const m = /^Digit([1-5])$/.exec(e.code);
          if (m) {
            el.querySelectorAll('.team-slot')[Number(m[1]) - 1]?.click();
            return true;
          }
          return false;
        },
      };
    },
  };
}
