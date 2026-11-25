"""스토리 검수 (CHARACTER_PROFILE.md 8-2 · 8-3장)

- 순서: 메인(장 순서) → 캐릭터 스토리 → 이벤트. 한 장씩 차례로 (병렬 아님): 직전 장 대본 = 승인본 > 대기 중인 검수본 > 원본
- 장마다 AI가 문제 목록(report) + 고친 장(revised) → 대기. 화면에서 승인 / 다시 검수(수정 요청) / 원본 유지
- 구조 잠금: 장면 id · 순서, 전투 장면(stageId)과 위치, next, 선택지 개수와 goto는 원본에서 가져오고(merge_revised),
  승인할 때 다시 확인(locked_changes, 바뀌면 거부). 승인한 장의 구조는 설정집에 기록 → 배포 검사가 비교 (validate._check_review)
- 원본은 dev/history/review-<id>-<시각>/original.json에 그대로 남음 (되돌리기 · 전후 비교)
- 상태: 설정집 chapters[id].review = {status: pending|approved|kept|error, stale, historyId, model, at, reportCount, structure, counts}
- 8-3 전후 비교: 체크 전용(mode check)으로 원본 · 지금 대본을 각각 검사 → 규칙(1~9)별 문제 수
"""
import secrets
import threading

from . import bible, config, genai, profile, prompts, store
from .timeutil import now_iso, stamp

LINE_LIMIT = 200
_lock = threading.Lock()
_cancel = threading.Event()
_run = {"running": False, "mode": None, "current": None, "queue": [], "startedAt": None, "finishedAt": None, "error": None}


# ── 구조 (바꾸면 안 되는 것) ───────────────────────────────
def structure(body):
    """장면 id · 순서 · 종류 · 전투 stageId · next · 줄마다 선택지 goto 목록 (줄 위치는 무시 — 줄 추가/삭제는 허용)"""
    out = []
    for sc in (body or {}).get("scenes") or []:
        if not isinstance(sc, dict):
            continue
        e = {"id": sc.get("id"), "type": "battle" if sc.get("type") == "battle" else "text"}
        if e["type"] == "battle":
            e["stageId"] = sc.get("stageId")
        if sc.get("next"):
            e["next"] = sc["next"]
        e["choices"] = [[c.get("goto") for c in ln["choices"] if isinstance(c, dict)] for ln in sc.get("lines") or [] if isinstance(ln, dict) and ln.get("choices")]
        out.append(e)
    return out


def locked_changes(orig, revised):
    """원본 → 검수본에서 바뀌면 안 되는 것이 바뀐 목록 (빈 목록 = 통과)"""
    a, b = structure(orig), structure(revised)
    if [x["id"] for x in a] != [x["id"] for x in b]:
        return [f"장면 id · 순서가 바뀌었어요 ({', '.join(str(x['id']) for x in a)} → {', '.join(str(x['id']) for x in b)})"]
    out = []
    for x, y in zip(a, b):
        if x["type"] != y["type"] or x.get("stageId") != y.get("stageId"):
            out.append(f"장면 {x['id']}: 전투 장면이 바뀌었어요")
        if x.get("next") != y.get("next"):
            out.append(f"장면 {x['id']}: next가 바뀌었어요 ({x.get('next')} → {y.get('next')})")
        if x["choices"] != y["choices"]:
            out.append(f"장면 {x['id']}: 선택지 개수나 goto가 바뀌었어요")
    return out


def _clean_lines(lines, allowed):
    out = []
    for ln in lines if isinstance(lines, list) else []:
        if not isinstance(ln, dict) or not isinstance(ln.get("text"), str) or not ln["text"].strip():
            continue
        sp = ln.get("speaker") if isinstance(ln.get("speaker"), str) else "narrator"
        name = ln.get("name").strip()[:20] if isinstance(ln.get("name"), str) and ln["name"].strip() else ""
        if sp != "narrator" and sp not in allowed:
            name = name or sp[:20]
            sp = "narrator"
        line = {"speaker": sp, "text": ln["text"].strip()[:LINE_LIMIT]}
        if sp == "narrator" and name:
            line["name"] = name
        if isinstance(ln.get("choices"), list) and ln["choices"]:
            line["choices"] = [{"text": str(c.get("text") or "")[:60], "goto": c.get("goto")} for c in ln["choices"] if isinstance(c, dict)]
        out.append(line)
    return out


def merge_revised(orig, revised_scenes, allowed):
    """검수본 장면 → 원본 구조에 맞춰 합치기: 장면 틀(id · 순서 · 배경 · next · 전투)은 원본, 줄만 검수본.
    검수본에 없거나 선택지 구조가 바뀐 장면은 원본 그대로 (경고)"""
    warnings = []
    rev = {sc.get("id"): sc for sc in revised_scenes or [] if isinstance(sc, dict)}
    orig_ids = set()
    scenes = []
    for sc in (orig or {}).get("scenes") or []:
        if not isinstance(sc, dict):
            continue
        orig_ids.add(sc.get("id"))
        if sc.get("type") == "battle":
            scenes.append(dict(sc))
            continue
        r = rev.get(sc.get("id"))
        lines = _clean_lines((r or {}).get("lines"), allowed)
        if not lines:
            warnings.append(f"장면 {sc.get('id')}: 검수본에 없어서 원본 유지")
            scenes.append(dict(sc))
            continue
        cand = {**{k: v for k, v in sc.items() if k != "lines"}, "lines": lines}
        if structure({"scenes": [cand]})[0]["choices"] != structure({"scenes": [sc]})[0]["choices"]:
            warnings.append(f"장면 {sc.get('id')}: 선택지 개수나 goto가 바뀌어서 원본 유지")
            scenes.append(dict(sc))
            continue
        scenes.append(cand)
    extra = [i for i in rev if i not in orig_ids]
    if extra:
        warnings.append(f"검수본에만 있는 장면은 버렸어요: {', '.join(map(str, extra))}")
    return scenes, warnings


# ── 순서 · 상태 ───────────────────────────────────────────
def _index():
    return {s["id"]: s for s in store.read_list("storyIndex") if isinstance(s, dict) and s.get("id")}


def ordered(scope="all"):
    items = profile._story_order()
    return [s for s in items if scope == "all" or s.get("kind") == scope]


def _group_before(meta):
    """같은 묶음(종류 + 캐릭터 스토리면 같은 캐릭터)에서 이 장보다 앞선 장들 (장 순서)"""
    kind, cid, ch = meta.get("kind", "main"), meta.get("characterId"), int(meta.get("chapter") or 0)
    group = [s for s in store.read_list("storyIndex") if s.get("kind") == kind and (kind != "character" or s.get("characterId") == cid) and s.get("id") != meta.get("id") and int(s.get("chapter") or 0) < ch]
    return sorted(group, key=lambda s: int(s.get("chapter") or 0))


def _group_after(meta):
    kind, cid, ch = meta.get("kind", "main"), meta.get("characterId"), int(meta.get("chapter") or 0)
    return [s for s in store.read_list("storyIndex") if s.get("kind") == kind and (kind != "character" or s.get("characterId") == cid) and int(s.get("chapter") or 0) > ch]


def entry_of(sid):
    return (bible.chapter(sid).get("review") or {}) if store.valid_id(sid) else {}


def _set_entry(sid, **kw):
    def fn(ch):
        rv = ch.get("review") if isinstance(ch.get("review"), dict) else {}
        rv.update(kw)
        ch["review"] = rv
        return dict(rv)

    return bible.update_chapter(sid, fn)


def _hist_dir(hid):
    if not isinstance(hid, str) or not hid.startswith("review-") or "/" in hid or "\\" in hid or ".." in hid:
        raise ValueError("잘못된 검수 기록")
    return config.HISTORY / hid


def result_of(sid):
    """대기 중(또는 마지막) 검수 결과 {original, revised, report, title, summary, warnings, model, at, feedback}"""
    e = entry_of(sid)
    if not e.get("historyId"):
        return None
    d = _hist_dir(e["historyId"])
    res = store.read_json(d / "result.json", None) or {}
    res["original"] = store.read_json(d / "original.json", None)
    return res


def _body_for_prev(s):
    """직전 장 대본: 승인본(= 지금 파일) > 대기 중인 검수본 > 원본(= 지금 파일)"""
    e = entry_of(s["id"])
    if e.get("status") == "pending" and e.get("historyId"):
        res = store.read_json(_hist_dir(e["historyId"]) / "result.json", None) or {}
        if isinstance(res.get("revised"), dict):
            return res["revised"]
    try:
        return store.read_story(s["id"]) or {}
    except (store.JsonError, ValueError):
        return {}


# ── 검수 한 장 ────────────────────────────────────────────
def _ctx(sid, body, mode, feedback="", previous=None):
    idx = _index()
    meta = idx.get(sid) or {"id": sid, "kind": "main", "chapter": 0}
    b = bible.load()
    chars = store.read_list("characters")
    names = {c["id"]: c.get("name", c["id"]) for c in chars}
    group = _group_before(meta)
    prev = [{"chapter": s.get("chapter"), "title": s.get("title", s["id"]), "recap": (b["chapters"].get(s["id"]) or {}).get("recap", "")} for s in group]
    prev_script = prompts.script_text(_body_for_prev(group[-1]), names) if group else ""
    featured = profile.featured_ids(chars, "", body)  # 이 장에서 말하는 캐릭터
    return {
        "story": {"id": sid, "title": meta.get("title") or (body or {}).get("title", ""), "summary": meta.get("summary", ""), "kind": meta.get("kind"), "chapter": meta.get("chapter")},
        "body": body,
        "names": names,
        "style": b["style"],
        "world": b["world"],
        "roster": prompts.roster_text(chars, featured, b["protagonist"]),
        "prev": prev,
        "prev_script": prev_script,
        "mode": mode,
        "feedback": feedback,
        "previous": previous,
    }


def _clean_report(raw, body):
    lines = {(sc.get("id"), i): ln.get("text", "") for sc in (body or {}).get("scenes") or [] if isinstance(sc, dict) for i, ln in enumerate(sc.get("lines") or []) if isinstance(ln, dict)}
    out = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            continue
        try:
            rule = int(r.get("rule"))
        except (TypeError, ValueError):
            rule = 0
        try:
            li = int(r.get("lineIndex"))
        except (TypeError, ValueError):
            li = -1
        sc = str(r.get("sceneId") or "")
        out.append({"sceneId": sc, "lineIndex": li, "rule": rule if 1 <= rule <= 9 else 0, "before": str(r.get("before") or lines.get((sc, li), ""))[:300], "reason": str(r.get("reason") or "")[:300]})
    return out[:200]


def count_rules(report):
    out = {}
    for r in report:
        k = str(r.get("rule") or 0)
        out[k] = out.get(k, 0) + 1
    return out


def review_one(sid, feedback="", model=None):
    """한 장 검수 → 대기 상태로 저장. 반환: 설정집 review 항목"""
    if not store.valid_id(sid):
        raise ValueError("잘못된 스토리 id")
    original = store.read_story(sid)
    if not original or not original.get("scenes"):
        raise ValueError("검수할 대본이 없어요")
    prev_entry = entry_of(sid)
    previous = None
    if feedback and prev_entry.get("status") == "pending":
        previous = (result_of(sid) or {}).get("revised")
    ctx = _ctx(sid, original, "revise", feedback, previous)
    raw, used = genai.generate_text_ex(prompts.review_prompt(ctx), json_mode=True, mock=lambda: prompts.mock_review(ctx), task="review", model=model, record=sid)
    data = genai.parse_json_text(raw)
    if not isinstance(data, dict) or not isinstance((data.get("revised") or {}).get("scenes"), list):
        raise genai.GenError("검수 결과 형식이 잘못됐어요 (revised.scenes 없음)")
    allowed = {c["id"] for c in store.read_list("characters")}
    scenes, warnings = merge_revised(original, data["revised"]["scenes"], allowed)
    revised = {"id": sid, "title": original.get("title", ""), "scenes": scenes}
    locked = locked_changes(original, revised)  # merge 뒤라 보통 비어 있음 (안전장치)
    title = str(data.get("title") or "").strip()[:60]
    summary = str((data.get("revised") or {}).get("summary") or "").strip()[:80]
    report = _clean_report(data.get("report"), original)
    hid = f"review-{sid}-{stamp()}-{secrets.token_hex(2)}"
    d = config.HISTORY / hid
    store.write_json(d / "original.json", original)
    store.write_json(
        d / "result.json",
        {"sid": sid, "revised": revised, "report": report, "title": title, "summary": summary, "warnings": warnings, "locked": locked, "feedback": feedback, "model": used, "at": now_iso()},
    )
    entry = _set_entry(sid, status="pending", stale=False, historyId=hid, model={k: used.get(k) for k in ("id", "label", "mock") if k in used}, at=now_iso(), reportCount=len(report), error=None)
    return entry


def _mark_later_stale(sid):
    meta = _index().get(sid)
    if not meta:
        return
    for s in _group_after(meta):
        if entry_of(s["id"]).get("status") == "pending":
            _set_entry(s["id"], stale=True)


def redo(sid, feedback="", model=None):
    """다시 검수 (수정 요청). 뒤 장들의 대기 결과는 이 장을 직전 장으로 읽었으므로 '다시 필요'로"""
    with _lock:
        if _run["running"]:
            raise ValueError("일괄 검수가 진행 중이에요. 멈춘 뒤 다시 해 주세요")
    entry = review_one(sid, feedback, model)
    _mark_later_stale(sid)
    return entry


def approve(sid, scenes=None, title=None, summary=None):
    """승인: 구조 확인 → 대본 저장 · 목록 제목/한 줄 소개 · 요약(recap) 다시 만들기"""
    from . import api  # _make_recap (순환 import 방지)

    e = entry_of(sid)
    if e.get("status") != "pending":
        raise ValueError("승인할 검수 결과가 없어요")
    res = result_of(sid) or {}
    revised = res.get("revised") or {}
    edited = isinstance(scenes, list)
    body = {"id": sid, "title": revised.get("title", ""), "scenes": scenes if edited else revised.get("scenes", [])}
    current = store.read_story(sid) or {}
    locked = locked_changes(current, body)
    if locked:
        raise ValueError("바꾸면 안 되는 부분이 바뀌어서 승인할 수 없어요: " + " / ".join(locked))
    new_title = (title if isinstance(title, str) else res.get("title") or "").strip()[:60]
    new_summary = (summary if isinstance(summary, str) else res.get("summary") or "").strip()[:80]
    if new_title:
        body["title"] = new_title
    store.write_story(sid, body)
    index = store.read_list("storyIndex")
    for s in index:
        if s.get("id") == sid:
            if new_title:
                s["title"] = new_title
            if new_summary:
                s["summary"] = new_summary
    store.write_list("storyIndex", index)
    recap = ""
    try:
        recap = api._make_recap(sid, body["title"] or sid, body, bible.load()["world"])
    except Exception as ex:  # noqa: BLE001 — 요약 실패는 승인을 막지 않음
        recap = f"(요약 실패: {ex})"
    entry = _set_entry(sid, status="approved", stale=False, approvedAt=now_iso(), structure=structure(body), edited=edited)
    if edited:
        _mark_later_stale(sid)
    return {"entry": entry, "recap": recap}


def keep(sid):
    """원본 유지 (검수본 버림). 원본 구조를 기록"""
    if not store.valid_id(sid):
        raise ValueError("잘못된 스토리 id")
    current = store.read_story(sid) or {}
    entry = _set_entry(sid, status="kept", stale=False, keptAt=now_iso(), structure=structure(current))
    _mark_later_stale(sid)
    return entry


def note_manual_save(sid, body):
    """스토리 편집기에서 사람이 저장함 → 검수 기록이 있으면 구조 기준을 새로 (배포 검사가 사람이 고친 걸 오류로 보지 않게)"""
    if entry_of(sid).get("structure") is not None:
        _set_entry(sid, structure=structure(body))


def check_counts(sid, which):
    """체크 전용 검사 (8-3): which = original(검수 전 원본) | current(지금 대본) → 규칙별 문제 수"""
    e = entry_of(sid)
    body = None
    if which == "original" and e.get("historyId"):
        body = store.read_json(_hist_dir(e["historyId"]) / "original.json", None)
    if body is None:
        body = store.read_story(sid) or {}
    ctx = _ctx(sid, body, "check")
    raw, _used = genai.generate_text_ex(prompts.review_prompt(ctx), json_mode=True, mock=lambda: prompts.mock_review(ctx), task="review")
    data = genai.parse_json_text(raw)
    return count_rules(_clean_report((data or {}).get("report") if isinstance(data, dict) else [], body))


# ── 순차 실행 (백그라운드) ──────────────────────────────────
def snapshot():
    idx_items = ordered("all")
    chapters = bible.load()["chapters"]
    items = []
    totals = {"before": {}, "after": {}}
    for s in idx_items:
        e = (chapters.get(s["id"]) or {}).get("review") or {}
        counts = e.get("counts") or {}
        for side in ("before", "after"):
            for k, v in (counts.get(side) or {}).items():
                totals[side][k] = totals[side].get(k, 0) + v
        items.append({"id": s["id"], "title": s.get("title", s["id"]), "kind": s.get("kind"), "chapter": s.get("chapter"), "characterId": s.get("characterId"), "status": e.get("status") or "none", "stale": bool(e.get("stale")), "model": e.get("model"), "at": e.get("at"), "reportCount": e.get("reportCount"), "error": e.get("error"), "counts": counts or None})
    done = sum(1 for i in items if i["status"] in ("approved", "kept"))
    with _lock:
        run = {k: v for k, v in _run.items() if k != "queue"}
        run["remaining"] = len(_run["queue"])
    run["cancelRequested"] = _cancel.is_set() and run["running"]
    return {"items": items, "done": done, "total": len(items), "approved": sum(1 for i in items if i["status"] == "approved"), "run": run, "totals": totals}


def start(scope="main", model=None, mode="review"):
    """일괄 검수(mode review: 아직 안 한 장 · 오류 · 다시 필요) 또는 전후 비교 검사(mode check: 승인한 장)"""
    if mode not in ("review", "check"):
        raise ValueError("mode는 review / check")
    if model:
        genai.resolve_text_model("review", model)
    chapters = bible.load()["chapters"]
    queue = []
    for s in ordered(scope):
        e = (chapters.get(s["id"]) or {}).get("review") or {}
        st = e.get("status") or "none"
        if mode == "review" and (st in ("none", "error") or e.get("stale")):
            queue.append(s["id"])
        if mode == "check" and st == "approved":
            queue.append(s["id"])
    if not queue:
        raise ValueError("검수할 장이 없어요" if mode == "review" else "전후 비교할 승인된 장이 없어요")
    with _lock:
        if _run["running"]:
            raise ValueError("이미 진행 중이에요")
        _cancel.clear()
        _run.update(running=True, mode=mode, current=None, queue=queue, startedAt=now_iso(), finishedAt=None, error=None, model=model)
    threading.Thread(target=_worker, daemon=True, name="tinydev-review").start()
    return snapshot()


def cancel():
    with _lock:
        if _run["running"]:
            _cancel.set()
    return snapshot()


def _worker():
    try:
        while not _cancel.is_set():
            with _lock:
                if not _run["queue"]:
                    break
                sid = _run["queue"].pop(0)
                _run["current"] = sid
                mode, model = _run["mode"], _run.get("model")
            try:
                if mode == "review":
                    review_one(sid, model=model)
                else:
                    counts = {"before": check_counts(sid, "original"), "after": check_counts(sid, "current"), "at": now_iso()}
                    _set_entry(sid, counts=counts)
            except Exception as e:  # noqa: BLE001 — 장 하나가 실패해도 기록하고 다음 장으로
                if mode == "review":
                    _set_entry(sid, status="error", error=str(e)[:300], at=now_iso())
                else:
                    with _lock:
                        _run["error"] = f"{sid}: {str(e)[:200]}"
    finally:
        with _lock:
            _run.update(running=False, current=None, queue=[], finishedAt=now_iso())
