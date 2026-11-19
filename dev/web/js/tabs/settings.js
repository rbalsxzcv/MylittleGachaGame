// 설정 탭: Gemini 프롬프트 작성, ComfyUI 연결(주소/모델 파일/샘플러), 게임 분위기
import { h, toast, busy } from '../ui.js';
import { api, tryApi } from '../api.js';
import { state, reloadSettings, reloadStatus } from '../state.js';

export function settingsTab(root, { onSaved } = {}) {
  const s = structuredClone(state.settings);
  const c = s.comfy;

  const aiPrompt = h('input', { type: 'checkbox', checked: s.aiPrompt });
  const theme = h('textarea', { rows: 2 }, s.theme);

  const url = h('input', { value: c.url, placeholder: 'http://127.0.0.1:8188' });
  const ckpt = h('select', {}, h('option', { value: c.checkpoint }, c.checkpoint || '(연결 확인 후 선택)'));
  ckpt.value = c.checkpoint;
  const keep = (v, empty = '(연결 확인 후 선택)') => h('select', {}, h('option', { value: v }, v || empty));
  const loader = h('select', {}, h('option', { value: 'checkpoint' }, '체크포인트 한 파일 (SDXL, SD1.5 등)'), h('option', { value: 'split' }, '확산 모델 + 텍스트 인코더 + VAE 따로 (Anima, Flux 등)'));
  loader.value = c.loader;
  const unet = keep(c.unet);
  const weightDtype = keep(c.weightDtype);
  const clip = keep(c.clip);
  const clipType = keep(c.clipType);
  const vae = keep(c.vae);
  const ckptBox = h('div', {}, h('label', { class: 'field' }, '체크포인트 (models/checkpoints)', ckpt));
  const splitBox = h(
    'div',
    {},
    h('label', { class: 'field' }, '확산 모델 (models/diffusion_models)', unet),
    h('label', { class: 'field' }, '확산 모델 정밀도 (weight_dtype, 보통 default)', weightDtype),
    h('label', { class: 'field' }, '텍스트 인코더 (models/text_encoders)', clip),
    h('label', { class: 'field' }, '텍스트 인코더 종류 (CLIPLoader type)', clipType),
    h('label', { class: 'field' }, 'VAE (models/vae)', vae),
    h('p', { class: 'muted small' }, 'Anima / Anima Turbo 예: 텍스트 인코더 qwen_3_06b_base, VAE qwen_image_vae, 종류 stable_diffusion (안 되면 ComfyUI 예제 워크플로의 CLIPLoader type 값을 그대로 골라요). Turbo는 CFG 1, 스텝 8~12 정도로 맞춰요.'),
  );
  const showLoader = () => {
    ckptBox.hidden = loader.value !== 'checkpoint';
    splitBox.hidden = loader.value !== 'split';
  };
  loader.addEventListener('change', showLoader);
  showLoader();
  const resolution = h('select', {}, h('option', { value: 'sdxl' }, 'SDXL 계열 (1024 기준, 예: 896×1152)'), h('option', { value: 'sd15' }, 'SD 1.5 계열 (512 기준, 예: 576×768)'));
  resolution.value = c.resolution;
  const steps = h('input', { type: 'number', min: 1, max: 150, value: c.steps });
  const cfg = h('input', { type: 'number', min: 1, max: 30, step: 0.5, value: c.cfg });
  const sampler = h('select', {}, h('option', { value: c.sampler }, c.sampler));
  const scheduler = h('select', {}, h('option', { value: c.scheduler }, c.scheduler));
  const quality = h('input', { value: c.quality, placeholder: 'masterpiece, best quality, safe' });
  const negative = h('textarea', { rows: 3 }, c.negative);
  const checkResult = h('div', { class: 'check-result' });

  const fill = (sel, list, current) => {
    if (!list?.length) return;
    sel.replaceChildren(...list.map((v) => h('option', { value: v }, v)));
    sel.value = list.includes(current) ? current : list[0];
  };

  async function check() {
    const r = await busy('ComfyUI 연결 확인 중…', () => tryApi(() => api.post('/api/comfy/check', { url: url.value })));
    if (!r) return;
    if (!r.ok) {
      checkResult.replaceChildren(h('p', { class: 'error' }, `✕ ${r.error}`));
      return;
    }
    fill(ckpt, r.checkpoints, ckpt.value);
    fill(unet, r.unets, unet.value);
    fill(weightDtype, r.weightDtypes, weightDtype.value);
    fill(clip, r.clips, clip.value);
    fill(clipType, r.clipTypes, clipType.value);
    fill(vae, r.vaes, vae.value);
    fill(sampler, r.samplers, sampler.value);
    fill(scheduler, r.schedulers, scheduler.value);
    const lines = [
      h('p', { class: 'ok-text' }, `✓ 연결됨 ${r.version ? `(ComfyUI ${r.version})` : ''}`),
      h('p', { class: 'muted small' }, `장치: ${r.devices.join(', ') || '-'} · 체크포인트 ${r.checkpoints.length}개 · 확산 모델 ${r.unets.length}개 · 텍스트 인코더 ${r.clips.length}개 · VAE ${r.vaes.length}개`),
    ];
    if (loader.value === 'checkpoint' && r.checkpoints.length === 0) {
      lines.push(h('p', { class: 'error' }, r.unets.length ? '체크포인트는 없지만 확산 모델이 있어요. 위의 "모델 불러오기 방식"을 "따로"로 바꿔 보세요.' : 'ComfyUI/models/checkpoints 폴더에 체크포인트(.safetensors)를 넣어 주세요'));
    }
    if (loader.value === 'split') {
      const miss = [['diffusion_models', r.unets], ['text_encoders', r.clips], ['vae', r.vaes]].filter(([, l]) => !l.length).map(([d]) => d);
      if (miss.length) lines.push(h('p', { class: 'error' }, `ComfyUI/models/ 아래 ${miss.join(', ')} 폴더에 파일을 넣어 주세요`));
    }
    checkResult.replaceChildren(...lines);
  }

  async function save() {
    const data = {
      aiPrompt: aiPrompt.checked,
      theme: theme.value,
      comfy: { url: url.value, loader: loader.value, checkpoint: ckpt.value, unet: unet.value, weightDtype: weightDtype.value, clip: clip.value, clipType: clipType.value, vae: vae.value, resolution: resolution.value, steps: Number(steps.value), cfg: Number(cfg.value), sampler: sampler.value, scheduler: scheduler.value, quality: quality.value, negative: negative.value },
    };
    const r = await tryApi(() => api.put('/api/settings', data));
    if (!r) return;
    await reloadSettings();
    await reloadStatus();
    onSaved?.();
    toast('설정을 저장했어요', 'success');
  }

  root.replaceChildren(
    h(
      'div',
      { class: 'two-col even' },
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '그림 생성'),
        h('p', { class: 'muted small' }, '그림은 모두 ComfyUI(Anima)로 그려요. 프롬프트는 에셋 종류(캐릭터 / 배너 / 배경 / 아이콘 / 로고)마다 Anima에 맞춘 규칙으로 써요.'),
        h('label', { class: 'inline' }, aiPrompt, ' Gemini가 Anima용 그림 프롬프트를 작성 (끄면 에셋 종류별 기본 태그 + 입력값 사용)'),
        h('p', { class: 'muted small' }, 'Gemini는 Vertex AI 키(dev/.env)로 동작해요. 키가 없으면 기본 태그 프롬프트를 써요.'),
        h('label', { class: 'field' }, '게임 전체 분위기 (UI 에셋 프롬프트에 함께 들어가요)', theme),
        h('p', { class: 'muted small' }, '공통 스타일 문구 파일: dev/style.txt (캐릭터), style_banner.txt (배너), style_bg.txt (배경), style_icon.txt (아이콘)'),
        h('button', { class: 'btn primary', onclick: save }, '저장'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'ComfyUI 연결'),
        h('p', { class: 'muted small' }, 'ComfyUI를 먼저 실행해 두세요. 개발 도구가 내장된 기본 워크플로(모델 불러오기 → 프롬프트 → KSampler → 저장)를 ComfyUI에 보내서 그려요.'),
        h('label', { class: 'field' }, 'ComfyUI 주소', h('div', { class: 'row' }, url, h('button', { class: 'btn', onclick: check }, '연결 확인'))),
        checkResult,
        h('label', { class: 'field' }, '모델 불러오기 방식', loader),
        ckptBox,
        splitBox,
        h('label', { class: 'field' }, '해상도 기준', resolution),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, '스텝', steps), h('label', { class: 'field' }, 'CFG', cfg), h('label', { class: 'field' }, '샘플러', sampler), h('label', { class: 'field' }, '스케줄러', scheduler)),
        h('label', { class: 'field' }, '품질 태그 (프롬프트 맨 앞에 붙어요, Anima 권장: masterpiece, best quality, safe)', quality),
        h('label', { class: 'field' }, '기본 네거티브 프롬프트 (모든 생성에 붙어요 · CFG 1이면 적용되지 않아요)', negative),
        h('button', { class: 'btn primary', onclick: save }, '저장'),
      ),
    ),
  );
  return {};
}
