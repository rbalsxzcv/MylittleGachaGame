"""5★ 전용 추억 빈 칸 (memories.json, draft: true)

5★ 캐릭터가 생기면(그림 승인 · 챕터 팩 · 등급을 5★로) 그 캐릭터의 전용 추억 칸을 빈 칸으로 만들어 둠.
  - genKey = "signature:<캐릭터 id>" (생성기와 같음) → 키트(아키타입)를 정하고 '생성기로 다시 만들기'를 누르면 같은 id에 채워짐
  - draft: true = 아직 빈 칸 → 배포에서 보류(publish), 검사는 경고만(validate), 게임은 무시(js/core/data.js)
  - 추억 탭에서 일반 패시브를 채워 저장하면 draft가 풀림
"""
import threading

from . import rarity, store
from .timeutil import now_iso, parse

_lock = threading.Lock()


def is_draft(m):
    return isinstance(m, dict) and m.get("draft") is True


def slot_for(c, mid):
    """캐릭터 → 빈 전용 추억 항목 (공개 시각 = 캐릭터 공개 시각 → 캐릭터와 같이 보류/공개)"""
    added = c.get("addedAt") if parse(c.get("addedAt") or "") else None
    return {
        "id": mid,
        "genKey": f"signature:{c['id']}",
        "name": f"{c.get('name') or c['id']}의 기억"[:40],
        "rarity": 5,
        "kind": "signature",
        "signatureOf": c["id"],
        "featuredCharacterId": c["id"],
        "secondary": {"stat": "atk"},
        "passive": {},
        "theme": [],
        "image": "",
        "thumb": "",
        "addedAt": added or now_iso(),
        "draft": True,
    }


def needs_slot(c, mems):
    """5★ · NPC 아님 · 은퇴 아님 · 전용 추억(빈 칸 포함)이 없음"""
    if not isinstance(c, dict) or not c.get("id"):
        return False
    if rarity.grade_of(c) != 5 or c.get("retired"):
        return False
    return not any(isinstance(m, dict) and m.get("signatureOf") == c["id"] for m in mems)


def missing(chars=None, mems=None):
    """전용 추억이 없는 5★ 캐릭터 id 목록"""
    chars = store.read_list("characters") if chars is None else chars
    mems = store.read_list("memories") if mems is None else mems
    return [c["id"] for c in chars if needs_slot(c, mems)]


def ensure_signature_slots(cids=None):
    """빈 전용 칸 만들기 (cids가 없으면 전체). 만든 항목 목록 반환 — 여러 번 불러도 캐릭터당 한 장"""
    with _lock:
        chars = store.read_list("characters")
        mems = store.read_list("memories")
        wanted = set(cids) if cids is not None else None
        made = []
        for c in chars:
            if wanted is not None and c.get("id") not in wanted:
                continue
            if not needs_slot(c, mems):
                continue
            entry = slot_for(c, store.next_id("memory"))
            mems.append(entry)
            made.append(entry)
        if made:
            mems.sort(key=lambda m: str(m.get("id") or ""))
            store.write_list("memories", mems)
        return made
