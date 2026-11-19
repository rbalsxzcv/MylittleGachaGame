"""AI 프롬프트 만들기 + 모의 모드용 가짜 결과."""
import json

from . import config

RARITY_HINT = {
    "R": "simple and cute outfit, modest details",
    "SR": "detailed elegant outfit, a few accessories, light glow effects",
    "SSR": "very ornate legendary outfit, sparkling magical effects, dramatic pose",
}


def _feedback_block(reasons):
    if not reasons:
        return ""
    lines = "\n".join(f"- {r}" for r in reasons)
    return f"\n\nIMPORTANT — fix these problems found in previous attempts (반드시 반영):\n{lines}"


# ── 이미지 ────────────────────────────────────────────────
def char_image(inp, reasons):
    style = config.read_style("style.txt")
    parts = [
        "Original character illustration for a casual mobile collection game.",
        f"Name: {inp.get('name', '')}",
        f"Title / role: {inp.get('title', '')}",
        f"Rarity: {inp.get('rarity', 'R')} — {RARITY_HINT.get(inp.get('rarity'), '')}",
        f"Appearance keywords: {inp.get('keywords', '')}",
    ]
    if inp.get("lore"):
        parts.append(f"Personality / lore (use for pose and expression only): {inp['lore']}")
    return "\n".join(parts) + _feedback_block(reasons) + (f"\n\nStyle: {style}" if style else "")


def banner_image(inp, chars, reasons):
    style = config.read_style("style_banner.txt")
    who = "\n".join(f"- {c['name']} ({c.get('title', '')}): {c.get('description', '')}" for c in chars)
    parts = [
        "Key visual for a gacha banner in a casual mobile game.",
        f"Event title (do NOT render as text): {inp.get('title', '')}",
        f"Theme: {inp.get('description', '')}",
    ]
    if who:
        parts.append(f"Featured characters (keep their designs consistent with the reference images):\n{who}")
    if inp.get("extra"):
        parts.append(f"Additional direction: {inp['extra']}")
    return "\n".join(parts) + _feedback_block(reasons) + (f"\n\nStyle: {style}" if style else "")


def bg_image(inp, reasons):
    style = config.read_style("style_bg.txt")
    return f"Background art for a visual novel scene.\nScene: {inp.get('prompt', '')}" + _feedback_block(reasons) + (f"\n\nStyle: {style}" if style else "")


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
