// 개발 도구 시작점: 탭 전환(주소 #탭/항목id), 상단 상태 표시
import { h, toast } from './ui.js';
import { tryApi } from './api.js';
import { state, reloadData, reloadStatus } from './state.js';
import { charactersTab } from './tabs/characters.js';
import { bannersTab } from './tabs/banners.js';
import { storiesTab } from './tabs/stories.js';
import { inboxTab } from './tabs/inbox.js';
import { scheduleTab } from './tabs/schedule.js';
import { publishTab } from './tabs/publish.js';
import { openPreview } from './preview.js';

const TABS = [
  ['characters', '캐릭터', charactersTab],
  ['banners', '배너', bannersTab],
  ['stories', '스토리', storiesTab],
  ['inbox', '공지 · 우편', inboxTab],
  ['schedule', '일정', scheduleTab],
  ['publish', '배포', publishTab],
];

const nav = document.getElementById('tabs');
const main = document.getElementById('main');
const statusEl = document.getElementById('status');
let currentTab = null;
let currentName = null;

function renderStatus() {
  const s = state.status;
  if (!s) return;
  const ai = s.ai.mock
    ? h('span', { class: 'chip warn', title: 'dev/.env에 GOOGLE_CLOUD_PROJECT 등을 설정하면 Vertex AI를 사용해요 (dev/README.md)' }, s.ai.forcedMock ? 'AI: 모의 모드 (TG_MOCK=1)' : 'AI: 모의 모드 (Vertex 설정 없음)')
    : h('span', { class: 'chip ok', title: `${s.ai.imageModel} / ${s.ai.textModel} @ ${s.ai.location}` }, `AI: Vertex · ${s.ai.imageModel}`);
  const rmbg = s.rmbg.installed
    ? h('span', { class: ['chip', s.rmbg.error ? 'warn' : 'ok'], title: s.rmbg.error || s.rmbg.model }, s.rmbg.error ? '배경 제거: 간단 모드 (RMBG 오류)' : `배경 제거: ${s.rmbg.model.split('/').pop()}`)
    : h('span', { class: 'chip warn', title: 'requirements-rmbg.txt 설치 시 BRIA RMBG 사용' }, '배경 제거: 간단 모드');
  const git = s.git.available ? h('span', { class: 'chip' }, `git: ${s.git.branch}`) : h('span', { class: 'chip warn' }, 'git 없음');
  const errs = Object.values(state.data.errors || {});
  const chips = [ai, rmbg, git, errs.length > 0 && h('span', { class: 'chip error', title: errs.join('\n') }, `데이터 오류 ${errs.length}`), h('button', { class: 'btn small', onclick: () => openPreview() }, '게임 미리보기')];
  statusEl.replaceChildren(...chips.filter(Boolean));
}

function route() {
  const [name, select] = location.hash.replace(/^#/, '').split('/');
  const tab = TABS.find((t) => t[0] === name) || TABS[0];
  if (currentTab?.isDirty?.() && currentName !== tab[0] && !confirm('저장하지 않은 스토리 변경이 있어요. 이동할까요?')) {
    history.replaceState(null, '', `#${currentName}`);
    return;
  }
  currentName = tab[0];
  nav.replaceChildren(...TABS.map(([id, label]) => h('a', { href: `#${id}`, class: id === tab[0] ? 'active' : '' }, label)));
  const host = h('div', { class: 'tab-host' });
  main.replaceChildren(host);
  try {
    currentTab = tab[2](host, { select: select ? decodeURIComponent(select) : null }) || {};
  } catch (e) {
    console.error(e);
    host.append(h('p', { class: 'error' }, `화면 오류: ${e.message}`));
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (currentTab?.isDirty?.()) e.preventDefault();
});

(async () => {
  const ok = await tryApi(async () => {
    await reloadStatus();
    await reloadData();
    return true;
  });
  if (!ok) {
    main.replaceChildren(h('p', { class: 'error' }, '서버에서 데이터를 불러오지 못했어요.'));
    return;
  }
  if (state.status.workspaceCreated) toast('작업 공간을 새로 만들었어요 (공개 데이터 복사)', 'info', 5000);
  renderStatus();
  route();
})();
