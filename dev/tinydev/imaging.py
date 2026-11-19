"""그림 생성 파이프라인: Gemini가 Anima용 프롬프트 작성 → ComfyUI로 그리기.

  write_prompt()      요청서(brief) + 에셋 종류별 규칙 + 거절 사유 → 프롬프트 (개발자가 보고 고칠 수 있음)
  render()            품질 태그 + 프롬프트 + 공통 스타일 → ComfyUI → 그림 바이트
  generate_attempt()  위 둘을 묶어서 작업(job)에 시도 하나 추가 (생성 화면, 일괄 생성 공용)
"""
from . import comfy, config, genai, jobs, prompts, settings, store, uislots
from .genai import GenError

ENGINE = "comfy"  # 그림은 ComfyUI로만
# 캐릭터는 세로로 긴 2:3 (가로 여유가 적을수록 정면+후면 같은 설정화가 덜 나옴, 배경 제거 후 여백은 잘라냄)
ASPECT = {"char": "2:3", "banner": "16:9", "bg": "16:9", "ui_bg": "16:9", "ui_icon": "1:1", "logo": "3:2"}
SLOT_PKIND = {"bg": "ui_bg", "icon": "ui_icon", "logo": "logo"}


def resolve_engine(engine=None, s=None):
    """예전 코드/작업 기록 호환용: 항상 ComfyUI"""
    return ENGINE


def _context(kind, inp, s):
    """작업 종류별: 에셋 종류(pkind), 요청서, 비율, UI 칸, 픽업 캐릭터"""
    slot = None
    if kind == "ui":
        slot = uislots.SLOT_BY_KEY.get(inp.get("slot"))
        if not slot:
            raise ValueError("알 수 없는 UI 칸이에요")
        pkind = SLOT_PKIND[slot["kind"]]
    else:
        pkind = kind
    chars = []
    if kind == "banner":
        by_id = {c["id"]: c for c in store.read_list("characters")}
        chars = [{**by_id[i], "look": jobs.char_look(i)} for i in inp.get("pickupIds", []) if i in by_id][:4]
    return pkind, prompts.brief(pkind, inp, chars, s["theme"], slot), ASPECT[pkind], slot, chars


def write_prompt(kind, inp, engine=None, reasons=(), previous=None):
    """그림 프롬프트 작성 → {prompt, negative, source, engine, brief}
    source: 'ai'(Gemini) | 'mock'(Gemini 없음 → 기본 태그) | 'template'(AI 작성 꺼짐 → 기본 태그)
    """
    s = settings.load()
    pkind, brief, _, slot, chars = _context(kind, inp, s)
    if not s["aiPrompt"] or genai.is_mock():
        prompt, negative = prompts.template_prompt(pkind, inp, slot, chars, list(reasons))
        return {"prompt": prompt, "negative": negative, "source": "template" if not s["aiPrompt"] else "mock", "engine": ENGINE, "brief": brief}
    raw = genai.generate_text(prompts.writer_prompt(pkind, brief, prompts.style_for(pkind), list(reasons), previous), json_mode=True)
    data = genai.parse_json_text(raw)
    prompt = str((data or {}).get("prompt") or "").strip() if isinstance(data, dict) else ""
    if not prompt:
        raise GenError("Gemini가 프롬프트를 만들지 못했어요. 다시 시도하거나 직접 입력해 주세요")
    negative = str(data.get("negative") or "").strip()
    return {"prompt": prompt, "negative": negative, "source": "ai", "engine": ENGINE, "brief": brief}


def render(kind, inp, core_prompt, negative, cancel=None):
    """프롬프트 → 그림. returns {image, fullPrompt, negative, seed, engine, warning}"""
    s = settings.load()
    pkind, _, ratio, slot, _ = _context(kind, inp, s)
    c = s["comfy"]
    core, removed = prompts.enforce(pkind, core_prompt)
    full = prompts.merge_tags(c["quality"], core, prompts.style_for(pkind))
    neg = prompts.merge_tags(negative, prompts.KIND_NEGATIVE[pkind], c["negative"])
    notes = []
    if removed:
        notes.append(f"용도에 안 맞는 태그를 뺐어요: {', '.join(removed)[:200]}")
    if c["cfg"] <= 1.0:
        notes.append("CFG 1이라 네거티브는 적용되지 않아요 (용도별 필수 태그로 대신 막아요)")
    warning = " · ".join(notes) or None
    if config.FORCE_MOCK:
        label = inp.get("name") or inp.get("title") or inp.get("bgName") or (slot or {}).get("label") or ""
        mock_kind = "char" if pkind in ("char", "ui_icon", "logo") else ("banner" if pkind == "banner" else "bg")
        image, seed = genai._mock_image(full, ratio, mock_kind, label), None
        warning = " · ".join(notes + ["모의 모드 그림이에요 (TG_MOCK=1)"])
    else:
        image, seed = comfy.generate(full, neg, ratio, c, cancel=cancel)
    return {"image": image, "fullPrompt": full, "negative": neg, "seed": seed, "engine": ENGINE, "warning": warning}


def generate_attempt(job, prompt=None, negative="", source="manual", rewrite=False, cancel=None):
    """작업에 시도 하나 추가
    - prompt를 주면 그대로 사용 (개발자가 확인/수정한 프롬프트)
    - 없으면: rewrite=True(거절 후) → Gemini가 이전 프롬프트 + 모든 거절 사유로 다시 작성
              처음 생성 → Gemini가 작성 / 그냥 다시 생성 → 직전 프롬프트 그대로 (새 seed)
    cancel: threading.Event (일괄 생성 중단용)
    """
    last = job["attempts"][-1] if job["attempts"] else None
    if prompt is None:
        if last and not rewrite:
            prompt, negative, source = last.get("corePrompt") or last["prompt"], last.get("negative") or "", last.get("promptSource") or "manual"
        else:
            previous = (last.get("corePrompt") or last["prompt"]) if last else None
            w = write_prompt(job["kind"], job["input"], reasons=jobs.reject_reasons(job), previous=previous)
            prompt, negative, source = w["prompt"], w["negative"], w["source"]
    if cancel is not None and cancel.is_set():
        raise comfy.Cancelled("중단했어요")
    r = render(job["kind"], job["input"], prompt, negative or "", cancel=cancel)
    full = r["fullPrompt"] + (f"\n\nNEGATIVE: {r['negative']}" if r["negative"] else "")
    meta = {"corePrompt": prompt, "negative": negative or "", "engine": r["engine"], "seed": r["seed"], "promptSource": source, "genWarning": r["warning"]}
    jobs.add_attempt(job, full, r["image"], meta)
    return job


def engine_status():
    """상단 표시용"""
    s = settings.load()
    return {
        "engine": ENGINE,
        "engineLabel": "ComfyUI",
        "aiPrompt": s["aiPrompt"],
        "comfyUrl": s["comfy"]["url"],
        "comfyCheckpoint": comfy.model_label(s["comfy"]),
    }
