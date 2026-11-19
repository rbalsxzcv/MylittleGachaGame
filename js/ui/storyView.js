// 스토리 뷰어 (가로 비주얼노벨 형식)
// 아래 대화창, 좌/우 캐릭터 그림, 탭하면 다음, 자동 진행, 건너뛰기, 대사 기록, 선택지
import { h, gemIcon } from './dom.js';
import { back } from './router.js';
import { openModal, confirmModal } from './modal.js';
import { charArt } from './charCard.js';
import { loadStory } from '../core/data.js';
import { completeStory, isRead } from '../systems/stories.js';

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
          bgColor.style.background = '#000';
        } else {
          bgImg.hidden = true;
          bgColor.style.background = bg.value;
        }
      }

      function gotoScene(target) {
        const idx = typeof target === 'number' ? target : story.scenes.findIndex((s) => s.id === target);
        if (idx < 0 || idx >= story.scenes.length) return finish();
        sceneIndex = idx;
        lineIndex = -1;
        onStage = { left: null, right: null };
        lastSide = null;
        renderStage(null);
        setBackground(scene().background);
        nextLine();
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
        if (!story || finished || !choicesEl.hidden) return;
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

      async function askSkip() {
        if (!story || finished) return;
        const ok = await confirmModal('건너뛰기', '스토리 끝으로 건너뛸까요?\n끝까지 읽은 것으로 처리돼요.', { okLabel: '건너뛰기' });
        if (ok) finish();
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
        },
        onKey(e) {
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
