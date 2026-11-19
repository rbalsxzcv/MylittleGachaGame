// 우편함 / 공지 / 업데이트 내역 화면과 시작 팝업
import { h, gemIcon } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { countdownEl, startCountdowns } from './countdown.js';
import { activeMail, isClaimed, claimMail, visibleNotices, popupNotices, unseenPatchNotes } from '../systems/inbox.js';
import { formatGems } from '../systems/economy.js';
import { formatKST } from '../core/time.js';

// ─────────────────────────────────────────────────────────
// 우편함
// ─────────────────────────────────────────────────────────
export function mailScreen(ctx) {
  return {
    title: '우편함',
    mount(el) {
      const list = h('div', { class: 'mail-list' });
      const claimAllBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => claimAll() }, '모두 받기');

      function render() {
        const mails = activeMail(ctx.data.mail);
        const unclaimed = mails.filter((m) => !isClaimed(ctx.save, m.id));
        claimAllBtn.disabled = unclaimed.length === 0;
        list.replaceChildren(
          ...mails.map((m) => {
            const claimed = isClaimed(ctx.save, m.id);
            return h(
              'div',
              { class: ['mail-row', claimed && 'is-claimed'] },
              h('div', { class: 'mail-icon', 'aria-hidden': 'true' }, '✉︎'),
              h(
                'div',
                { class: 'mail-main' },
                h('div', { class: 'mail-title' }, m.title),
                m.body && h('div', { class: 'mail-body' }, m.body),
                h('div', { class: 'mail-meta' }, countdownEl(m.endAt)),
              ),
              m.rewards.gems > 0 && h('div', { class: 'mail-reward' }, gemIcon(), formatGems(m.rewards.gems)),
              h(
                'button',
                { class: ['btn', !claimed && 'btn-primary'], type: 'button', disabled: claimed, onclick: () => claimOne(m) },
                claimed ? '받음' : '받기',
              ),
            );
          }),
          ...(mails.length === 0 ? [h('p', { class: 'collection-empty' }, '받을 우편이 없어요')] : []),
        );
      }

      function claimOne(m) {
        const gems = claimMail(ctx.save, m);
        if (gems || isClaimed(ctx.save, m.id)) {
          ctx.commit();
          toast(gems ? `보석 ${formatGems(gems)}개를 받았어요` : '우편을 받았어요', { type: 'success' });
        }
        render();
      }

      function claimAll() {
        let total = 0;
        let n = 0;
        for (const m of activeMail(ctx.data.mail)) {
          if (isClaimed(ctx.save, m.id)) continue;
          total += claimMail(ctx.save, m);
          n++;
        }
        if (n) {
          ctx.commit();
          toast(`우편 ${n}통 · 보석 ${formatGems(total)}개를 받았어요`, { type: 'success' });
        }
        render();
      }

      el.append(
        h('div', { class: 'collection-head' }, h('div', { class: 'muted' }, '기간이 지나면 우편이 사라져요'), claimAllBtn),
        h('div', { class: 'story-scroll' }, list),
      );
      render();
      const stop = startCountdowns(el);
      return { destroy: stop };
    },
  };
}

// ─────────────────────────────────────────────────────────
// 공지 / 업데이트 내역
// ─────────────────────────────────────────────────────────
export function noticesScreen(ctx) {
  return {
    title: '공지',
    mount(el, params) {
      let tab = params.tab === 'updates' ? 'updates' : 'notices';
      let selected = 0;
      const tabs = h('div', { class: 'filter-tabs', role: 'tablist' });
      const list = h('div', { class: 'notice-list' });
      const detail = h('article', { class: 'notice-detail' });

      function items() {
        if (tab === 'notices') {
          return visibleNotices(ctx.data.notices).map((n) => ({ title: n.title, date: n.date, body: n.body }));
        }
        return ctx.data.version.patchNotes.map((p) => ({
          title: `업데이트 v${p.version}`,
          date: p.date,
          body: p.notes.map((x) => `• ${x}`).join('\n'),
        }));
      }

      function render() {
        tabs.replaceChildren(
          ...[
            ['notices', '공지사항'],
            ['updates', '업데이트 내역'],
          ].map(([id, label]) =>
            h('button', { class: ['filter-tab', tab === id && 'active'], type: 'button', onclick: () => ((tab = id), (selected = 0), render()) }, label),
          ),
        );
        const all = items();
        list.replaceChildren(
          ...all.map((it, i) =>
            h(
              'button',
              { class: ['notice-item', i === selected && 'active'], type: 'button', onclick: () => ((selected = i), render()) },
              h('div', { class: 'notice-item-title' }, it.title),
              h('div', { class: 'notice-item-date' }, formatKST(it.date, { withTime: false })),
            ),
          ),
          ...(all.length === 0 ? [h('p', { class: 'muted' }, tab === 'notices' ? '공지가 없어요' : '업데이트 내역이 없어요')] : []),
        );
        const it = all[selected];
        detail.replaceChildren(...(it ? [h('h2', {}, it.title), h('div', { class: 'notice-date' }, formatKST(it.date)), h('div', { class: 'notice-body' }, it.body)] : []));
      }

      el.append(h('div', { class: 'collection-head' }, tabs), h('div', { class: 'notice-layout' }, list, detail));
      render();
      return {};
    },
  };
}

// ─────────────────────────────────────────────────────────
// 시작 팝업: 업데이트 내역 → 공지 팝업 순서
// ─────────────────────────────────────────────────────────
export async function showStartupPopups(ctx, { isNew }) {
  const version = ctx.data.version;

  // 처음 시작한 사람에게는 지난 업데이트 내역을 보여주지 않음
  if (isNew) {
    ctx.save.seenContentVersion = version.contentVersion;
    ctx.commit();
  } else {
    const notes = unseenPatchNotes(ctx.save, version);
    if (notes.length) {
      const body = h(
        'div',
        { class: 'patch-notes' },
        notes.map((p) =>
          h('section', {}, h('h3', {}, `v${p.version} · ${formatKST(p.date, { withTime: false })}`), h('ul', {}, p.notes.map((x) => h('li', {}, x)))),
        ),
      );
      await openModal({ title: '업데이트 내역', body, className: 'modal-wide', dismissValue: true });
    }
    if (version.contentVersion !== ctx.save.seenContentVersion) {
      ctx.save.seenContentVersion = version.contentVersion;
      ctx.commit();
    }
  }

  for (const n of popupNotices(ctx.save, ctx.data.notices)) {
    const hide = h('input', { type: 'checkbox', id: `hide-${n.id}` });
    const body = [
      h('div', { class: 'notice-date' }, formatKST(n.date)),
      h('div', { class: 'notice-body' }, n.body),
      h('label', { class: 'check-row', for: `hide-${n.id}` }, hide, ' 다시 보지 않기'),
    ];
    await openModal({ title: n.title, body, dismissValue: true });
    if (hide.checked && !ctx.save.hiddenNotices.includes(n.id)) {
      ctx.save.hiddenNotices.push(n.id);
      ctx.commit();
    }
  }
}
