// 설정 화면: 전체화면, 세이브 코드 내보내기/불러오기, 데이터 초기화, 데이터 상태
import { h } from './dom.js';
import { openModal, confirmModal } from './modal.js';
import { toast } from './toast.js';
import { go } from './router.js';
import { exportCode, parseCode } from '../core/save.js';
import { isFullscreen } from '../core/stage.js';
import { formatKST } from '../core/time.js';
import { formatGems } from '../systems/economy.js';
import { ownedCount } from '../systems/collection.js';

/** 클립보드 복사 (안 되면 선택 후 복사 명령으로 대체) */
async function copyText(text, textarea) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      textarea.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function settingsScreen(ctx) {
  return {
    title: '설정',
    mount(el) {
      const fsBtn = h('button', { class: 'setting-btn', type: 'button', onclick: () => ctx.toggleFullscreen() });
      const updateFs = () => fsBtn.replaceChildren(isFullscreen() ? '전체화면 끄기' : '전체화면 켜기', h('kbd', { class: 'key-hint' }, 'F'));
      updateFs();
      document.addEventListener('fullscreenchange', updateFs);

      // ── 내보내기 ──
      async function onExport() {
        const code = exportCode(ctx.save);
        const area = h('textarea', { class: 'code-area', readonly: true, rows: 6, spellcheck: 'false' }, code);
        await openModal({
          title: '세이브 코드 내보내기',
          body: [h('p', {}, '이 코드를 메모장 등에 보관하면 다른 기기나 브라우저에서 이어서 할 수 있어요.'), area],
          dismissValue: null,
          buttons: [
            { label: '닫기', value: null },
            {
              label: '복사하기',
              primary: true,
              onClick: async () => {
                const ok = await copyText(code, area);
                toast(ok ? '세이브 코드를 복사했어요' : '복사에 실패했어요. 직접 선택해서 복사해 주세요', { type: ok ? 'success' : 'error' });
                return ok; // 실패하면 창을 닫지 않음
              },
            },
          ],
        });
      }

      // ── 불러오기 ──
      async function onImport() {
        const area = h('textarea', { class: 'code-area', rows: 6, spellcheck: 'false', placeholder: 'TG1: 로 시작하는 코드를 붙여넣으세요' });
        const error = h('p', { class: 'form-error', role: 'alert' });
        let parsed = null;

        const result = await openModal({
          title: '세이브 코드 불러오기',
          body: [area, error],
          dismissValue: null,
          buttons: [
            { label: '취소', value: null },
            {
              label: '불러오기',
              primary: true,
              value: 'ok',
              onClick: () => {
                const r = parseCode(area.value);
                if (!r.ok) {
                  error.textContent = r.error;
                  return false;
                }
                parsed = r.save;
              },
            },
          ],
        });
        if (result !== 'ok' || !parsed) return;

        const ok = await confirmModal(
          '현재 진행 상황을 덮어쓸까요?',
          `불러올 세이브: 보석 ${formatGems(parsed.gems)}개 · 캐릭터 ${ownedCount(parsed, ctx.data.characters)}명\n` +
            `현재 세이브: 보석 ${formatGems(ctx.save.gems)}개 · 캐릭터 ${ownedCount(ctx.save, ctx.data.characters)}명\n\n` +
            '지금 진행 상황은 사라지고 되돌릴 수 없어요.',
          { okLabel: '덮어쓰기', danger: true },
        );
        if (!ok) return;
        ctx.replaceSave(parsed);
        toast('세이브를 불러왔어요', { type: 'success' });
        go('home');
      }

      // ── 초기화 ──
      async function onReset() {
        const ok = await confirmModal('데이터 초기화', '모든 진행 상황(보석, 캐릭터)이 삭제돼요.\n정말 초기화할까요?', { okLabel: '초기화', danger: true });
        if (!ok) return;
        const really = await confirmModal('마지막 확인', '되돌릴 수 없어요. 세이브 코드를 먼저 내보내 두는 걸 추천해요.', { okLabel: '정말 초기화', danger: true });
        if (!really) return;
        ctx.resetSave();
        toast('초기화했어요. 처음부터 시작해요!');
        go('home');
      }

      const status = h(
        'ul',
        { class: 'status-list' },
        ctx.data.status.map((s) =>
          h('li', { class: s.ok ? 'ok' : 'bad' }, h('code', {}, s.file), h('span', {}, s.ok ? `정상 · ${s.count}개` : `오류 · ${s.error}`)),
        ),
      );

      el.append(
        h(
          'div',
          { class: 'settings-grid' },
          h(
            'section',
            { class: 'settings-card' },
            h('h2', {}, '화면'),
            fsBtn,
            h('p', { class: 'muted small' }, 'iPhone은 전체화면을 지원하지 않아요. 공유 → "홈 화면에 추가"로 실행하면 전체화면으로 즐길 수 있어요.'),
          ),
          h(
            'section',
            { class: 'settings-card' },
            h('h2', {}, '세이브'),
            h('button', { class: 'setting-btn', type: 'button', onclick: onExport }, '세이브 코드 내보내기'),
            h('button', { class: 'setting-btn', type: 'button', onclick: onImport }, '세이브 코드 불러오기'),
            h('button', { class: 'setting-btn danger', type: 'button', onclick: onReset }, '데이터 초기화'),
          ),
          h(
            'section',
            { class: 'settings-card' },
            h('h2', {}, '정보'),
            h(
              'dl',
              { class: 'info-list' },
              h('dt', {}, '시작한 날'),
              h('dd', {}, formatKST(ctx.save.createdAt, { withTime: false })),
              h('dt', {}, '총 뽑기'),
              h('dd', {}, `${formatGems(ctx.save.stats.pulls)}회`),
              h('dt', {}, '시간 기준'),
              h('dd', {}, '한국 표준시(KST)'),
            ),
            h('h3', {}, '데이터 상태'),
            status,
          ),
        ),
      );

      return {
        destroy() {
          document.removeEventListener('fullscreenchange', updateFs);
        },
      };
    },
  };
}
