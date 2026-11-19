// 배포 탭: 검사 → (보류할 미래 콘텐츠 확인) → 패치노트 → 공개 폴더에 반영 → git 명령/버튼
import { h, toast, confirmBox, busy, isoToLocal, localToIso, fmt } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadData, reloadStatus } from '../state.js';

const TYPE_LABEL = { characters: '캐릭터', banners: '배너', storyIndex: '스토리', notices: '공지', mail: '우편' };
const STATUS_LABEL = { added: '추가', modified: '수정', removed: '삭제' };

export function publishTab(root) {
  // 기본 기준 시각: 지금부터 24시간 뒤 (그 안에 시작하는 콘텐츠까지 공개)
  const cutoff = h('input', { type: 'datetime-local', value: isoToLocal(new Date(Date.now() + 86400000).toISOString()) });
  const out = h('div');
  const result = h('div');
  let plan = null;

  async function check() {
    result.replaceChildren();
    plan = await busy('검사 중…', () => tryApi(() => api.post('/api/publish/plan', { cutoff: localToIso(cutoff.value) })));
    if (plan) renderPlan();
  }

  function renderPlan() {
    const errors = plan.issues.filter((i) => i.level === 'error');
    const warns = plan.issues.filter((i) => i.level === 'warning');
    const notes = h('textarea', { rows: Math.max(4, plan.draftNotes.length + 1) }, plan.draftNotes.join('\n'));
    const canPublish = errors.length === 0 && plan.changes.length > 0;

    out.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `1. 검사 결과 — 오류 ${errors.length} · 경고 ${warns.length}`),
        errors.length === 0 && h('p', { class: 'ok-text' }, '✓ 오류 없음'),
        issueList(errors, 'error'),
        warns.length > 0 && h('details', { open: errors.length === 0 && warns.length < 8 }, h('summary', {}, `경고 ${warns.length}개 (배포는 가능)`), issueList(warns, 'warn')),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `2. 이번에 보류되는 콘텐츠 (${plan.held.length})`),
        h('p', { class: 'muted small' }, `시작 시각이 기준(${fmt(plan.cutoff)})보다 늦은 항목은 공개 저장소에 올리지 않아요 → 스포일러 방지. 기준 시각이 지난 뒤 다시 배포하세요.`),
        plan.held.length
          ? h('ul', {}, plan.held.map((x) => h('li', {}, `[${TYPE_LABEL[x.type] || x.type}] ${x.title || x.id} — ${fmt(x.startAt)} 시작`)))
          : h('p', { class: 'muted' }, '보류되는 항목이 없어요'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `3. 바뀌는 파일 (${plan.changes.length})`),
        plan.changes.length
          ? h('ul', { class: 'file-list' }, plan.changes.map((c) => h('li', { class: c.status }, h('span', { class: 'chip' }, STATUS_LABEL[c.status]), ' ', h('code', {}, c.file))))
          : h('p', { class: 'muted' }, '공개된 내용과 같아요. 배포할 것이 없어요.'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `4. 패치노트 (v${plan.currentVersion} → v${plan.nextVersion})`),
        h('p', { class: 'muted small' }, '한 줄에 하나씩. 플레이어가 다음 접속 때 "업데이트 내역" 팝업으로 봐요.'),
        notes,
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn primary',
              disabled: !canPublish,
              onclick: () => apply(notes.value.split('\n')),
            },
            '배포하기 (공개 폴더에 반영)',
          ),
          !canPublish && h('span', { class: 'muted small' }, errors.length ? '오류를 먼저 고쳐 주세요' : '바뀐 내용이 없어요'),
        ),
      ),
    );
  }

  function issueList(items, cls) {
    if (!items.length) return null;
    return h('ul', { class: `issue-list ${cls}` }, items.map((i) => h('li', {}, h('code', {}, i.where), ' ', i.message)));
  }

  async function apply(notes) {
    const ok = await confirmBox(
      '배포하기',
      `작업 공간의 내용을 공개 폴더(data/, assets/)에 반영하고 버전을 v${plan.nextVersion}로 올려요.\n아직 GitHub에는 올라가지 않아요 (다음 단계에서 git push).`,
      { ok: '반영하기' },
    );
    if (!ok) return;
    const r = await busy('반영 중…', () => tryApi(() => api.post('/api/publish/apply', { cutoff: localToIso(cutoff.value), notes })));
    if (!r) return;
    await reloadData();
    out.replaceChildren();
    toast(`v${r.version} 반영 완료`, 'success');
    renderResult(r);
  }

  async function renderResult(r) {
    const git = (await reloadStatus()).git;
    const message = h('input', { value: `콘텐츠 업데이트 v${r.version}` });
    const log = h('pre', { class: 'git-log', hidden: true });
    const runGit = async (push) => {
      const branch = git.branch || '?';
      const ok = await confirmBox(
        push ? '커밋 + 푸시' : '커밋',
        `현재 브랜치: ${branch}\n바뀐 파일 ${r.files.length}개만 커밋해요${push ? '.\n그리고 GitHub로 push 해요 → GitHub Pages가 몇 분 뒤 갱신돼요.' : '.'}${branch !== 'main' && push ? '\n\n⚠ main 브랜치가 아니에요. Pages가 main에서 배포된다면 반영되지 않아요.' : ''}`,
        { ok: push ? '커밋 + 푸시' : '커밋' },
      );
      if (!ok) return;
      const res = await busy('git 실행 중…', () => tryApi(() => api.post('/api/publish/git', { files: r.files, message: message.value, push })));
      if (!res) return;
      log.hidden = false;
      log.textContent = res.log.map((x) => `$ ${x.cmd}\n${x.out || '(출력 없음)'}${x.code ? `\n→ 실패 (코드 ${x.code})` : ''}`).join('\n\n');
      const failed = res.log.some((x) => x.code);
      toast(failed ? 'git 명령이 실패했어요. 아래 기록을 확인해 주세요' : push ? '푸시 완료! 몇 분 뒤 사이트에 반영돼요' : '커밋 완료', failed ? 'error' : 'success', 6000);
    };
    result.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `✓ v${r.version} 반영 완료 — 이제 GitHub에 올리기`),
        h('h3', {}, '바뀐 파일'),
        h('ul', { class: 'file-list' }, r.files.map((f) => h('li', {}, h('code', {}, f)))),
        h('h3', {}, '터미널에서 직접 할 경우 (저장소 폴더에서)'),
        h('pre', { class: 'cmd' }, r.commands.join('\n')),
        h('button', { class: 'btn small', onclick: () => navigator.clipboard.writeText(r.commands.join('\n')).then(() => toast('복사했어요')) }, '명령 복사'),
        git.available
          ? h(
              'div',
              { class: 'git-box' },
              h('h3', {}, `또는 버튼으로 (브랜치: ${git.branch})`),
              h('label', { class: 'field' }, '커밋 메시지', message),
              h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => runGit(false) }, '커밋만'), h('button', { class: 'btn primary', disabled: !git.hasRemote, onclick: () => runGit(true) }, '커밋 + 푸시')),
              !git.hasRemote && h('p', { class: 'muted small' }, '원격 저장소(origin)가 없어서 푸시는 할 수 없어요.'),
              log,
            )
          : h('p', { class: 'muted' }, 'git을 찾을 수 없어요. 위 명령을 직접 실행해 주세요.'),
      ),
    );
  }

  async function resetWorkspace() {
    const ok = await confirmBox(
      '작업 공간 되돌리기',
      '작업 공간(dev/workspace)을 지금 공개된 데이터로 덮어써요.\n배포하지 않은 작업은 dev/trash에 백업되지만 화면에서는 사라져요.',
      { ok: '되돌리기', danger: true },
    );
    if (!ok) return;
    if (await tryApi(() => api.post('/api/workspace/reset'))) {
      await reloadData();
      toast('공개 데이터로 되돌렸어요');
    }
  }

  root.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '배포'),
      h('p', {}, '개발 도구에서 고친 내용은 모두 ', h('b', {}, '작업 공간(dev/workspace, git에 안 올라감)'), '에 있어요. 여기서 검사 후 공개 폴더(data/, assets/)에 반영하고 git으로 올리면 게임에 나타나요.'),
      h('div', { class: 'row wrap' }, h('label', { class: 'inline' }, '공개 기준 시각 (KST)', cutoff), h('button', { class: 'btn primary', onclick: check }, '검사 + 변경 확인')),
      h('p', { class: 'muted small' }, `현재 공개 버전: v${state.data.version?.contentVersion ?? 0}`),
    ),
    out,
    result,
    h('section', { class: 'card' }, h('h2', {}, '기타'), h('button', { class: 'btn danger-outline', onclick: resetWorkspace }, '작업 공간을 공개 데이터로 되돌리기')),
  );
  return {};
}
