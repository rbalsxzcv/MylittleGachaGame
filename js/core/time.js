// 시간 유틸 — 모든 시간은 KST(한국 표준시, UTC+9) 기준으로 표시/판정합니다.
// 한국은 서머타임이 없으므로 고정 오프셋 계산으로 충분합니다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 미리보기용 시간 이동: 실제 시각과의 차이(ms). null이면 실제 시각
let offsetMs = 0;

/** 현재 시각 (미리보기에서 시간 이동 중이면 그 시각) */
export function now() {
  return new Date(Date.now() + offsetMs);
}

/** 미리보기 전용: 지정한 시각부터 시간이 흐르도록 설정 */
export function setNowOverride(date) {
  offsetMs = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() - Date.now() : 0;
}

export const isTimeShifted = () => offsetMs !== 0;

/** 날짜 객체를 KST 기준 시각 필드로 변환 (getUTC* 로 읽어야 함) */
function toKstShifted(date) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** KST 기준 날짜 키 "YYYY-MM-DD" (일일 보상 판정용) */
export function kstDateKey(date = now()) {
  return toKstShifted(date).toISOString().slice(0, 10);
}

/** KST 기준 주 키: 그 주 월요일의 "YYYY-MM-DD" (주간 초기화 판정용) */
export function kstWeekKey(date = now()) {
  const k = toKstShifted(date);
  const back = (k.getUTCDay() + 6) % 7; // 월요일 = 0
  return new Date(k.getTime() - back * 86400000).toISOString().slice(0, 10);
}

/** KST 기준 월 키 "YYYY-MM" (월간 초기화 판정용) */
export function kstMonthKey(date = now()) {
  return toKstShifted(date).toISOString().slice(0, 7);
}

/** "YYYY-MM-DD"에 n일 더한 날짜 키 */
export function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
}

/** 두 날짜 키 사이의 일수 (b − a) */
export function daysBetweenKeys(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * 다음 초기화 시각 (KST 자정 기준)
 * @param {'day'|'week'|'month'} per
 * @returns {Date|null}
 */
export function nextResetAt(per, date = now()) {
  const k = toKstShifted(date);
  const midnight = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  let next;
  if (per === 'day') next = midnight + 86400000;
  else if (per === 'week') next = midnight + (7 - ((k.getUTCDay() + 6) % 7)) * 86400000;
  else if (per === 'month') next = Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1);
  else return null;
  return new Date(next - KST_OFFSET_MS);
}

/** ISO 문자열 → Date. 잘못된 값이면 null */
export function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

/** KST로 표시: "2026.11.19 13:05" */
export function formatKST(date, { withTime = true, withYear = true } = {}) {
  const d = parseDate(date);
  if (!d) return '-';
  const k = toKstShifted(d);
  const md = `${pad(k.getUTCMonth() + 1)}.${pad(k.getUTCDate())}`;
  const day = withYear ? `${k.getUTCFullYear()}.${md}` : md;
  return withTime ? `${day} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}` : day;
}

/** 기간 표시: "12.01 00:00 ~ 12.15 23:59" (시작/끝이 없으면 생략) */
export function formatPeriod(startAt, endAt) {
  const s = parseDate(startAt);
  const e = parseDate(endAt);
  if (!s && !e) return '상시';
  const f = (d) => formatKST(d, { withYear: false });
  if (s && e) return `${f(s)} ~ ${f(e)}`;
  return s ? `${f(s)} ~` : `~ ${f(e)}`;
}

/** 남은 시간 표시: "3일 4시간", "4시간 12분", "12분" */
export function formatRemaining(ms) {
  if (ms <= 0) return '종료';
  const min = Math.floor(ms / 60000);
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${mins}분`;
  return mins > 0 ? `${mins}분` : '1분 미만';
}

/** 현재 시각의 KST ISO 문자열: "2026-11-19T13:05:00+09:00" */
export function nowKstIso(date = now()) {
  const k = toKstShifted(date).toISOString(); // "...Z" 이지만 값은 KST 시각
  return `${k.slice(0, 19)}+09:00`;
}

/** 기간 안에 있는지 (시작/끝이 없으면 그쪽은 제한 없음). 끝 시각은 포함하지 않음 */
export function inPeriod(startAt, endAt, t = now()) {
  const s = parseDate(startAt);
  const e = parseDate(endAt);
  return (!s || s <= t) && (!e || t < e);
}
