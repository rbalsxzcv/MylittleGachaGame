"""배경 제거: BRIA RMBG(로컬 AI 모델) → 투명 여백 자르기 → 긴 변 512px.

RMBG를 쓰려면 torch / transformers 등이 설치되어 있어야 합니다 (dev/README.md 참고).
설치되어 있지 않거나 불러오기에 실패하면 '간단 모드'(단색 배경 지우기)로 대신 처리하고
결과에 method='simple'을 표시합니다.

※ BRIA RMBG 모델은 비상업 라이선스입니다. 이 프로젝트는 비상업 용도라 사용 가능하지만,
  상업적으로 쓰려면 BRIA와 별도 계약이 필요합니다.
"""
import importlib.util
import threading

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


def _rmbg_mask(img):
    """RMBG로 전경 마스크(L 모드) 계산"""
    model = _load()
    if model is None:
        return None
    if _state["kind"] == "pipeline":
        return model(img, return_mask=True).convert("L").resize(img.size)

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
    return transforms.ToPILImage()(pred).resize(img.size)


def make_cutout(original, flatten_color=None):
    """원본 이미지 → 최종 캐릭터 PNG (투명 배경, 여백 제거, 긴 변 512px)

    flatten_color: '#ffffff' 같은 값이면 먼저 배경을 그 색으로 평평하게 칠한 뒤 제거
    returns: (RGBA 이미지, 사용한 방법 'rmbg' | 'simple', 경고 메시지 또는 None)
    """
    img = original.convert("RGB")
    if flatten_color:
        img = images.flatten_background(img, images.parse_hex_color(flatten_color))

    warning = None
    method = "rmbg"
    try:
        mask = _rmbg_mask(img)
    except Exception as e:
        mask = None
        _state["error"] = f"RMBG 실행 오류: {e}"
    if mask is None:
        method = "simple"
        warning = _state["error"]
        rgba = images.simple_cutout(img)
    else:
        rgba = img.convert("RGBA")
        rgba.putalpha(mask)

    rgba = images.trim_transparent(rgba)
    rgba = images.resize_long_side(rgba, config.CHAR_LONG_SIDE)
    return rgba, method, warning
