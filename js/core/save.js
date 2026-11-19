// 세이브 데이터: 불러오기 / 검증·정리(sanitize) / 저장 / 세이브 코드 내보내기·가져오기
// localStorage 키: tinygacha_save_v2 (v1 세이브는 처음 한 번 v2로 옮기고, v1 키는 백업으로 그대로 둠)

import { ID_PATTERN } from './data.js';
import { kstDateKey, nowKstIso, now } from './time.js';

const BASE_SAVE_KEY = 'tinygacha_save_v2';
const BASE_V1_KEY = 'tinygacha_save_v1';
// 개발 도구 미리보기에서는 별도 키를 써서 실제 세이브와 섞이지 않게 함
let SAVE_KEY = BASE_SAVE_KEY;
let V1_KEY = BASE_V1_KEY;
export function usePreviewSaveKey() {
  SAVE_KEY = `${BASE_SAVE_KEY}_preview`;
  V1_KEY = `${BASE_V1_KEY}_preview`;
}
export const SAVE_VERSION = 2;
export const START_GEMS = 1000;
const CODE_PREFIX = 'TG2:';
const V1_CODE_PREFIX = 'TG1:';
const MAX_GEMS = 999_999_999;
const MAX_LEVEL = 1_000_000; // 레벨 제한은 없지만 비정상 값 방지
export const TEAM_SIZE = 5;
export const TEAM_PRESETS = 3;
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
export function createNewSave(t = now()) {
  const save = {
    v: SAVE_VERSION,
    gems: START_GEMS,
    createdAt: nowKstIso(t),
    lastLoginDate: kstDateKey(t), // 첫날은 시작 보석이 출석 보상을 대신함
    owned: {},
    knownIds: [], // 지금까지 데이터에서 본 캐릭터 id (NEW 판정용)
    newIds: [], // 새로 추가되어 아직 도감에서 확인하지 않은 id
    featuredId: null,
    pity: { standard: 0, pickup: 0 }, // 배너 종류별 천장 카운트 (상시/픽업 따로)
    guaranteed: { pickup: false }, // 픽업 50% 실패 → 다음 SSR은 픽업 확정
    readStories: {}, // 스토리 id → 처음 다 읽은 시각
    claimedMail: [], // 받은 우편 id
    hiddenNotices: [], // "다시 보지 않기" 한 공지 id
    seenContentVersion: 0, // 마지막으로 확인한 업데이트 버전
    stats: { pulls: 0 },
    tickets: 0,
    teams: defaultTeams(),
    stages: {}, // 스테이지 id → { clears, firstClaimed, bestRounds }
  };
  for (const [name, def] of slices) save[name] = def.create();
  return save;
}

export function defaultTeams() {
  return {
    active: 0,
    presets: Array.from({ length: TEAM_PRESETS }, (_, i) => ({ name: `편성 ${i + 1}`, slots: Array(TEAM_SIZE).fill(null) })),
  };
}

function cleanTeams(raw) {
  const base = defaultTeams();
  if (!raw || typeof raw !== 'object') return base;
  base.active = int(raw.active, 0, TEAM_PRESETS - 1, 0);
  const presets = Array.isArray(raw.presets) ? raw.presets : [];
  base.presets.forEach((p, i) => {
    const src = presets[i];
    if (!src || typeof src !== 'object') return;
    if (typeof src.name === 'string' && src.name.trim()) p.name = src.name.trim().slice(0, 12);
    const seen = new Set();
    p.slots = Array.from({ length: TEAM_SIZE }, (_, j) => {
      const id = Array.isArray(src.slots) ? src.slots[j] : null;
      if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) return null;
      seen.add(id);
      return id;
    });
  });
  return base;
}

function cleanStages(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, e] of Object.entries(raw).slice(0, MAX_IDS)) {
    if (!ID_PATTERN.test(id) || !e || typeof e !== 'object') continue;
    out[id] = {
      clears: int(e.clears, 0, 1_000_000_000, 0),
      firstClaimed: e.firstClaimed === true,
      bestRounds: e.bestRounds == null ? null : int(e.bestRounds, 1, 100000, null),
    };
  }
  return out;
}

/**
 * v1 → v2: 중복 획득(count − 1)은 정수로, 최대(5)를 넘는 몫은 티켓으로
 * @param {object} raw v1 세이브 (JSON 그대로)
 * @param {{rarityOf:(id:string)=>string|undefined, balance:object}} env
 * @returns {{raw:object, tickets:number, essence:number}}
 */
export function migrateV1(raw, { rarityOf, balance }) {
  const out = { ...raw, v: SAVE_VERSION, owned: {}, tickets: 0 };
  let tickets = 0;
  let essence = 0;
  const maxBt = balance?.maxBreakthrough ?? 5;
  if (raw?.owned && typeof raw.owned === 'object') {
    for (const [id, entry] of Object.entries(raw.owned)) {
      if (!entry || typeof entry !== 'object') continue;
      const count = int(entry.count, 1, 1_000_000, 1);
      const dupes = count - 1;
      const keep = Math.min(dupes, maxBt);
      const rate = balance?.essenceTickets?.[rarityOf(id)] ?? balance?.essenceTickets?.R ?? 30;
      tickets += (dupes - keep) * rate;
      essence += keep;
      out.owned[id] = { level: 1, essence: keep, breakthrough: 0, count, firstAt: entry.firstAt };
    }
  }
  out.tickets = tickets;
  return { raw: out, tickets, essence };
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
        level: int(entry.level, 1, MAX_LEVEL, 1),
        essence: int(entry.essence, 0, 99, 0),
        breakthrough: int(entry.breakthrough, 0, 5, 0),
        count: int(entry.count, 1, 1_000_000, 1),
        firstAt: isoString(entry.firstAt, base.createdAt),
      };
      if (++n >= MAX_IDS) break;
    }
  }

  const pity = { standard: 0, pickup: 0 };
  if (raw.pity && typeof raw.pity === 'object') {
    for (const [key, val] of Object.entries(raw.pity)) {
      if (/^[a-z0-9_-]{1,32}$/i.test(key)) pity[key] = int(val, 0, 1000, 0);
    }
  }
  const guaranteed = { pickup: false };
  if (raw.guaranteed && typeof raw.guaranteed === 'object') {
    for (const [key, val] of Object.entries(raw.guaranteed)) {
      if (/^[a-z0-9_-]{1,32}$/i.test(key)) guaranteed[key] = val === true;
    }
  }
  const readStories = {};
  if (raw.readStories && typeof raw.readStories === 'object' && !Array.isArray(raw.readStories)) {
    for (const [id, at] of Object.entries(raw.readStories).slice(0, MAX_IDS)) {
      if (ID_PATTERN.test(id)) readStories[id] = isoString(at, base.createdAt);
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
    guaranteed,
    readStories,
    claimedMail: idList(raw.claimedMail),
    hiddenNotices: idList(raw.hiddenNotices),
    seenContentVersion: int(raw.seenContentVersion, 0, 1_000_000, 0),
    stats: { pulls: int(raw.stats?.pulls, 0, Number.MAX_SAFE_INTEGER, 0) },
    tickets: int(raw.tickets, 0, MAX_GEMS, 0),
    teams: cleanTeams(raw.teams),
    stages: cleanStages(raw.stages),
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
 * localStorage에서 세이브를 불러옵니다. v2가 없고 v1이 있으면 옮겨 옵니다 (v1 키는 그대로 둠).
 * @param {{rarityOf:(id:string)=>string|undefined, balance:object}} env 옮길 때 정수→티켓 환산용
 * @returns {{save:object, isNew:boolean, corrupted:boolean, migrated:null|{tickets:number, essence:number}}}
 */
export function loadSave(env) {
  let text = null;
  let v1 = null;
  try {
    text = localStorage.getItem(SAVE_KEY);
    if (!text) v1 = localStorage.getItem(V1_KEY);
  } catch (e) {
    console.warn('[save] localStorage 접근 불가', e);
  }
  if (!text && v1) {
    try {
      const m = migrateV1(JSON.parse(v1), env);
      return { save: sanitize(m.raw), isNew: false, corrupted: false, migrated: { tickets: m.tickets, essence: m.essence } };
    } catch (e) {
      console.warn('[save] v1 세이브를 옮기지 못했어요', e);
    }
  }
  if (!text) return { save: createNewSave(), isNew: true, corrupted: false, migrated: null };

  try {
    return { save: sanitize(JSON.parse(text)), isNew: false, corrupted: false, migrated: null };
  } catch (e) {
    console.warn('[save] 세이브가 손상되어 새로 시작합니다', e);
    // 손상된 원본은 혹시 모르니 별도 키에 보관
    try {
      localStorage.setItem(`${SAVE_KEY}_corrupt`, text);
    } catch {}
    return { save: createNewSave(), isNew: true, corrupted: true, migrated: null };
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
 * 예전 코드(TG1:)는 v2로 옮겨서 불러옴
 * @param {string} code
 * @param {{rarityOf:(id:string)=>string|undefined, balance:object}} env
 * @returns {{ok:true, save:object} | {ok:false, error:string}}
 */
export function parseCode(code, env) {
  const cleaned = String(code || '').replace(/\s+/g, '');
  if (!cleaned) return { ok: false, error: '코드를 입력해 주세요.' };
  const isV1 = cleaned.startsWith(V1_CODE_PREFIX);
  if (!isV1 && !cleaned.startsWith(CODE_PREFIX)) return { ok: false, error: 'Tiny Gacha 세이브 코드가 아니에요.' };
  try {
    const raw = JSON.parse(base64ToUtf8(cleaned.slice(CODE_PREFIX.length)));
    if (!raw || typeof raw !== 'object' || raw.v !== (isV1 ? 1 : SAVE_VERSION) || typeof raw.owned !== 'object') {
      return { ok: false, error: '세이브 내용이 올바르지 않아요.' };
    }
    return { ok: true, save: sanitize(isV1 ? migrateV1(raw, env).raw : raw) };
  } catch {
    return { ok: false, error: '코드가 손상되었거나 잘렸어요.' };
  }
}
