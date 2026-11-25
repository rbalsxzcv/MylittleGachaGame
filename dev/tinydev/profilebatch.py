"""프로필 일괄 생성 (CHARACTER_PROFILE.md 4-2 · 8-1장)

- 대상: 주인공(말투 카드) → 캐릭터 순서대로. 기본은 프로필이 없는 캐릭터만(NPC는 말투 카드가 없는 경우), '전원'이면 모두 다시
- 한 명씩 차례로 (병렬 아님): 앞에서 만든 카드(아직 승인 전이라도)를 다음 요청의 '다른 캐릭터 말투 요약'에 넣어서 말투가 겹치지 않게
- 결과는 바로 저장하지 않고 대기 → 화면에서 캐릭터별로 승인 / 다시 만들기(수정 요청) / 건너뛰기
- 상태는 dev/history/profile-batch/state.json에 저장 → 서버를 껐다 켜도 검토를 이어서 할 수 있음 (돌던 작업은 멈춤으로 표시)
"""
import threading

from . import config, profile, rarity, store
from .timeutil import now_iso

STATE_PATH = config.HISTORY / "profile-batch" / "state.json"
_lock = threading.Lock()
_cancel = threading.Event()
_state = None
_running = False


def _load():
    global _state
    if _state is None:
        try:
            st = store.read_json(STATE_PATH, None)
        except store.JsonError:
            st = None
        if isinstance(st, dict) and isinstance(st.get("items"), list):
            for it in st["items"]:
                if it.get("status") == "running":
                    it["status"] = "pending"  # 서버가 꺼지며 멈춘 항목
            st["running"] = False
            _state = st
    return _state


def _save():
    if _state is not None:
        store.write_json(STATE_PATH, _state)


def snapshot():
    with _lock:
        st = _load()
        if st is None:
            return None
        out = {**st, "items": [dict(i) for i in st["items"]], "running": _running}
    out["cancelRequested"] = _cancel.is_set() and _running
    out["counts"] = {k: sum(1 for i in out["items"] if i["status"] == k) for k in ("pending", "running", "done", "error", "approved", "skipped")}
    return out


def targets(all_chars=False, include_protagonist=True):
    from . import bible

    out = []
    if include_protagonist and (all_chars or not (bible.load()["protagonist"].get("voice") or {}).get("personality")):
        out.append({"id": profile.PROTAGONIST, "name": bible.load()["protagonist"].get("name") or "단장", "kind": "protagonist"})
    chars = [c for c in store.read_list("characters") if not c.get("retired")]
    # 뽑기 캐릭터(높은 등급 먼저) → NPC
    chars.sort(key=lambda c: (rarity.is_npc(c), -(rarity.normalize(c.get("rarity")) or 0) if not rarity.is_npc(c) else 0, c["id"]))
    for c in chars:
        npc = rarity.is_npc(c)
        p = c.get("profile") if isinstance(c.get("profile"), dict) else {}
        has = profile.has_voice(p) if npc else bool(p.get("stories") or p.get("facts")) and profile.has_voice(p)
        if all_chars or not has:
            out.append({"id": c["id"], "name": c.get("name", c["id"]), "kind": "npc" if npc else "char"})
    return out


def start(options):
    global _state, _running
    options = options if isinstance(options, dict) else {}
    items = targets(bool(options.get("all")), options.get("protagonist", True) is not False)
    if not items:
        raise ValueError("만들 프로필이 없어요 (모두 있어요 — 전원 다시 만들기를 켜 보세요)")
    with _lock:
        _load()
        if _running:
            raise ValueError("이미 프로필 일괄 생성 중이에요")
        _cancel.clear()
        _state = {
            "startedAt": now_iso(),
            "finishedAt": None,
            "options": {"all": bool(options.get("all")), "model": options.get("model") or None},
            "items": [{**it, "status": "pending", "profile": None, "warnings": [], "model": None, "error": None} for it in items],
        }
        _running = True
        _save()
    threading.Thread(target=_run, daemon=True, name="tinydev-profiles").start()
    return snapshot()


def resume():
    """멈춘 일괄 생성을 이어서 (대기 항목만)"""
    global _running
    with _lock:
        st = _load()
        if st is None or not any(i["status"] == "pending" for i in st["items"]):
            raise ValueError("이어서 만들 항목이 없어요")
        if _running:
            raise ValueError("이미 진행 중이에요")
        _cancel.clear()
        _running = True
        st["finishedAt"] = None
    threading.Thread(target=_run, daemon=True, name="tinydev-profiles").start()
    return snapshot()


def cancel():
    if _running:
        _cancel.set()
    return snapshot()


def _extra_voices(st, exclude):
    """이번 일괄에서 만든(승인 전) 말투 카드 — 다음 요청의 요약에 넣음"""
    return {i["id"]: (i.get("profile") or {}).get("voice") for i in st["items"] if i["id"] != exclude and i["status"] == "done" and (i.get("profile") or {}).get("voice")}


def _generate(item, feedback="", model=None, current=None):
    st = _state
    prof, used, warnings = profile.draft(item["id"], part="all", feedback=feedback, current=current, model=model or st["options"].get("model"), extra_voices=_extra_voices(st, item["id"]))
    return prof, used, warnings


def _run():
    global _running
    try:
        while True:
            if _cancel.is_set():
                break
            with _lock:
                item = next((i for i in _state["items"] if i["status"] == "pending"), None)
                if item is None:
                    break
                item["status"] = "running"
                _save()
            try:
                prof, used, warnings = _generate(item)
                with _lock:
                    item.update(status="done", profile=prof, model=used, warnings=warnings, error=None, at=now_iso())
            except Exception as e:  # noqa: BLE001 — 항목 오류는 기록하고 다음으로
                with _lock:
                    item.update(status="error", error=str(e)[:300])
            with _lock:
                _save()
    finally:
        with _lock:
            _running = False
            _state["finishedAt"] = now_iso()
            _save()


def _item(tid):
    st = _load()
    it = next((i for i in (st or {}).get("items", []) if i["id"] == tid), None)
    if not it:
        raise FileNotFoundError("일괄 생성 항목이 없어요")
    return it


def regenerate(tid, feedback="", model=None):
    """한 명만 다시 (수정 요청 반영). 진행 중에도 가능 — 결과는 대기 상태로"""
    with _lock:
        it = _item(tid)
        current = it.get("profile")
    prof, used, warnings = _generate(it, feedback=feedback, model=model, current=current if feedback else None)
    with _lock:
        it.update(status="done", profile=prof, model=used, warnings=warnings, error=None, at=now_iso())
        _save()
    return snapshot()


def approve(tid, edited=None):
    """승인 → 작업 공간에 저장 (화면에서 고친 내용이 있으면 그걸로)"""
    with _lock:
        it = _item(tid)
        prof = edited if isinstance(edited, dict) else it.get("profile")
    if not isinstance(prof, dict):
        raise ValueError("아직 만든 프로필이 없어요")
    if tid == profile.PROTAGONIST:
        profile.save_protagonist(prof.get("voice"))
        saved = {"voice": prof.get("voice")}
    else:
        saved = profile.save_profile(tid, prof)
    with _lock:
        it.update(status="approved", profile=saved, approvedAt=now_iso())
        _save()
    return snapshot()


def skip(tid):
    with _lock:
        it = _item(tid)
        it["status"] = "skipped"
        _save()
    return snapshot()
