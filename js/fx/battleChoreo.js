// 전투 연출 계획 (순수 — Phaser/DOM 없음, tests/battleUi.test.js)
// - groupBeats: 엔진 이벤트 묶음 → 장면 단위(행동 · 턴 시작 · 웨이브 …). 대상 · 광역 · 다단히트는 행동 뒤
//   damage/heal/shield/status 이벤트의 src로 계산 (엔진에 필드를 더하지 않음)
// - rowLayout: 적/아군 카드 줄 배치 (5~6명이면 0.85배, 보스는 크게, 영역 안에 맞춤)
// - floatOffset: 같은 카드에 겹치는 떠오르는 숫자 위치
// - diffQueue: 행동 순서 칩을 다시 그리지 않고 옮기기 위한 짝 맞추기
import { BT } from './battleTheme.js';
import { formatBig } from '../config.js';

/** 장면을 나누는 이벤트 (이 이벤트로 새 장면이 시작) */
const HEADS = new Set(['action', 'token_act', 'turn', 'wave', 'end']);

/**
 * @param {Array<object>} events engine 이벤트 (act/ultimate/auto가 돌려준 것)
 * @param {(uid:string)=>('ally'|'enemy'|null)} sideOf
 * @returns {Array<object>} beats: { kind:'action'|'turn'|'wave'|'end'|'misc', head, events, ...분석 }
 */
export function groupBeats(events, sideOf = () => null) {
  const beats = [];
  let cur = { kind: 'misc', head: null, events: [] };
  const push = () => {
    if (cur.head || cur.events.length) beats.push(cur.kind === 'action' ? analyzeAction(cur, sideOf) : cur);
  };
  for (const ev of events || []) {
    if (HEADS.has(ev.t)) {
      push();
      cur = { kind: ev.t === 'token_act' ? 'action' : ev.t, head: ev, events: [] };
    } else cur.events.push(ev);
  }
  push();
  return beats;
}

/** 행동 장면 분석: 누가, 무엇을, 누구에게, 몇 번 */
export function analyzeAction(beat, sideOf = () => null) {
  const head = beat.head;
  const token = head.t === 'token_act';
  const actor = token ? head.owner : head.uid;
  const side = head.side || sideOf(actor);
  const hits = beat.events.filter((e) => e.t === 'damage' && !e.dot && e.src === actor);
  const hitsByTarget = new Map();
  for (const e of hits) {
    if (!hitsByTarget.has(e.tgt)) hitsByTarget.set(e.tgt, []);
    hitsByTarget.get(e.tgt).push(e);
  }
  const targets = [...hitsByTarget.keys()];
  // 아군(자기 편) 대상: 회복 · 보호막 · 강화 · 정화 · 기력
  const supportTypes = new Set(['heal', 'shield', 'status', 'cleanse', 'energy', 'taunt']);
  const supportTargets = [];
  for (const e of beat.events) {
    if (!supportTypes.has(e.t) || e.src !== actor || !e.tgt) continue;
    if (e.t === 'status' && e.kind !== 'buff') continue;
    if (e.t === 'energy' && e.n < 0) continue; // 궁극기 기력 소모
    if (sideOf(e.tgt) && side && sideOf(e.tgt) !== side) continue;
    if (!supportTargets.includes(e.tgt)) supportTargets.push(e.tgt);
  }
  const total = hits.reduce((n, e) => n + (e.amount || 0), 0);
  return {
    ...beat,
    token,
    actor,
    side,
    action: token ? 'token' : head.action,
    name: head.name,
    reaction: !!head.reaction,
    hits,
    hitsByTarget,
    targets,
    aoe: targets.length > 1,
    multi: [...hitsByTarget.values()].some((l) => l.length > 1),
    crit: hits.some((e) => e.crit),
    supportTargets: targets.length ? [] : supportTargets,
    total,
  };
}

/**
 * 카드 줄 배치 (가운데 정렬)
 * @param {Array<{uid:string, boss?:boolean}>} units 살아 있는 유닛 (칸 순서)
 * @param {'ally'|'enemy'} side
 * @returns {Array<{uid, x, y, w, h, scale, boss}>} x,y = 카드 가운데
 */
export function rowLayout(units, side) {
  const area = BT.area[side];
  const n = units.length;
  if (!n) return [];
  const C = BT.card;
  const crowd = side === 'enemy' && n >= C.crowd.from;
  const sizeOf = (u) => (side === 'ally' ? C.ally : u.boss ? C.boss : C.enemy);
  const gapOf = (u) => (side === 'ally' ? C.ally.gap : crowd ? C.crowd.gap : u.boss ? C.boss.gap : C.enemy.gap);
  let scale = crowd ? C.crowd.scale : 1;
  const widthAt = (s) => units.reduce((sum, u, i) => sum + sizeOf(u).w * s + (i ? Math.max(gapOf(u), gapOf(units[i - 1])) * s : 0), 0);
  if (widthAt(scale) > area.w) scale = (scale * area.w) / widthAt(scale);
  const total = widthAt(scale);
  let x = area.x + (area.w - total) / 2;
  const cy = area.y + area.h / 2 + (side === 'enemy' ? BT.enemyRowDy : 0);
  return units.map((u, i) => {
    const s = sizeOf(u);
    if (i) x += Math.max(gapOf(u), gapOf(units[i - 1])) * scale;
    const out = { uid: u.uid, x: x + (s.w * scale) / 2, y: cy, w: s.w, h: s.h, scale, boss: side === 'enemy' && !!u.boss };
    x += s.w * scale;
    return out;
  });
}

/**
 * 같은 카드에 k번째로 떠 있는 숫자 위치 (0 = 기본 자리)
 * 26px씩 위로, 좌우로 번갈아 ±18px
 */
export function floatOffset(k) {
  if (k <= 0) return { dx: 0, dy: 0 };
  const N = BT.number;
  return { dx: k % 2 ? N.jitterX : -N.jitterX, dy: -N.stackDy * k };
}

/** 떠오르는 숫자 글자: 천 단위 쉼표, 1만 이상은 '1.2만' */
export const formatNum = (n) => formatBig(Math.max(0, Math.round(n || 0)));

/**
 * 행동 순서 칩 짝 맞추기 — 같은 칩 객체를 새 자리로 옮기기 위해
 * @param {string[]} oldIds 이전 목록 (0 = 지금 차례)
 * @param {string[]} newIds 새 목록 (0 = 지금 차례)
 * @returns {{ match: number[], exitUp: number[], fade: number[] }}
 *   match[i] = 새 i번째 칩이 쓸 이전 칩 번호 (-1 = 새로 들어옴)
 *   exitUp = 위로 빠질 이전 칩(행동이 끝난 지금 차례), fade = 그냥 사라질 이전 칩
 */
export function diffQueue(oldIds, newIds) {
  const used = new Array(oldIds.length).fill(false);
  const match = new Array(newIds.length).fill(-1);
  if (newIds.length && oldIds.length) {
    // 지금 차례: 같은 유닛이 계속이면 그대로, 아니면 다음 칸에서 올라옴
    if (oldIds[0] === newIds[0]) {
      match[0] = 0;
      used[0] = true;
    } else {
      const j = oldIds.indexOf(newIds[0], 1);
      if (j > 0) {
        match[0] = j;
        used[j] = true;
      }
    }
  }
  for (let i = 1; i < newIds.length; i++) {
    for (let j = 1; j < oldIds.length; j++) {
      if (!used[j] && oldIds[j] === newIds[i]) {
        match[i] = j;
        used[j] = true;
        break;
      }
    }
  }
  const exitUp = [];
  const fade = [];
  oldIds.forEach((_, j) => {
    if (used[j]) return;
    (j === 0 ? exitUp : fade).push(j);
  });
  return { match, exitUp, fade };
}

/** 행동 순서 칩 자리 (k = 0 지금 차례) → 가운데 y와 지름 */
export function queueSlot(k) {
  const Q = BT.queue;
  const top = BT.area.queue.y;
  if (k === 0) return { y: top + Q.cur / 2, size: Q.cur };
  return { y: top + Q.cur + Q.gap + (k - 1) * (Q.size + Q.gap) + Q.size / 2, size: Q.size };
}
