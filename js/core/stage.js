// 스테이지: 1280x720 고정 논리 화면을 화면 크기에 맞게 확대/축소(레터박스)
// 전체화면 + 가로 고정(안드로이드 크롬). iOS는 고정 불가 → 세로 안내 오버레이와 홈 화면 추가로 대응

export const STAGE_W = 1280;
export const STAGE_H = 720;

let currentScale = 1;
export const getScale = () => currentScale;

/**
 * @param {HTMLElement} viewport 화면 전체를 덮는 바깥 요소 (safe-area 패딩 포함)
 * @param {HTMLElement} stage 1280x720 논리 화면
 */
export function initStage(viewport, stage) {
  function fit() {
    const cs = getComputedStyle(viewport);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const w = viewport.clientWidth - padL - padR;
    const h = viewport.clientHeight - padT - padB;
    if (w <= 0 || h <= 0) return;

    const scale = Math.min(w / STAGE_W, h / STAGE_H);
    const x = padL + (w - STAGE_W * scale) / 2;
    const y = padT + (h - STAGE_H * scale) / 2;
    currentScale = scale;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  // 회전 직후에는 크기가 늦게 반영되는 기기가 있어 한 번 더 맞춤
  const refit = () => {
    fit();
    requestAnimationFrame(fit);
    setTimeout(fit, 250);
  };
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  window.visualViewport?.addEventListener('resize', refit);
  document.addEventListener('fullscreenchange', refit);
  fit();
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/** 전체화면 전환. 결과: {ok, reason?} — reason: 'unsupported' | 'denied' */
export async function enterFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) return { ok: false, reason: 'unsupported' };
  try {
    await request.call(el, { navigationUI: 'hide' });
  } catch (e) {
    console.warn('[stage] 전체화면 실패', e);
    return { ok: false, reason: 'denied' };
  }
  // 가로 고정은 안드로이드 크롬에서만 동작. 실패해도 문제 없음
  try {
    await screen.orientation?.lock?.('landscape');
  } catch (e) {
    console.info('[stage] 화면 방향 고정 미지원', e?.message);
  }
  return { ok: true };
}

export async function exitFullscreen() {
  try {
    screen.orientation?.unlock?.();
  } catch {}
  try {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) await exit.call(document);
  } catch {}
}

export async function toggleFullscreen() {
  if (isFullscreen()) {
    await exitFullscreen();
    return { ok: true, exited: true };
  }
  return enterFullscreen();
}
