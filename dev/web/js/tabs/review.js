// 검수 탭 (CHARACTER_PROFILE.md 8-2 · 8-3장): 기존 스토리를 순서대로 문체 지침 + 말투 카드로 검수
// 장마다 원본 ↔ 검수본 나란히(바뀐 줄 강조) + 문제 목록 → 승인 / 다시 검수(수정 요청) / 원본 유지. 전후 비교표(규칙별 문제 수)
// 서버 dev/tinydev/review.py. 진행 중에는 2초마다 상태를 다시 읽음
import { h, toast, busy, confirmBox, promptBox } from '../ui.js';
import { api, tryApi } from '../api.js';
import { reloadData } from '../state.js';
import { modelPicker } from '../modelPicker.js';

const STATUS = { none: '안 함', pending: '검토 대기', approved: '승인 ✓', kept: '원본 유지', error: '오류' };
const KIND = { main: '메인', character: '캐릭터', event: '이벤트' };
const RULES = ['기타', 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 두 줄 목록의 LCS → 각 줄이 같은 줄과 짝지어졌는지 */
function diffFlags(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Array(n).fill(false);
  const keepB = new Array(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { keepA, keepB };
}

export function reviewTab(root) {
  const left = h('div', { class: 'col-left' });
  const right = h('div', { class: 'col-right' });
  root.replaceChildren(h('div', { class: 'two-col' }, left, right));
  const scope = h('select', {}, [['main', '메인 스토리'], ['character', '캐릭터 스토리'], ['event', '이벤트 스토리'], ['all', '전체 (메인 → 캐릭터 → 이벤트)']].map(([v, l]) => h('option', { value: v }, l)));
  const model = modelPicker('review');
  const head = h('div');
  const list = h('div', { class: 'rv-list' });
  const table = h('div');
  let snap = null;
  let selected = null;
  let timer = null;

  async function load() {
    const s = await tryApi(() => api.get('/api/review'));
    if (s) render(s);
    return s;
  }
  function poll(on) {
    clearInterval(timer);
    timer = on
      ? setInterval(async () => {
          if (!root.isConnected) return clearInterval(timer);
          const s = await load();
          if (s && !s.run.running) {
            poll(false);
            if (selected) openItem(selected);
          }
        }, 2000)
      : null;
  }

  async function start(mode) {
    const label = mode === 'check' ? '전후 비교 검사 (승인한 장의 원본 · 지금 대본을 체크 전용으로 다시 검사)' : '아직 검수하지 않은 장 · 오류 · 다시 필요한 장을 순서대로 검수';
    if (!(await confirmBox(mode === 'check' ? '전후 비교' : '검수 시작', `${label}\n범위: ${scope.selectedOptions[0].textContent}\n한 장씩 차례로 돌아요 (앞 장의 검수본이 다음 장의 '직전 장 대본'이 돼요).`, { ok: '시작' }))) return;
    const s = await tryApi(() => api.post('/api/review/start', { scope: scope.value, model: model.value, mode }));
    if (s) {
      render(s);
      poll(true);
    }
  }

  function render(s) {
    snap = s;
    const r = s.run;
    const mains = s.items.filter((i) => i.kind === 'main');
    head.replaceChildren(
      h('p', {}, h('b', {}, `메인 ${mains.length}장 중 ${mains.filter((i) => i.status === 'approved').length}장 승인`), ` · 원본 유지 ${mains.filter((i) => i.status === 'kept').length} · 전체 ${s.total}장 중 끝남 ${s.done}`),
      h(
        'div',
        { class: 'row wrap' },
        scope,
        model.el,
        h('button', { class: 'btn primary small', disabled: r.running, onclick: () => start('review') }, r.running && r.mode === 'review' ? '검수 중…' : '검수 시작 / 이어서'),
        h('button', { class: 'btn small', disabled: r.running, onclick: () => start('check') }, r.running && r.mode === 'check' ? '비교 중…' : '전후 비교 검사'),
        r.running && h('button', { class: 'btn small', onclick: async () => (await tryApi(() => api.post('/api/review/cancel'))) && load() }, r.cancelRequested ? '멈추는 중…' : '멈추기'),
      ),
      r.running && h('p', { class: 'muted small' }, `진행 중: ${r.current || '…'} · 남은 장 ${r.remaining}`),
      r.error && h('p', { class: 'error small' }, r.error),
    );
    list.replaceChildren(
      ...s.items.map((i) =>
        h(
          'button',
          { class: ['rv-item', `is-${i.status}`, i.id === selected && 'active'], onclick: () => openItem(i.id) },
          h('span', { class: 'muted small' }, `${KIND[i.kind] || i.kind} ${i.chapter ?? ''}`),
          h('b', {}, ` ${i.title}`),
          h('span', { class: ['chip', i.status === 'approved' ? 'ok' : i.status === 'error' || i.stale ? 'warn' : ''] }, i.stale ? '다시 필요' : STATUS[i.status] || i.status),
          i.reportCount != null && i.status === 'pending' && h('span', { class: 'muted small' }, ` 문제 ${i.reportCount}`),
        ),
      ),
    );
    renderTable(s);
  }

  function renderTable(s) {
    const t = s.totals;
    const has = Object.keys(t.before).length || Object.keys(t.after).length;
    const counted = s.items.filter((i) => i.counts).length;
    table.replaceChildren(
      h('h3', {}, '검수 전 / 후 (규칙별 문제 수)'),
      !has
        ? h('p', { class: 'muted small' }, "승인한 장이 생기면 '전후 비교 검사'로 같은 검수 프롬프트를 원본과 지금 대본에 각각 돌려서 세요.")
        : h(
            'table',
            { class: 'rv-table' },
            h('tr', {}, h('th', {}, '체크리스트'), h('th', {}, '검수 전'), h('th', {}, '검수 후')),
            RULES.map((rule) => {
              const k = rule === '기타' ? '0' : String(rule);
              const b = t.before[k] || 0;
              const a = t.after[k] || 0;
              return b || a ? h('tr', {}, h('td', {}, rule === '기타' ? '번호 없음' : `${rule}번`), h('td', {}, b), h('td', { class: a < b ? 'ok-text' : a > b ? 'error' : '' }, a)) : null;
            }),
          ),
      has && h('p', { class: 'muted small' }, `비교한 장 ${counted}개 기준. 규칙 번호는 문체 지침의 퇴고 체크리스트 번호예요.`),
    );
  }

  /** 대본 한 장면 → 비교용 줄 문자열 */
  const lineText = (ln, names) => `${ln.speaker === 'narrator' ? ln.name || '지문' : names[ln.speaker] || ln.speaker}: ${ln.text}${ln.choices?.length ? `  ▶ ${ln.choices.map((c) => `${c.text} → ${c.goto}`).join(' / ')}` : ''}`;

  async function openItem(sid) {
    selected = sid;
    if (snap) render(snap);
    const d = await tryApi(() => api.get(`/api/review/${sid}`));
    if (!d) return;
    const res = d.result;
    const e = d.entry || {};
    const names = d.names || {};
    if (!res || !res.revised) {
      right.replaceChildren(h('section', { class: 'card' }, h('h2', {}, d.meta?.title || sid), h('p', { class: 'muted' }, e.status === 'error' ? `오류: ${e.error}` : '아직 검수하지 않았어요.'), redoBtn(sid, '이 장만 검수')));
      return;
    }
    const original = res.original || d.current || { scenes: [] };
    const report = res.report || [];
    const byLine = {};
    for (const r of report) (byLine[`${r.sceneId}:${r.lineIndex}`] ||= []).push(r);
    const revScenes = Object.fromEntries((res.revised.scenes || []).map((s) => [s.id, s]));
    let changed = 0;
    const scenes = (original.scenes || []).map((sc) => {
      if (sc.type === 'battle') return h('div', { class: 'rv-scene' }, h('div', { class: 'rv-battle' }, `⚔ 전투 장면 ${sc.id} · ${sc.stageId} (바꾸지 않음)`));
      const a = (sc.lines || []).map((ln) => lineText(ln, names));
      const b = (revScenes[sc.id]?.lines || []).map((ln) => lineText(ln, names));
      const { keepA, keepB } = diffFlags(a, b);
      changed += keepA.filter((x) => !x).length + keepB.filter((x) => !x).length;
      return h(
        'div',
        { class: 'rv-scene' },
        h('div', { class: 'muted small' }, `장면 ${sc.id}${sc.next ? ` → ${sc.next}` : ''}`),
        h(
          'div',
          { class: 'rv-cols' },
          h('div', { class: 'rv-col' }, a.map((t, i) => h('div', { class: ['rv-line', !keepA[i] && 'del', byLine[`${sc.id}:${i}`] && 'flag'], title: (byLine[`${sc.id}:${i}`] || []).map((r) => `규칙 ${r.rule}: ${r.reason}`).join('\n') }, byLine[`${sc.id}:${i}`] && h('span', { class: 'rv-rule' }, byLine[`${sc.id}:${i}`].map((r) => r.rule || '?').join(',')), t))),
          h('div', { class: 'rv-col' }, b.map((t, i) => h('div', { class: ['rv-line', !keepB[i] && 'add'] }, t))),
        ),
      );
    });
    const title = h('input', { value: res.title || '', placeholder: `제목 그대로: ${d.meta?.title || ''}` });
    const summary = h('input', { value: res.summary || '', placeholder: `한 줄 소개 그대로: ${d.meta?.summary || ''}` });
    const pending = e.status === 'pending';
    right.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `${d.meta?.chapter ?? ''}장 「${d.meta?.title || sid}」`),
        h('p', { class: 'muted small' }, `상태: ${e.stale ? '다시 필요 (앞 장이 바뀌었어요)' : STATUS[e.status] || e.status} · 모델 ${res.model?.label || '-'}${res.model?.mock ? ' (모의)' : ''} · ${res.at || ''} · 문제 ${report.length}개 · 바뀐 줄 ${changed}${res.feedback ? ` · 요청: ${res.feedback}` : ''}`),
        (res.warnings || []).length > 0 && h('ul', { class: 'warn-list' }, res.warnings.map((w) => h('li', { class: 'warn' }, w))),
        (res.locked || []).length > 0 && h('ul', { class: 'warn-list' }, res.locked.map((w) => h('li', { class: 'error' }, w))),
        pending &&
          h(
            'div',
            { class: 'row wrap' },
            h(
              'button',
              {
                class: 'btn primary',
                onclick: async () => {
                  const r = await busy('승인하고 요약을 다시 만드는 중…', () => tryApi(() => api.post(`/api/review/${sid}/approve`, { title: title.value.trim(), summary: summary.value.trim() })));
                  if (!r) return;
                  await reloadData();
                  toast('승인했어요 (대본 저장 · 요약 갱신)', 'success');
                  await load();
                  openItem(sid);
                },
              },
              '승인 (대본 저장)',
            ),
            redoBtn(sid, '다시 검수 (수정 요청)', true),
            h(
              'button',
              {
                class: 'btn danger-outline',
                onclick: async () => {
                  if (!(await confirmBox('원본 유지', '검수본을 버리고 지금 대본을 그대로 둘까요? (뒤 장의 대기 결과는 다시 필요로 표시돼요)', { ok: '원본 유지' }))) return;
                  if (await tryApi(() => api.post(`/api/review/${sid}/keep`))) (await load(), openItem(sid));
                },
              },
              '원본 유지',
            ),
          ),
        !pending && h('div', { class: 'row' }, redoBtn(sid, '다시 검수', true)),
        pending && h('div', { class: 'grid2' }, h('label', { class: 'field' }, '고친 제목 (원칙 8에 걸릴 때만 — 비우면 그대로)', title), h('label', { class: 'field' }, '한 줄 소개 (비우면 그대로)', summary)),
        h('h3', {}, `문제 목록 (${report.length})`),
        report.length
          ? h('ul', { class: 'rv-report' }, report.map((r) => h('li', {}, h('span', { class: 'rv-rule' }, r.rule || '?'), ` [${r.sceneId}:${r.lineIndex}] `, h('i', {}, r.before), ` — ${r.reason}`)))
          : h('p', { class: 'muted small' }, '문제 없음'),
        h('h3', {}, '원본 ↔ 검수본'),
        h('div', { class: 'rv-cols rv-head' }, h('b', {}, '원본 (빨강 = 빠지거나 바뀐 줄, 숫자 = 규칙)'), h('b', {}, '검수본 (초록 = 새로 쓴 줄)')),
        scenes,
      ),
    );
  }

  function redoBtn(sid, label, withFeedback = false) {
    return h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          const feedback = withFeedback ? await promptBox('다시 검수', '무엇을 바꿀까요? (비워도 됨)', { placeholder: '예: 시논을 더 과묵하게 / 농담을 줄여 줘' }) : '';
          if (feedback === null) return;
          const r = await busy('검수하는 중…', () => tryApi(() => api.post(`/api/review/${sid}/redo`, { feedback: feedback || '', model: model.value })));
          if (r) (await load(), openItem(sid));
        },
      },
      label,
    );
  }

  left.append(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '스토리 검수'),
      h('p', { class: 'muted small' }, '문체 지침(스토리 탭 → 세계관 · 문체)과 말투 카드(캐릭터 프로필 · 주인공 카드)를 기준으로 장마다 문제를 찾고 고쳐 써요. 장면 id · 전투 장면 · 선택지 · next는 바꾸지 않아요. 원본은 dev/history에 남아요.'),
      head,
    ),
    h('section', { class: 'card' }, list),
    h('section', { class: 'card' }, table),
  );
  right.append(h('div', { class: 'empty' }, '왼쪽에서 장을 고르면 원본 ↔ 검수본과 문제 목록을 보여 줘요.'));
  load().then((s) => s?.run.running && poll(true));
  return { destroy: () => clearInterval(timer) };
}
