// 게임 시작점: 데이터 로드 → 세이브 로드 → 출석 보상 → 홈 화면 → 시작 팝업
import { initStage, toggleFullscreen } from './core/stage.js';
import { loadGameData } from './core/data.js';
import { loadSave, writeSave, clearSave, createNewSave, usePreviewSaveKey } from './core/save.js';
import { emit } from './core/events.js';
import { now, parseDate, setNowOverride, isTimeShifted, formatKST } from './core/time.js';
import { applyDailyLogin, addGems, DAILY_GEMS } from './systems/economy.js';
import { syncKnownIds } from './systems/collection.js';
import { buildPools, simulate } from './systems/gacha.js';
import { activeBanners } from './systems/banners.js';
import { initRouter, registerScreen, go, back, dispatchKey, currentScreen } from './ui/router.js';
import { initToast, toast } from './ui/toast.js';
import { initModal, hasOpenModal, closeTopModal } from './ui/modal.js';
import { initHud } from './ui/hud.js';
import { setTheme, decorateScreen } from './ui/theme.js';
import { homeScreen } from './ui/home.js';
import { gachaScreen, revealScreen, showBannerDetail } from './ui/gachaView.js';
import { collectionScreen } from './ui/collectionView.js';
import { settingsScreen } from './ui/settingsView.js';
import { storyListScreen } from './ui/storyListView.js';
import { storyScreen } from './ui/storyView.js';
import { mailScreen, noticesScreen, showStartupPopups } from './ui/inboxViews.js';

const $ = (id) => document.getElementById(id);
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

/**
 * 개발 도구 미리보기용 주소 옵션 (localhost에서만 동작)
 *   ?preview=1         실제 세이브와 분리된 미리보기 세이브 사용 (보석 넉넉히)
 *   ?now=2026-12-01T00:00:00+09:00   그 시각으로 시간 이동
 *   ?story=<id>        스토리 바로 열기     ?banner=<id>  해당 배너 상세 열기
 */
function readPreviewOptions() {
  if (!IS_LOCAL) return {};
  const q = new URLSearchParams(location.search);
  const opts = { preview: q.get('preview') === '1', story: q.get('story'), banner: q.get('banner') };
  const t = parseDate(q.get('now'));
  if (t) setNowOverride(t);
  if (opts.preview) usePreviewSaveKey();
  return opts;
}

async function boot() {
  const opts = readPreviewOptions();
  initStage($('viewport'), $('stage'));
  initToast($('toast-layer'));
  initModal($('modal-layer'));

  const data = await loadGameData();
  setTheme(data.ui); // 화면 에셋(배경/로고/아이콘) — 없으면 CSS 기본 디자인
  // 출시 시각(addedAt)이 아직 안 된 캐릭터는 게임에 나오지 않음 (픽업 데뷔용)
  const t = now();
  data.allCharMap = new Map(data.characters.map((c) => [c.id, c]));
  data.characters = data.characters.filter((c) => {
    const at = parseDate(c.addedAt);
    return !at || at <= t;
  });
  data.charMap = new Map(data.characters.map((c) => [c.id, c]));

  const { save, isNew, corrupted } = loadSave();
  if (isNew && opts.preview) save.gems = 100000;
  syncKnownIds(save, data.characters, isNew);
  const dailyGems = isNew ? 0 : applyDailyLogin(save);

  // 모든 화면이 공유하는 게임 상태(ctx)
  const ctx = {
    data,
    save,
    /** 지금 진행 중인 배너 */
    activeBanners: () => activeBanners(data.banners),

    /** 세이브 저장 + 변경 알림 */
    commit() {
      if (!writeSave(ctx.save)) toast('저장에 실패했어요. 브라우저 저장 공간을 확인해 주세요', { type: 'error' });
      emit('save:changed', ctx.save);
    },
    /** 세이브 코드로 불러온 세이브로 교체 */
    replaceSave(newSave) {
      syncKnownIds(newSave, data.characters, false);
      ctx.save = newSave;
      ctx.commit();
    },
    /** 처음부터 다시 */
    resetSave() {
      clearSave();
      const fresh = createNewSave();
      syncKnownIds(fresh, data.characters, true);
      fresh.seenContentVersion = data.version.contentVersion;
      ctx.save = fresh;
      ctx.commit();
    },
    async toggleFullscreen() {
      const r = await toggleFullscreen();
      if (!r.ok) {
        toast(
          r.reason === 'unsupported'
            ? '이 기기는 전체화면을 지원하지 않아요. 공유 → "홈 화면에 추가"로 실행해 보세요'
            : '전체화면으로 전환하지 못했어요',
          { type: 'error', duration: 3500 },
        );
      }
    },
  };

  // 화면 등록
  const hud = initHud($('hud'), { getGems: () => ctx.save.gems, onBack: () => back() });
  initRouter($('screen-layer'), (screen) => hud.update(screen), decorateScreen);
  registerScreen('home', homeScreen(ctx));
  registerScreen('gacha', gachaScreen(ctx));
  registerScreen('reveal', revealScreen(ctx));
  registerScreen('collection', collectionScreen(ctx));
  registerScreen('settings', settingsScreen(ctx));
  registerScreen('stories', storyListScreen(ctx));
  registerScreen('story', storyScreen(ctx));
  registerScreen('mail', mailScreen(ctx));
  registerScreen('notices', noticesScreen(ctx));

  ctx.commit();
  go('home');
  $('boot-screen').remove();

  // 시작 알림
  if (isTimeShifted()) toast(`미리보기 시각: ${formatKST(now())} (KST)`, { duration: 4000 });
  if (corrupted) toast('세이브가 손상되어 새로 시작했어요', { type: 'error', duration: 4000 });
  if (isNew) toast('환영해요! 시작 선물로 보석 1,000개를 받았어요', { type: 'success', duration: 3500 });
  if (dailyGems) toast(`오늘의 출석 보상: 보석 ${DAILY_GEMS}개`, { type: 'success', duration: 3500 });
  if (!data.characters.length) toast('캐릭터 데이터를 불러오지 못했어요', { type: 'error', duration: 4000 });

  setupKeyboard(ctx);
  setupDevHelpers(ctx);

  // 미리보기 바로가기
  if (opts.story) return go('story', { id: opts.story });
  if (opts.banner) {
    go('gacha', { bannerId: opts.banner });
    const b = data.banners.find((x) => x.id === opts.banner);
    if (b) showBannerDetail(ctx, b);
    return;
  }
  if (!opts.preview) await showStartupPopups(ctx, { isNew });
}

/** 키보드 단축키 (PC). 한글 입력 상태에서도 동작하도록 e.code 사용 */
function setupKeyboard(ctx) {
  const SHORTCUTS = { KeyG: 'gacha', KeyC: 'collection', KeyO: 'settings', KeyT: 'stories', KeyM: 'mail', KeyN: 'notices' };

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    const tag = target?.tagName;

    // 입력 중에는 Esc(모달 닫기)만 처리
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
      if (e.code === 'Escape' && hasOpenModal()) closeTopModal();
      return;
    }
    if (hasOpenModal()) {
      if (e.code === 'Escape') {
        e.preventDefault();
        closeTopModal();
      }
      return;
    }
    // 포커스된 버튼은 Space/Enter 기본 동작(클릭) 유지
    if (tag === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return;

    if (dispatchKey(e)) {
      e.preventDefault();
      return;
    }

    const here = currentScreen();
    if (here === 'story') return; // 스토리 중에는 다른 화면 단축키 무시
    if (SHORTCUTS[e.code]) {
      if (here !== SHORTCUTS[e.code]) go(SHORTCUTS[e.code]);
    } else if (e.code === 'KeyF') {
      ctx.toggleFullscreen();
    } else if (e.code === 'Escape' || e.code === 'Backspace') {
      back();
    } else {
      return;
    }
    e.preventDefault();
  });
}

/** 개발용 도우미 — localhost에서만 콘솔에 __tg 노출 */
function setupDevHelpers(ctx) {
  if (!IS_LOCAL) return;
  window.__tg = {
    ctx,
    /** 확률 시뮬레이션 (세이브에 영향 없음). bannerId를 주면 그 배너 기준 */
    simulate: (n = 100000, bannerId) => {
      const banner = ctx.data.banners.find((b) => b.id === bannerId) || ctx.activeBanners()[0];
      return simulate(buildPools(ctx.data.characters, banner), n);
    },
    /** 테스트용 보석 추가 */
    addGems: (n = 10000) => {
      addGems(ctx.save, n);
      ctx.commit();
    },
  };
  console.info('%c[Tiny Gacha] 개발 도우미: __tg.simulate(100000[, 배너id]), __tg.addGems(10000)', 'color:#a970ff');
}

boot().catch((e) => {
  console.error('[boot] 시작 실패', e);
  const el = $('boot-screen');
  if (el) el.textContent = '게임을 시작하지 못했어요. 새로고침해 주세요.';
});
