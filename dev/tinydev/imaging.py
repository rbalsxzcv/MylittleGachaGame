"""그림 생성 파이프라인: Gemini가 Anima용 프롬프트 작성 → ComfyUI로 그리기.

  write_prompt()      요청서(brief) + 에셋 종류별 규칙 + 거절 사유 → 프롬프트 (개발자가 보고 고칠 수 있음)
  render()            품질 태그 + 프롬프트 + 공통 스타일 → ComfyUI → 그림 바이트
  generate_attempt()  위 둘을 묶어서 작업(job)에 시도 하나 추가 (생성 화면, 일괄 생성 공용)
"""
from . import comfy, config, genai, jobs, prompts, settings, store, uislots
from .genai import GenError

ENGINE = "comfy"  # 그림은 ComfyUI로만
# 캐릭터는 세로로 긴 2:3 (가로 여유가 적을수록 정면+후면 같은 설정화가 덜 나옴, 배경 제거 후 여백은 잘라냄)
ASPECT = {"char": "2:3", "banner": "16:9", "bg": "16:9", "ui_bg": "16:9", "ui_icon": "1:1", "logo": "3:2", "enemy": "1:1", "prop": "1:1", "memory": "2:3", "battle_bg": "16:9"}
SLOT_PKIND = {"bg": "ui_bg", "icon": "ui_icon", "logo": "logo"}
JOB_PKIND = {"stagebg": "battle_bg"}  # 작업 종류 ≠ 프롬프트 규칙 종류일 때
# 에셋 종류 → LoRA 프로필 (설정 탭에서 캐릭터용 / 배경·소품용을 따로 설정)
LORA_PROFILE = {"char": "char", "banner": "char", "enemy": "char", "bg": "scene", "ui_bg": "scene", "ui_icon": "scene", "logo": "scene", "prop": "scene", "memory": "char", "battle_bg": "scene"}


def lora_profile(pkind, c):
    """이 에셋 종류에 쓸 LoRA 프로필 → (프로필 이름, {loras, trigger})"""
    name = LORA_PROFILE.get(pkind, "scene")
    return name, c["loraProfiles"][name]


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
        pkind = slot.get("pkind") or SLOT_PKIND[slot["kind"]]
    else:
        pkind = JOB_PKIND.get(kind, kind)
    chars = []
    if kind == "banner":
        by_id = {c["id"]: c for c in store.read_list("characters")}
        chars = [{**by_id[i], "look": jobs.char_look(i)} for i in inp.get("pickupIds", []) if i in by_id][:4]
    elif kind == "memory" and inp.get("featuredCharacterId"):
        c = next((x for x in store.read_list("characters") if x.get("id") == inp["featuredCharacterId"]), None)
        if c:
            chars = [{**c, "appearance": appearance_of(c)}]
    return pkind, prompts.brief(pkind, inp, chars, s["theme"], slot), ASPECT[pkind], slot, chars


def appearance_of(c):
    """캐릭터 외형 슬롯 {body, hair, eyes, outfit, props}: 승인할 때 저장한 값 → 없으면 승인한 그림 프롬프트에서 만들어 저장 (한 번)"""
    app = c.get("appearance")
    if isinstance(app, dict) and any(app.values()):
        return app
    look = jobs.char_look(c["id"]) or c.get("keywords", "")
    app = prompts.split_look(look)
    if any(app.values()):
        chars = store.read_list("characters")
        for x in chars:
            if x.get("id") == c["id"]:
                x["appearance"] = app
        store.write_list("characters", chars)
    return app


def _memory_init(inp, chars, c):
    """img2img 시작 그림: 승인한 캐릭터 컷아웃을 대충 그린 배경(위아래 그라데이션)에 합성 → ComfyUI에 올림"""
    if not chars or not chars[0].get("image"):
        return None
    from PIL import Image

    path = config.WORKSPACE / chars[0]["image"]
    if not path.exists():
        return None
    w, h = comfy.SIZES[c["resolution"]]["2:3"]
    canvas = Image.new("RGB", (w, h))
    top, bottom = (70, 60, 110), (200, 170, 140)
    for y in range(h):
        t = y / max(1, h - 1)
        canvas.paste(tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)), (0, y, w, y + 1))
    fig = Image.open(path).convert("RGBA")
    scale = (h * 0.92) / fig.height
    fig = fig.resize((max(1, int(fig.width * scale)), max(1, int(fig.height * scale))), Image.LANCZOS)
    canvas.paste(fig, ((w - fig.width) // 2, h - fig.height), fig)
    import io as _io

    buf = _io.BytesIO()
    canvas.save(buf, "PNG")
    return comfy.upload_image(c, buf.getvalue(), f"tg_memory_{inp.get('memoryId', 'x')}.png")


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


def _assemble(kind, inp, core_prompt, negative, s):
    """핵심 프롬프트 → 실제로 보낼 프롬프트/네거티브/LoRA (생성 · 하이레스 다듬기 공용)"""
    pkind, _, ratio, slot, chars = _context(kind, inp, s)
    c = s["comfy"]
    core, removed = prompts.enforce(pkind, core_prompt)
    if pkind == "memory" and chars:
        # 외형 슬롯은 AI가 쓴 프롬프트와 상관없이 맨 앞에 그대로 (merge_tags가 중복은 하나로)
        core = prompts.merge_tags(prompts.appearance_text(chars[0].get("appearance")), core)
    _, lp = lora_profile(pkind, c)
    loras = comfy.active_loras(lp["loras"])
    full = prompts.merge_tags(c["quality"], lp["trigger"] if loras else "", core, prompts.style_for(pkind))
    neg = prompts.merge_tags(negative, prompts.KIND_NEGATIVE[pkind], c["negative"])
    notes = []
    if removed:
        notes.append(f"용도에 안 맞는 태그를 뺐어요: {', '.join(removed)[:200]}")
    if c["cfg"] <= 1.0:
        notes.append("CFG 1이라 네거티브는 적용되지 않아요 (용도별 필수 태그로 대신 막아요)")
    lora_text = ", ".join(f"{l['name']} (model {l['model']:g} / clip {l['clip']:g})" for l in loras)
    return {"pkind": pkind, "ratio": ratio, "slot": slot, "chars": chars, "full": full, "neg": neg, "loras": loras, "loraText": lora_text, "notes": notes}


def render(kind, inp, core_prompt, negative, cancel=None):
    """프롬프트 → 그림. returns {image, fullPrompt, negative, seed, engine, warning, loras}
    추억 카드도 1차만 (하이레스는 hires_attempt로 시도마다 따로)"""
    s = settings.load()
    c = s["comfy"]
    a = _assemble(kind, inp, core_prompt, negative, s)
    pkind, ratio, full, neg, notes = a["pkind"], a["ratio"], a["full"], a["neg"], a["notes"]
    init, denoise = None, 1.0
    if pkind == "memory" and (inp.get("img2img") if inp.get("img2img") is not None else c["memoryImg2img"]) and not config.FORCE_MOCK:
        init = _memory_init(inp, a["chars"], c)
        denoise = c["img2imgDenoise"] if init else 1.0
    warning = " · ".join(notes) or None
    if config.FORCE_MOCK:
        label = inp.get("name") or inp.get("label") or inp.get("title") or inp.get("bgName") or (a["slot"] or {}).get("label") or ""
        mock_kind = "char" if pkind in ("char", "ui_icon", "logo", "enemy", "prop", "memory") else ("banner" if pkind == "banner" else "bg")
        image, seed = genai._mock_image(full, ratio, mock_kind, label), None
        warning = " · ".join(notes + ["모의 모드 그림이에요 (TG_MOCK=1)"])
    else:
        image, seed = comfy.generate(full, neg, ratio, c, cancel=cancel, loras=a["loras"], seed=inp.get("seed"), init_image=init, denoise=denoise)
    return {"image": image, "fullPrompt": full, "negative": neg, "seed": seed, "engine": ENGINE, "warning": warning, "loras": a["loraText"]}


def _with_meta(full, neg, lora_text):
    """시도 기록용 프롬프트 텍스트 (네거티브 · LoRA 포함)"""
    return full + (f"\n\nNEGATIVE: {neg}" if neg else "") + (f"\n\nLORA: {lora_text}" if lora_text else "")


def hires_attempt(job, n, cancel=None):
    """추억 카드: 고른 시도의 원본을 하이레스로 다듬어 새 시도로 추가 (설정 comfy.memoryHires: scale배 · steps스텝 · denoise)
    1차 생성은 다시 안 돎 → 원본 PNG를 확대해서 img2img 한 번만"""
    if job["kind"] != "memory":
        raise ValueError("하이레스 다듬기는 추억 카드 작업에서만 할 수 있어요")
    src = jobs.get_attempt(job, n)
    if src.get("hires"):
        raise ValueError("이미 하이레스로 다듬은 시도예요 (원래 시도에서 다시 해 주세요)")
    s = settings.load()
    c, hr = s["comfy"], s["comfy"]["memoryHires"]
    core, negative = src.get("corePrompt") or src["prompt"], src.get("negative") or ""
    a = _assemble(job["kind"], job["input"], core, negative, s)
    original = (jobs.job_dir(job["id"]) / src["original"]).read_bytes()
    notes = list(a["notes"])
    if config.FORCE_MOCK:
        from PIL import Image
        import io as _io

        img = Image.open(_io.BytesIO(original)).convert("RGB")
        img = img.resize((round(img.width * hr["scale"]), round(img.height * hr["scale"])), Image.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, "PNG")
        image, seed = buf.getvalue(), src.get("seed")
        notes.append("모의 모드: 확대만 했어요 (TG_MOCK=1)")
    else:
        if cancel is not None and cancel.is_set():
            raise comfy.Cancelled("중단했어요")
        image, seed = comfy.refine(a["full"], a["neg"], original, c, hr, cancel=cancel, loras=a["loras"], seed=src.get("seed"))
    meta = {
        "corePrompt": core,
        "negative": negative,
        "engine": ENGINE,
        "seed": seed,
        "promptSource": src.get("promptSource") or "manual",
        "genWarning": " · ".join(notes) or None,
        "hires": {"of": src["n"], "scale": hr["scale"], "steps": hr["steps"], "denoise": hr["denoise"]},
    }
    jobs.add_attempt(job, _with_meta(a["full"], a["neg"], a["loraText"]), image, meta)
    return job


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
    full = _with_meta(r["fullPrompt"], r["negative"], r["loras"])
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
