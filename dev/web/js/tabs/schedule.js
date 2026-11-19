// 일정 탭: 배너 / 이벤트 스토리 / 우편 / 캐릭터 공개 타임라인 + 겹침·공백 경고
import { h, fmt } from '../ui.js';
import { state } from '../state.js';

const DAY = 86400000;
const t = (iso) => (iso ? Date.parse(iso) : NaN);
const md = (ms) => {
  const d = new Date(ms + 9 * 3600000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export function scheduleTab(root) {
  const now = Date.now();
  const d = state.data;
  const charName = (id) => d.characters.find((c) => c.id === id)?.name || id;

  // ── 타임라인 항목 모으기 ──
  const rows = [];
  const add = (group, it) => rows.push({ group, ...it });
  for (const b of d.banners) add(b.type === 'pickup' ? '픽업 배너' : '상시 배너', { id: b.id, label: b.title, start: t(b.startAt), end: t(b.endAt), link: `#banners/${b.id}`, cls: b.type });
  for (const s of d.storyIndex) {
    const p = (s.unlock || []).find((c) => c.type === 'period');
    if (p) add('이벤트 스토리', { id: s.id, label: s.title, start: t(p.startAt), end: t(p.endAt), link: `#stories/${s.id}`, cls: 'story' });
  }
  for (const m of d.mail) add('우편', { id: m.id, label: `${m.title} (보석 ${m.rewards?.gems ?? 0})`, start: t(m.startAt), end: t(m.endAt), link: `#inbox/${m.id}`, cls: 'mail' });
  for (const c of d.characters) {
    const at = t(c.addedAt);
    if (!Number.isNaN(at) && at > now - 30 * DAY) add('캐릭터 공개', { id: c.id, label: `${c.name} (${c.rarity})`, start: at, end: NaN, point: true, link: '#characters', cls: 'char' });
  }
  for (const n of d.notices) {
    const at = t(n.date);
    if (!Number.isNaN(at) && at > now - 30 * DAY) add('공지', { id: n.id, label: n.title, start: at, end: NaN, point: true, link: `#inbox/${n.id}`, cls: 'notice' });
  }

  // ── 표시 범위: 오늘 기준 앞 7일 ~ 마지막 일정 + 7일 (최소 45일) ──
  const finite = rows.flatMap((r) => [r.start, r.end]).filter((x) => Number.isFinite(x));
  const from = Math.min(now - 7 * DAY, ...finite.filter((x) => x > now - 60 * DAY)) - DAY;
  const to = Math.max(now + 45 * DAY, ...finite) + 7 * DAY;
  const pct = (ms) => ((Math.min(Math.max(ms, from), to) - from) / (to - from)) * 100;

  // ── 경고 ──
  const warnings = [];
  const pickups = d.banners.filter((b) => b.type === 'pickup').map((b) => ({ b, s: t(b.startAt) || -Infinity, e: Number.isNaN(t(b.endAt)) ? Infinity : t(b.endAt) }));
  for (let i = 0; i < pickups.length; i++) {
    for (let j = i + 1; j < pickups.length; j++) {
      const A = pickups[i];
      const B = pickups[j];
      if (A.s < B.e && B.s < A.e) warnings.push(['warn', `픽업 「${A.b.title}」와 「${B.b.title}」의 기간이 겹쳐요 (천장/확정은 픽업 배너끼리 공유)`]);
    }
  }
  const future = pickups.filter((p) => p.e > now).sort((a, b) => a.s - b.s);
  for (let i = 0; i + 1 < future.length; i++) {
    const gap = future[i + 1].s - future[i].e;
    if (gap > 0) warnings.push(['warn', `${md(future[i].e)} ~ ${md(future[i + 1].s)} 픽업 배너 공백 (${Math.round(gap / DAY * 10) / 10}일)`]);
  }
  if (future.length && Number.isFinite(future.at(-1).e)) warnings.push(['info', `마지막 픽업 「${future.at(-1).b.title}」가 ${fmt(future.at(-1).b.endAt)}에 끝나요. 이후 일정이 없어요`]);
  if (!d.banners.some((b) => b.type === 'standard' && !b.endAt)) warnings.push(['info', '기간 제한 없는 상시 배너가 없어요 → 게임이 기본 상시 모집을 자동으로 보여줘요']);
  for (const b of d.banners) {
    if (b.relatedStoryId) {
      const s = d.storyIndex.find((x) => x.id === b.relatedStoryId);
      const p = s && (s.unlock || []).find((c) => c.type === 'period');
      if (!s) warnings.push(['warn', `배너 「${b.title}」의 관련 스토리 '${b.relatedStoryId}'가 없어요`]);
      else if (p && (t(p.startAt) !== t(b.startAt) || t(p.endAt) !== t(b.endAt))) warnings.push(['info', `배너 「${b.title}」와 이벤트 스토리 「${s.title}」의 기간이 달라요`]);
    }
    for (const cid of b.pickupIds || []) {
      const c = d.characters.find((x) => x.id === cid);
      if (c?.addedAt && b.startAt && t(c.addedAt) > t(b.startAt)) warnings.push(['warn', `「${b.title}」 시작 시각에 픽업 캐릭터 ${charName(cid)}가 아직 공개 전이에요 (addedAt 확인)`]);
    }
  }
  for (const s of d.storyIndex.filter((x) => x.kind === 'event')) {
    const p = (s.unlock || []).find((c) => c.type === 'period');
    if (p && !d.banners.some((b) => b.relatedStoryId === s.id)) warnings.push(['info', `이벤트 스토리 「${s.title}」와 연결된 배너가 없어요`]);
  }

  // ── 그리기 ──
  const ticks = [];
  for (let ms = Math.ceil(from / DAY) * DAY - 9 * 3600000; ms < to; ms += DAY) {
    const date = new Date(ms + 9 * 3600000);
    const weekly = date.getUTCDay() === 1; // 월요일마다 표시
    if (weekly) ticks.push(h('div', { class: 'tick', style: { left: `${pct(ms)}%` } }, md(ms)));
  }
  const groups = ['픽업 배너', '상시 배너', '이벤트 스토리', '우편', '캐릭터 공개', '공지'];
  const lanes = groups
    .filter((g) => rows.some((r) => r.group === g))
    .map((g) =>
      h(
        'div',
        { class: 'lane' },
        h('div', { class: 'lane-label' }, g),
        h(
          'div',
          { class: 'lane-track' },
          rows
            .filter((r) => r.group === g)
            .map((r, i) => {
              const s = Number.isFinite(r.start) ? r.start : from;
              const e = r.point ? s : Number.isFinite(r.end) ? r.end : to;
              const title = `${r.label}\n${Number.isFinite(r.start) ? fmt(new Date(r.start).toISOString()) : '처음부터'} ~ ${r.point ? '' : Number.isFinite(r.end) ? fmt(new Date(r.end).toISOString()) : '끝없음'}`;
              return h(
                'a',
                {
                  class: ['bar', r.cls, r.point && 'point', e < now && 'past'],
                  href: r.link,
                  title,
                  style: { left: `${pct(s)}%`, width: r.point ? '' : `${Math.max(0.6, pct(e) - pct(s))}%`, top: `${(i % 3) * 30 + 4}px` },
                },
                r.label,
              );
            }),
        ),
      ),
    );

  root.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '일정 (한국 시간)'),
      h('p', { class: 'muted small' }, '막대를 누르면 해당 항목 편집으로 이동해요. 흐린 막대는 이미 끝난 일정이에요.'),
      h('div', { class: 'timeline' }, h('div', { class: 'ticks' }, ticks), h('div', { class: 'now-line', style: { left: `calc(220px + (100% - 220px) * ${pct(now) / 100})` }, title: '지금' }), lanes),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, `확인할 점 (${warnings.length})`),
      warnings.length ? h('ul', { class: 'warn-list' }, warnings.map(([lvl, msg]) => h('li', { class: lvl }, lvl === 'warn' ? '⚠ ' : 'ℹ ', msg))) : h('p', {}, '겹침이나 공백이 없어요 👍'),
    ),
  );
  return {};
}
