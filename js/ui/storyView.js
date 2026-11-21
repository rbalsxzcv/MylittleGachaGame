// 스토리 뷰어 (가로 비주얼노벨 형식)
// 아래 대화창, 좌/우 캐릭터 그림, 탭하면 다음, 자동 진행, 건너뛰기, 대사 기록, 선택지
// 전투 장면 { type: "battle", stageId }: 이겨야 다음으로 진행 (전에 깬 스테이지는 건너뛰기 가능)
import { h, gemIcon } from './dom.js';
import { back } from './router.js';
import { openModal, confirmModal } from './modal.js';
import { charArt } from './charCard.js';
import { loadStory } from '../core/data.js';
import { completeStory, isRead } from '../systems/stories.js';
import { mountBattle } from './battleView.js';
import { openTeamEditor } from './teamView.js';
import { teamMembers, teamPower, presetOf } from '../systems/teams.js';
import { isCleared, stageRecord, recordClear } from '../systems/stageProgress.js';
import { rewardText as rewardLine } from '../systems/economy.js';

const num = (n) => Number(n).toLocaleString('ko-KR');

const TYPE_SPEED_MS = 28; // 글자 하나 나오는 간격
const AUTO_BASE_MS = 1100; // 자동 진행: 기본 대기
const AUTO_PER_CHAR_MS = 45; // 자동 진행: 글자 수에 비례한 추가 대기

export function storyScreen(ctx) {
  return {
    hud: 'none',
    transient: true,
    mount(el, { id }) {
      // 목록에 없는 스토리(미리보기 등)도 볼 수 있게 기본 정보 생성
      const meta = ctx.data.storyIndex.find((s) => s.id === id) || { id, title: id, reward: { gems: 0 }, unlock: [], kind: 'main', chapter: 1 };
      const alreadyRead = isRead(ctx.save, id);

      // ── 화면 구성 ──
      const bgColor = h('div', { class: 'vn-bg' });
      const bgImg = h('img', { class: 'vn-bg-img', alt: '', draggable: 'false', hidden: true });
      bgImg.addEventListener('error', () => (bgImg.hidden = true));
      const slots = { left: h('div', { class: 'vn-slot left' }), right: h('div', { class: 'vn-slot right' }) };
      const nameTag = h('div', { class: 'vn-name', hidden: true });
      const textEl = h('div', { class: 'vn-text' });
      const nextMark = h('div', { class: 'vn-next', hidden: true }, '▼');
      const box = h('div', { class: 'vn-box' }, nameTag, textEl, nextMark);
      const choicesEl = h('div', { class: 'vn-choices', hidden: true });
      const hit = h('div', { class: 'vn-hit', onclick: () => advance() });

      const toolBtn = (label, key, onclick, extra = {}) =>
        h('button', { class: 'vn-tool', type: 'button', onmousedown: (e) => e.preventDefault(), onclick, ...extra }, label, key && h('kbd', { class: 'key-hint' }, key));
      const autoBtn = toolBtn('AUTO', 'A', () => toggleAuto());
      const toolbar = h(
        'div',
        { class: 'vn-toolbar' },
        autoBtn,
        toolBtn('LOG', 'L', () => showLog()),
        toolBtn('SKIP', 'S', () => askSkip()),
        toolBtn('✕', null, () => askExit(), { 'aria-label': '나가기 (Esc)' }),
      );
      const titleEl = h('div', { class: 'vn-title' }, meta.title);
      const loading = h('div', { class: 'vn-loading' }, '불러오는 중…');

      el.append(bgColor, bgImg, slots.left, slots.right, hit, box, choicesEl, titleEl, toolbar, loading);

      // ── 상태 ──
      let story = null;
      let sceneIndex = 0;
      let lineIndex = -1;
      let typing = false;
      let typeTimer = null;
      let autoTimer = null;
      let auto = false;
      let finished = false;
      let destroyed = false;
      let onStage = { left: null, right: null }; // 각 자리에 선 캐릭터 id
      let lastSide = null;
      let nodeEl = null; // 전투 전 안내 패널
      let battleUi = null; // 진행 중인 전투 화면
      const log = [];

      loadStory(id).then((r) => {
        if (destroyed) return;
        if (!r.ok) {
          loading.textContent = `스토리를 불러오지 못했어요 (${r.error})`;
          loading.append(h('button', { class: 'btn', type: 'button', onclick: () => back() }, '돌아가기'));
          return;
        }
        story = r.data;
        loading.remove();
        gotoScene(0);
      });

      const scene = () => story.scenes[sceneIndex];

      function setBackground(bg) {
        if (bg.type === 'image') {
          bgImg.hidden = false;
          bgImg.src = bg.value;
          bgColor.style.background = bg.color || '#000'; // 그림이 없으면 이 색이 보임
        } else {
          bgImg.hidden = true;
          bgColor.style.background = bg.value;
        }
      }

      function gotoScene(target, startLine = 0) {
        const idx = typeof target === 'number' ? target : story.scenes.findIndex((s) => s.id === target);
        if (idx < 0 || idx >= story.scenes.length) return finish();
        sceneIndex = idx;
        lineIndex = startLine - 1;
        onStage = { left: null, right: null };
        lastSide = null;
        renderStage(null);
        setBackground(scene().background);
        if (scene().type === 'battle') return showBattleNode(scene());
        nextLine();
      }

      // ── 전투 장면 ──
      const stageOf = (sc) => (sc.stageId && ctx.data.stageMap.get(sc.stageId)) || null;
      /** 건너뛰어도 되는 전투인지 (전에 깼거나, 스테이지 정보가 없음) */
      const battlePassable = (sc) => !stageOf(sc) || isCleared(ctx.save, sc.stageId);

      function showBattleNode(sc) {
        clearTimeout(autoTimer);
        clearInterval(typeTimer);
        typing = false;
        box.hidden = true;
        choicesEl.hidden = true;
        const stage = stageOf(sc);
        const panel = h('div', { class: 'vn-battle-node' });
        nodeEl = panel;
        el.append(panel);
        log.push({ name: '전투', text: stage?.name || '전투', choice: true });

        const render = () => {
          if (!stage) {
            panel.replaceChildren(
              h('div', { class: 'vbn-kicker' }, '전투'),
              h('p', {}, `전투 정보를 찾을 수 없어요 (${sc.stageId || 'stageId 없음'})`),
              h('div', { class: 'vbn-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => leaveNode(true) }, '계속')),
            );
            return;
          }
          const members = teamMembers(ctx);
          const size = members.filter(Boolean).length;
          const hasAny = ctx.data.characters.some((c) => ctx.save.owned[c.id]);
          const power = teamPower(ctx);
          const rec = stageRecord(ctx.save, stage.id);
          const low = stage.recommendedPower && power < stage.recommendedPower;
          // replaceChildren은 false를 글자로 넣으므로 h()로 한 번 감쌈
          panel.replaceChildren(
            ...h(
              'div',
              {},
            h('div', { class: 'vbn-kicker' }, rec.clears ? `전투 · 클리어 ${rec.clears}회` : '전투'),
            h('div', { class: 'vbn-title' }, stage.name),
            h(
              'div',
              { class: 'vbn-meta' },
              stage.recommendedPower > 0 && h('span', {}, `권장 전투력 ${num(stage.recommendedPower)}`),
              h('span', { class: low ? 'bad' : '' }, `「${presetOf(ctx.save).name}」 ${num(power)}`),
              h('span', {}, `웨이브 ${stage.waves.length}`),
              stage.turnLimit && h('span', {}, `${stage.turnLimit}라운드 제한`),
            ),
            h(
              'div',
              { class: 'vbn-team' },
              members.map((m, i) => h('span', { class: ['vbn-member', !m && 'is-empty'] }, `${i + 1}. ${m ? `${ctx.data.charMap.get(m.charId).name} Lv.${m.level}` : '—'}`)),
            ),
            !rec.firstClaimed && rewardLine(stage.firstClearRewards) && h('div', { class: 'vbn-reward' }, '첫 클리어 보상 ', h('b', {}, rewardLine(stage.firstClearRewards))),
            rewardLine(stage.rewards) && h('div', { class: 'vbn-reward muted' }, '클리어 보상 ', rewardLine(stage.rewards)),
            !hasAny && h('p', { class: 'bad' }, '동료가 없어요 — 뽑기에서 동료를 만나 주세요'),
            hasAny && !size && h('p', { class: 'bad' }, '편성이 비어 있어요. 편성 변경에서 캐릭터를 넣어 주세요'),
            h(
              'div',
              { class: 'vbn-actions' },
              h('button', { class: 'btn btn-primary', type: 'button', disabled: !size, onclick: () => startBattle(stage) }, '전투 시작', h('kbd', { class: 'key-hint' }, 'Enter')),
              h('button', { class: 'btn', type: 'button', disabled: !hasAny, onclick: async () => (await openTeamEditor(ctx), render()) }, '편성 변경'),
              rec.clears > 0 && h('button', { class: 'btn', type: 'button', onclick: () => leaveNode(true) }, '건너뛰기'),
              h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => askExit() }, '나가기'),
            ),
            ).childNodes,
          );
        };
        panel.render = render;
        render();
      }

      function startBattle(stage) {
        nodeEl.hidden = true;
        const host = h('div', { class: 'vn-battle-layer' });
        el.append(host);
        const close = () => {
          battleUi?.destroy();
          battleUi = null;
          host.remove();
        };
        const backToNode = () => {
          close();
          nodeEl.hidden = false;
          nodeEl.render();
        };
        battleUi = mountBattle(host, {
          ctx,
          stage,
          team: teamMembers(ctx),
          onResult(summary) {
            if (summary.result !== 'win') return null;
            const r = recordClear(ctx.save, stage, summary.rounds);
            ctx.commit();
            return r;
          },
          resultActions: (result) =>
            result === 'win'
              ? [{ label: '스토리 계속', primary: true, onClick: () => (close(), leaveNode(true)) }]
              : [
                  { label: '다시 도전', primary: true, onClick: () => (close(), startBattle(stage)) },
                  { label: '편성 바꾸기', onClick: backToNode },
                  { label: '스토리 나가기', onClick: () => (close(), back()) },
                ],
          onQuit: backToNode,
        });
      }

      /** 전투 장면을 마치고 (continueStory면) 다음 장면으로 */
      function leaveNode(continueStory) {
        nodeEl?.remove();
        nodeEl = null;
        box.hidden = false;
        if (continueStory) endOfScene();
      }

      function endOfScene() {
        const next = scene().next;
        if (next === 'end') return finish();
        if (next) return gotoScene(next);
        gotoScene(sceneIndex + 1);
      }

      /** 화자를 어느 쪽에 세울지 결정 */
      function placeSpeaker(line) {
        const sp = line.speaker;
        if (sp === 'narrator') return null;
        if (line.side) {
          const other = line.side === 'left' ? 'right' : 'left';
          if (onStage[other] === sp) onStage[other] = null;
          onStage[line.side] = sp;
          return line.side;
        }
        if (onStage.left === sp) return 'left';
        if (onStage.right === sp) return 'right';
        const side = !onStage.left ? 'left' : !onStage.right ? 'right' : lastSide === 'left' ? 'right' : 'left';
        onStage[side] = sp;
        return side;
      }

      function renderStage(activeSide) {
        for (const side of ['left', 'right']) {
          const cid = onStage[side];
          const slot = slots[side];
          if (slot.dataset.cid !== (cid || '')) {
            slot.dataset.cid = cid || '';
            const char = cid && ctx.data.allCharMap.get(cid);
            slot.replaceChildren(char ? charArt(char) : '');
            slot.className = `vn-slot ${side} ${char ? `rar-${char.rarity}` : ''}`;
          }
          slot.classList.toggle('is-active', side === activeSide);
          slot.classList.toggle('is-dim', !!cid && side !== activeSide);
        }
      }

      function nextLine() {
        clearTimeout(autoTimer);
        if (nodeEl || battleUi) return;
        lineIndex += 1;
        const line = scene().lines[lineIndex];
        if (!line) return endOfScene();

        const side = placeSpeaker(line);
        if (side) lastSide = side;
        renderStage(side);

        const char = ctx.data.allCharMap.get(line.speaker);
        const name = line.name || (line.speaker === 'narrator' ? '' : char?.name || line.speaker);
        nameTag.hidden = !name;
        nameTag.textContent = name;
        box.classList.toggle('is-narration', line.speaker === 'narrator');
        log.push({ name, text: line.text });
        typeText(line.text);
      }

      function typeText(text) {
        clearInterval(typeTimer);
        typing = true;
        nextMark.hidden = true;
        let i = 0;
        textEl.textContent = '';
        typeTimer = setInterval(() => {
          i += 1;
          textEl.textContent = text.slice(0, i);
          if (i >= text.length) doneTyping();
        }, TYPE_SPEED_MS);
      }

      function doneTyping() {
        clearInterval(typeTimer);
        typing = false;
        const line = scene().lines[lineIndex];
        textEl.textContent = line.text;
        if (line.choices.length) return showChoices(line.choices);
        nextMark.hidden = false;
        if (auto) autoTimer = setTimeout(nextLine, AUTO_BASE_MS + line.text.length * AUTO_PER_CHAR_MS);
      }

      function showChoices(choices) {
        choicesEl.hidden = false;
        choicesEl.replaceChildren(
          ...choices.map((c, i) =>
            h('button', { class: 'vn-choice', type: 'button', onclick: () => choose(c) }, h('kbd', { class: 'key-hint' }, String(i + 1)), c.text),
          ),
        );
      }

      function choose(choice) {
        choicesEl.hidden = true;
        log.push({ name: '선택', text: choice.text, choice: true });
        if (choice.goto && story.scenes.some((s) => s.id === choice.goto)) gotoScene(choice.goto);
        else if (choice.goto === 'end') finish();
        else nextLine();
      }

      /** 탭/Space: 글자가 나오는 중이면 한 번에 보이고, 다 나왔으면 다음 줄 */
      function advance() {
        if (!story || finished || !choicesEl.hidden || nodeEl || battleUi) return;
        if (typing) doneTyping();
        else nextLine();
      }

      function toggleAuto() {
        auto = !auto;
        autoBtn.classList.toggle('on', auto);
        if (auto && story && !typing && choicesEl.hidden && !finished) autoTimer = setTimeout(nextLine, AUTO_BASE_MS);
        if (!auto) clearTimeout(autoTimer);
      }

      function showLog() {
        const body = h(
          'div',
          { class: 'vn-log' },
          log.length
            ? log.map((l) => h('div', { class: ['vn-log-line', l.choice && 'is-choice'] }, l.name && h('b', {}, l.choice ? '▶ ' : `${l.name}  `), l.text))
            : h('p', { class: 'muted' }, '아직 대사가 없어요'),
        );
        openModal({ title: '대사 기록', body, className: 'modal-wide', dismissValue: true });
        setTimeout(() => body.parentElement?.scrollTo?.(0, 1e6), 50);
      }

      /** 건너뛰기가 멈출 곳: 다음 선택지 또는 아직 깨지 않은 전투 (없으면 null → 끝까지) */
      function findSkipStop() {
        const scenes = story.scenes;
        const visited = new Set();
        let idx = sceneIndex;
        let fromLine = lineIndex + 1;
        while (idx >= 0 && idx < scenes.length && !visited.has(idx)) {
          visited.add(idx);
          const sc = scenes[idx];
          if (sc.type === 'battle') {
            if (!battlePassable(sc) && idx !== sceneIndex) return { type: 'battle', index: idx };
          } else {
            const li = sc.lines.findIndex((l, i) => i >= fromLine && l.choices.length);
            if (li >= 0) return { type: 'choice', index: idx, line: li };
          }
          fromLine = 0;
          if (sc.next === 'end') return null;
          idx = sc.next ? scenes.findIndex((x) => x.id === sc.next) : idx + 1;
        }
        return null;
      }

      async function askSkip() {
        if (!story || finished || nodeEl || battleUi) return;
        const stop = findSkipStop();
        const msg = stop ? `다음 ${stop.type === 'battle' ? '전투' : '선택지'}까지 건너뛸까요?` : '스토리 끝으로 건너뛸까요?\n끝까지 읽은 것으로 처리돼요.';
        const ok = await confirmModal('건너뛰기', msg, { okLabel: '건너뛰기' });
        if (!ok || finished) return;
        if (!stop) return finish();
        clearInterval(typeTimer);
        typing = false;
        gotoScene(stop.index, stop.type === 'choice' ? stop.line : 0);
      }

      async function askExit() {
        if (finished) return back();
        const ok = await confirmModal('나가기', '스토리를 그만 볼까요?\n처음부터 다시 봐야 해요.', { okLabel: '나가기' });
        if (ok) back();
      }

      function finish() {
        if (finished) return;
        finished = true;
        clearInterval(typeTimer);
        clearTimeout(autoTimer);
        choicesEl.hidden = true;
        const gems = completeStory(ctx.save, meta);
        ctx.commit();
        el.append(
          h(
            'div',
            { class: 'vn-end' },
            h('div', { class: 'vn-end-title' }, 'END'),
            h('div', { class: 'vn-end-sub' }, meta.title),
            gems > 0 && h('div', { class: 'vn-end-reward' }, '첫 읽기 보상 ', gemIcon(), `${gems}`),
            alreadyRead && h('div', { class: 'vn-end-sub muted' }, '다시 읽기'),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => back() }, '목록으로'),
          ),
        );
      }

      return {
        destroy() {
          destroyed = true;
          clearInterval(typeTimer);
          clearTimeout(autoTimer);
          battleUi?.destroy();
        },
        onKey(e) {
          if (battleUi) return battleUi.onKey(e);
          if (nodeEl) {
            if (e.code === 'Enter' || e.code === 'NumpadEnter') {
              nodeEl.querySelector('.btn-primary:not(:disabled)')?.click();
              return true;
            }
            if (e.code === 'Escape') return askExit(), true;
            return false;
          }
          if (finished) {
            if (['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) return back(), true;
            return false;
          }
          if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') return advance(), true;
          const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
          if (m && !choicesEl.hidden) {
            choicesEl.children[Number(m[1]) - 1]?.click();
            return true;
          }
          if (e.code === 'KeyA') return toggleAuto(), true;
          if (e.code === 'KeyL') return showLog(), true;
          if (e.code === 'KeyS') return askSkip(), true;
          if (e.code === 'Escape') return askExit(), true;
          return false;
        },
      };
    },
  };
}
