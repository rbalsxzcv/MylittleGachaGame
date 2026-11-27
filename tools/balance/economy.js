// 경제 검사 (밸런스 툴킷): 챕터마다 "기준 팀 5명을 기대 레벨까지 올리는 누적 비용" vs "누적 수입"
// 수입 = 첫 클리어 + 스테이지마다 반복 expected.repeatsPerStage회 + 일일 보상 expected.daysPerChapter일 (추억 레벨업 티켓은 빼고)
// 레벨업 비용 곡선(balance.level)이 기대 레벨 경사(레벨 상한 기준)를 따라갈 수 있는지 보는 표
import { costFor, goldCostFor } from '../../js/systems/progression.js';
import { expectedLevelOf } from '../enemygen/generate.js';

const TEAM = 5;

/** @returns {Array<{chapter, fromLevel, toLevel, costTickets, incomeTickets, costGold, incomeGold, ok}>} (누적) */
export function economyCheck(data) {
  const B = data.balance;
  const E = B.expected;
  const rows = [];
  let income = { tickets: 0, gold: 0 };
  let from = E.levelStart;
  const start = E.levelStart;
  for (const ch of data.chapters || []) {
    const stages = ch.stageIds.map((id) => data.stageMap.get(id)).filter((s) => s && !s.retired);
    if (!stages.length) continue;
    for (const s of stages) {
      income.tickets += (s.firstClearRewards?.tickets || 0) + E.repeatsPerStage * (s.rewards?.tickets || 0);
      income.gold += (s.firstClearRewards?.gold || 0) + E.repeatsPerStage * (s.rewards?.gold || 0);
    }
    income.tickets += E.daysPerChapter * B.daily.tickets;
    income.gold += E.daysPerChapter * B.daily.gold;
    const to = expectedLevelOf(stages.at(-1).id, data.chapters, B, data.stageMap);
    const costTickets = TEAM * costFor(start, Math.max(0, to - start), B);
    const costGold = TEAM * goldCostFor(start, Math.max(0, to - start), B);
    rows.push({ chapter: ch.id, fromLevel: from, toLevel: to, costTickets, incomeTickets: income.tickets, costGold, incomeGold: income.gold, ok: costTickets <= income.tickets && costGold <= income.gold });
    from = to;
  }
  return rows;
}
