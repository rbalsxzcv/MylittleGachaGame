// 데이터(JSON) 로더와 검증기
// 각 파일은 독립적으로 불러오며, 한 파일이 깨져도 게임 전체가 멈추지 않습니다.
// 잘못된 항목은 건너뛰고(콘솔 경고) 나머지는 그대로 사용합니다.

import { cleanKit, cleanStats, cleanPassiveList, cleanPassive, cleanEnemyBehavior, cleanResource, cleanTweak, STAT_KEYS } from '../battle/schema.js';
import { loadConfig, normalizeRarity, normalizeGrade, isNpc, NPC, RARITIES, ROLES, ENEMY_ARCHETYPES, STAGE_TYPES } from '../config.js';
import { validateAliases } from './aliases.js';
import { cleanProfile, emptyProfile, quoteOf } from '../systems/profile.js';

export { RARITIES, normalizeRarity, normalizeGrade, isNpc, NPC };
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

const warnData = (msg) => console.warn(`[data] ${msg}`);

// ── characters.json ───────────────────────────────────────
export { ROLES };
const colorOrNull = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
/** 전투 카드 그림 크롭 { y: 위에서 내려 시작할 비율 0~0.5 } (얼굴이 잘릴 때, BATTLE_UI.md 2장) — 없으면 null */
const cardCropOrNull = (v) => (v && typeof v === 'object' && Number.isFinite(v.y) ? { y: Math.max(0, Math.min(0.5, v.y)) } : null);

// 필수: id, name, rarity(등급: 1–5 또는 'npc'. 예전 'R'/'SR'/'SSR'은 3/4/5, 예전 pullable: false는 'npc'로 읽음)
// NPC 등급 = 뽑기/도감/육성/편성에 안 나옴 (스토리 화자, 적 연결용). pullable은 등급에서 계산 (NPC가 아니면 true)
// 표시(선택): nameEn, role, cutout, themeColor, quote — 가챠 컷인/전투 초상에 씀
// 프로필(선택): profile {facts, stories, lines, relations, voice} — 도감/육성 프로필 패널 (systems/profile.js, voice는 게임이 안 씀)
// 전투(선택): role → 역할 템플릿 능력치 (stats 절대값이 있으면 그게 우선), statTweak {능력치: %} 손조정,
//   archetype + kitGen {archetype, variants, seed, version} (개발 도구 생성기 기록), resource {name, cap, start} (자원/스택),
//   kit {basic, skill, ultimate, transformed?}, talents [상시 패시브], bt2 / bt6 (돌파 2·6 능력, 1·3·4·5는 balance 공식),
//   breakthroughs[] (예전 방식 — 돌파 N단계에서 N번째가 켜짐)
// retired: true = 은퇴 (뽑기에서 빠지지만 보유/도감은 유지. id는 절대 지우지 않음)
export function validateCharacters(json, vocab) {
  return cleanList(asList(json, 'characters'), 'characters', (raw) => {
    const name = str(raw.name).trim();
    if (!name) throw new Error('name 없음');
    // 예전 데이터: pullable: false(스토리 전용 인물) = NPC 등급
    const rarity = raw.pullable === false ? NPC : normalizeGrade(raw.rarity);
    if (!rarity) throw new Error("rarity는 1~5 또는 'npc'여야 함");
    const where = `characters/${raw.id}`;
    return {
      id: raw.id,
      name,
      nameEn: str(raw.nameEn, '', 40).trim(),
      rarity,
      role: ROLES.includes(raw.role) ? raw.role : 'attacker',
      title: str(raw.title).trim(),
      description: str(raw.description).trim(),
      image: str(raw.image).trim(),
      cutout: str(raw.cutout).trim(),
      themeColor: colorOrNull(raw.themeColor),
      cardCrop: cardCropOrNull(raw.cardCrop),
      quote: quoteOf(raw), // 비어 있으면 profile.lines.obtain
      addedAt: str(raw.addedAt).trim(),
      pullable: rarity !== NPC, // NPC 등급이면 false (뽑기/도감/육성/편성에 안 나옴)
      retired: raw.retired === true,
      stats: cleanStats(raw.stats),
      statTweak: cleanTweak(raw.statTweak),
      archetype: typeof raw.archetype === 'string' ? raw.archetype.slice(0, 32) : '',
      kitGen: raw.kitGen && typeof raw.kitGen === 'object' ? raw.kitGen : null,
      resource: cleanResource(raw.resource),
      kit: vocab ? cleanKit(raw.kit, vocab, warnData, `${where}.kit`) : null,
      talents: vocab ? cleanPassiveList(raw.talents, vocab, warnData, `${where}.talents`, 4) : [],
      bt2: vocab && raw.bt2 ? cleanPassive(raw.bt2, vocab, warnData, `${where}.bt2`) : null,
      bt6: vocab && raw.bt6 ? cleanPassive(raw.bt6, vocab, warnData, `${where}.bt6`) : null,
      breakthroughs: vocab ? cleanPassiveList(raw.breakthroughs, vocab, warnData, `${where}.breakthroughs`, 6) : [],
      // 프로필 (보여 주는 부분만 — voice는 작가용). NPC는 facts/stories/lines를 쓰지 않음
      profile: rarity === NPC ? emptyProfile() : cleanProfile(raw.profile),
    };
  });
}

// ── enemies.json ──────────────────────────────────────────
// { id, name, image, boss, charId?, stats, actions{}, pattern[], phases[], enrage, passives[] } — 패시브는 항상 켜짐
// charId: 이 적이 어떤 NPC 캐릭터인지 (선택). 적 그림이 없으면 그 캐릭터 그림을 씀 (linkEnemyNpcs)
// 예전 { kit } 형식도 읽음 (actions + 기본 패턴으로 바뀜). 자세한 형식은 battle/schema.js cleanEnemyBehavior
export function validateEnemies(json, vocab) {
  return cleanList(asList(json, 'enemies'), 'enemies', (raw) => {
    const name = str(raw.name).trim();
    if (!name) throw new Error('name 없음');
    const where = `enemies/${raw.id}`;
    return {
      id: raw.id,
      name,
      image: str(raw.image).trim(),
      boss: raw.boss === true,
      charId: idOk(raw.charId) ? raw.charId : null,
      cardCrop: cardCropOrNull(raw.cardCrop),
      archetype: ENEMY_ARCHETYPES.includes(raw.archetype) ? raw.archetype : null,
      stats: cleanStats(raw.stats),
      resource: cleanResource(raw.resource),
      ...cleanEnemyBehavior(raw, vocab, warnData, where),
      passives: cleanPassiveList(raw.passives, vocab, warnData, `${where}.passives`, 8),
    };
  });
}

/**
 * 게임에서 쓰는 캐릭터 나누기 (순수 — main.js와 테스트가 같이 씀)
 * - characters / charMap: 플레이어 캐릭터 (NPC 아님 + 공개 시각이 지남) → 뽑기, 도감, 육성, 편성, 전투력, NEW, 대표
 * - npcs: NPC 등급 / allCharMap: 전부 (스토리 화자, 적 연결 — 공개 전 캐릭터도 이름은 보여야 하므로)
 * 등급을 NPC로 바꾸면 세이브의 보유 기록은 남지만 어디에서도 쓰이지 않고, 다시 1–5로 바꾸면 그대로 돌아옴
 * @param {Array} all validateCharacters 결과
 * @param {(c:object)=>boolean} [released] 공개됐는지 (기본: 모두)
 */
export function splitCharacters(all, released = () => true) {
  const characters = all.filter((c) => !isNpc(c) && released(c));
  return {
    characters,
    charMap: new Map(characters.map((c) => [c.id, c])),
    npcs: all.filter(isNpc),
    allCharMap: new Map(all.map((c) => [c.id, c])),
  };
}

/** 적 ↔ NPC 연결: 적 그림이 비어 있으면 연결된 캐릭터 그림을 씀 (원본은 바꾸지 않고 새 목록) */
export function linkEnemyNpcs(enemies, allCharMap) {
  return enemies.map((e) => {
    const c = e.charId ? allCharMap.get(e.charId) : null;
    return c && !e.image && c.image ? { ...e, image: c.image } : e;
  });
}

// ── memories.json (추억 카드) ──────────────────────────────
// { id, name, rarity 3–5, kind: default|generic|signature, role?(기본 추억), signatureOf?(전용 주인), featuredCharacterId?,
//   baseAtk?(없으면 balance.memory.atkBase), secondary {stat}, passive {generic, owner?}, image, thumb, addedAt, retired? }
// 역할 제한 없음 — 누구나 장착. owner 패시브는 장착자 = signatureOf일 때만
export const MEMORY_KINDS = ['default', 'generic', 'signature'];
export function validateMemories(json, vocab) {
  return cleanList(asList(json, 'memories'), 'memories', (raw) => {
    const name = str(raw.name).trim();
    if (!name) throw new Error('name 없음');
    const rarity = normalizeRarity(raw.rarity);
    if (!rarity || rarity < 3) throw new Error('추억 rarity는 3~5');
    const where = `memories/${raw.id}`;
    const stat = STAT_KEYS.includes(raw.secondary?.stat) ? raw.secondary.stat : 'atk';
    const p = raw.passive || {};
    return {
      id: raw.id,
      name,
      rarity,
      kind: MEMORY_KINDS.includes(raw.kind) ? raw.kind : 'generic',
      role: ROLES.includes(raw.role) ? raw.role : null,
      signatureOf: idOk(raw.signatureOf) ? raw.signatureOf : null,
      featuredCharacterId: idOk(raw.featuredCharacterId) ? raw.featuredCharacterId : null,
      baseAtk: Number.isFinite(Number(raw.baseAtk)) && raw.baseAtk !== '' && raw.baseAtk != null ? Math.max(0, Math.round(Number(raw.baseAtk))) : null,
      secondary: { stat },
      passive: {
        generic: vocab && p.generic ? cleanPassive(p.generic, vocab, warnData, `${where}.passive.generic`) : null,
        owner: vocab && p.owner ? cleanPassive(p.owner, vocab, warnData, `${where}.passive.owner`) : null,
      },
      image: str(raw.image).trim(),
      thumb: str(raw.thumb).trim(),
      addedAt: str(raw.addedAt).trim(),
      retired: raw.retired === true,
    };
  });
}

// ── stages.json ───────────────────────────────────────────
/** 보상 묶음 {tickets, gems, gold, scrolls} (스테이지 / 우편 / 상점이 같이 씀) */
export function cleanRewards(r, max = 1_000_000) {
  return {
    tickets: int(r?.tickets, 0, max, 0),
    gems: int(r?.gems, 0, max, 0),
    gold: int(r?.gold, 0, max * 100, 0),
    scrolls: int(r?.scrolls, 0, 10_000, 0),
  };
}

/**
 * 스테이지 목록 정리. 모험: 스테이지 1개 = 스토리 1개(storyId) = 전투 1개
 * @param {object|Array} json 챕터 파일 { chapter, title, stages[] } 또는 예전 stages.json 배열
 * @param {{chapter?:string, chapterTitle?:string}} [ch]
 */
export function validateStages(json, ch = {}) {
  const chapter = ch.chapter || (typeof json?.chapter === 'string' ? json.chapter : 'ch01');
  return cleanList(asList(json, 'stages'), `stages/${chapter}`, (raw) => {
    const waves = (Array.isArray(raw.waves) ? raw.waves : [])
      .map((w) =>
        (Array.isArray(w) ? w : [])
          .filter((e) => e && idOk(e.enemyId))
          .slice(0, 6)
          .map((e) => ({ enemyId: e.enemyId, level: e.level == null || e.level === '' ? null : int(e.level, 1, 100000, 1) })), // null = 추천 전투력으로 계산
      )
      .filter((w) => w.length);
    if (!waves.length) throw new Error('waves가 비어 있음');
    return {
      id: raw.id,
      name: str(raw.name, raw.id).trim() || raw.id,
      chapter,
      storyId: idOk(raw.storyId) ? raw.storyId : null,
      retired: raw.retired === true,
      recommendedPower: int(raw.recommendedPower, 0, 1e9, 0),
      waves,
      // 난이도 배율(적 공격/HP, 자동 튜너가 정함) · 종류(목표 승률: normal/elite/boss)
      difficulty: Number.isFinite(Number(raw.difficulty)) && raw.difficulty !== '' && raw.difficulty != null ? Math.min(20, Math.max(0.05, Number(raw.difficulty))) : 1,
      stageType: STAGE_TYPES.includes(raw.stageType) ? raw.stageType : 'normal',
      // 라운드 제한 (예전 이름 turnLimit도 받음)
      roundLimit: (raw.roundLimit ?? raw.turnLimit) == null || (raw.roundLimit ?? raw.turnLimit) === '' ? null : int(raw.roundLimit ?? raw.turnLimit, 1, 999, 20),
      rewards: cleanRewards(raw.rewards),
      firstClearRewards: cleanRewards(raw.firstClearRewards),
      // 전투 배경 (스테이지 전용, 없으면 스토리 배경 → 기본 배경 — adventure.battleBackgrounds)
      background: assetPathOrNull(raw.background),
    };
  });
}

// ── banners.json ──────────────────────────────────────────
export function validateBanners(json) {
  return cleanList(asList(json, 'banners'), 'banners', (raw) => {
    const type = raw.type === 'pickup' ? 'pickup' : 'standard';
    // 자동 로테이션 픽업: { rarity, count, days, anchor }
    const rot = type === 'pickup' && raw.rotation && typeof raw.rotation === 'object' ? raw.rotation : null;
    return {
      id: raw.id,
      title: str(raw.title, raw.id).trim() || raw.id,
      type,
      // character = 캐릭터 뽑기, memory = 추억 뽑기 (pickupIds는 추억 id, pickupFrom = 이 캐릭터 배너의 픽업 전용 추억을 따라감)
      category: raw.category === 'memory' ? 'memory' : 'character',
      pickupFrom: raw.category === 'memory' && idOk(raw.pickupFrom) ? raw.pickupFrom : null,
      rotation: rot
        ? {
            rarity: normalizeRarity(rot.rarity) || 5,
            count: int(rot.count, 1, 4, 2),
            days: int(rot.days, 1, 60, 7),
            anchor: dateOrNull(rot.anchor),
          }
        : null,
      pickupIds: type === 'pickup' && !rot && Array.isArray(raw.pickupIds) ? raw.pickupIds.filter(idOk) : [],
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
      arc: raw.arc == null ? null : int(raw.arc, 1, 999, 1), // 챕터 번호 (메인 스토리 12장 묶음)
      arcTitle: str(raw.arcTitle, '', 60).trim(),
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
    // color: 그림이 아직 없거나 못 불러올 때 깔리는 색
    return { type: 'image', value: bg.value, color: typeof bg.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(bg.color) ? bg.color : '#000' };
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
    // 전투 장면: { type: "battle", stageId, next? } — 이겨야 다음으로 진행
    if (s?.type === 'battle') {
      return {
        id: sid,
        type: 'battle',
        stageId: idOk(s.stageId) ? s.stageId : null,
        background: cleanBackground(s.background),
        next: typeof s.next === 'string' && s.next ? s.next : null,
        lines: [],
      };
    }
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
      type: 'dialogue',
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
    rewards: cleanRewards(raw.rewards),
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

// ── shop.json (골드 상점 / 가상 캐시 상점) ───────────────
export const SHOP_LIMIT_PERS = ['day', 'week', 'month', 'once'];
export const SHOP_CATEGORIES = ['featured', 'package', 'growth', 'gems', 'pass'];
export const SHOP_TIERS = ['normal', 'rare', 'legend', 'truck'];
export const SHOP_ICONS = ['gem', 'ticket', 'gold', 'scroll', 'gift', 'chest', 'cart', 'crown', 'moon', 'sprout'];

/** 'assets/...' 그림 경로만 통과, 아니면 null (validateUi와 같은 규칙) */
function assetPathOrNull(p) {
  return typeof p === 'string' && p.startsWith('assets/') && !p.includes('..') ? p : null;
}

function cleanLimit(l) {
  if (!l || typeof l !== 'object' || !SHOP_LIMIT_PERS.includes(l.per)) return null;
  return { per: l.per, count: int(l.count, 1, 9999, 1) };
}
function shopCommon(raw) {
  const name = str(raw.name, '', 40).trim();
  if (!name) throw new Error('name 없음');
  return {
    id: raw.id,
    name,
    desc: str(raw.desc, '', 200).trim(),
    icon: SHOP_ICONS.includes(raw.icon) ? raw.icon : 'chest',
    image: assetPathOrNull(raw.image), // 상품 그림 (없으면 아이콘 종류별 기본 모양)
    rewards: cleanRewards(raw.rewards, 1e7),
    limit: cleanLimit(raw.limit),
    badges: (Array.isArray(raw.badges) ? raw.badges : []).filter((b) => typeof b === 'string' && b.trim()).slice(0, 3).map((b) => b.trim().slice(0, 12)),
    requires: raw.requires && typeof raw.requires === 'object' ? { stagesCleared: int(raw.requires.stagesCleared, 0, 9999, 0) } : null,
  };
}

export function validateShop(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('객체가 아님');
  const gold = cleanList(Array.isArray(json.gold) ? json.gold : [], 'shop.gold', (raw) => {
    const cost = raw.cost && typeof raw.cost === 'object' ? raw.cost : {};
    return {
      ...shopCommon(raw),
      cost: { gold: int(cost.gold, 0, 1e9, 0), gems: int(cost.gems, 0, 1e7, 0) },
    };
  });
  const cash = cleanList(Array.isArray(json.cash) ? json.cash : [], 'shop.cash', (raw) => {
    const priceKRW = int(raw.priceKRW, 100, 10_000_000, 0);
    if (!priceKRW) throw new Error('priceKRW 없음');
    const pass = raw.pass && typeof raw.pass === 'object'
      ? { days: int(raw.pass.days, 1, 365, 30), dailyGems: int(raw.pass.dailyGems, 1, 100000, 100), maxDays: int(raw.pass.maxDays, 1, 3650, 180) }
      : null;
    return {
      ...shopCommon(raw),
      category: SHOP_CATEGORIES.includes(raw.category) ? raw.category : 'package',
      tier: SHOP_TIERS.includes(raw.tier) ? raw.tier : 'normal',
      priceKRW,
      originalKRW: raw.originalKRW == null ? null : int(raw.originalKRW, 0, 100_000_000, null),
      value: str(raw.value, '', 10).trim(),
      firstBonus: raw.firstBonus ? cleanRewards(raw.firstBonus, 1e7) : null,
      pass,
    };
  });
  const vip = (Array.isArray(json.vip) ? json.vip : [])
    .map((v) => int(v, 1, 1e10, 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
    .slice(0, 20);
  return { gold, cash, vip };
}

// ── ui.json (화면 배경 / 아이콘 에셋) ─────────────────────
/** 키마다 'assets/...' 경로만 남김. 없는 칸은 CSS 기본 디자인 */
export function validateUi(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('객체가 아님');
  const clean = (group) => {
    const out = {};
    for (const [key, path] of Object.entries(json[group] || {})) {
      if (/^[a-z0-9_]{1,40}$/i.test(key) && typeof path === 'string' && path.startsWith('assets/') && !path.includes('..')) out[key] = path;
    }
    return out;
  };
  return { backgrounds: clean('backgrounds'), icons: clean('icons') };
}

// ── 전체 불러오기 ─────────────────────────────────────────
/** 게임 시작 시 필요한 데이터를 모두 불러옵니다. (스토리 본문은 열 때 따로 불러옴) */
export async function loadGameData() {
  // 전투 용어집(vocab)을 먼저 읽어야 캐릭터/적의 스킬을 정리할 수 있음
  const vocabResult = await loadJson('js/battle/vocab.json', null, (json) => {
    if (!json?.effects || !json?.targeting) throw new Error('vocab 형식이 잘못됨');
    return json;
  });
  const vocab = vocabResult.data;
  const files = [
    ['balance', 'data/balance.json', loadConfig({}, vocab), (j) => loadConfig(j, vocab, warnData)],
    ['characters', 'data/characters.json', [], (j) => validateCharacters(j, vocab)],
    ['enemies', 'data/enemies.json', [], (j) => validateEnemies(j, vocab)],
    ['memories', 'data/memories.json', [], (j) => validateMemories(j, vocab)],
    ['banners', 'data/banners.json', [], validateBanners],
    ['storyIndex', 'data/stories/index.json', [], validateStoryIndex],
    ['notices', 'data/notices.json', [], validateNotices],
    ['mail', 'data/mail.json', [], validateMail],
    ['version', 'data/version.json', { contentVersion: 0, patchNotes: [] }, validateVersion],
    ['ui', 'data/ui.json', { backgrounds: {}, icons: {} }, validateUi],
    ['shop', 'data/shop.json', { gold: [], cash: [], vip: [] }, validateShop],
    // 콘텐츠 id가 바뀌었을 때 예전 세이브를 옮기는 별칭 (없어도 됨)
    ['aliases', 'data/id_aliases.json', {}, (j) => validateAliases(j, idOk)],
  ];
  const results = await Promise.all(files.map(([, path, fallback, validator]) => loadJson(path, fallback, validator)));

  const data = { status: [{ file: 'js/battle/vocab.json', ok: vocabResult.ok, error: vocabResult.error, count: null }], vocab };
  // 스테이지: data/stages/index.json → 챕터 파일들 (없으면 예전 data/stages.json)
  const st = await loadStageChapters();
  data.stages = st.stages;
  data.chapters = st.chapters;
  data.status.push(...st.status);
  files.forEach(([key, path], i) => {
    const r = results[i];
    data[key] = r.data;
    const count = Array.isArray(r.data) ? r.data.length : key === 'shop' ? r.data.gold.length + r.data.cash.length : null;
    data.status.push({ file: path, ok: r.ok, error: r.error, count });
  });
  return data;
}

/**
 * 모험 챕터 불러오기: data/stages/index.json (챕터 id 목록) → data/stages/<id>.json
 * index가 없으면 예전 data/stages.json 하나를 'ch01'로 읽음
 * @returns {Promise<{stages:Array, chapters:Array<{id, title, stageIds}>, status:Array}>}
 */
export async function loadStageChapters() {
  const status = [];
  const idx = await loadJson('data/stages/index.json', null, (j) => {
    const list = Array.isArray(j) ? j : Array.isArray(j?.chapters) ? j.chapters : null;
    if (!list) throw new Error('챕터 목록(배열)이 아님');
    return list.map((x) => (typeof x === 'string' ? x : x?.id)).filter(idOk);
  });
  if (!idx.ok) {
    const legacy = await loadJson('data/stages.json', [], (j) => validateStages(j, { chapter: 'ch01' }));
    status.push({ file: 'data/stages.json', ok: legacy.ok, error: legacy.error, count: legacy.data.length });
    return { stages: legacy.data, chapters: [{ id: 'ch01', title: '챕터 1', stageIds: legacy.data.map((s) => s.id) }], status };
  }
  status.push({ file: 'data/stages/index.json', ok: true, error: null, count: idx.data.length });
  const files = await Promise.all(
    idx.data.map((id) =>
      loadJson(`data/stages/${id}.json`, null, (j) => ({ title: str(j?.title, id, 60).trim() || id, stages: validateStages(j, { chapter: id }) })),
    ),
  );
  const stages = [];
  const chapters = [];
  const seen = new Set();
  idx.data.forEach((id, i) => {
    const r = files[i];
    status.push({ file: `data/stages/${id}.json`, ok: r.ok, error: r.error, count: r.data?.stages.length ?? 0 });
    if (!r.ok || !r.data) return;
    const list = r.data.stages.filter((s) => (seen.has(s.id) ? (warnData(`stages/${id}: 다른 챕터와 겹치는 id '${s.id}' → 건너뜀`), false) : (seen.add(s.id), true)));
    stages.push(...list);
    chapters.push({ id, title: r.data.title, stageIds: list.map((s) => s.id) });
  });
  return { stages, chapters, status };
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
