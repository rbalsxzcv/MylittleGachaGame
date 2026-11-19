// 일괄 생성 상태 지켜보기 (어느 탭에 있든)
// - 진행 중이면 1.5초마다 서버 상태를 받아서 구독자(일괄 생성 탭, 상단 칩)에게 알림
// - 새로 오류가 난 항목, 끝남/중단을 알림(toast)으로 알려 줌
import { toast } from './ui.js';
import { api } from './api.js';

const listeners = new Set();
let current = null;
let timer = null;
let seenErrors = new Set();
let seenFinish = null;

export const batchState = () => current;

export function onBatch(fn) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function notify(prev, next) {
  if (!next) return;
  if (!prev || prev.id !== next.id) {
    seenErrors = new Set(next.items.filter((i) => i.status === 'error').map((i) => i.key));
    // 페이지를 새로 연 경우: 이미 끝난 일괄 작업은 다시 알리지 않음
    if (!prev && !next.running) seenFinish = next.id;
  }
  for (const i of next.items) {
    if (i.status === 'error' && !seenErrors.has(i.key)) {
      seenErrors.add(i.key);
      toast(`일괄 생성 오류 — ${i.label}: ${i.error}`, 'error', 9000);
    }
  }
  if (!next.running && seenFinish !== next.id) {
    seenFinish = next.id;
    const c = next.counts || {};
    const summary = `완료 ${c.done || 0} · 오류 ${c.error || 0}${c.skipped ? ` · 건너뜀 ${c.skipped}` : ''}${c.cancelled ? ` · 중단 ${c.cancelled}` : ''}`;
    const head = { cancelled: '일괄 생성을 중단했어요', connect: 'ComfyUI 연결 오류로 일괄 생성을 멈췄어요', error: '오류가 나서 일괄 생성을 멈췄어요' }[next.stopReason] || '일괄 생성이 끝났어요';
    toast(`${head} (${summary})`, next.stopReason ? 'error' : 'success', 8000);
  }
}

export async function refreshBatch() {
  try {
    const r = await api.get('/api/batch');
    const prev = current;
    current = r.batch;
    notify(prev, current);
    listeners.forEach((fn) => fn(current));
  } catch (e) {
    console.error(e);
  }
  schedule();
  return current;
}

function schedule() {
  clearTimeout(timer);
  if (current?.running) timer = setTimeout(refreshBatch, 1500);
}

/** 서버 응답으로 받은 상태를 바로 반영 (시작/중단 직후) */
export function setBatch(next) {
  const prev = current;
  current = next;
  notify(prev, current);
  listeners.forEach((fn) => fn(current));
  schedule();
}
