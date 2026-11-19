"""ComfyUI 연결 (내 PC에서 실행 중인 ComfyUI의 HTTP API 사용).

흐름: POST /prompt (워크플로 전송) → GET /history/<id> 로 완료 확인 → GET /view 로 그림 받기
기본 워크플로(텍스트 → 이미지)를 내장하고 있어서 ComfyUI 쪽에서 따로 만들 필요가 없습니다.
필요한 것: ComfyUI 실행 + 모델 파일.
  - 'checkpoint' 방식: models/checkpoints 에 체크포인트 하나 (SDXL/SD1.5 등, 모델+CLIP+VAE가 한 파일)
  - 'split' 방식: models/diffusion_models(또는 unet) + models/text_encoders(또는 clip) + models/vae 에 따로 나뉜 파일
    (예: Anima / Anima Turbo, Flux, Qwen-Image 같은 확산 모델)
"""
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .genai import GenError

class ConnectError(GenError):
    """ComfyUI에 아예 연결이 안 됨 (일괄 생성은 바로 멈춤)"""


class Cancelled(GenError):
    """개발자가 중단함"""


TIMEOUT_SEC = 600  # 큰 모델/느린 PC 대비 최대 10분 대기

# 비율 → (가로, 세로). 8의 배수, SDXL은 약 100만 픽셀, SD1.5는 512 기준
SIZES = {
    "sdxl": {"3:4": (896, 1152), "16:9": (1344, 768), "1:1": (1024, 1024), "3:2": (1216, 832), "2:3": (832, 1216)},
    "sd15": {"3:4": (576, 768), "16:9": (768, 432), "1:1": (512, 512), "3:2": (768, 512), "2:3": (512, 768)},
}


def _request(url, data=None, timeout=15):
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8") if data is not None else None)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise GenError(f"ComfyUI 오류 (HTTP {e.code}): {_explain(body)}") from e
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise ConnectError(f"ComfyUI에 연결할 수 없어요 ({url}). ComfyUI가 켜져 있는지, 설정의 주소가 맞는지 확인해 주세요. [{e}]") from e


def _explain(body):
    """ComfyUI 오류 응답을 읽기 쉽게"""
    try:
        j = json.loads(body)
    except json.JSONDecodeError:
        return body[:500]
    parts = []
    err = j.get("error")
    if isinstance(err, dict):
        parts.append(err.get("message", ""))
        if err.get("details"):
            parts.append(str(err["details"]))
    elif err:
        parts.append(str(err))
    for node_id, ne in (j.get("node_errors") or {}).items():
        for e in ne.get("errors", []):
            parts.append(f"[노드 {node_id} {ne.get('class_type', '')}] {e.get('message', '')}: {e.get('details', '')}")
    return " / ".join(p for p in parts if p)[:800] or body[:500]


def _json(url, data=None, timeout=15):
    return json.loads(_request(url, data, timeout).decode("utf-8"))


def _choices(info, node, field):
    """object_info에서 선택지 목록 꺼내기 (ComfyUI 버전별 형식 모두 지원)"""
    try:
        spec = info[node]["input"]["required"][field]
    except (KeyError, TypeError):
        return []
    first = spec[0] if isinstance(spec, list) and spec else None
    if isinstance(first, list):  # 예전 형식: [[선택지...], {...}]
        return first
    if first == "COMBO" and len(spec) > 1 and isinstance(spec[1], dict):  # 새 형식
        return spec[1].get("options", [])
    return []


def _node_info(base, node):
    """노드 정보 (없는 노드면 빈 dict)"""
    try:
        return _json(f"{base}/object_info/{node}", timeout=10)
    except GenError:
        return {}


def check(cfg):
    """연결 확인 + 모델 파일/샘플러 목록"""
    base = cfg["url"]
    stats = _json(f"{base}/system_stats", timeout=5)
    info = {n: _node_info(base, n) for n in ("CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "VAELoader", "KSampler")}
    devices = [d.get("name", "") for d in stats.get("devices", [])]
    return {
        "ok": True,
        "version": (stats.get("system") or {}).get("comfyui_version", ""),
        "devices": devices,
        "checkpoints": _choices(info["CheckpointLoaderSimple"], "CheckpointLoaderSimple", "ckpt_name"),
        "unets": _choices(info["UNETLoader"], "UNETLoader", "unet_name"),
        "weightDtypes": _choices(info["UNETLoader"], "UNETLoader", "weight_dtype"),
        "clips": _choices(info["CLIPLoader"], "CLIPLoader", "clip_name"),
        "clipTypes": _choices(info["CLIPLoader"], "CLIPLoader", "type"),
        "vaes": _choices(info["VAELoader"], "VAELoader", "vae_name"),
        "samplers": _choices(info["KSampler"], "KSampler", "sampler_name"),
        "schedulers": _choices(info["KSampler"], "KSampler", "scheduler"),
    }


def _loaders(cfg):
    """모델 불러오기 노드들 → (노드 dict, model 연결, clip 연결, vae 연결)"""
    if cfg.get("loader") == "split":
        nodes = {
            "10": {"class_type": "UNETLoader", "inputs": {"unet_name": cfg["unet"], "weight_dtype": cfg["weightDtype"]}},
            "11": {"class_type": "CLIPLoader", "inputs": {"clip_name": cfg["clip"], "type": cfg["clipType"]}},
            "12": {"class_type": "VAELoader", "inputs": {"vae_name": cfg["vae"]}},
        }
        return nodes, ["10", 0], ["11", 0], ["12", 0]
    nodes = {"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": cfg["checkpoint"]}}}
    return nodes, ["4", 0], ["4", 1], ["4", 2]


def missing_model(cfg):
    """설정에 빠진 모델 파일이 있으면 안내 문구, 없으면 None"""
    if cfg.get("loader") == "split":
        names = {"unet": "확산 모델", "clip": "텍스트 인코더", "vae": "VAE"}
        empty = [label for key, label in names.items() if not cfg.get(key)]
        return f"ComfyUI {', '.join(empty)} 파일을 설정 탭에서 골라 주세요" if empty else None
    return None if cfg.get("checkpoint") else "ComfyUI 체크포인트를 설정 탭에서 골라 주세요"


def model_label(cfg):
    """상단 표시용 모델 이름 (미설정이면 빈 문자열)"""
    if missing_model(cfg):
        return ""
    name = cfg["unet"] if cfg.get("loader") == "split" else cfg["checkpoint"]
    return name.replace("\\", "/").rsplit("/", 1)[-1]


def build_workflow(prompt, negative, width, height, seed, cfg):
    """기본 텍스트→이미지 워크플로 (ComfyUI 'API 형식')"""
    nodes, model, clip, vae = _loaders(cfg)
    return {
        **nodes,
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": clip}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": cfg["steps"],
                "cfg": cfg["cfg"],
                "sampler_name": cfg["sampler"],
                "scheduler": cfg["scheduler"],
                "denoise": 1.0,
                "model": model,
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": vae}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "tinygacha", "images": ["8", 0]}},
    }


def interrupt(cfg, prompt_id):
    """이 프롬프트만 대기열에서 빼고, 그리는 중이면 멈추기 (실패해도 무시)"""
    base = cfg["url"]
    for path, data in (("/queue", {"delete": [prompt_id]}), ("/interrupt", {"prompt_id": prompt_id})):
        try:
            _request(f"{base}{path}", data, timeout=5)
        except GenError:
            pass


def generate(prompt, negative, aspect_ratio, cfg, cancel=None):
    """그림 한 장 생성 → (PNG 바이트, seed)
    cancel: threading.Event — 켜지면 ComfyUI 작업을 멈추고 Cancelled 발생
    """
    if cancel is not None and cancel.is_set():
        raise Cancelled("중단했어요")
    problem = missing_model(cfg)
    if problem:
        raise GenError(problem)
    width, height = SIZES[cfg["resolution"]].get(aspect_ratio, SIZES[cfg["resolution"]]["1:1"])
    seed = random.randint(1, 2**48)
    workflow = build_workflow(prompt, negative, width, height, seed, cfg)
    base = cfg["url"]
    sent = _json(f"{base}/prompt", {"prompt": workflow, "client_id": uuid.uuid4().hex})
    if sent.get("node_errors"):
        raise GenError(f"ComfyUI 워크플로 오류: {_explain(json.dumps(sent))}")
    prompt_id = sent.get("prompt_id")
    if not prompt_id:
        raise GenError(f"ComfyUI 응답에 prompt_id가 없어요: {str(sent)[:300]}")

    deadline = time.time() + TIMEOUT_SEC
    while time.time() < deadline:
        hist = _json(f"{base}/history/{prompt_id}")
        item = hist.get(prompt_id)
        if item:
            status = item.get("status") or {}
            if status.get("status_str") == "error":
                msgs = [m[1].get("exception_message", "") for m in status.get("messages", []) if isinstance(m, list) and len(m) > 1 and isinstance(m[1], dict)]
                raise GenError(f"ComfyUI 실행 오류: {' '.join(msgs)[:600] or '알 수 없음'}")
            for out in (item.get("outputs") or {}).values():
                for image in out.get("images", []):
                    q = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")})
                    return _request(f"{base}/view?{q}", timeout=60), seed
            if status.get("completed"):
                raise GenError("ComfyUI가 끝났지만 그림이 없어요 (SaveImage 노드 확인)")
        if cancel is None:
            time.sleep(1.0)
        elif cancel.wait(1.0):
            interrupt(cfg, prompt_id)
            raise Cancelled("중단했어요 (ComfyUI 작업도 멈췄어요)")
    raise GenError(f"ComfyUI 생성이 {TIMEOUT_SEC // 60}분 안에 끝나지 않았어요")
