// Phaser 호스트: 가챠 연출과 전투 화면이 같이 쓰는 Phaser.Game 하나
//
// - Phaser(js/vendor/phaser.min.js)와 한국어 글꼴(Pretendard)은 처음 필요할 때 한 번만 불러옴
// - 캔버스는 CSS로 확대/축소되는 #stage 안이 아니라 화면 전체를 덮는 #fx-layer에 붙임
//   (Phaser가 스스로 1280×720을 FIT + 가운데 정렬 → 입력 좌표가 어긋나지 않음)
// - 장면이 끝나면 레이어를 숨기고 게임 루프를 재움 (메뉴 화면에서는 움직임 없음)
// 메뉴 HTML 화면은 그대로 두고, 연출/전투 때만 이 레이어가 위에 뜹니다.

export const FX_W = 1280;
export const FX_H = 720;
/** 글꼴 이름 (Phaser Text에 씀). 불러오기 실패해도 시스템 한글 글꼴로 대체 */
export const FONT = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

/** 게임 루트 주소 (index.html이 있는 곳). 개발 도구 미리보기(/preview/)나 fx-test에서도 맞게 */
export const GAME_ROOT = new URL('../../', import.meta.url);
/** 데이터의 상대 경로('assets/...') → 절대 주소 */
export const assetUrl = (path) => (path ? new URL(path, GAME_ROOT).href : '');

let phaserPromise = null;
let gamePromise = null;
let layer = null;
let running = null; // { key, resolve }

/** Phaser 스크립트 불러오기 (한 번만) */
export function loadPhaser() {
  if (globalThis.Phaser) return Promise.resolve(globalThis.Phaser);
  phaserPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/phaser.min.js', import.meta.url).href;
    s.async = true;
    s.onload = () => (globalThis.Phaser ? resolve(globalThis.Phaser) : reject(new Error('Phaser를 찾을 수 없어요')));
    s.onerror = () => {
      phaserPromise = null;
      reject(new Error('Phaser 파일을 불러오지 못했어요'));
    };
    document.head.append(s);
  });
  return phaserPromise;
}

let fontsPromise = null;
/** 한국어 웹 글꼴 — Phaser Text를 만들기 전에 반드시 끝나야 글자가 대체 글꼴로 굳지 않음 */
export function loadFonts() {
  fontsPromise ??= (async () => {
    if (typeof FontFace === 'undefined' || !document.fonts) return;
    const faces = [
      ['700', 'Pretendard-Bold.subset.woff2'],
      ['800', 'Pretendard-ExtraBold.subset.woff2'],
    ].map(([weight, file]) => new FontFace('Pretendard', `url(${new URL(`../../assets/fonts/${file}`, import.meta.url).href}) format('woff2')`, { weight, display: 'block' }));
    await Promise.all(
      faces.map(async (f) => {
        try {
          await f.load();
          document.fonts.add(f);
        } catch (e) {
          console.warn('[fx] 글꼴을 불러오지 못했어요 (시스템 글꼴 사용)', e);
        }
      }),
    );
  })();
  return fontsPromise;
}

/** 모션 줄이기 설정 (prefers-reduced-motion) */
export const prefersReducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 기기 성능에 따른 효과 양 (1 = 보통, 0.4 = 가벼움) */
export function fxQuality(game) {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const webgl = game?.renderer?.type === globalThis.Phaser?.WEBGL;
  if (!webgl) return 0.3;
  return cores <= 4 || mem <= 2 ? 0.45 : 1;
}

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = 'fx-layer';
  layer.hidden = true;
  // style.css가 없는 페이지(dev/fx-test.html)에서도 화면 전체를 덮도록 직접 지정
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '1500', background: '#07040f', touchAction: 'none', userSelect: 'none' });
  document.body.append(layer);
  return layer;
}

/** Phaser.Game 하나 만들기 (처음 한 번) */
export function getGame() {
  gamePromise ??= (async () => {
    const [Phaser] = await Promise.all([loadPhaser(), loadFonts()]);
    const parent = ensureLayer();
    parent.hidden = false; // 크기 계산을 위해 잠깐 보이게
    const game = await new Promise((resolve) => {
      const g = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        width: FX_W,
        height: FX_H,
        backgroundColor: '#07040f',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        input: { activePointers: 2 },
        render: { antialias: true, powerPreference: 'high-performance' },
        banner: false,
        callbacks: { postBoot: (game) => resolve(game) },
      });
      g.events.once('ready', () => resolve(g));
    });
    parent.hidden = true;
    game.loop.sleep();
    return game;
  })().catch((e) => {
    gamePromise = null;
    throw e;
  });
  return gamePromise;
}

/**
 * 장면 하나를 전체 화면 레이어에서 실행하고, 장면이 finish(result)를 부르면 끝남
 * @param {string} key 장면 이름 (한 번 등록하면 재사용)
 * @param {(Phaser)=>Function} factory 장면 클래스를 만드는 함수 (Phaser를 받음)
 * @param {object} data 장면 init(data)로 전달
 * @returns {Promise<any>} 장면이 넘긴 결과
 */
export async function runScene(key, factory, data = {}) {
  const game = await getGame();
  if (running) running.resolve(null); // 이전 장면이 남아 있으면 정리
  if (!game.scene.getScene(key)) game.scene.add(key, factory(globalThis.Phaser), false);
  for (const s of game.scene.getScenes(true)) if (s.scene.key !== key) s.scene.stop();
  const el = ensureLayer();
  el.hidden = false;
  el.dataset.scene = key;
  game.loop.wake();
  game.scale.refresh();
  return new Promise((resolve) => {
    running = {
      key,
      resolve: (result) => {
        if (!running || running.key !== key) return;
        running = null;
        game.scene.stop(key);
        el.hidden = true;
        delete el.dataset.scene;
        game.loop.sleep();
        resolve(result);
      },
    };
    game.scene.start(key, { ...data, finish: (result) => running?.resolve(result) });
  });
}

/** 실행 중인 장면을 결과 없이 끝냄 (화면을 떠날 때) */
export function stopRunningScene() {
  running?.resolve(null);
}

/** 지금 실행 중인 장면 이름 (없으면 null) */
export const currentSceneKey = () => running?.key ?? null;

/** CSS 토큰(--rar-1..5 등) → Phaser 색 숫자 */
export function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  return m ? parseInt(m[1], 16) : fallback;
}

/** 희귀도 색 (style.css의 --rar-1..5와 같음) */
export function rarityColor(r) {
  const fb = { 1: 0x9aa3ad, 2: 0x5fc77a, 3: 0x4f9dff, 4: 0xa970ff, 5: 0xffc23d };
  return cssColor(`--rar-${r}`, fb[r] ?? fb[3]);
}

/** '#d9a441' → 0xd9a441 (잘못되면 fallback) */
export function hexToInt(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  return m ? parseInt(m[1], 16) : fallback;
}
