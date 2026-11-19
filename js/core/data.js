// 데이터(JSON) 로더와 검증기
// 각 파일은 독립적으로 불러오며, 한 파일이 깨져도 게임 전체가 멈추지 않습니다.
// 잘못된 항목은 건너뛰고(콘솔 경고) 나머지는 그대로 사용합니다.

export const RARITIES = ['R', 'SR', 'SSR'];
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const STORY_KINDS = ['main', 'character', 'event'];

/**
 * JSON 파일 하나를 불러옵니다. 절대 예외를 던지지 않습니다.
 * @param {string} path 예: 'data/characters.json'
 * @param {*} fallback 실패 시 사용할 기본값
 * @param {(json:any)=>any} [validator] 검증/정리 함수 (문제 있으면 throw 가능)
 * @returns {Promise<{ok:boolean, data:any, error:string|null, missing?:boolean}>}
 */
export async function loadJson(path, fallback, validator) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.missing = res.status === 404;
      throw err;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON 문법 오류: ${e.message}`);
    }
    const data = validator ? validator(json) : json;
    return { ok: true, data, error: null };
  } catch (e) {
    console.warn(`[data] ${path} 불러오기 실패 →`, e);
    return { ok: false, data: fallback, error: String(e?.message || e), missing: !!e?.missing };
  }
}

// ── 작은 정리 도우미 ──────────────────────────────────────
function str(value, def = '', max = 4000) {
  return typeof value === 'string' ? value.slice(0, max) : def;
}
function int(value, min, max, def) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}
/** 날짜 문자열이면 그대로, 아니면 null */
function dateOrNull(value) {
  return typeof value === 'string' && value && !Number.isNaN(Date.parse(value)) ? value : null;
}
function asList(json, key) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.[key]) ? json[key] : null;
  if (!list) throw new Error('목록(배열)이 아닙니다');
  return list;
}
function idOk(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/** 목록 공통 처리: 항목별 정리 함수가 null을 반환하거나 오류를 내면 그 항목만 건너뜀. id 중복도 건너뜀 */
function cleanList(list, label, fn) {
  const seen = new Set();
  const out = [];
  list.forEach((raw, index) => {
    const where = `${label}[${index}]`;
    try {
      if (!raw || typeof raw !== 'object') throw new Error('객체가 아님');
      if (!idOk(raw.id)) throw new Error(`id가 올바르지 않음 (${raw.id})`);
      if (seen.has(raw.id)) throw new Error(`중복 id '${raw.id}'`);
      const item = fn(raw);
      seen.add(raw.id);
      out.push(item);
    } catch (e) {
      console.warn(`[data] ${where}: ${e.message} → 건너뜀`);
    }
  });
  return out;
}

// ── characters.json ───────────────────────────────────────
// 필수: id, name, rarity(R|SR|SSR)
export function validateCharacters(json) {
  return cleanList(asList(json, 'characters'), 'characters', (raw) => {
    const name = str(raw.name).trim();
    if (!name) throw new Error('name 없음');
    if (!RARITIES.includes(raw.rarity)) throw new Error('rarity는 R/SR/SSR 중 하나여야 함');
    return {
      id: raw.id,
      name,
      rarity: raw.rarity,
      title: str(raw.title).trim(),
      description: str(raw.description).trim(),
      image: str(raw.image).trim(),
      addedAt: str(raw.addedAt).trim(),
    };
  });
}

// ── banners.json ──────────────────────────────────────────
export function validateBanners(json) {
  return cleanList(asList(json, 'banners'), 'banners', (raw) => {
    const type = raw.type === 'pickup' ? 'pickup' : 'standard';
    return {
      id: raw.id,
      title: str(raw.title, raw.id).trim() || raw.id,
      type,
      pickupIds: type === 'pickup' && Array.isArray(raw.pickupIds) ? raw.pickupIds.filter(idOk) : [],
      startAt: dateOrNull(raw.startAt),
      endAt: dateOrNull(raw.endAt),
      bannerImage: str(raw.bannerImage).trim(),
      description: str(raw.description).trim(),
      relatedStoryId: idOk(raw.relatedStoryId) ? raw.relatedStoryId : null,
    };
  });
}

// ── stories/index.json ────────────────────────────────────
/** 해금 조건 정리: 객체 하나 또는 배열 → 조건 배열 (모두 만족해야 해금) */
export function normalizeUnlock(unlock) {
  const list = Array.isArray(unlock) ? unlock : unlock && typeof unlock === 'object' ? [unlock] : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'prevChapter') out.push({ type: 'prevChapter' });
    else if (c.type === 'ownsCharacter' && idOk(c.characterId)) out.push({ type: 'ownsCharacter', characterId: c.characterId });
    else if (c.type === 'period') out.push({ type: 'period', startAt: dateOrNull(c.startAt), endAt: dateOrNull(c.endAt) });
  }
  return out;
}

export function validateStoryIndex(json) {
  return cleanList(asList(json, 'stories'), 'stories', (raw) => {
    if (!STORY_KINDS.includes(raw.kind)) throw new Error('kind는 main/character/event 중 하나여야 함');
    return {
      id: raw.id,
      kind: raw.kind,
      chapter: int(raw.chapter, 1, 9999, 1),
      title: str(raw.title, raw.id).trim() || raw.id,
      summary: str(raw.summary).trim(),
      characterId: idOk(raw.characterId) ? raw.characterId : null,
      unlock: normalizeUnlock(raw.unlock),
      reward: { gems: int(raw.reward?.gems, 0, 100000, 0) },
    };
  });
}

// ── stories/<id>.json ─────────────────────────────────────
function cleanBackground(bg) {
  if (bg && typeof bg === 'object' && bg.type === 'image' && typeof bg.value === 'string' && bg.value) {
    return { type: 'image', value: bg.value };
  }
  const color = bg && typeof bg === 'object' && typeof bg.value === 'string' ? bg.value : typeof bg === 'string' ? bg : '';
  return { type: 'color', value: /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#1b1440' };
}

export function validateStory(json, id) {
  const rawScenes = Array.isArray(json?.scenes) ? json.scenes : null;
  if (!rawScenes || rawScenes.length === 0) throw new Error('scenes가 비어 있음');
  const sceneIds = new Set();
  const scenes = rawScenes.map((s, i) => {
    let sid = idOk(s?.id) ? s.id : `s${i + 1}`;
    if (sceneIds.has(sid)) sid = `${sid}_${i + 1}`;
    sceneIds.add(sid);
    const lines = (Array.isArray(s?.lines) ? s.lines : [])
      .filter((l) => l && typeof l === 'object' && typeof l.text === 'string')
      .map((l) => ({
        speaker: typeof l.speaker === 'string' && l.speaker ? l.speaker : 'narrator',
        name: str(l.name).trim(),
        text: str(l.text),
        side: l.side === 'left' || l.side === 'right' ? l.side : null,
        choices: Array.isArray(l.choices)
          ? l.choices.filter((c) => c && typeof c.text === 'string').slice(0, 4).map((c) => ({ text: c.text, goto: typeof c.goto === 'string' ? c.goto : '' }))
          : [],
      }));
    return {
      id: sid,
      background: cleanBackground(s?.background),
      next: typeof s?.next === 'string' && s.next ? s.next : null,
      lines,
    };
  });
  if (!scenes.some((s) => s.lines.length)) throw new Error('대사가 하나도 없음');
  return { id, title: str(json.title).trim(), scenes };
}

// ── notices.json / mail.json / version.json ──────────────
export function validateNotices(json) {
  return cleanList(asList(json, 'notices'), 'notices', (raw) => ({
    id: raw.id,
    title: str(raw.title, raw.id).trim() || raw.id,
    body: str(raw.body),
    date: dateOrNull(raw.date),
    popup: raw.popup === true,
  }));
}

export function validateMail(json) {
  return cleanList(asList(json, 'mail'), 'mail', (raw) => ({
    id: raw.id,
    title: str(raw.title, raw.id).trim() || raw.id,
    body: str(raw.body),
    rewards: { gems: int(raw.rewards?.gems, 0, 1_000_000, 0) },
    startAt: dateOrNull(raw.startAt),
    endAt: dateOrNull(raw.endAt),
  }));
}

export function validateVersion(json) {
  if (!json || typeof json !== 'object') throw new Error('객체가 아님');
  const notes = Array.isArray(json.patchNotes) ? json.patchNotes : [];
  return {
    contentVersion: int(json.contentVersion, 0, 1_000_000, 0),
    patchNotes: notes
      .filter((n) => n && typeof n === 'object')
      .map((n) => ({
        version: int(n.version, 0, 1_000_000, 0),
        date: dateOrNull(n.date),
        notes: Array.isArray(n.notes) ? n.notes.filter((x) => typeof x === 'string') : [],
      }))
      .sort((a, b) => b.version - a.version),
  };
}

// ── 전체 불러오기 ─────────────────────────────────────────
/** 게임 시작 시 필요한 데이터를 모두 불러옵니다. (스토리 본문은 열 때 따로 불러옴) */
export async function loadGameData() {
  const files = [
    ['characters', 'data/characters.json', [], validateCharacters],
    ['banners', 'data/banners.json', [], validateBanners],
    ['storyIndex', 'data/stories/index.json', [], validateStoryIndex],
    ['notices', 'data/notices.json', [], validateNotices],
    ['mail', 'data/mail.json', [], validateMail],
    ['version', 'data/version.json', { contentVersion: 0, patchNotes: [] }, validateVersion],
  ];
  const results = await Promise.all(files.map(([, path, fallback, validator]) => loadJson(path, fallback, validator)));

  const data = { status: [] };
  files.forEach(([key, path], i) => {
    const r = results[i];
    data[key] = r.data;
    data.status.push({ file: path, ok: r.ok, error: r.error, count: Array.isArray(r.data) ? r.data.length : null });
  });
  return data;
}

// 스토리 본문 캐시
const storyCache = new Map();

/** 스토리 본문 불러오기 → {ok, data, error} */
export async function loadStory(id) {
  if (!idOk(id)) return { ok: false, data: null, error: '잘못된 스토리 id' };
  if (storyCache.has(id)) return storyCache.get(id);
  const r = await loadJson(`data/stories/${id}.json`, null, (json) => validateStory(json, id));
  if (r.ok) storyCache.set(id, r);
  return r;
}
