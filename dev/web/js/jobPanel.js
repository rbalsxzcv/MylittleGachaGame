// 생성 작업 검토 패널 (캐릭터 / 배너 그림 / 배경 그림 공용)
// - 원본 vs 결과(캐릭터는 배경 제거본을 체크무늬 + 어두운 배경 두 가지로)
// - 승인 / 거절(사유 → 프롬프트에 합쳐 다시 생성) / 다시 생성 / 배경 제거만 다시
// - 시도 기록 썸네일, 두 시도 나란히 비교
import { h, toast, modal, promptBox, busy } from './ui.js';
import { api, tryApi } from './api.js';
import { ENGINE_LABEL, negativeNote } from './promptStep.js';

const KIND_LABEL = { char: '캐릭터', banner: '배너 그림', bg: '배경 그림', ui: 'UI 에셋' };
const SOURCE_LABEL = { ai: 'Gemini가 쓴 프롬프트', mock: '모의 모드 프롬프트', template: '기본 틀 프롬프트', manual: '직접 수정한 프롬프트' };
const img = (job, name) => (name ? `/history/${job.id}/${name}` : '');

/**
 * @param {object} job 서버의 작업 객체
 * @param {object} opts
 * @param {(attemptN:number)=>Promise<any>} opts.onApprove 승인 버튼 동작 (false 반환 시 실패로 간주)
 * @param {string} [opts.approveLabel]
 * @param {HTMLElement} [opts.approveExtra] 승인 버튼 위에 넣을 추가 입력칸
 */
export function jobPanel(job, { onApprove, approveLabel = '승인', approveExtra = null }) {
  let current = job;
  let selected = job.attempts.at(-1)?.n ?? 1;
  const root = h('div', { class: 'job-panel' });

  function render() {
    const attempt = current.attempts.find((a) => a.n === selected) || current.attempts.at(-1);
    // 배경 제거가 들어간 결과(투명 PNG): 캐릭터, UI 아이콘/로고
    const isChar = (attempt?.result || '').endsWith('.png');
    root.replaceChildren(
      h(
        'div',
        { class: 'job-head' },
        h('b', {}, `${KIND_LABEL[current.kind]} 검토`),
        h('span', { class: 'muted' }, ` · 시도 ${current.attempts.length}회 · ${current.id}`),
        current.status === 'approved' && h('span', { class: 'chip ok' }, `승인됨 (시도 ${current.approved.attempt})`),
      ),
      // 시도 기록 썸네일
      h(
        'div',
        { class: 'attempt-strip' },
        current.attempts.map((a) =>
          h(
            'button',
            {
              class: ['attempt-thumb', a.n === attempt?.n && 'active', a.rejectReason && 'rejected', isChar && 'checker'],
              title: a.rejectReason ? `거절: ${a.rejectReason}` : `시도 ${a.n}`,
              onclick: () => ((selected = a.n), render()),
            },
            h('img', { src: img(current, a.result), alt: '' }),
            h('span', {}, `#${a.n}`),
          ),
        ),
        current.attempts.length > 1 && h('button', { class: 'btn small', onclick: compare }, '두 시도 비교'),
      ),
      attempt ? attemptView(attempt, isChar) : h('p', {}, '시도가 없어요'),
      attempt && actions(attempt, isChar),
    );
  }

  function attemptView(a, isChar) {
    return h(
      'div',
      {},
      h(
        'div',
        { class: ['compare-row', isChar ? 'three' : 'two'] },
        h('figure', {}, h('figcaption', {}, '원본'), h('img', { src: img(current, a.original), alt: '원본' })),
        isChar
          ? [
              h('figure', { class: 'checker' }, h('figcaption', {}, '배경 제거 (체크무늬)'), h('img', { src: img(current, a.result), alt: '결과' })),
              h('figure', { class: 'darkbg' }, h('figcaption', {}, '배경 제거 (어두운 배경)'), h('img', { src: img(current, a.result), alt: '결과' })),
            ]
          : h('figure', {}, h('figcaption', {}, '결과 (1280×720)'), h('img', { src: img(current, a.result), alt: '결과' })),
      ),
      h(
        'div',
        { class: 'attempt-meta' },
        a.engine && h('span', { class: 'chip' }, ENGINE_LABEL[a.engine] || a.engine),
        a.seed != null && h('span', { class: 'chip' }, `seed ${a.seed}`),
        a.promptSource && h('span', { class: 'chip' }, SOURCE_LABEL[a.promptSource] || a.promptSource),
        a.check && h('span', { class: 'chip error' }, `자동 검사: ${a.check}`),
        a.genWarning && h('span', { class: 'chip warn' }, a.genWarning),
        isChar && h('span', { class: ['chip', a.method === 'rmbg' ? 'ok' : 'warn'] }, a.method === 'rmbg' ? 'RMBG 배경 제거' : '간단 모드 배경 제거'),
        a.flatten && h('span', { class: 'chip' }, `배경 평탄화 ${a.flatten}`),
        a.results.length > 1 && h('span', { class: 'chip' }, `배경 제거 ${a.results.length}번째`),
        a.warning && h('span', { class: 'muted small' }, a.warning),
      ),
      a.rejectReason && h('p', { class: 'reject-note' }, `거절 사유: ${a.rejectReason}`),
      h(
        'details',
        { class: 'prompt' },
        h('summary', {}, '사용한 프롬프트 보기'),
        a.corePrompt && a.corePrompt !== a.prompt && [h('div', { class: 'muted small' }, SOURCE_LABEL[a.promptSource] || '핵심 프롬프트'), h('pre', {}, a.corePrompt), h('div', { class: 'muted small' }, '실제로 보낸 내용 (공통 스타일 포함)')],
        h('pre', {}, a.prompt),
      ),
    );
  }

  function actions(a, isChar) {
    const flatten = h('input', { type: 'checkbox' });
    const color = h('input', { type: 'color', value: '#ffffff' });
    return h(
      'div',
      { class: 'job-actions' },
      approveExtra,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => approve(a.n) }, `${approveLabel} (시도 #${a.n})`),
        h('button', { class: 'btn danger-outline', onclick: () => reject(a.n) }, '거절 + 사유 → AI가 프롬프트 고쳐서 다시 생성'),
        h('button', { class: 'btn', onclick: regenerate }, '같은 프롬프트로 다시 뽑기'),
        h('button', { class: 'btn', onclick: () => editAndRegenerate(a) }, '프롬프트 직접 고쳐서 다시 생성'),
      ),
      isChar &&
        h(
          'div',
          { class: 'row wrap recut' },
          h('button', { class: 'btn', onclick: () => recut(a.n, flatten.checked ? color.value : null) }, '배경 제거만 다시 하기'),
          h('label', { class: 'inline' }, flatten, '먼저 배경을 단색으로 칠하기'),
          color,
          h('span', { class: 'muted small' }, '(같은 원본 사용 · 배경이 얼룩덜룩할 때 도움)'),
        ),
    );
  }

  async function approve(n) {
    await busy('승인 처리 중…', async () => {
      const r = await onApprove(n);
      if (r !== false) {
        const fresh = await tryApi(() => api.get(`/api/jobs/${current.id}`));
        if (fresh) update(fresh);
      }
    });
  }

  async function reject(n) {
    const reason = await promptBox('거절하고 다시 생성', '무엇이 문제인가요? (다음 생성 프롬프트에 그대로 들어가요)', {
      placeholder: '예: 손가락이 6개예요 / 머리색을 더 밝은 분홍으로 / 정면을 보게 해 주세요',
    });
    if (!reason) return;
    const job = await busy('Gemini가 거절 사유를 반영해 프롬프트를 고치고 다시 그리는 중…', () => tryApi(() => api.post(`/api/jobs/${current.id}/reject`, { attempt: n, reason })));
    if (job) {
      selected = job.attempts.at(-1).n;
      update(job);
    }
  }

  async function regenerate() {
    const job = await busy('같은 프롬프트로 다시 그리는 중…', () => tryApi(() => api.post(`/api/jobs/${current.id}/regenerate`)));
    if (job) {
      selected = job.attempts.at(-1).n;
      update(job);
    }
  }

  async function editAndRegenerate(a) {
    const prompt = h('textarea', { rows: 8 }, a.corePrompt || a.prompt);
    const negative = h('textarea', { rows: 2 }, a.negative || '');
    const negWrap = h('label', { class: 'field' }, `네거티브${negativeNote()}`, negative);
    const ok = await modal({
      title: '프롬프트 고쳐서 다시 생성',
      wide: true,
      body: h('div', {}, h('label', { class: 'field' }, '프롬프트 (품질 태그와 공통 스타일은 자동으로 붙어요)', prompt), negWrap),
      buttons: [
        { label: '취소', value: null },
        { label: '이 프롬프트로 생성', value: 'go', primary: true },
      ],
    });
    if (ok !== 'go' || !prompt.value.trim()) return;
    const job = await busy('그리는 중…', () =>
      tryApi(() => api.post(`/api/jobs/${current.id}/regenerate`, { prompt: prompt.value, negative: negative.value, promptSource: 'manual' })),
    );
    if (job) {
      selected = job.attempts.at(-1).n;
      update(job);
    }
  }

  async function recut(n, flattenColor) {
    const job = await busy('배경 제거 다시 하는 중…', () => tryApi(() => api.post(`/api/jobs/${current.id}/recut`, { attempt: n, flatten: flattenColor })));
    if (job) {
      toast('배경 제거를 다시 했어요');
      update(job);
    }
  }

  function compare() {
    const opts = current.attempts.map((a) => h('option', { value: a.n }, `시도 #${a.n}${a.rejectReason ? ' (거절)' : ''}`));
    const selA = h('select', {}, opts.map((o) => o.cloneNode(true)));
    const selB = h('select', {}, opts.map((o) => o.cloneNode(true)));
    selA.value = String(current.attempts.at(-2)?.n ?? 1);
    selB.value = String(current.attempts.at(-1).n);
    const view = h('div', { class: 'compare-row two' });
    const cls = current.kind === 'char' ? 'checker' : '';
    const draw = () => {
      const pick = (v) => current.attempts.find((a) => String(a.n) === v);
      view.replaceChildren(
        ...[pick(selA.value), pick(selB.value)].map((a) =>
          h('figure', { class: cls }, h('figcaption', {}, `#${a.n}${a.rejectReason ? ` — 거절: ${a.rejectReason}` : ''}`), h('img', { src: img(current, a.result) })),
        ),
      );
    };
    selA.onchange = draw;
    selB.onchange = draw;
    draw();
    modal({ title: '시도 비교', body: h('div', {}, h('div', { class: 'row' }, 'A ', selA, ' B ', selB), view), wide: true });
  }

  function update(job) {
    current = job;
    render();
  }

  render();
  return { el: root, update, get job() { return current; } };
}
