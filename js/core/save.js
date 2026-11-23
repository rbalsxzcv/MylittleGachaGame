// 세이브 데이터: 불러오기 / 검증·정리(sanitize) / 저장 / 세이브 코드 내보내기·가져오기
// localStorage 키: tinygacha_save_v2 (이름은 고정). 안의 v = schemaVersion
// 예전 버전은 MIGRATIONS를 순서대로 적용해서 최신으로 옮김 (v1 키는 백업으로 그대로 둠)

import { ID_PATTERN } from './data.js';
import { overflowTickets, MAX_BREAKTHROUGH } from '../config.js';
import { remapSaveIds } from './aliases.js';
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
export const SAVE_VERSION = 3;
export const START_GEMS = 1000;
// 첫 시작 골드. 골드가 생기기 전 세이브에도 한 번 지급 (레벨업에 골드가 필요해졌으므로)
export const START_GOLD = 20000;
const CODE_PREFIX = 'TG2:'; // 세이브 코드 접두사 (v2·v3 공통, 버전은 안의 v로 구분)
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
    gold: START_GOLD,
    scrolls: 0, // 모집 증서 (1장 = 뽑기 1회)
    teams: defaultTeams(),
    stages: {}, // 스테이지 id → { clears, firstClaimed, bestRounds }
    settings: defaultSettings(),
  };
  for (const [name, def] of slices) save[name] = def.create();
  return save;
}

/** 연출/전투 설정 (가챠 연출 속도·스킵, 전투 속도·AUTO) */
export function defaultSettings() {
  return { fxSpeed: 1, fxSkip: false, battleSpeed: 1, battleAuto: false };
}

function cleanSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    fxSpeed: raw.fxSpeed === 2 ? 2 : 1,
    fxSkip: raw.fxSkip === true,
    battleSpeed: raw.battleSpeed === 2 ? 2 : 1,
    battleAuto: raw.battleAuto === true,
  };
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
 * v1 → v2: 중복 획득(count − 1)은 정수로, 최대 돌파(5)를 넘는 몫은 티켓으로
 * (희귀도 R/SR/SSR → 3/4/5★ 변환은 데이터 쪽에서 하므로 rarityOf는 이미 1–5를 돌려줌)
 * @param {object} raw v1 세이브 (JSON 그대로)
 * @param {{rarityOf:(id:string)=>number|undefined, balance:object}} env
 * @returns {{raw:object, tickets:number, essence:number}}
 */
export function migrateV1(raw, { rarityOf, balance }) {
  const out = { ...raw, v: 2, owned: {}, tickets: 0 };
  let tickets = 0;
  let essence = 0;
  const maxBt = balance?.essence?.maxBreakthrough ?? 5;
  if (raw?.owned && typeof raw.owned === 'object') {
    for (const [id, entry] of Object.entries(raw.owned)) {
      if (!entry || typeof entry !== 'object') continue;
      const count = int(entry.count, 1, 1_000_000, 1);
      const dupes = count - 1;
      const keep = Math.min(dupes, maxBt);
      // 데이터에 없는 캐릭터(rarityOf가 undefined)는 3★ 기준
      const rate = balance ? overflowTickets(rarityOf?.(id) ?? 3, balance) : 30;
      tickets += (dupes - keep) * rate;
      essence += keep;
      out.owned[id] = { level: 1, essence: keep, breakthrough: 0, count, firstAt: entry.firstAt };
    }
  }
  out.tickets = tickets;
  return { raw: out, tickets, essence };
}

/** v2 → v3: 연출/전투 설정(settings) 추가. 나머지 필드는 그대로 */
export function migrateV2(raw) {
  return { raw: { ...raw, v: 3, settings: cleanSettings(raw?.settings) } };
}

/**
 * 순서 있는 마이그레이션 목록. 새 버전은 끝에 하나씩 추가 (from → to, 한 칸씩)
 * run(raw, env) → { raw, ...보고용 값 }
 */
export const MIGRATIONS = [
  { from: 1, to: 2, run: migrateV1 },
  { from: 2, to: 3, run: migrateV2 },
];

/**
 * 옛 세이브(JSON)를 최신 버전으로. v가 없거나 이상하면 1로 봄. 최신보다 높으면 그대로
 * 먼저 콘텐츠 id 별칭(env.aliases = data/id_aliases.json)으로 예전 id를 새 id로 옮김 (버전과 상관없이 매번, 몇 번 해도 같음)
 * @param {{rarityOf?:Function, balance?:object, aliases?:object}} env
 * @returns {{raw:object, applied:number[], report:{tickets:number, essence:number}}}
 */
export function migrate(raw, env) {
  let cur = raw && typeof raw === 'object' ? remapSaveIds(raw, env?.aliases) : {};
  let v = Number.isInteger(cur.v) && cur.v >= 1 ? cur.v : 1;
  const applied = [];
  const report = { tickets: 0, essence: 0 };
  for (const m of MIGRATIONS) {
    if (m.from !== v) continue;
    const out = m.run(cur, env);
    cur = out.raw;
    report.tickets += out.tickets || 0;
    report.essence += out.essence || 0;
    applied.push(m.to);
    v = m.to;
  }
  return { raw: cur, applied, report };
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
        breakthrough: int(entry.breakthrough, 0, MAX_BREAKTHROUGH, 0),
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
    gold: raw.gold === undefined ? START_GOLD : int(raw.gold, 0, MAX_GEMS, 0),
    scrolls: int(raw.scrolls, 0, 99_999, 0),
    teams: cleanTeams(raw.teams),
    stages: cleanStages(raw.stages),
    settings: cleanSettings(raw.settings),
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
      const raw = JSON.parse(v1);
      const m = migrate({ ...raw, v: 1 }, env);
      return { save: sanitize(m.raw), isNew: false, corrupted: false, migrated: m.report };
    } catch (e) {
      console.warn('[save] v1 세이브를 옮기지 못했어요', e);
    }
  }
  if (!text) return { save: createNewSave(), isNew: true, corrupted: false, migrated: null };

  try {
    const m = migrate(JSON.parse(text), env);
    // 정수/티켓 환산이 있었을 때만 안내 (v2→v3처럼 필드만 추가한 경우는 조용히)
    const migrated = m.report.tickets || m.report.essence ? m.report : null;
    return { save: sanitize(m.raw), isNew: false, corrupted: false, migrated };
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
 * 예전 코드(TG1:, TG2:의 v2)는 MIGRATIONS로 옮겨서 불러옴
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
    const versionOk = isV1 ? raw?.v === 1 : Number.isInteger(raw?.v) && raw.v >= 2 && raw.v <= SAVE_VERSION;
    if (!raw || typeof raw !== 'object' || !versionOk || typeof raw.owned !== 'object') {
      return { ok: false, error: '세이브 내용이 올바르지 않아요.' };
    }
    return { ok: true, save: sanitize(migrate(raw, env).raw) };
  } catch {
    return { ok: false, error: '코드가 손상되었거나 잘렸어요.' };
  }
}
