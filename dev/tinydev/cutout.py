"""배경 제거: BRIA RMBG(로컬 AI 모델) → 원본 크기 마스크 → 원본에 알파로 적용 → 투명 여백 자르기.

화질 원칙
- 원본(생성된 PNG)은 건드리지 않음. 결과 색은 원본 픽셀 그대로, RMBG에서는 마스크(알파)만 가져옴.
- 마스크는 모델 해상도(1024²)에서 원본 W×H로 고품질 확대(LANCZOS, 실수 정밀도)한 뒤
  1px 깎기(erode) + 1px 부드럽게(feather)로 흰 테두리를 없앰.
- 배경 제거 직후 결과는 원본과 크기가 같아야 함 (다르면 오류). 그다음 투명 여백만 잘라냄.
  캐릭터/적은 줄이지 않음(원본 해상도). UI 아이콘/로고/소품만 long_side로 줄임.

RMBG를 쓰려면 torch / transformers 등이 설치되어 있어야 합니다 (dev/README.md 참고).
설치되어 있지 않거나 불러오기에 실패하면 '간단 모드'(단색 배경 지우기)로 대신 처리하고
결과에 method='simple'을 표시합니다.

※ BRIA RMBG 모델은 비상업 라이선스입니다. 이 프로젝트는 비상업 용도라 사용 가능하지만,
  상업적으로 쓰려면 BRIA와 별도 계약이 필요합니다.
"""
import importlib.util
import threading

from PIL import Image, ImageFilter

from . import config, images

_lock = threading.Lock()
_state = {"model": None, "kind": None, "error": None, "tried": False, "device": None}


def libs_installed():
    return all(importlib.util.find_spec(m) is not None for m in ("torch", "torchvision", "transformers"))


def status():
    return {
        "installed": libs_installed(),
        "loaded": _state["model"] is not None,
        "model": config.RMBG_MODEL,
        "device": _state["device"],
        "error": _state["error"],
    }


def _load():
    """모델을 처음 쓸 때 한 번만 불러옴 (몇 초~수십 초 걸릴 수 있음)"""
    with _lock:
        if _state["model"] is not None or _state["tried"]:
            return _state["model"]
        _state["tried"] = True
        if not libs_installed():
            _state["error"] = "torch/transformers 미설치 → 간단 모드 사용"
            return None
        try:
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_id = config.RMBG_MODEL
            if "1.4" in model_id:
                from transformers import pipeline

                _state["model"] = pipeline("image-segmentation", model=model_id, trust_remote_code=True, device=0 if device == "cuda" else -1)
                _state["kind"] = "pipeline"
            else:
                from transformers import AutoModelForImageSegmentation

                model = AutoModelForImageSegmentation.from_pretrained(model_id, trust_remote_code=True)
                model.to(device).eval()
                _state["model"] = model
                _state["kind"] = "rmbg2"
            _state["device"] = device
            _state["error"] = None
        except Exception as e:  # 모델 다운로드 실패, 라이선스 미동의 등
            _state["error"] = f"RMBG 불러오기 실패: {e}"
            _state["model"] = None
        return _state["model"]


def _as_mask(out):
    """모델 출력 그림에서 마스크만: RGBA면 알파 채널, 아니면 흑백(L)"""
    if out.mode in ("RGBA", "LA") or (out.mode == "P" and "transparency" in out.info):
        return out.convert("RGBA").getchannel("A")
    return out.convert("L")


def _upscale_mask(mask, size):
    """마스크를 원본 크기로 고품질 확대 (실수 정밀도로 LANCZOS → 0~255로 자르고 L)"""
    if mask.size == size:
        return mask.convert("L") if mask.mode != "L" else mask
    import numpy as np

    f = np.asarray(mask.convert("F").resize(size, Image.LANCZOS), dtype=np.float32)
    return Image.fromarray(np.clip(np.rint(f), 0, 255).astype(np.uint8), mode="L")


def _rmbg_mask(img):
    """RMBG로 전경 마스크 계산 → 원본(img)과 정확히 같은 크기의 L 마스크"""
    model = _load()
    if model is None:
        return None
    if _state["kind"] == "pipeline":
        return _upscale_mask(_as_mask(model(img, return_mask=True)), img.size)

    import numpy as np
    import torch
    from torchvision import transforms

    transform = transforms.Compose(
        [
            transforms.Resize((1024, 1024)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    tensor = transform(img.convert("RGB")).unsqueeze(0).to(_state["device"])
    with torch.no_grad():
        pred = model(tensor)[-1].sigmoid().cpu()[0].squeeze()
    # 8비트로 줄이기 전에 실수(0~255) 그대로 확대 → 계단/띠 없이 부드러운 가장자리
    small = Image.fromarray((pred.numpy().astype(np.float32) * 255.0), mode="F")
    return _upscale_mask(small, img.size)


def refine_mask(mask, erode_px=None, feather_px=None):
    """흰 테두리 없애기: erode_px만큼 깎고(MinFilter) feather_px만큼 부드럽게(GaussianBlur)"""
    erode_px = config.CUTOUT_ERODE_PX if erode_px is None else erode_px
    feather_px = config.CUTOUT_FEATHER_PX if feather_px is None else feather_px
    if erode_px > 0:
        mask = mask.filter(ImageFilter.MinFilter(2 * int(erode_px) + 1))
    if feather_px > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather_px))
    return mask


def cutout_full(original, flatten_color=None):
    """배경 제거 (자르기/줄이기 전): 원본과 같은 W×H의 RGBA

    flatten_color: '#ffffff' 같은 값이면 배경을 그 색으로 평평하게 칠한 그림을 '모델 입력'으로만 씀
                   (결과 색은 항상 칠하지 않은 원본 그대로)
    returns: (RGBA 이미지, 'rmbg' | 'simple', 경고 메시지 또는 None)
    """
    base = original.convert("RGB")  # 원본 픽셀 — 결과 색의 출처, 수정하지 않음
    model_input = images.flatten_background(base, images.parse_hex_color(flatten_color)) if flatten_color else base

    warning = None
    method = "rmbg"
    try:
        mask = _rmbg_mask(model_input)
    except Exception as e:
        mask = None
        _state["error"] = f"RMBG 실행 오류: {e}"
    if mask is None:
        method = "simple"
        warning = _state["error"]
        alpha = images.simple_cutout(model_input).getchannel("A")
        full = Image.merge("RGBA", (*base.split(), alpha))
    else:
        full = base.convert("RGBA")
        full.putalpha(refine_mask(mask))

    if full.size != original.size:
        raise RuntimeError(f"배경 제거 결과 크기가 원본과 달라요 ({full.size[0]}×{full.size[1]} ≠ {original.size[0]}×{original.size[1]})")
    return full, method, warning


def make_cutout(original, flatten_color=None, long_side=None):
    """원본 이미지 → 최종 PNG (투명 배경, 여백 제거)

    long_side: None이면 줄이지 않음 (캐릭터/적 = 원본 해상도). 숫자면 긴 변이 그보다 클 때만 줄임 (UI 아이콘/소품)
    returns: (RGBA 이미지, 사용한 방법 'rmbg' | 'simple', 경고 메시지 또는 None)
    """
    full, method, warning = cutout_full(original, flatten_color)
    rgba = images.trim_transparent(full)
    if long_side:
        rgba = images.shrink_long_side(rgba, long_side)
    return rgba, method, warning
