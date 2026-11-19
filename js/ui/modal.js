// 모달(팝업) — Promise로 결과를 돌려줍니다.
//   const ok = await confirmModal('제목', '내용');
import { h } from './dom.js';

let layer = null;
const stack = [];

export function initModal(el) {
  layer = el;
}

export const hasOpenModal = () => stack.length > 0;

/** 가장 위의 모달을 닫음 (Esc 키) */
export function closeTopModal() {
  stack.at(-1)?.dismiss();
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {Node|string|Array} [opts.body]
 * @param {Array<{label:string, value?:any, primary?:boolean, danger?:boolean, disabled?:boolean,
 *                onClick?:()=>any}>} [opts.buttons]  onClick이 false를 반환하면 닫지 않음
 * @param {any} [opts.dismissValue] 바깥 클릭/Esc로 닫을 때의 결과
 * @param {string} [opts.className]
 */
export function openModal({ title, body, buttons = [{ label: '확인', value: true, primary: true }], dismissValue = null, className = '' }) {
  return new Promise((resolve) => {
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 180);
      resolve(value);
    };

    const buttonEls = buttons.map((b) =>
      h(
        'button',
        {
          class: ['btn', b.primary && 'btn-primary', b.danger && 'btn-danger'],
          disabled: b.disabled,
          onclick: async () => {
            if (b.onClick) {
              const r = await b.onClick();
              if (r === false) return;
            }
            close(b.value);
          },
        },
        b.label,
      ),
    );

    const panel = h(
      'div',
      { class: ['modal', className], role: 'dialog', 'aria-modal': 'true' },
      title && h('h2', { class: 'modal-title' }, title),
      body != null && h('div', { class: 'modal-body' }, body),
      buttonEls.length > 0 && h('div', { class: 'modal-actions' }, buttonEls),
    );
    const backdrop = h('div', { class: 'modal-backdrop' }, panel);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(dismissValue);
    });

    const entry = { dismiss: () => close(dismissValue) };
    stack.push(entry);
    layer.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));

    // 키보드 사용자를 위해 기본 버튼에 포커스 (입력칸이 있으면 입력칸 우선)
    const focusTarget = panel.querySelector('textarea, input') || buttonEls.find((_, i) => buttons[i].primary) || buttonEls[0];
    setTimeout(() => focusTarget?.focus({ preventScroll: true }), 30);
  });
}

export function alertModal(title, message) {
  return openModal({ title, body: message, dismissValue: true });
}

export function confirmModal(title, message, { okLabel = '확인', cancelLabel = '취소', danger = false } = {}) {
  return openModal({
    title,
    body: message,
    dismissValue: false,
    buttons: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  });
}
