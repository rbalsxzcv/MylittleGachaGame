// 우편함 / 공지 / 업데이트 내역
import { inPeriod, parseDate, now } from '../core/time.js';
import { grantRewards, sumRewards } from './economy.js';

// ── 우편 ──────────────────────────────────────────────
/** 지금 받을 수 있는 기간의 우편 (최근 시작 순) */
export function activeMail(mail, t = now()) {
  return mail
    .filter((m) => inPeriod(m.startAt, m.endAt, t))
    .sort((a, b) => (Date.parse(b.startAt || 0) || 0) - (Date.parse(a.startAt || 0) || 0));
}

export const isClaimed = (save, id) => save.claimedMail.includes(id);

/** 우편 받기 (한 번만). 받은 보상 {gems, tickets, gold, scrolls}, 이미 받았거나 기간이 아니면 null */
export function claimMail(save, m, t = now()) {
  if (isClaimed(save, m.id) || !inPeriod(m.startAt, m.endAt, t)) return null;
  save.claimedMail.push(m.id);
  grantRewards(save, m.rewards);
  return sumRewards(m.rewards, null);
}

export function unclaimedCount(save, mail) {
  return activeMail(mail).filter((m) => !isClaimed(save, m.id)).length;
}

// ── 공지 ──────────────────────────────────────────────
/** 게시된 공지 (날짜가 지난 것만, 최신 순) */
export function visibleNotices(notices, t = now()) {
  return notices
    .filter((n) => {
      const d = parseDate(n.date);
      return !d || d <= t;
    })
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
}

/** 시작 시 팝업으로 띄울 공지 */
export function popupNotices(save, notices) {
  return visibleNotices(notices).filter((n) => n.popup && !save.hiddenNotices.includes(n.id));
}

// ── 업데이트 내역 ─────────────────────────────────────
/** 확인하지 않은 업데이트 노트 (새 버전들) */
export function unseenPatchNotes(save, version) {
  if (version.contentVersion <= save.seenContentVersion) return [];
  return version.patchNotes.filter((p) => p.version > save.seenContentVersion);
}
