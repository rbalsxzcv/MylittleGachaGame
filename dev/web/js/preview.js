// 플레이어 게임 미리보기 (작업 공간 데이터를 실제 게임 화면 그대로 띄움)
import { h, modal } from './ui.js';

/**
 * @param {{story?:string, banner?:string, now?:string}} params
 *   now: 그 시각으로 시간 이동 (미래 배너/이벤트 확인용)
 */
export function openPreview(params = {}) {
  const q = new URLSearchParams({ preview: '1' });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const url = `/preview/index.html?${q}`;
  const frame = h('iframe', { class: 'preview-frame', src: url, title: '게임 미리보기' });
  modal({
    title: '게임 미리보기 (작업 공간 데이터)',
    wide: true,
    body: h(
      'div',
      {},
      h('p', { class: 'muted small' }, '미리보기 전용 세이브를 써서 실제 플레이 기록과 섞이지 않아요. 보석은 넉넉히 들어 있어요.'),
      frame,
      h('p', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, '새 창에서 열기 ↗')),
    ),
  });
}
