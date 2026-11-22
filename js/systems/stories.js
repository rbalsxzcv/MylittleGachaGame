// 스토리: 해금 조건 판정, 읽음 기록, 첫 읽기 보상
import { inPeriod, parseDate, formatPeriod, now, nowKstIso } from '../core/time.js';
import { isOwned } from './collection.js';
import { addGems } from './economy.js';

export const KIND_LABELS = { main: '메인', character: '캐릭터', event: '이벤트' };

/** 같은 묶음(종류 + 캐릭터 스토리면 같은 캐릭터)에서 장 순서대로 정렬 */
export function storiesOfGroup(index, story) {
  return index
    .filter((s) => s.kind === story.kind && (story.kind !== 'character' || s.characterId === story.characterId))
    .sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id));
}

export const isRead = (save, id) => !!save.readStories[id];

/**
 * 해금 상태
 * @returns {{visible:boolean, unlocked:boolean, reasons:string[], ended:boolean}}
 *  - visible: 목록에 보일지 (시작 전 이벤트는 숨김 → 스포일러 방지)
 *  - reasons: 잠긴 이유(사람이 읽는 문장)
 */
export function storyState(story, { save, index, charMap }, t = now()) {
  const reasons = [];
  let visible = true;
  let ended = false;
  const read = isRead(save, story.id);
  // 지워진 캐릭터의 캐릭터 스토리는 목록에서 숨김 (없었던 것처럼)
  if (story.characterId && !charMap.has(story.characterId)) visible = false;

  for (const cond of story.unlock) {
    if (cond.type === 'prevChapter') {
      const group = storiesOfGroup(index, story);
      const i = group.findIndex((s) => s.id === story.id);
      const prev = i > 0 ? group[i - 1] : null;
      if (prev && !isRead(save, prev.id)) reasons.push(`이전 장 「${prev.title}」을(를) 먼저 읽어 주세요`);
    } else if (cond.type === 'ownsCharacter') {
      // 데이터에서 지워진 캐릭터는 세이브에 기록이 남아 있어도 '보유'로 치지 않음 (그 스토리는 숨김)
      if (!charMap.has(cond.characterId)) visible = false;
      if (!isOwned(save, cond.characterId) || !charMap.has(cond.characterId)) {
        const name = charMap.get(cond.characterId)?.name ?? cond.characterId;
        reasons.push(`${name} 보유 시 해금`);
      }
    } else if (cond.type === 'period') {
      const start = parseDate(cond.startAt);
      if (start && t < start) visible = false;
      if (!inPeriod(cond.startAt, cond.endAt, t)) {
        const endDate = parseDate(cond.endAt);
        if (endDate && t >= endDate) ended = true;
        // 기간이 끝났어도 이미 읽은 스토리는 다시 볼 수 있음
        if (!read) reasons.push(`기간 한정 (${formatPeriod(cond.startAt, cond.endAt)})`);
      }
    }
  }
  return { visible, unlocked: reasons.length === 0, reasons, ended };
}

/** 이벤트 기간 조건 (목록 표시용) */
export function periodOf(story) {
  return story.unlock.find((c) => c.type === 'period') ?? null;
}

/**
 * 스토리를 끝까지 읽음 → 처음이면 보상 지급
 * @returns {number} 지급한 보석 (이미 읽었으면 0)
 */
export function completeStory(save, story) {
  if (isRead(save, story.id)) return 0;
  save.readStories[story.id] = nowKstIso();
  const gems = story.reward?.gems ?? 0;
  if (gems > 0) addGems(save, gems);
  return gems;
}

/** 읽을 수 있고 아직 안 읽은 스토리가 있는지 (메뉴 빨간 점) */
export function hasUnreadUnlocked(ctx) {
  const env = { save: ctx.save, index: ctx.data.storyIndex, charMap: ctx.data.allCharMap };
  return ctx.data.storyIndex.some((s) => {
    if (isRead(ctx.save, s.id)) return false;
    const st = storyState(s, env);
    return st.visible && st.unlocked;
  });
}
