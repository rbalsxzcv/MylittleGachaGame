// 남은 시간 표시 갱신
// 요소에 data-end="ISO 시각"을 붙여두면 "종료까지 3일 4시간" 형식으로 자동 갱신됩니다.
import { h } from './dom.js';
import { now, parseDate, formatRemaining } from '../core/time.js';

/** 남은 시간 표시 요소 (끝 시각이 없으면 null) */
export function countdownEl(endAt, className = 'countdown') {
  const end = parseDate(endAt);
  if (!end) return null;
  const el = h('span', { class: className, dataset: { end: endAt } });
  el.textContent = label(end - now()); // 바로 표시 (다음 갱신까지 비어 있지 않게)
  return el;
}

const label = (ms) => (ms > 0 ? `종료까지 ${formatRemaining(ms)}` : '종료됨');

/**
 * @param {HTMLElement} root 이 안의 [data-end] 요소를 갱신
 * @param {()=>void} [onTick] 매번 호출 (배너 목록 변경 확인 등)
 * @returns {()=>void} 정지 함수
 */
export function startCountdowns(root, onTick, intervalMs = 20000) {
  const tick = () => {
    const t = now();
    root.querySelectorAll('[data-end]').forEach((el) => {
      el.textContent = label(parseDate(el.dataset.end) - t);
    });
    onTick?.();
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
