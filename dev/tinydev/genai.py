"""Vertex AI (google-genai SDK) 호출 — 이미지 생성(Nano Banana)과 텍스트 생성(Gemini).

인증: 환경 변수 GOOGLE_APPLICATION_CREDENTIALS (서비스 계정 키 파일 경로) 또는 gcloud 로그인.
      키 내용/경로는 코드나 화면에 절대 넣지 않습니다.
Vertex 설정이 없거나 TG_MOCK=1이면 '모의 모드'로 가짜 이미지/텍스트를 만듭니다.
"""
import hashlib
import io
import json
import math
import random
import threading

from . import config

_client = None
_lock = threading.Lock()


class GenError(Exception):
    """사용자에게 보여줄 생성 오류"""


def is_mock():
    return not config.vertex_configured()


def status():
    return {
        "mock": is_mock(),
        "forcedMock": config.FORCE_MOCK,
        "project": bool(config.GCP_PROJECT),  # 프로젝트 ID 자체는 화면에 보내지 않음
        "location": config.GCP_LOCATION,
        "imageModel": config.IMAGE_MODEL,
        "textModel": config.TEXT_MODEL,
    }


def _get_client():
    global _client
    with _lock:
        if _client is None:
            try:
                from google import genai
            except ImportError as e:
                raise GenError("google-genai 패키지가 설치되지 않았어요 (pip install -r requirements.txt)") from e
            _client = genai.Client(vertexai=True, project=config.GCP_PROJECT, location=config.GCP_LOCATION)
        return _client


# ─────────────────────────────────────────────────────────
# 이미지 생성
# ─────────────────────────────────────────────────────────
def generate_image(prompt, aspect_ratio="3:4", refs=(), mock_kind="char", mock_label=""):
    """프롬프트(+참고 이미지) → PNG/JPEG 바이트

    refs: [(bytes, mime_type), ...] 참고 이미지 (예: 배너에 들어갈 캐릭터 그림)
    """
    if is_mock():
        return _mock_image(prompt, aspect_ratio, mock_kind, mock_label)

    from google.genai import types

    contents = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in refs]
    contents.append(prompt)
    cfg = {"response_modalities": ["TEXT", "IMAGE"]}
    try:
        cfg["image_config"] = types.ImageConfig(aspect_ratio=aspect_ratio)
    except (AttributeError, TypeError):
        # 오래된 SDK: 비율은 프롬프트로 전달
        contents[-1] = f"{prompt}\nAspect ratio: {aspect_ratio}."
    try:
        resp = _get_client().models.generate_content(
            model=config.IMAGE_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(**cfg),
        )
    except GenError:
        raise
    except Exception as e:
        raise GenError(f"이미지 생성 요청 실패: {e}") from e

    texts = []
    for cand in resp.candidates or []:
        for part in (cand.content.parts if cand.content else []) or []:
            if getattr(part, "inline_data", None) and part.inline_data.data:
                return part.inline_data.data
            if getattr(part, "text", None):
                texts.append(part.text)
    reason = ""
    if resp.candidates:
        reason = str(getattr(resp.candidates[0], "finish_reason", "") or "")
    feedback = getattr(resp, "prompt_feedback", None)
    if feedback and getattr(feedback, "block_reason", None):
        reason = f"차단됨: {feedback.block_reason}"
    raise GenError(f"이미지가 생성되지 않았어요. {reason} {' '.join(texts)[:300]}".strip())


# ─────────────────────────────────────────────────────────
# 텍스트 생성
# ─────────────────────────────────────────────────────────
def generate_text(prompt, json_mode=False, mock=None):
    """프롬프트 → 텍스트. json_mode면 JSON 문자열을 기대"""
    if is_mock():
        return mock() if callable(mock) else (mock or "(모의 모드) 생성된 텍스트")

    from google.genai import types

    cfg = types.GenerateContentConfig(response_mime_type="application/json") if json_mode else None
    try:
        resp = _get_client().models.generate_content(model=config.TEXT_MODEL, contents=prompt, config=cfg)
    except GenError:
        raise
    except Exception as e:
        raise GenError(f"텍스트 생성 요청 실패: {e}") from e
    text = (resp.text or "").strip()
    if not text:
        raise GenError("텍스트가 생성되지 않았어요 (안전 필터 등)")
    return text


def parse_json_text(text):
    """모델이 ```json 으로 감싸서 줄 때도 처리"""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    try:
        return json.loads(t)
    except json.JSONDecodeError as e:
        raise GenError(f"AI 응답을 JSON으로 읽지 못했어요: {e}") from e


# ─────────────────────────────────────────────────────────
# 모의 모드: Pillow로 그린 가짜 이미지
# ─────────────────────────────────────────────────────────
def _font(size):
    from PIL import ImageFont

    for name in ("malgun.ttf", "malgunbd.ttf", "AppleSDGothicNeo.ttc", "NotoSansCJK-Regular.ttc", "NanumGothic.ttf"):
        for base in ("C:/Windows/Fonts/", "/System/Library/Fonts/", "/usr/share/fonts/opentype/noto/", ""):
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _ratio_size(aspect_ratio, long_side):
    try:
        a, b = (int(x) for x in aspect_ratio.split(":"))
    except ValueError:
        a, b = 3, 4
    if a >= b:
        return long_side, round(long_side * b / a)
    return round(long_side * a / b), long_side


def _mock_image(prompt, aspect_ratio, kind, label):
    from PIL import Image, ImageDraw

    seed = int(hashlib.sha1(prompt.encode("utf-8")).hexdigest()[:8], 16)
    rnd = random.Random(seed)
    hue = lambda: tuple(rnd.randint(60, 230) for _ in range(3))  # noqa: E731
    w, h = _ratio_size(aspect_ratio, 1024)
    if kind == "char":
        img = Image.new("RGB", (w, h), (255, 255, 255))
        d = ImageDraw.Draw(img)
        main, sub, hair = hue(), hue(), hue()
        cx = w // 2
        # 몸 / 다리 / 팔 / 머리 / 머리카락 / 눈 (아주 단순한 인형 모양)
        d.rounded_rectangle((cx - 120, h * 0.42, cx + 120, h * 0.78), 60, fill=main)
        d.rectangle((cx - 80, h * 0.76, cx - 30, h * 0.93), fill=sub)
        d.rectangle((cx + 30, h * 0.76, cx + 80, h * 0.93), fill=sub)
        d.rounded_rectangle((cx - 170, h * 0.45, cx - 120, h * 0.68), 25, fill=main)
        d.rounded_rectangle((cx + 120, h * 0.45, cx + 170, h * 0.68), 25, fill=main)
        d.ellipse((cx - 130, h * 0.12, cx + 130, h * 0.43), fill=(255, 224, 200))
        d.pieslice((cx - 145, h * 0.09, cx + 145, h * 0.38), 180, 360, fill=hair)
        d.ellipse((cx - 70, h * 0.27, cx - 40, h * 0.32), fill=(40, 30, 60))
        d.ellipse((cx + 40, h * 0.27, cx + 70, h * 0.32), fill=(40, 30, 60))
        for _ in range(6):  # 반짝이 장식
            x, y, r = rnd.randint(cx - 110, cx + 110), rnd.randint(int(h * 0.45), int(h * 0.75)), rnd.randint(6, 14)
            d.ellipse((x - r, y - r, x + r, y + r), fill=sub)
        if label:
            f = _font(44)
            tw = d.textlength(label, font=f)
            d.text((cx - tw / 2, h * 0.95 - 22), label, fill=(120, 120, 140), font=f)
    else:
        top, bottom = hue(), tuple(max(0, c - 120) for c in hue())
        img = Image.new("RGB", (w, h), top)
        d = ImageDraw.Draw(img)
        for y in range(h):
            t = y / max(1, h - 1)
            d.line([(0, y), (w, y)], fill=tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))
        for _ in range(40):
            x, y, r = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(2, 30)
            c = tuple(min(255, v + 80) for v in hue())
            d.ellipse((x - r, y - r, x + r, y + r), fill=c)
        if kind == "banner":
            # 큰 별 하나
            pts = []
            for k in range(10):
                rr = 110 if k % 2 == 0 else 45
                a = -math.pi / 2 + k * math.pi / 5
                pts.append((w * 0.72 + rr * math.cos(a), h * 0.4 + rr * math.sin(a)))
            d.polygon(pts, fill=(255, 230, 120))
        if label:
            f = _font(64)
            d.text((60, h - 140), label, fill=(255, 255, 255), font=f)
        d.text((24, 20), "MOCK", fill=(255, 255, 255), font=_font(28))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
