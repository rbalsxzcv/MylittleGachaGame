// 세이브 데이터: 불러오기 / 검증·정리(sanitize) / 저장 / 세이브 코드 내보내기·가져오기
// localStorage 키: tinygacha_save_v1

import { ID_PATTERN } from './data.js';
import { kstDateKey, nowKstIso } from './time.js';

export const SAVE_KEY = 'tinygacha_save_v1';
export const SAVE_VERSION = 1;
export const START_GEMS = 1000;
const CODE_PREFIX = 'TG1:';
const MAX_GEMS = 999_999_999;
const MAX_IDS = 5000; // 비정상적으로 큰 세이브 방지

// ── 확장용 슬롯 ────────────────────────────────────────────
// 미션/출석/상점 등 새 시스템은 registerSaveSlice로 자기 몫의 세이브 영역을 등록합니다.
//   registerSaveSlice('missions', { create: () => ({...}), sanitize: (raw) => ({...}) })
const slices = new Map();
export function registerSaveSlice(name, def) {
  slices.set(name, def);
}

// ── 작은 검증 도우미 ───────────────────────────────────────
function int(value, min, max, def) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
function isoString(value, def) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : def;
}
function idList(value) {
  if (!Array.isArray(value)) return [];
  const set = new Set();
  for (const id of value) {
    if (typeof id === 'string' && ID_PATTERN.test(id)) set.add(id);
    if (set.size >= MAX_IDS) break;
  }
  return [...set];
}

/** 새 세이브 생성 (첫 시작: 보석 1000개) */
export function createNewSave(now = new Date()) {
  const save = {
    v: SAVE_VERSION,
    gems: START_GEMS,
    createdAt: nowKstIso(now),
    lastLoginDate: kstDateKey(now), // 첫날은 시작 보석이 출석 보상을 대신함
    owned: {},
    knownIds: [], // 지금까지 데이터에서 본 캐릭터 id (NEW 판정용)
    newIds: [], // 새로 추가되어 아직 도감에서 확인하지 않은 id
    featuredId: null,
    pity: { standard: 0 },
    stats: { pulls: 0 },
  };
  for (const [name, def] of slices) save[name] = def.create();
  return save;
}

/**
 * 어떤 값이 들어와도 올바른 형태의 세이브로 정리합니다. 절대 예외를 던지지 않습니다.
 * - 데이터에 없는 캐릭터 id는 지우지 않고 그대로 둡니다(화면에서 무시됨).
 *   나중에 데이터가 복구되면 다시 보입니다.
 */
export function sanitize(raw) {
  const base = createNewSave();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const owned = {};
  if (raw.owned && typeof raw.owned === 'object' && !Array.isArray(raw.owned)) {
    let n = 0;
    for (const [id, entry] of Object.entries(raw.owned)) {
      if (!ID_PATTERN.test(id) || !entry || typeof entry !== 'object') continue;
      owned[id] = {
        stars: int(entry.stars, 1, 5, 1),
        count: int(entry.count, 1, 1_000_000, 1),
        firstAt: isoString(entry.firstAt, base.createdAt),
      };
      if (++n >= MAX_IDS) break;
    }
  }

  const pity = { standard: 0 };
  if (raw.pity && typeof raw.pity === 'object') {
    for (const [key, val] of Object.entries(raw.pity)) {
      if (/^[a-z0-9_-]{1,32}$/i.test(key)) pity[key] = int(val, 0, 1000, 0);
    }
  }

  const save = {
    v: SAVE_VERSION,
    gems: int(raw.gems, 0, MAX_GEMS, 0),
    createdAt: isoString(raw.createdAt, base.createdAt),
    lastLoginDate: typeof raw.lastLoginDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastLoginDate) ? raw.lastLoginDate : null,
    owned,
    knownIds: idList(raw.knownIds),
    newIds: idList(raw.newIds),
    featuredId: typeof raw.featuredId === 'string' && ID_PATTERN.test(raw.featuredId) ? raw.featuredId : null,
    pity,
    stats: { pulls: int(raw.stats?.pulls, 0, Number.MAX_SAFE_INTEGER, 0) },
  };

  for (const [name, def] of slices) {
    try {
      save[name] = def.sanitize(raw[name]);
    } catch {
      save[name] = def.create();
    }
  }
  return save;
}

/**
 * localStorage에서 세이브를 불러옵니다.
 * @returns {{save:object, isNew:boolean, corrupted:boolean}}
 */
export function loadSave() {
  let text = null;
  try {
    text = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    console.warn('[save] localStorage 접근 불가', e);
  }
  if (!text) return { save: createNewSave(), isNew: true, corrupted: false };

  try {
    return { save: sanitize(JSON.parse(text)), isNew: false, corrupted: false };
  } catch (e) {
    console.warn('[save] 세이브가 손상되어 새로 시작합니다', e);
    // 손상된 원본은 혹시 모르니 별도 키에 보관
    try {
      localStorage.setItem(`${SAVE_KEY}_corrupt`, text);
    } catch {}
    return { save: createNewSave(), isNew: true, corrupted: true };
  }
}

/** 저장. 실패하면 false */
export function writeSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (e) {
    console.warn('[save] 저장 실패', e);
    return false;
  }
}

/** 세이브 삭제 (데이터 초기화) */
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

// ── 세이브 코드 (UTF-8 안전 base64) ──────────────────────────
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** 세이브 → 코드 문자열 */
export function exportCode(save) {
  return CODE_PREFIX + utf8ToBase64(JSON.stringify(save));
}

/**
 * 코드 문자열 → 세이브. 형식이 틀리면 ok:false (기존 세이브는 건드리지 않음)
 * @returns {{ok:true, save:object} | {ok:false, error:string}}
 */
export function parseCode(code) {
  const cleaned = String(code || '').replace(/\s+/g, '');
  if (!cleaned) return { ok: false, error: '코드를 입력해 주세요.' };
  if (!cleaned.startsWith(CODE_PREFIX)) return { ok: false, error: 'Tiny Gacha 세이브 코드가 아니에요.' };
  try {
    const raw = JSON.parse(base64ToUtf8(cleaned.slice(CODE_PREFIX.length)));
    if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION || typeof raw.owned !== 'object') {
      return { ok: false, error: '세이브 내용이 올바르지 않아요.' };
    }
    return { ok: true, save: sanitize(raw) };
  } catch {
    return { ok: false, error: '코드가 손상되었거나 잘렸어요.' };
  }
}
