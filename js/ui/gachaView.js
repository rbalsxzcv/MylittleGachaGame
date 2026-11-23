// 뽑기 화면(배너) + 배너 상세 + 결과 연출(카드 뒤집기)
import { h, gemIcon, scrollIcon } from './dom.js';
import { go, back } from './router.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { charCard, rarityBadge } from './charCard.js';
import { bannerVisual } from './home.js';
import { countdownEl, startCountdowns } from './countdown.js';
import { buildPools, isPoolEmpty, pullMany, rateTable, pityKeyOf, pickupList, isMemoryBanner, rulesFor, poolSourceOf } from '../systems/gacha.js';
import { addMemory } from '../systems/memories.js';
import { memoryCard } from './memoryCard.js';
import { RARITIES, MAX_RARITY } from '../config.js';
import { isBannerActive } from '../systems/banners.js';
import { canAfford, spendGems, spendScrolls, formatGems } from '../systems/economy.js';
import { addCharacter } from '../systems/collection.js';
import { formatPeriod, now } from '../core/time.js';
import { playGachaFx, preloadResultImages } from '../fx/gachaFx.js';

/** id로 진행 중인 배너 찾기 (없으면 첫 배너) */
function findBanner(ctx, bannerId) {
  const list = ctx.activeBanners();
  return list.find((b) => b.id === bannerId) || list[0];
}

/** 1회/10회 보석 비용 (배너 종류별 규칙) */
const costOf = (ctx, count, banner) => {
  const c = rulesFor(banner, ctx.data.balance).gacha.cost;
  return count >= 10 ? c.ten : c.single;
};

/** 모집 증서가 count장 이상이면 증서로, 아니면 보석으로 (증서는 캐릭터 뽑기만) */
const usesScrolls = (save, count, banner) => !isMemoryBanner(banner) && (save.scrolls || 0) >= count;

/** 뽑기 버튼의 비용 표시 (증서 or 보석) */
function pullCostEl(ctx, count, banner) {
  return usesScrolls(ctx.save, count, banner)
    ? h('span', { class: 'pull-cost is-scroll' }, scrollIcon(), `증서 ${count}`)
    : h('span', { class: 'pull-cost' }, gemIcon(), formatGems(costOf(ctx, count, banner)));
}

/** 추억 결과를 연출/결과 격자가 쓰는 카드 모양으로 (char 칸에 이름/희귀도/그림) */
const memoryAsCard = (mem) => ({ id: mem.id, name: mem.name, rarity: mem.rarity, image: mem.image || mem.thumb || '', cutout: '', title: '추억' });



/**
 * 실제 뽑기 처리: 증서/보석 확인 → 결과 계산 → 도감 반영 → 즉시 저장
 * 보석이 부족하거나 배너가 끝났거나 캐릭터가 없으면 아무것도 바꾸지 않고 null 반환
 */
export function executePull(ctx, banner, count) {
  if (!isBannerActive(banner)) {
    toast('이 배너는 기간이 끝났어요', { type: 'error' });
    return null;
  }
  const memory = isMemoryBanner(banner);
  const rules = rulesFor(banner, ctx.data.balance);
  const pools = buildPools(poolSourceOf(banner, ctx.data), banner);
  if (isPoolEmpty(pools)) {
    toast(memory ? '뽑을 수 있는 추억이 없어요' : '뽑을 수 있는 캐릭터가 없어요', { type: 'error' });
    return null;
  }
  const cost = costOf(ctx, count, banner);
  const scroll = usesScrolls(ctx.save, count, banner);
  if (!scroll && !canAfford(ctx.save, cost)) {
    toast(`보석이 부족해요 (필요 ${formatGems(cost)} / 보유 ${formatGems(ctx.save.gems)})`, { type: 'error' });
    return null;
  }

  const key = pityKeyOf(banner);
  const out = pullMany({ pools, count, pity: ctx.save.pity[key] ?? 0, guaranteed: !!ctx.save.guaranteed[key], cfg: rules });
  if (scroll) spendScrolls(ctx.save, count);
  else spendGems(ctx.save, cost);
  ctx.save.pity[key] = out.pity;
  ctx.save.guaranteed[key] = out.guaranteed;
  ctx.save.stats.pulls += count;
  const t = now();
  const detailed = memory
    ? out.results.map((r) => {
        // 추억: 새 카드 / 재련 +1 / (모두 R5면) 추억 재료
        const res = addMemory(ctx.save, r.char, ctx.data.balance);
        const badge = res.isNew ? 'NEW' : res.refine ? `재련 R${res.refine}` : `재료 +${res.material}`;
        return { ...r, memory: true, mem: r.char, char: memoryAsCard(r.char), isNew: res.isNew, refine: res.refine, material: res.material, essence: 0, tickets: 0, badge };
      })
    : out.results.map((r) => ({ ...r, ...addCharacter(ctx.save, r.char, ctx.data.balance, t) }));
  ctx.commit(); // 연출 전에 저장 → 새로고침해도 결과가 사라지지 않음
  preloadResultImages(detailed);
  return detailed;
}

/** 확률표 (상세 모달 안) */
function rateTableEl(pools, cfg) {
  return h(
    'div',
    { class: 'rate-table' },
    rateTable(pools, cfg)
      .filter((row) => row.rate > 0 || row.count > 0) // 추억 뽑기는 1·2★가 없음
      .map((row) =>
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
          : h('p', { class: 'muted' }, '이 등급의 캐릭터가 없어 가까운 낮은 등급(없으면 높은 등급)으로 대체돼요.'),
      ),
    ),
  );
}

/** 배너 상세: 기간, 픽업 미리보기, 규칙, 전체 확률표 */
export function showBannerDetail(ctx, banner) {
  const memory = isMemoryBanner(banner);
  const cfg = rulesFor(banner, ctx.data.balance);
  const pools = buildPools(poolSourceOf(banner, ctx.data), banner);
  const g = cfg.gacha;
  const pickups = pickupList(pools);
  const share = Math.round(g.pickupShare * 100);
  const what = memory ? '추억' : '캐릭터';
  const rules = [
    `확률: ${[...RARITIES].reverse().filter((r) => g.rates[r] > 0).map((r) => `${r}★ ${g.rates[r]}%`).join(' / ')}`,
    `${g.pity}회 안에 ${MAX_RARITY}★가 나오지 않으면 ${g.pity}번째는 ${MAX_RARITY}★ 확정`,
    `10회 뽑기는 ${g.tenGuaranteeMin}★ 이상 1장 확정`,
    banner.type === 'pickup' && `${MAX_RARITY}★ 획득 시 ${share}% 확률로 픽업 ${what} · 픽업이 아니었다면 다음 ${MAX_RARITY}★는 픽업 확정`,
    memory
      ? `이미 가진 추억이 나오면 재련 +1 (최대 R5, 그 뒤로는 추억 재료) · 추억은 역할 제한 없이 누구나 장착`
      : '이미 가진 캐릭터가 나오면 그 캐릭터의 정수 +1 (돌파 6단계를 넘는 정수는 티켓으로 바뀌어요)',
    memory ? '추억 뽑기의 천장 · 픽업 확정은 캐릭터 뽑기와 따로 세요' : banner.type === 'pickup' ? '천장 횟수와 픽업 확정은 모든 픽업 배너가 함께 사용해요' : '천장 횟수는 픽업 배너와 따로 세요',
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
        h('h3', {}, `픽업 ${what}`),
        h(
          'div',
          { class: 'bd-pickups' },
          pickups.map((c) =>
            memory
              ? h('div', { class: 'bd-pickup' }, memoryCard(c, { owner: ctx.data.allCharMap?.get(c.signatureOf) }))
              : h('div', { class: 'bd-pickup' }, charCard(c, { owned: true }), h('div', { class: 'bd-pickup-title' }, c.title)),
          ),
        ),
      ),
    h('h3', {}, '규칙'),
    h('ul', { class: 'bd-rules' }, rules.map((r) => h('li', {}, r))),
    h('h3', {}, '확률 정보'),
    rateTableEl(pools, cfg),
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
      const all = ctx.activeBanners();
      const banner = findBanner(ctx, params.bannerId);
      const memory = isMemoryBanner(banner);
      // 캐릭터 / 추억 뽑기 탭 — 배너 탭은 지금 종류만
      const banners = all.filter((b) => isMemoryBanner(b) === memory);
      const hasMemory = all.some(isMemoryBanner);
      const cfg = rulesFor(banner, ctx.data.balance);
      const pools = buildPools(poolSourceOf(banner, ctx.data), banner);
      const empty = isPoolEmpty(pools);
      const key = pityKeyOf(banner);
      const pity = ctx.save.pity[key] ?? 0;
      // activeBanners()는 부를 때마다 새 객체를 만들므로 id로 비교
      const index = banners.findIndex((b) => b.id === banner?.id);

      const switchTo = (b) => b && b.id !== banner?.id && go('gacha', { bannerId: b.id }, { replace: true });
      const pull = (count) => {
        const results = executePull(ctx, banner, count);
        if (results) go('reveal', { results, bannerId: banner.id, count });
      };

      const pullButton = (count) =>
        h(
          'button',
          { class: ['pull-btn', count === 10 && 'pull-ten'], type: 'button', disabled: empty, onclick: () => pull(count) },
          h('span', { class: 'pull-label' }, `${count}회 뽑기`),
          pullCostEl(ctx, count, banner),
          h('kbd', { class: 'key-hint' }, count === 10 ? '0' : '1'),
        );

      // 캐릭터 / 추억 종류 탭 + 배너가 여러 개면 위쪽 탭으로 전환
      const catTabs =
        hasMemory &&
        [false, true].map((m) =>
          h(
            'button',
            { class: ['banner-tab', 'cat-tab', m === memory && 'active'], type: 'button', role: 'tab', onclick: () => m !== memory && switchTo(all.find((b) => isMemoryBanner(b) === m)) },
            m ? '추억 뽑기' : '캐릭터 뽑기',
          ),
        );
      const tabs =
        (banners.length > 1 || hasMemory) &&
        h(
          'div',
          { class: 'banner-tabs', role: 'tablist' },
          catTabs,
          catTabs && h('span', { class: 'tab-sep' }),
          banners.length > 1 &&
            banners.map((b) =>
              h(
                'button',
                { class: ['banner-tab', b.id === banner?.id && 'active', b.type === 'pickup' && 'is-pickup'], type: 'button', role: 'tab', onclick: () => switchTo(b) },
                b.title,
              ),
            ),
        );

      const relatedStory = banner.relatedStoryId && ctx.data.storyIndex.find((s) => s.id === banner.relatedStoryId);
      const pickupNames = pickupList(pools).map((c) => c.name);
      const g = cfg.gacha;
      const gKey = memory ? 'memoryPickup' : 'pickup';

      el.append(
        h(
          'div',
          { class: ['gacha-main', tabs && 'has-tabs'] },
          tabs,
          h(
            'div',
            { class: 'gacha-banner' },
            bannerVisual(banner, ctx.data.charMap, ctx.data.memoryMap),
            h(
              'div',
              { class: 'gacha-banner-info' },
              h('span', { class: ['banner-tag', banner.type === 'pickup' && 'is-pickup'] }, `${memory ? '추억 · ' : ''}${banner.type === 'pickup' ? '픽업' : '상시'}`),
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
            h('div', { class: 'pity-label' }, `${MAX_RARITY}★ 확정까지 (${memory ? '추억 ' : ''}${banner.type === 'pickup' ? '픽업' : '상시'})`),
            h('div', { class: 'pity-value' }, h('b', {}, Math.max(0, g.pity - pity)), '회'),
            h('div', { class: 'pity-bar' }, h('i', { style: { width: `${Math.min(100, (pity / g.pity) * 100)}%` } })),
            banner.type === 'pickup' &&
              h(
                'div',
                { class: ['pickup-state', ctx.save.guaranteed[gKey] && 'on'] },
                ctx.save.guaranteed[gKey] ? `다음 ${MAX_RARITY}★는 픽업 확정!` : `${MAX_RARITY}★ 획득 시 ${Math.round(g.pickupShare * 100)}% 픽업`,
              ),
          ),
          h('div', { class: 'rate-chips' }, [...RARITIES].reverse().filter((r) => g.rates[r] > 0).map((r) => h('span', { class: `rate-chip rar-${r}` }, `${r}★ ${g.rates[r]}%`))),
          h(
            'div',
            { class: 'gacha-links' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => showBannerDetail(ctx, banner) }, '상세 · 확률', h('kbd', { class: 'key-hint' }, 'I')),
            relatedStory &&
              h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (relatedStory.kind === 'main' ? go('adventure') : go('stories', { kind: relatedStory.kind, focus: relatedStory.id })) }, '관련 스토리'),
          ),
          empty && h('p', { class: 'gacha-empty' }, memory ? '추억 데이터가 없어요' : '캐릭터 데이터가 없어요'),
          memory
            ? h('div', { class: 'scroll-count muted small', title: 'R5가 된 추억이 또 나오면 추억 재료가 돼요 (추억 레벨업에 티켓 대신 씀)' }, `추억 재료 ${formatGems(ctx.save.memMat || 0)}`)
            : h(
                'div',
                { class: 'scroll-count muted small', title: '모집 증서 1장 = 뽑기 1회. 있으면 보석보다 먼저 써요' },
                scrollIcon(),
                `모집 증서 ${formatGems(ctx.save.scrolls || 0)}장`,
              ),
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
// 결과 화면: Phaser 연출(js/fx/GachaFxScene.js) → 끝나면 HTML 결과 격자
// 설정에서 '연출 건너뛰기'를 켜면 바로 격자. 메뉴 화면은 움직이지 않음(정적)
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
      const top = Math.max(...results.map((r) => r.rarity));
      let playing = !ctx.save.settings?.fxSkip;
      let alive = true;

      const cards = results.map((r) => {
        let badge = 'NEW';
        let badgeClass = 'badge-new';
        if (r.memory) {
          // 추억: NEW / 재련 R2 / 재료 +n
          if (!r.isNew) (badge = r.badge), (badgeClass = r.refine ? 'badge-star' : 'badge-max');
        } else if (!r.isNew && r.essence) (badge = '정수 +1'), (badgeClass = 'badge-star');
        else if (!r.isNew) (badge = `티켓 +${r.tickets}`), (badgeClass = 'badge-max');
        return h(
          'div',
          { class: ['reveal-card', `rar-${r.rarity}`, r.rarity === top && top >= 3 && 'is-top'] },
          r.memory ? memoryCard(r.mem, { badge, badgeClass, owner: r.mem.signatureOf ? ctx.data.allCharMap?.get(r.mem.signatureOf) : null }) : charCard(r.char, { owned: true, breakthrough: r.breakthrough, badge, badgeClass }),
          r.isPickup && h('span', { class: 'pickup-ribbon' }, 'PICKUP'),
        );
      });
      const grid = h('div', { class: ['reveal-grid', single ? 'is-single' : 'is-ten'] }, cards);

      // 요약: 새 동료 / 정수 / 티켓
      const newCount = results.filter((r) => r.isNew).length;
      const essence = results.reduce((a, r) => a + (r.essence || 0), 0);
      const tickets = results.reduce((a, r) => a + (r.tickets || 0), 0);
      const summary = h(
        'div',
        { class: 'reveal-summary' },
        (results[0]?.memory
          ? [newCount && `새 추억 ${newCount}장`, results.filter((r) => r.refine).length && `재련 ${results.filter((r) => r.refine).length}번`, results.reduce((a, r) => a + (r.material || 0), 0) && `추억 재료 +${results.reduce((a, r) => a + (r.material || 0), 0)}`]
          : [newCount && `새 동료 ${newCount}명`, essence && `정수 +${essence}`, tickets && `티켓 +${tickets.toLocaleString('ko-KR')}`]
        )
          .filter(Boolean)
          .join(' · ') || ' ',
      );

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
        pullCostEl(ctx, count),
      );
      const okBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => back() }, '확인');
      const content = h('div', { class: 'reveal-content', hidden: playing }, h('div', { class: 'reveal-title' }, '모집 결과'), grid, summary, h('div', { class: 'reveal-actions' }, againBtn, okBtn));
      el.append(h('div', { class: 'reveal-bg' }), content);

      const showGrid = () => {
        playing = false;
        if (!alive) return;
        content.hidden = false;
        setTimeout(() => okBtn.focus({ preventScroll: true }), 30);
      };
      if (playing) {
        const settings = ctx.save.settings;
        playGachaFx(results, {
          speed: settings.fxSpeed,
          onSpeed: (sp) => {
            settings.fxSpeed = sp;
            ctx.commit();
          },
        }).then(showGrid);
      } else showGrid();

      return {
        destroy() {
          alive = false;
        },
        onKey(e) {
          if (playing) return true; // 연출 중 키는 Phaser 장면이 처리
          if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') {
            back();
            return true;
          }
          return false;
        },
      };
    },
  };
}
