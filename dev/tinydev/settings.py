"""개발 도구 설정 (dev/settings.json, git에 안 올라감).

비밀 정보(키)는 여기 넣지 않습니다 — 키는 dev/.env 에만.
여기에는 ComfyUI 주소/모델 파일 같은 작업 환경만 저장합니다. (그림은 ComfyUI로만 그려요)
"""
import copy
import json
import threading

from . import config, store

PATH = config.DEV / "settings.json"
_lock = threading.Lock()

DEFAULTS = {
    "engine": "comfy",  # 그림 엔진 (ComfyUI 고정, 예전 설정 파일 호환용)
    "aiPrompt": True,  # True면 Gemini가 Anima용 그림 프롬프트를 작성
    "theme": "아기자기한 판타지 마법 세계, 밤하늘과 별빛, 파스텔 보라·분홍 톤",  # UI 에셋 공통 분위기
    "comfy": {
        "url": "http://127.0.0.1:8188",
        "loader": "checkpoint",  # 'checkpoint'(한 파일) | 'split'(확산 모델 + 텍스트 인코더 + VAE 따로)
        "checkpoint": "",
        "unet": "",  # split: models/diffusion_models 파일
        "weightDtype": "default",
        "clip": "",  # split: models/text_encoders 파일
        "clipType": "stable_diffusion",  # split: CLIPLoader type (모델 종류마다 다름)
        "vae": "",  # split: models/vae 파일
        "resolution": "sdxl",  # 'sdxl'(1024 기준) | 'sd15'(512 기준)
        "steps": 28,
        "cfg": 6.0,
        "sampler": "euler_ancestral",
        "scheduler": "normal",
        "quality": "masterpiece, best quality, safe",  # Anima 품질/등급 태그 (프롬프트 맨 앞)
        "negative": "worst quality, low quality, lowres, blurry, jpeg artifacts, bad anatomy, bad hands, extra fingers, missing fingers, text, watermark, signature, artist name, nsfw",
    },
}


def _merge(base, extra):
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _merge(out[k], v)
        elif k in out:
            out[k] = v
    return out


def load():
    try:
        raw = json.loads(PATH.read_text(encoding="utf-8")) if PATH.exists() else {}
    except (OSError, json.JSONDecodeError):
        raw = {}
    return clean(_merge(DEFAULTS, raw))


def clean(s):
    """값 범위 정리 (잘못된 값은 기본값으로)"""
    d = DEFAULTS
    s["engine"] = "comfy"
    s["aiPrompt"] = bool(s.get("aiPrompt"))
    s["theme"] = str(s.get("theme") or "")[:500]
    c = s["comfy"]
    url = str(c.get("url") or d["comfy"]["url"]).strip().rstrip("/")
    # 보안: ComfyUI는 내 컴퓨터(또는 같은 네트워크)의 http 주소만
    c["url"] = url if url.startswith(("http://", "https://")) else d["comfy"]["url"]
    c["loader"] = c.get("loader") if c.get("loader") in ("checkpoint", "split") else "checkpoint"
    for k in ("checkpoint", "unet", "clip", "vae"):
        c[k] = str(c.get(k) or "")[:300]
    c["weightDtype"] = str(c.get("weightDtype") or "default")[:40]
    c["clipType"] = str(c.get("clipType") or d["comfy"]["clipType"])[:40]
    c["resolution"] = c.get("resolution") if c.get("resolution") in ("sdxl", "sd15") else "sdxl"
    try:
        c["steps"] = max(1, min(150, int(c.get("steps"))))
    except (TypeError, ValueError):
        c["steps"] = d["comfy"]["steps"]
    try:
        c["cfg"] = max(1.0, min(30.0, float(c.get("cfg"))))
    except (TypeError, ValueError):
        c["cfg"] = d["comfy"]["cfg"]
    c["sampler"] = str(c.get("sampler") or d["comfy"]["sampler"])[:60]
    c["scheduler"] = str(c.get("scheduler") or d["comfy"]["scheduler"])[:60]
    c["quality"] = str(c.get("quality") or "")[:300]
    c["negative"] = str(c.get("negative") or "")[:2000]
    return s


def save(new):
    with _lock:
        merged = clean(_merge(load(), new if isinstance(new, dict) else {}))
        store.write_json(PATH, merged)
        return merged
