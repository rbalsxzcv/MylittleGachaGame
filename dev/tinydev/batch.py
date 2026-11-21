"""일괄 생성: 그림이 필요한 항목(캐릭터 / 배너 / 스토리 배경 / 적 / 소품 / UI 화면 배경 / 아이콘·로고)을 ComfyUI로 한 번에 뽑기.

- 한 번에 하나의 일괄 작업만, 서버의 백그라운드 스레드에서 차례대로 실행
- 항목마다 생성 작업(job)을 하나 만들고 시도 1회를 뽑음 → 결과는 각 작업 기록(dev/history)에 남음
- 중단: cancel() → 다음 항목으로 넘어가지 않고, 그리는 중인 ComfyUI 작업도 멈춤
- 오류: 항목에 오류 문구를 남김. 'stopOnError'면 거기서 멈춤 (ComfyUI 연결 오류는 항상 멈춤)
- autoApply면 뽑자마자 게임 작업 공간에 적용, 아니면 화면에서 검토 후 적용
- retryCheck면 캐릭터 자동 검사(설정화 / 여러 명)에 걸린 그림을 같은 프롬프트·새 seed로 최대 MAX_RETRY번 다시 뽑음
"""
import secrets
import threading

from . import comfy, config, imaging, jobs, settings, store, uislots
from .genai import GenError
from .timeutil import now_iso, stamp

MAX_RETRY = 2
GROUPS = [("char", "캐릭터"), ("banner", "배너"), ("bg", "스토리 배경"), ("enemy", "적"), ("prop", "소품"), ("ui_bg", "화면 배경"), ("ui_icon", "로고 · 아이콘")]

_lock = threading.Lock()
_cancel = threading.Event()
_state = None  # 현재(또는 마지막) 일괄 작업


# ── 대상 목록 ──────────────────────────────────────────────
def _exists(path):
    return bool(path) and store.asset_exists_ws(path)


def targets():
    """뽑을 수 있는 항목 전체 + 지금 그림이 있는지"""
    out = []
    for c in store.read_list("characters"):
        out.append({"key": f"char:{c['id']}", "group": "char", "label": f"{c.get('name', c['id'])} ({c.get('rarity', '')})", "path": c.get("image") or "", "has": _exists(c.get("image"))})
    for b in store.read_list("banners"):
        out.append({"key": f"banner:{b['id']}", "group": "banner", "label": b.get("title") or b["id"], "path": b.get("bannerImage") or "", "has": _exists(b.get("bannerImage"))})
    # 스토리 배경: 설정집(챕터 팩)에 등록된 배경 → assets/bg/<이름>.jpg
    from . import bible

    for name, bg in sorted(bible.load().get("backgrounds", {}).items()):
        path = f"assets/bg/{name}.jpg"
        out.append({"key": f"bg:{name}", "group": "bg", "label": bg.get("label") or name, "path": path, "has": _exists(path)})
    for e in store.read_list("enemies"):
        out.append({"key": f"enemy:{e['id']}", "group": "enemy", "label": f"{e.get('name', e['id'])}{' (보스)' if e.get('boss') else ''}", "path": e.get("image") or "", "has": _exists(e.get("image"))})
    for p in store.read_list("props"):
        out.append({"key": f"prop:{p['id']}", "group": "prop", "label": p.get("label") or p["id"], "path": p.get("image") or "", "has": _exists(p.get("image"))})
    ui = store.read_ui()
    for s in uislots.SLOTS:
        path = uislots.get_path(ui, s["key"])
        out.append({"key": f"ui:{s['key']}", "group": "ui_bg" if s["kind"] == "bg" else "ui_icon", "label": s["label"], "path": path, "has": _exists(path)})
    return out


def _job_input(key, extra):
    """항목 키 → (작업 종류, 생성 입력값)"""
    kind, _, ident = key.partition(":")
    if kind == "char":
        c = next((x for x in store.read_list("characters") if x.get("id") == ident), None)
        if not c:
            raise ValueError("캐릭터가 없어요")
        look = jobs.char_look(ident) or c.get("keywords", "")
        return "char", {
            "name": c.get("name", ident),
            "rarity": c.get("rarity", "R"),
            "title": c.get("title", ""),
            "keywords": look,  # 예전에 쓴 외형 → 없으면 메모해 둔 외형 키워드(챕터 팩) → 없으면 Gemini가 소개 문구로 정함
            "lore": c.get("lore") or c.get("description", ""),
            "charId": ident,
            "extra": extra,
        }
    if kind == "banner":
        b = next((x for x in store.read_list("banners") if x.get("id") == ident), None)
        if not b:
            raise ValueError("배너가 없어요")
        return "banner", {"bannerId": ident, "title": b.get("title", ""), "description": b.get("description", ""), "pickupIds": b.get("pickupIds") or [], "extra": extra}
    if kind == "enemy":
        e = next((x for x in store.read_list("enemies") if x.get("id") == ident), None)
        if not e:
            raise ValueError("적이 없어요")
        return "enemy", enemy_input(e, extra)
    if kind == "prop":
        p = next((x for x in store.read_list("props") if x.get("id") == ident), None)
        if not p:
            raise ValueError("소품이 없어요")
        return "prop", {"propId": ident, "label": p.get("label") or ident, "prompt": p.get("prompt", ""), "extra": extra}
    if kind == "ui" and ident in uislots.SLOT_BY_KEY:
        return "ui", {"slot": ident, "extra": extra}
    if kind == "bg":
        from . import bible

        bg = bible.load().get("backgrounds", {}).get(ident)
        if not bg:
            raise ValueError("설정집에 없는 배경이에요")
        prompt = bg.get("prompt") or bg.get("label") or ident
        return "bg", {"bgName": ident, "prompt": f"{prompt}. {extra}".strip(". ") if extra else prompt}
    raise ValueError(f"알 수 없는 항목: {key}")


def enemy_input(e, extra="", keywords=None):
    """적 데이터 → 그림 생성 입력값 (keywords를 주면 메모해 둔 외형 대신 사용)"""
    return {
        "enemyId": e["id"],
        "name": e.get("name", e["id"]),
        "boss": bool(e.get("boss")),
        "keywords": keywords if keywords is not None else e.get("keywords", ""),
        "memo": e.get("memo", ""),
        "extra": extra,
    }


def upsert_prop(pid, label=None, prompt=None, image=None):
    """소품 목록(props.json)에 등록/갱신 → 항목"""
    if not store.valid_id(pid):
        raise ValueError("소품 id는 영문/숫자/_/- 로 지어 주세요")
    props = store.read_list("props")
    item = next((x for x in props if x.get("id") == pid), None)
    if item is None:
        item = {"id": pid, "label": label or pid, "prompt": prompt or ""}
        props.append(item)
    if label is not None:
        item["label"] = str(label)[:60] or pid
    if prompt is not None:
        item["prompt"] = str(prompt)[:1000]
    if image is not None:
        item["image"] = image
    store.write_list("props", props)
    return item


# ── 결과 적용 (승인) ────────────────────────────────────────
def apply_job(job, n):
    """시도 n의 결과를 작업 공간에 저장하고 데이터에 연결 → 저장 경로
    배너 assets/banners/<id>.jpg · 배경 assets/bg/<이름>.jpg · UI assets/ui/<칸> · 기존 캐릭터 assets/chars/<id>.png
    적 assets/enemies/<id>.png · 소품 assets/props/<id>.png
    """
    kind, inp = job["kind"], job["input"]
    if kind == "banner":
        rel = f"assets/banners/{inp['bannerId']}.jpg"
    elif kind == "bg":
        rel = f"assets/bg/{inp['bgName']}.jpg"
    elif kind == "ui":
        rel = f"assets/ui/{uislots.file_name(inp['slot'])}"
    elif kind == "char" and inp.get("charId"):
        rel = f"assets/chars/{inp['charId']}.png"
    elif kind == "enemy":
        rel = f"assets/enemies/{inp['enemyId']}.png"
        if not any(e.get("id") == inp["enemyId"] for e in store.read_list("enemies")):
            raise ValueError("적이 지워졌어요")
    elif kind == "prop":
        rel = f"assets/props/{inp['propId']}.png"
    else:
        raise ValueError("새 캐릭터는 캐릭터 탭에서 승인해 주세요")
    if kind == "char" and not any(c.get("id") == inp["charId"] for c in store.read_list("characters")):
        raise ValueError("캐릭터가 지워졌어요")
    src = jobs.result_path(job, n)
    dest = config.WORKSPACE / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(src.read_bytes())
    if kind == "banner":
        banners = store.read_list("banners")
        for b in banners:
            if b.get("id") == inp["bannerId"]:
                b["bannerImage"] = rel
        store.write_list("banners", banners)
    elif kind == "ui":
        store.write_ui(uislots.set_path(store.read_ui(), inp["slot"], rel))
    elif kind == "enemy":
        enemies = store.read_list("enemies")
        for e in enemies:
            if e.get("id") == inp["enemyId"]:
                e["image"] = rel
        store.write_list("enemies", enemies)
    elif kind == "prop":
        upsert_prop(inp["propId"], label=inp.get("label"), prompt=inp.get("prompt"), image=rel)
    elif kind == "char":
        chars = store.read_list("characters")
        for c in chars:
            if c.get("id") == inp["charId"]:
                c["image"] = rel
        store.write_list("characters", chars)
    jobs.mark_approved(job, n, rel)
    return rel


# ── 실행 ──────────────────────────────────────────────────
def snapshot():
    """화면용 현재 상태 (없으면 None)"""
    with _lock:
        if _state is None:
            return None
        st = {**_state, "items": [dict(i) for i in _state["items"]]}
    counts = {}
    for i in st["items"]:
        counts[i["status"]] = counts.get(i["status"], 0) + 1
    st["counts"] = counts
    st["cancelRequested"] = _cancel.is_set() and st["running"]
    return st


def start(keys, auto_apply=False, stop_on_error=True, extra="", retry_check=True):
    global _state
    if not keys:
        raise ValueError("뽑을 항목을 하나 이상 골라 주세요")
    cfg = settings.load()["comfy"]
    if not config.FORCE_MOCK:
        problem = comfy.missing_model(cfg)
        if problem:
            raise ValueError(problem)
    known = {t["key"]: t for t in targets()}
    items = []
    for key in dict.fromkeys(keys):  # 순서 유지 + 중복 제거
        if key not in known:
            raise ValueError(f"알 수 없는 항목: {key}")
        t = known[key]
        items.append({"key": key, "group": t["group"], "label": t["label"], "status": "pending", "jobId": None, "attempt": None, "thumb": None, "applied": None, "error": None, "warning": None, "check": None, "retries": 0, "startedAt": None, "finishedAt": None})
    # 캐릭터를 먼저 (배너가 캐릭터 외형을 참고하므로)
    order = {g: n for n, (g, _) in enumerate(GROUPS)}
    items.sort(key=lambda i: order[i["group"]])
    with _lock:
        if _state and _state["running"]:
            raise ValueError("이미 일괄 생성이 진행 중이에요. 끝나거나 중단한 뒤에 시작해 주세요")
        _cancel.clear()
        _state = {
            "id": f"batch-{stamp()}-{secrets.token_hex(2)}",
            "running": True,
            "startedAt": now_iso(),
            "finishedAt": None,
            "options": {"autoApply": bool(auto_apply), "stopOnError": bool(stop_on_error), "extra": extra, "retryCheck": bool(retry_check)},
            "items": items,
            "current": None,
            "stopReason": None,
        }
    threading.Thread(target=_run, args=(_state,), daemon=True, name="tinydev-batch").start()
    return snapshot()


def cancel():
    """중단 요청 (그리는 중인 ComfyUI 작업도 멈춤)"""
    with _lock:
        running = bool(_state and _state["running"])
    if running:
        _cancel.set()
    return snapshot()


def note_applied(job_id, path):
    """검토 화면에서 적용했을 때 일괄 작업 목록에도 표시"""
    with _lock:
        for i in (_state or {}).get("items", []):
            if i["jobId"] == job_id:
                i["applied"] = path


def _set(item, **kw):
    with _lock:
        item.update(kw)


def _finish_rest(st, status):
    with _lock:
        for i in st["items"]:
            if i["status"] == "pending":
                i["status"] = status


def _run(st):
    opts = st["options"]
    stop_reason = None
    try:
        for item in st["items"]:
            if _cancel.is_set():
                stop_reason = "cancelled"
                break
            with _lock:
                st["current"] = item["key"]
            _set(item, status="running", startedAt=now_iso())
            try:
                kind, inp = _job_input(item["key"], opts["extra"])
                job = jobs.create(kind, {**inp, "engine": imaging.ENGINE, "batchId": st["id"]})
                _set(item, jobId=job["id"])
                imaging.generate_attempt(job, cancel=_cancel)
                attempt = job["attempts"][-1]
                # 캐릭터 자동 검사에 걸리면 같은 프롬프트, 새 seed로 다시
                while opts["retryCheck"] and attempt.get("check") and item["retries"] < MAX_RETRY:
                    _set(item, retries=item["retries"] + 1, check=attempt["check"], thumb=f"/history/{job['id']}/{attempt['result']}")
                    imaging.generate_attempt(job, cancel=_cancel)
                    attempt = job["attempts"][-1]
                _set(item, attempt=attempt["n"], thumb=f"/history/{job['id']}/{attempt['result']}", warning=attempt.get("warning") or attempt.get("genWarning"), check=attempt.get("check"))
                if opts["autoApply"] and attempt.get("check"):
                    _set(item, warning="자동 검사에 걸려서 바로 적용하지 않았어요 — 검토해 주세요")
                elif opts["autoApply"]:
                    _set(item, applied=apply_job(job, attempt["n"]))
                _set(item, status="done", finishedAt=now_iso())
            except comfy.Cancelled:
                _set(item, status="cancelled", finishedAt=now_iso())
                stop_reason = "cancelled"
                break
            except Exception as e:  # noqa: BLE001 — 어떤 오류든 화면에 알리고 계속/멈춤 결정
                msg = str(e) if isinstance(e, (GenError, ValueError, FileNotFoundError)) else f"{type(e).__name__}: {e}"
                _set(item, status="error", error=msg, finishedAt=now_iso())
                if isinstance(e, comfy.ConnectError):
                    stop_reason = "connect"
                    break
                if opts["stopOnError"]:
                    stop_reason = "error"
                    break
    finally:
        _finish_rest(st, "cancelled" if stop_reason == "cancelled" else "skipped")
        with _lock:
            st["running"] = False
            st["current"] = None
            st["finishedAt"] = now_iso()
            st["stopReason"] = stop_reason
