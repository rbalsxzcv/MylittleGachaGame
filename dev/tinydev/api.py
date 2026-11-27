"""개발 도구 웹 서버 (Flask). 반드시 127.0.0.1(내 컴퓨터)에서만 열립니다.

보안
- Host 헤더가 localhost/127.0.0.1이 아니면 거부 (DNS 리바인딩 방지)
- 데이터를 바꾸는 요청(POST/PUT/DELETE)은 'X-Tiny-Dev: 1' 헤더가 있어야 함
  → 다른 웹사이트가 몰래 이 서버에 요청을 보내 파일을 바꾸거나 git push 하는 것 방지
"""
import base64
import io
import json
import re
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_from_directory

from . import batch, bible, comfy, pack, config, cutout, genai, imaging, jobs, kit, prompts, publish, settings, store, texthist, uislots
from . import rarity as rarity_mod
from . import profile as profile_mod
from . import profilebatch
from . import memslots
from . import review
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


@app.post("/api/tests/snapshot")
def tests_snapshot():
    """테스트 페이지(/preview/tests/)의 '스냅샷 갱신' → tests/snapshots/stages.json 저장"""
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or len(json.dumps(data)) > 2_000_000:
        raise ValueError("스냅샷 형식이 아니에요")
    dest = config.ROOT / "tests" / "snapshots" / "stages.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return jsonify(ok=True, path="tests/snapshots/stages.json")


@app.post("/api/reports")
def save_report():
    """밸런스 툴킷 보고서 저장 → reports/<이름>.md + .json (개발 도구 밸런스 탭의 튜너/평가)"""
    data = body()
    name = str(data.get("name") or "")
    if not re.fullmatch(r"(tune|eval)-\d{8,14}", name):
        raise ValueError("보고서 이름은 tune-날짜 또는 eval-날짜")
    md = text(data, "markdown", 2_000_000)
    dest = config.ROOT / "reports"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"{name}.md").write_text(md, encoding="utf-8", newline="\n")
    payload = data.get("json")
    if payload is not None:
        raw = json.dumps(payload, indent=2, ensure_ascii=False)
        if len(raw) > 5_000_000:
            raise ValueError("보고서가 너무 커요")
        (dest / f"{name}.json").write_text(raw + "\n", encoding="utf-8", newline="\n")
    return jsonify(ok=True, path=f"reports/{name}.md")


@app.get("/fx-test")
def fx_test():
    """가챠 연출 테스트 페이지 (dev/fx-test.html) — 게임 모듈/데이터는 /preview/에서 불러옴"""
    return send_from_directory(config.DEV, "fx-test.html")


@app.get("/battle-ui-test")
def battle_ui_test():
    """전투 화면 연출 테스트 페이지 (dev/battle-ui-test.html, BATTLE_UI.md 14장) — 게임 모듈/데이터는 /preview/에서"""
    return send_from_directory(config.DEV, "battle-ui-test.html")


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
    # tools/: 개발 도구 전용 생성기 · 밸런스 툴킷 (게임 js/는 import하지 않음 — 테스트와 개발 도구 탭이 씀)
    allowed = path in ("index.html", "style.css", "manifest.webmanifest") or path.startswith(("js/", "tests/", "tools/"))
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


@app.get("/api/text-models")
def text_models_get():
    """글 생성 모델: 고를 수 있는 목록(기본 = 환경 변수 포함) + 작업별 기본 모델"""
    s = settings.load()
    return jsonify(models=genai.text_models(s), tasks=[{"key": k, "label": label, "model": genai.resolve_text_model(k, s=s)["id"]} for k, label in settings.TEXT_TASKS])


@app.get("/api/text-history")
def text_history():
    target = request.args.get("target") or None
    return jsonify(records=texthist.list_records(target))


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


# ─────────────────────────────────────────────────────────
# id 자동 발급 (개발자는 id를 정하지 않음 — 규칙: <종류>_<4자리>, store.next_id)
# ─────────────────────────────────────────────────────────
@app.post("/api/ids/new")
def ids_new():
    """새 오브젝트 id 발급 (저장 직전에 부름). kind: char|enemy|stage|story|banner|notice|mail|shop|prop|bg"""
    kind = (body() or {}).get("kind")
    if kind not in store.ID_KINDS:
        raise ValueError("알 수 없는 id 종류예요")
    return jsonify(id=store.next_id(kind))


@app.get("/api/ids/next")
def ids_next():
    """다음에 발급될 id 미리보기 (발급하지 않음)"""
    kind = request.args.get("kind")
    if kind not in store.ID_KINDS:
        raise ValueError("알 수 없는 id 종류예요")
    return jsonify(id=store.peek_next_id(kind))


def _check_new_ids(kind, before_ids, items, label):
    """저장하려는 목록에 새로 생긴 id는 반드시 발급받은 자동 id (손으로 만든 id / 바꾼 id 막기)"""
    for it in items:
        iid = it.get("id")
        if iid not in before_ids and not store.issued(kind, iid):
            raise ValueError(f"{label}: '{iid}'는 발급받은 id가 아니에요. id는 자동으로 정해져요 (새로 만들기 → 저장)")


def _remember_removed(kind, before_ids, items):
    """목록에서 빠진 id는 삭제 기록에 (같은 번호가 다시 발급되지 않음)"""
    now_ids = {it.get("id") for it in items}
    for iid in before_ids - now_ids:
        store.remember_deleted(kind, iid)


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
    """배너/공지/우편/스토리/적/스테이지/소품 목록 전체 저장 (적은 전투 데이터 오류가 있으면 거부)"""
    if key not in ("banners", "notices", "mail", "storyIndex", "enemies", "stages", "props", "memories"):
        abort(404)
    items = _check_list(request.get_json(silent=True), key)
    kind = store.KIND_OF_LIST[key]
    before = {x.get("id") for x in store.read_list(key) if isinstance(x, dict)}
    _check_new_ids(kind, before, items, key)
    if key == "enemies":
        errors = [i for e in items for i in kit.battle_issues(e, enemy=True) if i["level"] == "error"]
        if errors:
            return jsonify(error="전투 데이터에 오류가 있어요", issues=errors), 400
    store.write_list(key, items)
    _remember_removed(kind, before, items)
    return jsonify(ok=True, count=len(items))


@app.get("/api/balance")
def balance_get():
    return jsonify(store.read_balance())


@app.put("/api/balance")
def balance_put():
    data = body()
    from . import validate as _v

    # 검사기의 밸런스 부분만 쓰려고 빈 콘텐츠와 함께 돌림
    report = _v.validate({"characters": [], "banners": [], "storyIndex": [], "notices": [], "mail": [], "balance": data, "ui": {}}, lambda _p: True)
    errors = [i for i in report.items if i["level"] == "error" and i["where"].startswith("balance")]
    if errors:
        return jsonify(error="밸런스 값에 오류가 있어요", issues=errors), 400
    store.write_balance(data)
    return jsonify(ok=True)


@app.get("/api/shop")
def shop_get():
    return jsonify(store.read_shop())


@app.put("/api/shop")
def shop_put():
    """상점 전체 저장 (검사 오류가 있으면 거부)"""
    from . import validate as _v

    data = body()
    r = _v.Report()
    _v.check_shop(r, data, store.asset_exists_ws)
    if r.errors:
        return jsonify(error="상점 데이터에 오류가 있어요", issues=r.errors), 400
    old = store.read_shop()
    before = {it.get("id") for tab in ("gold", "cash") for it in old.get(tab) or [] if isinstance(it, dict)}
    items = [it for tab in ("gold", "cash") for it in data.get(tab) or [] if isinstance(it, dict)]
    _check_new_ids("shop", before, items, "상점")
    store.write_shop(data)
    _remember_removed("shop", before, items)
    return jsonify(ok=True, issues=r.items)


@app.post("/api/assets/upload")
def asset_upload():
    """그림 올리기 (적 / 소품 그림): dataURL → PNG, 긴 변 1280px(소품 384px)보다 크면 줄여 assets/<dir>/<name>.png"""
    data = body()
    sub = data.get("dir")
    if sub not in ("enemies", "props"):
        raise ValueError("이 폴더에는 올릴 수 없어요")
    name = data.get("name")
    if sub == "enemies":
        if name not in {e.get("id") for e in store.read_list("enemies")}:
            raise ValueError("적을 먼저 저장해 주세요 (그림 파일 이름 = 적 id)")
    else:
        props = {p.get("id") for p in store.read_list("props")}
        if not name:
            name = store.next_id("prop")
        elif name not in props and not store.issued("prop", name):
            raise ValueError(f"'{name}'는 발급받은 소품 id가 아니에요")
    raw = str(data.get("data") or "")
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except ValueError as e:
        raise ValueError("그림 데이터를 읽지 못했어요") from e
    if len(blob) > 15 * 1024 * 1024:
        raise ValueError("그림이 너무 커요 (15MB 이하)")
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(blob))
        img.load()
    except Exception as e:  # noqa: BLE001 — 어떤 형식 오류든 사용자에게 같은 안내
        raise ValueError("PNG/JPEG/WebP 그림만 올릴 수 있어요") from e
    img = img.convert("RGBA")
    side = jobs.PROP_LONG_SIDE if sub == "props" else config.UPLOAD_MAX_LONG_SIDE
    img.thumbnail((side, side))
    rel = f"assets/{sub}/{name}.png"
    dest = config.WORKSPACE / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG")
    if sub == "props":
        batch.upsert_prop(name, label=text(data, "label", 60) or None, image=rel)
    return jsonify(path=rel, id=name)


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
    inputs = {"char": _char_input, "banner": _banner_input, "bg": _bg_input, "ui": _ui_input, "enemy": _enemy_input, "prop": _prop_input, "memory": _memory_input, "stagebg": _stagebg_input}
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


@app.post("/api/jobs/<job_id>/hires")
def hires_job(job_id):
    """추억 카드: 고른 시도를 하이레스로 다듬어 새 시도로 (1.25× · 13스텝 img2img 한 번, 설정 comfy.memoryHires)"""
    data = body()
    return jsonify(imaging.hires_attempt(jobs.load(job_id), data.get("attempt")))


# ─────────────────────────────────────────────────────────
# 캐릭터
# ─────────────────────────────────────────────────────────
def _char_input(data):
    rarity = rarity_mod.normalize_grade(data.get("rarity"))
    if rarity is None:
        raise ValueError("등급(1~5★ 또는 NPC)을 골라 주세요")
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
        "rarity": rarity_mod.normalize_grade(data.get("rarity")) or "",
        "title": text(data, "title", 60),
        "keywords": text(data, "keywords", 1000),
        "lore": text(data, "lore", 2000),
        "current": text(data, "current", 2000),
        "feedback": text(data, "feedback", 1000),
    }
    examples = [c for c in store.read_list("characters") if c.get("description")]
    cid = data.get("charId") if store.valid_id(data.get("charId")) else None
    me = next((c for c in examples if c.get("id") == cid), None) if cid else None
    if me is None and cid:
        me = next((c for c in store.read_list("characters") if c.get("id") == cid), None)
    inp["profile"] = (me or {}).get("profile") if isinstance((me or {}).get("profile"), dict) else None
    result, used = genai.generate_text_ex(prompts.describe(inp, [c for c in examples if c.get("id") != cid]), mock=lambda: prompts.mock_describe(inp), task="describe", model=data.get("model"), record=cid or inp["name"])
    return jsonify(description=result.strip().strip('"'), model=used)


@app.post("/api/char/approve")
def char_approve():
    """승인: 결과 PNG를 assets/chars/<id>.png로 저장하고 characters.json에 추가/갱신"""
    data = body()
    job = jobs.load(data.get("jobId", ""))
    if job["kind"] != "char":
        raise ValueError("캐릭터 작업이 아니에요")
    src = jobs.result_path(job, data.get("attempt"))
    c = data.get("character") or {}
    rarity = rarity_mod.normalize_grade(c.get("rarity"))
    if rarity is None:
        raise ValueError("등급(1~5★ 또는 NPC)을 골라 주세요")
    chars = store.read_list("characters")
    ids = {x.get("id") for x in chars}
    # id는 개발자가 정하지 않음: 그림 교체면 그 캐릭터, 이 작업을 이미 승인했으면 그때 만든 캐릭터, 아니면 새로 발급
    prev = ((job.get("approved") or {}).get("path") or "")
    prev_id = prev[len("assets/chars/"):-len(".png")] if prev.startswith("assets/chars/") and prev.endswith(".png") else None
    if job["input"].get("charId") in ids:
        cid = job["input"]["charId"]
    elif prev_id in ids:
        cid = prev_id
    else:
        cid = store.next_id("char")
    existing = next((x for x in chars if x.get("id") == cid), None)

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
    # 그림 교체/다시 승인: 다른 정보(전투 데이터, 외형 키워드, 설정 메모 …)는 그대로 둠
    if existing:
        entry = {**existing, **entry}
    entry.pop("pullable", None)  # 예전 방식 (등급 NPC로 대체)
    # 외형 슬롯: 승인한 그림의 프롬프트에서 머리/눈/옷/소품 태그를 나눠 저장 → 추억 카드 그림이 그대로 씀 (개발 도구 전용 칸)
    try:
        n = int(data.get("attempt") or len(job["attempts"]))
        look = (job["attempts"][n - 1].get("corePrompt") or job["attempts"][n - 1].get("prompt") or "") if job["attempts"] else ""
    except (ValueError, IndexError, TypeError):
        look = ""
    app = prompts.split_look(look or job["input"].get("keywords", ""))
    if any(app.values()):
        entry["appearance"] = app
    if existing:
        chars[chars.index(existing)] = entry
    else:
        chars.append(entry)
    store.write_list("characters", chars)
    jobs.mark_approved(job, data.get("attempt"), rel)
    # 5★면 전용 추억 빈 칸 (이미 있으면 그대로)
    slots = memslots.ensure_signature_slots([cid])
    return jsonify(character=entry, created=not existing, memorySlots=[m["id"] for m in slots])


def _char_refs(cid):
    """이 캐릭터를 쓰는 곳 (삭제 전 확인용)"""
    refs = []
    for e in store.read_list("enemies"):
        if e.get("charId") == cid:
            refs.append(f"적 「{e.get('name')}」 NPC 연결")
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
        # 등급 바꾸기: 1–5 ↔ NPC. 가챠 풀/로테이션은 게임이 데이터에서 매번 새로 만들어서 따라감
        grade = rarity_mod.normalize_grade(data["rarity"])
        if grade is None:
            raise ValueError("등급은 1~5 또는 NPC")
        existing["rarity"] = grade
        existing.pop("pullable", None)  # 예전 방식 (pullable: false = NPC) → 등급으로 정리
    for key, limit in (("name", 40), ("title", 60), ("description", 2000)):
        if key in data:
            existing[key] = text(data, key, limit, required=(key == "name"), label="이름")
    if "addedAt" in data:
        if not parse(data["addedAt"] or ""):
            raise ValueError("addedAt 날짜 형식이 잘못됐어요")
        existing["addedAt"] = data["addedAt"]
    store.write_list("characters", chars)
    slots = memslots.ensure_signature_slots([cid]) if "rarity" in data else []  # 5★로 바뀌면 전용 추억 빈 칸
    return jsonify({**existing, "memorySlots": [m["id"] for m in slots]})


# ── 프로필 (CHARACTER_PROFILE.md) ──
@app.post("/api/char/profile")
def char_profile_draft():
    """프로필 AI 초안 (저장 안 함 → 폼에 채움). id: 캐릭터 id 또는 'protagonist', part: all|stories|lines|voice"""
    data = body()
    tid = data.get("id")
    if tid != profile_mod.PROTAGONIST and not store.valid_id(tid):
        raise ValueError("캐릭터 id가 필요해요")
    prof, used, warnings = profile_mod.draft(
        tid,
        part=data.get("part") or "all",
        feedback=text(data, "feedback", 1000),
        current=data.get("current") if isinstance(data.get("current"), dict) else None,
        model=data.get("model") or None,
    )
    return jsonify(profile=prof, model=used, warnings=warnings)


def _profile_request(data):
    tid = data.get("id")
    if tid != profile_mod.PROTAGONIST and not store.valid_id(tid):
        raise ValueError("캐릭터 id가 필요해요")
    return profile_mod.draft_request(
        tid,
        part=data.get("part") or "all",
        feedback=text(data, "feedback", 1000),
        current=data.get("current") if isinstance(data.get("current"), dict) else None,
    )


@app.post("/api/char/profile/prompt")
def char_profile_prompt():
    """직접 만들기: AI 초안 버튼이 모델에 보낼 프롬프트 그대로 (호출 안 함) → 외부 AI에 붙여넣기용"""
    req = _profile_request(body())
    return jsonify(prompt=req["prompt"], part=req["part"])


@app.post("/api/char/profile/import")
def char_profile_import():
    """직접 만들기: 외부 AI 응답 글 → AI 초안과 같은 방식으로 합치고 정리 (저장 안 함 → 폼에 채움).
    id · part · feedback · current는 프롬프트를 만들 때 보낸 값 그대로"""
    data = body()
    req = _profile_request(data)
    parsed = profile_mod.parse_pasted(data.get("text"))
    if not isinstance(parsed, dict):
        raise ValueError("응답이 JSON 객체({ … })가 아니에요")
    prof, warnings = profile_mod.apply_response(req, parsed)
    return jsonify(profile=prof, warnings=warnings, part=req["part"])


@app.post("/api/char/profile/check")
def char_profile_check():
    """붙여넣은 프로필 JSON 검사 (저장 안 함): 오류 · 경고 · 모르는 키"""
    data = body()
    tid = data.get("id")
    voice_only = tid == profile_mod.PROTAGONIST
    if not voice_only:
        c = next((x for x in store.read_list("characters") if x.get("id") == tid), None)
        if not c:
            raise FileNotFoundError("캐릭터가 없어요")
        voice_only = rarity_mod.is_npc(c)
    ids = {c["id"] for c in store.read_list("characters")}
    return jsonify(profile_mod.check_raw(data.get("profile"), ids, voice_only))


@app.put("/api/characters/<cid>/profile")
def char_profile_put(cid):
    data = body()
    return jsonify(profile=profile_mod.save_profile(cid, data.get("profile") if isinstance(data.get("profile"), dict) else {}))


# ── 프로필 일괄 생성 ──
@app.get("/api/profile-batch")
def profile_batch_state():
    return jsonify(batch=profilebatch.snapshot(), targets=profilebatch.targets(False), allTargets=len(profilebatch.targets(True)))


@app.post("/api/profile-batch/start")
def profile_batch_start():
    data = body()
    if data.get("model"):
        genai.resolve_text_model("profile", data["model"])  # 없는 모델이면 400
    return jsonify(batch=profilebatch.start({"all": bool(data.get("all")), "protagonist": data.get("protagonist", True), "model": data.get("model") or None}))


@app.post("/api/profile-batch/resume")
def profile_batch_resume():
    return jsonify(batch=profilebatch.resume())


@app.post("/api/profile-batch/cancel")
def profile_batch_cancel():
    return jsonify(batch=profilebatch.cancel())


@app.post("/api/profile-batch/<tid>/approve")
def profile_batch_approve(tid):
    data = body()
    return jsonify(batch=profilebatch.approve(tid, data.get("profile") if isinstance(data.get("profile"), dict) else None))


@app.post("/api/profile-batch/<tid>/regenerate")
def profile_batch_regenerate(tid):
    data = body()
    return jsonify(batch=profilebatch.regenerate(tid, text(data, "feedback", 1000), data.get("model") or None))


@app.post("/api/profile-batch/<tid>/skip")
def profile_batch_skip(tid):
    return jsonify(batch=profilebatch.skip(tid))


@app.put("/api/story-bible/protagonist")
def protagonist_put():
    data = body()
    return jsonify(protagonist=profile_mod.save_protagonist(data.get("voice"), text(data, "name", 20) or None))


@app.get("/api/characters/<cid>/refs")
def char_refs(cid):
    return jsonify(_char_refs(cid))


# ─────────────────────────────────────────────────────────
# 전투 데이터 (능력치 / 스킬 / 돌파) + AI 초안
# ─────────────────────────────────────────────────────────
# 캐릭터 전투 필드 (characters.json) — 이 키들만 전투 저장 API가 바꿈
BATTLE_KEYS = ("role", "statTweak", "stats", "resource", "kit", "talents", "bt2", "bt6", "breakthroughs", "archetype", "kitGen")


def _battle_part(data):
    """요청에서 전투 필드만 꺼냄 (빈 stats/statTweak는 지움 → 역할 템플릿/희귀도 기본값)"""
    out = {}
    if isinstance(data.get("stats"), dict) and data["stats"]:
        out["stats"] = data["stats"]
    if isinstance(data.get("statTweak"), dict) and data["statTweak"]:
        out["statTweak"] = data["statTweak"]
    if isinstance(data.get("kit"), dict):
        out["kit"] = data["kit"]
    if isinstance(data.get("breakthroughs"), list) and data["breakthroughs"]:
        out["breakthroughs"] = data["breakthroughs"]
    if isinstance(data.get("talents"), list):
        out["talents"] = data["talents"]
    for key in ("bt2", "bt6", "resource", "kitGen"):
        if isinstance(data.get(key), dict):
            out[key] = data[key]
    for key in ("role", "archetype"):
        if isinstance(data.get(key), str) and data[key]:
            out[key] = data[key][:32]
    return out


@app.put("/api/characters/<cid>/battle")
def char_battle_put(cid):
    """캐릭터 전투 데이터 저장. 검사 오류가 있으면 저장하지 않음 (경고는 저장 후 함께 돌려줌)"""
    data = body()
    chars = store.read_list("characters")
    existing = next((x for x in chars if x.get("id") == cid), None)
    if not existing:
        raise FileNotFoundError("캐릭터가 없어요")
    part = _battle_part(data)
    issues = kit.battle_issues({"id": cid, **part})
    errors = [i for i in issues if i["level"] == "error"]
    if errors:
        return jsonify(error=f"전투 데이터 오류 {len(errors)}개", issues=errors), 400
    for k in BATTLE_KEYS:
        existing.pop(k, None)
    existing.update(part)
    store.write_list("characters", chars)
    return jsonify(character=existing, issues=issues)


@app.post("/api/battle/check")
def battle_check():
    """저장하지 않고 검사만 (폼 편집 중 확인용)"""
    data = body()
    return jsonify(issues=kit.battle_issues({"id": data.get("id") or "?", **_battle_part(data), **({"passives": data["passives"]} if isinstance(data.get("passives"), list) else {})}, enemy=bool(data.get("enemy"))))


def _clean_kit_draft(raw):
    if not isinstance(raw, dict):
        raise GenError("AI 초안 형식이 잘못됐어요 (객체가 아님)")
    out = _battle_part(raw)
    if "kit" not in out:
        raise GenError("AI 초안에 kit이 없어요")
    out.setdefault("breakthroughs", [])
    return out


def balance_rarity_stats(bal):
    """balance.json → {희귀도: {atk, def, hp, spd}} (새 형식 stats.byRarity, 예전 rarityStats 모두)"""
    by = ((bal or {}).get("stats") or {}).get("byRarity") or (bal or {}).get("rarityStats") or {}
    return {rarity_mod.normalize(k): v for k, v in by.items() if rarity_mod.normalize(k)}


@app.post("/api/char/kit-draft")
def char_kit_draft():
    """설정 + 희귀도 → Gemini가 스킬 3개 + 돌파 5개 제안. 검사 오류가 있으면 한 번 더 고쳐 쓰게 함"""
    data = body()
    rarity = rarity_mod.normalize(data.get("rarity"))
    if rarity is None:
        if rarity_mod.normalize_grade(data.get("rarity")) == rarity_mod.NPC:
            raise ValueError("NPC 등급은 동료 스킬이 필요 없어요 (전투에 적으로 내보내려면 적 탭에서 이 NPC를 연결해 주세요)")
        raise ValueError("희귀도(1~5★)를 골라 주세요")
    cid = data.get("charId") if store.valid_id(data.get("charId")) else None
    inp = {
        "name": text(data, "name", 40, required=True, label="이름"),
        "rarity": rarity,
        "title": text(data, "title", 60),
        "lore": text(data, "lore", 2000),
        "feedback": text(data, "feedback", 1000),
        "previous": data.get("previous") if isinstance(data.get("previous"), dict) else None,
    }
    vocab = kit.load_vocab()
    examples = [c for c in store.read_list("characters") if c.get("kit") and c.get("breakthroughs") and c.get("id") != cid]
    examples.sort(key=lambda c: rarity_mod.normalize(c.get("rarity")) != rarity)
    rarity_stats = balance_rarity_stats(store.read_balance())
    retried = False
    errors = None
    for attempt in range(2):
        prompt = prompts.kit_draft(inp, vocab, examples[:2], rarity_stats, errors)
        raw = genai.generate_text(prompt, json_mode=True, mock=lambda: prompts.mock_kit(inp))
        draft = _clean_kit_draft(genai.parse_json_text(raw))
        issues = kit.battle_issues({"id": cid or "draft", **draft})
        errors = [i for i in issues if i["level"] == "error"]
        if not errors or genai.is_mock():
            break
        retried = True
    return jsonify(draft=draft, issues=issues, retried=retried)


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
    store.remember_deleted("characters", cid, target.get("name") or "")  # 같은 id를 다시 쓰지 못하게
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
    # 아직 저장 전인 배너도 그림을 먼저 뽑을 수 있게 요청 값으로 (추억 배너는 픽업 추억 → 등장 캐릭터 · 추억 이름, batch.banner_input)
    b = {
        "id": bid,
        "title": text(data, "title", 80),
        "description": text(data, "description", 1000),
        "category": "memory" if data.get("category") == "memory" else "character",
        "pickupIds": [i for i in (data.get("pickupIds") or []) if store.valid_id(i)],
        "pickupFrom": data.get("pickupFrom") if store.valid_id(data.get("pickupFrom") or "") else None,
    }
    return batch.banner_input(b, text(data, "extra", 1000))


def _bg_input(data):
    name = data.get("bgName")
    if not name:
        name = store.next_id("bg")  # 새 배경 → 자동 id (파일 이름 = id)
    elif name not in bible.load()["backgrounds"] and not store.issued("bg", name):
        raise ValueError(f"'{name}'는 발급받은 배경 id가 아니에요 (id는 자동으로 정해져요)")
    # 장면 설명은 'scene'으로 받음 ('prompt'는 개발자가 확인/수정한 그림 프롬프트와 겹치므로). 예전 요청은 'prompt'
    key = "scene" if "scene" in data else "prompt"
    return {"bgName": name, "prompt": text(data, key, 1000, required=True, label="장면 설명")}


def _ui_input(data):
    slot = data.get("slot")
    if slot not in uislots.SLOT_BY_KEY:
        raise ValueError("알 수 없는 UI 칸이에요")
    return {"slot": slot, "extra": text(data, "extra", 1000)}


def _stagebg_input(data):
    sid = data.get("stageId")
    st = next((x for x in store.read_list("stages") if x.get("id") == sid), None) if store.valid_id(sid or "") else None
    if not st:
        raise ValueError("스테이지를 먼저 저장해 주세요 (전투 배경은 저장된 스테이지에 연결돼요)")
    # 장면 설명은 'scene' ('prompt'는 개발자가 확인/수정한 그림 프롬프트)
    return batch.stage_bg_input(st, text(data, "scene", 1000), text(data, "extra", 1000))


def _enemy_input(data):
    eid = data.get("enemyId")
    e = next((x for x in store.read_list("enemies") if x.get("id") == eid), None) if store.valid_id(eid) else None
    if not e:
        raise ValueError("적을 먼저 저장해 주세요 (그림은 저장된 적에 연결돼요)")
    keywords = text(data, "keywords", 1000) if "keywords" in data else None
    return batch.enemy_input(e, text(data, "extra", 1000), keywords)


def _prop_input(data):
    pid = data.get("propId")
    if not pid:
        pid = store.next_id("prop")  # 새 소품 → 자동 id
    elif pid not in {p.get("id") for p in store.read_list("props")} and not store.issued("prop", pid):
        raise ValueError(f"'{pid}'는 발급받은 소품 id가 아니에요 (id는 자동으로 정해져요)")
    # 물건 설명은 'description'으로 받음 ('prompt'는 개발자가 확인/수정한 그림 프롬프트)
    return {"propId": pid, "label": text(data, "label", 60) or pid, "prompt": text(data, "description", 1000), "extra": text(data, "extra", 1000)}


def _memory_input(data):
    mid = data.get("memoryId")
    m = next((x for x in store.read_list("memories") if x.get("id") == mid), None)
    if not m:
        raise ValueError("저장된 추억에만 그림을 만들 수 있어요 (그림 파일 이름 = 추억 id)")
    return batch.memory_input(m, text(data, "extra", 1000), img2img=data.get("img2img"), seed=data.get("seed"))


@app.get("/api/memories/slots")
def memory_slots_missing():
    """전용 추억(빈 칸 포함)이 없는 5★ 캐릭터"""
    return jsonify(missing=memslots.missing())


@app.post("/api/memories/slots")
def memory_slots_make():
    """5★ 캐릭터마다 전용 추억 빈 칸 (없는 캐릭터만, draft: true)"""
    return jsonify(made=memslots.ensure_signature_slots())


@app.post("/api/memory/generate")
def memory_generate():
    """추억 카드 그림: 장면 프롬프트(AI 또는 테마 태그 템플릿) + 주인 캐릭터 외형 슬롯 그대로 → 1차만 → WebP 카드/썸네일
    (하이레스는 시도마다 /api/jobs/<id>/hires, 승인은 approve-image)"""
    data = body()
    return jsonify(_create_and_generate("memory", _memory_input(data), data))


@app.post("/api/enemy/generate")
def enemy_generate():
    data = body()
    return jsonify(_create_and_generate("enemy", _enemy_input(data), data))


@app.post("/api/prop/generate")
def prop_generate():
    data = body()
    return jsonify(_create_and_generate("prop", _prop_input(data), data))


@app.post("/api/banner/generate")
def banner_generate():
    data = body()
    return jsonify(_create_and_generate("banner", _banner_input(data), data))


@app.post("/api/stagebg/generate")
def stagebg_generate():
    """스테이지 전투 배경 (1280x720 JPG → 승인하면 assets/battle/<스테이지 id>.jpg + stage.background)"""
    data = body()
    return jsonify(_create_and_generate("stagebg", _stagebg_input(data), data))


@app.get("/api/stages/<sid>/background")
def stage_background(sid):
    """이 스테이지 전투에 실제로 쓰일 배경: 스테이지 전용 → 스토리 배경 → 기본 배경 (게임 adventure.battleBackgrounds와 같은 순서)"""
    st = next((x for x in store.read_list("stages") if x.get("id") == sid), None)
    if not st:
        raise FileNotFoundError("스테이지를 찾을 수 없어요")
    own = st.get("background") or ""
    story = batch.story_bg_of(st)
    default = uislots.get_path(store.read_ui(), "backgrounds.battle")
    used = next(((src, p) for src, p in (("stage", own), ("story", story), ("default", default)) if p and store.asset_exists_ws(p)), (None, ""))
    return jsonify(stage=own, story=story, default=default, source=used[0], path=used[1])


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
    """배너/배경/UI/적/소품/스테이지 전투 배경 그림 승인 → assets/banners/<id>.jpg, assets/bg/<이름>.jpg, assets/ui/<칸>.png|jpg,
    assets/enemies/<id>.png, assets/props/<id>.png, assets/battle/<스테이지 id>.jpg"""
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
@app.get("/api/stages/<sid>/refs")
def stage_refs(sid):
    """이 스테이지를 전투 장면으로 쓰는 스토리"""
    out = []
    for s in store.read_list("storyIndex"):
        try:
            story = store.read_story(s["id"]) or {}
        except (store.JsonError, ValueError):
            continue
        for sc in story.get("scenes") or []:
            if isinstance(sc, dict) and sc.get("type") == "battle" and sc.get("stageId") == sid:
                out.append({"storyId": s["id"], "title": s.get("title"), "sceneId": sc.get("id")})
    return jsonify(out)


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
    exists = any(s.get("id") == sid for s in store.read_list("storyIndex")) or store.story_path(sid).exists()
    if not exists and not store.issued("story", sid):
        raise ValueError(f"'{sid}'는 발급받은 스토리 id가 아니에요 (id는 자동으로 정해져요)")
    store.write_story(sid, data)
    review.note_manual_save(sid, data)  # 검수한 장을 사람이 고침 → 구조 기준을 새로
    return jsonify(ok=True)


@app.delete("/api/stories/<sid>")
def story_delete(sid):
    index = [s for s in store.read_list("storyIndex") if s.get("id") != sid]
    store.write_list("storyIndex", index)
    store.move_to_trash(store.story_path(sid))
    bible.remove_chapter(sid)
    return jsonify(ok=True)


def clean_draft(draft, allowed, stage_ids=(), bg_names=()):
    """AI 초안 정리: 모르는 화자는 narrator(이름 표시 유지)로, 장면 id/이동 대상/전투 장면/배경 이름 정리"""
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
        if sc.get("type") == "battle":
            if sc.get("stageId") in stage_ids:
                scene = {"id": sid, "type": "battle", "stageId": sc["stageId"]}
                if isinstance(sc.get("next"), str) and sc["next"]:
                    scene["next"] = sc["next"]
                scenes.append(scene)
            else:
                warnings.append(f"없는 스테이지 '{sc.get('stageId')}'의 전투 장면을 뺐어요")
            continue
        bg = sc.get("background") if isinstance(sc.get("background"), dict) else {}
        palette = ["#1b1440", "#2a2152", "#33264f", "#24304a", "#2b1f3a"]
        if bg.get("type") == "bg" and bg.get("name") in bg_names:
            # 설정집 배경 → 그림 경로 (그림이 생기기 전에는 색으로 보임)
            background = {"type": "image", "value": f"assets/bg/{bg['name']}.jpg", "color": palette[i % len(palette)]}
        else:
            if bg.get("type") == "bg":
                warnings.append(f"장면 {sid}: 모르는 배경 '{bg.get('name')}' → 색 배경")
            color = bg.get("value") if bg.get("type") == "color" and isinstance(bg.get("value"), str) else palette[i % len(palette)]
            background = {"type": "color", "value": color}
        lines = []
        for ln in sc.get("lines") or []:
            if not isinstance(ln, dict) or not isinstance(ln.get("text"), str):
                continue
            sp = ln.get("speaker") if isinstance(ln.get("speaker"), str) else "narrator"
            line = {"speaker": sp, "text": ln["text"].strip()}
            name = ln.get("name").strip()[:20] if isinstance(ln.get("name"), str) and ln["name"].strip() else ""
            if sp != "narrator" and sp not in allowed:
                warnings.append(f"목록에 없는 화자 '{sp}' → 지문 + 이름 표시로 바꿈")
                line = {"speaker": "narrator", "name": name or sp, "text": ln["text"].strip()}
            elif name:
                line["name"] = name
            choices = [{"text": str(c.get("text", "")).strip(), "goto": str(c.get("goto") or "")} for c in (ln.get("choices") or []) if isinstance(c, dict)]
            if choices:
                line["choices"] = choices[:2]
            lines.append(line)
        scene = {"id": sid, "background": background, "lines": lines}
        if isinstance(sc.get("next"), str) and sc["next"]:
            scene["next"] = sc["next"]
        scenes.append(scene)
    ids = {s["id"] for s in scenes} | {"end"}
    for s in scenes:
        if s.get("next") and s["next"] not in ids:
            warnings.append(f"장면 {s['id']}의 next '{s['next']}'가 없어서 지움")
            s.pop("next")
        for ln in s.get("lines", []):
            for c in ln.get("choices", []):
                if c["goto"] and c["goto"] not in ids:
                    warnings.append(f"선택지 '{c['text']}'의 이동 장면 '{c['goto']}'가 없어서 비움")
                    c["goto"] = ""
    if not any(s.get("lines") for s in scenes):
        raise GenError("AI 초안에 대사가 없어요")
    out = {"title": str(draft.get("title") or "").strip()[:60], "scenes": scenes}
    for key, limit in (("summary", 80), ("recap", bible.RECAP_LIMIT)):
        if isinstance(draft.get(key), str) and draft[key].strip():
            out[key] = draft[key].strip()[:limit]
    return out, warnings


# ── 스토리 설정집 (세계관 / 장별 개요·요약) ──
@app.get("/api/story-bible")
def story_bible_get():
    return jsonify(bible.load())


@app.put("/api/story-bible")
def story_bible_put():
    data = body()
    # 예전에는 제한을 넘으면 조용히 잘렸음(문체 지침이 3000자에서 끊김) → 이제는 저장을 거부
    for key, limit, label in (("world", bible.WORLD_LIMIT, "세계관"), ("style", bible.STYLE_LIMIT, "문체 지침")):
        if isinstance(data.get(key), str) and len(data[key].strip()) > limit:
            raise ValueError(f"{label}이 너무 길어요: {len(data[key].strip())}자 (최대 {limit}자)")
    b = bible.set_world(text(data, "world", bible.WORLD_LIMIT), text(data, "style", bible.STYLE_LIMIT))
    return jsonify(b)


@app.put("/api/story-bible/chapters/<sid>")
def story_bible_chapter_put(sid):
    data = body()
    ch = bible.set_chapter(
        sid,
        outline=text(data, "outline", bible.OUTLINE_LIMIT) if "outline" in data else None,
        recap=text(data, "recap", bible.RECAP_LIMIT) if "recap" in data else None,
    )
    return jsonify(ch)


@app.put("/api/story-bible/backgrounds/<name>")
def story_bible_background_put(name):
    """스토리 배경 등록/수정 (이름 · 그림 설명) → 스토리 AI와 일괄 생성이 사용"""
    if name not in bible.load()["backgrounds"] and not store.issued("bg", name):
        raise ValueError(f"'{name}'는 발급받은 배경 id가 아니에요")
    data = body()
    bible.set_background(name, text(data, "label", 60) or name, text(data, "prompt", 1000))
    return jsonify(bible.load()["backgrounds"].get(name))


def _story_group(meta):
    """같은 묶음(종류 + 캐릭터 스토리면 같은 캐릭터)에서 이 장보다 앞선 장들 (장 순서)"""
    kind, cid, ch, sid = meta.get("kind", "main"), meta.get("characterId"), int(meta.get("chapter") or 1), meta.get("id")
    group = [s for s in store.read_list("storyIndex") if s.get("kind") == kind and (kind != "character" or s.get("characterId") == cid) and s.get("id") != sid and int(s.get("chapter") or 0) < ch]
    return sorted(group, key=lambda s: int(s.get("chapter") or 0))


def _names():
    return {c["id"]: c.get("name", c["id"]) for c in store.read_list("characters")}


def _stage_names():
    return {s["id"]: s.get("name", s["id"]) for s in store.read_list("stages") if isinstance(s, dict) and "id" in s}


def _make_recap(sid, title, story_body, world):
    script = prompts.script_text(story_body, _names(), _stage_names(), limit=12000)
    if not script.strip():
        return ""
    recap = genai.generate_text(prompts.recap_prompt(world, title, script), mock=lambda: prompts.mock_recap(title, script), task="recap").strip()
    bible.set_chapter(sid, recap=recap)
    return recap


def _recap_stale(sid, entry):
    """요약 시각보다 대본 파일이 나중에 바뀌었는지"""
    at = parse(entry.get("recapAt") or "")
    path = store.story_path(sid)
    return bool(at and path.exists() and path.stat().st_mtime > at.timestamp() + 2)


@app.post("/api/stories/<sid>/recap")
def story_recap(sid):
    """지금 저장된 대본(또는 보낸 scenes)을 요약해서 설정집에 저장"""
    data = request.get_json(silent=True) or {}
    story = {"scenes": data["scenes"]} if isinstance(data.get("scenes"), list) else (store.read_story(sid) or {})
    meta = next((s for s in store.read_list("storyIndex") if s.get("id") == sid), {})
    recap = _make_recap(sid, text(data, "title", 60) or meta.get("title", sid), story, bible.load()["world"])
    if not recap:
        raise ValueError("요약할 대사가 없어요")
    return jsonify(recap=recap)


def draft_chapter(meta, outline, length="auto", character_ids=(), allow_battles=False, feedback="", previous=None, pack=None, required_stage=None, model=None):
    """장 개요 → 대본 (챕터 팩 생성에서도 씀). 반환: (draft, warnings, context)"""
    meta = {
        "id": meta.get("id") if store.valid_id(meta.get("id")) else None,
        "kind": meta.get("kind") if meta.get("kind") in ("main", "character", "event") else "main",
        "chapter": max(1, int(meta.get("chapter") or 1)),
        "title": str(meta.get("title") or "")[:60],
        "characterId": meta.get("characterId") if store.valid_id(meta.get("characterId")) else None,
    }
    length = length if length in prompts.STORY_LENGTH else "auto"
    chars_all = {c["id"]: c for c in store.read_list("characters")}
    picked = [i for i in character_ids or [] if i in chars_all]
    chars = list(chars_all.values())  # 화자로 쓸 수 있는 전체 (이번 장 등장 캐릭터만 말투 카드 전체, 나머지는 한 줄)
    b = bible.load()

    # 앞 장들: 요약이 없으면 대본에서 먼저 만들어 둠 (최대 8개까지 한 번에)
    prev, made = [], 0
    group = _story_group(meta)
    for s in group:
        entry = b["chapters"].get(s["id"]) or {}
        recap = entry.get("recap", "")
        if recap and _recap_stale(s["id"], entry):
            recap = ""  # 요약을 만든 뒤에 대본을 고쳤음 → 다시 요약
        if not recap and made < 8:
            try:
                recap = _make_recap(s["id"], s.get("title", s["id"]), store.read_story(s["id"]) or {}, b["world"])
                made += 1
            except (store.JsonError, ValueError):
                recap = ""
        prev.append({"id": s["id"], "chapter": s.get("chapter"), "title": s.get("title", s["id"]), "recap": recap})
    prev_script, prev_body = "", None
    if group:
        try:
            prev_body = store.read_story(group[-1]["id"]) or {}
            prev_script = prompts.script_text(prev_body, _names(), _stage_names())
        except (store.JsonError, ValueError):
            prev_script = ""
    featured = profile_mod.featured_ids(chars, outline, prev_body, picked)
    voice_warnings = [f"말투 카드 없음: {chars_all[i].get('name', i)} (캐릭터 탭 → 프로필)" for i in featured if not profile_mod.has_voice(chars_all[i].get("profile"))]
    if not (b["protagonist"].get("voice") or {}).get("personality"):
        voice_warnings.insert(0, "말투 카드 없음: 주인공 (스토리 탭 → 세계관 · 문체 → 주인공 말투 카드)")

    stages = [{"id": k, "name": v} for k, v in _stage_names().items()] if allow_battles else []
    backgrounds = [{"name": k, "label": v.get("label") or k} for k, v in sorted(b["backgrounds"].items())]
    ctx = {
        "meta": meta,
        "outline": outline,
        "world": b["world"],
        "style": b["style"],
        "prev": prev,
        "prev_script": prev_script,
        "chars": chars,
        "featured": featured,
        "protagonist": b["protagonist"],
        "length": length,
        "stages": stages,
        "backgrounds": backgrounds,
        "pack": pack,
        "required_stage": required_stage,
        "feedback": feedback or "",
        "previous": previous if isinstance(previous, dict) else None,
    }
    raw, used = genai.generate_text_ex(prompts.chapter_draft(ctx), json_mode=True, mock=lambda: prompts.mock_chapter(ctx), task="story", model=model, record=meta["id"] or f"{meta['kind']}-{meta['chapter']}")
    stage_ids = {s["id"] for s in stages} | ({required_stage["id"]} if required_stage else set())
    draft, warnings = clean_draft(genai.parse_json_text(raw), set(chars_all), stage_ids, {x["name"] for x in backgrounds})
    warnings = voice_warnings + warnings
    if required_stage and not any(sc.get("type") == "battle" and sc.get("stageId") == required_stage["id"] for sc in draft["scenes"]):
        # AI가 전투를 빠뜨리면 마지막 장면 앞에 넣음
        draft["scenes"].insert(max(0, len(draft["scenes"]) - 1), {"id": "b1" if not any(x["id"] == "b1" for x in draft["scenes"]) else "battle_1", "type": "battle", "stageId": required_stage["id"]})
        warnings.append("AI가 전투 장면을 빠뜨려서 마지막 장면 앞에 넣었어요")
    if meta["id"]:
        bible.set_chapter(meta["id"], outline=outline, model=used)
    context = {
        "world": bool(b["world"].strip()),
        "style": bool(b["style"].strip()),
        "previous": [{"id": p["id"], "chapter": p["chapter"], "title": p["title"], "hasRecap": bool(p["recap"])} for p in prev],
        "previousScript": group[-1]["id"] if group and prev_script else None,
        "recapsMade": made,
        "model": used,
        "voiceCards": [chars_all[i].get("name", i) for i in featured],
    }
    return draft, warnings, context


@app.post("/api/stories/draft")
def story_draft():
    """장 개요 → 대본. 세계관 + 앞 장 요약(없으면 먼저 만듦) + 직전 장 대본을 함께 읽고 이어 씀.
    거절하면 수정 요청 + 이전 초안을 넣어 다시 씀"""
    data = body()
    draft, warnings, context = draft_chapter(
        data.get("meta") or {},
        text(data, "outline", bible.OUTLINE_LIMIT, required=True, label="이번 장 개요"),
        length=data.get("length"),
        character_ids=data.get("characterIds") or [],
        allow_battles=bool(data.get("allowBattles")),
        feedback=text(data, "feedback", 1500),
        previous=data.get("previous"),
        model=data.get("model") or None,
    )
    return jsonify(draft=draft, warnings=warnings, context=context)


# ─────────────────────────────────────────────────────────
# 스토리 검수 (CHARACTER_PROFILE.md 8-2 · 8-3)
# ─────────────────────────────────────────────────────────
@app.get("/api/review")
def review_state():
    return jsonify(review.snapshot())


@app.post("/api/review/start")
def review_start():
    data = body()
    scope = data.get("scope") if data.get("scope") in ("main", "character", "event", "all") else "main"
    return jsonify(review.start(scope, data.get("model") or None, data.get("mode") or "review"))


@app.post("/api/review/cancel")
def review_cancel():
    return jsonify(review.cancel())


@app.get("/api/review/<sid>")
def review_get(sid):
    if not store.valid_id(sid):
        raise ValueError("잘못된 스토리 id")
    meta = next((s for s in store.read_list("storyIndex") if s.get("id") == sid), {})
    return jsonify(entry=review.entry_of(sid), result=review.result_of(sid), current=store.read_story(sid), meta=meta, names=_names())


@app.post("/api/review/<sid>/redo")
def review_redo(sid):
    data = body()
    return jsonify(entry=review.redo(sid, text(data, "feedback", 1500), data.get("model") or None))


@app.post("/api/review/<sid>/approve")
def review_approve(sid):
    data = body()
    scenes = data.get("scenes") if isinstance(data.get("scenes"), list) else None
    return jsonify(review.approve(sid, scenes, data.get("title") if isinstance(data.get("title"), str) else None, data.get("summary") if isinstance(data.get("summary"), str) else None))


@app.post("/api/review/<sid>/keep")
def review_keep(sid):
    return jsonify(entry=review.keep(sid))


# ─────────────────────────────────────────────────────────
# 챕터 팩 (챕터 12장 + 캐릭터 + 배경 + 적 + 스테이지)
# ─────────────────────────────────────────────────────────
@app.get("/api/pack")
def pack_state():
    return jsonify(pack=pack.snapshot(), nextArc=pack.next_arc(), saved=bible.load()["packs"])


@app.post("/api/pack/plan")
def pack_plan():
    """챕터 개요 → 구성안 (거절하면 수정 요청 + 이전 구성안으로 다시)"""
    data = body()
    arc = int(data.get("arc") or pack.next_arc())
    if arc < 1 or arc > 999:
        raise ValueError("챕터 번호는 1~999")
    plan, warnings = pack.make_plan(
        text(data, "outline", 6000, required=True, label="챕터 개요"),
        arc,
        feedback=text(data, "feedback", 2000),
        previous=data.get("previous") if isinstance(data.get("previous"), dict) else None,
    )
    return jsonify(plan=plan, warnings=warnings)


@app.post("/api/pack/start")
def pack_start():
    data = body()
    plan = data.get("plan")
    if not isinstance(plan, dict):
        raise ValueError("구성안이 필요해요")
    opts = data.get("options") if isinstance(data.get("options"), dict) else {}
    options = {
        "length": opts.get("length") if opts.get("length") in prompts.STORY_LENGTH else "auto",
        "autoBackgrounds": bool(opts.get("autoBackgrounds")),
        "overwrite": bool(opts.get("overwrite")),
    }
    return jsonify(pack=pack.start(plan, options))


@app.post("/api/pack/cancel")
def pack_cancel():
    return jsonify(pack=pack.cancel())


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
