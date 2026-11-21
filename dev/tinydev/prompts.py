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

from . import config, rarity

_RARITY_HINT = {
    1: "plain simple outfit, few details, relaxed natural pose",
    2: "simple and cute outfit, modest details, gentle natural pose",
    3: "neat outfit with a few details, natural confident pose",
    4: "detailed elegant outfit, a few accessories, light glow effects, confident pose",
    5: "very ornate legendary outfit, sparkling magical effects close to the body, dramatic dynamic pose",
}


class _HintMap(dict):
    """희귀도(1–5, 예전 'R'/'SR'/'SSR'도 됨) → 그림 프롬프트 힌트"""

    def get(self, key, default=""):
        return _RARITY_HINT.get(rarity.normalize(key), default)


RARITY_HINT = _HintMap()

# 에셋 종류(pkind)별 공통 스타일 파일
STYLE_FILE = {"char": "style.txt", "banner": "style_banner.txt", "bg": "style_bg.txt", "ui_bg": "style_bg.txt", "ui_icon": "style_icon.txt", "logo": "style_icon.txt", "enemy": "style.txt", "prop": "style_icon.txt"}

# 에셋 종류별로 항상 붙는 네거티브 (Anima 태그)
KIND_NEGATIVE = {
    "char": "cropped, feet out of frame, head out of frame, multiple views, reference sheet, scenery, detailed background, floor, cast shadow, frame, border",
    "banner": "letters, logo, title, speech bubble, extra people, cropped head, frame, border",
    "bg": "people, 1girl, 1boy, character, silhouette, ui, frame, border, letterboxing",
    "ui_bg": "people, 1girl, 1boy, character, ui, menu, button, frame, border, cluttered",
    "ui_icon": "multiple objects, scenery, detailed background, hand, person, cropped, frame, border, drop shadow",
    "logo": "scenery, detailed background, person, cropped, frame, border, photo",
    "enemy": "cropped, multiple views, reference sheet, scenery, detailed background, floor, cast shadow, frame, border, cute, chibi",
    "prop": "multiple objects, scenery, detailed background, hand, person, cropped, frame, border, drop shadow, text",
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
    "enemy": ("solo, full body", "One single enemy drawn only once, alone."),
    "prop": ("no humans, object focus, still life", "One single item only."),
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
        if kind in ("bg", "ui_bg", "ui_icon", "logo", "prop"):
            bad = low != "no humans" and bool(_HUMAN.search(t) or (kind != "logo" and _UI_WORDS.search(t)))
        elif kind == "char":
            if _COUNT.match(low):
                count = count or low
                continue
            bad = bool(_SHEET.search(t))
        elif kind == "enemy":
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
            f"Rarity: {rarity.label(inp.get('rarity', 3))} (1-5 stars) — {RARITY_HINT.get(inp.get('rarity'), '')}",
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
                lines.append(f"- {c['name']} ({rarity.label(c.get('rarity', ''))}, {c.get('title', '')}): {c.get('description', '')}")
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
    elif kind == "enemy":
        lines = [
            "Original enemy standee for a turn-based battle in a mobile game (shown on an enemy card).",
            f"Name: {inp.get('name', '')}",
            f"Role: {'boss — imposing, larger presence, more ornate' if inp.get('boss') else 'regular enemy'}",
            f"Appearance (Korean ok): {inp.get('keywords') or '(none given — invent a fitting look from the name)'}",
        ]
        if inp.get("memo"):
            lines.append(f"Notes about this enemy (use them to choose the pose and details): {inp['memo']}")
    elif kind == "prop":
        lines = [
            "Game item illustration asset (shop goods, rewards, story items), a single isolated object, centered.",
            f"Item: {inp.get('label') or inp.get('propId', '')}",
            f"Description (Korean ok): {inp.get('prompt') or '(none — draw what the item name suggests)'}",
            "Plain white background so it can be cut out. Shown at about 120-200px.",
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
    "enemy": """ASSET: enemy standee for battle cards. The background will be removed automatically.
- Exactly one enemy: 'solo'. It may be a human (bandit, soldier, cultist ...), a beast or a monster — choose the right count/subject tag ('1boy', '1girl', 'no humans, monster', 'wolf' ...).
- Full body, nothing cropped: 'full body'. A hostile, threatening battle stance ('fighting stance', 'holding weapon', 'snarling', 'glaring') that fits the role. Bosses look bigger, more armoured or ornate.
- Grounded low-fantasy look: worn leather, rusted iron, dirt, scars are fine; avoid cute or chibi styling.
- The background must be empty: 'simple background', 'white background'. No scenery, floor, frame or text. Keep effects few and close to the body.
- FORBIDDEN: the enemy appearing more than once, turnaround / reference sheet layout, several poses, inset close-ups, a second creature standing apart. Never write 'multiple views', 'reference sheet', 'concept art', 'turnaround', 'back view'.
- The sentence part must describe one enemy only.""",
    "prop": """ASSET: game item illustration (shop goods, rewards, story items). The background will be removed automatically; shown at about 120-200px.
- 'no humans', 'object focus', exactly one item (a bundle, chest or pouch counts as one item), 'centered', fills most of the frame, slight three-quarter view.
- Clean outline, rich but readable detail, soft cel shading with a glossy highlight; materials described concretely (leather, brass, parchment, wax seal ...).
- 'simple background', 'white background'; no scenery, no table, no hands, no ground shadow.
- FORBIDDEN: a person, a hand holding the item, a character face, a scene around the item, text or numbers.""",
}

# Gemini 없이 쓸 때의 종류별 기본 태그
KIND_TEMPLATE = {
    "char": "solo, full body, standing, dynamic pose, looking at viewer, smile, simple background, white background",
    "banner": "cowboy shot, dynamic pose, looking at viewer, festive, light particles, depth of field, wide shot",
    "bg": "no humans, scenery, wide shot, soft lighting",
    "ui_bg": "no humans, scenery, depth of field, soft lighting, low contrast",
    "ui_icon": "no humans, object focus, centered, thick outline, simple background, white background",
    "logo": "no humans, emblem, centered, symmetrical, ribbon, simple background, white background",
    "enemy": "solo, full body, fighting stance, glaring, simple background, white background",
    "prop": "no humans, object focus, still life, centered, simple background, white background",
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
    elif kind == "enemy":
        subject = ", ".join(x for x in (inp.get("keywords") or inp.get("name", ""), "boss, armor" if inp.get("boss") else "") if x)
    elif kind == "prop":
        subject = ", ".join(x for x in (inp.get("prompt"), inp.get("label")) if x)
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
    ex = "\n".join(f"- {e['name']} ({rarity.label(e['rarity'])}, {e.get('title', '')}): {e.get('description', '')}" for e in examples[:4])
    text = f"""당신은 모바일 수집 게임의 캐릭터 소개 문구를 쓰는 작가입니다.
아래 캐릭터의 도감 소개를 한국어로 2~3문장(150자 안팎) 써 주세요.
- 첫 문장: 정체/역할, 둘째 문장: 성격이나 귀여운 반전 포인트
- 줄바꿈은 문장 사이 한 번만, 따옴표나 머리말 없이 소개 문장만 출력

캐릭터
- 이름: {inp.get('name', '')}
- 희귀도: {rarity.label(inp.get('rarity', ''))}
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


# ── 스토리 장 생성 ────────────────────────────────────────
# 개요 한두 문단 → 대본. 세계관 + 앞 장 요약 + 직전 장 대본을 함께 읽고 이어 씀
STORY_LENGTH = {
    "auto": "개요의 사건 양에 맞게 스스로 판단 (보통 장면 3~6개, 장면마다 대사 5~10줄)",
    "short": "짧게: 장면 2~3개, 장면마다 대사 4~6줄",
    "normal": "보통: 장면 3~5개, 장면마다 대사 5~8줄",
    "long": "길게: 장면 5~8개, 장면마다 대사 6~12줄",
}

CHAPTER_SCHEMA = """{
  "title": "이 장의 제목",
  "summary": "목록에 보일 한 줄 소개 (40자 이내, 결말 스포일러 없이)",
  "recap": "이 장에서 실제로 일어난 일 요약 3~6문장 (다음 장을 쓸 때 참고용: 등장인물, 사건, 관계 변화, 남은 떡밥)",
  "scenes": [
    {
      "id": "s1",
      "background": {"type": "color", "value": "#1b1440"},
      "lines": [
        {"speaker": "narrator", "text": "지문"},
        {"speaker": "캐릭터id", "text": "대사"},
        {"speaker": "narrator", "name": "목록에 없는 인물 이름", "text": "그 인물의 대사"},
        {"speaker": "캐릭터id", "text": "선택지가 나오는 대사", "choices": [{"text": "선택1", "goto": "s2"}, {"text": "선택2", "goto": "s3"}]}
      ]
    }%s
  ]
}"""

BATTLE_SCENE_EXAMPLE = """,
    {"id": "b1", "type": "battle", "stageId": "스테이지id", "next": "s3"}"""


def script_text(body, names, stage_names=None, limit=8000):
    """스토리 본문 → 읽기 쉬운 대본 글 (AI 입력용)"""
    out = []
    for sc in (body or {}).get("scenes") or []:
        if not isinstance(sc, dict):
            continue
        if sc.get("type") == "battle":
            out.append(f"[전투: {(stage_names or {}).get(sc.get('stageId'), sc.get('stageId'))}]")
            continue
        out.append(f"# 장면 {sc.get('id')}")
        for ln in sc.get("lines") or []:
            if not isinstance(ln, dict):
                continue
            sp = ln.get("speaker", "narrator")
            who = ln.get("name") or ("지문" if sp == "narrator" else names.get(sp, sp))
            out.append(f"{who}: {ln.get('text', '')}")
            if ln.get("choices"):
                out.append("  (선택지: " + " / ".join(str(c.get("text", "")) for c in ln["choices"] if isinstance(c, dict)) + ")")
    text = "\n".join(out)
    return text if len(text) <= limit else text[: limit // 3] + "\n…(중략)…\n" + text[-(limit * 2 // 3):]


def chapter_draft(ctx):
    """ctx: meta, outline, world, style, prev (list of {chapter,title,recap}), prev_script, chars, length, stages, feedback, previous"""
    meta = ctx["meta"]
    roster = "\n".join(f"- id: {c['id']} / 이름: {c['name']} / 칭호: {c.get('title', '')} / 소개: {c.get('description', '')}" for c in ctx["chars"])
    prev = "\n".join(f"- {p['chapter']}장 「{p['title']}」: {p['recap'] or '(요약 없음)'}" for p in ctx["prev"])
    stages = ctx.get("stages") or []
    text = f"""당신은 모바일 수집형 RPG의 비주얼노벨형 스토리 작가입니다. 한국어로 이 장의 대본을 써 주세요.

[세계관]
{ctx['world'] or '(아직 없음: 개요와 등장인물만으로 자연스럽게)'}

[문체 / 톤]
{ctx['style'] or '따뜻하고 가벼운 판타지. 대사는 짧고 캐릭터마다 말투가 달라야 함'}

[지금까지의 줄거리] ({meta.get('kind', 'main')} {meta.get('chapter', 1)}장 이전)
{prev or '(이번이 첫 장)'}

[직전 장 대본] (말투, 마지막 상황, 호칭을 이어받기 위한 참고)
{ctx['prev_script'] or '(없음)'}

{_pack_block(ctx)}[이번 장] {meta.get('chapter', 1)}장 {('「' + meta['title'] + '」') if meta.get('title') else '(제목은 정해 주세요)'}
개요: {ctx['outline']}

[등장 캐릭터] speaker에는 아래 id 또는 "narrator"만 쓰기
{roster or '- (등록된 캐릭터 없음)'}
- 목록에 없는 인물이 필요하면 speaker는 "narrator", name에 그 인물 이름을 쓰기 (예: 마을 사람, 수수께끼의 목소리)

[규칙]
- 분량: {STORY_LENGTH.get(ctx['length'], STORY_LENGTH['auto'])}. 한 줄은 60자 이내.
- 개요의 사건을 빠짐없이, 앞 장들과 모순 없이. 세계관의 고유 명사와 설정을 지키기.
- 앞 장의 요약에 있는 떡밥은 개요와 관련 있을 때만 이어 받기. 개요에 없는 큰 사건(죽음, 정체 공개 등)을 마음대로 만들지 않기.
- 장면이 바뀌는 곳(장소/시간 변화)에서 장면을 나누기. 배경은 분위기에 맞는 어두운 계열 색(#hex).
- 선택지는 꼭 필요할 때만, 최대 2개. goto는 장면 id. 갈라진 장면은 "next"로 다시 합류하거나 "end"로 끝내기.
- 마지막 장면은 다음 장이 궁금해지게 끝내기.
"""
    bgs = ctx.get("backgrounds") or []
    if bgs:
        text += '- 배경: 장면마다 아래 배경 중 어울리는 것을 "background": {"type": "bg", "name": "이름"} 으로 (맞는 게 없을 때만 {"type": "color", "value": "#hex"}):\n' + "\n".join(f"  - {b['name']}: {b['label']}" for b in bgs) + "\n"
    req = ctx.get("required_stage")
    if req:
        text += f'- 전투: 이 장에는 전투 장면을 꼭 1개 넣기 → {{"id": "b1", "type": "battle", "stageId": "{req["id"]}"}} (스테이지: {req["name"]}). 전투 전에 상황을 대사로 보여 주고, 전투 뒤 장면으로 이어가기.\n'
    if stages and not req:
        text += "- 전투가 어울리는 곳에만 전투 장면을 넣을 수 있어요 (없어도 됨). stageId는 아래 중에서만:\n" + "\n".join(f"  - {s['id']}: {s['name']}" for s in stages) + "\n"
    schema = CHAPTER_SCHEMA % (BATTLE_SCENE_EXAMPLE if stages or req else "")
    if bgs:
        schema = schema.replace('"background": {"type": "color", "value": "#1b1440"}', '"background": {"type": "bg", "name": "배경 이름"}')
    text += f"\n오직 JSON만 출력. 형식:\n{schema}\n"
    if ctx.get("previous"):
        text += f"\n이전 초안:\n{json.dumps(ctx['previous'], ensure_ascii=False)[:8000]}\n"
    if ctx.get("feedback"):
        text += f"\n이전 초안에 대한 수정 요청 (반드시 반영, 나머지는 최대한 유지): {ctx['feedback']}\n"
    return text


def _pack_block(ctx):
    """챕터 팩으로 만드는 중이면 챕터 전체 구성을 보여 줌 (복선/흐름 맞추기)"""
    pack = ctx.get("pack")
    if not pack:
        return ""
    lines = [f"[이번 챕터] 챕터 {pack['arc']} 「{pack['title']}」: {pack.get('summary', '')}", f"챕터 전체 구성 ({len(pack['chapters'])}장, 지금은 {pack['position']}장을 써요):"]
    for c in pack["chapters"]:
        mark = "▶ " if c["n"] == pack["position"] else ""
        lines.append(f"- {mark}{c['n']}장 「{c['title']}」: {c['outline']}")
    return "\n".join(lines) + "\n\n"


def recap_prompt(world, title, script):
    return f"""아래는 모바일 게임 스토리의 한 장 대본입니다. 다음 장을 쓰는 작가가 참고할 수 있게 요약해 주세요.

[세계관 참고]
{world[:3000] or '(없음)'}

[장 제목] {title}

[대본]
{script}

규칙: 한국어 3~6문장. 등장인물, 실제로 일어난 사건, 관계/감정 변화, 해결되지 않은 떡밥을 포함. 대본에 없는 내용은 쓰지 않기. 요약 글만 출력."""


def mock_chapter(ctx):
    names = {c["id"]: c["name"] for c in ctx["chars"]}
    ids = list(names) or []
    a = ids[0] if ids else None
    count = {"short": 2, "normal": 3, "long": 5}.get(ctx["length"], 3)
    scenes = []
    for i in range(count):
        lines = [{"speaker": "narrator", "text": f"[모의 모드] {ctx['meta'].get('chapter', 1)}장 장면 {i + 1}. {ctx['outline'][:40]}"}]
        if a:
            lines.append({"speaker": a, "text": "여기가… 처음 와 보는 곳이야."})
        else:
            lines.append({"speaker": "narrator", "name": "여행자", "text": "여기가… 처음 와 보는 곳이야."})
        if ctx["prev"]:
            lines.append({"speaker": "narrator", "text": f"(앞 장 「{ctx['prev'][-1]['title']}」에서 이어짐)"})
        if ctx.get("feedback"):
            lines.append({"speaker": "narrator", "text": f"(수정 요청 반영: {ctx['feedback'][:40]})"})
        bgs = ctx.get("backgrounds") or []
        bg = {"type": "bg", "name": bgs[i % len(bgs)]["name"]} if bgs else {"type": "color", "value": ["#1b1440", "#2a2152", "#33264f", "#24304a"][i % 4]}
        scenes.append({"id": f"s{i + 1}", "background": bg, "lines": lines})
    if ctx.get("required_stage"):
        scenes.insert(len(scenes) - 1, {"id": "b1", "type": "battle", "stageId": ctx["required_stage"]["id"]})
    elif ctx.get("stages"):
        scenes.insert(len(scenes) - 1, {"id": "b1", "type": "battle", "stageId": ctx["stages"][0]["id"]})
    return json.dumps(
        {
            "title": ctx["meta"].get("title") or f"모의 {ctx['meta'].get('chapter', 1)}장",
            "summary": "[모의 모드] 새로운 모험이 시작된다",
            "recap": f"[모의 모드] {ctx['outline'][:80]}",
            "scenes": scenes,
        },
        ensure_ascii=False,
    )


def mock_recap(title, script):
    return f"[모의 모드] 「{title}」 요약: {script[:80].replace(chr(10), ' ')}…"


# ── 전투 스킬 세트 초안 (스킬 3개 + 돌파 5개) ──────────────
def _param_text(key, spec):
    kind = spec.get("kind")
    if kind in ("number", "int"):
        return f"{key}: {'정수' if kind == 'int' else '소수'} {spec.get('min')}~{spec.get('max')}"
    if kind == "enum":
        return f"{key}: {spec.get('of')}"
    if kind == "targeting":
        return f"{key}: 대상 지정 값"
    if kind == "effects":
        return f"{key}: 효과 목록"
    return key


def vocab_summary(vocab):
    """AI에게 줄 용어집 요약 (이 목록에 없는 값은 쓰면 안 됨)"""
    groups = vocab.get("statGroups", {})
    out = ["[대상 targeting]"]
    for k, t in vocab["targeting"].items():
        out.append(f"- {k}: {t['label']}" + (" (돌파 능력에서만)" if t.get("passiveOnly") else "") + (" + count(1~10)" if t.get("count") else ""))
    out.append("\n[효과 effects] 각 효과는 {\"type\": ..., 파라미터...}. 선택: \"target\"(이 효과만 다른 대상), \"chance\"(1~100 %)")
    for k, e in vocab["effects"].items():
        params = ", ".join(_param_text(pk, ps) for pk, ps in (e.get("params") or {}).items()) or "파라미터 없음"
        out.append(f"- {k} ({e['label']}): {params}")
    out.append(f"  능력치 묶음: scaleStats={groups.get('scaleStats')}, buffStats={groups.get('buffStats')}, bonusStats={groups.get('bonusStats')}")
    out.append("\n[발동 조건 trigger] (돌파 능력)")
    for k, t in vocab["triggers"].items():
        extra = ", ".join(_param_text(pk, ps) for pk, ps in (t.get("params") or {}).items())
        out.append(f"- {k}: {t['label']}" + (f" ({extra})" if extra else ""))
    out.append("\n[추가 조건 conditions] 모두 만족해야 발동")
    for k, c in vocab["conditions"].items():
        extra = ", ".join(_param_text(pk, ps) for pk, ps in (c.get("params") or {}).items())
        out.append(f"- {k}: {c['label']}" + (f" ({extra})" if extra else ""))
    out.append("\n[수정자 modifiers] 발동 조건 없이 항상 적용되는 능력")
    for k, m in vocab["modifiers"].items():
        extra = ", ".join(_param_text(pk, ps) for pk, ps in (m.get("params") or {}).items())
        out.append(f"- {k} ({m['label']}): {extra}")
    return "\n".join(out)


KIT_SCHEMA = """{
  "stats": {"atk": 100, "def": 40, "hp": 900, "spd": 100, "critRate": 0.05, "critDmg": 0.5},
  "kit": {
    "basic":    {"name": "...", "description": "...", "targeting": "enemy_single", "effects": [{"type": "damage", "mult": 1.0, "stat": "atk", "hits": 1}]},
    "skill":    {"name": "...", "description": "...", "targeting": "...", "effects": [...]},
    "ultimate": {"name": "...", "description": "...", "targeting": "...", "effects": [...]}
  },
  "breakthroughs": [
    {"name": "...", "description": "...", "trigger": "onCrit", "conditions": [], "targeting": "self", "effects": [{"type": "energy_gain", "n": 10}]},
    {"name": "...", "description": "...", "modifiers": [{"type": "ultimate_cost", "delta": -20}]}
  ]
}"""


def kit_draft(inp, vocab, examples, rarity_stats, errors=None):
    rs = rarity_stats.get(rarity.normalize(inp["rarity"])) or {}
    ex = "\n".join(json.dumps({k: c.get(k) for k in ("name", "rarity", "description", "stats", "kit", "breakthroughs")}, ensure_ascii=False) for c in examples)
    text = f"""당신은 턴제 수집형 RPG의 전투 기획자입니다. 아래 캐릭터의 전투 데이터(스킬 3개 + 돌파 능력 5개)를 JSON으로 설계해 주세요.

캐릭터
- 이름: {inp['name']} / 희귀도: {rarity.label(inp['rarity'])} (1~5★) / 칭호: {inp.get('title', '')}
- 설정: {inp.get('lore') or '(없음)'}

전투 규칙 요약
- 팀 5명 vs 적 웨이브. 속도(spd) 타임라인: 속도가 높을수록 자주 행동 (행동 간격 = 10000 ÷ 속도). advance_action/delay_action으로 순서를 당기고 밀 수 있음.
- 팀 공용 SP (시작 3, 최대 5): 기본 공격(basic) SP +1 · 기력 +20, 스킬(skill) SP −1 · 기력 +30. 스킬은 대기 시간(cooldown)이 없고 SP로 조절해요 → cooldown 필드를 쓰지 마세요.
- 궁극기(ultimate): 기력 100 소모, 아군 차례 중 언제든 쓸 수 있고 턴을 쓰지 않아요. 맞으면 기력 +10.
- 적은 다음 행동을 예고하고, 큰 공격(big)은 interrupt 효과로 끊을 수 있어요.
- 피해 = 능력치 × mult × 100/(100+방어) × 치명타. mult 1.0 = 공격력 100%.
- 이 희귀도의 기본 능력치: {json.dumps(rs, ensure_ascii=False)}, 치명타 확률 0.05, 치명타 피해 0.5. stats는 이 값의 ±25% 안에서 역할에 맞게 (spd는 ±15%: 지원/속공형은 빠르게, 방어형은 느리게).

설계 규칙
- 캐릭터 설정에 맞는 '전투 방식'(예: 지속 피해, 치유, 보호막, 치명타, 기력 순환, SP 순환, 행동 당기기/밀기, 큰 공격 차단)을 하나 정하고, 스킬과 돌파 능력 모두 그 방식을 살려 주세요.
- 돌파 능력 5개는 각자 다른 능력. 단순 능력치 상승(stat_bonus)은 최대 1개. 발동형(trigger)과 상시형(modifiers)을 섞어 주세요.
- 숫자 범위: 피해 mult 기본 0.8~1.2, 스킬 1.2~2.5(전체 대상이면 0.6~1.0), 궁극기 1.4~3.0(전체 대상이면 1.0~1.8). 치유 mult 0.5~1.5. 강화/약화 pct 10~40, turns 1~3.
- name/description은 한국어, 설정의 분위기에 맞게. description은 한 문장.
- 아래 용어집에 있는 값만 쓰세요. 없는 type/trigger/targeting을 만들면 안 됩니다.

{vocab_summary(vocab)}

기존 캐릭터 예시 (형식 참고):
{ex or '(없음)'}

오직 JSON만 출력. 형식:
{KIT_SCHEMA}
"""
    if inp.get("previous"):
        text += f"\n이전 초안:\n{json.dumps(inp['previous'], ensure_ascii=False)[:6000]}\n"
    if inp.get("feedback"):
        text += f"\n이전 초안에 대한 수정 요청 (반드시 반영): {inp['feedback']}\n"
    if errors:
        text += "\n이전 응답에 아래 오류가 있었어요. 모두 고쳐서 다시 출력하세요:\n" + "\n".join(f"- {e['where']}: {e['message']}" for e in errors[:20]) + "\n"
    return text


def mock_kit(inp):
    """모의 모드: 이름에 따라 정해지는 가짜 스킬 세트 (형식은 진짜와 같음)"""
    import hashlib

    h = int(hashlib.sha1((inp.get("name") or "").encode("utf-8")).hexdigest()[:6], 16)
    style = ["dot", "heal", "crit"][h % 3]
    name = inp.get("name") or "동료"
    tag = f" ({inp['feedback'][:12]})" if inp.get("feedback") else ""
    dmg = lambda m, **kw: {"type": "damage", "mult": m, "stat": "atk", "hits": 1, **kw}  # noqa: E731
    if style == "dot":
        skill = {"name": f"{name}의 독안개{tag}", "description": "적 전체에 지속 피해를 남겨요.", "targeting": "enemy_all", "effects": [dmg(0.6), {"type": "dot", "mult": 0.3, "turns": 2}]}
    elif style == "heal":
        skill = {"name": f"{name}의 손길{tag}", "description": "가장 지친 동료를 치유해요.", "targeting": "ally_lowest_hp", "effects": [{"type": "heal", "mult": 1.2, "stat": "atk"}]}
    else:
        skill = {"name": f"{name}의 일격{tag}", "description": "적 하나를 강하게 노려요.", "targeting": "enemy_single", "effects": [dmg(2.0)]}
    return json.dumps(
        {
            "stats": {"critRate": 0.12} if style == "crit" else {},
            "kit": {
                "basic": {"name": "가벼운 공격", "description": "[모의 모드] 기본 공격", "targeting": "enemy_single", "effects": [dmg(1.0)]},
                "skill": skill,
                "ultimate": {"name": f"{name}의 비기", "description": "[모의 모드] 적 전체 공격", "targeting": "enemy_all", "effects": [dmg(1.5)]},
            },
            "breakthroughs": [
                {"name": "집중", "description": "치명타 시 기력을 얻어요.", "trigger": "onCrit", "targeting": "self", "effects": [{"type": "energy_gain", "n": 10}]},
                {"name": "숙련", "description": "기본 공격 후 SP를 더 얻어요.", "trigger": "onBasic", "conditions": [{"type": "chance", "pct": 30}], "targeting": "self", "effects": [{"type": "sp_gain", "n": 1}]},
                {"name": "각성", "description": "궁극기 기력 소모가 줄어요.", "modifiers": [{"type": "ultimate_cost", "delta": -20}]},
                {"name": "버팀", "description": "HP가 30% 아래면 보호막.", "trigger": "onHpBelow", "pct": 30, "limit": 1, "targeting": "self", "effects": [{"type": "shield", "mult": 1.5, "stat": "def", "turns": 2}]},
                {"name": "단련", "description": "공격력이 올라요.", "modifiers": [{"type": "stat_bonus", "stat": "atk", "pct": 10}]},
            ],
        },
        ensure_ascii=False,
    )
