// 공지 · 우편 탭: 만들기 / 고치기 / 지우기
import { h, toast, confirmBox, dateField, slugOk, fmt, nowIso } from '../ui.js';
import { tryApi } from '../api.js';
import { state, saveList } from '../state.js';
import { openPreview } from '../preview.js';

export function inboxTab(root, { select } = {}) {
  const noticeCol = h('div');
  const mailCol = h('div');
  root.replaceChildren(h('div', { class: 'two-col even' }, noticeCol, mailCol));

  // 공통: 목록 + 편집 폼
  function section(host, { key, title, blank, fields, summary }) {
    let editing = null;
    const list = h('div', { class: 'item-list' });
    const form = h('div');

    function renderList() {
      const items = [...state.data[key]].sort((a, b) => (Date.parse(b.date || b.startAt || 0) || 0) - (Date.parse(a.date || a.startAt || 0) || 0));
      list.replaceChildren(
        ...items.map((it) => h('button', { class: ['list-item', editing?.id === it.id && 'active'], onclick: () => edit(it) }, h('b', {}, it.title || it.id), h('div', { class: 'muted small' }, summary(it)))),
        ...(items.length ? [] : [h('p', { class: 'muted' }, '아직 없어요')]),
      );
    }

    function edit(it) {
      const isNew = !it;
      const v = structuredClone(it || blank());
      editing = v;
      renderList();
      const id = h('input', { value: v.id, disabled: !isNew, placeholder: '영문 id' });
      const built = fields(v);
      const save = async () => {
        const data = { ...built.get(), id: id.value.trim() };
        if (!slugOk(data.id)) return toast('id를 영문/숫자/_/-로 정해 주세요', 'error');
        if (!data.title?.trim()) return toast('제목을 입력해 주세요', 'error');
        if (isNew && state.data[key].some((x) => x.id === data.id)) return toast('이미 있는 id예요', 'error');
        const items = state.data[key].filter((x) => x.id !== data.id);
        const pos = state.data[key].findIndex((x) => x.id === data.id);
        pos >= 0 ? items.splice(pos, 0, data) : items.push(data);
        if ((await tryApi(() => saveList(key, items))) === null) return;
        editing = data;
        id.disabled = true;
        renderList();
        toast('저장했어요 (작업 공간)', 'success');
      };
      const remove = async () => {
        if (!(await confirmBox('삭제', `「${v.title || v.id}」를 삭제할까요?`, { ok: '삭제', danger: true }))) return;
        await tryApi(() => saveList(key, state.data[key].filter((x) => x.id !== v.id)));
        editing = null;
        form.replaceChildren();
        renderList();
      };
      form.replaceChildren(
        h(
          'div',
          { class: 'card inner' },
          h('label', { class: 'field' }, 'id', id),
          built.el,
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, '저장'), h('button', { class: 'btn', onclick: () => openPreview() }, '게임 미리보기'), !isNew && h('button', { class: 'btn danger-outline', onclick: remove }, '삭제')),
        ),
      );
    }

    host.append(h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, title), h('button', { class: 'btn primary small', onclick: () => edit(null) }, '+ 새로 만들기')), list, form));
    renderList();
    return { edit, renderList };
  }

  const notices = section(noticeCol, {
    key: 'notices',
    title: '공지',
    blank: () => ({ id: `notice_${Date.now().toString(36)}`, title: '', body: '', date: nowIso(), popup: false }),
    summary: (n) => `${fmt(n.date)}${n.popup ? ' · 시작 팝업' : ''}`,
    fields: (v) => {
      const title = h('input', { value: v.title });
      const date = dateField('게시 시각 (이 시각부터 보임)', v.date, { allowEmpty: false });
      const popup = h('input', { type: 'checkbox', checked: v.popup });
      const body = h('textarea', { rows: 8 }, v.body);
      return {
        el: h('div', {}, h('label', { class: 'field' }, '제목', title), date.el, h('label', { class: 'inline' }, popup, '게임 시작 시 팝업으로 띄우기 ("다시 보지 않기" 가능)'), h('label', { class: 'field' }, '내용', body)),
        get: () => ({ title: title.value, body: body.value, date: date.get(), popup: popup.checked }),
      };
    },
  });

  const mail = section(mailCol, {
    key: 'mail',
    title: '우편 (선물)',
    blank: () => ({ id: `mail_${Date.now().toString(36)}`, title: '', body: '', rewards: { gems: 300 }, startAt: nowIso(), endAt: null }),
    summary: (m) => `보석 ${m.rewards?.gems ?? 0}${m.rewards?.tickets ? ` · 티켓 ${m.rewards.tickets}` : ''} · ${fmt(m.startAt)} ~ ${fmt(m.endAt)}`,
    fields: (v) => {
      const title = h('input', { value: v.title });
      const body = h('textarea', { rows: 3 }, v.body || '');
      const gems = h('input', { type: 'number', min: 0, step: 50, value: v.rewards?.gems ?? 0 });
      const tickets = h('input', { type: 'number', min: 0, step: 10, value: v.rewards?.tickets ?? 0 });
      const start = dateField('받기 시작', v.startAt);
      const end = dateField('받기 마감', v.endAt);
      return {
        el: h('div', {}, h('label', { class: 'field' }, '제목', title), h('label', { class: 'field' }, '내용', body), h('div', { class: 'grid2' }, h('label', { class: 'field' }, '보상 보석', gems), h('label', { class: 'field' }, '보상 티켓 (레벨업 재료)', tickets)), h('div', { class: 'grid2' }, start.el, end.el), h('p', { class: 'muted small' }, '한 사람이 한 번만 받을 수 있어요 (id 기준). 이미 공개한 우편의 id를 바꾸면 다시 받을 수 있게 되니 주의!')),
        get: () => {
          const rewards = { gems: Math.max(0, parseInt(gems.value, 10) || 0) };
          const t = Math.max(0, parseInt(tickets.value, 10) || 0);
          if (t) rewards.tickets = t;
          return { title: title.value, body: body.value, rewards, startAt: start.get(), endAt: end.get() };
        },
      };
    },
  });

  if (select) {
    const n = state.data.notices.find((x) => x.id === select);
    const m = state.data.mail.find((x) => x.id === select);
    if (n) notices.edit(n);
    if (m) mail.edit(m);
  }
  return { refresh: () => (notices.renderList(), mail.renderList()) };
}
