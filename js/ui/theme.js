// 화면 에셋(배경 그림, 로고, 아이콘) 적용
// data/ui.json에 그림이 있으면 그림을 쓰고, 없거나 불러오기에 실패하면 CSS 기본 디자인으로 보여 줍니다.
//   { "backgrounds": { "home": "assets/ui/bg_home.jpg", ... },
//     "icons": { "logo": "assets/ui/icon_logo.png", "gem": "...", "menu_gacha": "...", ... } }
import { h, setGemIconSrc } from './dom.js';

let theme = { backgrounds: {}, icons: {} };

export function setTheme(t) {
  theme = { backgrounds: t?.backgrounds || {}, icons: t?.icons || {} };
  setGemIconSrc(theme.icons.gem || '');
}

export const themeIcon = (key) => theme.icons[key] || '';

/**
 * 아이콘 그림 (없거나 실패하면 fallback 요소)
 * @param {string} key ui.json icons의 키 (예: 'logo', 'menu_gacha')
 * @param {Node|string} fallback CSS/글자로 된 기본 모양
 */
export function iconOr(key, fallback, className = 'theme-icon') {
  const src = themeIcon(key);
  const fb = typeof fallback === 'string' ? document.createTextNode(fallback) : fallback;
  if (!src) return fb;
  const img = h('img', { class: className, src, alt: '', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(fb), { once: true });
  return img;
}

/** 화면 요소에 배경 그림 깔기 (router가 화면을 만들 때 호출) */
export function decorateScreen(el, screenName) {
  const src = theme.backgrounds[screenName];
  if (!src) return;
  el.classList.add('has-bg');
  const img = h('img', { class: 'screen-bg', src, alt: '', draggable: 'false' });
  img.addEventListener('error', () => {
    img.remove();
    el.classList.remove('has-bg');
  }, { once: true });
  // 그림 위 글자가 잘 보이도록 살짝 어둡게
  el.prepend(img, h('div', { class: 'screen-bg-shade' }));
}
