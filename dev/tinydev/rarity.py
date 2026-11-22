"""등급: 희귀도 1–5 (별 개수) + NPC. 예전 데이터의 'R'/'SR'/'SSR'은 3/4/5, pullable: false는 NPC로 읽어요.
(게임 js/config.js normalizeRarity / normalizeGrade / isNpc와 같은 규칙)

NPC 등급: 뽑기/도감/육성/편성에 나오지 않고 스토리 화자나 전투의 적(enemies.json charId)으로만 나와요.
"""

RARITIES = (1, 2, 3, 4, 5)
MAX_RARITY = 5
LEGACY = {"R": 3, "SR": 4, "SSR": 5}
NPC = "npc"


def normalize(value):
    """1–5 정수 또는 None. 문자열 '5', 예전 'SSR'도 받음 (NPC는 None — 등급 전체는 normalize_grade)"""
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


def normalize_grade(value):
    """캐릭터 등급: 1–5 정수 또는 'npc'. 알 수 없으면 None"""
    if isinstance(value, str) and value.strip().lower() == NPC:
        return NPC
    return normalize(value)


def grade_of(c):
    """캐릭터 항목의 등급 (예전 pullable: false = NPC)"""
    if (c or {}).get("pullable") is False:
        return NPC
    return normalize_grade((c or {}).get("rarity"))


def is_npc(c):
    return grade_of(c) == NPC


def gachable(c):
    """뽑기에 나오는지 (NPC 아님 + 은퇴 아님)"""
    return not is_npc(c) and not (c or {}).get("retired")


def label(value):
    """표시용: 5 → '5★', 'npc' → 'NPC'"""
    if isinstance(value, str) and value.strip().lower() == NPC:
        return "NPC"
    r = normalize(value)
    return f"{r}★" if r else str(value)
