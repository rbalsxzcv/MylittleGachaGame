// 화면 위에 잠깐 떴다 사라지는 알림
import { h } from './dom.js';

let layer = null;
const MAX_TOASTS = 3;

export function initToast(el) {
  layer = el;
}

/**
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error', duration?: number}} [opts]
 */
export function toast(message, { type = 'info', duration = 2400 } = {}) {
  if (!layer) return console.info('[toast]', message);
  while (layer.children.length >= MAX_TOASTS) layer.firstElementChild.remove();

  const el = h('div', { class: `toast toast-${type}`, role: 'status' }, message);
  layer.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}
