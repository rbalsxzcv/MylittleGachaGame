// 모험 화면: 챕터 탭 → 스테이지 카드 (스테이지 1개 = 스토리 1개 + 전투 1개)
// 카드를 누르면 그 스토리가 열리고, 스토리 안의 전투에서 이겨야 다음으로 진행. 다 보면 다음 스테이지가 열림
// 메뉴 화면이라 움직임 없음 (정적 HTML)
import { h, gemIcon } from './dom.js';
import { go } from './router.js';
import { toast } from './toast.js';
import { adventureChapters } from '../systems/adventure.js';
import { teamPower, teamSize } from '../systems/teams.js';
import { rewardText } from '../systems/economy.js';
import { formatBig } from '../config.js';

export function adventureScreen(ctx) {
  let lastChapter = null;

  return {
    title: '모험',
    mount(el, params = {}) {
      const chapters = adventureChapters(ctx);
      let chId = params.chapter || lastChapter || chapters.find((c) => c.stages.some((s) => s.state === 'open'))?.id || chapters[0]?.id;
      const power = teamPower(ctx);
      const size = teamSize(ctx);

      const tabs = h('div', { class: 'filter-tabs', role: 'tablist' });
      const head = h('div', { class: 'adv-head' });
      const grid = h('div', { class: 'adv-grid' });

      function render() {
        lastChapter = chId;
        tabs.hidden = chapters.length < 2;
        tabs.replaceChildren(
          ...chapters.map((c) =>
            h('button', { class: ['filter-tab', c.id === chId && 'active'], type: 'button', role: 'tab', onclick: () => ((chId = c.id), render()) }, c.title.split(':')[0]),
          ),
        );
        const ch = chapters.find((c) => c.id === chId);
        if (!ch) {
          grid.replaceChildren(h('p', { class: 'muted' }, '모험 데이터가 없어요'));
          return;
        }
        const done = ch.stages.filter((s) => s.state === 'done').length;
        head.replaceChildren(
          h('div', {}, h('h2', { class: 'adv-title' }, ch.title), h('div', { class: 'muted small' }, `진행 ${done} / ${ch.stages.length}`)),
          h(
            'div',
            { class: 'adv-team' },
            h('span', { class: 'muted small' }, '내 편성 전투력'),
            h('b', {}, size ? formatBig(power) : '편성 없음'),
            h('button', { class: 'btn btn-small', type: 'button', onclick: () => go('team') }, '편성'),
          ),
        );
        const chNo = (chapters.indexOf(ch) + 1).toString();
        grid.replaceChildren(
          ...ch.stages.map((s) => {
            const st = s.stage;
            const weak = size && power < st.recommendedPower;
            const first = !s.record.firstClaimed && rewardText(st.firstClearRewards);
            return h(
              'button',
              {
                class: ['adv-card', `is-${s.state}`],
                type: 'button',
                dataset: { stage: st.id },
                onclick: () => open(s),
              },
              h('div', { class: 'adv-no' }, `${chNo}-${s.index + 1}`),
              h('div', { class: 'adv-name' }, st.name),
              h('div', { class: 'adv-story muted small' }, s.story ? `「${s.story.title}」` : '스토리 없음'),
              h(
                'div',
                { class: 'adv-meta' },
                h('span', { class: ['adv-power', weak && 'is-weak'] }, `추천 ${formatBig(st.recommendedPower)}`),
                st.roundLimit && h('span', { class: 'muted small' }, `${st.roundLimit}라운드`),
              ),
              s.state === 'locked'
                ? h('div', { class: 'adv-state' }, '🔒 잠김')
                : s.state === 'done'
                  ? h('div', { class: 'adv-state is-done' }, '✓ 완료', s.record.bestRounds && h('span', { class: 'muted small' }, ` · 최단 ${s.record.bestRounds}라운드`))
                  : h('div', { class: 'adv-state is-open' }, '도전 가능'),
              first && s.state !== 'locked' && h('div', { class: 'adv-reward' }, gemIcon(), `첫 클리어 ${first}`),
            );
          }),
        );
      }

      function open(s) {
        if (s.state === 'locked') return toast(s.reasons[0] || '이전 스테이지를 먼저 끝내 주세요', { type: 'error' });
        if (!s.story) return toast('이 스테이지에 연결된 스토리가 없어요', { type: 'error' });
        go('story', { id: s.story.id });
      }

      el.append(h('div', { class: 'adv-top' }, tabs, head), h('div', { class: 'adv-scroll' }, grid));
      render();
      return {
        onKey(e) {
          if (e.code === 'Enter') {
            const next = chapters.find((c) => c.id === chId)?.stages.find((s) => s.state === 'open');
            if (next) return open(next), true;
          }
          return false;
        },
      };
    },
  };
}
