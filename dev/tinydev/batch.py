"""일괄 생성: 그림이 필요한 항목(캐릭터 / 배너 / 스토리 배경 / 스테이지 전투 배경 / 적 / 소품 / UI 화면 배경 / 아이콘·로고)을 ComfyUI로 한 번에 뽑기.

- 한 번에 하나의 일괄 작업만, 서버의 백그라운드 스레드에서 차례대로 실행
- 항목마다 생성 작업(job)을 하나 만들고 시도 1회를 뽑음 → 결과는 각 작업 기록(dev/history)에 남음
- 중단: cancel() → 다음 항목으로 넘어가지 않고, 그리는 중인 ComfyUI 작업도 멈춤
- 오류: 항목에 오류 문구를 남김. 'stopOnError'면 거기서 멈춤 (ComfyUI 연결 오류는 항상 멈춤)
- autoApply면 뽑자마자 게임 작업 공간에 적용, 아니면 화면에서 검토 후 적용
- retryCheck면 캐릭터 자동 검사(설정화 / 여러 명)에 걸린 그림을 같은 프롬프트·새 seed로 최대 MAX_RETRY번 다시 뽑음
"""
import secrets
import threading

from . import comfy, config, imaging, jobs, rarity, settings, store, uislots
from .genai import GenError
from .timeutil import now_iso, stamp

MAX_RETRY = 2
GROUPS = [
    ("char", "캐릭터"),
    ("banner", "배너"),
    ("memory", "추억 카드"),
    ("bg", "스토리 배경"),
    ("stagebg", "스테이지 전투 배경"),
    ("enemy", "적"),
    ("prop", "소품"),
    ("ui_bg", "화면 배경"),
    ("ui_icon", "로고 · 아이콘"),
]

_lock = threading.Lock()
_cancel = threading.Event()
_state = None  # 현재(또는 마지막) 일괄 작업


# ── 대상 목록 ──────────────────────────────────────────────
def _exists(path):
    return bool(path) and store.asset_exists_ws(path)


def targets():
    """뽑을 수 있는 항목 전체 + 지금 그림이 있는지"""
    out = []
    chars = store.read_list("characters")
    enemies = store.read_list("enemies")
    char_ids = {c.get("id") for c in chars}
    # NPC 연결 적(charId)은 보통 그림을 비워 두고 NPC 그림을 같이 씀 → 적 항목 대신 NPC 항목에 '겸용' 표시
    shared = {}
    for e in enemies:
        if e.get("charId") in char_ids and not e.get("image"):
            shared.setdefault(e["charId"], []).append(e.get("name") or e["id"])
    for c in chars:
        also = "".join(f" · 적 「{n}」 겸용" for n in shared.get(c["id"], []))
        out.append({"key": f"char:{c['id']}", "group": "char", "label": f"{c.get('name', c['id'])} ({rarity.label(rarity.grade_of(c))}){also}", "path": c.get("image") or "", "has": _exists(c.get("image"))})
    for b in store.read_list("banners"):
        out.append({"key": f"banner:{b['id']}", "group": "banner", "label": b.get("title") or b["id"], "path": b.get("bannerImage") or "", "has": _exists(b.get("bannerImage"))})
    # 스토리 배경: 설정집(챕터 팩)에 등록된 배경 → assets/bg/<이름>.jpg
    from . import bible

    for name, bg in sorted(bible.load().get("backgrounds", {}).items()):
        path = f"assets/bg/{name}.jpg"
        out.append({"key": f"bg:{name}", "group": "bg", "label": bg.get("label") or name, "path": path, "has": _exists(path)})
    for e in enemies:
        linked = e.get("charId") in char_ids
        if linked and not e.get("image"):
            continue  # 그림 = 연결된 NPC 그림 (캐릭터 항목에서 뽑음)
        note = " (NPC 그림 덮어씀)" if linked else ""
        out.append({"key": f"enemy:{e['id']}", "group": "enemy", "label": f"{e.get('name', e['id'])}{' (보스)' if e.get('boss') else ''}{note}", "path": e.get("image") or "", "has": _exists(e.get("image"))})
    for m in store.read_list("memories"):
        out.append({"key": f"memory:{m['id']}", "group": "memory", "label": f"{m.get('name', m['id'])} ({m.get('rarity', '?')}★)", "path": m.get("image") or "", "has": _exists(m.get("image"))})
    for p in store.read_list("props"):
        out.append({"key": f"prop:{p['id']}", "group": "prop", "label": p.get("label") or p["id"], "path": p.get("image") or "", "has": _exists(p.get("image"))})
    # 스테이지 전투 배경: 비어 있으면 게임이 스토리 배경 → 기본 배경을 씀 (그래서 '없음'이어도 괜찮음)
    for st in store.read_list("stages"):
        if st.get("retired"):
            continue
        path = st.get("background") or ""
        fallback = "" if path else (story_bg_of(st) and " — 지금은 스토리 배경 사용" or " — 지금은 기본 배경 사용")
        out.append({"key": f"stagebg:{st['id']}", "group": "stagebg", "label": f"{st.get('name') or st['id']} ({st['id']}){fallback}", "path": path, "has": _exists(path)})
    ui = store.read_ui()
    for s in uislots.SLOTS:
        path = uislots.get_path(ui, s["key"])
        out.append({"key": f"ui:{s['key']}", "group": "ui_bg" if s["kind"] == "bg" else "ui_icon", "label": s["label"], "path": path, "has": _exists(path)})
    return out


def story_battle_background(story, stage_id):
    """스토리 본문 → 이 스테이지 전투에 쓸 배경 그림 경로 | '' (게임 js/systems/adventure.js storyBattleBackground와 같은 규칙)
    전투 장면의 그림 배경 → 가장 가까운 앞 장면 → 가장 가까운 뒤 장면"""
    scenes = [sc for sc in ((story or {}).get("scenes") or []) if isinstance(sc, dict)]

    def img(sc):
        bg = sc.get("background") if isinstance(sc.get("background"), dict) else {}
        return bg.get("value") if bg.get("type") == "image" and isinstance(bg.get("value"), str) else ""

    at = next((i for i, sc in enumerate(scenes) if sc.get("type") == "battle" and sc.get("stageId") == stage_id), -1)
    if at < 0:
        at = next((i for i, sc in enumerate(scenes) if sc.get("type") == "battle"), -1)
    if at < 0:
        return ""
    for i in [at, *range(at - 1, -1, -1), *range(at + 1, len(scenes))]:
        if img(scenes[i]):
            return img(scenes[i])
    return ""


def story_bg_of(stage):
    """스테이지의 연결 스토리 배경 경로 | ''"""
    sid = stage.get("storyId")
    if not store.valid_id(sid or ""):
        return ""
    try:
        return story_battle_background(store.read_story(sid), stage.get("id"))
    except (ValueError, store.JsonError):
        return ""


def stage_bg_input(st, scene="", extra=""):
    """스테이지 → 전투 배경 생성 입력값 (장면 설명이 없으면 스토리 배경의 설정집 설명을 참고로)"""
    from . import bible

    story_bg = ""
    path = story_bg_of(st)
    if path:
        name = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        bg = bible.load().get("backgrounds", {}).get(name) or {}
        story_bg = ", ".join(x for x in (bg.get("label"), bg.get("prompt")) if x)
    enemies = {e.get("id"): e.get("name") or e.get("id") for e in store.read_list("enemies")}
    names = []
    for wave in st.get("waves") or []:
        for en in wave or []:
            n = enemies.get((en or {}).get("enemyId"))
            if n and n not in names:
                names.append(n)
    return {
        "stageId": st["id"],
        "name": st.get("name") or st["id"],
        "scene": scene if scene is not None else st.get("backgroundPrompt", ""),
        "storyBg": story_bg,
        "enemies": names[:6],
        "extra": extra,
    }


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
            "rarity": rarity.grade_of(c) or 3,
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
        return "banner", banner_input(b, extra)
    if kind == "enemy":
        e = next((x for x in store.read_list("enemies") if x.get("id") == ident), None)
        if not e:
            raise ValueError("적이 없어요")
        return "enemy", enemy_input(e, extra)
    if kind == "memory":
        m = next((x for x in store.read_list("memories") if x.get("id") == ident), None)
        if not m:
            raise ValueError("추억이 없어요")
        return "memory", memory_input(m, extra)
    if kind == "prop":
        p = next((x for x in store.read_list("props") if x.get("id") == ident), None)
        if not p:
            raise ValueError("소품이 없어요")
        return "prop", {"propId": ident, "label": p.get("label") or ident, "prompt": p.get("prompt", ""), "extra": extra}
    if kind == "ui" and ident in uislots.SLOT_BY_KEY:
        return "ui", {"slot": ident, "extra": extra}
    if kind == "stagebg":
        st = next((x for x in store.read_list("stages") if x.get("id") == ident), None)
        if not st:
            raise ValueError("스테이지가 없어요")
        return "stagebg", stage_bg_input(st, st.get("backgroundPrompt", ""), extra)
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


def banner_input(b, extra="", banners=None, memories=None):
    """배너 → 그림 생성 입력값. pickupIds = 그림에 나올 캐릭터 id (imaging._context가 캐릭터에서 찾음)
    추억 배너: 픽업 추억(또는 pickupFrom 배너의 픽업 캐릭터의 전용 추억)의 주인/등장 캐릭터 + 추억 이름 · 장면 태그(memories)"""
    out = {"bannerId": b.get("id") or b.get("bannerId"), "title": b.get("title", ""), "description": b.get("description", ""), "pickupIds": [], "extra": extra}
    ids = [i for i in (b.get("pickupIds") or []) if isinstance(i, str)]
    if b.get("category") != "memory":
        out["pickupIds"] = [i for i in ids if not i.startswith("memory_")]
        return out
    out["category"] = "memory"
    mems = [m for m in (store.read_list("memories") if memories is None else memories) if isinstance(m, dict) and m.get("draft") is not True]
    src_id = b.get("pickupFrom")
    if src_id:
        src = next((x for x in (store.read_list("banners") if banners is None else banners) if x.get("id") == src_id), None) or {}
        owners = set(src.get("pickupIds") or [])
        picked = [m for m in mems if m.get("signatureOf") in owners]
    else:
        by_id = {m.get("id"): m for m in mems}
        picked = [by_id[i] for i in ids if i in by_id]
    chars = []
    for m in picked:
        cid = m.get("signatureOf") or m.get("featuredCharacterId")
        if cid and cid not in chars:
            chars.append(cid)
    out["pickupIds"] = chars
    out["memories"] = [{"name": m.get("name", ""), "rarity": m.get("rarity", 3), "theme": [t for t in m.get("theme") or [] if isinstance(t, str)][:6]} for m in picked][:6]
    return out


def memory_input(m, extra="", img2img=None, seed=None):
    """추억 데이터 → 카드 그림 생성 입력값 (주인/등장 캐릭터가 있으면 그 외형 슬롯을 그대로 씀)"""
    out = {
        "memoryId": m["id"],
        "name": m.get("name", m["id"]),
        "rarity": m.get("rarity", 3),
        "theme": m.get("theme") or [],
        "featuredCharacterId": m.get("featuredCharacterId") or m.get("signatureOf"),
        "extra": extra,
    }
    if img2img is not None:
        out["img2img"] = bool(img2img)
    if seed:
        out["seed"] = int(seed)
    return out


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
    배너 assets/banners/<id>.jpg · 배경 assets/bg/<이름>.jpg · 스테이지 전투 배경 assets/battle/<스테이지 id>.jpg
    UI assets/ui/<칸> · 기존 캐릭터 assets/chars/<id>.png
    적 assets/enemies/<id>.png · 소품 assets/props/<id>.png
    """
    kind, inp = job["kind"], job["input"]
    if kind == "banner":
        rel = f"assets/banners/{inp['bannerId']}.jpg"
        if not any(b.get("id") == inp["bannerId"] for b in store.read_list("banners")):
            raise ValueError("배너가 없어요 (먼저 저장해 주세요)")
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
    elif kind == "memory":
        rel = f"assets/memories/{inp['memoryId']}.webp"
        if not any(m.get("id") == inp["memoryId"] for m in store.read_list("memories")):
            raise ValueError("추억이 지워졌어요")
    elif kind == "stagebg":
        rel = f"assets/battle/{inp['stageId']}.jpg"
        if not any(x.get("id") == inp["stageId"] for x in store.read_list("stages")):
            raise ValueError("스테이지가 지워졌어요")
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
    elif kind == "stagebg":
        # 장면 설명은 다음에 다시 뽑을 때 이어받도록 스테이지에 메모 (backgroundPrompt — 개발 도구 전용, 배포 때 빠짐)
        stages = store.read_list("stages")
        for x in stages:
            if x.get("id") == inp["stageId"]:
                x["background"] = rel
                if inp.get("scene"):
                    x["backgroundPrompt"] = inp["scene"]
        store.write_list("stages", stages)
    elif kind == "enemy":
        enemies = store.read_list("enemies")
        for e in enemies:
            if e.get("id") == inp["enemyId"]:
                e["image"] = rel
        store.write_list("enemies", enemies)
    elif kind == "prop":
        upsert_prop(inp["propId"], label=inp.get("label"), prompt=inp.get("prompt"), image=rel)
    elif kind == "memory":
        # 카드(높이 1024 WebP) + 썸네일(높이 256 WebP). 테두리는 게임 화면이 그림
        from PIL import Image

        card = Image.open(dest)
        th = jobs.MEMORY_THUMB_H
        thumb = card.resize((max(1, round(card.width * th / card.height)), th), Image.LANCZOS)
        thumb_rel = f"assets/memories/{inp['memoryId']}_thumb.webp"
        thumb.save(config.WORKSPACE / thumb_rel, "WEBP", quality=85, method=6)
        mems = store.read_list("memories")
        for m in mems:
            if m.get("id") == inp["memoryId"]:
                m["image"] = rel
                m["thumb"] = thumb_rel
        store.write_list("memories", mems)
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
