// 스토리 목록: 메인 / 캐릭터 / 이벤트 탭, 잠금 상태와 조건, 첫 읽기 보상, 읽음 표시
import { h, gemIcon } from './dom.js';
import { go } from './router.js';
import { toast } from './toast.js';
import { charArt } from './charCard.js';
import { countdownEl, startCountdowns } from './countdown.js';
import { storyState, isRead, periodOf, KIND_LABELS } from '../systems/stories.js';
import { formatPeriod } from '../core/time.js';

const KINDS = ['main', 'character', 'event'];

export function storyListScreen(ctx) {
  let lastKind = 'main';

  return {
    title: '스토리',
    mount(el, params) {
      let kind = KINDS.includes(params.kind) ? params.kind : lastKind;
      const env = () => ({ save: ctx.save, index: ctx.data.storyIndex, charMap: ctx.data.allCharMap });

      const tabs = h('div', { class: 'filter-tabs', role: 'tablist' });
      const list = h('div', { class: 'story-list' });
      const scroll = h('div', { class: 'story-scroll' }, list);

      function storiesOf(k) {
        return ctx.data.storyIndex
          .filter((s) => s.kind === k)
          .map((s) => ({ story: s, state: storyState(s, env()) }))
          .filter((x) => x.state.visible)
          .sort((a, b) => {
            if (k === 'character' && a.story.characterId !== b.story.characterId) {
              return (a.story.characterId || '').localeCompare(b.story.characterId || '');
            }
            return a.story.chapter - b.story.chapter || a.story.id.localeCompare(b.story.id);
          });
      }

      function render() {
        lastKind = kind;
        tabs.replaceChildren(
          ...KINDS.map((k) => {
            const items = storiesOf(k);
            const unread = items.filter((x) => x.state.unlocked && !isRead(ctx.save, x.story.id)).length;
            return h(
              'button',
              { class: ['filter-tab', k === kind && 'active'], type: 'button', role: 'tab', onclick: () => ((kind = k), render()) },
              KIND_LABELS[k],
              unread > 0 && h('span', { class: 'tab-count' }, unread),
            );
          }),
        );

        const items = storiesOf(kind);
        list.replaceChildren(
          ...items.map(({ story, state }) => storyRow(story, state)),
          ...(items.length === 0 ? [h('p', { class: 'collection-empty' }, kind === 'event' ? '지금 진행 중인 이벤트 스토리가 없어요' : '아직 스토리가 없어요')] : []),
        );
        const focus = params.focus && list.querySelector(`[data-story="${params.focus}"]`);
        if (focus) {
          focus.classList.add('is-focus');
          focus.scrollIntoView({ block: 'center' });
          params.focus = null;
        }
      }

      function storyRow(story, state) {
        const read = isRead(ctx.save, story.id);
        const char = story.characterId ? ctx.data.allCharMap.get(story.characterId) : null;
        const period = periodOf(story);
        const chapterLabel = story.kind === 'event' ? '이벤트' : `제${story.chapter}장`;
        return h(
          'button',
          {
            class: ['story-row', !state.unlocked && 'is-locked', read && 'is-read'],
            type: 'button',
            dataset: { story: story.id },
            onclick: () => {
              if (!state.unlocked) return toast(state.reasons[0] || '아직 읽을 수 없어요');
              go('story', { id: story.id });
            },
          },
          char && h('div', { class: `story-thumb rar-${char.rarity}` }, charArt(char)),
          h(
            'div',
            { class: 'story-main' },
            h('div', { class: 'story-chapter' }, char ? `${char.name} · ${chapterLabel}` : chapterLabel),
            h('div', { class: 'story-title' }, story.title),
            story.summary && h('div', { class: 'story-summary' }, story.summary),
            !state.unlocked && h('div', { class: 'story-lock' }, '🔒︎ ', state.reasons.join(' · ')),
            period && state.unlocked && h('div', { class: 'story-period' }, `${formatPeriod(period.startAt, period.endAt)} `, countdownEl(period.endAt)),
          ),
          h(
            'div',
            { class: 'story-side' },
            read ? h('span', { class: 'story-read' }, '✓ 읽음') : story.reward.gems > 0 && h('span', { class: 'story-reward' }, gemIcon(), story.reward.gems),
          ),
        );
      }

      el.append(h('div', { class: 'collection-head' }, tabs), scroll);
      render();
      const stop = startCountdowns(el);
      return { destroy: stop };
    },
  };
}
