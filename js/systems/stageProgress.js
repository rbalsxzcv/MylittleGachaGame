// 스테이지 기록: 클리어 횟수, 첫 클리어 보상, 최단 라운드
import { grantRewards } from './economy.js';

export function stageRecord(save, id) {
  return save.stages[id] || { clears: 0, firstClaimed: false, bestRounds: null, stars: 0 };
}

export const isCleared = (save, id) => stageRecord(save, id).clears > 0;

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
