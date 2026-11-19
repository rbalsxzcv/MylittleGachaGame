// 데이터(JSON) 로더
// 각 파일은 독립적으로 불러오며, 한 파일이 깨져도 게임 전체가 멈추지 않습니다.

export const RARITIES = ['R', 'SR', 'SSR'];
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * JSON 파일 하나를 불러옵니다. 절대 예외를 던지지 않습니다.
 * @param {string} path 예: 'data/characters.json'
 * @param {*} fallback 실패 시 사용할 기본값
 * @param {(json:any)=>any} [validator] 검증/정리 함수 (문제 있으면 throw 가능)
 * @returns {Promise<{ok:boolean, data:any, error:string|null}>}
 */
export async function loadJson(path, fallback, validator) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    return { ok: false, data: fallback, error: String(e?.message || e) };
  }
}

/** 문자열 정리: 문자열이 아니면 기본값, 너무 길면 자름 */
function str(value, def = '', max = 2000) {
  return typeof value === 'string' ? value.slice(0, max) : def;
}

/**
 * characters.json 검증. 잘못된 항목만 건너뛰고 나머지는 유지합니다.
 * 필수: id, name, rarity(R|SR|SSR)
 */
export function validateCharacters(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.characters) ? json.characters : null;
  if (!list) throw new Error('캐릭터 목록이 배열이 아닙니다');

  const seen = new Set();
  const out = [];
  list.forEach((raw, index) => {
    const where = `characters[${index}]`;
    if (!raw || typeof raw !== 'object') return console.warn(`[data] ${where}: 객체가 아님 → 건너뜀`);
    const id = str(raw.id).trim();
    if (!ID_PATTERN.test(id)) return console.warn(`[data] ${where}: id가 올바르지 않음 → 건너뜀`, raw.id);
    if (seen.has(id)) return console.warn(`[data] ${where}: 중복 id '${id}' → 건너뜀`);
    const name = str(raw.name).trim();
    if (!name) return console.warn(`[data] ${where}: name 없음 → 건너뜀`);
    if (!RARITIES.includes(raw.rarity)) return console.warn(`[data] ${where}: rarity는 R/SR/SSR 중 하나여야 함 → 건너뜀`);

    seen.add(id);
    out.push({
      id,
      name,
      rarity: raw.rarity,
      title: str(raw.title).trim(),
      description: str(raw.description).trim(),
      image: str(raw.image).trim(),
      addedAt: str(raw.addedAt).trim(),
    });
  });
  return out;
}

/** 게임에 필요한 데이터를 모두 불러옵니다. (Phase 3에서 배너/스토리 등이 여기에 추가됩니다) */
export async function loadGameData() {
  const [chars] = await Promise.all([
    loadJson('data/characters.json', [], validateCharacters),
  ]);

  const characters = chars.data;
  return {
    characters,
    charMap: new Map(characters.map((c) => [c.id, c])),
    // 설정 화면에서 보여줄 파일별 상태
    status: [{ file: 'data/characters.json', ok: chars.ok, error: chars.error, count: characters.length }],
  };
}
