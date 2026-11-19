// KST(한국 표준시, UTC+9) 관련 유틸
// 한국은 서머타임이 없으므로 고정 오프셋 계산으로 충분합니다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 날짜 객체를 KST 기준 시각 필드로 변환 (getUTC* 로 읽어야 함) */
function toKstShifted(date) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** KST 기준 날짜 키 "YYYY-MM-DD" (일일 보상 판정용) */
export function kstDateKey(date = new Date()) {
  return toKstShifted(date).toISOString().slice(0, 10);
}

/** ISO 문자열 → Date. 잘못된 값이면 null */
export function parseDate(value) {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** KST로 표시: "2026.11.19 13:05" */
export function formatKST(date, { withTime = true } = {}) {
  const d = date instanceof Date ? date : parseDate(date);
  if (!d) return '-';
  const k = toKstShifted(d);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${k.getUTCFullYear()}.${pad(k.getUTCMonth() + 1)}.${pad(k.getUTCDate())}`;
  return withTime ? `${day} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}` : day;
}

/** 현재 시각의 KST ISO 문자열: "2026-11-19T13:05:00+09:00" */
export function nowKstIso(date = new Date()) {
  const k = toKstShifted(date).toISOString(); // "...Z" 이지만 값은 KST 시각
  return `${k.slice(0, 19)}+09:00`;
}
