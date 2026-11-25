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


# ── AI 초안 ───────────────────────────────────────────────
EXCERPT_LIMIT = 3000


def _story_order():
    """스토리 목록을 읽는 순서 (메인 → 캐릭터 → 이벤트, 장 순서)"""
    from . import store

    order = {"main": 0, "character": 1, "event": 2}
    items = [s for s in store.read_list("storyIndex") if isinstance(s, dict) and s.get("id")]
    return sorted(items, key=lambda s: (order.get(s.get("kind"), 9), str(s.get("characterId") or ""), int(s.get("chapter") or 0)))


def excerpt_for(name, cid=None, limit=EXCERPT_LIMIT):
    """이 캐릭터가 말한 줄(+ 바로 앞 줄)을 스토리 순서대로 모은 발췌. cid가 없으면 이름(narrator name)으로만 찾음 (주인공)"""
    from . import store

    names = {c["id"]: c.get("name", c["id"]) for c in store.read_list("characters")}
    out, total = [], 0
    for s in _story_order():
        try:
            body = store.read_story(s["id"]) or {}
        except (store.JsonError, ValueError):
            continue
        chunk = []
        for sc in body.get("scenes") or []:
            prev = None
            for ln in (sc or {}).get("lines") or []:
                if not isinstance(ln, dict):
                    continue
                sp = ln.get("speaker", "narrator")
                who = ln.get("name") or ("지문" if sp == "narrator" else names.get(sp, sp))
                mine = (cid and sp == cid) or (sp == "narrator" and ln.get("name") == name)
                if mine:
                    if prev and prev not in chunk:
                        chunk.append(prev)
                    chunk.append(f"{who}: {ln.get('text', '')}")
                prev = f"{who}: {ln.get('text', '')}"
        if chunk:
            block = f"[{s.get('title') or s['id']}]\n" + "\n".join(chunk[:14])
            if total + len(block) > limit:
                out.append(block[: max(0, limit - total)])
                break
            out.append(block)
            total += len(block) + 1
    return "\n".join(out)


def others_voices(exclude_id=None, extra=None):
    """다른 캐릭터들의 말투 카드 [{id, name, voice}] (extra: 일괄 생성 중 아직 승인 안 한 카드 {id: voice} — 덮어씀)"""
    from . import store

    out = []
    extra = extra or {}
    for c in store.read_list("characters"):
        if c.get("id") == exclude_id:
            continue
        voice = extra.get(c["id"]) or ((c.get("profile") or {}).get("voice") if isinstance(c.get("profile"), dict) else None)
        if isinstance(voice, dict) and voice.get("personality"):
            out.append({"id": c["id"], "name": c.get("name", c["id"]), "voice": voice})
    return out


def target_info(tid):
    """초안 대상: 캐릭터 id 또는 'protagonist' → (target dict, 현재 프로필)"""
    from . import bible, rarity, store

    if tid == PROTAGONIST:
        p = bible.load()["protagonist"]
        world = bible.load()["world"]
        return {"id": PROTAGONIST, "name": p.get("name") or "단장", "kind": "protagonist", "description": "플레이어. 용병단장 (세계관의 주인공 설명 참고)", "lore": world[:600]}, {"voice": p.get("voice") or {}}
    c = next((x for x in store.read_list("characters") if x.get("id") == tid), None)
    if not c:
        raise FileNotFoundError("캐릭터가 없어요")
    npc = rarity.is_npc(c)
    target = {k: c.get(k, "") for k in ("id", "name", "rarity", "title", "role", "description", "keywords", "lore")}
    target["kind"] = "npc" if npc else "char"
    return target, (c.get("profile") if isinstance(c.get("profile"), dict) else {})


def draft(tid, part="all", feedback="", current=None, model=None, extra_voices=None):
    """프로필 초안 (저장하지 않음) → (profile, 쓴 모델, 경고 목록)
    part: all | stories | lines | voice — all이 아니면 그 부분만 새로 만들어 현재 프로필에 합침. NPC · 주인공은 voice만"""
    from . import bible, genai, prompts, store

    if part not in PARTS:
        raise ValueError("part는 all / stories / lines / voice")
    target, saved = target_info(tid)
    kind = target["kind"]
    if kind != "char":
        part = "voice" if part in ("all", "voice") else part
        if part != "voice":
            raise ValueError("NPC와 주인공은 말투 카드만 만들어요")
    base = current if isinstance(current, dict) else saved
    b = bible.load()
    chars = store.read_list("characters")
    roster = [{"id": c["id"], "name": c.get("name", c["id"]), "title": c.get("title", "")} for c in chars if c.get("id") != tid]
    prot = dict(b["protagonist"])
    if (extra_voices or {}).get(PROTAGONIST):  # 일괄 생성 중 아직 승인 안 한 주인공 카드
        prot["voice"] = extra_voices[PROTAGONIST]
    ctx = {
        "target": target,
        "world": b["world"],
        "style": b["style"],
        "others": others_voices(tid, extra_voices),
        "protagonist": prot if tid != PROTAGONIST else {},
        "roster": roster,
        "excerpt": excerpt_for(target["name"], None if tid == PROTAGONIST else tid),
        "part": part,
        "current": base or None,
        "feedback": feedback or "",
    }
    raw, used = genai.generate_text_ex(prompts.profile_draft(ctx), json_mode=True, mock=lambda: prompts.mock_profile(ctx), task="profile", model=model, record=tid)
    data = genai.parse_json_text(raw)
    if not isinstance(data, dict):
        raise genai.GenError("AI 응답이 프로필 형식이 아니에요")
    if kind != "char" or part == "voice":
        new = {**(base or {}), "voice": data.get("voice") if isinstance(data.get("voice"), dict) else data}
    elif part == "all":
        new = data
    else:
        new = {**(base or {}), part: data.get(part)}
    profile = clean_profile(new, npc=kind == "npc")
    if kind == "protagonist":
        profile = {"voice": profile.get("voice", {})}
    ids = {c["id"] for c in chars}
    warnings = issues(profile, ids) + voice_warnings(profile.get("voice"))
    return profile, used, warnings


def save_profile(cid, raw):
    """캐릭터 프로필 저장 (정리 → 오류가 있으면 ValueError). 반환: 저장된 프로필"""
    from . import rarity, store

    chars = store.read_list("characters")
    c = next((x for x in chars if x.get("id") == cid), None)
    if not c:
        raise FileNotFoundError("캐릭터가 없어요")
    p = clean_profile(raw, npc=rarity.is_npc(c))
    errs = issues(p, {x["id"] for x in chars})
    if errs:
        raise ValueError("프로필을 저장할 수 없어요: " + " / ".join(errs[:5]))
    if len(p) == 1:  # version만 = 빈 프로필 → 지움
        c.pop("profile", None)
    else:
        c["profile"] = p
    store.write_list("characters", chars)
    return c.get("profile")


def save_protagonist(raw_voice, name=None):
    from . import bible, store

    voice = clean_voice(raw_voice)
    errs = voice_issues(voice, {c["id"] for c in store.read_list("characters")})
    if errs:
        raise ValueError("말투 카드를 저장할 수 없어요: " + " / ".join(errs[:5]))
    return bible.set_protagonist(voice, name)


# ── 스토리 생성에 넣을 말투 카드 고르기 (CHARACTER_PROFILE.md 5장) ──
def _name_keys(name):
    """개요에서 찾을 이름: 전체 이름 + 두 글자 이상인 첫 단어 ('루미 아이올락' → '루미')"""
    name = str(name or "").strip()
    keys = {name} if name else set()
    first = name.split(" ")[0] if " " in name else ""
    if len(first) >= 2:
        keys.add(first)
    return keys


def featured_ids(chars, outline="", prev_body=None, picked=()):
    """이번 장에 나오는 캐릭터 id (말투 카드 전체를 넣을 대상)
    = 직접 고른 캐릭터(챕터 팩 구성 포함) + 개요에 이름이 나온 캐릭터 + 직전 장에서 말한 캐릭터. 순서는 chars 순서"""
    want = set(picked or ())
    text = str(outline or "")
    by_name = {}
    for c in chars:
        for k in _name_keys(c.get("name")):
            by_name.setdefault(k, c["id"])
            if k and k in text:
                want.add(c["id"])
    for sc in (prev_body or {}).get("scenes") or []:
        for ln in (sc or {}).get("lines") or []:
            if not isinstance(ln, dict):
                continue
            sp = ln.get("speaker")
            if sp and sp != "narrator":
                want.add(sp)
            elif ln.get("name") in by_name:
                want.add(by_name[ln["name"]])
    return [c["id"] for c in chars if c["id"] in want]
