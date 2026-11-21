"""챕터 팩: 챕터 개요 하나로 '챕터(12장) + 등장 캐릭터 + 배경 + 적 + 스테이지'를 한 번에 만들기.

1) make_plan(): Gemini가 구성안(JSON)을 만듦 → 화면에서 고치거나 사유와 함께 다시 만들기
2) start(plan): 백그라운드 스레드에서 차례대로
   캐릭터(그림 없이 외형 키워드/설정 메모만) → 적(역할/스타일 틀로 스킬) → 스테이지(장 번호에 맞춘 레벨/보상)
   → 배경 등록(설정집) → 1~12장 대본 (세계관 + 챕터 구성 + 앞 장 요약 + 직전 장 대본을 읽고)
   → (선택) 배경 그림 일괄 생성 시작
   이미 만든 것은 건너뜀 → 중간에 멈춰도 같은 구성안으로 '이어서' 할 수 있음
"""
import json
import re
import secrets
import threading

from . import bible, genai, kit, store
from .genai import GenError
from .timeutil import now_iso, stamp

ARC_SIZE = 12
ROLES = ("minion", "elite", "boss")
STYLES = ("physical", "dot", "heal", "tank", "debuff")
ROLE_LABEL = {"minion": "잡몹", "elite": "정예", "boss": "보스"}
STYLE_LABEL = {"physical": "물리", "dot": "지속 피해", "heal": "치유", "tank": "방어", "debuff": "약화"}
RARITIES = ("R", "SR", "SSR")
SLUG = re.compile(r"[^a-z0-9_]+")

_lock = threading.Lock()
_cancel = threading.Event()
_state = None


# ─────────────────────────────────────────────────────────
# 구성안
# ─────────────────────────────────────────────────────────
def slug(value, prefix="", fallback="x"):
    s = SLUG.sub("_", str(value or "").lower()).strip("_")[:40] or fallback
    if prefix and not s.startswith(prefix):
        s = f"{prefix}{s}"
    return s[:64]


def story_id(arc, n):
    return f"main_{arc:02d}_{n:02d}"


def stage_id(arc, n):
    return f"st_{arc:02d}_{n:02d}"


def next_arc():
    arcs = [int(s.get("arc") or 0) for s in store.read_list("storyIndex") if s.get("kind") == "main"]
    return max(arcs + [0]) + 1


def _existing():
    b = bible.load()
    index = sorted((s for s in store.read_list("storyIndex") if s.get("kind") == "main"), key=lambda s: int(s.get("chapter") or 0))
    story = [f"- {s.get('chapter')}장 「{s.get('title')}」: {(b['chapters'].get(s['id']) or {}).get('recap', '') or s.get('summary', '')}" for s in index[-24:]]
    return {
        "world": b["world"],
        "style": b["style"],
        "chars": store.read_list("characters"),
        "enemies": store.read_list("enemies"),
        "backgrounds": b["backgrounds"],
        "story": "\n".join(story),
    }


PLAN_SCHEMA = """{
  "title": "챕터 제목",
  "summary": "챕터 한 줄 소개 (스포일러 없이)",
  "characters": [
    {"id": "ssr_haru", "name": "하루", "rarity": "SSR", "title": "칭호", "pullable": true,
     "keywords": "외형 키워드 (머리색, 눈색, 옷, 소품 — 그림 생성용)",
     "description": "도감에 보일 공개 소개 1~2문장 (스포일러 없이)",
     "lore": "작가용 설정 메모 (성격, 말투, 비밀, 이 챕터에서의 역할)"}
  ],
  "backgrounds": [
    {"name": "desert_market", "label": "사막 도시 시장", "prompt": "그림용 장면 설명 (사람 없이: 장소, 시간대, 분위기, 빛)"}
  ],
  "enemies": [
    {"id": "en_sand_slime", "name": "모래 슬라임", "role": "minion", "style": "physical", "description": "어떤 적인지",
     "keywords": "외형 키워드", "skills": {"basic": "기본 기술 이름", "skill": "스킬 이름", "ultimate": "보스만: 필살기 이름"}}
  ],
  "chapters": [
    {"n": 1, "title": "장 제목", "outline": "이 장에서 일어나는 일 2~4문장",
     "characters": ["이 장에 나오는 캐릭터 id"],
     "battle": null},
    {"n": 2, "title": "...", "outline": "...", "characters": ["..."],
     "battle": {"name": "스테이지 이름", "waves": [["en_sand_slime", "en_sand_slime"], ["en_sand_slime", "en_bandit"]]}}
  ]
}"""


def plan_prompt(outline, arc, ex, feedback="", previous=None):
    chars = "\n".join(f"- id: {c['id']} / {c.get('name')} ({c.get('rarity')}{', 스토리 전용' if c.get('pullable') is False else ''}) {c.get('title', '')}" for c in ex["chars"]) or "- (없음)"
    enemies = "\n".join(f"- id: {e['id']} / {e.get('name')}" for e in ex["enemies"]) or "- (없음)"
    bgs = "\n".join(f"- {k}: {v.get('label')}" for k, v in ex["backgrounds"].items()) or "- (없음)"
    text = f"""당신은 모바일 수집형 RPG의 메인 스토리 기획자입니다. 아래 챕터 개요로 '챕터 팩' 구성안을 JSON으로 만들어 주세요.
챕터 팩 = 12장짜리 챕터 1개 + 그 챕터에 새로 등장하는 캐릭터 + 배경 + 적 + 전투(스테이지).

[세계관]
{ex['world'] or '(아직 없음: 개요에서 자연스럽게)'}

[문체 / 톤]
{ex['style'] or '따뜻하고 가벼운 판타지'}

[지금까지의 메인 스토리]
{ex['story'] or '(이번이 첫 챕터)'}

[이미 있는 캐릭터] (다시 나오면 아래 id를 그대로 쓰고 characters에는 넣지 않기)
{chars}

[이미 있는 적] (재사용 가능)
{enemies}

[이미 있는 배경] (재사용 가능, backgrounds에는 새 배경만)
{bgs}

[이번 챕터] 챕터 {arc}
{outline}

[규칙]
- chapters는 정확히 12개 (n: 1~12). 각 장 개요는 사건 중심 2~4문장. 1장 도입 → 중반 전개/반전 → 11~12장 클라이맥스와 마무리, 마지막에 다음 챕터 떡밥.
- characters: 이 챕터에 새로 나오는 인물만.
  - 뽑을 수 있는 동료(pullable true)는 2~5명: SSR 1~2명, SR 1~2명, 나머지 R. 동료로 어울리지 않는 인물(악역, 마을 사람, 수수께끼의 인물 등)은 pullable false, rarity는 "R".
  - id는 영문 소문자/숫자/_ (예: ssr_haru, npc_merchant). 이름은 한국어.
  - keywords는 그림 생성용 외형(머리 모양/색, 눈 색, 옷, 소품, 체형). description은 공개용이라 스포일러 금지. lore는 작가용 메모라 비밀/역할을 자유롭게.
- backgrounds: 4~8개. 여러 장에서 재사용될 장소 위주. name은 영문 소문자 slug. prompt는 사람 없는 배경 그림 설명.
- enemies: 3~6종. role은 minion(잡몹) / elite(정예) / boss(보스, 마지막 장 전투에 반드시 등장). style은 physical / dot / heal / tank / debuff 중 하나.
- 전투(battle): 12장 중 5~8장에 넣기. 전투가 어울리는 장에만. waves는 1~3개, 웨이브마다 적 1~5명(적 id 목록, 같은 적 반복 가능). 12장에는 boss가 나오는 전투.
- 이전 챕터와 모순 없이, 세계관의 고유 명사와 설정을 지키기.

오직 JSON만 출력. 형식:
{PLAN_SCHEMA}
"""
    if previous:
        text += f"\n이전 구성안:\n{json.dumps(previous, ensure_ascii=False)[:12000]}\n"
    if feedback:
        text += f"\n이전 구성안에 대한 수정 요청 (반드시 반영, 나머지는 최대한 유지): {feedback}\n"
    return text


def mock_plan(outline, arc):
    """모의 모드: 형식이 진짜와 같은 가짜 구성안"""
    p = f"a{arc:02d}_"
    chapters = []
    for n in range(1, ARC_SIZE + 1):
        battle = None
        if n in (2, 4, 6, 8, 10):
            battle = {"name": f"{n}장의 전투", "waves": [["en_mock_slime", "en_mock_slime"], ["en_mock_slime", "en_mock_knight"]]}
        if n == 12:
            battle = {"name": "챕터 보스전", "waves": [["en_mock_slime", "en_mock_slime"], ["en_mock_boss", "en_mock_knight"]]}
        chapters.append({"n": n, "title": f"모의 {n}장", "outline": f"[모의 모드] {n}장. {outline[:60]}", "characters": ["ssr_mock_hero", "npc_mock_guide"], "battle": battle})
    return json.dumps(
        {
            "title": f"모의 챕터 {arc}",
            "summary": "[모의 모드] 새로운 여행이 시작된다",
            "characters": [
                {"id": "ssr_mock_hero", "name": "모의 주인공", "rarity": "SSR", "title": "견습 여행자", "pullable": True, "keywords": "silver short hair, blue eyes, travel coat, satchel", "description": "길을 떠난 견습 여행자.", "lore": "[모의] 밝고 덤벙댐"},
                {"id": "sr_mock_friend", "name": "모의 동료", "rarity": "SR", "title": "길잡이", "pullable": True, "keywords": "brown ponytail, green eyes, scarf", "description": "길을 잘 아는 동료.", "lore": "[모의] 무뚝뚝하지만 다정"},
                {"id": "npc_mock_guide", "name": "모의 안내인", "rarity": "R", "title": "마을 사람", "pullable": False, "keywords": "old man, beard, robe", "description": "마을의 안내인.", "lore": "[모의] 사실은 비밀이 있음"},
            ],
            "backgrounds": [
                {"name": f"{p}village", "label": "고향 마을", "prompt": "quiet fantasy village at dawn, wooden houses, soft light"},
                {"name": f"{p}road", "label": "숲길", "prompt": "forest road at noon, sunbeams"},
                {"name": f"{p}city", "label": "별빛 도시", "prompt": "night fantasy city, lanterns, starry sky"},
                {"name": f"{p}ruins", "label": "고대 유적", "prompt": "ancient ruins at dusk, glowing runes"},
            ],
            "enemies": [
                {"id": "en_mock_slime", "name": "모의 슬라임", "role": "minion", "style": "physical", "description": "통통 튀는 슬라임", "keywords": "blue slime", "skills": {"basic": "몸통 박치기"}},
                {"id": "en_mock_knight", "name": "모의 기사", "role": "elite", "style": "tank", "description": "녹슨 갑옷의 기사", "keywords": "rusty armor", "skills": {"basic": "베기", "skill": "철벽"}},
                {"id": "en_mock_boss", "name": "모의 보스", "role": "boss", "style": "dot", "description": "어둠의 마법사", "keywords": "dark robe", "skills": {"basic": "어둠 화살", "skill": "저주", "ultimate": "어둠의 폭풍"}},
            ],
            "chapters": chapters,
        },
        ensure_ascii=False,
    )


def clean_plan(raw, arc):
    """AI 구성안 정리 (id 규칙, 중복, 참조, 12장 맞추기) → (plan, warnings)"""
    if not isinstance(raw, dict):
        raise GenError("구성안 형식이 잘못됐어요 (객체가 아님)")
    warnings = []
    ex_chars = {c["id"] for c in store.read_list("characters")}
    ex_enemies = {e["id"] for e in store.read_list("enemies")}
    ex_bgs = set(bible.load()["backgrounds"])

    def unique(base, taken):
        out, n = base, 2
        while out in taken:
            out = f"{base}_{n}"[:64]
            n += 1
        taken.add(out)
        return out

    # 캐릭터
    chars, char_map, taken = [], {}, set(ex_chars)
    for c in raw.get("characters") or []:
        if not isinstance(c, dict) or not str(c.get("name") or "").strip():
            continue
        if c.get("id") in ex_chars:
            char_map[c["id"]] = c["id"]  # 이미 있는 캐릭터 → 재사용
            continue
        pullable = c.get("pullable") is not False
        rarity = c.get("rarity") if c.get("rarity") in RARITIES else "R"
        if not pullable:
            rarity = "R"
        prefix = {"SSR": "ssr_", "SR": "sr_", "R": "r_"}[rarity] if pullable else "npc_"
        cid = unique(slug(c.get("id"), prefix), taken)
        char_map[str(c.get("id"))] = cid
        chars.append(
            {
                "id": cid,
                "name": str(c["name"]).strip()[:20],
                "rarity": rarity,
                "title": str(c.get("title") or "").strip()[:40],
                "pullable": pullable,
                "keywords": str(c.get("keywords") or "").strip()[:500],
                "description": str(c.get("description") or "").strip()[:400],
                "lore": str(c.get("lore") or "").strip()[:1500],
            }
        )
    # 배경
    bgs, bg_taken = [], set(ex_bgs)
    for b in raw.get("backgrounds") or []:
        if not isinstance(b, dict) or b.get("name") in ex_bgs:
            continue
        name = unique(slug(b.get("name") or b.get("label"), f"a{arc:02d}_", "bg"), bg_taken)
        bgs.append({"name": name, "label": str(b.get("label") or name).strip()[:40], "prompt": str(b.get("prompt") or b.get("label") or "").strip()[:800]})
    # 적
    enemies, enemy_map, e_taken = [], {e: e for e in ex_enemies}, set(ex_enemies)
    for e in raw.get("enemies") or []:
        if not isinstance(e, dict) or not str(e.get("name") or "").strip():
            continue
        if e.get("id") in ex_enemies:
            continue
        eid = unique(slug(e.get("id"), "en_", "enemy"), e_taken)
        enemy_map[str(e.get("id"))] = eid
        skills = e.get("skills") if isinstance(e.get("skills"), dict) else {}
        enemies.append(
            {
                "id": eid,
                "name": str(e["name"]).strip()[:20],
                "role": e.get("role") if e.get("role") in ROLES else "minion",
                "style": e.get("style") if e.get("style") in STYLES else "physical",
                "description": str(e.get("description") or "").strip()[:300],
                "keywords": str(e.get("keywords") or "").strip()[:300],
                "skills": {k: str(skills.get(k) or "").strip()[:20] for k in ("basic", "skill", "ultimate")},
            }
        )
    if not any(e["role"] == "boss" for e in enemies) and enemies:
        warnings.append("보스 적이 없어서 마지막 적을 보스로 바꿨어요")
        enemies[-1]["role"] = "boss"
    # 장
    raw_ch = [c for c in raw.get("chapters") or [] if isinstance(c, dict)]
    if len(raw_ch) != ARC_SIZE:
        warnings.append(f"장이 {len(raw_ch)}개라서 {ARC_SIZE}개로 맞췄어요")
    chapters = []
    for n in range(1, ARC_SIZE + 1):
        c = raw_ch[n - 1] if n - 1 < len(raw_ch) else {"title": f"{n}장", "outline": "(개요를 적어 주세요)"}
        battle = None
        b = c.get("battle")
        if isinstance(b, dict) and isinstance(b.get("waves"), list):
            waves = []
            for w in b["waves"][:3]:
                ids = [enemy_map.get(str(x)) for x in (w if isinstance(w, list) else [])]
                missing = [x for x, y in zip(w if isinstance(w, list) else [], ids) if not y]
                if missing:
                    warnings.append(f"{n}장 전투: 모르는 적 {missing} → 뺐어요")
                ids = [x for x in ids if x][:5]
                if ids:
                    waves.append(ids)
            if waves:
                battle = {"name": str(b.get("name") or f"{n}장 전투").strip()[:40], "waves": waves}
        chapters.append(
            {
                "n": n,
                "title": str(c.get("title") or f"{n}장").strip()[:40],
                "outline": str(c.get("outline") or "").strip()[:1200],
                "characters": [char_map.get(str(x), x) for x in (c.get("characters") or []) if char_map.get(str(x), x) in ex_chars | {ch["id"] for ch in chars}],
                "battle": battle,
            }
        )
    if not chapters[-1]["battle"] and any(e["role"] == "boss" for e in enemies):
        boss = next(e for e in enemies if e["role"] == "boss")
        chapters[-1]["battle"] = {"name": f"{boss['name']} 결전", "waves": [[boss["id"]]]}
        warnings.append("12장에 보스전이 없어서 넣었어요")
    plan = {"arc": arc, "title": str(raw.get("title") or f"챕터 {arc}").strip()[:40], "summary": str(raw.get("summary") or "").strip()[:200], "characters": chars, "backgrounds": bgs, "enemies": enemies, "chapters": chapters}
    return plan, warnings


def make_plan(outline, arc, feedback="", previous=None):
    ex = _existing()
    raw = genai.generate_text(plan_prompt(outline, arc, ex, feedback, previous), json_mode=True, mock=lambda: mock_plan(outline, arc))
    plan, warnings = clean_plan(genai.parse_json_text(raw), arc)
    plan["outline"] = outline
    bible.set_pack(arc, {"plan": plan, "updatedAt": now_iso(), "status": "draft"})
    return plan, warnings


# ─────────────────────────────────────────────────────────
# 적 / 스테이지 틀 (역할 × 스타일 → 스킬과 능력치)
# ─────────────────────────────────────────────────────────
ROLE_STATS = {"minion": {"atk": 60, "def": 18, "hp": 400}, "elite": {"atk": 75, "def": 26, "hp": 750}, "boss": {"atk": 90, "def": 36, "hp": 2000}}
STYLE_MUL = {"physical": (1.0, 1.0, 1.0), "dot": (1.0, 0.9, 0.95), "heal": (0.8, 1.0, 1.1), "tank": (0.85, 1.3, 1.3), "debuff": (0.95, 1.0, 1.0)}


def _dmg(m, **kw):
    return {"type": "damage", "mult": m, "stat": "atk", "hits": 1, **kw}


def _sk(name, targeting, effects, **kw):
    return {"name": name, "description": "", "targeting": targeting, "effects": effects, **kw}


def enemy_entry(e):
    role, style, names = e["role"], e["style"], e.get("skills") or {}
    a, d, h = STYLE_MUL[style]
    base = ROLE_STATS[role]
    stats = {"atk": round(base["atk"] * a), "def": round(base["def"] * d), "hp": round(base["hp"] * h), "critRate": 0.05, "critDmg": 0.5}
    basic_fx = [_dmg(0.8), {"type": "dot", "mult": 0.2, "turns": 2, "chance": 50}] if style == "dot" else [_dmg(1.0)]
    basic = _sk(names.get("basic") or "공격", "enemy_single", basic_fx)
    skill = {
        "physical": _sk(names.get("skill") or "강타", "enemy_single", [_dmg(1.6)], cooldown=2),
        "dot": _sk(names.get("skill") or "독기", "enemy_all", [_dmg(0.4), {"type": "dot", "mult": 0.25, "turns": 2}], cooldown=3),
        "heal": _sk(names.get("skill") or "치유", "ally_lowest_hp", [{"type": "heal", "mult": 0.9, "stat": "atk"}], cooldown=3),
        "tank": _sk(names.get("skill") or "철벽", "self", [{"type": "shield", "mult": 0.15, "stat": "hp", "turns": 2}, {"type": "taunt", "turns": 1}], cooldown=3),
        "debuff": _sk(names.get("skill") or "약화", "enemy_single", [_dmg(0.6), {"type": "debuff", "stat": "def", "pct": 20, "turns": 2}], cooldown=3),
    }[style]
    if role == "minion" and style == "physical":
        skill = None
    ultimate = None
    passives = []
    if role == "boss":
        extra = {
            "physical": [],
            "dot": [{"type": "dot", "mult": 0.3, "turns": 2}],
            "heal": [{"type": "heal", "mult": 0.4, "stat": "atk", "target": "ally_all"}],
            "tank": [{"type": "shield", "mult": 0.1, "stat": "hp", "turns": 2, "target": "self"}],
            "debuff": [{"type": "debuff", "stat": "atk", "pct": 15, "turns": 2}],
        }[style]
        ultimate = _sk(names.get("ultimate") or "필살기", "enemy_all", [_dmg(1.2)] + extra)
        passives = [{"name": "분노", "description": "HP가 절반 아래면 공격력이 올라요.", "trigger": "onHpBelow", "pct": 50, "limit": 1, "targeting": "self", "conditions": [], "effects": [{"type": "buff", "stat": "atk", "pct": 30, "turns": 3}], "modifiers": []}]
    return {
        "id": e["id"],
        "name": e["name"],
        "image": "",
        "boss": role == "boss",
        "stats": stats,
        "kit": {"basic": basic, "skill": skill, "ultimate": ultimate},
        "passives": passives,
        "keywords": e.get("keywords", ""),
        "memo": e.get("description", ""),
    }


def _power(enemy, level, balance):
    g = float(balance.get("growth", 0.08))
    w = {"atk": 2, "def": 1.5, "hp": 0.2, "critRate": 300, "critDmg": 100, **(balance.get("power") or {})}
    s = enemy.get("stats") or {}
    mul = 1 + g * (max(1, level) - 1)
    atk, df, hp = (int(int(s.get(k, 0)) * mul) for k in ("atk", "def", "hp"))
    return int(w["atk"] * atk + w["def"] * df + w["hp"] * hp + w["critRate"] * s.get("critRate", 0.05) + w["critDmg"] * s.get("critDmg", 0.5))


def stage_entry(arc, n, battle, enemies_by_id, roles, balance):
    """장 번호에 맞춘 레벨: 챕터 시작 레벨 + (장 − 1), 정예 +1, 보스 +3"""
    base = 1 + (arc - 1) * ARC_SIZE + (n - 1)
    role_bonus = {"minion": 0, "elite": 1, "boss": 3}
    waves = []
    for w in battle["waves"]:
        wave = []
        for eid in w:
            role = roles.get(eid) or ("boss" if enemies_by_id.get(eid, {}).get("boss") else "minion")
            wave.append({"enemyId": eid, "level": base + role_bonus[role]})
        waves.append(wave)
    strongest = max((sum(_power(enemies_by_id[e["enemyId"]], e["level"], balance) for e in w if e["enemyId"] in enemies_by_id) for w in waves), default=0)
    has_boss = any(enemies_by_id.get(e["enemyId"], {}).get("boss") for w in waves for e in w)
    return {
        "id": stage_id(arc, n),
        "name": battle["name"],
        "recommendedPower": int(round(strongest * 1.2 / 100.0) * 100),
        "waves": waves,
        "turnLimit": 25 if has_boss else 20,
        "rewards": {"tickets": 40 + 5 * (n - 1) + 30 * (arc - 1), "gems": 0, "gold": (40 + 5 * (n - 1) + 30 * (arc - 1)) * 10},
        "firstClearRewards": {"tickets": 150 + 10 * n, "gems": 100 if has_boss else 50, "gold": (150 + 10 * n) * 10},
    }


# ─────────────────────────────────────────────────────────
# 실행 (백그라운드)
# ─────────────────────────────────────────────────────────
def snapshot():
    with _lock:
        if _state is None:
            return None
        st = {**_state, "steps": [dict(s) for s in _state["steps"]]}
    st["cancelRequested"] = _cancel.is_set() and st["running"]
    return st


def cancel():
    with _lock:
        running = bool(_state and _state["running"])
    if running:
        _cancel.set()
    return snapshot()


def start(plan, options):
    """구성안으로 팩 만들기 시작 (화면에서 고친 구성안을 다시 정리해서 씀)"""
    global _state
    arc = int(plan.get("arc") or 0)
    if arc < 1:
        raise ValueError("챕터 번호가 올바르지 않아요")
    clean, warnings = normalize_edited(plan, arc)
    steps = [
        {"key": "characters", "label": f"캐릭터 {len(clean['characters'])}명 (그림 없이)"},
        {"key": "enemies", "label": f"적 {len(clean['enemies'])}종"},
        {"key": "stages", "label": f"스테이지 {sum(1 for c in clean['chapters'] if c['battle'])}개"},
        {"key": "backgrounds", "label": f"배경 {len(clean['backgrounds'])}개 등록"},
        *({"key": f"ch:{c['n']}", "label": f"{c['n']}장 「{c['title']}」 대본"} for c in clean["chapters"]),
    ]
    if options.get("autoBackgrounds"):
        steps.append({"key": "bgimages", "label": "배경 그림 일괄 생성 시작"})
    for s in steps:
        s.update(status="pending", note=None)
    with _lock:
        if _state and _state["running"]:
            raise ValueError("이미 챕터 팩을 만드는 중이에요")
        _cancel.clear()
        _state = {"id": f"pack-{stamp()}-{secrets.token_hex(2)}", "arc": arc, "running": True, "startedAt": now_iso(), "finishedAt": None, "steps": steps, "warnings": warnings, "stopReason": None, "options": options}
    bible.set_pack(arc, {"plan": clean, "updatedAt": now_iso(), "status": "building"})
    threading.Thread(target=_run, args=(_state, clean, options), daemon=True, name="tinydev-pack").start()
    return snapshot()


def normalize_edited(plan, arc):
    """화면에서 고친 구성안 확인 (id는 그대로 유지 → 중간에 멈춘 팩도 같은 구성안으로 이어서)"""
    warnings = []
    ex_enemies = {e["id"] for e in store.read_list("enemies")}
    ex_chars = {c["id"] for c in store.read_list("characters")}

    def ids_ok(items, label):
        seen = set()
        out = []
        for it in items or []:
            key = it.get("name") if label == "배경" else it.get("id")
            if not isinstance(it, dict) or not store.valid_id(key):
                raise ValueError(f"{label} id가 올바르지 않아요: {key!r} (영문/숫자/_/-)")
            if key in seen:
                raise ValueError(f"{label} id '{key}'가 중복돼요")
            seen.add(key)
            out.append(it)
        return out

    chars = []
    for c in ids_ok(plan.get("characters"), "캐릭터"):
        if not str(c.get("name") or "").strip():
            raise ValueError(f"캐릭터 {c['id']}의 이름이 비어 있어요")
        pullable = c.get("pullable") is not False
        chars.append({**c, "rarity": c.get("rarity") if c.get("rarity") in RARITIES else "R", "pullable": pullable})
    bgs = ids_ok(plan.get("backgrounds"), "배경")
    enemies = []
    for e in ids_ok(plan.get("enemies"), "적"):
        enemies.append({**e, "role": e.get("role") if e.get("role") in ROLES else "minion", "style": e.get("style") if e.get("style") in STYLES else "physical", "skills": e.get("skills") or {}})
    known_enemies = ex_enemies | {e["id"] for e in enemies}
    known_chars = ex_chars | {c["id"] for c in chars}
    chapters = []
    raw_ch = plan.get("chapters") or []
    if len(raw_ch) != ARC_SIZE:
        raise ValueError(f"장은 {ARC_SIZE}개여야 해요 (지금 {len(raw_ch)}개)")
    for n, c in enumerate(raw_ch, start=1):
        battle = c.get("battle")
        if battle:
            waves = [[x for x in w if x in known_enemies][:5] for w in battle.get("waves") or []]
            waves = [w for w in waves if w][:3]
            if not waves:
                warnings.append(f"{n}장 전투에 적이 없어서 전투를 뺐어요")
            battle = {"name": str(battle.get("name") or f"{n}장 전투")[:40], "waves": waves} if waves else None
        chapters.append({"n": n, "title": str(c.get("title") or f"{n}장")[:40], "outline": str(c.get("outline") or "")[:1200], "characters": [x for x in c.get("characters") or [] if x in known_chars], "battle": battle})
    return {"arc": arc, "title": str(plan.get("title") or f"챕터 {arc}")[:40], "summary": str(plan.get("summary") or "")[:200], "outline": plan.get("outline", ""), "characters": chars, "backgrounds": bgs, "enemies": enemies, "chapters": chapters}, warnings


def _step(st, key, **kw):
    with _lock:
        for s in st["steps"]:
            if s["key"] == key:
                s.update(kw)


def _upsert(items, entry):
    for i, x in enumerate(items):
        if x.get("id") == entry["id"]:
            return False
    items.append(entry)
    return True


def _run(st, plan, options):
    from . import api, batch  # api.draft_chapter (순환 import 방지로 여기서)

    arc = plan["arc"]
    stop = None
    try:
        # 1) 캐릭터: 그림 없이, 외형 키워드/설정 메모만
        _step(st, "characters", status="running")
        chars = store.read_list("characters")
        made = 0
        for c in plan["characters"]:
            entry = {"id": c["id"], "name": c["name"], "rarity": c["rarity"], "title": c["title"], "description": c["description"], "image": "", "addedAt": now_iso(), "pullable": c["pullable"], "keywords": c["keywords"], "lore": c["lore"], "arc": arc}
            made += _upsert(chars, entry)
        store.write_list("characters", chars)
        _step(st, "characters", status="done", note=f"새로 {made}명 (이미 있던 {len(plan['characters']) - made}명은 그대로)")

        # 2) 적
        _step(st, "enemies", status="running")
        enemies = store.read_list("enemies")
        made = 0
        for e in plan["enemies"]:
            entry = enemy_entry(e)
            errors = [i for i in kit.battle_issues(entry, enemy=True) if i["level"] == "error"]
            if errors:
                raise ValueError(f"적 {e['id']} 스킬 오류: {errors[0]['message']}")
            made += _upsert(enemies, entry)
        store.write_list("enemies", enemies)
        _step(st, "enemies", status="done", note=f"새로 {made}종")

        # 3) 스테이지
        _step(st, "stages", status="running")
        by_id = {e["id"]: e for e in store.read_list("enemies")}
        roles = {e["id"]: e["role"] for e in plan["enemies"]}
        balance = store.read_balance()
        stages = store.read_list("stages")
        made = 0
        for c in plan["chapters"]:
            if c["battle"]:
                made += _upsert(stages, stage_entry(arc, c["n"], c["battle"], by_id, roles, balance))
        store.write_list("stages", stages)
        _step(st, "stages", status="done", note=f"새로 {made}개")

        # 4) 배경 등록 (그림은 일괄 생성 탭의 '스토리 배경')
        _step(st, "backgrounds", status="running")
        for b in plan["backgrounds"]:
            bible.set_background(b["name"], b["label"], b["prompt"], arc)
        _step(st, "backgrounds", status="done")

        # 5) 12장 대본: 차례대로 (앞 장이 저장돼야 다음 장이 그 요약/대본을 읽음)
        index = store.read_list("storyIndex")
        mine = {story_id(arc, c["n"]) for c in plan["chapters"]}
        base = max([int(s.get("chapter") or 0) for s in index if s.get("kind") == "main" and s.get("id") not in mine] + [0])
        stage_names = {s["id"]: s.get("name") for s in store.read_list("stages")}
        pack_ctx = {"arc": arc, "title": plan["title"], "summary": plan["summary"], "chapters": plan["chapters"]}
        for c in plan["chapters"]:
            key = f"ch:{c['n']}"
            if _cancel.is_set():
                stop = "cancelled"
                break
            sid = story_id(arc, c["n"])
            index = store.read_list("storyIndex")
            if any(s.get("id") == sid for s in index) and store.read_story(sid) and not options.get("overwrite"):
                _step(st, key, status="skipped", note="이미 있어서 건너뜀")
                continue
            _step(st, key, status="running")
            chapter_no = base + c["n"]
            req = {"id": stage_id(arc, c["n"]), "name": stage_names.get(stage_id(arc, c["n"]), c["battle"]["name"])} if c["battle"] else None
            try:
                draft, warns, _ctx = api.draft_chapter(
                    {"id": sid, "kind": "main", "chapter": chapter_no, "title": c["title"]},
                    c["outline"] or c["title"],
                    length=options.get("length") or "auto",
                    character_ids=c["characters"],
                    pack={**pack_ctx, "position": c["n"]},
                    required_stage=req,
                )
            except Exception as e:  # noqa: BLE001 — 한 장이 실패하면 거기서 멈추고 알림 (나중에 이어서)
                _step(st, key, status="error", note=str(e)[:300])
                stop = "error"
                break
            store.write_story(sid, {"id": sid, "title": c["title"], "scenes": draft["scenes"]})
            entry = {"id": sid, "kind": "main", "chapter": chapter_no, "arc": arc, "arcTitle": plan["title"], "title": c["title"], "summary": draft.get("summary", ""), "unlock": [{"type": "prevChapter"}], "reward": {"gems": 100 if c["n"] == len(plan["chapters"]) else 50}}
            index = [s for s in store.read_list("storyIndex") if s.get("id") != sid]
            index.append(entry)
            index.sort(key=lambda s: (s.get("kind") != "main", int(s.get("chapter") or 0)))
            store.write_list("storyIndex", index)
            bible.set_chapter(sid, outline=c["outline"], recap=draft.get("recap") or None)
            lines = sum(len(sc.get("lines") or []) for sc in draft["scenes"])
            _step(st, key, status="done", note=f"장면 {len(draft['scenes'])}개 · 대사 {lines}줄" + (f" · 주의 {len(warns)}" if warns else ""))

        # 6) 배경 그림 일괄 생성 (ComfyUI)
        if options.get("autoBackgrounds") and not stop:
            _step(st, "bgimages", status="running")
            keys = [f"bg:{b['name']}" for b in plan["backgrounds"] if not store.asset_exists_ws(f"assets/bg/{b['name']}.jpg")]
            try:
                if keys:
                    batch.start(keys, auto_apply=True, stop_on_error=False)
                _step(st, "bgimages", status="done", note=f"{len(keys)}개 시작 — 진행은 일괄 생성 탭에서" if keys else "그릴 배경이 없어요")
            except ValueError as e:
                _step(st, "bgimages", status="error", note=f"{e} — 일괄 생성 탭에서 직접 시작해 주세요")
    except Exception as e:  # noqa: BLE001
        stop = "error"
        with _lock:
            for s in st["steps"]:
                if s["status"] == "running":
                    s.update(status="error", note=f"{type(e).__name__}: {e}"[:300])
    finally:
        with _lock:
            for s in st["steps"]:
                if s["status"] == "pending":
                    s["status"] = "cancelled" if stop == "cancelled" else "skipped" if stop else s["status"]
            st["running"] = False
            st["finishedAt"] = now_iso()
            st["stopReason"] = stop
        bible.set_pack(arc, {"plan": plan, "updatedAt": now_iso(), "status": "done" if not stop else stop})
