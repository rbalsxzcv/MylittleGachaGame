// 그림 생성 공통 단계: (Gemini가 Anima용 프롬프트 작성 → 개발자가 확인/수정) → ComfyUI로 생성
// 캐릭터 / 배너 / 스토리 배경 / UI 에셋 생성 화면에서 함께 씀
import { h, toast, busy } from './ui.js';
import { api, tryApi } from './api.js';
import { state } from './state.js';

export const ENGINE_LABEL = { vertex: 'Vertex AI (예전 기록)', comfy: 'ComfyUI' };
const SOURCE_LABEL = { ai: 'Gemini 작성', mock: '기본 태그 (Gemini 없음)', template: '기본 태그 (AI 작성 꺼짐)', manual: '직접 수정' };

/** CFG 1(Turbo 모델)이면 네거티브가 무시된다는 안내 */
export const negativeNote = () => ((state.settings?.comfy?.cfg ?? 2) <= 1 ? ' — 지금 CFG가 1이라 네거티브는 적용되지 않아요' : '');

/**
 * @param {object} opts
 * @param {'char'|'banner'|'bg'|'ui'|'enemy'|'prop'} opts.kind
 * @param {()=>object|null} opts.getInput 생성에 쓸 입력값 (검사 실패 시 null)
 * @param {(gen:{prompt?:string, negative?:string, promptSource?:string})=>Promise<any>} opts.generate
 * @param {string} [opts.generateLabel]
 */
export function promptStep({ kind, getInput, generate, generateLabel = '생성' }) {
  const promptBox = h('textarea', { rows: 6, placeholder: 'AI가 쓴 프롬프트가 여기 나와요. 고쳐도 되고, 직접 써도 돼요.\n예: 1girl, solo, ... / no humans, object focus, leather pouch, ...' });
  const negBox = h('textarea', { rows: 2, placeholder: '네거티브 (에셋 종류별 기본 + 설정의 기본 네거티브가 자동으로 더해져요)' });
  const negWrap = h('label', { class: 'field' }, `네거티브 프롬프트${negativeNote()}`, negBox);
  const source = h('span', { class: 'chip' });
  let written = null; // 마지막으로 AI가 쓴 값 (수정 여부 판단용)
  const editor = h('div', { class: 'prompt-editor', hidden: true }, h('div', { class: 'row between' }, h('b', {}, '그림 프롬프트'), source), promptBox, negWrap);

  async function write() {
    const input = getInput();
    if (!input) return;
    const r = await busy('Gemini가 Anima용 그림 프롬프트를 쓰는 중…', () => tryApi(() => api.post('/api/prompt/write', { kind, input })));
    if (!r) return;
    written = r;
    promptBox.value = r.prompt;
    negBox.value = r.negative || '';
    source.textContent = SOURCE_LABEL[r.source] || r.source;
    editor.hidden = false;
  }

  /** 직접 쓰기: AI 없이 빈 편집기를 열어 프롬프트를 처음부터 입력 */
  function manual() {
    if (editor.hidden) {
      written = null;
      promptBox.value = '';
      negBox.value = '';
    }
    source.textContent = SOURCE_LABEL.manual;
    editor.hidden = false;
    promptBox.focus();
  }

  async function run(useEditor) {
    const input = getInput();
    if (!input) return;
    const gen = {};
    if (useEditor) {
      if (!promptBox.value.trim()) return toast('프롬프트가 비어 있어요. 먼저 "AI로 프롬프트 쓰기"를 눌러 주세요', 'error');
      gen.prompt = promptBox.value;
      gen.negative = negBox.value;
      const edited = !written || written.prompt !== promptBox.value || (written.negative || '') !== negBox.value;
      gen.promptSource = edited ? 'manual' : written.source;
    }
    const msg = 'ComfyUI로 그리는 중… (PC 성능에 따라 수십 초~몇 분)';
    await busy(useEditor ? msg : `프롬프트 작성 + ${msg}`, () => generate(gen));
  }

  const el = h(
    'div',
    { class: 'prompt-step' },
    h('div', { class: 'row wrap' }, h('span', { class: 'chip' }, 'ComfyUI · Anima'), h('button', { class: 'btn', onclick: write }, 'AI로 프롬프트 쓰기'), h('button', { class: 'btn', onclick: manual }, '직접 쓰기'), h('button', { class: 'btn primary', onclick: () => (editor.hidden ? run(false) : run(true)) }, generateLabel)),
    h('p', { class: 'muted small' }, '"AI로 프롬프트 쓰기"는 AI가 쓴 프롬프트를 보고 고칠 수 있고, "직접 쓰기"는 처음부터 프롬프트를 입력해요(영어 태그 권장). 바로 생성하면 AI가 쓰고 곧바로 그려요.'),
    editor,
  );
  return { el, reset: () => ((editor.hidden = true), (written = null), (promptBox.value = '')) };
}
