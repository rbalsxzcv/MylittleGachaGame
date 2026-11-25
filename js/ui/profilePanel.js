// 캐릭터 프로필 패널 (CHARACTER_PROFILE.md 3장): 정보 · 프로필 · 이야기 · 대사 탭 — 도감 상세와 육성 '프로필' 버튼이 같이 씀
// 미보유면 정보 탭만 (나머지는 자물쇠). 이야기는 돌파로 열림, 대사를 누르면 그림 위 말풍선 2초
// 화면 데이터는 systems/profile.js profileView (순수)
import { h } from './dom.js';
import { openModal } from './modal.js';
import { go } from './router.js';
import { charArt, rarityBadge, starRow } from './charCard.js';
import { profileView, markStorySeen } from '../systems/profile.js';
import { storyState } from '../systems/stories.js';
import { ownedPower } from '../systems/teams.js';
import { formatKST } from '../core/time.js';
import { formatBig } from '../config.js';

export const PROFILE_TABS = [
  { id: 'info', label: '정보' },
  { id: 'profile', label: '프로필' },
  { id: 'stories', label: '이야기' },
  { id: 'lines', label: '대사' },
];
const BUBBLE_MS = 2000;

const lockIcon = () => h('span', { class: 'pp-lock', 'aria-hidden': 'true' });

/** 그림 위 말풍선 (같은 그림에는 하나만, 2초 뒤 사라짐) */
export function showBubble(artEl, text, ms = BUBBLE_MS) {
  if (!artEl || !text) return;
  artEl.querySelector('.pp-bubble')?.remove();
  const b = h('div', { class: 'pp-bubble', role: 'status' }, text);
  artEl.append(b);
  requestAnimationFrame(() => b.classList.add('show'));
  setTimeout(() => {
    b.classList.remove('show');
    setTimeout(() => b.remove(), 250);
  }, ms);
}

/** 이 캐릭터의 캐릭터 스토리가 (보이는 것이) 있는지 */
function hasCharacterStory(ctx, c) {
  const env = { save: ctx.save, index: ctx.data.storyIndex, charMap: ctx.data.allCharMap };
  return ctx.data.storyIndex.some((s) => s.kind === 'character' && s.characterId === c.id && storyState(s, env).visible);
}

/**
 * @param {object} ctx
 * @param {object} c 플레이어 캐릭터
 * @param {{tab?: string, artEl?: HTMLElement, onSeen?: () => void}} [opts]
 * @returns {{el: HTMLElement, onKey: (e: KeyboardEvent) => boolean}}
 */
export function profilePanel(ctx, c, { tab = 'info', artEl = null, onSeen = null } = {}) {
  const view = () => profileView(c, { save: ctx.save, allCharMap: ctx.data.allCharMap, charMap: ctx.data.charMap });
  let v = view();
  let current = v.owned ? tab : 'info';
  let reading = null; // 읽는 중인 이야기 번호
  const tabBar = h('div', { class: 'pp-tabs', role: 'tablist' });
  const body = h('div', { class: 'pp-body' });
  const el = h('div', { class: 'pp' }, tabBar, body);

  const enabled = (id) => id === 'info' || v.owned;

  function select(id) {
    if (!enabled(id)) return;
    current = id;
    reading = null;
    render();
  }

  function infoTab() {
    const entry = ctx.save.owned[c.id];
    return h(
      'div',
      { class: 'detail-info' },
      h('div', { class: 'detail-top' }, rarityBadge(c.rarity), entry && starRow(entry.breakthrough)),
      h('div', { class: 'detail-title' }, entry ? c.title : '아직 만나지 못한 동료'),
      h('div', { class: 'detail-name' }, entry ? c.name : '???'),
      h('p', { class: 'detail-desc' }, entry ? c.description || '소개가 아직 없어요.' : '뽑기에서 만나보세요.'),
      entry &&
        h(
          'dl',
          { class: 'detail-meta' },
          h('dt', {}, '레벨'),
          h('dd', {}, `Lv.${entry.level} · 돌파 ${entry.breakthrough} · 정수 ${entry.essence}`),
          h('dt', {}, '전투력'),
          h('dd', {}, formatBig(ownedPower(ctx, c))),
          h('dt', {}, '획득 횟수'),
          h('dd', {}, `${entry.count}회`),
          h('dt', {}, '처음 만난 날'),
          h('dd', {}, formatKST(entry.firstAt, { withTime: false })),
        ),
    );
  }

  function profileTab() {
    const facts = v.facts.length
      ? h(
          'dl',
          { class: 'pp-facts' },
          v.facts.flatMap((f) => [h('dt', {}, f.label), h('dd', {}, f.chips ? h('span', { class: 'pp-chips' }, f.chips.map((t) => h('span', { class: 'pp-chip' }, t))) : f.value)]),
        )
      : h('p', { class: 'muted' }, '프로필이 아직 없어요.');
    const rels = v.relations.length
      ? h(
          'ul',
          { class: 'pp-rels' },
          v.relations.map((r) =>
            h(
              'li',
              { class: ['pp-rel', !r.known && 'is-unknown'] },
              h('div', { class: 'pp-face' }, r.known ? charArt(r.char) : h('span', { class: 'pp-face-q' }, '?')),
              h('div', {}, h('b', {}, r.known ? `${r.char.name} · ${r.label}` : '???'), r.known && r.note && h('div', { class: 'muted small' }, r.note), !r.known && h('div', { class: 'muted small' }, '그 동료를 만나면 보여요')),
            ),
          ),
        )
      : null;
    return h('div', { class: 'pp-profile' }, facts, rels && h('h4', { class: 'pp-sub' }, '관계'), rels);
  }

  function storiesTab() {
    if (reading != null) {
      const s = v.stories[reading];
      return h(
        'div',
        { class: 'pp-reader' },
        h('button', { class: 'btn btn-ghost pp-back', type: 'button', onclick: () => ((reading = null), render()) }, '목록으로'),
        h('h3', {}, s.title),
        h('p', { class: 'pp-story-text' }, s.text),
      );
    }
    const charStory = hasCharacterStory(ctx, c);
    return h(
      'div',
      { class: 'pp-stories' },
      v.stories.length === 0 && h('p', { class: 'muted' }, '아직 이야기가 없어요.'),
      v.stories.map((s) =>
        s.locked
          ? h('div', { class: 'pp-story is-locked' }, lockIcon(), h('span', { class: 'pp-story-title' }, s.title), h('span', { class: 'muted small' }, `돌파 ${s.need}에서 열려요`))
          : h(
              'button',
              {
                class: 'pp-story',
                type: 'button',
                onclick: () => {
                  reading = s.index;
                  if (markStorySeen(ctx.save, c.id, s.index)) {
                    ctx.commit();
                    v = view();
                    onSeen?.();
                  }
                  render();
                },
              },
              h('span', { class: 'pp-story-title' }, s.title),
              s.isNew && h('span', { class: 'ccard-badge badge-new pp-new' }, 'NEW'),
            ),
      ),
      charStory && h('button', { class: 'btn pp-charstory', type: 'button', onclick: () => go('stories', { kind: 'character' }) }, '캐릭터 스토리 보러 가기'),
    );
  }

  function linesTab() {
    if (!v.lines.length) return h('p', { class: 'muted' }, '대사가 아직 없어요.');
    return h(
      'ul',
      { class: 'pp-lines' },
      v.lines.map((l) => h('li', {}, h('button', { class: 'pp-line', type: 'button', onclick: () => showBubble(artEl, l.text) }, h('span', { class: 'pp-line-label' }, l.label), h('span', { class: 'pp-line-text' }, `「${l.text}」`)))),
    );
  }

  function render() {
    tabBar.replaceChildren(
      ...PROFILE_TABS.map((t, i) => {
        const unseen = t.id === 'stories' && v.stories.some((s) => s.isNew);
        return h(
          'button',
          { class: ['pp-tab', current === t.id && 'active', !enabled(t.id) && 'is-locked'], type: 'button', role: 'tab', 'aria-selected': current === t.id ? 'true' : 'false', disabled: !enabled(t.id), title: enabled(t.id) ? `${t.label} (${i + 1})` : '만나면 열려요', onclick: () => select(t.id) },
          !enabled(t.id) && lockIcon(),
          t.label,
          unseen && h('span', { class: 'pp-dot', 'aria-label': '새 이야기' }),
        );
      }),
    );
    body.replaceChildren(current === 'profile' ? profileTab() : current === 'stories' ? storiesTab() : current === 'lines' ? linesTab() : infoTab());
    body.scrollTop = 0;
  }
  render();

  /** 키보드: 1~4 탭, ←/→ 이전/다음 탭 (잠긴 탭은 건너뜀) */
  function onKey(e) {
    const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code];
    if (idx != null) {
      select(PROFILE_TABS[idx].id);
      return true;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const open = PROFILE_TABS.filter((t) => enabled(t.id));
      const i = open.findIndex((t) => t.id === current);
      select(open[(i + (e.code === 'ArrowRight' ? 1 : -1) + open.length) % open.length].id);
      return true;
    }
    return false;
  }
  return { el, onKey };
}

/**
 * 그림(왼쪽) + 프로필 패널(오른쪽) 모달 — 도감 상세 / 육성 '프로필'
 * @param {object} ctx
 * @param {object} c
 * @param {{tab?: string, buttons?: Array, onSeen?: () => void}} [opts]
 */
export function openProfileModal(ctx, c, { tab = 'info', buttons = [{ label: '닫기', value: null }], onSeen = null } = {}) {
  const owned = !!ctx.save.owned[c.id];
  const artEl = h('div', { class: 'detail-art' }, charArt(c, { locked: !owned }));
  const panel = profilePanel(ctx, c, { tab, artEl, onSeen });
  const body = h('div', { class: `detail rar-${c.rarity}` }, artEl, panel.el);
  return openModal({ body, buttons, className: 'modal-detail', dismissValue: null, onKey: panel.onKey });
}
