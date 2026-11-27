// 스테이지 기록: 클리어 횟수, 첫 클리어 보상, 최단 라운드 + 챕터 완료(레벨 상한)
import { grantRewards } from './economy.js';
import { levelCapFor } from '../config.js';

export function stageRecord(save, id) {
  return save.stages[id] || { clears: 0, firstClaimed: false, bestRounds: null, stars: 0 };
}

export const isCleared = (save, id) => stageRecord(save, id).clears > 0;

/** 모두 깬 챕터 수: 은퇴 아닌 스테이지가 1개 이상이고 전부 클리어한 챕터 (지워진 스테이지 id는 무시) */
export function clearedChapterCount(save, chapters, stageMap) {
  let n = 0;
  for (const ch of chapters || []) {
    const live = ch.stageIds.map((id) => stageMap.get(id)).filter((s) => s && !s.retired);
    if (live.length && live.every((s) => isCleared(save, s.id))) n += 1;
  }
  return n;
}

/** 지금 캐릭터 레벨 상한 (ctx = {save, data}) */
export const levelCapOf = (ctx) => levelCapFor(clearedChapterCount(ctx.save, ctx.data.chapters, ctx.data.stageMap), ctx.data.balance);

/**
 * 승리 기록 + 보상 지급 (매번 rewards, 처음 한 번 firstClearRewards)
 * @returns {{rewards:{gems:number,tickets:number}, first:{gems:number,tickets:number}|null}}
 */
export function recordClear(save, stage, rounds) {
  const rec = { ...stageRecord(save, stage.id) };
  rec.clears += 1;
  rec.bestRounds = rec.bestRounds == null ? rounds : Math.min(rec.bestRounds, rounds);
  let first = null;
  if (!rec.firstClaimed) {
    rec.firstClaimed = true;
    first = { ...stage.firstClearRewards };
    grantRewards(save, first);
  }
  grantRewards(save, stage.rewards);
  save.stages[stage.id] = rec;
  return { rewards: { ...stage.rewards }, first };
}
