// 상점 화면: 골드 상점 + 가상 캐시 상점 (원화 가격은 연출일 뿐 실제 결제는 없어요)
// 상품 목록은 data/shop.json, 구매 규칙은 systems/shop.js
import { h, currencyIcon } from './dom.js';
import { toast } from './toast.js';
import { openModal, confirmModal } from './modal.js';
import { iconOr } from './theme.js';
import { formatGems, formatKRW, rewardEntries, rewardText } from '../systems/economy.js';
import { now, nextResetAt, formatRemaining } from '../core/time.js';
import {
  limitLabel,
  lockReason,
  goldItemState,
  buyGoldItem,
  cashItemState,
  buyCashItem,
  hasFirstBonus,
  claimPassDaily,
  passDaysLeft,
  vipProgress,
} from '../systems/shop.js';

const TABS = [
  { id: 'gold', label: '골드 상점', key: '1' },
  { id: 'cash', label: '캐시 상점', key: '2' },
];
const CATEGORIES = [
  { id: 'featured', label: '추천', icon: '★' },
  { id: 'package', label: '패키지', icon: '▦' },
  { id: 'growth', label: '성장', icon: '❦' },
  { id: 'gems', label: '보석', icon: '◆' },
  { id: 'pass', label: '월정액', icon: '☾' },
];
const GLYPH = { gift: '✿', chest: '▦', cart: '⚜', crown: '♛', moon: '☾', sprout: '❦' };
const CURRENCY_OF_ICON = { gem: 'gems', ticket: 'tickets', gold: 'gold', scroll: 'scrolls' };
const PAY_DELAY_MS = 1100;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** replaceChildren인데 false/null은 건너뜀 (h()의 자식 규칙과 같게) */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

/** 재화 알림 토스트: "모집 증서 10장 · 골드 100,000" */
function gotToast(rewards, prefix = '') {
  const text = rewardText(rewards);
  toast(`${prefix}${text ? `${text} 획득!` : '구매 완료!'}`, { type: 'success', duration: 3000 });
}

/** 상품 그림: ui.json icons의 shop_<icon>이 있으면 그림, 없으면 CSS 메달 */
function shopArt(item) {
  const cur = CURRENCY_OF_ICON[item.icon];
  const fallback = cur ? h('span', { class: 'sc-art-cur' }, currencyIcon(cur)) : h('span', { class: 'sc-art-glyph' }, GLYPH[item.icon] || '✦');
  return h('div', { class: ['sc-art', `icon-${item.icon}`] }, h('i', { class: 'sc-rays', 'aria-hidden': 'true' }), iconOr(`shop_${item.icon}`, fallback, 'sc-art-img'));
}

/** 구성품 목록 (첫 구매 보너스는 따로 강조) */
function rewardList(rewards, bonus) {
  return h(
    'ul',
    { class: 'sc-rewards' },
    rewardEntries(rewards).map((e) =>
      h(
        'li',
        {},
        currencyIcon(e.key),
        h('span', { class: 'sc-rw-label' }, e.label),
        h('b', {}, formatGems(e.amount)),
        bonus?.[e.key] > 0 && h('em', { class: 'sc-bonus' }, `+${formatGems(bonus[e.key])}`),
      ),
    ),
  );
}

/** 다음 초기화까지 남은 시간 (data-reset 요소는 화면 타이머가 갱신) */
function resetEl(item) {
  const per = item.limit?.per;
  const at = per && per !== 'once' ? nextResetAt(per) : null;
  if (!at) return null;
  return h('span', { class: 'sc-reset', dataset: { reset: at.toISOString() } }, `초기화까지 ${formatRemaining(at - now())}`);
}

export function shopScreen(ctx) {
  // 화면을 다시 열어도 탭/분류 유지
  let tab = 'cash';
  let category = 'featured';

  return {
    title: '상점',
    mount(el, params = {}) {
      if (TABS.some((t) => t.id === params.tab)) tab = params.tab;
      if (CATEGORIES.some((c) => c.id === params.category)) category = params.category;
      const shop = ctx.data.shop;

      // 날짜가 바뀐 채로 상점에 들어오면 월정액 오늘 몫 받기
      const pass = claimPassDaily(ctx.save);
      if (pass) {
        ctx.commit();
        toast(`월간 축복: 보석 ${pass.gems}개를 받았어요 (남은 ${pass.daysLeft}일)`, { type: 'success', duration: 3500 });
      }

      const side = h('aside', { class: 'shop-side' });
      const head = h('div', { class: 'shop-head' });
      const shelf = h('div', { class: 'shop-shelf' });

      // PC 마우스 휠로 가로 스크롤
      shelf.addEventListener(
        'wheel',
        (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            shelf.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        },
        { passive: false },
      );

      function render({ keepScroll = false } = {}) {
        const scroll = keepScroll ? shelf.scrollLeft : 0;
        renderSide();
        if (tab === 'gold') renderGold();
        else renderCash();
        shelf.scrollLeft = scroll;
      }

      function renderSide() {
        fill(
          side,
          h(
            'div',
            { class: 'shop-tabs', role: 'tablist' },
            TABS.map((t) =>
              h(
                'button',
                { class: ['shop-tab', `shop-tab-${t.id}`, tab === t.id && 'active'], type: 'button', role: 'tab', onclick: () => ((tab = t.id), render()) },
                t.label,
                h('kbd', { class: 'key-hint' }, t.key),
              ),
            ),
          ),
          tab === 'cash' &&
            h(
              'div',
              { class: 'shop-cats' },
              CATEGORIES.map((c) =>
                h(
                  'button',
                  { class: ['shop-cat', category === c.id && 'active'], type: 'button', onclick: () => ((category = c.id), render()) },
                  h('span', { class: 'shop-cat-icon', 'aria-hidden': 'true' }, c.icon),
                  c.label,
                  hasNewDeal(c.id) && h('span', { class: 'shop-cat-hot' }, 'HOT'),
                ),
              ),
            ),
        );
      }

      /** 이 분류에 첫 구매 보너스나 1회 한정 상품이 남아 있으면 HOT 표시 */
      function hasNewDeal(cat) {
        return shop.cash.some((i) => i.category === cat && (hasFirstBonus(ctx.save, i) || i.limit?.per === 'once') && cashItemState(ctx.save, i, ctx.data.stages) === 'ok');
      }

      // ── 골드 상점 ──
      function renderGold() {
        head.className = 'shop-head shop-head-gold';
        fill(head,
          h('div', { class: 'sh-gold-total' }, currencyIcon('gold'), h('b', {}, formatGems(ctx.save.gold || 0)), h('span', { class: 'muted small' }, '보유 골드')),
          h('p', { class: 'muted small sh-note' }, '골드는 스토리 전투 · 매일 출석 · 우편으로 받아요. 구매 횟수는 매일 자정(한국 시간)에 초기화돼요.'),
        );
        shelf.className = 'shop-shelf shelf-gold';
        shelf.replaceChildren(...shop.gold.map(goldCard));
        if (!shop.gold.length) shelf.append(h('p', { class: 'collection-empty' }, '판매 중인 상품이 없어요'));
      }

      function goldCard(item) {
        const state = goldItemState(ctx.save, item);
        const free = item.cost.gold === 0 && item.cost.gems === 0;
        const price = free
          ? h('span', { class: 'sc-price-free' }, '무료')
          : [
              item.cost.gold > 0 && h('span', { class: ['sc-price-cur', state === 'gold' && 'bad'] }, currencyIcon('gold'), formatGems(item.cost.gold)),
              item.cost.gems > 0 && h('span', { class: ['sc-price-cur', state === 'gems' && 'bad'] }, currencyIcon('gems'), formatGems(item.cost.gems)),
            ];
        return h(
          'button',
          {
            class: ['shop-card', 'gold-card', `icon-${item.icon}`, state === 'soldout' && 'is-soldout', free && state === 'ok' && 'is-free'],
            type: 'button',
            disabled: state === 'soldout',
            onclick: () => buyGold(item),
          },
          item.badges.length > 0 && h('div', { class: 'sc-ribbons' }, item.badges.map((b) => h('span', { class: 'sc-ribbon' }, b))),
          shopArt(item),
          h('div', { class: 'sc-name' }, item.name),
          item.desc && h('div', { class: 'sc-desc' }, item.desc),
          rewardList(item.rewards),
          h('div', { class: 'sc-limit' }, limitLabel(ctx.save, item), resetEl(item)),
          h('div', { class: 'sc-price' }, price),
          state === 'soldout' && h('div', { class: 'sc-overlay' }, '구매 완료'),
        );
      }

      async function buyGold(item) {
        const state = goldItemState(ctx.save, item);
        if (state === 'gold') return toast('골드가 부족해요', { type: 'error' });
        if (state === 'gems') return toast('보석이 부족해요', { type: 'error' });
        if (state !== 'ok') return;
        const free = item.cost.gold === 0 && item.cost.gems === 0;
        if (!free) {
          const cost = [item.cost.gold > 0 && `골드 ${formatGems(item.cost.gold)}`, item.cost.gems > 0 && `보석 ${formatGems(item.cost.gems)}개`].filter(Boolean).join(' + ');
          const ok = await confirmModal(item.name, h('div', { class: 'buy-confirm' }, rewardList(item.rewards), h('p', {}, `${cost}을(를) 사용해요`)), { okLabel: '구매' });
          if (!ok) return;
        }
        const got = buyGoldItem(ctx.save, item);
        if (!got) return toast('구매할 수 없어요', { type: 'error' });
        ctx.commit();
        gotToast(got);
        render({ keepScroll: true });
      }

      // ── 캐시 상점 ──
      function renderCash() {
        const vip = vipProgress(ctx.save.shop.spentKRW, shop.vip);
        const left = passDaysLeft(ctx.save);
        head.className = 'shop-head shop-head-cash';
        fill(head,
          h('div', { class: ['vip-badge', `vip-${Math.min(vip.level, 10)}`] }, h('small', {}, 'VIP'), h('b', {}, vip.level)),
          h(
            'div',
            { class: 'vip-info' },
            h('div', { class: 'vip-line' }, h('span', {}, '누적 결제 '), h('b', {}, formatKRW(ctx.save.shop.spentKRW)), vip.next != null && h('span', { class: 'muted small' }, ` · VIP ${vip.level + 1}까지 ${formatKRW(vip.next - ctx.save.shop.spentKRW)}`)),
            h('div', { class: 'vip-bar' }, h('i', { style: { width: `${vip.pct}%` } })),
          ),
          left > 0 && h('div', { class: 'pass-chip' }, '☾ 월간 축복 ', h('b', {}, `${left}일`)),
          h('div', { class: 'fake-pay-chip' }, '가상 결제 · 실제로 돈이 나가지 않아요'),
        );
        const items = shop.cash.filter((i) => i.category === category);
        shelf.className = `shop-shelf shelf-cash shelf-${category}`;
        shelf.replaceChildren(...items.map(cashCard));
        if (!items.length) shelf.append(h('p', { class: 'collection-empty' }, '판매 중인 상품이 없어요'));
      }

      function cashCard(item) {
        const state = cashItemState(ctx.save, item, ctx.data.stages);
        const bonus = hasFirstBonus(ctx.save, item) ? item.firstBonus : null;
        const lock = lockReason(ctx.save, item, ctx.data.stages);
        const ribbons = [bonus && h('span', { class: 'sc-ribbon is-bonus' }, '첫 구매 2배'), ...item.badges.map((b) => h('span', { class: 'sc-ribbon' }, b))].filter(Boolean);
        return h(
          'button',
          {
            class: ['shop-card', 'cash-card', `tier-${item.tier}`, `icon-${item.icon}`, state === 'soldout' && 'is-soldout', state === 'locked' && 'is-locked'],
            type: 'button',
            disabled: state === 'soldout' || state === 'locked',
            onclick: () => buyCash(item),
          },
          item.tier === 'truck' && h('i', { class: 'sc-shine', 'aria-hidden': 'true' }),
          ribbons.length > 0 && h('div', { class: 'sc-ribbons' }, ribbons),
          item.value && h('div', { class: 'sc-value' }, h('small', {}, '가치'), item.value),
          shopArt(item),
          h('div', { class: 'sc-name' }, item.name),
          item.desc && h('div', { class: 'sc-desc' }, item.desc),
          rewardList(item.rewards, bonus),
          item.pass && h('div', { class: 'sc-pass' }, `${item.pass.days}일 동안 매일 `, currencyIcon('gems'), h('b', {}, item.pass.dailyGems)),
          h('div', { class: 'sc-limit' }, limitLabel(ctx.save, item), resetEl(item)),
          h(
            'div',
            { class: 'sc-price' },
            item.originalKRW > item.priceKRW && h('s', { class: 'sc-price-old' }, formatKRW(item.originalKRW)),
            h('span', { class: 'sc-price-krw' }, formatKRW(item.priceKRW)),
          ),
          state === 'soldout' && h('div', { class: 'sc-overlay' }, '구매 완료'),
          state === 'locked' && h('div', { class: 'sc-overlay is-lock' }, h('b', {}, '잠김'), h('span', {}, lock)),
        );
      }

      async function buyCash(item) {
        const state = cashItemState(ctx.save, item, ctx.data.stages);
        if (state === 'passmax') return toast(`월간 축복은 최대 ${item.pass.maxDays}일까지만 연장할 수 있어요`, { type: 'error' });
        if (state !== 'ok') return;

        const bonus = hasFirstBonus(ctx.save, item) ? item.firstBonus : null;
        const status = h('div', { class: 'pay-status' });
        const body = h(
          'div',
          { class: `pay-sheet tier-${item.tier}` },
          h('div', { class: 'pay-item' }, shopArt(item), h('div', {}, h('div', { class: 'pay-name' }, item.name), rewardList(item.rewards, bonus))),
          h('div', { class: 'pay-row' }, h('span', { class: 'muted' }, '결제 금액'), h('b', { class: 'pay-amount' }, formatKRW(item.priceKRW))),
          h('div', { class: 'pay-row' }, h('span', { class: 'muted' }, '결제 수단'), h('span', {}, '모험가 조합 가상 카드')),
          h('p', { class: 'pay-note' }, '※ 가상 결제예요. 실제로 돈이 나가지 않고, 아이템만 들어와요.'),
          status,
        );

        let processing = null;
        let result = null;
        await openModal({
          title: '결제 확인',
          className: 'pay-modal',
          body,
          dismissValue: null,
          buttons: [
            { label: '취소', value: null },
            {
              label: `${formatKRW(item.priceKRW)} 결제하기`,
              primary: true,
              onClick: () => {
                if (processing) return false;
                body.closest('.modal')?.querySelectorAll('.modal-actions button').forEach((b) => (b.disabled = true));
                status.replaceChildren(h('i', { class: 'pay-spinner', 'aria-hidden': 'true' }), '결제 처리 중…');
                body.classList.add('is-paying');
                processing = wait(PAY_DELAY_MS).then(() => {
                  result = buyCashItem(ctx.save, item, shop, ctx.data.stages);
                  if (!result) return;
                  claimPassDaily(ctx.save); // 월정액을 오늘 처음 시작했다면 오늘 몫도 바로
                  ctx.commit();
                });
                return processing.then(() => true);
              },
            },
          ],
        });
        // 결제 처리 중에 창을 닫아도 결제는 끝까지 진행
        if (processing) await processing;
        if (!result) {
          if (processing) toast('결제를 처리하지 못했어요', { type: 'error' });
          return;
        }
        render({ keepScroll: true });
        showPaid(item, result);
      }

      /** 결제 완료 연출 */
      function showPaid(item, r) {
        const entries = rewardEntries(r.rewards);
        const body = h(
          'div',
          { class: `paid-sheet tier-${item.tier}` },
          h('div', { class: 'paid-burst', 'aria-hidden': 'true' }, h('i', { class: 'paid-rays' }), h('i', { class: 'paid-glow' })),
          h('div', { class: 'paid-title' }, '결제 완료!'),
          h('div', { class: 'paid-name' }, item.name),
          h(
            'ul',
            { class: 'paid-rewards' },
            entries.map((e, i) => h('li', { style: { '--i': i } }, h('span', { class: 'paid-icon' }, currencyIcon(e.key)), h('b', {}, formatGems(e.amount)), h('small', {}, e.label))),
          ),
          r.firstBonus && h('p', { class: 'paid-extra' }, '첫 구매 보너스 2배 적용!'),
          r.passDays > 0 && h('p', { class: 'paid-extra' }, `월간 축복 남은 기간 ${r.passDays}일`),
          r.vipAfter > r.vipBefore && h('p', { class: 'paid-vip' }, `VIP ${r.vipAfter} 달성!`),
        );
        openModal({ className: 'paid-modal', body, buttons: [{ label: '확인', value: true, primary: true }], dismissValue: true });
      }

      el.append(h('div', { class: 'shop-layout' }, side, h('div', { class: 'shop-main' }, head, shelf)));
      render();

      // 초기화까지 남은 시간 갱신, 초기화 시각이 지나면 다시 그림
      const timer = setInterval(() => {
        const t = now();
        let reset = false;
        el.querySelectorAll('[data-reset]').forEach((r) => {
          const ms = Date.parse(r.dataset.reset) - t;
          if (ms <= 0) reset = true;
          else r.textContent = `초기화까지 ${formatRemaining(ms)}`;
        });
        if (reset) {
          const p = claimPassDaily(ctx.save);
          if (p) {
            ctx.commit();
            toast(`월간 축복: 보석 ${p.gems}개를 받았어요`, { type: 'success' });
          }
          render({ keepScroll: true });
        }
      }, 20000);

      return {
        destroy: () => clearInterval(timer),
        onKey(e) {
          if (e.code === 'Digit1' || e.code === 'Numpad1') return (tab = 'gold'), render(), true;
          if (e.code === 'Digit2' || e.code === 'Numpad2') return (tab = 'cash'), render(), true;
          if (tab === 'cash' && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
            const i = CATEGORIES.findIndex((c) => c.id === category);
            category = CATEGORIES[(i + (e.code === 'ArrowDown' ? 1 : -1) + CATEGORIES.length) % CATEGORIES.length].id;
            render();
            return true;
          }
          if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
            shelf.scrollBy({ left: e.code === 'ArrowRight' ? 300 : -300, behavior: 'smooth' });
            return true;
          }
          return false;
        },
      };
    },
  };
}
