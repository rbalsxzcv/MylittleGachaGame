"""KST(한국 표준시) 시간 유틸. 모든 시각은 '+09:00'이 붙은 ISO 문자열로 저장합니다."""
import re
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


def now():
    return datetime.now(KST)


def now_iso():
    return now().replace(microsecond=0).isoformat()


def parse(value):
    """ISO 문자열 → 시간대 포함 datetime. 잘못된 값이면 None"""
    if not isinstance(value, str) or not ISO_RE.match(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt(value):
    """화면 표시용: 2026.11.19 13:05"""
    d = parse(value) if isinstance(value, str) else value
    if not d:
        return "-"
    return d.astimezone(KST).strftime("%Y.%m.%d %H:%M")


def stamp():
    """파일/작업 이름용: 20261119-130501"""
    return now().strftime("%Y%m%d-%H%M%S")
