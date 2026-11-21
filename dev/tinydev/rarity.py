"""희귀도: 1–5 (별 개수). 예전 데이터의 'R'/'SR'/'SSR'은 3/4/5로 읽어요. (게임 js/config.js와 같은 규칙)"""

RARITIES = (1, 2, 3, 4, 5)
MAX_RARITY = 5
LEGACY = {"R": 3, "SR": 4, "SSR": 5}
# 새 캐릭터 id 앞부분 (예전 규칙과 맞춤: r_ / sr_ / ssr_)
ID_PREFIX = {1: "c1_", 2: "c2_", 3: "r_", 4: "sr_", 5: "ssr_"}


def normalize(value):
    """1–5 정수 또는 None. 문자열 '5', 예전 'SSR'도 받음"""
    if isinstance(value, str):
        if value in LEGACY:
            return LEGACY[value]
        if value.strip().isdigit():
            value = int(value.strip())
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and 1 <= value <= MAX_RARITY:
        return value
    return None


def label(value):
    """표시용: 5 → '5★'"""
    r = normalize(value)
    return f"{r}★" if r else str(value)
