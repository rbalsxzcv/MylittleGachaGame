"""개발 도구 웹 서버 (Flask). 반드시 127.0.0.1(내 컴퓨터)에서만 열립니다.

보안
- Host 헤더가 localhost/127.0.0.1이 아니면 거부 (DNS 리바인딩 방지)
- 데이터를 바꾸는 요청(POST/PUT/DELETE)은 'X-Tiny-Dev: 1' 헤더가 있어야 함
  → 다른 웹사이트가 몰래 이 서버에 요청을 보내 파일을 바꾸거나 git push 하는 것 방지
"""
import json
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_from_directory

from . import batch, comfy, config, cutout, genai, imaging, jobs, prompts, publish, settings, store, uislots
from .genai import GenError
from .timeutil import now_iso, parse

app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False
app.json.sort_keys = False

ALLOWED_HOSTS = {"localhost", "127.0.0.1"}


# ─────────────────────────────────────────────────────────
# 공통: 보안 검사, 오류 응답
# ─────────────────────────────────────────────────────────
@app.before_request
def guard():
    host = (request.host or "").rsplit(":", 1)[0].strip("[]")
    if host not in ALLOWED_HOSTS:
        abort(403)
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("X-Tiny-Dev") != "1":
        abort(403)


@app.after_request
def no_cache(resp):
    # 개발 중에는 항상 최신 파일을 보도록
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(GenError)
def on_gen_error(e):
    return jsonify(error=str(e)), 502


@app.errorhandler(ValueError)
def on_value_error(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(FileNotFoundError)
def on_missing(e):
    return jsonify(error=str(e) or "찾을 수 없어요"), 404


@app.errorhandler(store.JsonError)
def on_json_error(e):
    return jsonify(error=str(e)), 409


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("요청 형식이 잘못됐어요 (JSON 객체 필요)")
    return data


def text(data, key, limit=4000, required=False, label=None):
    value = data.get(key, "")
    if not isinstance(value, str):
        value = ""
    value = value.strip()[:limit]
    if required and not value:
        raise ValueError(f"{label or key}을(를) 입력해 주세요")
    return value


# ─────────────────────────────────────────────────────────
# 정적 파일: 개발 도구 화면, 작업 공간 이미지, 기록, 미리보기
# ─────────────────────────────────────────────────────────
@app.get("/")
def index():
    return send_from_directory(config.WEB, "dev.html")


@app.get("/web/<path:path>")
def web(path):
    return send_from_directory(config.WEB, path)


@app.get("/ws/<path:path>")
def workspace_file(path):
    if not path.startswith("assets/"):
        abort(404)
    return send_from_directory(config.WORKSPACE, path)


@app.get("/history/<job_id>/<name>")
def history_file(job_id, name):
    return send_from_directory(jobs.job_dir(job_id), name)


@app.get("/preview/")
def preview_root():
    return redirect("/preview/index.html")


@app.get("/preview/<path:path>")
def preview(path):
    """플레이어 게임을 그대로 띄우되, data/와 assets/는 작업 공간에서 제공
    → 배포 전 내용을 실제 게임 화면과 똑같이 확인"""
    if path == "data/version.json":
        return send_from_directory(config.PUBLIC_DATA, "version.json")
    if path.startswith("data/") or path.startswith("assets/"):
        store.ensure_workspace()
        target = config.WORKSPACE / path
        if path.startswith("assets/") and not target.exists():
            return send_from_directory(config.ROOT, path)  # 아이콘 등 공개 자산
        return send_from_directory(config.WORKSPACE, path)
    allowed = path in ("index.html", "style.css", "manifest.webmanifest") or path.startswith("js/")
    if not allowed:
        abort(404)
    return send_from_directory(config.ROOT, path)


# ─────────────────────────────────────────────────────────
# 상태 / 데이터
# ─────────────────────────────────────────────────────────
@app.get("/api/status")
def status():
    created = store.ensure_workspace()
    return jsonify(ai=genai.status(), image=imaging.engine_status(), rmbg=cutout.status(), git=publish.git_status(), workspaceCreated=created, now=now_iso())


# ─────────────────────────────────────────────────────────
# 설정 (그림 엔진, ComfyUI)
# ─────────────────────────────────────────────────────────
@app.get("/api/settings")
def get_settings():
    return jsonify(settings.load())


@app.put("/api/settings")
def put_settings():
    return jsonify(settings.save(body()))


@app.post("/api/comfy/check")
def comfy_check():
    """ComfyUI 연결 확인 + 체크포인트/샘플러 목록 (url을 주면 저장 전 주소로 시험)"""
    data = request.get_json(silent=True) or {}
    cfg = dict(settings.load()["comfy"])
    if isinstance(data.get("url"), str) and data["url"].strip():
        cfg["url"] = settings.clean({**settings.load(), "comfy": {**cfg, "url": data["url"]}})["comfy"]["url"]
    try:
        return jsonify({**comfy.check(cfg), "url": cfg["url"]})
    except GenError as e:
        return jsonify(ok=False, url=cfg["url"], error=str(e))


@app.get("/api/data")
def data():
    return jsonify(store.load_all())


@app.get("/api/assets")
def list_assets():
    sub = request.args.get("dir", "bg")
    if sub not in store.ASSET_DIRS:
        raise ValueError("잘못된 폴더")
    folder = store.ws_assets(sub)
    files = sorted(p.name for p in folder.glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")) if folder.exists() else []
    return jsonify([f"assets/{sub}/{f}" for f in files])


def _check_list(items, label):
    if not isinstance(items, list):
        raise ValueError(f"{label}: 목록이 아니에요")
    seen = set()
    for it in items:
        if not isinstance(it, dict) or not store.valid_id(it.get("id")):
            raise ValueError(f"{label}: id가 올바르지 않은 항목이 있어요 ({(it or {}).get('id')!r})")
        if it["id"] in seen:
            raise ValueError(f"{label}: id '{it['id']}'가 중복돼요")
        seen.add(it["id"])
    return items


@app.put("/api/list/<key>")
def save_list(key):
    """배너/공지/우편/스토리 목록 전체 저장"""
    if key not in ("banners", "notices", "mail", "storyIndex"):
        abort(404)
    items = _check_list(request.get_json(silent=True), key)
    store.write_list(key, items)
    return jsonify(ok=True, count=len(items))


# ─────────────────────────────────────────────────────────
# 생성 작업 공통 (캐릭터/배너/배경)
# ─────────────────────────────────────────────────────────
def _gen_options(data):
    """생성 요청 공통 옵션: (개발자가 확인/수정한) 프롬프트. 그림 엔진은 ComfyUI 고정"""
    prompt = text(data, "prompt", 4000) or None
    negative = text(data, "negative", 2000)
    source = data.get("promptSource") if data.get("promptSource") in ("ai", "mock", "template", "manual") else "manual"
    return {"prompt": prompt, "negative": negative, "source": source}


def _create_and_generate(kind, inp, data):
    opts = _gen_options(data)
    job = jobs.create(kind, {**inp, "engine": imaging.ENGINE})
    return imaging.generate_attempt(job, opts["prompt"], opts["negative"], opts["source"])


@app.post("/api/prompt/write")
def prompt_write():
    """생성 전에 Gemini가 쓴 프롬프트를 먼저 보고 고칠 수 있게"""
    data = body()
    kind = data.get("kind")
    inputs = {"char": _char_input, "banner": _banner_input, "bg": _bg_input, "ui": _ui_input}
    if kind not in inputs:
        raise ValueError("잘못된 종류")
    inp = inputs[kind](data.get("input") or {})
    return jsonify(imaging.write_prompt(kind, inp))


@app.get("/api/jobs")
def list_jobs():
    return jsonify(jobs.list_jobs(request.args.get("kind")))


@app.get("/api/jobs/<job_id>")
def get_job(job_id):
    return jsonify(jobs.load(job_id))


@app.post("/api/jobs/<job_id>/reject")
def reject_job(job_id):
    """거절: 사유를 기록하고, 지금까지의 사유를 모두 합친 프롬프트로 다시 생성"""
    data = body()
    job = jobs.load(job_id)
    reason = text(data, "reason", 1000, required=True, label="거절 사유")
    jobs.reject(job, data.get("attempt"), reason)
    return jsonify(imaging.generate_attempt(job, rewrite=True))


@app.post("/api/jobs/<job_id>/regenerate")
def regenerate_job(job_id):
    """다시 생성. prompt를 주면 그 프롬프트로(직접 수정), 없으면 직전 프롬프트로 새로 뽑기"""
    data = request.get_json(silent=True) or {}
    opts = _gen_options(data)
    return jsonify(imaging.generate_attempt(jobs.load(job_id), opts["prompt"], opts["negative"], opts["source"]))


@app.post("/api/jobs/<job_id>/recut")
def recut_job(job_id):
    """같은 원본으로 배경 제거만 다시 (flatten: '#ffffff' 처럼 주면 배경을 단색으로 먼저 칠함)"""
    data = body()
    job = jobs.load(job_id)
    if not jobs.is_cutout_job(job):
        raise ValueError("배경 제거는 캐릭터/아이콘 작업에서만 할 수 있어요")
    flatten = data.get("flatten") or None
    if flatten and not (isinstance(flatten, str) and flatten.startswith("#") and len(flatten) in (4, 7)):
        raise ValueError("색은 #ffffff 형식이어야 해요")
    jobs.redo_cutout(job, data.get("attempt"), flatten)
    return jsonify(job)


# ─────────────────────────────────────────────────────────
# 캐릭터
# ─────────────────────────────────────────────────────────
def _char_input(data):
    rarity = data.get("rarity")
    if rarity not in ("R", "SR", "SSR"):
        raise ValueError("희귀도를 골라 주세요")
    return {
        "name": text(data, "name", 40, required=True, label="이름"),
        "rarity": rarity,
        "title": text(data, "title", 60),
        "keywords": text(data, "keywords", 1000, required=True, label="외형 키워드"),
        "lore": text(data, "lore", 2000),
        "charId": data.get("charId") if store.valid_id(data.get("charId")) else None,
    }


@app.post("/api/char/generate")
def char_generate():
    data = body()
    return jsonify(_create_and_generate("char", _char_input(data), data))


@app.post("/api/char/describe")
def char_describe():
    data = body()
    inp = {
        "name": text(data, "name", 40, required=True, label="이름"),
        "rarity": data.get("rarity", ""),
        "title": text(data, "title", 60),
        "keywords": text(data, "keywords", 1000),
        "lore": text(data, "lore", 2000),
        "current": text(data, "current", 2000),
        "feedback": text(data, "feedback", 1000),
    }
    examples = [c for c in store.read_list("characters") if c.get("description")]
    result = genai.generate_text(prompts.describe(inp, examples), mock=lambda: prompts.mock_describe(inp))
    return jsonify(description=result.strip().strip('"'))


@app.post("/api/char/approve")
def char_approve():
    """승인: 결과 PNG를 assets/chars/<id>.png로 저장하고 characters.json에 추가/갱신"""
    data = body()
    job = jobs.load(data.get("jobId", ""))
    if job["kind"] != "char":
        raise ValueError("캐릭터 작업이 아니에요")
    src = jobs.result_path(job, data.get("attempt"))
    c = data.get("character") or {}
    cid = c.get("id")
    if not store.valid_id(cid):
        raise ValueError("캐릭터 id는 영문/숫자/_/- 로 1~64자여야 해요 (예: ssr_lumi)")
    rarity = c.get("rarity")
    if rarity not in ("R", "SR", "SSR"):
        raise ValueError("희귀도를 골라 주세요")
    chars = store.read_list("characters")
    existing = next((x for x in chars if x.get("id") == cid), None)
    replacing = job["input"].get("charId") == cid
    if existing and not replacing and not data.get("overwrite"):
        raise ValueError(f"id '{cid}'는 이미 있어요. 다른 id를 쓰거나 '기존 캐릭터 그림 교체'로 진행해 주세요")

    rel = f"assets/chars/{cid}.png"
    dest = config.WORKSPACE / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(src.read_bytes())

    added = c.get("addedAt") if parse(c.get("addedAt") or "") else None
    entry = {
        "id": cid,
        "name": text(c, "name", 40, required=True, label="이름"),
        "rarity": rarity,
        "title": text(c, "title", 60),
        "description": text(c, "description", 2000),
        "image": rel,
        "addedAt": added or (existing or {}).get("addedAt") or now_iso(),
    }
    if existing:
        chars[chars.index(existing)] = entry
    else:
        chars.append(entry)
    store.write_list("characters", chars)
    jobs.mark_approved(job, data.get("attempt"), rel)
    return jsonify(character=entry, created=not existing)


def _char_refs(cid):
    """이 캐릭터를 쓰는 곳 (삭제 전 확인용)"""
    refs = []
    for b in store.read_list("banners"):
        if cid in (b.get("pickupIds") or []):
            refs.append(f"배너 「{b.get('title')}」 픽업")
    for s in store.read_list("storyIndex"):
        if s.get("characterId") == cid:
            refs.append(f"스토리 「{s.get('title')}」 대상 캐릭터")
        for cond in s.get("unlock") or []:
            if isinstance(cond, dict) and cond.get("characterId") == cid:
                refs.append(f"스토리 「{s.get('title')}」 해금 조건")
        try:
            story = store.read_story(s["id"]) or {}
        except (store.JsonError, ValueError):
            continue
        if any((ln or {}).get("speaker") == cid for sc in story.get("scenes") or [] for ln in (sc or {}).get("lines") or []):
            refs.append(f"스토리 「{s.get('title')}」 대사")
    return refs


@app.put("/api/characters/<cid>")
def char_update(cid):
    data = body()
    chars = store.read_list("characters")
    existing = next((x for x in chars if x.get("id") == cid), None)
    if not existing:
        raise FileNotFoundError("캐릭터가 없어요")
    if "rarity" in data:
        if data["rarity"] not in ("R", "SR", "SSR"):
            raise ValueError("희귀도는 R/SR/SSR")
        existing["rarity"] = data["rarity"]
    for key, limit in (("name", 40), ("title", 60), ("description", 2000)):
        if key in data:
            existing[key] = text(data, key, limit, required=(key == "name"), label="이름")
    if "addedAt" in data:
        if not parse(data["addedAt"] or ""):
            raise ValueError("addedAt 날짜 형식이 잘못됐어요")
        existing["addedAt"] = data["addedAt"]
    store.write_list("characters", chars)
    return jsonify(existing)


@app.get("/api/characters/<cid>/refs")
def char_refs(cid):
    return jsonify(_char_refs(cid))


@app.delete("/api/characters/<cid>")
def char_delete(cid):
    refs = _char_refs(cid)
    if refs and request.args.get("force") != "1":
        return jsonify(error="다른 콘텐츠에서 사용 중이에요", refs=refs), 409
    chars = store.read_list("characters")
    target = next((x for x in chars if x.get("id") == cid), None)
    if not target:
        raise FileNotFoundError("캐릭터가 없어요")
    chars.remove(target)
    store.write_list("characters", chars)
    if target.get("image") and store.asset_exists_ws(target["image"]):
        store.move_to_trash(config.WORKSPACE / target["image"])
    return jsonify(ok=True)


# ─────────────────────────────────────────────────────────
# 배너 그림 / 스토리 배경 그림
# ─────────────────────────────────────────────────────────
def _banner_input(data):
    bid = data.get("bannerId")
    if not store.valid_id(bid):
        raise ValueError("배너 id가 올바르지 않아요")
    return {
        "bannerId": bid,
        "title": text(data, "title", 80),
        "description": text(data, "description", 1000),
        "pickupIds": [i for i in (data.get("pickupIds") or []) if store.valid_id(i)],
        "extra": text(data, "extra", 1000),
    }


def _bg_input(data):
    name = data.get("bgName")
    if not store.valid_id(name):
        raise ValueError("배경 이름은 영문/숫자/_/- 로 지어 주세요 (예: night_library)")
    return {"bgName": name, "prompt": text(data, "prompt", 1000, required=True, label="장면 설명")}


def _ui_input(data):
    slot = data.get("slot")
    if slot not in uislots.SLOT_BY_KEY:
        raise ValueError("알 수 없는 UI 칸이에요")
    return {"slot": slot, "extra": text(data, "extra", 1000)}


@app.post("/api/banner/generate")
def banner_generate():
    data = body()
    return jsonify(_create_and_generate("banner", _banner_input(data), data))


@app.post("/api/bg/generate")
def bg_generate():
    data = body()
    return jsonify(_create_and_generate("bg", _bg_input(data), data))


# ─────────────────────────────────────────────────────────
# UI 에셋 (화면 배경 / 로고 / 아이콘) → data/ui.json
# ─────────────────────────────────────────────────────────
@app.get("/api/ui")
def ui_get():
    return jsonify(slots=uislots.SLOTS, ui=store.read_ui())


@app.post("/api/ui/generate")
def ui_generate():
    data = body()
    return jsonify(_create_and_generate("ui", _ui_input(data), data))


@app.put("/api/ui")
def ui_set():
    """칸 하나를 비우기(path=null → CSS 기본 디자인) 또는 이미 있는 그림으로 지정"""
    data = body()
    slot = data.get("slot")
    if slot not in uislots.SLOT_BY_KEY:
        raise ValueError("알 수 없는 UI 칸이에요")
    path = data.get("path") or None
    if path and not store.asset_exists_ws(path):
        raise ValueError("그림 파일이 없어요")
    ui = uislots.set_path(store.read_ui(), slot, path)
    store.write_ui(ui)
    return jsonify(ui=ui)


@app.post("/api/jobs/<job_id>/approve-image")
def approve_image(job_id):
    """배너/배경/UI 그림 승인 → assets/banners/<id>.jpg, assets/bg/<이름>.jpg, assets/ui/<칸>.png|jpg"""
    data = body()
    job = jobs.load(job_id)
    if job["kind"] == "char":
        raise ValueError("캐릭터는 캐릭터 승인을 사용해 주세요")
    return jsonify(path=batch.apply_job(job, data.get("attempt")))


# ─────────────────────────────────────────────────────────
# 일괄 생성 (그림이 필요한 항목을 ComfyUI로 한 번에)
# ─────────────────────────────────────────────────────────
@app.get("/api/batch/targets")
def batch_targets():
    return jsonify(groups=[{"id": g, "label": label} for g, label in batch.GROUPS], items=batch.targets())


@app.get("/api/batch")
def batch_state():
    return jsonify(batch=batch.snapshot())


@app.post("/api/batch/start")
def batch_start():
    data = body()
    keys = [k for k in (data.get("keys") or []) if isinstance(k, str)]
    return jsonify(batch=batch.start(keys, bool(data.get("autoApply")), data.get("stopOnError", True) is not False, text(data, "extra", 1000), data.get("retryCheck", True) is not False))


@app.post("/api/batch/cancel")
def batch_cancel():
    return jsonify(batch=batch.cancel())


@app.post("/api/batch/apply")
def batch_apply():
    """일괄 생성 결과 적용 (기존 캐릭터 그림 포함)"""
    data = body()
    job = jobs.load(data.get("jobId", ""))
    path = batch.apply_job(job, data.get("attempt"))
    batch.note_applied(job["id"], path)
    return jsonify(path=path)


# ─────────────────────────────────────────────────────────
# 스토리
# ─────────────────────────────────────────────────────────
@app.get("/api/stories/<sid>")
def story_get(sid):
    story = store.read_story(sid)
    if story is None:
        return jsonify({"id": sid, "title": "", "scenes": []})
    return jsonify(story)


@app.put("/api/stories/<sid>")
def story_put(sid):
    data = body()
    if not isinstance(data.get("scenes"), list):
        raise ValueError("scenes 목록이 필요해요")
    data["id"] = sid
    store.write_story(sid, data)
    return jsonify(ok=True)


@app.delete("/api/stories/<sid>")
def story_delete(sid):
    index = [s for s in store.read_list("storyIndex") if s.get("id") != sid]
    store.write_list("storyIndex", index)
    store.move_to_trash(store.story_path(sid))
    return jsonify(ok=True)


def clean_draft(draft, allowed):
    """AI 초안 정리: 모르는 화자는 narrator로, 장면 id/이동 대상 정리"""
    if not isinstance(draft, dict) or not isinstance(draft.get("scenes"), list):
        raise GenError("AI 초안 형식이 잘못됐어요 (scenes 없음)")
    warnings = []
    scenes = []
    used = set()
    for i, sc in enumerate(draft["scenes"]):
        if not isinstance(sc, dict):
            continue
        sid = sc.get("id") if store.valid_id(sc.get("id")) else f"s{i + 1}"
        while sid in used:
            sid = f"{sid}_{i + 1}"
        used.add(sid)
        bg = sc.get("background") if isinstance(sc.get("background"), dict) else {}
        color = bg.get("value") if bg.get("type") == "color" and isinstance(bg.get("value"), str) else "#1b1440"
        lines = []
        for ln in sc.get("lines") or []:
            if not isinstance(ln, dict) or not isinstance(ln.get("text"), str):
                continue
            sp = ln.get("speaker") if isinstance(ln.get("speaker"), str) else "narrator"
            line = {"speaker": sp, "text": ln["text"].strip()}
            if sp != "narrator" and sp not in allowed:
                warnings.append(f"알 수 없는 화자 '{sp}' → narrator로 바꿈 (이름 표시는 유지)")
                line = {"speaker": "narrator", "name": sp, "text": ln["text"].strip()}
            choices = [{"text": str(c.get("text", "")).strip(), "goto": str(c.get("goto") or "")} for c in (ln.get("choices") or []) if isinstance(c, dict)]
            if choices:
                line["choices"] = choices[:2]
            lines.append(line)
        scene = {"id": sid, "background": {"type": "color", "value": color}, "lines": lines}
        if isinstance(sc.get("next"), str) and sc["next"]:
            scene["next"] = sc["next"]
        scenes.append(scene)
    ids = {s["id"] for s in scenes} | {"end"}
    for s in scenes:
        if s.get("next") and s["next"] not in ids:
            warnings.append(f"장면 {s['id']}의 next '{s['next']}'가 없어서 지움")
            s.pop("next")
        for ln in s["lines"]:
            for c in ln.get("choices", []):
                if c["goto"] and c["goto"] not in ids:
                    warnings.append(f"선택지 '{c['text']}'의 이동 장면 '{c['goto']}'가 없어서 비움")
                    c["goto"] = ""
    if not scenes:
        raise GenError("AI 초안에 장면이 없어요")
    return {"title": str(draft.get("title") or "").strip(), "scenes": scenes}, warnings


@app.post("/api/stories/draft")
def story_draft():
    """AI 초안: 개요 + 등장 캐릭터 설명으로 스토리 생성 (거절 시 피드백과 이전 초안을 넣어 다시 쓰기)"""
    data = body()
    meta = data.get("meta") or {}
    outline = text(data, "outline", 3000, required=True, label="줄거리 개요")
    count = max(1, min(8, int(data.get("sceneCount") or 3)))
    chars_all = {c["id"]: c for c in store.read_list("characters")}
    chars = [chars_all[i] for i in data.get("characterIds") or [] if i in chars_all]
    feedback = text(data, "feedback", 1500)
    previous = data.get("previous") if isinstance(data.get("previous"), dict) else None
    prompt = prompts.story_draft(meta, outline, chars, count, feedback, previous)
    raw = genai.generate_text(prompt, json_mode=True, mock=lambda: prompts.mock_story(meta, outline, chars, count, feedback))
    draft, warnings = clean_draft(genai.parse_json_text(raw), set(chars_all))
    return jsonify(draft=draft, warnings=warnings)


# ─────────────────────────────────────────────────────────
# 검사 / 배포
# ─────────────────────────────────────────────────────────
def _public_plan(p):
    return {k: v for k, v in p.items() if not k.startswith("_")}


@app.post("/api/validate")
def validate_now():
    return jsonify(_public_plan(publish.plan(None)))


@app.post("/api/publish/plan")
def publish_plan():
    cutoff = body().get("cutoff") or None
    if cutoff and not parse(cutoff):
        raise ValueError("기준 시각 형식이 잘못됐어요")
    return jsonify(_public_plan(publish.plan(cutoff)))


@app.post("/api/publish/apply")
def publish_apply():
    data = body()
    notes = data.get("notes") if isinstance(data.get("notes"), list) else []
    return jsonify(publish.apply(data.get("cutoff") or None, notes))


@app.get("/api/git")
def git_info():
    return jsonify(publish.git_status())


@app.post("/api/publish/git")
def publish_git():
    data = body()
    files = data.get("files") if isinstance(data.get("files"), list) else []
    message = text(data, "message", 200, required=True, label="커밋 메시지")
    return jsonify(log=publish.git_commit_push(files, message, bool(data.get("push"))))


@app.post("/api/workspace/reset")
def workspace_reset():
    store.reset_workspace()
    return jsonify(ok=True)
