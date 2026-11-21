"""생성 작업(job) 기록: dev/history/<jobId>/

한 작업 = 캐릭터 하나(또는 배너 그림 하나, 배경 하나)를 완성하기까지의 모든 시도.
시도(attempt)마다 원본, 결과(캐릭터는 배경 제거본), 프롬프트, 거절 사유를 파일로 남깁니다.

  dev/history/char-20261119-130501-ab12/
    job.json
    a01-original.png  a01-result-1.png  a01-prompt.txt  a01-reject.txt
    a02-original.png  a02-result-1.png  a02-result-2.png(배경 제거 다시 하기) ...
"""
import json
import secrets

from . import config, cutout, images, store, uislots
from .timeutil import now_iso, stamp

KINDS = ("char", "banner", "bg", "ui", "enemy", "prop")
PROP_LONG_SIDE = 384  # 소품(상점 상품 그림 등)


def job_dir(job_id):
    if not store.valid_id(job_id):
        raise ValueError("잘못된 작업 id")
    return config.HISTORY / job_id


def load(job_id):
    path = job_dir(job_id) / "job.json"
    if not path.exists():
        raise FileNotFoundError("작업을 찾을 수 없어요")
    return json.loads(path.read_text(encoding="utf-8"))


def save(job):
    store.write_json(job_dir(job["id"]) / "job.json", job)


def create(kind, payload):
    if kind not in KINDS:
        raise ValueError("잘못된 작업 종류")
    job = {
        "id": f"{kind}-{stamp()}-{secrets.token_hex(2)}",
        "kind": kind,
        "createdAt": now_iso(),
        "input": payload,
        "attempts": [],
        "status": "open",
        "approved": None,
    }
    job_dir(job["id"]).mkdir(parents=True, exist_ok=True)
    save(job)
    return job


def reject_reasons(job):
    """지금까지 거절하며 적은 사유들 (다음 프롬프트에 합쳐짐)"""
    return [a["rejectReason"] for a in job["attempts"] if a.get("rejectReason")]


def is_cutout_job(job):
    """배경 제거가 필요한 작업: 캐릭터, 적, 소품, UI 아이콘/로고"""
    if job["kind"] in ("char", "enemy", "prop"):
        return True
    slot = uislots.SLOT_BY_KEY.get(job["input"].get("slot")) if job["kind"] == "ui" else None
    return bool(slot and slot["kind"] in ("icon", "logo"))


def _process(job, original_img, flatten=None):
    """원본 → 결과 이미지
    캐릭터: 배경 제거 + 긴 변 512px / UI 아이콘: 배경 제거 + 256px(로고 640px) / 배너·배경: 1280x720 JPG"""
    if is_cutout_job(job):
        long_side = None
        if job["kind"] == "ui":
            slot = uislots.SLOT_BY_KEY[job["input"]["slot"]]
            long_side = uislots.LOGO_LONG_SIDE if slot["kind"] == "logo" else uislots.ICON_LONG_SIDE
        elif job["kind"] == "prop":
            long_side = PROP_LONG_SIDE
        img, method, warning = cutout.make_cutout(original_img, flatten, long_side)
        return img, "png", method, warning
    size = config.BANNER_SIZE if job["kind"] == "banner" else config.BG_SIZE
    return images.cover_resize(original_img, size), "jpg", "resize", None


def _check(job, img):
    """캐릭터 결과 자동 검사 (설정화 / 여러 명). 검사 중 오류는 무시"""
    if job["kind"] != "char":
        return None
    try:
        return images.figure_check(img)
    except Exception:  # noqa: BLE001
        return None


def _write_result(job, attempt, img, ext):
    n = len(attempt["results"]) + 1
    name = f"a{attempt['n']:02d}-result-{n}.{ext}"
    path = job_dir(job["id"]) / name
    if ext == "png":
        img.save(path, "PNG", optimize=True)
    else:
        images.save_jpeg(img, path)
    attempt["results"].append(name)
    attempt["result"] = name


def add_attempt(job, prompt, image_bytes, meta=None):
    """새로 생성한 원본 이미지를 시도로 추가하고 결과 이미지를 만듦
    meta: corePrompt(AI/개발자가 쓴 핵심 프롬프트), negative, engine, seed, promptSource, genWarning
    """
    n = len(job["attempts"]) + 1
    folder = job_dir(job["id"])
    original_name = f"a{n:02d}-original.png"
    original = images.open_image(image_bytes)
    original.convert("RGB").save(folder / original_name, "PNG")
    (folder / f"a{n:02d}-prompt.txt").write_text(prompt, encoding="utf-8")

    attempt = {
        "n": n,
        "createdAt": now_iso(),
        "prompt": prompt,
        "rejectReason": None,
        "original": original_name,
        "results": [],
        "result": None,
        "method": None,
        "warning": None,
        "flatten": None,
        "corePrompt": prompt,
        "negative": "",
        "engine": None,
        "seed": None,
        "promptSource": None,
        "genWarning": None,
        "check": None,  # 캐릭터 자동 검사 결과 (문제 설명, 통과면 None)
    }
    attempt.update({k: v for k, v in (meta or {}).items() if k in attempt})
    img, ext, method, warning = _process(job, original)
    _write_result(job, attempt, img, ext)
    attempt["method"], attempt["warning"], attempt["check"] = method, warning, _check(job, img)
    job["attempts"].append(attempt)
    save(job)
    return attempt


def get_attempt(job, n):
    for a in job["attempts"]:
        if a["n"] == int(n):
            return a
    raise ValueError("시도를 찾을 수 없어요")


def redo_cutout(job, n, flatten_color=None):
    """같은 원본으로 배경 제거만 다시 (선택: 배경을 단색으로 먼저 칠하기)"""
    attempt = get_attempt(job, n)
    original = images.open_image(job_dir(job["id"]) / attempt["original"])
    img, ext, method, warning = _process(job, original, flatten_color)
    _write_result(job, attempt, img, ext)
    attempt["method"], attempt["warning"], attempt["flatten"] = method, warning, flatten_color
    attempt["check"] = _check(job, img)
    save(job)
    return attempt


def reject(job, n, reason):
    attempt = get_attempt(job, n)
    attempt["rejectReason"] = reason.strip()
    (job_dir(job["id"]) / f"a{attempt['n']:02d}-reject.txt").write_text(attempt["rejectReason"], encoding="utf-8")
    save(job)
    return attempt


def result_path(job, n):
    attempt = get_attempt(job, n)
    return job_dir(job["id"]) / attempt["result"]


def mark_approved(job, n, path):
    job["status"] = "approved"
    job["approved"] = {"attempt": int(n), "path": path, "at": now_iso()}
    save(job)


def char_look(cid):
    """캐릭터 그림을 만들 때 쓴 외형 프롬프트 (배너에서 같은 모습으로 그리기 위해). 없으면 ''"""
    if not config.HISTORY.exists() or not store.valid_id(cid):
        return ""
    rel = f"assets/chars/{cid}.png"
    fallback = ""
    for d in sorted(config.HISTORY.iterdir(), reverse=True):
        if not d.name.startswith("char-"):
            continue
        try:
            job = json.loads((d / "job.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        approved = job.get("approved") or {}
        if approved.get("path") == rel:
            try:
                a = get_attempt(job, approved["attempt"])
            except (ValueError, KeyError):
                continue
            return a.get("corePrompt") or a.get("prompt") or job["input"].get("keywords", "")
        if not fallback and job["input"].get("charId") == cid and job["input"].get("keywords"):
            fallback = job["input"]["keywords"]
    return fallback


def list_jobs(kind=None, limit=30):
    if not config.HISTORY.exists():
        return []
    out = []
    for d in sorted(config.HISTORY.iterdir(), reverse=True):
        if not d.is_dir() or (kind and not d.name.startswith(f"{kind}-")):
            continue
        try:
            job = json.loads((d / "job.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        out.append(
            {
                "id": job["id"],
                "kind": job["kind"],
                "createdAt": job["createdAt"],
                "status": job["status"],
                "label": job["input"].get("name") or job["input"].get("bannerId") or job["input"].get("bgName") or uislots.SLOT_BY_KEY.get(job["input"].get("slot"), {}).get("label") or "",
                "attempts": len(job["attempts"]),
                "thumb": job["attempts"][-1]["result"] if job["attempts"] else None,
            }
        )
        if len(out) >= limit:
            break
    return out
