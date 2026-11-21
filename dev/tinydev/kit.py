"""전투 데이터 검사: 스킬 / 효과 / 돌파(패시브) / 능력치.

게임과 같은 용어집(js/battle/vocab.json)을 읽어서 검사합니다.
→ 새 효과를 vocab에 추가하면 개발 도구 검사도 자동으로 따라옵니다.

r 는 validate.Report 처럼 error(where, msg) / warn(where, msg) 가 있는 객체.
"""
import re
import json

from . import config

VOCAB_PATH = config.ROOT / "js" / "battle" / "vocab.json"
ACTIONS = ("basic", "skill", "ultimate")
STAT_LIMITS = {"atk": (0, 1e6), "def": (0, 1e6), "hp": (1, 1e7), "spd": (1, 1000), "critRate": (0, 1), "critDmg": (0, 10)}
MAX_BREAKTHROUGHS = 5

_cache = {"mtime": None, "vocab": None}


def load_vocab():
    """vocab.json (바뀌면 다시 읽음)"""
    mtime = VOCAB_PATH.stat().st_mtime
    if _cache["mtime"] != mtime:
        _cache["vocab"] = json.loads(VOCAB_PATH.read_text(encoding="utf-8"))
        _cache["mtime"] = mtime
    return _cache["vocab"]


class Collect:
    """검사 결과 모으기 (API에서 바로 쓰기용)"""

    def __init__(self):
        self.items = []

    def error(self, where, message):
        self.items.append({"level": "error", "where": where, "message": message})

    def warn(self, where, message):
        self.items.append({"level": "warning", "where": where, "message": message})

    @property
    def errors(self):
        return [i for i in self.items if i["level"] == "error"]


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def enum_options(spec, vocab):
    of = spec.get("of")
    if isinstance(of, list):
        return of
    return vocab.get("statGroups", {}).get(of, [])


def targeting_ok(value, vocab, passive=False):
    t = vocab["targeting"].get(value)
    return bool(t) and (passive or not t.get("passiveOnly"))


def _check_param(r, where, key, value, spec, vocab, passive=False):
    kind = spec.get("kind")
    if value is None:
        if kind != "effects" and "default" in spec:
            r.warn(where, f"{key}가 없어서 기본값({spec['default']})을 써요")
        elif kind == "effects":
            r.error(where, f"{key} 목록이 필요해요")
        return
    if kind in ("number", "int"):
        if not _is_num(value):
            r.error(where, f"{key}는 숫자여야 해요: {value!r}")
            return
        if kind == "int" and int(value) != value:
            r.error(where, f"{key}는 정수여야 해요: {value!r}")
        lo, hi = spec.get("min"), spec.get("max")
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            r.error(where, f"{key}={value} 는 범위({lo}~{hi}) 밖이에요")
    elif kind == "enum":
        opts = enum_options(spec, vocab)
        if value not in opts:
            r.error(where, f"{key}는 {', '.join(opts)} 중 하나여야 해요: {value!r}")
    elif kind == "targeting":
        if not targeting_ok(value, vocab, passive):
            r.error(where, f"알 수 없는 대상 '{value}'")
    elif kind == "effects":
        check_effect_list(r, where, value, vocab, passive=passive, nested=True)


def check_effect(r, where, eff, vocab, passive=False):
    if not isinstance(eff, dict):
        r.error(where, "효과가 객체가 아니에요")
        return
    t = eff.get("type")
    d = vocab["effects"].get(t)
    if not d:
        r.error(where, f"알 수 없는 효과 '{t}' (쓸 수 있는 것: {', '.join(vocab['effects'])})")
        return
    for key, spec in (d.get("params") or {}).items():
        _check_param(r, f"{where}({t})", key, eff.get(key), spec, vocab, passive)
    target = eff.get("target")
    if target not in (None, ""):
        if not targeting_ok(target, vocab, passive):
            r.error(where, f"알 수 없는 대상 '{target}'" + (" (trigger_target은 돌파 능력에서만)" if target == "trigger_target" else ""))
        elif vocab["targeting"][target].get("count"):
            _check_param(r, where, "count", eff.get("count"), vocab["count"], vocab)
    if eff.get("chance") is not None:
        _check_param(r, where, "chance", eff.get("chance"), vocab["effectCommon"]["chance"], vocab)


def check_effect_list(r, where, effects, vocab, passive=False, nested=False, required=True):
    if not isinstance(effects, list):
        r.error(where, "effects가 목록이 아니에요")
        return
    if required and not effects:
        r.error(where, "효과가 하나도 없어요")
    for i, e in enumerate(effects):
        check_effect(r, f"{where}[{i}]", e, vocab, passive)


def check_skill(r, where, skill, kind, vocab):
    if not isinstance(skill, dict):
        r.error(where, "스킬이 객체가 아니에요")
        return
    if not str(skill.get("name") or "").strip():
        r.warn(where, "스킬 이름이 비어 있어요")
    t = skill.get("targeting")
    if not targeting_ok(t, vocab):
        r.error(where, f"대상(targeting)이 올바르지 않아요: {t!r}")
    elif vocab["targeting"][t].get("count"):
        _check_param(r, where, "count", skill.get("count"), vocab["count"], vocab)
    check_effect_list(r, f"{where}.effects", skill.get("effects"), vocab)
    if "cooldown" in skill or "initialCooldown" in skill:
        r.warn(where, "cooldown은 더 이상 쓰지 않아요 (스킬은 팀 SP를 써요) — 지워 주세요")
    if kind == "ultimate" and skill.get("cost") is not None:
        c = skill.get("cost")
        if not (isinstance(c, int) and 0 <= c <= 1000):
            r.error(where, f"궁극기 cost는 0~1000 정수여야 해요: {c!r}")


def check_kit(r, where, kit, vocab, enemy=False):
    if kit is None:
        r.warn(where, "스킬(kit)이 없어서 기본 스킬을 써요")
        return
    if not isinstance(kit, dict):
        r.error(where, "kit이 객체가 아니에요")
        return
    for kind in ACTIONS:
        s = kit.get(kind)
        if s is None:
            if kind == "basic" or not enemy:
                r.warn(f"{where}.{kind}", "비어 있어서 기본 스킬을 써요")
            continue
        check_skill(r, f"{where}.{kind}", s, kind, vocab)


def check_passive(r, where, p, vocab):
    if not isinstance(p, dict):
        r.error(where, "능력이 객체가 아니에요")
        return
    if not str(p.get("name") or "").strip():
        r.warn(where, "이름이 비어 있어요")
    trig = p.get("trigger")
    if trig not in (None, ""):
        td = vocab["triggers"].get(trig)
        if not td:
            r.error(where, f"알 수 없는 발동 조건 '{trig}' (쓸 수 있는 것: {', '.join(vocab['triggers'])})")
        else:
            for key, spec in (td.get("params") or {}).items():
                _check_param(r, where, key, p.get(key), spec, vocab)
    conds = p.get("conditions") or []
    if not isinstance(conds, list):
        r.error(where, "conditions가 목록이 아니에요")
        conds = []
    for i, c in enumerate(conds):
        cd = vocab["conditions"].get((c or {}).get("type"))
        if not cd:
            r.error(f"{where}.conditions[{i}]", f"알 수 없는 조건 '{(c or {}).get('type')}'")
            continue
        for key, spec in (cd.get("params") or {}).items():
            _check_param(r, f"{where}.conditions[{i}]", key, c.get(key), spec, vocab)
    t = p.get("targeting") or "self"
    if not targeting_ok(t, vocab, passive=True):
        r.error(where, f"대상(targeting)이 올바르지 않아요: {t!r}")
    effects = p.get("effects") or []
    if effects and not trig:
        r.error(where, "발동 조건(trigger) 없이 효과(effects)가 있어요. 상시 능력은 modifiers를 쓰세요")
    if trig:
        check_effect_list(r, f"{where}.effects", effects, vocab, passive=True, required=False)
    mods = p.get("modifiers") or []
    if not isinstance(mods, list):
        r.error(where, "modifiers가 목록이 아니에요")
        mods = []
    for i, m in enumerate(mods):
        md = vocab["modifiers"].get((m or {}).get("type"))
        mw = f"{where}.modifiers[{i}]"
        if not md:
            r.error(mw, f"알 수 없는 수정자 '{(m or {}).get('type')}' (쓸 수 있는 것: {', '.join(vocab['modifiers'])})")
            continue
        for key, spec in (md.get("params") or {}).items():
            if key == "count" and not vocab["targeting"].get(m.get("targeting"), {}).get("count"):
                continue
            _check_param(r, mw, key, m.get(key), spec, vocab)
    if p.get("limit") is not None and not (isinstance(p["limit"], int) and p["limit"] >= 1):
        r.error(where, f"limit은 1 이상의 정수여야 해요: {p['limit']!r}")
    if not effects and not mods:
        r.warn(where, "효과도 수정자도 없어요 (이름만 있는 능력)")


def check_stats(r, where, stats):
    if stats is None:
        return
    if not isinstance(stats, dict):
        r.error(where, "stats가 객체가 아니에요")
        return
    for k, v in stats.items():
        if k not in STAT_LIMITS:
            r.warn(where, f"모르는 능력치 '{k}' (무시됨)")
            continue
        lo, hi = STAT_LIMITS[k]
        if not _is_num(v) or v < lo or v > hi:
            r.error(where, f"{k}={v!r} 는 {lo}~{hi} 숫자여야 해요")


def check_character_battle(r, where, c, vocab):
    """캐릭터의 stats / kit / breakthroughs"""
    check_stats(r, f"{where}.stats", c.get("stats"))
    check_kit(r, f"{where}.kit", c.get("kit"), vocab)
    bts = c.get("breakthroughs")
    if bts is None:
        r.warn(where, "돌파 능력(breakthroughs)이 없어요")
        return
    if not isinstance(bts, list):
        r.error(where, "breakthroughs가 목록이 아니에요")
        return
    if len(bts) > MAX_BREAKTHROUGHS:
        r.error(where, f"돌파 능력은 {MAX_BREAKTHROUGHS}개까지예요 ({len(bts)}개)")
    elif len(bts) < MAX_BREAKTHROUGHS:
        r.warn(where, f"돌파 능력이 {len(bts)}개뿐이에요 (5개 권장)")
    for i, p in enumerate(bts):
        check_passive(r, f"{where}.돌파{i + 1}", p, vocab)


ENEMY_ICONS = ("attack", "aoe", "buff", "heal", "debuff")
ENEMY_TARGET_RULES = ("random", "lowest_hp", "highest_atk", "slot1", "slot2", "slot3", "slot4", "slot5")
ACTION_ID_RE = re.compile(r"^[a-z0-9_]{1,24}$")


def _check_pattern(r, where, pattern, actions, required=True):
    if not isinstance(pattern, list) or (required and not pattern):
        r.error(where, "패턴(pattern)은 행동 목록이어야 해요 (최소 1개)")
        return
    for i, p in enumerate(pattern):
        pw = f"{where}[{i}]"
        if not isinstance(p, dict) or p.get("action") not in actions:
            r.error(pw, f"없는 행동: {(p or {}).get('action') if isinstance(p, dict) else p!r} (있는 것: {', '.join(actions)})")
            continue
        if p.get("target") not in (None, "") and p["target"] not in ENEMY_TARGET_RULES:
            r.error(pw, f"대상 규칙은 {', '.join(ENEMY_TARGET_RULES)} 중 하나: {p['target']!r}")


def check_enemy_battle(r, where, e, vocab):
    """적: stats / actions / pattern / phases / enrage / passives (예전 kit 형식은 경고)"""
    check_stats(r, f"{where}.stats", e.get("stats"))
    actions = e.get("actions")
    if actions is None and e.get("kit") is not None:
        r.warn(where, "예전 형식(kit)이에요. 게임은 읽을 수 있지만 적 편집기에서 다시 저장하면 actions/pattern으로 바뀌어요")
        check_kit(r, f"{where}.kit", e.get("kit"), vocab, enemy=True)
    elif not isinstance(actions, dict) or not actions:
        r.error(where, "행동(actions)이 하나도 없어요")
        actions = {}
    else:
        for aid, a in actions.items():
            aw = f"{where}.actions.{aid}"
            if not ACTION_ID_RE.match(str(aid)):
                r.error(aw, "행동 id는 영문 소문자/숫자/_ (24자까지)")
            check_skill(r, aw, a, "enemy", vocab)
            if isinstance(a, dict):
                if a.get("icon") not in (None, "") and a["icon"] not in ENEMY_ICONS:
                    r.error(aw, f"icon은 {', '.join(ENEMY_ICONS)} 중 하나: {a['icon']!r}")
                if a.get("big") not in (None, True, False):
                    r.error(aw, "big은 true/false")
        _check_pattern(r, f"{where}.pattern", e.get("pattern"), list(actions))
        phases = e.get("phases") or []
        if not isinstance(phases, list):
            r.error(where, "phases가 목록이 아니에요")
            phases = []
        for i, ph in enumerate(phases):
            pw = f"{where}.phases[{i}]"
            hb = (ph or {}).get("hpBelow")
            if not (isinstance(hb, int) and 1 <= hb <= 99):
                r.error(pw, f"hpBelow는 1~99 정수: {hb!r}")
            _check_pattern(r, f"{pw}.pattern", (ph or {}).get("pattern") or [], list(actions), required=False)
            check_effect_list(r, f"{pw}.enterEffects", (ph or {}).get("enterEffects") or [], vocab, required=False)
        en = e.get("enrage")
        if en is not None:
            if not isinstance(en, dict) or not (isinstance(en.get("round"), int) and 1 <= en["round"] <= 999):
                r.error(f"{where}.enrage", "enrage는 {round: 1~999, effects: [...]}")
            else:
                check_effect_list(r, f"{where}.enrage.effects", en.get("effects"), vocab)
    ps = e.get("passives") or []
    if not isinstance(ps, list):
        r.error(where, "passives가 목록이 아니에요")
        return
    for i, p in enumerate(ps):
        check_passive(r, f"{where}.패시브{i + 1}", p, vocab)


def battle_issues(entity, enemy=False):
    """한 캐릭터/적의 전투 데이터 검사 결과 목록"""
    r = Collect()
    vocab = load_vocab()
    (check_enemy_battle if enemy else check_character_battle)(r, entity.get("id") or "?", entity, vocab)
    return r.items
