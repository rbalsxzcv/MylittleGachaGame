// 글 생성 모델 고르기: 작업(story / review / recap / profile / describe / imagePrompt)의 기본 모델이 미리 선택된 select
// 목록 = 기본(환경 변수 TG_TEXT_MODEL) + 설정 탭의 모델 목록. 값(모델 id)을 API 요청의 model로 보내면 이번 한 번만 그 모델로 생성
import { h } from './ui.js';
import { state } from './state.js';

export function modelPicker(task, { label = '글 모델' } = {}) {
  const ai = state.status?.ai || {};
  const models = ai.textModels?.length ? ai.textModels : [{ id: 'env', label: `기본 (${ai.textModel || '환경 변수'})` }];
  const def = (ai.textTasks || []).find((t) => t.key === task)?.model || 'env';
  const select = h(
    'select',
    { class: 'model-picker', title: '이번 생성에만 쓸 글 모델 (작업별 기본값은 설정 탭)' },
    models.map((m) => h('option', { value: m.id }, `${m.label}${m.id === def ? ' · 기본' : ''}`)),
  );
  select.value = def;
  const el = h('label', { class: 'inline model-pick' }, h('span', { class: 'muted small' }, label), select);
  return { el, get value() { return select.value; } };
}
