// 게임 시작점: 데이터 로드 → 세이브 로드 → 출석 보상 → 홈 화면 → 시작 팝업
import { initStage, toggleFullscreen } from './core/stage.js';
import { loadGameData } from './core/data.js';
import { loadSave, writeSave, clearSave, createNewSave, usePreviewSaveKey } from './core/save.js';
import { emit } from './core/events.js';
import { now, parseDate, setNowOverride, isTimeShifted, formatKST } from './core/time.js';
import { applyDailyLogin, addGems, addTickets, addGold, addScrolls, rewardText } from './systems/economy.js';
// 상점 세이브 영역(registerSaveSlice)은 loadSave보다 먼저 등록되어야 해요
import { claimPassDaily } from './systems/shop.js';
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
import { growthScreen } from './ui/growthView.js';
import { teamScreen } from './ui/teamView.js';
import { shopScreen } from './ui/shopView.js';
import { unclaimedCount } from './systems/inbox.js';
import { teamMembers } from './systems/teams.js';
import { checkRegistry } from './battle/engine.js';
import { simulate as simulateBattle } from './battle/sim.js';
import { runSelfTest } from './battle/selftest.js';

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
  data.enemyMap = new Map(data.enemies.map((e) => [e.id, e]));
  data.stageMap = new Map(data.stages.map((s) => [s.id, s]));
  if (data.vocab) {
    const problems = checkRegistry(data.vocab);
    if (problems.length) console.warn(`[battle] 용어집과 엔진 구현이 맞지 않아요: ${problems.join(' / ')}`);
  }

  // 세이브 옮기기/불러오기에 필요한 정보 (v1 중복 → 정수/티켓 환산)
  const saveEnv = { rarityOf: (id) => data.allCharMap.get(id)?.rarity, balance: data.balance };
  const { save, isNew, corrupted, migrated } = loadSave(saveEnv);
  if (isNew && opts.preview) {
    save.gems = 100000;
    save.tickets = 100000;
    save.gold = 10_000_000;
    save.scrolls = 100;
  }
  syncKnownIds(save, data.characters, isNew);
  const daily = isNew ? null : applyDailyLogin(save, { tickets: data.balance.dailyTickets, gold: data.balance.dailyGold });
  const passDaily = claimPassDaily(save); // 월정액: 오늘 몫 보석

  // 모든 화면이 공유하는 게임 상태(ctx)
  const ctx = {
    data,
    save,
    /** 세이브 코드 불러오기용 */
    saveEnv: () => saveEnv,
    /** 마지막 전투 기록 (개발용 __tg.replay) */
    lastBattle: null,
    /** 지금 진행 중인 배너 */
    activeBanners: () => activeBanners(data.banners, data.characters),

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
  const HUD_LINKS = [
    { id: 'mail', label: '우편', icon: '✉︎', key: 'M', onClick: () => go('mail'), dot: () => unclaimedCount(ctx.save, ctx.data.mail) > 0 },
    { id: 'notices', label: '공지', icon: '!', key: 'N', onClick: () => go('notices') },
    { id: 'settings', label: '설정', icon: '⚙︎', key: 'O', onClick: () => go('settings') },
  ];
  const hud = initHud($('hud'), { getSave: () => ctx.save, onBack: () => back(), links: HUD_LINKS });
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
  registerScreen('growth', growthScreen(ctx));
  registerScreen('team', teamScreen(ctx));
  registerScreen('shop', shopScreen(ctx));

  ctx.commit();
  go('home');
  $('boot-screen').remove();

  // 시작 알림
  if (isTimeShifted()) toast(`미리보기 시각: ${formatKST(now())} (KST)`, { duration: 4000 });
  if (corrupted) toast('세이브가 손상되어 새로 시작했어요', { type: 'error', duration: 4000 });
  if (isNew) toast('환영해요! 시작 선물로 보석 1,000개와 골드 20,000을 받았어요', { type: 'success', duration: 3500 });
  if (daily) toast(`오늘의 출석 보상: ${rewardText(daily)}`, { type: 'success', duration: 3500 });
  if (passDaily) toast(`월간 축복: 보석 ${passDaily.gems}개 (남은 ${passDaily.daysLeft}일)`, { type: 'success', duration: 3500 });
  if (migrated) {
    const parts = [migrated.essence && `정수 ${migrated.essence}개`, migrated.tickets && `티켓 ${migrated.tickets.toLocaleString('ko-KR')}장`].filter(Boolean);
    toast(`새 육성 시스템! 중복 캐릭터가 ${parts.length ? parts.join(' · ') : '정수'}(으)로 바뀌었어요`, { type: 'success', duration: 5000 });
  }
  if (!data.characters.length) toast('캐릭터 데이터를 불러오지 못했어요', { type: 'error', duration: 4000 });

  setupKeyboard(ctx);
  setupDevHelpers(ctx);

  // 미리보기 바로가기
  if (opts.story) return go('story', { id: opts.story });
  if (opts.banner) {
    go('gacha', { bannerId: opts.banner });
    const b = ctx.activeBanners().find((x) => x.id === opts.banner) || data.banners.find((x) => x.id === opts.banner);
    if (b) showBannerDetail(ctx, b);
    return;
  }
  if (!opts.preview) await showStartupPopups(ctx, { isNew });
}

/** 키보드 단축키 (PC). 한글 입력 상태에서도 동작하도록 e.code 사용 */
function setupKeyboard(ctx) {
  const SHORTCUTS = { KeyG: 'gacha', KeyC: 'collection', KeyO: 'settings', KeyT: 'stories', KeyM: 'mail', KeyN: 'notices', KeyU: 'growth', KeyP: 'team', KeyS: 'shop' };

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
      const banner = ctx.activeBanners().find((b) => b.id === bannerId) || ctx.activeBanners()[0];
      return simulate(buildPools(ctx.data.characters, banner), n);
    },
    /** 테스트용 보석 추가 */
    addGems: (n = 10000) => {
      addGems(ctx.save, n);
      ctx.commit();
    },
    /** 테스트용 티켓 추가 */
    addTickets: (n = 10000) => {
      addTickets(ctx.save, n);
      ctx.commit();
    },
    /** 테스트용 골드 추가 */
    addGold: (n = 1000000) => {
      addGold(ctx.save, n);
      ctx.commit();
    },
    /** 테스트용 모집 증서 추가 */
    addScrolls: (n = 10) => {
      addScrolls(ctx.save, n);
      ctx.commit();
    },
    /** 지금 편성으로 스테이지 자동 전투 n판 (세이브 영향 없음) */
    sim: (stageId, n = 200) => {
      const stage = ctx.data.stageMap.get(stageId) || ctx.data.stages[0];
      if (!stage) return console.warn('스테이지가 없어요');
      const r = simulateBattle({ team: teamMembers(ctx), stage, data: ctx.data, runs: n });
      console.log(`[${stage.id}] 승률 ${(r.winRate * 100).toFixed(1)}% · 평균 ${r.avgRounds}라운드 · 시간 초과 ${r.timeouts}`);
      console.table(r.units);
      return r;
    },
    /** 전투 엔진 자체 검사 */
    battleTest: () => {
      const stage = ctx.data.stages[0];
      const team = teamMembers(ctx);
      const r = runSelfTest(ctx.data.vocab, stage && team.some(Boolean) ? { team, stage, data: ctx.data } : {});
      console.table(r.results);
      return r.ok;
    },
    /** 마지막 전투의 시드와 행동 기록 */
    replay: () => ctx.lastBattle,
  };
  console.info('%c[Tiny Gacha] 개발 도우미: __tg.simulate(100000[, 배너id]), __tg.addGems(10000), __tg.addTickets(10000), __tg.addGold(1000000), __tg.addScrolls(10), __tg.sim(스테이지id), __tg.battleTest()', 'color:#a970ff');
}

boot().catch((e) => {
  console.error('[boot] 시작 실패', e);
  const el = $('boot-screen');
  if (el) el.textContent = '게임을 시작하지 못했어요. 새로고침해 주세요.';
});
