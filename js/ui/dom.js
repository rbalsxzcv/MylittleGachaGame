// 작은 DOM 도우미
// h('button', { class: 'btn', onclick: fn }, '라벨') 처럼 요소를 만듭니다.

/**
 * @param {string} tag
 * @param {object} [props] class / style / dataset / text / on이벤트 / 그 밖의 속성
 * @param  {...any} children 문자열, 요소, 배열 (null/false는 무시)
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        // '--rc' 같은 CSS 변수도 지원
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, value);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

/** 보석 아이콘 (CSS로 그린 다이아몬드) */
export function gemIcon() {
  return h('i', { class: 'gem-icon', 'aria-hidden': 'true' });
}
