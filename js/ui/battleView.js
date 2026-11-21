// 전투 화면 (정적 UI, 움직임 없음)
// 위: 적 / 아래: 아군 카드 (HP·기력 막대, 강화·약화 표시) / 오른쪽: 전투 기록 / 맨 위: 라운드·웨이브·AUTO·즉시 결과
// 수동: 행동(기본/스킬/궁극기) → 대상 고르기. AUTO는 0.4초마다 한 행동. 즉시 결과는 끝까지 한 번에.
import { h } from './dom.js';
import { confirmModal } from './modal.js';
import { charArt } from './charCard.js';
import { createBattle } from '../battle/engine.js';
import { eventText } from '../battle/log.js';
import { randomSeed } from '../core/rng.js';
import { rewardText as rewardLine } from '../systems/economy.js';

const AUTO_MS = 400;
const MAX_LOG = 400;
const ACTION_LABEL = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기' };
const ACTION_KEYS = { Digit1: 'basic', Digit2: 'skill', Digit3: 'ultimate', Numpad1: 'basic', Numpad2: 'skill', Numpad3: 'ultimate' };
const STAT_SHORT = { atk: '공격', def: '방어', critRate: '치확', critDmg: '치피', dmgDealt: '주피', dmgTaken: '받피' };
const num = (n) => Number(n).toLocaleString('ko-KR');

function enemyArt(u) {
  const fb = () => h('div', { class: 'enemy-fallback' }, h('span', {}, u.name.slice(0, 2)));
  if (!u.image) return fb();
  const img = h('img', { class: 'art-img', src: u.image, alt: u.name, draggable: 'false' });
  const wrap = h('div', { class: 'art' }, img);
  img.addEventListener('error', () => wrap.replaceChildren(fb()), { once: true });
  return wrap;
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {object} o.ctx
 * @param {object} o.stage
 * @param {Array} o.team teams.teamMembers 결과
 * @param {(summary)=>({rewards, first}|null)} [o.onResult] 끝났을 때 한 번 (보상 지급은 여기서)
 * @param {(result:string)=>Array<{label:string, primary?:boolean, onClick:()=>void}>} o.resultActions
 * @param {()=>void} o.onQuit 포기
 */
export function mountBattle(host, { ctx, stage, team, onResult, resultActions, onQuit }) {
  const seed = randomSeed();
  const battle = createBattle({ team, stage, data: ctx.data, seed });
  const s = battle.state;
  let selected = null; // 대상을 고르는 중인 행동
  let auto = false;
  let autoTimer = null;
  let finished = false;
  let logCount = 0;

  const nameOf = (uid) => battle.unit(uid)?.name ?? uid;

  const topBar = h('div', { class: 'battle-top' });
  const enemyRow = h('div', { class: 'battle-enemies' });
  const allyRow = h('div', { class: 'battle-allies' });
  const actionBar = h('div', { class: 'battle-actions' });
  const logList = h('ol', { class: 'battle-log-list' });
  const logBox = h('div', { class: 'battle-log' }, h('div', { class: 'battle-log-title' }, '전투 기록'), logList);
  const resultLayer = h('div', { class: 'battle-result-layer', hidden: true });
  const root = h('div', { class: 'battle' }, topBar, enemyRow, actionBar, allyRow, logBox, resultLayer);
  host.append(root);

  function appendLog() {
    const events = s.events;
    for (; logCount < events.length; logCount++) {
      const line = eventText(events[logCount], nameOf);
      if (line) logList.append(h('li', { class: `log-${line.kind}` }, line.text));
    }
    while (logList.children.length > MAX_LOG) logList.firstChild.remove();
    logBox.scrollTop = logBox.scrollHeight;
  }

  function statusChips(u) {
    const chips = [];
    if (u.shield) chips.push(h('span', { class: 'chip chip-buff' }, `보호막 ${num(u.shield.value)}`));
    for (const st of u.statuses) {
      const good = st.kind === 'buff';
      chips.push(h('span', { class: ['chip', good ? 'chip-buff' : 'chip-debuff'], title: `${STAT_SHORT[st.stat]} ${st.value > 0 ? '+' : ''}${st.value}% · ${st.turns}턴` }, `${STAT_SHORT[st.stat] || st.stat}${good ? '↑' : '↓'}${st.turns}`));
    }
    if (u.dots.length) chips.push(h('span', { class: 'chip chip-debuff', title: `턴마다 ${u.dots.reduce((a, d) => a + d.dmg, 0)} 피해` }, `지속${Math.max(...u.dots.map((d) => d.turns))}`));
    if (u.taunt) chips.push(h('span', { class: 'chip chip-buff' }, `도발${u.taunt.turns}`));
    return chips;
  }

  function unitCard(u, targetSet) {
    const isTarget = !!targetSet?.has(u.uid);
    const acting = s.pendingUid === u.uid;
    const char = u.side === 'ally' ? ctx.data.charMap.get(u.refId) : null;
    const hpPct = (u.hp / u.maxHp) * 100;
    const enPct = (u.energy / ctx.data.balance.energy.max) * 100;
    const ultReady = u.kit.ultimate && u.energy >= u.ultCost;
    return h(
      isTarget ? 'button' : 'div',
      {
        class: ['bunit', `side-${u.side}`, u.rarity && `rar-${u.rarity}`, !u.alive && 'is-dead', acting && 'is-acting', isTarget && 'is-target', u.boss && 'is-boss'],
        type: isTarget ? 'button' : null,
        onclick: isTarget ? () => act(selected, u.uid) : null,
        'aria-label': `${u.name} HP ${u.hp}/${u.maxHp}`,
      },
      h('div', { class: 'bunit-art' }, char ? charArt(char) : enemyArt(u)),
      h('div', { class: 'bunit-name' }, u.name, h('small', {}, ` Lv.${u.level}`)),
      h('div', { class: 'bar bar-hp' }, h('i', { style: { width: `${hpPct}%` } }), h('span', {}, `${num(u.hp)} / ${num(u.maxHp)}`)),
      u.kit.ultimate && h('div', { class: ['bar', 'bar-en', ultReady && 'is-ready'] }, h('i', { style: { width: `${enPct}%` } }), h('span', {}, ultReady ? '궁극기 준비' : `기력 ${u.energy}`)),
      h('div', { class: 'bunit-chips' }, statusChips(u), u.side === 'ally' && u.kit.skill && u.cd > 0 && u.alive && h('span', { class: 'chip' }, `스킬 대기 ${u.cd}`)),
      !u.alive && h('div', { class: 'bunit-dead' }, '쓰러짐'),
    );
  }

  function render() {
    const turnLabel = s.turnLimit ? `${s.round} / ${s.turnLimit}` : `${s.round}`;
    const current = battle.current();
    topBar.replaceChildren(
      h('div', { class: 'battle-stage' }, stage.name),
      h('div', { class: 'battle-meta' }, h('span', {}, `웨이브 ${s.wave + 1}/${s.waveCount}`), h('span', {}, `라운드 ${turnLabel}`)),
      h('div', { class: 'battle-turn' }, current ? `${current.name}의 차례` : s.result ? '전투 종료' : ''),
      h('div', { class: 'spacer' }),
      h('button', { class: ['btn', 'btn-small', auto && 'on'], type: 'button', disabled: finished, onclick: toggleAuto }, `AUTO ${auto ? 'ON' : 'OFF'}`, h('kbd', { class: 'key-hint' }, 'A')),
      h('button', { class: 'btn btn-small', type: 'button', disabled: finished, onclick: instant }, '즉시 결과', h('kbd', { class: 'key-hint' }, 'R')),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: quit }, '나가기'),
    );

    const targets = selected && current ? battle.targets(selected) : null;
    const targetSet = targets ? new Set(targets.uids) : null;
    enemyRow.replaceChildren(...s.enemies.map((u) => unitCard(u, targets?.pick === 'enemy' ? targetSet : null)));
    allyRow.replaceChildren(...s.allies.map((u) => unitCard(u, targets?.pick === 'ally' ? targetSet : null)));

    // 행동 버튼
    if (finished) actionBar.replaceChildren();
    else if (auto) actionBar.replaceChildren(h('div', { class: 'battle-hint' }, '자동 전투 중… (AUTO를 끄면 직접 조작)'));
    else if (current) {
      const opt = battle.options();
      const btn = (a, key) => {
        const o = opt[a];
        if (!o) return null;
        const sub = a === 'skill' ? (o.ok ? '사용 가능' : `대기 ${o.cd}턴`) : a === 'ultimate' ? `기력 ${o.energy}/${o.cost}` : '기력 +';
        return h(
          'button',
          { class: ['act-btn', `act-${a}`, selected === a && 'is-selected'], type: 'button', disabled: !o.ok, onclick: () => chooseAction(a) },
          h('span', { class: 'act-kind' }, ACTION_LABEL[a]),
          h('b', {}, o.name),
          h('small', {}, sub),
          h('kbd', { class: 'key-hint' }, key),
        );
      };
      actionBar.replaceChildren(
        ...[
          h('div', { class: 'battle-hint' }, selected ? `${ACTION_LABEL[selected]}: 대상을 고르세요 (Esc 취소)` : `${current.name}의 행동을 고르세요`),
          btn('basic', '1'),
          btn('skill', '2'),
          btn('ultimate', '3'),
        ].filter(Boolean),
      );
    } else actionBar.replaceChildren();
    appendLog();
  }

  function chooseAction(a) {
    if (finished || auto || !battle.current()) return;
    const opt = battle.options()[a];
    if (!opt?.ok) return;
    if (selected === a) {
      selected = null;
      return render();
    }
    const t = battle.targets(a);
    if (!t) return act(a, null);
    if (t.uids.length === 1) return act(a, t.uids[0]);
    selected = a;
    render();
  }

  function act(action, target) {
    if (finished || !battle.current()) return;
    selected = null;
    battle.act({ action, target });
    afterStep();
  }

  function afterStep() {
    if (s.result) finish();
    render();
  }

  function toggleAuto() {
    if (finished) return;
    auto = !auto;
    selected = null;
    clearInterval(autoTimer);
    if (auto) {
      autoTimer = setInterval(() => {
        if (s.result) return clearInterval(autoTimer);
        battle.auto();
        afterStep();
      }, AUTO_MS);
    }
    render();
  }

  function instant() {
    if (finished) return;
    clearInterval(autoTimer);
    auto = false;
    battle.runToEnd();
    afterStep();
  }

  async function quit() {
    if (finished) return onQuit();
    const wasAuto = auto;
    if (auto) toggleAuto();
    const ok = await confirmModal('전투 포기', '전투를 그만둘까요?\n보상은 받을 수 없어요.', { okLabel: '포기', danger: true });
    if (ok) {
      destroy();
      onQuit();
    } else if (wasAuto) toggleAuto();
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(autoTimer);
    auto = false;
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
        h('div', { class: 'muted' }, win ? `${s.round}라운드 만에 클리어` : s.reason === 'timeout' ? `턴 제한(${s.turnLimit || s.maxRounds}라운드)을 넘겼어요` : '아군이 모두 쓰러졌어요'),
        reward?.first && rewardLine(reward.first) && h('div', { class: 'result-reward first' }, '첫 클리어 보상 ', h('b', {}, rewardLine(reward.first))),
        reward?.rewards && rewardLine(reward.rewards) && h('div', { class: 'result-reward' }, '클리어 보상 ', h('b', {}, rewardLine(reward.rewards))),
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

  function destroy() {
    clearInterval(autoTimer);
    auto = false;
  }

  render();
  if (s.result) finish(), render();

  return {
    destroy() {
      destroy();
      root.remove();
    },
    onKey(e) {
      if (finished) {
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
          resultLayer.querySelector('.btn-primary')?.click();
          return true;
        }
        return false;
      }
      if (e.code === 'Escape') {
        if (selected) {
          selected = null;
          render();
        } else quit();
        return true;
      }
      if (e.code === 'KeyA') return toggleAuto(), true;
      if (e.code === 'KeyR') return instant(), true;
      if (selected) {
        // 대상 고르는 중: 숫자 = 고를 수 있는 대상 순서
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        const t = battle.targets(selected);
        if (m && t) {
          const uid = t.uids[Number(m[1]) - 1];
          if (uid) act(selected, uid);
          return true;
        }
      }
      if (ACTION_KEYS[e.code]) return chooseAction(ACTION_KEYS[e.code]), true;
      return false;
    },
  };
}
