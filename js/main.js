// 게임 시작점: 데이터 로드 → 세이브 로드 → 출석 보상 → 홈 화면
import { initStage, toggleFullscreen } from './core/stage.js';
import { loadGameData } from './core/data.js';
import { loadSave, writeSave, clearSave, createNewSave } from './core/save.js';
import { emit } from './core/events.js';
import { applyDailyLogin, addGems, DAILY_GEMS } from './systems/economy.js';
import { syncKnownIds } from './systems/collection.js';
import { STANDARD_BANNER, buildPools, simulate } from './systems/gacha.js';
import { initRouter, registerScreen, go, back, dispatchKey, currentScreen } from './ui/router.js';
import { initToast, toast } from './ui/toast.js';
import { initModal, hasOpenModal, closeTopModal } from './ui/modal.js';
import { initHud } from './ui/hud.js';
import { homeScreen } from './ui/home.js';
import { gachaScreen, revealScreen } from './ui/gachaView.js';
import { collectionScreen } from './ui/collectionView.js';
import { settingsScreen } from './ui/settingsView.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  initStage($('viewport'), $('stage'));
  initToast($('toast-layer'));
  initModal($('modal-layer'));

  const data = await loadGameData();
  const { save, isNew, corrupted } = loadSave();
  syncKnownIds(save, data.characters, isNew);
  const dailyGems = isNew ? 0 : applyDailyLogin(save);

  // 모든 화면이 공유하는 게임 상태(ctx)
  const ctx = {
    data,
    save,
    // Phase 3에서 banners.json의 활성 배너로 교체됩니다
    banners: [STANDARD_BANNER],

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
  initRouter($('screen-layer'), (screen) => hud.update(screen));
  registerScreen('home', homeScreen(ctx));
  registerScreen('gacha', gachaScreen(ctx));
  registerScreen('reveal', revealScreen(ctx));
  registerScreen('collection', collectionScreen(ctx));
  registerScreen('settings', settingsScreen(ctx));

  ctx.commit();
  go('home');
  $('boot-screen').remove();

  // 시작 알림
  if (corrupted) toast('세이브가 손상되어 새로 시작했어요', { type: 'error', duration: 4000 });
  if (isNew) toast('환영해요! 시작 선물로 보석 1,000개를 받았어요', { type: 'success', duration: 3500 });
  if (dailyGems) toast(`오늘의 출석 보상: 보석 ${DAILY_GEMS}개`, { type: 'success', duration: 3500 });
  if (!data.characters.length) toast('캐릭터 데이터를 불러오지 못했어요', { type: 'error', duration: 4000 });

  setupKeyboard(ctx);
  setupDevHelpers(ctx);
}

/** 키보드 단축키 (PC). 한글 입력 상태에서도 동작하도록 e.code 사용 */
function setupKeyboard(ctx) {
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
    const goOnce = (name) => here !== name && go(name);
    switch (e.code) {
      case 'KeyG':
        goOnce('gacha');
        break;
      case 'KeyC':
        goOnce('collection');
        break;
      case 'KeyO':
        goOnce('settings');
        break;
      case 'KeyF':
        ctx.toggleFullscreen();
        break;
      case 'Escape':
      case 'Backspace':
        back();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}

/** 개발용 도우미 — localhost에서만 콘솔에 __tg 노출 */
function setupDevHelpers(ctx) {
  const host = location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return;
  window.__tg = {
    ctx,
    /** 확률 시뮬레이션 (세이브에 영향 없음) */
    simulate: (n = 100000) => simulate(buildPools(ctx.data.characters, STANDARD_BANNER), n),
    /** 테스트용 보석 추가 */
    addGems: (n = 10000) => {
      addGems(ctx.save, n);
      ctx.commit();
    },
  };
  console.info('%c[Tiny Gacha] 개발 도우미: __tg.simulate(100000), __tg.addGems(10000)', 'color:#a970ff');
}

boot().catch((e) => {
  console.error('[boot] 시작 실패', e);
  const el = $('boot-screen');
  if (el) el.textContent = '게임을 시작하지 못했어요. 새로고침해 주세요.';
});
