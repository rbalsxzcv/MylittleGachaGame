// 캐릭터 프로필 (CHARACTER_PROFILE.md): 보여 주는 부분(facts · stories · lines · relations)의 정리 / 검사 / 해금 / 화면 데이터
// 작가용 말투 카드(voice)는 게임이 쓰지 않음 (배포 때 빠짐, 개발 도구 dev/tinydev/profile.py가 다룸)
// 순수 함수 (DOM/Date/Math.random 없음) — tests/profile.test.js

export const PROFILE_LIMITS = {
  fact: 40, // facts의 각 값
  factList: 5, // likes / dislikes 개수
  storyTitle: 30,
  storyText: 600,
  stories: 3,
  line: 40,
  idle: 5,
  relations: 6,
  relationLabel: 20,
  relationNote: 60,
  voiceText: 120, // voice의 각 문장
  voiceList: 5,
  samplesMin: 3,
  samplesMax: 5,
};

/** facts 항목 (순서 = 화면 순서). list = 칩 목록 */
export const FACT_FIELDS = [
  { key: 'age', label: '나이' },
  { key: 'height', label: '키' },
  { key: 'origin', label: '출신' },
  { key: 'affiliation', label: '소속' },
  { key: 'likes', label: '좋아하는 것', list: true },
  { key: 'dislikes', label: '싫어하는 것', list: true },
  { key: 'hobby', label: '취미' },
];

/** 상황별 대사 (idle만 목록) */
export const LINE_FIELDS = [
  { key: 'obtain', label: '처음 만났을 때' },
  { key: 'team', label: '편성' },
  { key: 'levelUp', label: '레벨 업' },
  { key: 'breakthrough', label: '돌파' },
  { key: 'battleStart', label: '전투 시작' },
  { key: 'ultimate', label: '궁극기' },
  { key: 'idle', label: '대기', list: true },
];

/** 이야기 번호별 기본 해금 돌파 단계 (unlock이 없을 때) */
export const DEFAULT_STORY_UNLOCK = [1, 3, 6];
const MAX_BT = 6;
const ID_RE = /^[a-z0-9_-]{1,64}$/i;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '');
const textList = (v, max, count) => (Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, count) : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** 빈 프로필 (모든 칸이 비어 있음) */
export function emptyProfile() {
  return { facts: {}, stories: [], lines: { idle: [] }, relations: [] };
}

function storyUnlock(raw, i) {
  const n = Number(raw?.unlock?.breakthrough);
  return Number.isInteger(n) && n >= 1 && n <= MAX_BT ? n : DEFAULT_STORY_UNLOCK[i] ?? MAX_BT;
}

/**
 * 게임용 프로필 정리: 길이를 자르고 빈 칸은 뺌. 어떤 값이 와도 예외 없이 빈 프로필 모양
 * @returns {{facts:object, stories:Array<{title,text,unlock:{breakthrough:number}}>, lines:object, relations:Array<{id,label,note}>}}
 */
export function cleanProfile(raw) {
  const out = emptyProfile();
  if (!isObj(raw)) return out;
  const L = PROFILE_LIMITS;
  if (isObj(raw.facts)) {
    for (const f of FACT_FIELDS) {
      const v = f.list ? textList(raw.facts[f.key], L.fact, L.factList) : text(raw.facts[f.key], L.fact);
      if (f.list ? v.length : v) out.facts[f.key] = v;
    }
  }
  if (Array.isArray(raw.stories)) {
    raw.stories.slice(0, L.stories).forEach((s, i) => {
      if (!isObj(s)) return;
      const body = text(s.text, L.storyText);
      if (!body) return;
      out.stories.push({ title: text(s.title, L.storyTitle) || `이야기 ${i + 1}`, text: body, unlock: { breakthrough: storyUnlock(s, i) } });
    });
  }
  if (isObj(raw.lines)) {
    for (const f of LINE_FIELDS) {
      if (f.list) out.lines[f.key] = textList(raw.lines[f.key], L.line, L.idle);
      else {
        const v = text(raw.lines[f.key], L.line);
        if (v) out.lines[f.key] = v;
      }
    }
  }
  if (Array.isArray(raw.relations)) {
    const seen = new Set();
    for (const r of raw.relations) {
      if (out.relations.length >= L.relations) break;
      if (!isObj(r) || typeof r.id !== 'string' || !ID_RE.test(r.id) || seen.has(r.id)) continue;
      seen.add(r.id);
      out.relations.push({ id: r.id, label: text(r.label, L.relationLabel), note: text(r.note, L.relationNote) });
    }
  }
  return out;
}

/** 프로필에 보여 줄 것이 하나라도 있는지 */
export function hasProfile(p) {
  return !!p && (Object.keys(p.facts || {}).length > 0 || (p.stories || []).length > 0 || LINE_FIELDS.some((f) => (f.list ? p.lines?.[f.key]?.length : p.lines?.[f.key])) || (p.relations || []).length > 0);
}

/** 뽑기 컷인 대사: 최상위 quote → 비어 있으면 profile.lines.obtain */
export function quoteOf(raw) {
  return text(raw?.quote, 120) || text(raw?.profile?.lines?.obtain, 120);
}

// ── 검사 (배포 검사와 같은 규칙 — dev/tinydev/profile.py) ────────
function checkText(issues, where, v, max) {
  if (v === undefined || v === null || v === '') return;
  if (typeof v !== 'string') issues.push(`${where}: 문자열이어야 해요`);
  else if (v.length > max) issues.push(`${where}: ${v.length}자 (최대 ${max}자)`);
}
function checkList(issues, where, v, max, count) {
  if (v === undefined || v === null) return;
  if (!Array.isArray(v)) return issues.push(`${where}: 목록이어야 해요`);
  if (v.length > count) issues.push(`${where}: ${v.length}개 (최대 ${count}개)`);
  v.forEach((x, i) => checkText(issues, `${where}[${i}]`, x, max));
}

/**
 * 원본 프로필(정리 전)의 문제 목록 — 길이 · 형식 · relations id · unlock 1~6 · voice
 * @param {object} raw characters.json의 profile
 * @param {Set<string>|string[]} charIds 존재하는 캐릭터 id
 * @returns {string[]}
 */
export function profileIssues(raw, charIds) {
  const ids = charIds instanceof Set ? charIds : new Set(charIds || []);
  const issues = [];
  if (raw === undefined || raw === null) return issues;
  if (!isObj(raw)) return ['profile: 객체여야 해요'];
  const L = PROFILE_LIMITS;
  if (raw.facts !== undefined) {
    if (!isObj(raw.facts)) issues.push('facts: 객체여야 해요');
    else for (const f of FACT_FIELDS) (f.list ? checkList : checkText)(issues, `facts.${f.key}`, raw.facts[f.key], L.fact, L.factList);
  }
  if (raw.stories !== undefined) {
    if (!Array.isArray(raw.stories)) issues.push('stories: 목록이어야 해요');
    else {
      if (raw.stories.length > L.stories) issues.push(`stories: ${raw.stories.length}편 (최대 ${L.stories}편)`);
      raw.stories.forEach((s, i) => {
        if (!isObj(s)) return issues.push(`stories[${i}]: 객체여야 해요`);
        checkText(issues, `stories[${i}].title`, s.title, L.storyTitle);
        checkText(issues, `stories[${i}].text`, s.text, L.storyText);
        if (!text(s.text, L.storyText)) issues.push(`stories[${i}].text: 비어 있어요`);
        if (s.unlock !== undefined) {
          const n = s.unlock?.breakthrough;
          if (!Number.isInteger(n) || n < 1 || n > MAX_BT) issues.push(`stories[${i}].unlock.breakthrough: 1~6 정수여야 해요 (${n})`);
        }
      });
    }
  }
  if (raw.lines !== undefined) {
    if (!isObj(raw.lines)) issues.push('lines: 객체여야 해요');
    else for (const f of LINE_FIELDS) (f.list ? checkList : checkText)(issues, `lines.${f.key}`, raw.lines[f.key], L.line, L.idle);
  }
  if (raw.relations !== undefined) {
    if (!Array.isArray(raw.relations)) issues.push('relations: 목록이어야 해요');
    else {
      if (raw.relations.length > L.relations) issues.push(`relations: ${raw.relations.length}개 (최대 ${L.relations}개)`);
      raw.relations.forEach((r, i) => {
        if (!isObj(r)) return issues.push(`relations[${i}]: 객체여야 해요`);
        if (!ids.has(r.id)) issues.push(`relations[${i}].id: 없는 캐릭터 (${r.id})`);
        checkText(issues, `relations[${i}].label`, r.label, L.relationLabel);
        checkText(issues, `relations[${i}].note`, r.note, L.relationNote);
      });
    }
  }
  if (raw.voice !== undefined) {
    const v = raw.voice;
    if (!isObj(v)) issues.push('voice: 객체여야 해요');
    else {
      for (const k of ['personality', 'speech', 'weakness', 'desire']) checkText(issues, `voice.${k}`, v[k], L.voiceText);
      for (const k of ['habits', 'never']) checkList(issues, `voice.${k}`, v[k], L.voiceText, L.voiceList);
      checkList(issues, 'voice.samples', v.samples, L.voiceText, L.samplesMax);
      if (Array.isArray(v.samples) && v.samples.length && v.samples.length < L.samplesMin) issues.push(`voice.samples: ${v.samples.length}개 (${L.samplesMin}~${L.samplesMax}개)`);
      if (v.address !== undefined) {
        if (!isObj(v.address)) issues.push('voice.address: 객체여야 해요');
        else
          for (const [k, val] of Object.entries(v.address)) {
            if (k !== 'protagonist' && !ids.has(k)) issues.push(`voice.address: 없는 캐릭터 (${k})`);
            checkText(issues, `voice.address.${k}`, val, L.voiceText);
          }
      }
    }
  }
  return issues;
}

// ── 해금 ─────────────────────────────────────────────────
/** 돌파 단계 bt에서 열린 이야기 번호 */
export function unlockedStoryIdx(char, bt) {
  return (char?.profile?.stories || []).map((s, i) => (bt >= s.unlock.breakthrough ? i : -1)).filter((i) => i >= 0);
}

/** 돌파 before → after 사이에 새로 열린 이야기 번호 */
export function newStoriesAt(char, before, after) {
  return (char?.profile?.stories || []).map((s, i) => (s.unlock.breakthrough > before && s.unlock.breakthrough <= after ? i : -1)).filter((i) => i >= 0);
}

const seenOf = (save, id) => (Array.isArray(save?.profileSeen?.[id]) ? save.profileSeen[id] : []);

/** 열렸지만 아직 안 읽은 이야기 수 (보유한 캐릭터만) */
export function unseenStoryCount(save, char) {
  const e = save?.owned?.[char?.id];
  if (!e) return 0;
  const seen = seenOf(save, char.id);
  return unlockedStoryIdx(char, e.breakthrough).filter((i) => !seen.includes(i)).length;
}

/** 플레이어 캐릭터 중 안 읽은 열린 이야기가 있는지 (도감 빨간 점) */
export function hasUnseenStory(save, charMap) {
  for (const c of charMap.values()) if (unseenStoryCount(save, c) > 0) return true;
  return false;
}

/** 이야기를 읽음으로 표시. 바뀌었으면 true */
export function markStorySeen(save, id, idx) {
  if (!save.profileSeen || typeof save.profileSeen !== 'object') save.profileSeen = {};
  const list = seenOf(save, id);
  if (list.includes(idx)) return false;
  save.profileSeen[id] = [...list, idx].sort((a, b) => a - b);
  return true;
}

// ── 화면 데이터 ───────────────────────────────────────────
/**
 * 도감 · 육성 프로필 패널이 그릴 데이터
 * @param {object} char 게임 캐릭터 (validateCharacters 결과)
 * @param {{save:object, allCharMap:Map, charMap?:Map}} env
 */
export function profileView(char, { save, allCharMap, charMap }) {
  const p = char?.profile || emptyProfile();
  const entry = save?.owned?.[char?.id];
  const owned = !!entry;
  const bt = entry?.breakthrough ?? 0;
  const seen = seenOf(save, char?.id);

  const facts = owned
    ? FACT_FIELDS.filter((f) => (f.list ? p.facts[f.key]?.length : p.facts[f.key])).map((f) => ({ key: f.key, label: f.label, ...(f.list ? { chips: p.facts[f.key] } : { value: p.facts[f.key] }) }))
    : [];
  const stories = p.stories.map((s, i) => {
    const open = owned && bt >= s.unlock.breakthrough;
    return { index: i, title: s.title, text: open ? s.text : null, locked: !open, need: s.unlock.breakthrough, isNew: open && !seen.includes(i) };
  });
  const lines = owned
    ? LINE_FIELDS.flatMap((f) => (f.list ? (p.lines[f.key] || []).map((t, i) => ({ key: `${f.key}.${i}`, label: p.lines[f.key].length > 1 ? `${f.label} ${i + 1}` : f.label, text: t })) : p.lines[f.key] ? [{ key: f.key, label: f.label, text: p.lines[f.key] }] : []))
    : [];
  const relations = owned
    ? p.relations
        .map((r) => {
          const other = allCharMap?.get(r.id);
          if (!other) return null; // 지워진 캐릭터
          const isPlayer = charMap ? charMap.has(r.id) : other.rarity !== 'npc';
          if (!isPlayer && other.rarity !== 'npc') return null; // 공개 전 캐릭터
          // NPC는 보유 개념이 없으므로 바로 보임, 플레이어 캐릭터는 상대도 보유해야 보임
          const known = isPlayer ? !!save?.owned?.[r.id] : true;
          return { id: r.id, char: known ? other : null, label: known ? r.label || other.name : '???', note: known ? r.note : '', known };
        })
        .filter(Boolean)
    : [];
  return { owned, breakthrough: bt, facts, stories, lines, relations, hasAny: hasProfile(p) };
}

/** 대표 · 편성 대사: 상황 key의 대사 (idle은 n번째, 없으면 '') */
export function lineOf(char, key, n = 0) {
  const v = char?.profile?.lines?.[key];
  return Array.isArray(v) ? v[((n % (v.length || 1)) + (v.length || 1)) % (v.length || 1)] || '' : v || '';
}
