"""AI 프롬프트 만들기 + 모의 모드용 가짜 결과.

그림은 ComfyUI + Anima(애니메이션 확산 모델)로만 그립니다. 프롬프트는 두 단계로 만듭니다.
  1) brief(): 무엇을 그릴지 정리한 '요청서' (캐릭터 설정, 배너 내용, UI 칸 설명 …)
  2) Gemini가 요청서 + 에셋 종류별 Anima 규칙 + 거절 사유를 읽고 태그 + 짧은 문장으로 프롬프트 작성
     (Gemini를 쓸 수 없으면 template_prompt()의 종류별 기본 태그로 대신 만듦)
생성 직전 순서: 품질 태그(설정) → 핵심 프롬프트 → 공통 스타일(dev/style*.txt)
네거티브: AI가 쓴 것 → 에셋 종류별 기본(KIND_NEGATIVE) → 설정의 기본 네거티브
"""
import json
import re

from . import config

RARITY_HINT = {
    "R": "simple and cute outfit, modest details, gentle natural pose",
    "SR": "detailed elegant outfit, a few accessories, light glow effects, confident pose",
    "SSR": "very ornate legendary outfit, sparkling magical effects close to the body, dramatic dynamic pose",
}

# 에셋 종류(pkind)별 공통 스타일 파일
STYLE_FILE = {"char": "style.txt", "banner": "style_banner.txt", "bg": "style_bg.txt", "ui_bg": "style_bg.txt", "ui_icon": "style_icon.txt", "logo": "style_icon.txt"}

# 에셋 종류별로 항상 붙는 네거티브 (Anima 태그)
KIND_NEGATIVE = {
    "char": "cropped, feet out of frame, head out of frame, multiple views, reference sheet, scenery, detailed background, floor, cast shadow, frame, border",
    "banner": "letters, logo, title, speech bubble, extra people, cropped head, frame, border",
    "bg": "people, 1girl, 1boy, character, silhouette, ui, frame, border, letterboxing",
    "ui_bg": "people, 1girl, 1boy, character, ui, menu, button, frame, border, cluttered",
    "ui_icon": "multiple objects, scenery, detailed background, hand, person, cropped, frame, border, drop shadow",
    "logo": "scenery, detailed background, person, cropped, frame, border, photo",
}


def style_for(kind):
    return config.read_style(STYLE_FILE.get(kind, "style.txt"))


def merge_tags(*parts):
    """쉼표로 나눈 태그를 순서대로 합치고 중복 제거 (Anima는 같은 태그 반복에 약함)"""
    out, seen = [], set()
    for part in parts:
        for tag in (part or "").replace("\n", ", ").split(","):
            t = tag.strip()
            if t and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    return ", ".join(out)


# ── 용도별 필수 / 금지 태그 (CFG 1이면 네거티브가 무시되므로 포지티브 쪽에서 강제) ──
_HUMAN = re.compile(
    r"\b(\d+(girl|boy|other)s?|multiple (girls|boys|others)|girls?|boys?|wom[ae]n|m[ae]n|person|persons|people|crowd|characters?|"
    r"figures?|silhouettes?|humans?|solo|couple|child|children|kids?|visitors?|pedestrians?|villagers?|shopkeepers?|customers?|"
    r"students?|audience|guards?|hands?|faces?|portrait)\b",
    re.I,
)
_UI_WORDS = re.compile(r"\b(menus?|buttons?|ui|interface|hud|text|letters?|lettering|title|logo|words?|captions?)\b", re.I)
_SHEET = re.compile(
    r"multiple views|reference sheet|character sheet|model sheet|design sheet|concept art|turnaround|character design|"
    r"from behind|back view|rear view|from side|side view|profile|split screen|comparison|collage|variations?|"
    r"expression chart|inset|\b\d+(girls|boys|others)\b|multiple (girls|boys)|twins|clones?|duplicate",
    re.I,
)
_COUNT = re.compile(r"^1(girl|boy|other)$", re.I)

# 맨 앞에 항상 붙는 태그 + 맨 끝에 붙는 문장
REQUIRED = {
    "char": ("solo, full body, standing", "One single character drawn only once, alone, facing the viewer."),
    "banner": ("", ""),
    "bg": ("no humans, scenery", "An empty place with nobody in it."),
    "ui_bg": ("no humans, scenery", "An empty place with nobody in it."),
    "ui_icon": ("no humans, object focus, still life", "One single object only."),
    "logo": ("no humans, emblem", "One single emblem only."),
}


def enforce(kind, prompt):
    """에셋 용도에 맞게 프롬프트 정리 → (정리된 프롬프트, 뺀 태그 목록)
    - 배경/아이콘/로고: 사람을 부르는 태그·문장, UI·글자 관련 문장 제거 → 'no humans'를 맨 앞에
    - 캐릭터: 여러 시점·설정화(정면+후면) 태그 제거 → '1girl/1boy, solo, full body'를 맨 앞에
    - 배너: 설정화 태그와 글자 관련 태그만 제거
    """
    keep, removed, count = [], [], ""
    parts = (prompt or "").replace("\n", ", ").split(",")
    segs = [x for part in parts for x in re.split(r"(?<=[.!?])\s+", part)]  # 태그 / 문장 단위로
    for seg in segs:
        t = seg.strip()
        if not t:
            continue
        low = t.lower()
        bad = False
        if kind in ("bg", "ui_bg", "ui_icon", "logo"):
            bad = low != "no humans" and bool(_HUMAN.search(t) or (kind != "logo" and _UI_WORDS.search(t)))
        elif kind == "char":
            if _COUNT.match(low):
                count = count or low
                continue
            bad = bool(_SHEET.search(t))
        elif kind == "banner":
            bad = bool(_SHEET.search(t) and not re.search(r"\b\d+(girls|boys)\b", t, re.I)) or bool(re.search(r"\b(text|letters?|title|logo)\b", t, re.I))
        (removed if bad else keep).append(t)
    head, tail = REQUIRED[kind]
    if kind == "char":
        head = ", ".join(x for x in (count, head) if x)
    return merge_tags(head, ", ".join(keep), tail), removed


# ── 1) 그림 요청서 ─────────────────────────────────────────
def brief(kind, inp, chars=(), theme="", slot=None):
    """사람과 AI가 함께 읽는 '무엇을 그릴지' 설명 (kind: char/banner/bg/ui_bg/ui_icon/logo)"""
    if kind == "char":
        lines = [
            "Original full-body character standee for a casual mobile collection (gacha) game.",
            f"Name: {inp.get('name', '')}",
            f"Title / role: {inp.get('title', '')}",
            f"Rarity: {inp.get('rarity', 'R')} — {RARITY_HINT.get(inp.get('rarity'), '')}",
            f"Appearance keywords (Korean ok): {inp.get('keywords') or '(none given — invent a fitting original look from the title and description)'}",
        ]
        if inp.get("lore"):
            lines.append(f"Personality / lore (use it to choose the pose, prop and expression): {inp['lore']}")
    elif kind == "banner":
        lines = [
            "Wide key visual for a gacha banner in a casual mobile game.",
            f"Event title (do NOT render any text): {inp.get('title', '')}",
            f"Theme: {inp.get('description', '')}",
        ]
        if chars:
            lines.append(f"Featured characters ({len(chars)}), draw exactly these:")
            for c in chars:
                lines.append(f"- {c['name']} ({c.get('rarity', '')}, {c.get('title', '')}): {c.get('description', '')}")
                look = look_tags(c.get("look", ""))
                if look:
                    lines.append(f"  Appearance tags used for this character's standee art (keep hair/eyes/outfit the same): {look}")
        else:
            lines.append("No featured characters: make it a festive themed scene with no humans.")
    elif kind == "bg":
        lines = ["Background art for a visual novel scene (scenery only, no people).", f"Scene: {inp.get('prompt', '')}"]
    elif kind == "ui_bg":
        lines = [
            "Full-screen background art for a mobile game UI screen (scenery only, no people, no text).",
            f"Screen: {slot['label']} — {slot['subject']}",
            "UI elements will be drawn on top, so keep it soft and not too detailed.",
        ]
    elif kind == "logo":
        lines = [
            "Game title logo emblem asset, a single isolated emblem, centered.",
            f"Logo: {slot['label']} — {slot['subject']}",
            "Plain white background so it can be cut out.",
        ]
    else:  # ui_icon
        lines = [
            "Game UI icon asset, a single isolated object, centered, fills most of the frame.",
            f"Icon: {slot['label']} — {slot['subject']}",
            "Plain white background so it can be cut out. Readable at small sizes.",
        ]
    if theme and kind != "char":
        lines.append(f"Overall game art direction (Korean ok): {theme}")
    if inp.get("extra"):
        lines.append(f"Additional direction from the developer: {inp['extra']}")
    return "\n".join(lines)


# ── 2) Anima 프롬프트 규칙 ─────────────────────────────────
ANIMA_RULES = """Target model: Anima — an anime-style diffusion model (Qwen3 text encoder) running in ComfyUI.
Anima understands Danbooru-style tags AND short natural-language English sentences, and works best with a mix of both.

Write 'prompt' in this shape:
  1. Tags first, in this order: subject count tag (1girl / 1boy / 2girls / no humans ...), the main subject, then details (hair, eyes, outfit, props), pose and expression, then composition / camera / lighting / background tags.
  2. Then 1-2 short English sentences that describe the whole picture (composition, mood, what the subject is doing).
Tag rules:
  - lowercase English, spaces instead of underscores ('long hair', not 'long_hair'), comma-separated, 20-40 tags.
  - no duplicate or near-duplicate tags (Anima gets worse when tags repeat), no weights like (tag:1.2).
  - no artist names, no '@' tags, no real brands, no existing copyrighted characters or series.
  - do NOT write quality / rating tags (masterpiece, best quality, score_*, safe) — they are prepended automatically.
  - do not write negative phrases like 'no text' in the prompt; put unwanted things in 'negative' instead (except the count tag 'no humans', which is a normal tag).
Write 'negative' as a few comma-separated tags this specific image must avoid (a base negative list is added automatically)."""

KIND_RULES = {
    "char": """ASSET: gacha character standee. The background will be removed automatically, then the character is shown on cards and the home screen.
- Exactly one character: 'solo' + the right count tag (1girl or 1boy — decide from the name, title and description; if unclear use 1girl).
- Full body from the top of the head to the shoes, nothing cropped: 'full body', 'standing' (or another full-body pose), and mention the shoes.
- A clear, characterful POSE that fits the personality and role — never a stiff neutral stand. Use concrete pose tags such as 'hand on own hip', 'waving', 'arm up', 'holding staff', 'v', 'leaning forward', 'one eye closed', 'outstretched hand', plus 'looking at viewer' and one specific expression ('smile', 'open mouth', 'smug', 'shy' ...). One signature prop that fits the role is good.
- The background must be empty: 'simple background', 'white background'. No scenery, floor, furniture, frame or text. Keep effects (sparkles, magic) few and close to the body so the cut-out stays clean.
- Describe hair colour + style, eye colour, outfit pieces and colours, accessories concretely so the character stays recognisable. Rarity sets the detail level and pose energy.
- FORBIDDEN (the asset is unusable if it happens): the character appearing more than once, front-and-back or turnaround views, a reference / character / model sheet layout, concept-art presentation with several poses, inset close-ups, a back view, a second person or a pet-sized companion standing apart. Never write tags such as 'multiple views', 'reference sheet', 'concept art', 'character design', 'turnaround', 'from behind', 'back view', 'side view', '2girls'.
- Describe ONE moment of ONE character in ONE pose, like a single illustration — not a costume design breakdown. Keep the outfit to the 6-10 most important tags.
- The sentence part must also talk about one character only, e.g. 'A single cheerful girl waves at the viewer...'.""",
    "banner": """ASSET: 16:9 gacha banner key visual. The game draws the title text itself — never draw text.
- Draw only the featured characters; the count tag must match (e.g. '2girls', '1girl 1boy'). Copy each character's hair, eyes and outfit tags from the appearance tags given so they match their standee art.
- Dynamic, festive composition: characters on the right half, 'cowboy shot' or 'upper body', dynamic pose, looking at viewer; the lower-left area calm and less detailed for the title.
- A themed background that fits the event (not plain), light particles, depth of field.
- If there are no featured characters, use 'no humans' and make an inviting themed scene.""",
    "bg": """ASSET: visual-novel scene background, 16:9. Character standees and a dialogue box are drawn on top later.
- 'no humans', 'scenery', a specific place, time of day, weather and lighting tags, eye-level 'wide shot'.
- Keep the centre and the bottom third simple (characters stand in the centre, the dialogue box covers the bottom); put interesting detail at the sides and top.
- Slightly soft and painterly, not over-saturated.
- FORBIDDEN: any person, character, silhouette, crowd, shadow of a person, statue of a person, animals in the foreground. Do not describe a place through the people in it (no 'shopkeeper', 'visitors', 'students'); describe objects, architecture, nature and light only.
- The sentence part must describe only the place. Never mention characters, people, the dialogue box, UI or text in it.""",
    "ui_bg": """ASSET: full-screen game UI background, 16:9. Menus, buttons and characters are drawn on top.
- 'no humans', 'scenery', the place described; follow the layout notes in the request exactly (which side must stay calm or empty).
- Low contrast, soft focus or 'depth of field', gentle lighting, few small details — it must not compete with the UI.
- FORBIDDEN: any person, character, silhouette, crowd, statue of a person, UI panels, buttons, frames, text. Describe 'calm/empty areas' with scenery words (e.g. 'open sky on the right', 'plain wall on the left'), NOT with words like 'space for menus' or 'room for characters'.
- The sentence part must describe only the place. Never mention characters, people, menus, buttons, UI or text in it.""",
    "ui_icon": """ASSET: game UI icon. The background will be removed automatically and the icon is shown at 64-128px.
- 'no humans', 'object focus', exactly one object, 'centered', it fills most of the frame, front view or slight three-quarter view.
- Bold simple silhouette, thick clean outline, cel shading with one glossy highlight; few details so it reads at small size.
- 'simple background', 'white background'; no scenery, no hands, no ground shadow.
- FORBIDDEN: a person, a hand holding the object, a character or mascot face, several objects, a scene around the object, text.""",
    "logo": """ASSET: the game title logo emblem. The background will be removed automatically; shown about 600px wide.
- 'no humans', emblem / badge design, 'centered', symmetrical, 'simple background', 'white background'.
- Anima is weak at drawing words: make a decorative emblem with an empty ribbon banner. Only if the request clearly asks for words, add them in the sentence part as: the ribbon reads "Tiny Gacha".""",
}

# Gemini 없이 쓸 때의 종류별 기본 태그
KIND_TEMPLATE = {
    "char": "solo, full body, standing, dynamic pose, looking at viewer, smile, simple background, white background",
    "banner": "cowboy shot, dynamic pose, looking at viewer, festive, light particles, depth of field, wide shot",
    "bg": "no humans, scenery, wide shot, soft lighting",
    "ui_bg": "no humans, scenery, depth of field, soft lighting, low contrast",
    "ui_icon": "no humans, object focus, centered, thick outline, simple background, white background",
    "logo": "no humans, emblem, centered, symmetrical, ribbon, simple background, white background",
}


def _feedback_block(reasons):
    if not reasons:
        return ""
    return "Fix these problems: " + "; ".join(reasons) + "."


_NOT_LOOK = set(merge_tags(KIND_TEMPLATE["char"], KIND_TEMPLATE["banner"], "masterpiece, best quality, safe").split(", "))


def look_tags(look):
    """캐릭터 그림 프롬프트에서 구도/배경 태그를 빼고 외형만 남기기 (배너 기본 태그용)"""
    return ", ".join(t for t in merge_tags(look).split(", ") if t and t.lower() not in _NOT_LOOK and "background" not in t.lower())


def template_prompt(kind, inp, slot, chars, reasons):
    """AI 없이 만드는 프롬프트 (모의 모드 / AI 작성 꺼짐) → (prompt, negative)"""
    if kind == "char":
        subject = ", ".join(x for x in (inp.get("keywords"), inp.get("title"), RARITY_HINT.get(inp.get("rarity"), "")) if x)
    elif kind == "banner":
        count = f"{len(chars)}girls" if len(chars) > 1 else ("1girl" if chars else "no humans")
        subject = ", ".join([count] + [look_tags(c.get("look", "")) or c["name"] for c in chars] + [inp.get("description", "")])
    elif kind == "bg":
        subject = inp.get("prompt", "")
    else:
        subject = slot["subject"] if slot else ""
    prompt = merge_tags(KIND_TEMPLATE[kind], subject, inp.get("extra", ""))
    fix = _feedback_block(reasons)
    return (f"{prompt}. {fix}" if fix else prompt), ""


def writer_prompt(kind, brief_text, style, reasons, previous=None):
    text = f"""You are a prompt engineer for an image generation model used to make original assets for a small non-commercial game.

{ANIMA_RULES}

{KIND_RULES[kind]}

These tags are added automatically after your prompt, so do not repeat them and do not contradict them:
STYLE: {style or '(none)'}

REQUEST:
{brief_text}
"""
    if previous:
        text += f"\nPREVIOUS PROMPT (rejected by the developer):\n{previous}\n"
    if reasons:
        text += "\nTHE DEVELOPER REJECTED EARLIER RESULTS FOR THESE REASONS — the new prompt MUST fix all of them (reasons may be in Korean):\n"
        text += "\n".join(f"- {r}" for r in reasons) + "\n"
    text += '\nTranslate any Korean details into English tags. Return ONLY JSON: {"prompt": "...", "negative": "..."}'
    return text


# ── 캐릭터 소개 ───────────────────────────────────────────
def describe(inp, examples):
    ex = "\n".join(f"- {e['name']} ({e['rarity']}, {e.get('title', '')}): {e.get('description', '')}" for e in examples[:4])
    text = f"""당신은 모바일 수집 게임의 캐릭터 소개 문구를 쓰는 작가입니다.
아래 캐릭터의 도감 소개를 한국어로 2~3문장(150자 안팎) 써 주세요.
- 첫 문장: 정체/역할, 둘째 문장: 성격이나 귀여운 반전 포인트
- 줄바꿈은 문장 사이 한 번만, 따옴표나 머리말 없이 소개 문장만 출력

캐릭터
- 이름: {inp.get('name', '')}
- 희귀도: {inp.get('rarity', '')}
- 칭호: {inp.get('title', '')}
- 외형 키워드: {inp.get('keywords', '')}
- 설정 메모: {inp.get('lore', '')}
"""
    if ex:
        text += f"\n기존 캐릭터 소개 (말투를 맞춰 주세요)\n{ex}\n"
    if inp.get("current"):
        text += f"\n현재 소개 문구:\n{inp['current']}\n"
    if inp.get("feedback"):
        text += f"\n수정 요청 (반드시 반영): {inp['feedback']}\n"
    return text


def mock_describe(inp):
    name = inp.get("name") or "이름 없는 동료"
    title = inp.get("title") or "떠돌이"
    extra = f" ({inp['feedback']} 반영)" if inp.get("feedback") else ""
    return f"「{title}」라 불리는 {name}.\n겉보기와 달리 의외로 수줍음이 많다.{extra} [모의 모드]"


# ── 스토리 초안 ───────────────────────────────────────────
STORY_SCHEMA = """{
  "title": "스토리 제목",
  "scenes": [
    {
      "id": "s1",
      "background": {"type": "color", "value": "#1b1440"},
      "next": null,
      "lines": [
        {"speaker": "narrator", "text": "지문"},
        {"speaker": "캐릭터id", "text": "대사"},
        {"speaker": "캐릭터id", "text": "선택지가 나오는 대사", "choices": [{"text": "선택1", "goto": "s2"}, {"text": "선택2", "goto": "s3"}]}
      ]
    }
  ]
}"""


def story_draft(meta, outline, chars, scene_count, feedback=None, previous=None):
    roster = "\n".join(f"- id: {c['id']} / 이름: {c['name']} / 칭호: {c.get('title', '')} / 소개: {c.get('description', '')}" for c in chars)
    text = f"""당신은 모바일 게임의 비주얼노벨형 스토리 작가입니다. 한국어로 스토리를 써 주세요.

스토리 정보
- 종류: {meta.get('kind', 'main')} / 제목(가제): {meta.get('title', '')}
- 줄거리 개요: {outline}

등장 캐릭터 (speaker에는 반드시 아래 id 또는 "narrator"만 사용)
{roster or '- (없음: narrator만 사용)'}

규칙
- 장면 {scene_count}개 안팎, 장면마다 대사 4~8줄, 한 줄은 60자 이내
- 캐릭터 소개에 맞는 말투와 성격 유지
- 선택지는 필요할 때만, 최대 2개. 선택지의 goto는 장면 id. 갈라진 장면은 "next"로 다시 합류시키거나 "end"로 끝냄
- 배경은 장면 분위기에 맞는 어두운 계열 색(#hex)
- 오직 JSON만 출력. 형식:
{STORY_SCHEMA}
"""
    if previous:
        text += f"\n이전 초안:\n{json.dumps(previous, ensure_ascii=False)[:6000]}\n"
    if feedback:
        text += f"\n이전 초안에 대한 수정 요청 (반드시 반영): {feedback}\n"
    return text


def mock_story(meta, outline, chars, scene_count, feedback=None):
    ids = [c["id"] for c in chars] or ["narrator"]
    a = ids[0]
    b = ids[1] if len(ids) > 1 else a
    name = {c["id"]: c["name"] for c in chars}
    scenes = []
    for i in range(max(1, min(scene_count, 4))):
        sid = f"s{i + 1}"
        lines = [
            {"speaker": "narrator", "text": f"[모의 모드] 장면 {i + 1}. {outline[:40]}"},
            {"speaker": a, "text": f"{name.get(b, '그쪽')}, 오늘은 무슨 일이야?"},
            {"speaker": b, "text": "글쎄, 뭔가 재미있는 일이 생길 것 같은 예감이 들어."},
        ]
        if feedback:
            lines.append({"speaker": "narrator", "text": f"(수정 요청 반영: {feedback[:40]})"})
        scenes.append({"id": sid, "background": {"type": "color", "value": ["#1b1440", "#2a2152", "#33264f", "#24304a"][i % 4]}, "next": None, "lines": lines})
    return json.dumps({"title": meta.get("title") or "모의 스토리", "scenes": scenes}, ensure_ascii=False)
