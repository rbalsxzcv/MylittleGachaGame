// 화면 전환(라우터)
// 화면 등록: registerScreen('home', { title, hud, transient, mount(el, params) → { destroy?, onKey? } })
//  - hud: 'full'(뒤로+제목+보석) | 'gems'(보석만) | 'none'
//  - transient: true면 뒤로가기 기록에 남지 않음 (예: 뽑기 연출 화면)
//  - onKey(e): 키 입력을 처리했으면 true 반환

import { h } from './dom.js';

const screens = new Map();
const history = [];
let layer = null;
let current = null;
let onChange = null;

export function initRouter(layerEl, changeCallback) {
  layer = layerEl;
  onChange = changeCallback;
}

export function registerScreen(name, def) {
  screens.set(name, { hud: 'full', transient: false, ...def });
}

export const currentScreen = () => current?.name ?? null;

function show(name, params) {
  const def = screens.get(name);
  if (!def) return console.warn(`[router] 없는 화면: ${name}`);

  try {
    current?.api?.destroy?.();
  } catch (e) {
    console.error('[router] destroy 오류', e);
  }

  const el = h('div', { class: `screen screen-${name}` });
  layer.replaceChildren(el);
  let api = {};
  try {
    api = def.mount(el, params) || {};
  } catch (e) {
    console.error(`[router] '${name}' 화면 오류`, e);
    el.append(h('div', { class: 'screen-error' }, '화면을 표시하는 중 문제가 생겼어요.'));
  }
  current = { name, params, def, api };
  onChange?.(current);
}

/** 화면 이동 */
export function go(name, params = {}, { replace = false } = {}) {
  if (name === 'home') history.length = 0;
  else if (current && !replace && !current.def.transient) {
    history.push({ name: current.name, params: current.params });
  }
  show(name, params);
}

/** 뒤로 가기. 기록이 없으면 홈으로 */
export function back() {
  const prev = history.pop();
  if (prev) show(prev.name, prev.params);
  else if (current?.name !== 'home') show('home', {});
}

/** 현재 화면에 키 입력 전달 */
export function dispatchKey(e) {
  return !!current?.api?.onKey?.(e);
}
