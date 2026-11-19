// 뽑기 화면(배너) + 배너 상세 + 결과 연출(카드 뒤집기)
import { h, gemIcon } from './dom.js';
import { go, back } from './router.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { charCard, rarityBadge } from './charCard.js';
import { bannerVisual } from './home.js';
import { countdownEl, startCountdowns } from './countdown.js';
import { buildPools, isPoolEmpty, pullMany, rateTable, pityKeyOf, COST, PITY_LIMIT, RATES } from '../systems/gacha.js';
import { isBannerActive } from '../systems/banners.js';
import { canAfford, spendGems, formatGems } from '../systems/economy.js';
import { addCharacter } from '../systems/collection.js';
import { formatPeriod, now } from '../core/time.js';

/** id로 진행 중인 배너 찾기 (없으면 첫 배너) */
function findBanner(ctx, bannerId) {
  const list = ctx.activeBanners();
  return list.find((b) => b.id === bannerId) || list[0];
}

/**
 * 실제 뽑기 처리: 보석 확인 → 결과 계산 → 도감 반영 → 즉시 저장
 * 보석이 부족하거나 배너가 끝났거나 캐릭터가 없으면 아무것도 바꾸지 않고 null 반환
 */
export function executePull(ctx, banner, count) {
  if (!isBannerActive(banner)) {
    toast('이 배너는 기간이 끝났어요', { type: 'error' });
    return null;
  }
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
  const out = pullMany({ pools, count, pity: ctx.save.pity[key] ?? 0, guaranteed: !!ctx.save.guaranteed[key] });
  spendGems(ctx.save, cost);
  ctx.save.pity[key] = out.pity;
  ctx.save.guaranteed[key] = out.guaranteed;
  ctx.save.stats.pulls += count;
  const t = now();
  const detailed = out.results.map((r) => ({ ...r, ...addCharacter(ctx.save, r.char, ctx.data.balance, t) }));
  ctx.commit(); // 연출 전에 저장 → 새로고침해도 결과가 사라지지 않음
  return detailed;
}

/** 확률표 (상세 모달 안) */
function rateTableEl(pools) {
  return h(
    'div',
    { class: 'rate-table' },
    rateTable(pools).map((row) =>
      h(
        'section',
        { class: `rate-group rar-${row.rarity}` },
        h('div', { class: 'rate-head' }, rarityBadge(row.rarity), h('b', {}, `${row.rate}%`), h('span', { class: 'muted' }, `${row.count}명`)),
        row.characters.length
          ? h(
              'ul',
              { class: 'rate-list' },
              row.characters.map((x) =>
                h(
                  'li',
                  { class: x.pickup ? 'is-pickup' : null },
                  h('span', {}, x.char.name, x.pickup && h('em', { class: 'pickup-tag' }, '픽업')),
                  h('span', { class: 'muted' }, `${x.each.toFixed(3)}%`),
                ),
              ),
            )
          : h('p', { class: 'muted' }, '이 등급의 캐릭터가 없어 다른 등급으로 대체됩니다.'),
      ),
    ),
  );
}

/** 배너 상세: 기간, 픽업 미리보기, 규칙, 전체 확률표 */
export function showBannerDetail(ctx, banner) {
  const pools = buildPools(ctx.data.characters, banner);
  const pickups = [...pools.pickup.SSR, ...pools.pickup.SR, ...pools.pickup.R];
  const rules = [
    `${PITY_LIMIT}회 안에 SSR이 나오지 않으면 ${PITY_LIMIT}번째는 SSR 확정`,
    '10회 뽑기는 SR 이상 1장 확정',
    banner.type === 'pickup' && 'SSR 획득 시 50% 확률로 픽업 캐릭터 · 픽업이 아니었다면 다음 SSR은 픽업 확정',
    banner.type === 'pickup' ? '천장 횟수와 픽업 확정은 모든 픽업 배너가 함께 사용해요' : '천장 횟수는 픽업 배너와 따로 세요',
  ].filter(Boolean);

  const body = h(
    'div',
    { class: 'banner-detail' },
    h('p', { class: 'bd-period' }, `기간: ${formatPeriod(banner.startAt, banner.endAt)} (한국 시간)`),
    banner.description && h('p', { class: 'bd-desc' }, banner.description),
    pickups.length > 0 &&
      h(
        'section',
        {},
        h('h3', {}, '픽업 캐릭터'),
        h(
          'div',
          { class: 'bd-pickups' },
          pickups.map((c) => h('div', { class: 'bd-pickup' }, charCard(c, { owned: true, stars: 0 }), h('div', { class: 'bd-pickup-title' }, c.title))),
        ),
      ),
    h('h3', {}, '규칙'),
    h('ul', { class: 'bd-rules' }, rules.map((r) => h('li', {}, r))),
    h('h3', {}, '확률 정보'),
    rateTableEl(pools),
  );
  return openModal({ title: banner.title, body, className: 'modal-wide', dismissValue: true });
}

// ─────────────────────────────────────────────────────────
// 뽑기(배너) 화면
// ─────────────────────────────────────────────────────────
export function gachaScreen(ctx) {
  return {
    title: '뽑기',
    mount(el, params) {
      const banners = ctx.activeBanners();
      const banner = findBanner(ctx, params.bannerId);
      const pools = buildPools(ctx.data.characters, banner);
      const empty = isPoolEmpty(pools);
      const key = pityKeyOf(banner);
      const pity = ctx.save.pity[key] ?? 0;
      const index = banners.indexOf(banner);

      const switchTo = (b) => b && b !== banner && go('gacha', { bannerId: b.id }, { replace: true });
      const pull = (count) => {
        const results = executePull(ctx, banner, count);
        if (results) go('reveal', { results, bannerId: banner.id, count });
      };

      const pullButton = (count) =>
        h(
          'button',
          { class: ['pull-btn', count === 10 && 'pull-ten'], type: 'button', disabled: empty, onclick: () => pull(count) },
          h('span', { class: 'pull-label' }, `${count}회 뽑기`),
          h('span', { class: 'pull-cost' }, gemIcon(), formatGems(COST[count])),
          h('kbd', { class: 'key-hint' }, count === 10 ? '0' : '1'),
        );

      // 배너가 여러 개면 위쪽 탭으로 전환
      const tabs =
        banners.length > 1 &&
        h(
          'div',
          { class: 'banner-tabs', role: 'tablist' },
          banners.map((b) =>
            h(
              'button',
              { class: ['banner-tab', b === banner && 'active', b.type === 'pickup' && 'is-pickup'], type: 'button', role: 'tab', onclick: () => switchTo(b) },
              b.title,
            ),
          ),
        );

      const relatedStory = banner.relatedStoryId && ctx.data.storyIndex.find((s) => s.id === banner.relatedStoryId);
      const pickupNames = [...pools.pickup.SSR, ...pools.pickup.SR, ...pools.pickup.R].map((c) => c.name);

      el.append(
        h(
          'div',
          { class: ['gacha-main', tabs && 'has-tabs'] },
          tabs,
          h(
            'div',
            { class: 'gacha-banner' },
            bannerVisual(banner, ctx.data.charMap),
            h(
              'div',
              { class: 'gacha-banner-info' },
              h('span', { class: ['banner-tag', banner.type === 'pickup' && 'is-pickup'] }, banner.type === 'pickup' ? '픽업' : '상시'),
              h('h1', {}, banner.title),
              pickupNames.length > 0 && h('p', { class: 'gacha-pickup-names' }, `픽업: ${pickupNames.join(', ')}`),
              h('p', { class: 'gacha-period' }, formatPeriod(banner.startAt, banner.endAt), ' ', countdownEl(banner.endAt)),
            ),
          ),
        ),
        h(
          'aside',
          { class: 'gacha-side' },
          h(
            'div',
            { class: 'pity-box' },
            h('div', { class: 'pity-label' }, `SSR 확정까지 (${banner.type === 'pickup' ? '픽업' : '상시'})`),
            h('div', { class: 'pity-value' }, h('b', {}, PITY_LIMIT - pity), '회'),
            h('div', { class: 'pity-bar' }, h('i', { style: { width: `${(pity / PITY_LIMIT) * 100}%` } })),
            banner.type === 'pickup' &&
              h(
                'div',
                { class: ['pickup-state', ctx.save.guaranteed.pickup && 'on'] },
                ctx.save.guaranteed.pickup ? '다음 SSR은 픽업 확정!' : 'SSR 획득 시 50% 픽업',
              ),
          ),
          h('div', { class: 'rate-chips' }, ['SSR', 'SR', 'R'].map((r) => h('span', { class: `rate-chip rar-${r}` }, `${r} ${RATES[r]}%`))),
          h(
            'div',
            { class: 'gacha-links' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => showBannerDetail(ctx, banner) }, '상세 · 확률', h('kbd', { class: 'key-hint' }, 'I')),
            relatedStory &&
              h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go('stories', { kind: relatedStory.kind, focus: relatedStory.id }) }, '관련 스토리'),
          ),
          empty && h('p', { class: 'gacha-empty' }, '캐릭터 데이터가 없어요'),
          h('div', { class: 'pull-buttons' }, pullButton(1), pullButton(10)),
        ),
      );

      // 배너가 끝나면 남은 시간 표시가 '종료됨'으로 바뀌고, 다음 뽑기에서 안내
      const stop = startCountdowns(el);

      return {
        destroy: stop,
        onKey(e) {
          if (e.code === 'Digit1' || e.code === 'Numpad1') return pull(1), true;
          if (e.code === 'Digit0' || e.code === 'Numpad0') return pull(10), true;
          if (e.code === 'KeyI') return showBannerDetail(ctx, banner), true;
          if (e.code === 'ArrowRight' && banners.length > 1) return switchTo(banners[(index + 1) % banners.length]), true;
          if (e.code === 'ArrowLeft' && banners.length > 1) return switchTo(banners[(index - 1 + banners.length) % banners.length]), true;
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
        // 앞면: 결과 카드 + 배지(NEW / 정수 +1 / 티켓 +N)
        let badge = 'NEW';
        let badgeClass = 'badge-new';
        if (!r.isNew && r.essence) (badge = '정수 +1'), (badgeClass = 'badge-star');
        else if (!r.isNew) (badge = `티켓 +${r.tickets}`), (badgeClass = 'badge-max');

        const front = charCard(r.char, { owned: true, stars: r.breakthrough, badge, badgeClass });
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
          h(
            'div',
            { class: 'flip-inner' },
            h('div', { class: 'flip-face flip-back' }, h('div', { class: 'back-emblem' }, '✦')),
            h('div', { class: 'flip-face flip-front' }, front, r.isPickup && h('span', { class: 'pickup-ribbon' }, 'PICKUP')),
          ),
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
            if (banner.id !== bannerId) {
              toast('이 배너는 기간이 끝났어요', { type: 'error' });
              return;
            }
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
