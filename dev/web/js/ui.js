// 개발 도구 공용 UI 도우미: 요소 만들기, 알림, 모달, 날짜 변환
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = !!value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  const add = (list) => {
    for (const c of list) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) add(c);
      else el.append(c instanceof Node ? c : String(c));
    }
  };
  add(children);
  return el;
}

// ── 알림 ──
export function toast(message, type = 'info', ms = 3000) {
  const layer = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}` }, message);
  layer.append(el);
  setTimeout(() => el.remove(), ms);
}

// ── 모달 ──
/** body와 버튼으로 모달을 열고, 누른 버튼의 value를 돌려줌
 * body가 함수면 body(close)로 만들어요 → 안의 요소가 close(value)로 직접 닫을 수 있음 (그림 고르기 등) */
export function modal({ title, body, buttons = [{ label: '닫기', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const close = (v) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    const panel = h(
      'div',
      { class: ['modal', wide && 'wide'] },
      title && h('h2', {}, title),
      h('div', { class: 'modal-body' }, typeof body === 'function' ? body((v) => close(v)) : body),
      h(
        'div',
        { class: 'modal-actions' },
        buttons.map((b) =>
          h(
            'button',
            {
              class: ['btn', b.primary && 'primary', b.danger && 'danger'],
              onclick: async () => {
                if (b.onClick && (await b.onClick()) === false) return;
                close(b.value);
              },
            },
            b.label,
          ),
        ),
      ),
    );
    const backdrop = h('div', { class: 'backdrop' }, panel);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey);
    setTimeout(() => panel.querySelector('textarea, input, .btn.primary')?.focus(), 30);
  });
}

export function confirmBox(title, message, { ok = '확인', danger = false } = {}) {
  return modal({
    title,
    body: h('p', { class: 'pre' }, message),
    buttons: [
      { label: '취소', value: false },
      { label: ok, value: true, primary: !danger, danger },
    ],
  });
}

/** 한 줄/여러 줄 입력 받기. 취소하면 null */
export async function promptBox(title, label, { multiline = true, value = '', placeholder = '' } = {}) {
  const input = multiline ? h('textarea', { rows: 4, placeholder }, value) : h('input', { value, placeholder });
  const result = await modal({
    title,
    body: h('label', { class: 'field' }, label, input),
    buttons: [
      { label: '취소', value: null },
      { label: '확인', value: 'ok', primary: true },
    ],
  });
  return result === 'ok' ? input.value.trim() : null;
}

// ── 진행 중 표시 ──
let busyCount = 0;
export async function busy(message, fn) {
  const el = document.getElementById('busy');
  busyCount++;
  el.querySelector('span').textContent = message;
  el.hidden = false;
  try {
    return await fn();
  } finally {
    if (--busyCount === 0) el.hidden = true;
  }
}

// ── KST 날짜 ↔ <input type="datetime-local"> ──
const KST_MS = 9 * 3600 * 1000;
/** '2026-12-01T00:00:00+09:00' → '2026-12-01T00:00' (KST 기준) */
export function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 16);
}
/** '2026-12-01T00:00' (KST로 입력) → '2026-12-01T00:00:00+09:00' */
export function localToIso(value) {
  return value ? `${value.length === 16 ? `${value}:00` : value}+09:00` : null;
}
export function nowIso() {
  return localToIso(new Date(Date.now() + KST_MS).toISOString().slice(0, 16));
}
export function fmt(iso) {
  return iso ? isoToLocal(iso).replace('T', ' ') : '—';
}

/** 날짜 입력 + '제한 없음' 체크박스 */
export function dateField(label, iso, { allowEmpty = true, emptyLabel = '제한 없음' } = {}) {
  const input = h('input', { type: 'datetime-local', value: isoToLocal(iso) });
  const none = allowEmpty ? h('input', { type: 'checkbox', checked: !iso }) : null;
  const sync = () => (input.disabled = !!none?.checked);
  none?.addEventListener('change', sync);
  sync();
  const el = h('label', { class: 'field' }, `${label} (KST)`, h('div', { class: 'row' }, input, none && h('label', { class: 'inline' }, none, emptyLabel)));
  return { el, get: () => (none?.checked ? null : localToIso(input.value)) };
}

/** 이미지 주소 (캐시 방지) */
export function wsImage(path) {
  return path ? `/ws/${path}?t=${Date.now()}` : '';
}

export function slugOk(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id || '');
}

// 희귀도 1–5 (높은 것부터). 예전 데이터의 'R'/'SR'/'SSR'은 3/4/5로 읽음 (게임 js/config.js와 같은 규칙)
export const RARITIES = [5, 4, 3, 2, 1];
const LEGACY_RARITY = { R: 3, SR: 4, SSR: 5 };
export function rarOf(v) {
  if (typeof v === 'string' && v in LEGACY_RARITY) return LEGACY_RARITY[v];
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3;
}
/** 표시용: 5 → '5★' */
export const rarLabel = (v) => `${rarOf(v)}★`;
/** 희귀도 고르기 select (값은 숫자 문자열 → 쓸 때 rarOf로) */
export const raritySelect = (value) => {
  const s = h('select', {}, RARITIES.map((r) => h('option', { value: String(r) }, `${r}★`)));
  s.value = String(rarOf(value));
  return s;
};


// ── id: 개발자가 정하지 않음 (서버가 <종류>_<4자리>로 발급, dev/ids.json) ──
/** 읽기 전용 id 표시. id가 없으면 '저장하면 자동으로 정해져요' */
export function idBadge(id, hint = '저장하면 자동으로 정해져요') {
  return h('code', { class: ['id-badge', !id && 'is-pending'], title: id ? '자동으로 정해진 id (바꿀 수 없어요)' : hint }, id || hint);
}

