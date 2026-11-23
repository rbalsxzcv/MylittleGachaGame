// 장비 (티어제) — 순수 함수, 숫자는 balance.gear / balance.stars
//
// 4칸 고정 주옵션: hp(체력) · def(방어) · crit(치명 = 확률 + 피해) · atk(공격). 티어 T1…Tn, 강화 +0…+maxEnh
// 같은 칸 + 티어 + 강화 = 같은 수치 (stats.gearPieceStats) → 세이브는 개수로 쌓음: gear['atk.3.2'] = { n, lock }
// 장착하면 개수에서 하나 빠지고 equips[캐릭터].g.atk = '3.2' (빼면 다시 개수로)
// 드롭: 지역 = 챕터. 지역 티어 = 챕터 순서 + 1 (balance.gear.regionTier로 덮어쓰기), [지역 티어 − 1, 지역 티어] 비율 rates.normal / 챕터 마지막(보스) rates.boss
import { GEAR_SLOTS } from '../config.js';
import { equipOf } from './memories.js';

export const pieceKey = (slot, tier, enh = 0) => `${slot}.${tier}.${enh}`;
export function parseKey(key) {
  const [slot, tier, enh] = String(key).split('.');
  return { slot, tier: Number(tier), enh: Number(enh) };
}
/** 장착 칸 값 '3.2' → {tier, enh} */
export const parsePiece = (v) => (v ? { tier: Number(v.split('.')[0]), enh: Number(v.split('.')[1]) } : null);

// ── 가방 ────────────────────────────────────────────────
export function addGear(save, slot, tier, enh = 0, n = 1) {
  if (!GEAR_SLOTS.includes(slot) || tier < 1 || n < 1) return;
  const k = pieceKey(slot, tier, enh);
  save.gear[k] ||= { n: 0, lock: false };
  save.gear[k].n += n;
}

function takeGear(save, slot, tier, enh) {
  const k = pieceKey(slot, tier, enh);
  const s = save.gear[k];
  if (!s || s.n < 1) return false;
  s.n -= 1;
  if (s.n === 0 && !s.lock) delete save.gear[k];
  return true;
}

/** 가방 목록 [{key, slot, tier, enh, n, lock}] (티어 → 강화 높은 순) */
export function bagList(save) {
  return Object.entries(save.gear || {})
    .map(([key, v]) => ({ key, ...parseKey(key), n: v.n, lock: !!v.lock }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.tier - a.tier || b.enh - a.enh || GEAR_SLOTS.indexOf(a.slot) - GEAR_SLOTS.indexOf(b.slot));
}

export function toggleLock(save, key) {
  if (!save.gear[key]) return false;
  save.gear[key].lock = !save.gear[key].lock;
  return save.gear[key].lock;
}

// ── 장착 ────────────────────────────────────────────────
/** 가방의 조각 하나를 캐릭터 칸에 (끼고 있던 건 가방으로) */
export function equipGear(save, charId, slot, tier, enh) {
  if (!takeGear(save, slot, tier, enh)) return false;
  const eq = equipOf(save, charId);
  const old = parsePiece(eq.g[slot]);
  if (old) addGear(save, slot, old.tier, old.enh);
  eq.g[slot] = `${tier}.${enh}`;
  return true;
}

export function unequipGear(save, charId, slot) {
  const eq = equipOf(save, charId);
  const old = parsePiece(eq.g[slot]);
  if (!old) return false;
  addGear(save, slot, old.tier, old.enh);
  eq.g[slot] = null;
  return true;
}

/** 자동 장착: 칸마다 가방 + 지금 장착 중에서 가장 좋은 것 (티어 → 강화). 바뀐 칸 수 */
export function autoEquip(save, charId) {
  let changed = 0;
  const eq = equipOf(save, charId);
  for (const slot of GEAR_SLOTS) {
    const cur = parsePiece(eq.g[slot]);
    const best = bagList(save).find((x) => x.slot === slot);
    if (best && (!cur || best.tier > cur.tier || (best.tier === cur.tier && best.enh > cur.enh))) {
      equipGear(save, charId, slot, best.tier, best.enh);
      changed += 1;
    }
  }
  return changed;
}

/** 캐릭터 장비 → statsOf extras {gear: {칸: {tier, enh}}} */
export function gearExtras(save, charId) {
  const g = save?.equips?.[charId]?.g;
  if (!g) return {};
  const gear = {};
  for (const slot of GEAR_SLOTS) if (g[slot]) gear[slot] = parsePiece(g[slot]);
  return Object.keys(gear).length ? { gear } : {};
}

// ── 강화 / 분해 ─────────────────────────────────────────
/** 강화 +enh → +enh+1 강화석 */
export const enhanceCost = (tier, enh, balance) => {
  const c = balance.gear.enhCost;
  return Math.ceil(c.base * tier ** c.tierExp * (enh + 1) ** c.enhExp);
};
/** +0에서 +enh까지 쓴 강화석 */
const spentOn = (tier, enh, balance) => Array.from({ length: enh }, (_, i) => enhanceCost(tier, i, balance)).reduce((a, b) => a + b, 0);
/** 분해하면 받는 강화석 */
export const salvageValue = (tier, enh, balance) => {
  const s = balance.gear.salvage;
  return Math.floor(s.base * tier ** s.tierExp) + Math.floor(spentOn(tier, enh, balance) * s.enhRefund);
};

/** 장착한 조각 강화 (강화석이 모자라거나 최대면 false) */
export function enhanceEquipped(save, charId, slot, balance) {
  const eq = equipOf(save, charId);
  const cur = parsePiece(eq.g[slot]);
  if (!cur || cur.enh >= balance.gear.maxEnh) return false;
  const cost = enhanceCost(cur.tier, cur.enh, balance);
  if ((save.gearMat || 0) < cost) return false;
  save.gearMat -= cost;
  eq.g[slot] = `${cur.tier}.${cur.enh + 1}`;
  return true;
}

/** 가방 조각 n개 분해 (잠금은 안 됨) → 받은 강화석 */
export function salvage(save, key, n, balance) {
  const s = save.gear[key];
  if (!s || s.lock || n < 1) return 0;
  const k = Math.min(n, s.n);
  const { tier, enh } = parseKey(key);
  const mat = salvageValue(tier, enh, balance) * k;
  s.n -= k;
  if (s.n === 0) delete save.gear[key];
  save.gearMat = (save.gearMat || 0) + mat;
  return mat;
}

/** 일괄 분해: maxTier 이하 (잠금 제외) → { pieces, mat } */
export function bulkSalvage(save, maxTier, balance) {
  let pieces = 0;
  let mat = 0;
  for (const x of bagList(save)) {
    if (x.tier > maxTier || x.lock) continue;
    pieces += x.n;
    mat += salvage(save, x.key, x.n, balance);
  }
  return { pieces, mat };
}

// ── 드롭 ────────────────────────────────────────────────
/** 챕터의 지역 티어 (설정 덮어쓰기 → 챕터 순서 + 1), 최대 tiers */
export function regionTier(chapterId, chapterIndex, balance) {
  return Math.min(balance.gear.tiers, balance.gear.regionTier?.[chapterId] ?? chapterIndex + 1);
}

/** 스테이지가 속한 챕터 {id, index, last} (data.chapters) */
export function chapterOf(stageId, chapters) {
  for (let i = 0; i < (chapters || []).length; i++) {
    const ids = chapters[i].stageIds || [];
    const at = ids.indexOf(stageId);
    if (at >= 0) return { id: chapters[i].id, index: i, last: at === ids.length - 1, position: at };
  }
  return { id: null, index: 0, last: false, position: 0 };
}

/**
 * 드롭 표 (화면 미리보기 + 굴리기): 스테이지에 drops가 있으면 그걸로
 * @returns {{count:number, tiers:Array<{tier:number, p:number}>, mat:number, boss:boolean}}
 */
export function dropTable(stage, chapters, balance) {
  if (stage?.drops) return stage.drops;
  const ch = chapterOf(stage.id, chapters);
  const top = regionTier(ch.id, ch.index, balance);
  const boss = ch.last;
  const D = balance.gear.drop;
  const r = boss ? D.rates.boss : D.rates.normal;
  const tiers = top <= 1 ? [{ tier: 1, p: 1 }] : [{ tier: top - 1, p: r.prev }, { tier: top, p: r.cur }];
  return { count: boss ? D.count.boss : D.count.normal, tiers, mat: Math.round(D.matPerClear * top), boss };
}

/** 드롭 굴리기 → { pieces: [{slot, tier}], gearMat } */
export function rollDrops(table, rand) {
  const pieces = [];
  const total = table.tiers.reduce((a, t) => a + t.p, 0) || 1;
  for (let i = 0; i < table.count; i++) {
    let x = rand() * total;
    let tier = table.tiers[table.tiers.length - 1].tier;
    for (const t of table.tiers) {
      if (x < t.p) {
        tier = t.tier;
        break;
      }
      x -= t.p;
    }
    pieces.push({ slot: GEAR_SLOTS[Math.floor(rand() * GEAR_SLOTS.length) % GEAR_SLOTS.length], tier });
  }
  return { pieces, gearMat: table.mat };
}

export function grantDrops(save, drops) {
  for (const p of drops.pieces) addGear(save, p.slot, p.tier, 0, 1);
  save.gearMat = (save.gearMat || 0) + (drops.gearMat || 0);
}

// ── 별점 (소탕 조건) ────────────────────────────────────
/** ★1 승리 · ★2 쓰러진 아군 없음 · ★3 라운드 ≤ ceil(제한 × star3Ratio) */
export function starsOf(summary, stage, balance) {
  if (summary.result !== 'win') return 0;
  const noDeath = summary.units.every((u) => u.alive);
  const limit = stage.roundLimit || balance.combat.maxRounds;
  const fast = summary.rounds <= Math.ceil(limit * balance.stars.star3Ratio);
  return 1 + (noDeath ? 1 : 0) + (noDeath && fast ? 1 : 0);
}
