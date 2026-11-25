"""스토리 설정집 (dev/story_bible.json): 세계관, 문체 지침, 주인공 말투 카드, 장별 개요와 요약, 배경 목록, 챕터 팩 구성안.

AI가 장을 쓸 때 세계관 + 앞 장들의 요약 + 직전 장 대본을 읽고 이어 씁니다.
세계관에는 앞으로의 줄거리(스포일러)가 들어가기 쉬워서 git에 올리지 않습니다(.gitignore).
작업 공간 초기화(reset_workspace)에도 지워지지 않도록 작업 공간 밖에 둡니다.
"""
import threading

from . import config, store
from .timeutil import now_iso

# 읽고 고쳐서 쓰는 함수들은 이 잠금 안에서 (검수 · 챕터 팩 백그라운드 작업과 화면 요청이 동시에 쓸 수 있음)
_lock = threading.RLock()

PATH = config.DEV / "story_bible.json"
WORLD_LIMIT = 12000
STYLE_LIMIT = 20000  # 문체 지침 전체 (2~4장 + 퇴고 체크리스트)
OUTLINE_LIMIT = 4000
RECAP_LIMIT = 1500


def load():
    data = store.read_json(PATH, None)
    if not isinstance(data, dict):
        data = {}
    data.setdefault("world", "")
    data.setdefault("style", "")
    # 주인공(단장) 말투 카드 — 캐릭터 데이터가 없으므로 여기에 (형식은 characters profile.voice와 같음)
    if not isinstance(data.get("protagonist"), dict):
        data["protagonist"] = {}
    data["protagonist"].setdefault("name", "단장")
    if not isinstance(data["protagonist"].get("voice"), dict):
        data["protagonist"]["voice"] = {}
    for key in ("chapters", "backgrounds", "packs"):
        if not isinstance(data.get(key), dict):
            data[key] = {}
    return data


def save(data):
    store.write_json(PATH, data)


def set_world(world, style):
    with _lock:
        data = load()
        data["world"] = (world or "")[:WORLD_LIMIT]
        data["style"] = (style or "")[:STYLE_LIMIT]
        save(data)
        return data


def set_protagonist(voice, name=None):
    """주인공 말투 카드 저장 (voice는 profile.clean_voice로 정리된 것)"""
    with _lock:
        data = load()
        data["protagonist"]["voice"] = voice if isinstance(voice, dict) else {}
        if name:
            data["protagonist"]["name"] = str(name)[:20]
        save(data)
        return data["protagonist"]


def chapter(sid):
    return load()["chapters"].get(sid) or {}


def set_chapter(sid, outline=None, recap=None, model=None):
    """장 개요/요약 저장 (None은 그대로 둠). model = 이 장 초안을 쓴 글 모델 항목 (비교용 기록)"""
    with _lock:
        if not store.valid_id(sid):
            raise ValueError("잘못된 스토리 id")
        data = load()
        ch = data["chapters"].setdefault(sid, {})
        if outline is not None:
            ch["outline"] = str(outline)[:OUTLINE_LIMIT]
        if recap is not None:
            ch["recap"] = str(recap)[:RECAP_LIMIT]
            ch["recapAt"] = now_iso()
        if isinstance(model, dict):
            ch["model"] = {k: model.get(k) for k in ("id", "label", "model", "mock") if k in model}
            ch["modelAt"] = now_iso()
        save(data)
        return ch


def remove_chapter(sid):
    with _lock:
        data = load()
        if data["chapters"].pop(sid, None) is not None:
            save(data)


def set_background(name, label, prompt, arc=None):
    """스토리 배경 등록 (그림은 일괄 생성 탭의 '스토리 배경'으로 → assets/bg/<name>.jpg)"""
    with _lock:
        if not store.valid_id(name):
            raise ValueError("배경 이름이 올바르지 않아요")
        data = load()
        arc = arc or (data["backgrounds"].get(name) or {}).get("arc")  # 고칠 때 챕터 표시는 유지
        data["backgrounds"][name] = {"label": str(label or name)[:60], "prompt": str(prompt or "")[:1000], **({"arc": arc} if arc else {})}
        save(data)


def set_pack(arc, pack):
    with _lock:
        data = load()
        data["packs"][str(arc)] = pack
        save(data)


def update_chapter(sid, fn):
    """장 정보를 잠금 안에서 고치기: fn(장 dict) → 반환값 그대로 (검수 상태 등)"""
    with _lock:
        data = load()
        ch = data["chapters"].setdefault(sid, {})
        out = fn(ch)
        save(data)
        return out
