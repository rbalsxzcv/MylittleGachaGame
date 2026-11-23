// 모험 화면: 챕터 탭 → 스테이지 카드 (스테이지 1개 = 스토리 1개 + 전투 1개)
// 카드를 누르면 그 스토리가 열리고, 스토리 안의 전투에서 이겨야 다음으로 진행. 다 보면 다음 스테이지가 열림
// 메뉴 화면이라 움직임 없음 (정적 HTML)
import { h, gemIcon } from './dom.js';
import { go } from './router.js';
import { toast } from './toast.js';
import { adventureChapters } from '../systems/adventure.js';
import { teamPower, teamSize, teamMembers, bestTeam } from '../systems/teams.js';
import { rewardText } from '../systems/economy.js';
import { formatBig } from '../config.js';
import { openModal } from './modal.js';
import { dropTable } from '../systems/gear.js';
import { repeatBattle, sweep, canSweep } from '../systems/farming.js';

const SLOT_LABEL = { hp: '체력', def: '방어', crit: '치명', atk: '공격' };
const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(3 - (n || 0));

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
                  ? h('div', { class: 'adv-state is-done' }, h('span', { class: 'adv-stars' }, stars(s.record.stars)), s.record.bestRounds && h('span', { class: 'muted small' }, ` · 최단 ${s.record.bestRounds}라운드`))
                  : h('div', { class: 'adv-state is-open' }, '도전 가능'),
              first && s.state !== 'locked' && h('div', { class: 'adv-reward' }, gemIcon(), `첫 클리어 ${first}`),
            );
          }),
        );
      }

      function open(s) {
        if (s.state === 'locked') return toast(s.reasons[0] || '이전 스테이지를 먼저 끝내 주세요', { type: 'error' });
        if (!s.story) return toast('이 스테이지에 연결된 스토리가 없어요', { type: 'error' });
        // 이미 클리어한 스테이지: 파밍 창 (반복 전투 · 소탕 · 드롭 표). 처음은 지금처럼 스토리 안에서
        if (s.record.clears > 0) return stagePanel(s);
        go('story', { id: s.story.id });
      }

      /** 스테이지 창: 별점, 드롭 표, 스토리 다시 보기, [반복 전투 N회], [소탕 N회] (★3) */
      function stagePanel(s) {
        const st = s.stage;
        const B = ctx.data.balance;
        const table = dropTable(st, ctx.data.chapters, B);
        const maxRuns = B.repeat.maxRuns;
        const count = h('input', { type: 'number', class: 'num-input', min: 1, max: maxRuns, value: 5 });
        const result = h('div', { class: 'farm-result' });
        const n = () => Math.max(1, Math.min(maxRuns, parseInt(count.value, 10) || 1));
        const show = (title, r, lost = false) => {
          const m = r.merged;
          const pieces = Object.entries(m.pieces).map(([k, v]) => {
            const [slot, tier] = k.split('.');
            return `${SLOT_LABEL[slot]} T${tier} ×${v}`;
          });
          result.replaceChildren(
            h('b', {}, `${title}: ${m.wins}/${m.runs}번 승리${lost ? ' — 져서 멈췄어요' : ''}`),
            h('div', {}, `보상 ${rewardText(m.rewards) || '-'}`),
            h('div', {}, `장비 ${pieces.join(' · ') || '-'} · 강화석 +${formatBig(m.gearMat)}`),
          );
          ctx.commit();
          render();
        };
        const team = () => {
          const t = teamMembers(ctx);
          return t.some(Boolean) ? t : bestTeam(ctx);
        };
        const sweepOk = canSweep(ctx.save, st.id);
        const body = h(
          'div',
          { class: 'stage-panel' },
          h('div', { class: 'adv-stars big' }, stars(s.record.stars), h('span', { class: 'muted small' }, ' ★1 승리 · ★2 쓰러진 아군 없음 · ★3 빠른 클리어 (소탕 조건)')),
          h(
            'div',
            { class: 'drop-table' },
            h('b', {}, `드롭 (한 판 ${table.count}개${table.boss ? ', 보스' : ''})`),
            ...table.tiers.map((t) => h('span', { class: `drop-chip tier-${t.tier}` }, `T${t.tier} ${Math.round(t.p * 100)}%`)),
            h('span', { class: 'muted small' }, `· 강화석 +${table.mat} · 칸은 무작위`),
          ),
          rewardText(st.rewards) && h('div', { class: 'muted small' }, `클리어 보상 ${rewardText(st.rewards)}`),
          h('div', { class: 'row' }, h('label', { class: 'inline' }, '횟수 ', count, ` (최대 ${maxRuns})`)),
          h(
            'div',
            { class: 'row wrap' },
            h(
              'button',
              {
                class: 'btn btn-primary',
                type: 'button',
                onclick: () => {
                  const r = repeatBattle(ctx, st, team(), n(), Math.random); // 렌더 없이 AUTO
                  show('반복 전투', r, r.lost);
                },
              },
              '반복 전투',
            ),
            h(
              'button',
              { class: 'btn', type: 'button', disabled: !sweepOk, title: sweepOk ? '전투 없이 바로 보상 + 드롭' : '★3으로 클리어하면 소탕할 수 있어요', onclick: () => show('소탕', sweep(ctx, st, n(), Math.random)) },
              '소탕',
            ),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go('story', { id: s.story.id }) }, '스토리 다시 보기'),
          ),
          result,
        );
        openModal({ title: `${st.name}`, body, dismissValue: true });
      }

      // 위(챕터 탭 — 2챕터부터 보임 — + 머리글) 아래로 목록이 이어지게 세로 배치
      el.append(h('div', { class: 'adv-wrap' }, h('div', { class: 'adv-top' }, tabs, head), h('div', { class: 'adv-scroll' }, grid)));
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
