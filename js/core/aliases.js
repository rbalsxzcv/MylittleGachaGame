// id 별칭: 콘텐츠 id가 바뀌었을 때(data/id_aliases.json: 종류 → {예전 id: 새 id}) 플레이어 세이브를 새 id로 옮김
// - 세이브를 불러올 때마다 (예전 세이브 코드를 가져올 때도) 적용. 이미 새 id면 아무 일 없음 (몇 번 해도 같음)
// - 별칭이 이어져 있어도(a → b → c) 끝까지 따라감
// - 예전 id와 새 id 기록이 둘 다 있으면 합침 (보유: 더 성장한 쪽, 클리어/구매 횟수: 더함)
// 순수 함수 (DOM 없음) — tests/aliases.test.js

const MAX_HOPS = 16;

/** 종류별 id 변환 함수 */
export function resolverOf(aliases, kind) {
  const map = aliases?.[kind];
  if (!map || typeof map !== 'object') return (id) => id;
  return (id) => {
    let cur = id;
    for (let i = 0; i < MAX_HOPS && typeof cur === 'string' && Object.prototype.hasOwnProperty.call(map, cur); i++) cur = map[cur];
    return cur;
  };
}

/** 객체의 키 바꾸기 (같은 키로 모이면 merge(앞, 뒤)) */
function remapKeys(obj, fn, merge) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = fn(k);
    out[nk] = nk in out ? merge(out[nk], v) : v;
  }
  return out;
}

const uniqueList = (list, fn) => (Array.isArray(list) ? [...new Set(list.map((x) => (typeof x === 'string' ? fn(x) : x)))] : list);

const growthScore = (e) => (Number(e?.level) || 0) * 10 + (Number(e?.breakthrough) || 0);

/**
 * 세이브(JSON 그대로, 정리 전) → 새 id로 옮긴 사본
 * @param {object} raw
 * @param {object} aliases data/id_aliases.json
 * @returns {object}
 */
export function remapSaveIds(raw, aliases) {
  if (!raw || typeof raw !== 'object' || !aliases || typeof aliases !== 'object') return raw;
  const ch = resolverOf(aliases, 'characters');
  const st = resolverOf(aliases, 'stages');
  const sto = resolverOf(aliases, 'stories');
  const mail = resolverOf(aliases, 'mail');
  const notice = resolverOf(aliases, 'notices');
  const shop = resolverOf(aliases, 'shop');
  const out = { ...raw };

  out.owned = remapKeys(raw.owned, ch, (a, b) => {
    const keep = growthScore(b) > growthScore(a) ? b : a;
    const count = (Number(a?.count) || 1) + (Number(b?.count) || 1);
    const essence = Math.max(Number(a?.essence) || 0, Number(b?.essence) || 0);
    return { ...keep, count, essence };
  });
  out.knownIds = uniqueList(raw.knownIds, ch);
  out.newIds = uniqueList(raw.newIds, ch);
  if (typeof raw.featuredId === 'string') out.featuredId = ch(raw.featuredId);
  if (raw.teams && Array.isArray(raw.teams.presets)) {
    out.teams = {
      ...raw.teams,
      presets: raw.teams.presets.map((p) => {
        if (!p || !Array.isArray(p.slots)) return p;
        const seen = new Set();
        const slots = p.slots.map((id) => {
          if (typeof id !== 'string') return id;
          const n = ch(id);
          if (seen.has(n)) return null; // 같은 캐릭터가 두 칸 → 뒤 칸 비움
          seen.add(n);
          return n;
        });
        return { ...p, slots };
      }),
    };
  }
  out.stages = remapKeys(raw.stages, st, (a, b) => {
    const rounds = [a?.bestRounds, b?.bestRounds].filter(Number.isFinite);
    return {
      clears: (Number(a?.clears) || 0) + (Number(b?.clears) || 0),
      firstClaimed: !!(a?.firstClaimed || b?.firstClaimed),
      bestRounds: rounds.length ? Math.min(...rounds) : null,
    };
  });
  out.readStories = remapKeys(raw.readStories, sto, (a, b) => (String(a) < String(b) ? a : b));
  out.claimedMail = uniqueList(raw.claimedMail, mail);
  out.hiddenNotices = uniqueList(raw.hiddenNotices, notice);
  if (raw.shop && typeof raw.shop === 'object') {
    out.shop = {
      ...raw.shop,
      bought: remapKeys(raw.shop.bought, shop, (a, b) => (Number(a) || 0) + (Number(b) || 0)),
      period: remapKeys(raw.shop.period, shop, (a, b) => (a?.key === b?.key ? { key: a.key, n: (Number(a.n) || 0) + (Number(b.n) || 0) } : a)),
    };
  }
  return out;
}

/** data/id_aliases.json 정리: { 종류: { 예전: 새 } } 문자열만 */
export function validateAliases(json, idOk) {
  const out = {};
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('객체가 아님');
  for (const [kind, map] of Object.entries(json)) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    const clean = {};
    for (const [a, b] of Object.entries(map)) if (idOk(a) && idOk(b) && a !== b) clean[a] = b;
    out[kind] = clean;
  }
  return out;
}
