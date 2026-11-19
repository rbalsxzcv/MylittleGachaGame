// 뽑기 화면(배너) + 결과 연출(카드 뒤집기)
import { h, gemIcon } from './dom.js';
import { go, back } from './router.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { charCard, rarityBadge } from './charCard.js';
import { bannerVisual } from './home.js';
import { buildPools, isPoolEmpty, pullMany, rateTable, COST, PITY_LIMIT, RATES, STANDARD_BANNER } from '../systems/gacha.js';
import { canAfford, spendGems, formatGems } from '../systems/economy.js';
import { addCharacter } from '../systems/collection.js';

function findBanner(ctx, bannerId) {
  return ctx.banners.find((b) => b.id === bannerId) || ctx.banners[0] || STANDARD_BANNER;
}

const pityKeyOf = (banner) => banner.pityKey || banner.type || 'standard';

/**
 * 실제 뽑기 처리: 보석 확인 → 결과 계산 → 도감 반영 → 즉시 저장
 * 보석이 부족하거나 캐릭터가 없으면 아무것도 바꾸지 않고 null 반환
 */
export function executePull(ctx, banner, count) {
  const pools = buildPools(ctx.data.characters, banner);
  if (isPoolEmpty(pools)) {
    toast('뽑을 수 있는 캐릭터가 없어요', { type: 'error' });
    return null;
  }
  const cost = COST[count];
  if (!canAfford(ctx.save, cost)) {
    toast(`보석이 부족해요 (필요 ${formatGems(cost)} / 보유 ${formatGems(ctx.save.gems)})`, { type: 'error' });
    return null;
  }

  const key = pityKeyOf(banner);
  const { results, pity } = pullMany({ pools, count, pity: ctx.save.pity[key] ?? 0 });
  spendGems(ctx.save, cost);
  ctx.save.pity[key] = pity;
  ctx.save.stats.pulls += count;
  const now = new Date();
  const detailed = results.map((r) => ({ ...r, ...addCharacter(ctx.save, r.char.id, now) }));
  ctx.commit(); // 연출 전에 저장 → 새로고침해도 결과가 사라지지 않음
  return detailed;
}

/** 확률 정보 모달 */
function showRates(pools) {
  const rows = rateTable(pools);
  const body = h(
    'div',
    { class: 'rate-table' },
    h('p', { class: 'rate-note' }, `${PITY_LIMIT}회 안에 SSR이 나오지 않으면 ${PITY_LIMIT}번째는 SSR 확정 · 10회 뽑기는 SR 이상 1장 확정`),
    rows.map((row) =>
      h(
        'section',
        { class: `rate-group rar-${row.rarity}` },
        h('div', { class: 'rate-head' }, rarityBadge(row.rarity), h('b', {}, `${row.rate}%`), h('span', { class: 'muted' }, `${row.characters.length}명`)),
        row.characters.length
          ? h(
              'ul',
              { class: 'rate-list' },
              row.characters.map((c) => h('li', {}, h('span', {}, c.name), h('span', { class: 'muted' }, `${row.each.toFixed(3)}%`))),
            )
          : h('p', { class: 'muted' }, '이 등급의 캐릭터가 없어 다른 등급으로 대체됩니다.'),
      ),
    ),
  );
  openModal({ title: '확률 정보', body, className: 'modal-wide', dismissValue: true });
}

// ─────────────────────────────────────────────────────────
// 뽑기(배너) 화면
// ─────────────────────────────────────────────────────────
export function gachaScreen(ctx) {
  return {
    title: '뽑기',
    mount(el, params) {
      const banner = findBanner(ctx, params.bannerId);
      const pools = buildPools(ctx.data.characters, banner);
      const empty = isPoolEmpty(pools);
      const pity = ctx.save.pity[pityKeyOf(banner)] ?? 0;

      const pull = (count) => {
        const results = executePull(ctx, banner, count);
        if (results) go('reveal', { results, bannerId: banner.id, count });
      };

      const pullButton = (count) =>
        h(
          'button',
          {
            class: ['pull-btn', count === 10 && 'pull-ten'],
            type: 'button',
            disabled: empty,
            onclick: () => pull(count),
          },
          h('span', { class: 'pull-label' }, `${count}회 뽑기`),
          h('span', { class: 'pull-cost' }, gemIcon(), formatGems(COST[count])),
          h('kbd', { class: 'key-hint' }, count === 10 ? '0' : '1'),
        );

      el.append(
        h(
          'div',
          { class: 'gacha-banner' },
          bannerVisual(banner),
          h(
            'div',
            { class: 'gacha-banner-info' },
            h('span', { class: 'banner-tag' }, banner.type === 'pickup' ? '픽업' : '상시'),
            h('h1', {}, banner.title),
            h('p', {}, banner.description),
          ),
        ),
        h(
          'aside',
          { class: 'gacha-side' },
          h(
            'div',
            { class: 'pity-box' },
            h('div', { class: 'pity-label' }, 'SSR 확정까지'),
            h('div', { class: 'pity-value' }, h('b', {}, PITY_LIMIT - pity), '회'),
            h('div', { class: 'pity-bar' }, h('i', { style: { width: `${(pity / PITY_LIMIT) * 100}%` } })),
          ),
          h(
            'div',
            { class: 'rate-chips' },
            ['SSR', 'SR', 'R'].map((r) => h('span', { class: `rate-chip rar-${r}` }, `${r} ${RATES[r]}%`)),
          ),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => showRates(pools) }, '확률 정보 보기'),
          empty && h('p', { class: 'gacha-empty' }, '캐릭터 데이터가 없어요'),
          h('div', { class: 'pull-buttons' }, pullButton(1), pullButton(10)),
        ),
      );

      return {
        onKey(e) {
          if (e.code === 'Digit1' || e.code === 'Numpad1') return pull(1), true;
          if (e.code === 'Digit0' || e.code === 'Numpad0') return pull(10), true;
          return false;
        },
      };
    },
  };
}

// ─────────────────────────────────────────────────────────
// 결과 연출 화면 (카드 뒤집기)
// ─────────────────────────────────────────────────────────
export function revealScreen(ctx) {
  return {
    hud: 'gems',
    transient: true,
    mount(el, { results = [], bannerId, count = 1 }) {
      if (!results.length) {
        back();
        return {};
      }
      const single = results.length === 1;
      let done = false;

      const cards = results.map((r, i) => {
        // 앞면: 결과 카드 + 배지(NEW / ★+1 / MAX)
        let badge = null;
        let badgeClass = '';
        if (r.isNew) (badge = 'NEW'), (badgeClass = 'badge-new');
        else if (r.starUp) (badge = '★+1'), (badgeClass = 'badge-star');
        else (badge = 'MAX'), (badgeClass = 'badge-max');

        const front = charCard(r.char, { owned: true, stars: r.stars, badge, badgeClass });
        const card = h(
          'button',
          {
            class: ['flip', `rar-${r.rarity}`],
            type: 'button',
            style: { '--delay': `${i * 40}ms` },
            'aria-label': `${i + 1}번째 카드 뒤집기`,
            // 클릭해도 포커스를 가져가지 않게 → Space/Enter가 항상 '다음 카드'로 동작
            onmousedown: (e) => e.preventDefault(),
            onclick: () => flip(i),
          },
          h('div', { class: 'flip-inner' }, h('div', { class: 'flip-face flip-back' }, h('div', { class: 'back-emblem' }, '✦')), h('div', { class: 'flip-face flip-front' }, front)),
        );
        return { el: card, flipped: false, rarity: r.rarity };
      });

      const grid = h('div', { class: ['reveal-grid', single ? 'is-single' : 'is-ten'] }, cards.map((c) => c.el));

      const openAllBtn = h('button', { class: 'btn', type: 'button', onclick: () => openAll() }, '모두 열기', h('kbd', { class: 'key-hint' }, 'A'));
      const skipBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => skip() }, 'SKIP', h('kbd', { class: 'key-hint' }, 'S'));
      const progressActions = h('div', { class: 'reveal-actions' }, openAllBtn, skipBtn);

      const againBtn = h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            const banner = findBanner(ctx, bannerId);
            const next = executePull(ctx, banner, count);
            if (next) go('reveal', { results: next, bannerId, count }, { replace: true });
          },
        },
        `한 번 더 ${count}회 `,
        h('span', { class: 'pull-cost' }, gemIcon(), formatGems(COST[count])),
      );
      const okBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => back() }, '확인');
      const doneActions = h('div', { class: 'reveal-actions', hidden: true }, againBtn, okBtn);

      el.append(h('div', { class: 'reveal-bg' }), h('div', { class: 'reveal-title' }, '모집 결과'), grid, progressActions, doneActions);

      function flip(i, { instant = false } = {}) {
        const c = cards[i];
        if (!c || c.flipped) return;
        c.flipped = true;
        if (instant) c.el.classList.add('instant');
        c.el.classList.add('flipped');
        if (c.rarity === 'SSR' && !instant) c.el.classList.add('burst');
        if (cards.every((x) => x.flipped)) finish();
      }
      function flipNext() {
        const i = cards.findIndex((c) => !c.flipped);
        if (i >= 0) flip(i);
      }
      function openAll() {
        cards.forEach((c, i) => {
          if (!c.flipped) setTimeout(() => flip(i), i * 90);
        });
      }
      function skip() {
        cards.forEach((_, i) => flip(i, { instant: true }));
      }
      function finish() {
        if (done) return;
        done = true;
        progressActions.hidden = true;
        doneActions.hidden = false;
        // 연출이 끝날 즈음 확인 버튼에 포커스 (Enter로 바로 닫기)
        setTimeout(() => okBtn.focus({ preventScroll: true }), 50);
      }

      return {
        onKey(e) {
          if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
            done ? back() : flipNext();
            return true;
          }
          if (e.code === 'KeyS' && !done) return skip(), true;
          if (e.code === 'KeyA' && !done) return openAll(), true;
          if (e.code === 'Escape') {
            done ? back() : skip();
            return true;
          }
          return false;
        },
      };
    },
  };
}
