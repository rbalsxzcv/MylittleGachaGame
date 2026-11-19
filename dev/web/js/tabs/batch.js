// 일괄 생성 탭: 그림이 필요한 항목(캐릭터 / 배너 / 화면 배경 / 로고·아이콘)을 골라 ComfyUI로 한 번에 뽑기
// - 진행 상황, 항목별 오류 표시, 중단 버튼
// - 결과는 바로 적용하거나, 하나씩 검토(거절·다시 뽑기 가능)한 뒤 적용
import { h, toast, modal, confirmBox, busy, wsImage } from '../ui.js';
import { api, tryApi } from '../api.js';
import { reloadData } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { onBatch, setBatch, refreshBatch } from '../batchWatch.js';

const STATUS = {
  pending: ['대기', ''],
  running: ['그리는 중…', 'warn'],
  done: ['완료', 'ok'],
  error: ['오류', 'error'],
  skipped: ['건너뜀', ''],
  cancelled: ['중단됨', ''],
};

export function batchTab(root) {
  let groups = [];
  let items = [];
  const picked = new Set();
  let batch = null;
  let loadedFor = null; // 대상 목록을 마지막으로 불러온 시점의 일괄 작업 id + 상태

  const autoApply = h('input', { type: 'checkbox' });
  const stopOnError = h('input', { type: 'checkbox', checked: true });
  const retryCheck = h('input', { type: 'checkbox', checked: true });
  const extra = h('input', { placeholder: '모든 항목에 공통으로 더할 요청 (선택, 한국어 OK) 예: 더 밝은 파스텔 톤' });
  const pickHost = h('div');
  const startBtn = h('button', { class: 'btn primary', onclick: start }, '일괄 생성 시작');
  const progressHost = h('div');

  root.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '일괄 생성 — 그림이 필요한 항목을 ComfyUI로 한 번에'),
      h('p', {}, '뽑을 항목을 고르고 시작하면 하나씩 차례로 그려요. 다른 탭으로 가도 계속 진행되고, 오류가 나면 알림으로 알려 줘요.'),
      h('p', { class: 'muted small' }, '항목마다 Gemini가 Anima용 프롬프트를 쓰고(에셋 종류별 규칙 적용) ComfyUI로 1장씩 그려요. 캐릭터를 먼저 그려서, 배너는 그 캐릭터의 외형 태그를 이어받아요.'),
      pickHost,
      h(
        'div',
        { class: 'card inner' },
        h('label', { class: 'field' }, '공통 추가 요청', extra),
        h('label', { class: 'inline' }, autoApply, ' 뽑은 그림을 바로 게임에 적용 (끄면 아래 목록에서 하나씩 검토한 뒤 적용)'),
        h('label', { class: 'inline' }, retryCheck, ' 캐릭터 자동 검사(같은 캐릭터 여러 번 · 여러 명 · 가로로 넓은 설정화)에 걸리면 새 seed로 다시 뽑기 (최대 2번)'),
        h('label', { class: 'inline' }, stopOnError, ' 오류가 나면 거기서 멈추기 (끄면 오류 항목은 건너뛰고 계속 · ComfyUI 연결 오류는 항상 멈춰요)'),
        h('div', { class: 'row wrap' }, startBtn),
      ),
    ),
    progressHost,
  );

  // ── 대상 고르기 ──
  function renderPicker() {
    const running = !!batch?.running;
    pickHost.replaceChildren(
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => select((i) => !i.has) }, '그림 없는 것만 고르기'),
        h('button', { class: 'btn small', onclick: () => select(() => true) }, '전부 고르기'),
        h('button', { class: 'btn small', onclick: () => select(() => false) }, '모두 해제'),
        h('span', { class: 'muted small' }, `그림 없음 ${items.filter((i) => !i.has).length}개 / 전체 ${items.length}개`),
      ),
      ...groups.map((g) => {
        const list = items.filter((i) => i.group === g.id);
        if (!list.length) return null;
        return h(
          'div',
          {},
          h(
            'h3',
            { class: 'row' },
            g.label,
            h('button', { class: 'btn small', onclick: () => select((i) => i.group === g.id && !i.has, g.id) }, '그림 없는 것'),
            h('button', { class: 'btn small', onclick: () => select((i) => i.group === g.id, g.id) }, '전부'),
            h('button', { class: 'btn small', onclick: () => select(() => false, g.id) }, '해제'),
          ),
          h(
            'div',
            { class: 'pick-grid batch-picks' },
            list.map((i) => {
              const cb = h('input', { type: 'checkbox', checked: picked.has(i.key), disabled: running, onchange: (e) => (e.target.checked ? picked.add(i.key) : picked.delete(i.key), syncStart()) });
              const png = i.group === 'char' || i.group === 'ui_icon';
              return h(
                'label',
                { class: 'pick', title: i.path || '그림 없음' },
                cb,
                h('div', { class: ['thumb', png && 'checker'] }, i.has ? h('img', { src: wsImage(i.path), alt: '', onerror: (e) => e.target.remove() }) : h('span', {}, '없음')),
                h('span', {}, i.label),
                i.has ? h('span', { class: 'chip ok' }, '있음 → 다시 뽑기') : h('span', { class: 'chip warn' }, '그림 필요'),
              );
            }),
          ),
        );
      }),
    );
    syncStart();
  }

  function select(test, group = null) {
    for (const i of items) {
      if (group && i.group !== group) continue;
      if (test(i)) picked.add(i.key);
      else picked.delete(i.key);
    }
    renderPicker();
  }

  function syncStart() {
    const running = !!batch?.running;
    startBtn.disabled = running || picked.size === 0;
    startBtn.textContent = running ? '진행 중…' : `${picked.size}개 일괄 생성 시작`;
  }

  async function loadTargets(first = false) {
    const r = await tryApi(() => api.get('/api/batch/targets'));
    if (!r) return;
    groups = r.groups;
    items = r.items;
    const keys = new Set(items.map((i) => i.key));
    for (const k of [...picked]) if (!keys.has(k)) picked.delete(k);
    if (first) items.filter((i) => !i.has).forEach((i) => picked.add(i.key));
    renderPicker();
  }

  // ── 시작 / 중단 ──
  async function start() {
    const keys = items.filter((i) => picked.has(i.key)).map((i) => i.key);
    if (!keys.length) return;
    const redo = items.filter((i) => picked.has(i.key) && i.has).length;
    const msg = `${keys.length}개 항목을 ComfyUI로 뽑을게요.${redo ? `\n이미 그림이 있는 ${redo}개도 포함돼요${autoApply.checked ? ' (바로 적용하면 기존 그림이 바뀌어요)' : ''}.` : ''}\n${autoApply.checked ? '뽑은 그림은 바로 작업 공간에 적용돼요.' : '뽑은 뒤 목록에서 검토하고 적용해요.'}`;
    if (!(await confirmBox('일괄 생성 시작', msg, { ok: '시작' }))) return;
    const r = await tryApi(() => api.post('/api/batch/start', { keys, autoApply: autoApply.checked, stopOnError: stopOnError.checked, retryCheck: retryCheck.checked, extra: extra.value }));
    if (r) {
      toast('일괄 생성을 시작했어요');
      setBatch(r.batch);
    }
  }

  async function cancel() {
    if (!(await confirmBox('일괄 생성 중단', '지금 그리는 항목을 멈추고 남은 항목은 뽑지 않아요. 이미 끝난 결과는 그대로 남아요.', { ok: '중단', danger: true }))) return;
    const r = await tryApi(() => api.post('/api/batch/cancel'));
    if (r) setBatch(r.batch);
  }

  // ── 결과 적용 / 검토 ──
  async function apply(item, n) {
    const r = await tryApi(() => api.post('/api/batch/apply', { jobId: item.jobId, attempt: n }));
    if (!r) return false;
    await reloadData();
    return r.path;
  }

  async function applyAll() {
    const todo = batch.items.filter((i) => i.status === 'done' && !i.applied && !i.check);
    if (!todo.length) return;
    if (!(await confirmBox('모두 적용', `검토하지 않은 결과 ${todo.length}개를 모두 게임 작업 공간에 적용할까요? (자동 검사에 걸린 항목은 빼고, 직접 검토해서 적용해요)`, { ok: '모두 적용' }))) return;
    let ok = 0;
    await busy('적용하는 중…', async () => {
      for (const i of todo) if (await apply(i, i.attempt)) ok += 1;
    });
    toast(`${ok}개 적용했어요. 배포 탭에서 배포하면 실제 게임에 반영돼요`, 'success');
    await refreshBatch();
    loadTargets();
  }

  async function review(item) {
    const job = await tryApi(() => api.get(`/api/jobs/${item.jobId}`));
    if (!job) return;
    const panel = jobPanel(job, {
      approveLabel: '통과 → 게임에 적용',
      onApprove: async (n) => {
        const path = await apply(item, n);
        if (!path) return false;
        toast(`「${item.label}」 적용 완료 (${path})`, 'success');
        refreshBatch();
        loadTargets();
        return true;
      },
    });
    modal({ title: `검토 — ${item.label}`, wide: true, body: panel.el });
  }

  // ── 진행 상황 ──
  function renderProgress() {
    if (!batch) {
      progressHost.replaceChildren();
      return;
    }
    const total = batch.items.length;
    const c = batch.counts || {};
    const finished = (c.done || 0) + (c.error || 0) + (c.skipped || 0) + (c.cancelled || 0);
    const current = batch.items.find((i) => i.status === 'running');
    const unapplied = batch.items.filter((i) => i.status === 'done' && !i.applied && !i.check).length;
    const stopText = { cancelled: '중단했어요', connect: 'ComfyUI 연결 오류로 멈췄어요 — ComfyUI가 켜져 있는지 확인해 주세요', error: '오류가 나서 멈췄어요 — 아래 오류를 확인해 주세요' }[batch.stopReason];
    const errors = batch.items.filter((i) => i.status === 'error');
    progressHost.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'row between' },
          h('h2', {}, batch.running ? `진행 중 ${finished}/${total}` : `지난 일괄 생성 ${finished}/${total}`),
          h(
            'div',
            { class: 'row' },
            batch.running && h('button', { class: 'btn danger', disabled: batch.cancelRequested, onclick: cancel }, batch.cancelRequested ? '중단하는 중…' : '중단'),
            !batch.running && unapplied > 0 && h('button', { class: 'btn primary', onclick: applyAll }, `적용 안 한 결과 ${unapplied}개 모두 적용`),
          ),
        ),
        h('div', { class: 'progress' }, h('i', { style: { width: `${total ? (finished / total) * 100 : 0}%` } })),
        h(
          'p',
          { class: 'muted small' },
          `완료 ${c.done || 0} · 오류 ${c.error || 0} · 대기 ${c.pending || 0}${c.skipped ? ` · 건너뜀 ${c.skipped}` : ''}${c.cancelled ? ` · 중단 ${c.cancelled}` : ''}`,
          current ? ` · 지금: ${current.label}` : '',
          batch.options?.autoApply ? ' · 바로 적용' : ' · 검토 후 적용',
        ),
        stopText && h('p', { class: batch.stopReason === 'cancelled' ? 'muted' : 'error' }, stopText),
        errors.length > 0 && h('div', { class: 'batch-errors' }, h('b', {}, `오류 ${errors.length}개`), errors.map((i) => h('div', { class: 'error small' }, `• ${i.label}: ${i.error}`))),
        h(
          'div',
          { class: 'batch-list' },
          batch.items.map((i) => {
            const [label, cls] = STATUS[i.status] || [i.status, ''];
            const png = i.group === 'char' || i.group === 'ui_icon';
            return h(
              'div',
              { class: ['batch-item', i.status] },
              h('div', { class: ['thumb', png && 'checker'] }, i.thumb ? h('img', { src: i.thumb, alt: '' }) : h('span', {}, i.status === 'running' ? '…' : '')),
              h(
                'div',
                { class: 'grow' },
                h('b', {}, i.label),
                h('div', { class: 'row wrap' }, h('span', { class: ['chip', cls] }, label), i.applied && h('span', { class: 'chip ok' }, `적용됨 · ${i.applied}`), i.warning && h('span', { class: 'muted small' }, i.warning)),
                i.check && h('div', { class: 'error small' }, `자동 검사: ${i.check}`),
                i.retries > 0 && h('div', { class: 'muted small' }, `자동 검사로 ${i.retries}번 다시 뽑았어요`),
                i.error && h('div', { class: 'error small' }, i.error),
              ),
              i.jobId && i.status === 'done' && h('button', { class: 'btn small', onclick: () => review(i) }, i.applied ? '다시 검토' : '검토 · 적용'),
            );
          }),
        ),
      ),
    );
  }

  const off = onBatch((b) => {
    const prevRunning = batch?.running;
    batch = b;
    renderProgress();
    syncStart();
    // 일괄 작업이 끝나면 '그림 있음' 표시를 새로 고침
    const tag = b ? `${b.id}:${b.running}` : null;
    if (prevRunning && !b?.running && loadedFor !== tag) {
      loadedFor = tag;
      loadTargets();
      reloadData();
    } else if (prevRunning !== b?.running) renderPicker();
  });

  loadTargets(true);
  refreshBatch();
  return { refresh: loadTargets, destroy: off };
}
