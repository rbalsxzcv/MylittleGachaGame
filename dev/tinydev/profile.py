"""캐릭터 프로필 (CHARACTER_PROFILE.md): 정리 / 검사 / AI 초안.

profile = {facts, stories, lines, relations, voice, version}
- facts · stories · lines · relations: 플레이어용 (게임 js/systems/profile.js가 같은 규칙으로 읽음)
- voice: 작가용 말투 카드 (화면에 안 나옴, 배포 때 빠짐). 스토리 생성 · 검수 프롬프트에 들어감
- NPC는 voice만 / 주인공(단장)은 캐릭터 데이터가 없어서 dev/story_bible.json의 protagonist.voice
"""
import re

LIMITS = {
    "fact": 40,
    "factList": 5,
    "storyTitle": 30,
    "storyText": 600,
    "stories": 3,
    "line": 40,
    "idle": 5,
    "relations": 6,
    "relationLabel": 20,
    "relationNote": 60,
    "voiceText": 120,
    "voiceList": 5,
    "samplesMin": 3,
    "samplesMax": 5,
}

FACT_FIELDS = [("age", "나이", False), ("height", "키", False), ("origin", "출신", False), ("affiliation", "소속", False), ("likes", "좋아하는 것", True), ("dislikes", "싫어하는 것", True), ("hobby", "취미", False)]
LINE_FIELDS = [("obtain", "처음 만났을 때", False), ("team", "편성", False), ("levelUp", "레벨 업", False), ("breakthrough", "돌파", False), ("battleStart", "전투 시작", False), ("ultimate", "궁극기", False), ("idle", "대기", True)]
VOICE_TEXT = ("personality", "speech", "weakness", "desire")
VOICE_LISTS = ("habits", "never", "samples")
DEFAULT_UNLOCK = [1, 3, 6]
PARTS = ("all", "stories", "lines", "voice")
PROTAGONIST = "protagonist"
ID_RE = re.compile(r"^[a-z0-9_-]{1,64}$", re.I)


def _text(v, limit):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    return v.strip()[:limit] if isinstance(v, str) else ""


def _text_list(v, limit, count):
    if isinstance(v, str):  # 폼에서 줄바꿈으로 보낸 목록
        v = v.split("\n")
    if not isinstance(v, list):
        return []
    return [t for t in (_text(x, limit) for x in v) if t][:count]


def clean_voice(raw):
    """말투 카드 정리 (빈 칸은 뺌)"""
    if not isinstance(raw, dict):
        return {}
    L = LIMITS
    out = {}
    for k in VOICE_TEXT:
        t = _text(raw.get(k), L["voiceText"])
        if t:
            out[k] = t
    for k in VOICE_LISTS:
        items = _text_list(raw.get(k), L["voiceText"], L["samplesMax"] if k == "samples" else L["voiceList"])
        if items:
            out[k] = items
    addr = raw.get("address")
    if isinstance(addr, dict):
        a = {str(k): _text(v, L["voiceText"]) for k, v in addr.items() if isinstance(k, str) and ID_RE.match(k) and _text(v, L["voiceText"])}
        if a:
            out["address"] = dict(list(a.items())[:12])
    return out


def clean_profile(raw, npc=False):
    """개발 도구 저장용 정리 (voice 포함). npc면 voice만 남김"""
    if not isinstance(raw, dict):
        raw = {}
    L = LIMITS
    out = {}
    voice = clean_voice(raw.get("voice"))
    if not npc:
        facts = {}
        f_raw = raw.get("facts") if isinstance(raw.get("facts"), dict) else {}
        for key, _label, is_list in FACT_FIELDS:
            v = _text_list(f_raw.get(key), L["fact"], L["factList"]) if is_list else _text(f_raw.get(key), L["fact"])
            if v:
                facts[key] = v
        stories = []
        for i, s in enumerate((raw.get("stories") if isinstance(raw.get("stories"), list) else [])[: L["stories"]]):
            if not isinstance(s, dict) or not _text(s.get("text"), L["storyText"]):
                continue
            try:
                bt = int((s.get("unlock") or {}).get("breakthrough"))
            except (TypeError, ValueError, AttributeError):
                bt = 0
            if not 1 <= bt <= 6:
                bt = DEFAULT_UNLOCK[i] if i < len(DEFAULT_UNLOCK) else 6
            stories.append({"title": _text(s.get("title"), L["storyTitle"]) or f"이야기 {i + 1}", "text": _text(s.get("text"), L["storyText"]), "unlock": {"breakthrough": bt}})
        lines = {}
        l_raw = raw.get("lines") if isinstance(raw.get("lines"), dict) else {}
        for key, _label, is_list in LINE_FIELDS:
            v = _text_list(l_raw.get(key), L["line"], L["idle"]) if is_list else _text(l_raw.get(key), L["line"])
            if v:
                lines[key] = v
        relations, seen = [], set()
        for r in raw.get("relations") if isinstance(raw.get("relations"), list) else []:
            if len(relations) >= L["relations"]:
                break
            if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not ID_RE.match(r["id"]) or r["id"] in seen:
                continue
            seen.add(r["id"])
            relations.append({"id": r["id"], "label": _text(r.get("label"), L["relationLabel"]), "note": _text(r.get("note"), L["relationNote"])})
        for key, val in (("facts", facts), ("stories", stories), ("lines", lines), ("relations", relations)):
            if val:
                out[key] = val
    if voice:
        out["voice"] = voice
    out["version"] = 1
    return out


def has_voice(profile):
    return bool(isinstance(profile, dict) and (profile.get("voice") or {}).get("personality"))


# ── 검사 (게임 js/systems/profile.js profileIssues와 같은 규칙) ──────
def _check_text(out, where, v, limit):
    if v in (None, ""):
        return
    if not isinstance(v, str):
        out.append(f"{where}: 문자열이어야 해요")
    elif len(v) > limit:
        out.append(f"{where}: {len(v)}자 (최대 {limit}자)")


def _check_list(out, where, v, limit, count):
    if v is None:
        return
    if not isinstance(v, list):
        out.append(f"{where}: 목록이어야 해요")
        return
    if len(v) > count:
        out.append(f"{where}: {len(v)}개 (최대 {count}개)")
    for i, x in enumerate(v):
        _check_text(out, f"{where}[{i}]", x, limit)


def issues(raw, char_ids):
    """프로필의 오류 목록 (길이 · 형식 · relations id · address 키 · unlock 1~6 · samples 3~5)"""
    out = []
    if raw is None:
        return out
    if not isinstance(raw, dict):
        return ["profile: 객체여야 해요"]
    L = LIMITS
    facts = raw.get("facts")
    if facts is not None:
        if not isinstance(facts, dict):
            out.append("facts: 객체여야 해요")
        else:
            for key, _label, is_list in FACT_FIELDS:
                (_check_list(out, f"facts.{key}", facts.get(key), L["fact"], L["factList"]) if is_list else _check_text(out, f"facts.{key}", facts.get(key), L["fact"]))
    stories = raw.get("stories")
    if stories is not None:
        if not isinstance(stories, list):
            out.append("stories: 목록이어야 해요")
        else:
            if len(stories) > L["stories"]:
                out.append(f"stories: {len(stories)}편 (최대 {L['stories']}편)")
            for i, s in enumerate(stories):
                if not isinstance(s, dict):
                    out.append(f"stories[{i}]: 객체여야 해요")
                    continue
                _check_text(out, f"stories[{i}].title", s.get("title"), L["storyTitle"])
                _check_text(out, f"stories[{i}].text", s.get("text"), L["storyText"])
                if not _text(s.get("text"), L["storyText"]):
                    out.append(f"stories[{i}].text: 비어 있어요")
                if "unlock" in s:
                    n = (s.get("unlock") or {}).get("breakthrough") if isinstance(s.get("unlock"), dict) else None
                    if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 6):
                        out.append(f"stories[{i}].unlock.breakthrough: 1~6 정수여야 해요 ({n!r})")
    lines = raw.get("lines")
    if lines is not None:
        if not isinstance(lines, dict):
            out.append("lines: 객체여야 해요")
        else:
            for key, _label, is_list in LINE_FIELDS:
                (_check_list(out, f"lines.{key}", lines.get(key), L["line"], L["idle"]) if is_list else _check_text(out, f"lines.{key}", lines.get(key), L["line"]))
    rels = raw.get("relations")
    if rels is not None:
        if not isinstance(rels, list):
            out.append("relations: 목록이어야 해요")
        else:
            if len(rels) > L["relations"]:
                out.append(f"relations: {len(rels)}개 (최대 {L['relations']}개)")
            for i, r in enumerate(rels):
                if not isinstance(r, dict):
                    out.append(f"relations[{i}]: 객체여야 해요")
                    continue
                if r.get("id") not in char_ids:
                    out.append(f"relations[{i}].id: 없는 캐릭터 ({r.get('id')})")
                _check_text(out, f"relations[{i}].label", r.get("label"), L["relationLabel"])
                _check_text(out, f"relations[{i}].note", r.get("note"), L["relationNote"])
    if raw.get("voice") is not None:
        out += voice_issues(raw["voice"], char_ids)
    return out


def voice_issues(v, char_ids, where="voice"):
    out = []
    if not isinstance(v, dict):
        return [f"{where}: 객체여야 해요"]
    L = LIMITS
    for k in VOICE_TEXT:
        _check_text(out, f"{where}.{k}", v.get(k), L["voiceText"])
    for k in ("habits", "never"):
        _check_list(out, f"{where}.{k}", v.get(k), L["voiceText"], L["voiceList"])
    _check_list(out, f"{where}.samples", v.get("samples"), L["voiceText"], L["samplesMax"])
    if isinstance(v.get("samples"), list) and 0 < len(v["samples"]) < L["samplesMin"]:
        out.append(f"{where}.samples: {len(v['samples'])}개 ({L['samplesMin']}~{L['samplesMax']}개)")
    addr = v.get("address")
    if addr is not None:
        if not isinstance(addr, dict):
            out.append(f"{where}.address: 객체여야 해요")
        else:
            for k, val in addr.items():
                if k != PROTAGONIST and k not in char_ids:
                    out.append(f"{where}.address: 없는 캐릭터 ({k})")
                _check_text(out, f"{where}.address.{k}", val, L["voiceText"])
    return out


def voice_warnings(v):
    """경고: 약한 부분 / 절대 안 하는 말이 비어 있음"""
    v = v if isinstance(v, dict) else {}
    out = []
    if not _text(v.get("weakness"), LIMITS["voiceText"]):
        out.append("말투 카드의 약한 부분(weakness)이 비어 있어요")
    if not _text_list(v.get("never"), LIMITS["voiceText"], LIMITS["voiceList"]):
        out.append("말투 카드의 절대 안 하는 말(never)이 비어 있어요")
    return out


def strip_voice(char):
    """배포용: profile.voice 제거 (작가용 · 게임이 안 씀)"""
    p = char.get("profile") if isinstance(char, dict) else None
    if not isinstance(p, dict) or "voice" not in p:
        return char
    return {**char, "profile": {k: v for k, v in p.items() if k != "voice"}}
