// 전투 (HTML 쪽): Phaser 전투 장면(js/fx/BattleScene.js)을 띄우고, 끝나면 결과(보상 · 캐릭터별 피해) 화면
// 전투 규칙은 js/battle/engine.js. 메뉴 화면은 정적 HTML, 움직임은 Phaser 장면 안에서만.
// Phaser를 못 불러오면 연출 없이 자동 전투 결과만 보여 줌
import { h } from './dom.js';
import { createBattle } from '../battle/engine.js';
import { randomSeed } from '../core/rng.js';
import { rewardText as rewardLine } from '../systems/economy.js';
import { runScene, stopRunningScene, prefersReducedMotion } from '../fx/phaserHost.js';
import { createBattleScene } from '../fx/BattleScene.js';

const num = (n) => Number(n).toLocaleString('ko-KR');

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {object} o.ctx
 * @param {object} o.stage
 * @param {Array} o.team teams.teamMembers 결과
 * @param {string|null} [o.background] 전투 배경 그림 (스토리 전투 장면의 배경)
 * @param {(summary)=>({rewards, first}|null)} [o.onResult] 끝났을 때 한 번 (보상 지급은 여기서)
 * @param {(result:string)=>Array<{label:string, primary?:boolean, onClick:()=>void}>} o.resultActions
 * @param {()=>void} o.onQuit 포기
 */
const SLOT_LABEL = { hp: '체력', def: '방어', crit: '치명', atk: '공격' };
/** 드롭 한 줄: '공격 T2 · 체력 T1 · 강화석 +20' */
export function dropLine(drops) {
  const parts = drops.pieces.map((p) => `${SLOT_LABEL[p.slot] || p.slot} T${p.tier}`);
  if (drops.gearMat) parts.push(`강화석 +${drops.gearMat}`);
  return parts.join(' · ');
}

export function mountBattle(host, { ctx, stage, team, background = null, onResult, resultActions, onQuit }) {
  const seed = randomSeed();
  const battle = createBattle({ team, stage, data: ctx.data, seed });
  let destroyed = false;
  let finished = false;

  const loading = h('div', { class: 'battle-loading' }, '전투 준비 중…');
  const resultLayer = h('div', { class: 'battle-result-layer', hidden: true });
  const root = h('div', { class: 'battle' }, loading, resultLayer);
  host.append(root);

  const settings = ctx.save.settings;
  runScene('Battle', createBattleScene, {
    battle,
    data: ctx.data,
    stage,
    background,
    speed: settings.battleSpeed,
    auto: settings.battleAuto,
    reduced: prefersReducedMotion(),
    onSettings(patch) {
      Object.assign(settings, patch);
      ctx.commit();
    },
  })
    .then((out) => {
      if (destroyed || !out) return;
      if (out.quit) return onQuit();
      finish();
    })
    .catch((e) => {
      console.warn('[battle] 전투 화면을 불러오지 못해 결과만 보여 줘요', e);
      if (destroyed) return;
      battle.runToEnd();
      finish('전투 화면을 불러오지 못해 자동 전투 결과만 보여 줘요.');
    });

  function finish(note = '') {
    if (finished) return;
    finished = true;
    loading.remove();
    const s = battle.state;
    ctx.lastBattle = { stageId: stage.id, team, ...battle.record() };
    const summary = battle.summary();
    const reward = onResult?.(summary) || null;
    const win = s.result === 'win';
    const maxDealt = Math.max(1, ...summary.units.map((u) => u.dealt));
    resultLayer.hidden = false;
    resultLayer.replaceChildren(
      h(
        'div',
        { class: ['battle-result', win ? 'is-win' : 'is-lose'] },
        h('div', { class: 'result-title' }, win ? '승리' : '패배'),
        h('div', { class: 'muted' }, win ? `${s.round}라운드 만에 클리어` : s.reason === 'timeout' ? `라운드 제한(${s.roundLimit || s.maxRounds})을 넘겼어요` : '아군이 모두 쓰러졌어요'),
        note && h('div', { class: 'muted small' }, note),
        reward?.first && rewardLine(reward.first) && h('div', { class: 'result-reward first' }, '첫 클리어 보상 ', h('b', {}, rewardLine(reward.first))),
        reward?.rewards && rewardLine(reward.rewards) && h('div', { class: 'result-reward' }, '클리어 보상 ', h('b', {}, rewardLine(reward.rewards))),
        reward?.stars != null && h('div', { class: 'result-stars', title: '★1 승리 · ★2 쓰러진 아군 없음 · ★3 빠른 클리어 (★3이면 소탕 가능)' }, '★'.repeat(reward.stars) + '☆'.repeat(3 - reward.stars)),
        reward?.drops && h('div', { class: 'result-reward' }, '장비 ', h('b', {}, dropLine(reward.drops))),
        h(
          'table',
          { class: 'result-table' },
          h('tr', {}, h('th', {}, ''), h('th', {}, '피해'), h('th', {}, '치유'), h('th', {}, '보호막')),
          summary.units.map((u) =>
            h(
              'tr',
              { class: !u.alive && 'is-dead' },
              h('td', {}, u.name),
              h('td', {}, h('span', { class: 'dmg-bar', style: { width: `${(u.dealt / maxDealt) * 120}px` } }), num(u.dealt)),
              h('td', {}, num(u.healed)),
              h('td', {}, num(u.shielded)),
            ),
          ),
        ),
        h(
          'div',
          { class: 'result-actions' },
          resultActions(s.result).map((b) => h('button', { class: ['btn', b.primary && 'btn-primary'], type: 'button', onclick: b.onClick }, b.label)),
        ),
      ),
    );
    setTimeout(() => resultLayer.querySelector('.btn-primary')?.focus({ preventScroll: true }), 30);
  }

  return {
    battle,
    destroy() {
      destroyed = true;
      if (!finished) stopRunningScene();
      root.remove();
    },
    onKey(e) {
      // 전투 중 키는 Phaser 장면이 직접 처리 (main.js가 연출 레이어가 떠 있으면 넘겨 줌)
      if (!finished) return true;
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
        resultLayer.querySelector('.btn-primary')?.click();
        return true;
      }
      return false;
    },
  };
}

/**
 * 단독 전투 화면 (스토리 밖) — ?battle=<스테이지id> 미리보기, 개발 도구 스테이지 미리보기
 * 보상은 주지 않음. 편성이 비어 있으면 보유 캐릭터 중 전투력 상위 5명
 */
export function battleScreen(ctx, { teamMembers, bestTeam, back }) {
  return {
    hud: 'none',
    transient: true,
    mount(el, { stageId }) {
      const stage = ctx.data.stageMap.get(stageId);
      if (!stage) {
        el.append(h('div', { class: 'battle-loading' }, `스테이지를 찾을 수 없어요 (${stageId})`));
        return {};
      }
      let team = teamMembers(ctx);
      if (!team.some(Boolean)) team = bestTeam(ctx);
      let ui = null;
      const start = () => {
        ui?.destroy();
        ui = mountBattle(el, {
          ctx,
          stage,
          team,
          resultActions: () => [
            { label: '다시 하기', primary: true, onClick: start },
            { label: '나가기', onClick: () => back() },
          ],
          onQuit: () => back(),
        });
      };
      start();
      return { destroy: () => ui?.destroy(), onKey: (e) => ui?.onKey(e) ?? false };
    },
  };
}
