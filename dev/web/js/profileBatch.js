// 프로필 일괄 생성 패널 (캐릭터 탭 위): 주인공 → 캐릭터를 한 명씩 차례로 만들고, 캐릭터별로 검토 → 승인 / 다시 만들기 / 건너뛰기
// 서버 dev/tinydev/profilebatch.py. 진행 중에는 2초마다 상태를 다시 읽음
import { h, toast, modal, busy, confirmBox } from './ui.js';
import { api, tryApi } from './api.js';
import { reloadData } from './state.js';
import { modelPicker } from './modelPicker.js';
import { profileEditor } from './profileForm.js';

const STATUS = { pending: '대기', running: '만드는 중…', done: '검토 대기', error: '오류', approved: '승인 ✓', skipped: '건너뜀' };

export function profileBatchCard({ onApproved } = {}) {
  const box = h('div', { class: 'pb-box' });
  const all = h('input', { type: 'checkbox' });
  const model = modelPicker('profile');
  let timer = null;
  let last = null;

  async function load() {
    const r = await tryApi(() => api.get('/api/profile-batch'));
    if (r) render(r);
    return r;
  }
  function poll(on) {
    clearInterval(timer);
    timer = on ? setInterval(async () => {
      if (!box.isConnected) return clearInterval(timer);
      const r = await load();
      if (r && !r.batch?.running) poll(false);
    }, 2000) : null;
  }

  async function start() {
    const n = all.checked ? last?.allTargets : last?.targets?.length;
    const msg = all.checked
      ? `주인공 + 캐릭터 ${n - 1}명 전원의 프로필을 다시 만들어요 (기존 프로필은 승인할 때만 바뀌어요).`
      : `프로필이 없는 ${n}명(주인공 카드 포함)을 차례로 만들어요.`;
    if (!(await confirmBox('프로필 일괄 생성', `${msg}\n한 명씩 순서대로 만들고, 앞에서 만든 말투 카드를 다음 요청에 넣어서 말투가 겹치지 않게 해요.`, { ok: '시작' }))) return;
    const r = await tryApi(() => api.post('/api/profile-batch/start', { all: all.checked, model: model.value }));
    if (r) {
      await load();
      poll(true);
    }
  }

  async function review(it) {
    const ed = profileEditor({ target: it.kind === 'protagonist' ? 'protagonist' : { id: it.id, name: it.name }, profile: it.profile || {}, npc: it.kind === 'npc' });
    const feedback = h('input', { placeholder: '다시 만들기 요청 (예: 더 과묵하게, 이레나와 앙숙으로)' });
    const res = await modal({
      title: `검토 — ${it.name} (${it.id})${it.model ? ` · ${it.model.label}${it.model.mock ? ' (모의)' : ''}` : ''}`,
      wide: true,
      body: h(
        'div',
        {},
        it.warnings?.length > 0 && h('ul', { class: 'warn-list' }, it.warnings.map((w) => h('li', { class: 'warn' }, w))),
        h('div', { class: 'row' }, feedback),
        ed.el,
      ),
      buttons: [
        { label: '닫기', value: null },
        { label: '건너뛰기', value: 'skip' },
        { label: '요청 반영해서 다시 만들기', value: 'regen' },
        { label: '승인 (저장)', value: 'approve', primary: true },
      ],
    });
    if (res === 'approve') {
      const r = await tryApi(() => api.post(`/api/profile-batch/${it.id}/approve`, { profile: ed.get() }));
      if (r) {
        await reloadData();
        render({ ...last, batch: r.batch });
        onApproved?.();
        toast(`「${it.name}」 프로필을 저장했어요`, 'success');
      }
    } else if (res === 'regen') {
      const r = await busy(`「${it.name}」 다시 만드는 중…`, () => tryApi(() => api.post(`/api/profile-batch/${it.id}/regenerate`, { feedback: feedback.value, model: model.value })));
      if (r) {
        render({ ...last, batch: r.batch });
        review(r.batch.items.find((x) => x.id === it.id));
      }
    } else if (res === 'skip') {
      const r = await tryApi(() => api.post(`/api/profile-batch/${it.id}/skip`));
      if (r) render({ ...last, batch: r.batch });
    }
  }

  function render(r) {
    last = r;
    const b = r.batch;
    const head = h(
      'div',
      { class: 'row wrap' },
      h('label', { class: 'inline', title: '기존 캐릭터 전원 + 주인공 (CHARACTER_PROFILE.md 8-1장)' }, all, '전원 다시 만들기'),
      model.el,
      h('button', { class: 'btn primary small', disabled: !!b?.running, onclick: start }, b?.running ? '진행 중…' : '일괄 생성 시작'),
      b?.running && h('button', { class: 'btn small', onclick: async () => (await tryApi(() => api.post('/api/profile-batch/cancel'))) && load() }, b.cancelRequested ? '멈추는 중…' : '멈추기'),
      !b?.running && b?.counts?.pending > 0 && h('button', { class: 'btn small', onclick: async () => (await tryApi(() => api.post('/api/profile-batch/resume'))) && (load(), poll(true)) }, '이어서 만들기'),
    );
    const summary = h('p', { class: 'muted small' }, `프로필이 필요한 대상 ${r.targets.length}명${r.targets.length ? ` (${r.targets.map((t) => t.name).join(', ')})` : ''}`);
    if (!b) return box.replaceChildren(head, summary);
    const c = b.counts;
    box.replaceChildren(
      head,
      h('p', { class: 'small' }, `${b.items.length}명 중 승인 ${c.approved} · 검토 대기 ${c.done} · 대기 ${c.pending + c.running} · 오류 ${c.error} · 건너뜀 ${c.skipped}`),
      h(
        'div',
        { class: 'pb-items' },
        b.items.map((it) =>
          h(
            'div',
            { class: ['pb-item', `is-${it.status}`] },
            h('b', {}, it.name),
            h('span', { class: 'muted small' }, ` ${it.kind === 'protagonist' ? '주인공' : it.kind === 'npc' ? 'NPC · 말투 카드' : '프로필'}`),
            h('span', { class: ['chip', it.status === 'approved' ? 'ok' : it.status === 'error' ? 'warn' : ''] }, STATUS[it.status] || it.status),
            it.error && h('div', { class: 'error small' }, it.error),
            (it.status === 'done' || it.status === 'approved' || it.status === 'error') && h('button', { class: 'btn small', onclick: () => (it.status === 'error' ? tryApi(() => api.post(`/api/profile-batch/${it.id}/regenerate`, { model: model.value })).then((x) => x && render({ ...last, batch: x.batch })) : review(it)) }, it.status === 'error' ? '다시 시도' : '검토'),
          ),
        ),
      ),
      summary,
    );
  }

  const el = h(
    'section',
    { class: 'card' },
    h('details', {}, h('summary', {}, h('b', {}, '프로필 일괄 생성')), h('p', { class: 'muted small' }, '주인공 말투 카드 → 캐릭터 순서로 한 명씩 만들어요. 결과는 바로 저장하지 않고, 캐릭터별로 검토해서 승인해야 저장돼요. NPC는 말투 카드만 만들어요.'), box),
  );
  load().then((r) => r?.batch?.running && poll(true));
  return el;
}
