// 추억 (무기 대신) — 세이브 조작 + 전투/전투력에 넘길 값. 순수 함수 (숫자는 balance.memory)
//
// 세이브: memories [{u, id, lv, r}] (같은 추억도 여러 장 가능), equips[캐릭터].m = u, memGranted (기본 추억 받은 캐릭터), memMat
// - 역할 기본 추억: 캐릭터를 처음 가지면 그 역할의 기본 추억(kind: default) 1장 지급 + 장착 (한 번만)
// - 추억 뽑기 중복: 같은 id에 R5 미만 카드가 있으면 재련 +1 (레벨이 가장 높은 카드), 모두 R5면 추억 재료
// - 레벨업: 티켓 ceil(costBase × lv^costExp) + 골드(× goldPerTicket). 추억 재료가 있으면 1개 = materialTickets 티켓으로 먼저 씀
// - 재련 R1–R5: 패시브의 숫자 × refineScale[R−1] (기본 공격력 · 부옵션은 레벨만 따름)
// - 전용 추억의 owner 패시브는 장착자가 signatureOf일 때만
import { normalizeRarity } from '../config.js';

const MAX_REFINE = 5;
/** 재련으로 키우는 숫자 칸 (지속 턴 · 타수 · 횟수는 그대로) */
const SCALE_KEYS = new Set(['mult', 'pct', 'n', 'delta', 'perStack', 'vsMarked']);
const INT_KEYS = new Set(['pct', 'n', 'delta', 'vsMarked']);

/** 숫자 칸 × s (정수 칸은 반올림, 0에서 멀어지는 쪽으로 최소 1 유지) */
function scaleValue(key, v, s) {
  if (typeof v !== 'number' || !SCALE_KEYS.has(key)) return v;
  const x = v * s;
  if (INT_KEYS.has(key)) return v === 0 ? 0 : Math.sign(v) * Math.max(1, Math.round(Math.abs(x)));
  return Math.round(x * 1000) / 1000;
}
function scaleDeep(obj, s) {
  if (Array.isArray(obj)) return obj.map((x) => scaleDeep(x, s));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'object' && v !== null ? scaleDeep(v, s) : scaleValue(k, v, s);
  return out;
}

/** 재련 단계만큼 키운 패시브 (R1 = 그대로) */
export function scalePassive(p, refine, balance) {
  const s = balance.memory.refineScale[Math.max(1, Math.min(MAX_REFINE, refine || 1)) - 1] ?? 1;
  if (!p || s === 1) return p;
  return { ...scaleDeep(p, s), name: p.name, description: p.description };
}

/** 장착한 캐릭터에게 켜지는 추억 패시브 (일반 + 주인이면 주인 보너스) */
export function memoryPassives(mem, inst, charId, balance) {
  if (!mem) return [];
  const out = [];
  if (mem.passive?.generic) out.push(scalePassive(mem.passive.generic, inst?.r, balance));
  if (mem.passive?.owner && mem.signatureOf === charId) out.push(scalePassive(mem.passive.owner, inst?.r, balance));
  return out;
}

// ── 세이브 조작 ──────────────────────────────────────────
export const findMemory = (save, u) => save.memories.find((m) => m.u === u) || null;
/** 이 추억 카드를 장착한 캐릭터 id (없으면 null) */
export const holderOf = (save, u) => Object.entries(save.equips || {}).find(([, e]) => e?.m === u)?.[0] || null;

/** 새 카드 1장 → 인스턴스 */
export function grantMemory(save, memId, { lv = 1, r = 1 } = {}) {
  save.memSeq = (save.memSeq || 0) + 1;
  const inst = { u: `m${save.memSeq}`, id: memId, lv, r };
  save.memories.push(inst);
  return inst;
}

/**
 * 추억 뽑기 결과 반영
 * @returns {{isNew:boolean, refine:number|null, material:number, u:string|null}}
 */
export function addMemory(save, mem, balance) {
  const same = save.memories.filter((m) => m.id === mem.id);
  if (!same.length) {
    const inst = grantMemory(save, mem.id);
    return { isNew: true, refine: null, material: 0, u: inst.u };
  }
  const target = same.filter((m) => m.r < MAX_REFINE).sort((a, b) => b.lv - a.lv || a.u.localeCompare(b.u, 'en', { numeric: true }))[0];
  if (target) {
    target.r += 1;
    return { isNew: false, refine: target.r, material: 0, u: target.u };
  }
  const mat = balance.memory.overflowMaterial[normalizeRarity(mem.rarity) || 3] ?? 0;
  save.memMat = (save.memMat || 0) + mat;
  return { isNew: false, refine: null, material: mat, u: null };
}

/** 캐릭터의 장착 정보 (없으면 만듦) */
export function equipOf(save, charId) {
  save.equips ||= {};
  save.equips[charId] ||= { m: null, g: { hp: null, def: null, crit: null, atk: null } };
  return save.equips[charId];
}

/** 추억 장착 (다른 캐릭터가 끼고 있었으면 빼서 옮김). u = null이면 해제 */
export function equipMemory(save, charId, u) {
  if (u && !findMemory(save, u)) return false;
  if (u) {
    const other = holderOf(save, u);
    if (other && other !== charId) save.equips[other].m = null;
  }
  equipOf(save, charId).m = u || null;
  return true;
}

/**
 * 역할 기본 추억 지급: 가진 캐릭터 중 아직 못 받은 캐릭터마다 그 역할의 기본 추억 1장 + (추억이 없으면) 장착
 * 불러올 때마다 / 캐릭터를 얻을 때 부름 (몇 번 해도 같음)
 * @returns {number} 지급한 장수
 */
export function ensureDefaultMemories(save, characters, memories) {
  const byRole = new Map(memories.filter((m) => m.kind === 'default' && m.role && !m.retired).map((m) => [m.role, m]));
  if (!byRole.size) return 0;
  const granted = new Set(save.memGranted || []);
  let n = 0;
  for (const c of characters) {
    if (!save.owned[c.id] || granted.has(c.id)) continue;
    const mem = byRole.get(c.role || 'attacker');
    if (!mem) continue;
    const inst = grantMemory(save, mem.id);
    if (!equipOf(save, c.id).m) equipMemory(save, c.id, inst.u);
    granted.add(c.id);
    n += 1;
  }
  save.memGranted = [...granted];
  return n;
}

// ── 레벨업 ──────────────────────────────────────────────
/** lv → lv+1 티켓 비용 */
export const memoryLevelCost = (lv, balance) => Math.ceil(balance.memory.cost.costBase * Math.max(1, lv) ** balance.memory.cost.costExp);

/** lv에서 n번 올리는 비용 → { tickets, gold, material } (추억 재료를 먼저 씀) */
export function memoryCostFor(lv, n, save, balance) {
  let need = 0;
  for (let i = 0; i < n; i++) need += memoryLevelCost(lv + i, balance);
  const per = balance.memory.materialTickets || 1;
  const material = Math.min(save?.memMat || 0, Math.ceil(need / per));
  const tickets = Math.max(0, need - material * per);
  return { tickets, gold: Math.ceil(need * balance.memory.cost.goldPerTicket), material };
}

/** 추억 레벨업 (최대 레벨까지). 모자라면 false */
export function levelUpMemory(save, u, n, balance) {
  const inst = findMemory(save, u);
  if (!inst || n < 1) return false;
  n = Math.min(n, balance.memory.maxLevel - inst.lv);
  if (n < 1) return false;
  const cost = memoryCostFor(inst.lv, n, save, balance);
  if (save.tickets < cost.tickets || (save.gold || 0) < cost.gold) return false;
  save.tickets -= cost.tickets;
  save.gold -= cost.gold;
  save.memMat -= cost.material;
  inst.lv += n;
  return true;
}

// ── 전투 / 전투력에 넘길 값 ──────────────────────────────
/**
 * 캐릭터 한 명의 추억 장착 정보 → statsOf / buildUnit의 extras
 * @returns {{memory?:{entity:object, level:number, refine:number}, passives?:Array}}
 */
export function memoryExtras(save, data, charId) {
  const u = save?.equips?.[charId]?.m;
  const inst = u ? findMemory(save, u) : null;
  const mem = inst ? data.memoryMap?.get(inst.id) : null;
  if (!mem) return {};
  return { memory: { entity: mem, level: inst.lv, refine: inst.r }, passives: memoryPassives(mem, inst, charId, data.balance) };
}
