// 아주 작은 이벤트 버스 — 화면끼리 직접 참조하지 않고 변경 사항을 알리기 위해 사용
// 사용 예: on('save:changed', (save) => ...) / emit('save:changed', save)

const listeners = new Map();

/** 이벤트 구독. 반환된 함수를 호출하면 구독 해제 */
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => off(name, fn);
}

export function off(name, fn) {
  listeners.get(name)?.delete(fn);
}

export function emit(name, payload) {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (e) {
      // 한 구독자의 오류가 다른 구독자를 막지 않도록
      console.error(`[events] '${name}' 처리 중 오류`, e);
    }
  }
}
