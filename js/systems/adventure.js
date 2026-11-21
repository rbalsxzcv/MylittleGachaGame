// 모험: 챕터별 스테이지. 스테이지 1개 = 스토리 1개(storyId) = 전투 1개 (스토리 안의 battle 장면)
// - 스테이지를 누르면 그 스토리가 열리고, 스토리 중간의 전투에서 이겨야 다음 장면으로 진행
// - 스토리를 끝까지 보면(= 전투 승리 포함) 완료 → 다음 스테이지 해금 (stories.js의 prevChapter 규칙)
// - 전투가 생기기 전에 이미 읽은 스토리는 완료로 인정 (예전 세이브)
// 화면과 분리된 순수 함수 — 테스트와 개발 도구 검사가 같이 씀
import { storyState, isRead } from './stories.js';
import { isCleared, stageRecord } from './stageProgress.js';

/**
 * 챕터별 스테이지 상태
 * @returns {Array<{id, title, stages:Array<{stage, story, index, state:'locked'|'open'|'done', reasons:string[], read:boolean, cleared:boolean, record}>}>}
 */
export function adventureChapters(ctx) {
  const { stageMap, storyIndex, chapters = [] } = ctx.data;
  const env = { save: ctx.save, index: storyIndex, charMap: ctx.data.allCharMap || ctx.data.charMap };
  const storyById = new Map(storyIndex.map((s) => [s.id, s]));
  return chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    stages: ch.stageIds
      .map((id) => stageMap.get(id))
      .filter((st) => st && !st.retired)
      .map((stage, index) => {
        const story = stage.storyId ? storyById.get(stage.storyId) : null;
        const read = story ? isRead(ctx.save, story.id) : false;
        const cleared = isCleared(ctx.save, stage.id);
        const ss = story ? storyState(story, env) : { unlocked: false, visible: true, reasons: ['스토리가 연결되지 않았어요'] };
        const state = read ? 'done' : ss.unlocked && ss.visible ? 'open' : 'locked';
        return { stage, story, index, state, reasons: ss.reasons || [], read, cleared, record: stageRecord(ctx.save, stage.id) };
      }),
  }));
}

/** 다음에 할 스테이지 (열려 있고 아직 안 끝낸 첫 스테이지) */
export function nextAdventure(ctx) {
  for (const ch of adventureChapters(ctx)) for (const s of ch.stages) if (s.state === 'open') return s;
  return null;
}

/** 할 수 있는 스테이지가 있는지 (메뉴 빨간 점) */
export const hasOpenAdventure = (ctx) => !!nextAdventure(ctx);

/**
 * 모험 연결 검사 → 문제 문장 목록 (비면 정상)
 * - 스테이지마다 storyId가 있고, 그 메인 스토리에 이 스테이지 전투 장면이 정확히 1개
 * - 메인 스토리마다 전투 장면이 정확히 1개, 그 전투의 스테이지가 이 스토리를 가리킴
 * @param {Array} stages 정리된 스테이지 목록
 * @param {Array} storyIndex
 * @param {Record<string, {scenes:Array}>} bodies 스토리 id → 본문
 */
export function adventureIssues(stages, storyIndex, bodies) {
  const issues = [];
  const byId = new Map(stages.map((s) => [s.id, s]));
  const stories = new Map(storyIndex.map((s) => [s.id, s]));
  const used = new Map();
  for (const st of stages) {
    if (st.retired) continue;
    if (!st.storyId) issues.push(`${st.id}: storyId가 없어요`);
    else if (!stories.has(st.storyId)) issues.push(`${st.id}: 없는 스토리 '${st.storyId}'`);
    else if (used.has(st.storyId)) issues.push(`${st.id}: 스토리 '${st.storyId}'를 ${used.get(st.storyId)}도 쓰고 있어요`);
    else used.set(st.storyId, st.id);
  }
  for (const s of storyIndex) {
    if (s.kind !== 'main') continue;
    const body = bodies[s.id];
    if (!body) continue;
    const battles = body.scenes.filter((sc) => sc.type === 'battle');
    if (battles.length !== 1) {
      issues.push(`${s.id}: 메인 스토리에는 전투 장면이 정확히 1개 있어야 해요 (지금 ${battles.length}개)`);
      continue;
    }
    const stage = byId.get(battles[0].stageId);
    if (!stage) issues.push(`${s.id}: 전투 장면의 스테이지 '${battles[0].stageId}'가 없어요`);
    else if (stage.storyId !== s.id) issues.push(`${s.id}: 전투 스테이지 ${stage.id}의 storyId가 '${stage.storyId}'예요 (이 스토리여야 함)`);
  }
  return issues;
}
