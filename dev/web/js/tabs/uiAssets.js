// UI 에셋 탭: 게임 화면 배경 / 로고 / 아이콘을 AI로 뽑아서 적용 (data/ui.json)
// 그림이 없는 칸은 게임에서 CSS 기본 디자인으로 보여요.
import { h, toast, modal, confirmBox, wsImage } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state } from '../state.js';
import { jobPanel } from '../jobPanel.js';
import { promptStep } from '../promptStep.js';
import { openPreview } from '../preview.js';

const GROUPS = [
  ['bg', '화면 배경 (1280×720)', '게임 화면 뒤에 깔리는 그림. 인물 없이 풍경만, UI가 올라가니 차분하게.'],
  ['icon', '로고 · 아이콘 (투명 PNG)', '흰 배경으로 뽑은 뒤 배경을 지워서 투명 PNG로 저장해요.'],
];

export function uiAssetsTab(root) {
  let slots = [];
  let ui = { backgrounds: {}, icons: {} };
  const host = h('div');
  root.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row between' }, h('h2', {}, 'UI 에셋 — 게임 화면 디자인'), h('button', { class: 'btn', onclick: () => openPreview() }, '게임 미리보기')),
      h('p', {}, '각 칸의 그림을 AI로 뽑고, 검사해서 통과시키면 게임 화면에 적용돼요. 비워 둔 칸은 지금의 CSS 디자인이 그대로 보여요.'),
      h('p', { class: 'muted small' }, `공통 분위기: "${state.settings?.theme || ''}" (설정 탭에서 바꿀 수 있어요) · 배포 탭에서 배포해야 실제 게임에 반영돼요.`),
    ),
    host,
  );

  const pathOf = (key) => {
    const [group, name] = key.split('.');
    return ui[group]?.[name] || '';
  };

  function render() {
    host.replaceChildren(
      ...GROUPS.map(([kind, title, desc]) =>
        h(
          'section',
          { class: 'card' },
          h('h2', {}, title),
          h('p', { class: 'muted small' }, desc),
          h(
            'div',
            { class: ['slot-grid', kind === 'icon' && 'icons'] },
            slots
              .filter((s) => (kind === 'bg' ? s.kind === 'bg' : s.kind !== 'bg'))
              .map((s) => {
                const path = pathOf(s.key);
                return h(
                  'div',
                  { class: 'slot-card' },
                  h(
                    'div',
                    { class: ['slot-preview', s.kind !== 'bg' && 'checker'] },
                    path ? h('img', { src: wsImage(path), alt: s.label, onerror: (e) => e.target.replaceWith(h('span', { class: 'muted' }, '파일 없음')) }) : h('span', { class: 'muted small' }, 'CSS 기본 디자인'),
                  ),
                  h('b', {}, s.label),
                  h('div', { class: 'muted small' }, path || s.key),
                  h(
                    'div',
                    { class: 'row wrap' },
                    h('button', { class: 'btn small primary', onclick: () => openGenerator(s) }, path ? '다시 뽑기' : '뽑기'),
                    path && h('button', { class: 'btn small danger-outline', onclick: () => clearSlot(s) }, '기본으로'),
                  ),
                );
              }),
          ),
        ),
      ),
    );
  }

  async function load() {
    const r = await tryApi(() => api.get('/api/ui'));
    if (!r) return;
    slots = r.slots;
    ui = r.ui;
    render();
  }

  async function clearSlot(s) {
    if (!(await confirmBox('기본 디자인으로', `「${s.label}」의 그림을 빼고 CSS 기본 디자인으로 돌릴까요? (그림 파일은 그대로 남아요)`, { ok: '되돌리기' }))) return;
    const r = await tryApi(() => api.put('/api/ui', { slot: s.key, path: null }));
    if (r) {
      ui = r.ui;
      render();
      toast('기본 디자인으로 되돌렸어요');
    }
  }

  function openGenerator(s) {
    const extra = h('input', { placeholder: '추가 요청 (예: 더 밝게, 분홍색 위주로, 둥근 모양)' });
    const area = h('div');
    const input = () => ({ slot: s.key, extra: extra.value });
    const step = promptStep({
      kind: 'ui',
      getInput: input,
      generateLabel: '그림 뽑기',
      generate: async (gen) => {
        const job = await tryApi(() => api.post('/api/ui/generate', { ...input(), ...gen }));
        if (!job) return;
        area.replaceChildren(
          jobPanel(job, {
            approveLabel: '통과 → 게임에 적용',
            onApprove: async (n) => {
              const r = await tryApi(() => api.post(`/api/jobs/${job.id}/approve-image`, { attempt: n }));
              if (!r) return false;
              await load();
              toast(`「${s.label}」 적용 완료 (작업 공간). 게임 미리보기로 확인해 보세요`, 'success');
              return true;
            },
          }).el,
        );
      },
    });
    modal({
      title: `UI 에셋 뽑기 — ${s.label}`,
      wide: true,
      body: h('div', {}, h('p', { class: 'muted small' }, `무엇을 그리는지: ${s.subject}`), h('label', { class: 'field' }, '추가 요청 (선택, 한국어 OK)', extra), step.el, area),
    });
  }

  load();
  return { refresh: load };
}
