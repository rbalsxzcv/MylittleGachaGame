// 도감 화면: 보유(그림) / 미보유(실루엣), 별, NEW, 상세 보기
import { h } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { charCard, charArt, rarityBadge, starRow } from './charCard.js';
import { isOwned, isMarkedNew, markSeen, sortCharacters, ownedCount } from '../systems/collection.js';
import { formatKST } from '../core/time.js';
import { ownedPower } from '../systems/teams.js';
import { formatBig } from '../config.js';

const FILTERS = [
  { id: 'all', label: '전체' },
  ...[5, 4, 3, 2, 1].map((r) => ({ id: `r${r}`, label: `${r}★`, rarity: r })),
  { id: 'owned', label: '보유' },
];

export function collectionScreen(ctx) {
  // 화면을 다시 열어도 마지막 필터 유지
  let filter = 'all';

  return {
    title: '도감',
    mount(el) {
      // 스토리 전용 인물(pullable: false)은 도감에 없음
      const characters = ctx.data.characters.filter((c) => c.pullable !== false);
      const grid = h('div', { class: 'collection-grid' });
      const tabs = h(
        'div',
        { class: 'filter-tabs', role: 'tablist' },
        FILTERS.map((f) =>
          h(
            'button',
            {
              class: 'filter-tab',
              type: 'button',
              role: 'tab',
              dataset: { filter: f.id },
              onclick: () => {
                filter = f.id;
                render();
              },
            },
            f.label,
          ),
        ),
      );
      const counter = h('div', { class: 'collection-count' });

      function render() {
        [...tabs.children].forEach((t) => t.classList.toggle('active', t.dataset.filter === filter));
        counter.replaceChildren('보유 ', h('b', {}, ownedCount(ctx.save, characters)), ` / ${characters.length}`);

        const list = sortCharacters(characters).filter((c) => {
          if (filter === 'all') return true;
          if (filter === 'owned') return isOwned(ctx.save, c.id);
          return `r${c.rarity}` === filter;
        });

        grid.replaceChildren(
          ...list.map((c) => {
            const entry = ctx.save.owned[c.id];
            const isNew = isMarkedNew(ctx.save, c.id);
            return charCard(c, {
              owned: !!entry,
              breakthrough: entry?.breakthrough ?? 0,
              essence: entry ? entry.essence : null,
              badge: isNew ? 'NEW' : null,
              badgeClass: 'badge-new',
              onClick: () => openDetail(c),
            });
          }),
        );
        if (list.length === 0) {
          grid.append(h('p', { class: 'collection-empty' }, characters.length ? '해당하는 캐릭터가 없어요' : '캐릭터 데이터가 없어요'));
        }
      }

      function openDetail(c) {
        // 상세를 열면 NEW 해제
        if (markSeen(ctx.save, c.id)) {
          ctx.commit();
          render();
        }
        const entry = ctx.save.owned[c.id];
        const owned = !!entry;
        const isFeatured = ctx.save.featuredId === c.id;

        const body = h(
          'div',
          { class: `detail rar-${c.rarity}` },
          h('div', { class: 'detail-art' }, charArt(c, { locked: !owned })),
          h(
            'div',
            { class: 'detail-info' },
            h('div', { class: 'detail-top' }, rarityBadge(c.rarity), owned && starRow(entry.breakthrough)),
            h('div', { class: 'detail-title' }, owned ? c.title : '아직 만나지 못한 동료'),
            h('div', { class: 'detail-name' }, owned ? c.name : '???'),
            h('p', { class: 'detail-desc' }, owned ? c.description || '소개가 아직 없어요.' : '뽑기에서 만나보세요.'),
            owned &&
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
          ),
        );

        const buttons = [{ label: '닫기', value: null }];
        if (owned) {
          buttons.unshift({
            label: isFeatured ? '대표 캐릭터 ✓' : '대표 캐릭터로 설정',
            disabled: isFeatured,
            primary: true,
            onClick: () => {
              ctx.save.featuredId = c.id;
              ctx.commit();
              toast(`${c.name}을(를) 대표 캐릭터로 설정했어요`, { type: 'success' });
            },
          });
        }
        openModal({ body, buttons, className: 'modal-detail', dismissValue: null });
      }

      el.append(h('div', { class: 'collection-head' }, tabs, counter), h('div', { class: 'collection-scroll' }, grid));
      render();
      return {};
    },
  };
}
