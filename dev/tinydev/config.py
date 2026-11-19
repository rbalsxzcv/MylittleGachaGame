"""설정: 경로와 환경 변수.

비밀 정보(키 파일 경로, 프로젝트 ID)는 코드에 넣지 않고 dev/.env 또는 환경 변수로만 받습니다.
dev/.env 는 .gitignore에 들어 있어 커밋되지 않습니다.
"""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv가 없어도 동작은 하게
    load_dotenv = None

ROOT = Path(__file__).resolve().parents[2]  # 저장소 루트
DEV = ROOT / "dev"
WEB = DEV / "web"
WORKSPACE = DEV / "workspace"  # 배포 전 작업 공간 (gitignore)
HISTORY = DEV / "history"  # 생성 시도 기록 (gitignore)
TRASH = DEV / "trash"  # 삭제한 파일 보관 (gitignore)
PUBLIC_DATA = ROOT / "data"
PUBLIC_ASSETS = ROOT / "assets"

if load_dotenv:
    load_dotenv(DEV / ".env")


def env(name, default=None):
    value = os.getenv(name)
    return value if value not in (None, "") else default


# Vertex AI (google-genai SDK). 모델 이름은 공식 문서 기준 기본값이며 .env로 바꿀 수 있습니다.
#   이미지: Nano Banana 2.1 (global 위치에서만 제공)
#   텍스트: Gemini 3.8 Flash
GCP_PROJECT = env("GOOGLE_CLOUD_PROJECT")
GCP_LOCATION = env("GOOGLE_CLOUD_LOCATION", "global")
IMAGE_MODEL = env("TG_IMAGE_MODEL", "gemini-nano-banana-2.1")
TEXT_MODEL = env("TG_TEXT_MODEL", "gemini-3.8-flash")

# TG_MOCK=1 이면 Vertex를 호출하지 않고 가짜 이미지/텍스트를 만듭니다 (키 없이 흐름 연습용)
FORCE_MOCK = env("TG_MOCK") == "1"

# 배경 제거 모델 (Hugging Face). RMBG-2.0은 라이선스 동의 + HF 로그인 필요
RMBG_MODEL = env("TG_RMBG_MODEL", "briaai/RMBG-2.0")

PORT = int(env("TG_DEV_PORT", "5050"))

# 캐릭터 이미지 규격
CHAR_LONG_SIDE = 512
BANNER_SIZE = (1280, 720)
BG_SIZE = (1280, 720)


def vertex_configured():
    """Vertex를 쓸 준비가 되었는지 (키 내용은 읽지 않고 존재만 확인)"""
    if FORCE_MOCK or not GCP_PROJECT:
        return False
    key = env("GOOGLE_APPLICATION_CREDENTIALS")
    # 키 파일 대신 gcloud 로그인(ADC)을 쓰는 경우도 있으므로, 경로가 지정된 경우에만 존재 확인
    return key is None or Path(key).is_file()


def read_style(name):
    """공통 스타일 프롬프트 (dev/style*.txt)"""
    path = DEV / name
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
