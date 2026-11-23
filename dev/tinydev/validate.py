"""콘텐츠 검사: 알 수 없는 캐릭터 id, 없는 이미지, 날짜 형식/범위, 잘못된 참조 등.

결과는 [{level: 'error'|'warning', where: '파일/항목', message: '설명'}] 목록.
error가 하나라도 있으면 배포할 수 없습니다.
"""
import re

from . import kit, rarity
from .store import valid_id, deleted_ids, is_auto_id, ID_KINDS
from .timeutil import parse

STORY_KINDS = ("main", "character", "event")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")


class Report:
    def __init__(self):
        self.items = []

    def error(self, where, message):
        self.items.append({"level": "error", "where": where, "message": message})

    def warn(self, where, message):
        self.items.append({"level": "warning", "where": where, "message": message})

    @property
    def errors(self):
        return [i for i in self.items if i["level"] == "error"]


def _check_date(r, where, field, value, required=False):
    """날짜: 없으면(null) 통과(필수가 아니면), 있으면 ISO + 시간대 필수"""
    if value in (None, ""):
        if required:
            r.error(where, f"{field}가 비어 있어요")
        return None
    d = parse(value)
    if not d:
        r.error(where, f"{field} 날짜 형식이 잘못됐어요: {value!r} (예: 2026-12-01T00:00:00+09:00)")
        return None
    if not value.endswith("+09:00"):
        r.warn(where, f"{field}가 한국 시간(+09:00)이 아니에요: {value}")
    return d


# 목록 이름 → 자동 id 종류 (id 규칙 <종류>_<4자리> 검사)
LABEL_KIND = {"memories": "memory", "characters": "char", "enemies": "enemy", "stages": "stage", "stories/index": "story", "banners": "banner", "notices": "notice", "mail": "mail", "shop.gold": "shop", "shop.cash": "shop"}


def _check_ids(r, label, items):
    """목록 공통: 배열인지, 각 항목에 올바른 id가 있고 중복이 없는지, id가 자동 규칙(<종류>_<4자리>)인지"""
    kind = LABEL_KIND.get(label)
    if not isinstance(items, list):
        r.error(label, "목록(배열)이 아니에요")
        return []
    seen = set()
    ok = []
    for i, it in enumerate(items):
        where = f"{label}[{i}]"
        if not isinstance(it, dict):
            r.error(where, "객체가 아니에요")
            continue
        if not valid_id(it.get("id")):
            r.error(where, f"id가 올바르지 않아요: {it.get('id')!r} (영문/숫자/_/-만)")
            continue
        if kind and not is_auto_id(kind, it["id"]):
            r.error(f"{label}/{it['id']}", f"id 규칙이 아니에요 → '{ID_KINDS[kind][0]}_0001' 형식 (id는 개발 도구가 자동으로 정해요)")
        if it["id"] in seen:
            r.error(f"{label}/{it['id']}", "id가 중복돼요")
            continue
        seen.add(it["id"])
        ok.append(it)
    return ok


def _check_asset(r, where, field, path, asset_exists, required=False):
    if not path:
        if required:
            r.warn(where, f"{field}이(가) 비어 있어요 (기본 그림으로 표시됨)")
        return
    if not isinstance(path, str) or not path.startswith("assets/") or ".." in path:
        r.error(where, f"{field} 경로가 잘못됐어요: {path!r} (assets/로 시작)")
    elif not asset_exists(path):
        r.error(where, f"{field} 파일이 없어요: {path}")


# ── 상점 (data/shop.json) — 게임의 js/core/data.js validateShop과 같은 규칙 ──
SHOP_LIMIT_PERS = ("day", "week", "month", "once")
SHOP_CATEGORIES = ("featured", "package", "growth", "gems", "pass")
SHOP_TIERS = ("normal", "rare", "legend", "truck")
SHOP_ICONS = ("gem", "ticket", "gold", "scroll", "gift", "chest", "cart", "crown", "moon", "sprout")
REWARD_MAX = {"gems": 10_000_000, "tickets": 10_000_000, "gold": 1_000_000_000, "scrolls": 10_000}


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _check_int(r, where, field, v, lo, hi, required=False):
    if v is None:
        if required:
            r.error(where, f"{field}가 비어 있어요")
        return
    if not _is_int(v) or not lo <= v <= hi:
        r.error(where, f"{field}는 {lo:,}~{hi:,} 사이의 정수여야 해요: {v!r}")


def _check_rewards(r, where, field, rw, need_any=True):
    if not isinstance(rw, dict):
        r.error(where, f"{field}는 객체여야 해요")
        return
    for k, v in rw.items():
        if k not in REWARD_MAX:
            r.warn(where, f"{field}.{k}는 게임이 모르는 보상이에요 (무시됨)")
            continue
        _check_int(r, where, f"{field}.{k}", v, 0, REWARD_MAX[k])
    if need_any and not any(_is_int(rw.get(k)) and rw.get(k) > 0 for k in REWARD_MAX):
        r.warn(where, f"{field}에 받을 것이 하나도 없어요")


def check_shop(r, shop, asset_exists):
    if not isinstance(shop, dict):
        r.error("shop", "객체 형식이어야 해요")
        return
    seen = set()
    for tab in ("gold", "cash"):
        items = shop.get(tab)
        if items is None:
            continue
        for it in _check_ids(r, f"shop.{tab}", items):
            where = f"shop.{tab}/{it['id']}"
            if it["id"] in seen:
                r.error(where, "골드 상점과 캐시 상점 사이에 id가 중복돼요 (구매 기록이 섞여요)")
            seen.add(it["id"])
            name = str(it.get("name") or "").strip()
            if not name:
                r.error(where, "이름(name)이 비어 있어요")
            elif len(name) > 40:
                r.warn(where, "이름이 40자를 넘어서 잘려요")
            if len(str(it.get("desc") or "")) > 200:
                r.warn(where, "설명이 200자를 넘어서 잘려요")
            if it.get("icon") not in SHOP_ICONS:
                r.warn(where, f"icon은 {', '.join(SHOP_ICONS)} 중 하나여야 해요 (지금: {it.get('icon')!r} → chest로 보임)")
            _check_rewards(r, where, "rewards", it.get("rewards") or {})
            lim = it.get("limit")
            if lim is not None:
                if not isinstance(lim, dict) or lim.get("per") not in SHOP_LIMIT_PERS:
                    r.error(where, f"limit.per는 {', '.join(SHOP_LIMIT_PERS)} 중 하나여야 해요")
                else:
                    _check_int(r, where, "limit.count", lim.get("count"), 1, 9999, required=True)
            badges = it.get("badges") or []
            if not isinstance(badges, list) or len(badges) > 3 or any(not isinstance(b, str) or len(b.strip()) > 12 for b in badges):
                r.warn(where, "배지는 최대 3개, 각 12자 이내예요 (넘치면 잘림)")
            req = it.get("requires")
            if req is not None:
                if not isinstance(req, dict):
                    r.error(where, "requires는 객체여야 해요")
                else:
                    _check_int(r, where, "requires.stagesCleared", req.get("stagesCleared"), 0, 9999)
            _check_asset(r, where, "그림(image)", it.get("image"), asset_exists)
            if tab == "gold":
                cost = it.get("cost") or {}
                if not isinstance(cost, dict):
                    r.error(where, "cost는 객체여야 해요")
                else:
                    _check_int(r, where, "cost.gold", cost.get("gold", 0), 0, 1_000_000_000)
                    _check_int(r, where, "cost.gems", cost.get("gems", 0), 0, 10_000_000)
            else:
                _check_int(r, where, "priceKRW", it.get("priceKRW"), 100, 10_000_000, required=True)
                if it.get("originalKRW") is not None:
                    _check_int(r, where, "originalKRW", it.get("originalKRW"), 0, 100_000_000)
                if it.get("category") not in SHOP_CATEGORIES:
                    r.error(where, f"category는 {', '.join(SHOP_CATEGORIES)} 중 하나여야 해요")
                if it.get("tier") not in SHOP_TIERS:
                    r.warn(where, f"tier는 {', '.join(SHOP_TIERS)} 중 하나여야 해요 (지금은 normal로 보임)")
                if len(str(it.get("value") or "")) > 10:
                    r.warn(where, "가치 문구(value)가 10자를 넘어서 잘려요")
                if it.get("firstBonus"):
                    _check_rewards(r, where, "firstBonus", it["firstBonus"], need_any=False)
                p = it.get("pass")
                if p is not None:
                    if not isinstance(p, dict):
                        r.error(where, "pass는 객체여야 해요")
                    else:
                        _check_int(r, where, "pass.days", p.get("days"), 1, 365, required=True)
                        _check_int(r, where, "pass.dailyGems", p.get("dailyGems"), 1, 100000, required=True)
                        _check_int(r, where, "pass.maxDays", p.get("maxDays"), 1, 3650, required=True)
    vip = shop.get("vip") or []
    if not isinstance(vip, list) or any(not _is_int(v) or v <= 0 for v in vip):
        r.error("shop.vip", "VIP 단계는 1 이상의 정수 목록이어야 해요")
    elif vip != sorted(vip):
        r.warn("shop.vip", "VIP 단계는 작은 금액부터 순서대로 적어 주세요 (게임에서 정렬됨)")


def validate(content, asset_exists, held=None):
    """content: {characters, banners, storyIndex, notices, mail, enemies, stages, balance, ui, stories: {id: body}}
    held: 이번 배포에서 보류된 항목 id 집합 (참조 오류 메시지를 친절하게 하기 위해)
    """
    held = held or {}
    r = Report()
    try:
        vocab = kit.load_vocab()
    except (OSError, ValueError) as e:
        r.error("js/battle/vocab.json", f"전투 용어집을 읽지 못했어요: {e}")
        vocab = None

    # ── 캐릭터 ──
    chars = _check_ids(r, "characters", content.get("characters"))
    char_ids = {c["id"] for c in chars}
    npc_ids = {c["id"] for c in chars if rarity.is_npc(c)}
    released_at = {}
    gone = deleted_ids("characters")
    for c in chars:
        where = f"characters/{c['id']}"
        if c["id"] in gone:
            r.error(where, "예전에 삭제한 캐릭터의 id예요. 그 캐릭터를 가졌던 플레이어 세이브에 기록이 남아 있어서 새 캐릭터에 그대로 붙어요 → 다른 id로 바꿔 주세요 (dev/deleted_ids.json)")
        if not str(c.get("name") or "").strip():
            r.error(where, "이름(name)이 비어 있어요")
        grade = rarity.grade_of(c)
        if grade is None:
            r.error(where, f"등급(rarity)은 1~5 또는 'npc'여야 해요: {c.get('rarity')!r}")
        elif "pullable" in c:
            r.warn(where, f"pullable은 예전 방식이에요 → 등급 {rarity.label(grade)}로 읽어요 (캐릭터 탭에서 저장하면 정리돼요)")
        elif not (isinstance(c.get("rarity"), int) or c.get("rarity") == rarity.NPC):
            r.warn(where, f"등급이 예전 형식이에요 ({c.get('rarity')!r} → {rarity.label(grade)}). 저장하면 바뀌어요")
        # NPC 등급은 그림이 없어도 경고하지 않음 (스토리에서 이름만 나와도 됨)
        _check_asset(r, where, "image", c.get("image"), asset_exists, required=grade != rarity.NPC)
        released_at[c["id"]] = _check_date(r, where, "addedAt", c.get("addedAt"))
        if not c.get("addedAt"):
            r.warn(where, "addedAt(추가 시각)이 없어요")
        if vocab and c["id"] not in npc_ids:  # NPC는 동료로 싸우지 않음 (적으로 나올 때는 적 데이터)
            kit.check_character_battle(r, where, c, vocab)

    # ── 적 / 스테이지 ──
    enemies = _check_ids(r, "enemies", content.get("enemies") or [])
    enemy_ids = {e["id"] for e in enemies}
    for e in enemies:
        where = f"enemies/{e['id']}"
        if not str(e.get("name") or "").strip():
            r.error(where, "이름(name)이 비어 있어요")
        link = e.get("charId")
        if link:
            if link not in char_ids:
                r.error(where, f"연결된 NPC 캐릭터가 없어요: {link!r}")
            elif link not in npc_ids:
                r.warn(where, f"연결된 캐릭터 '{link}'가 NPC 등급이 아니에요 (뽑을 수 있는 캐릭터가 적으로도 나와요)")
            if link in char_ids and e.get("image"):
                r.warn(where, "연결된 NPC 그림 대신 적 전용 그림을 써요 — NPC 그림을 다시 뽑아도 전투에는 반영 안 됨 (의도한 게 아니면 적 탭에서 'NPC 그림으로 되돌리기')")
        # 그림이 없어도 연결된 NPC 그림이 있으면 그걸 씀
        linked_image = next((c.get("image") for c in chars if c["id"] == link), "") if link else ""
        _check_asset(r, where, "image", e.get("image") or linked_image, asset_exists)
        if vocab:
            kit.check_enemy_battle(r, where, e, vocab)
    _check_memories(r, content, chars, npc_ids, asset_exists, vocab)
    stages = _check_ids(r, "stages", content.get("stages") or [])
    stage_ids = {s["id"] for s in stages}
    for st in stages:
        where = f"stages/{st['id']}"
        if not str(st.get("name") or "").strip():
            r.warn(where, "이름(name)이 비어 있어요")
        if st.get("difficulty") is not None and (not kit._is_num(st["difficulty"]) or not 0.05 <= st["difficulty"] <= 20):
            r.error(where, f"difficulty(난이도 배율)는 0.05~20 숫자여야 해요: {st.get('difficulty')!r}")
        if st.get("stageType") not in (None, "normal", "elite", "boss"):
            r.error(where, f"stageType은 normal / elite / boss 중 하나: {st.get('stageType')!r}")
        waves = st.get("waves")
        if not isinstance(waves, list) or not waves:
            r.error(where, "웨이브(waves)가 비어 있어요")
            waves = []
        for wi, wave in enumerate(waves):
            if not isinstance(wave, list) or not wave:
                r.error(f"{where}/웨이브{wi + 1}", "적이 없어요")
                continue
            if len(wave) > 6:
                r.error(f"{where}/웨이브{wi + 1}", f"한 웨이브는 적 6명까지예요 ({len(wave)}명)")
            for ei, en in enumerate(wave):
                ew = f"{where}/웨이브{wi + 1}/{ei + 1}"
                eid = (en or {}).get("enemyId")
                if eid not in enemy_ids:
                    r.error(ew, f"알 수 없는 적 id: {eid!r}")
                lv = (en or {}).get("level")
                if lv is not None and (not isinstance(lv, int) or isinstance(lv, bool) or lv < 1):
                    r.error(ew, f"level은 비우거나(추천 전투력으로 계산) 1 이상의 정수여야 해요: {lv!r}")
        if "turnLimit" in st:
            r.warn(where, "turnLimit은 예전 이름이에요 → roundLimit")
        tl = st.get("roundLimit", st.get("turnLimit"))
        if tl is not None and not (isinstance(tl, int) and 1 <= tl <= 999):
            r.error(where, f"roundLimit은 비우거나 1~999 정수여야 해요: {tl!r}")
        if not st.get("storyId"):
            r.error(where, "storyId가 없어요 (모험: 스테이지 1개 = 스토리 1개 + 전투 1개)")
        if not st.get("chapter"):
            r.warn(where, "chapter가 없어서 ch01에 넣어요")
        for key in ("rewards", "firstClearRewards"):
            for cur, v in (st.get(key) or {}).items():
                if cur not in ("tickets", "gems", "gold", "scrolls"):
                    r.warn(where, f"{key}에 모르는 보상 '{cur}' (무시됨)")
                elif not isinstance(v, int) or v < 0:
                    r.error(where, f"{key}.{cur}는 0 이상의 정수여야 해요")
        rp = st.get("recommendedPower", 0)
        if not isinstance(rp, int) or rp < 0:
            r.error(where, "recommendedPower는 0 이상의 정수여야 해요")
    used_stages = set()

    def char_ref(where, cid, what="캐릭터"):
        if cid in char_ids:
            return True
        if cid in held.get("characters", ()):
            r.error(where, f"{what} '{cid}'는 이번 배포에서 보류됐어요 (공개 시각이 기준보다 늦음)")
        else:
            r.error(where, f"알 수 없는 {what} id: {cid!r}")
        return False

    # ── 스토리 목록 ──
    index = _check_ids(r, "stories/index", content.get("storyIndex"))
    story_ids = {s["id"] for s in index}
    groups = {}
    for s in index:
        where = f"stories/index/{s['id']}"
        if s.get("kind") not in STORY_KINDS:
            r.error(where, f"kind는 main/character/event 중 하나여야 해요: {s.get('kind')!r}")
        ch = s.get("chapter")
        if not isinstance(ch, int) or ch < 1:
            r.error(where, f"chapter는 1 이상의 정수여야 해요: {ch!r}")
        if not str(s.get("title") or "").strip():
            r.warn(where, "제목(title)이 비어 있어요")
        if s.get("kind") == "character":
            if not s.get("characterId"):
                r.error(where, "캐릭터 스토리는 characterId가 필요해요")
            else:
                char_ref(where, s["characterId"])
        gems = (s.get("reward") or {}).get("gems", 0)
        if not isinstance(gems, int) or gems < 0:
            r.error(where, "reward.gems는 0 이상의 정수여야 해요")
        unlock = s.get("unlock") or []
        if isinstance(unlock, dict):
            unlock = [unlock]
        if not isinstance(unlock, list):
            r.error(where, "unlock은 조건 목록이어야 해요")
            unlock = []
        has_period = False
        for cond in unlock:
            t = (cond or {}).get("type")
            if t == "prevChapter":
                continue
            if t == "ownsCharacter":
                if char_ref(where, cond.get("characterId"), "해금 조건 캐릭터") and cond.get("characterId") in npc_ids:
                    r.error(where, f"해금 조건 캐릭터 '{cond.get('characterId')}'는 NPC 등급이라 가질 수 없어요 (게임에서 이 스토리가 숨겨져요)")
            elif t == "period":
                has_period = True
                a = _check_date(r, where, "unlock.startAt", cond.get("startAt"))
                b = _check_date(r, where, "unlock.endAt", cond.get("endAt"))
                if a and b and a >= b:
                    r.error(where, "해금 기간의 시작이 끝보다 늦어요")
            elif t != "none":
                r.error(where, f"알 수 없는 해금 조건: {t!r}")
        if s.get("kind") == "event" and not has_period:
            r.warn(where, "이벤트 스토리에 기간(period) 조건이 없어요 (계속 공개됨)")
        key = (s.get("kind"), s.get("characterId") if s.get("kind") == "character" else None)
        groups.setdefault(key, []).append(s)
        if s["id"] not in (content.get("stories") or {}):
            r.error(where, f"스토리 본문 파일이 없어요: data/stories/{s['id']}.json")
    for (kind, cid), items in groups.items():
        chapters = [x.get("chapter") for x in items]
        dup = {c for c in chapters if chapters.count(c) > 1}
        if dup:
            r.warn(f"stories/index ({kind}{'/' + cid if cid else ''})", f"같은 장 번호가 여러 개예요: {sorted(dup)}")

    # ── 스토리 본문 ──
    for sid, body in (content.get("stories") or {}).items():
        where = f"stories/{sid}"
        if sid not in story_ids:
            r.warn(where, "목록(index.json)에 없는 스토리 파일이에요 (배포에서 제외)")
            continue
        if not isinstance(body, dict) or not isinstance(body.get("scenes"), list) or not body["scenes"]:
            r.error(where, "scenes가 비어 있거나 형식이 잘못됐어요")
            continue
        scene_ids = []
        for i, sc in enumerate(body["scenes"]):
            sc_id = sc.get("id") if isinstance(sc, dict) else None
            if not valid_id(sc_id):
                r.error(f"{where}/장면{i + 1}", f"장면 id가 올바르지 않아요: {sc_id!r}")
            scene_ids.append(sc_id)
        if len(set(scene_ids)) != len(scene_ids):
            r.error(where, "장면 id가 중복돼요")
        targets = set(scene_ids) | {"end"}
        total_lines = 0
        for i, sc in enumerate(body["scenes"]):
            if not isinstance(sc, dict):
                continue
            swhere = f"{where}/{sc.get('id') or i + 1}"
            if sc.get("type") == "battle":
                sid_ = sc.get("stageId")
                if sid_ not in stage_ids:
                    r.error(swhere, f"전투 장면의 스테이지가 없어요: {sid_!r}")
                else:
                    used_stages.add(sid_)
                if sc.get("next") and sc["next"] not in targets:
                    r.error(swhere, f"next가 가리키는 장면이 없어요: {sc['next']!r}")
                continue
            elif sc.get("type") not in (None, "dialogue"):
                r.error(swhere, f"알 수 없는 장면 종류: {sc.get('type')!r}")
            bg = sc.get("background") or {}
            if bg.get("type") == "image" and bg.get("color") and isinstance(bg.get("value"), str) and bg["value"].startswith("assets/") and not asset_exists(bg["value"]):
                r.warn(swhere, f"배경 그림이 아직 없어요 ({bg['value']}) — 색 {bg['color']}으로 보여요. 일괄 생성 탭의 '스토리 배경'으로 만들 수 있어요")
            elif bg.get("type") == "image":
                _check_asset(r, swhere, "배경 이미지", bg.get("value"), asset_exists)
            elif bg.get("type") == "color":
                if not HEX_RE.match(str(bg.get("value") or "")):
                    r.error(swhere, f"배경 색 형식이 잘못됐어요: {bg.get('value')!r} (예: #1b1440)")
            else:
                r.error(swhere, "background.type은 image 또는 color여야 해요")
            if sc.get("next") and sc["next"] not in targets:
                r.error(swhere, f"next가 가리키는 장면이 없어요: {sc['next']!r}")
            lines = sc.get("lines")
            if not isinstance(lines, list):
                r.error(swhere, "lines가 목록이 아니에요")
                continue
            for j, ln in enumerate(lines):
                lwhere = f"{swhere}/대사{j + 1}"
                if not isinstance(ln, dict):
                    r.error(lwhere, "대사가 객체가 아니에요")
                    continue
                total_lines += 1
                sp = ln.get("speaker", "narrator")
                if sp != "narrator":
                    char_ref(lwhere, sp, "화자")
                if not str(ln.get("text") or "").strip():
                    r.warn(lwhere, "대사가 비어 있어요")
                for k, ch in enumerate(ln.get("choices") or []):
                    if not str((ch or {}).get("text") or "").strip():
                        r.error(lwhere, f"선택지 {k + 1}의 문구가 비어 있어요")
                    goto = (ch or {}).get("goto")
                    if goto and goto not in targets:
                        r.error(lwhere, f"선택지 {k + 1}의 이동 장면이 없어요: {goto!r}")
        if total_lines == 0:
            r.error(where, "대사가 하나도 없어요")

    # ── 배너 ──
    banners = _check_ids(r, "banners", content.get("banners"))
    for b in banners:
        where = f"banners/{b['id']}"
        if b.get("type") not in ("standard", "pickup"):
            r.error(where, f"type은 standard 또는 pickup이어야 해요: {b.get('type')!r}")
        if not str(b.get("title") or "").strip():
            r.error(where, "제목(title)이 비어 있어요")
        start = _check_date(r, where, "startAt", b.get("startAt"))
        end = _check_date(r, where, "endAt", b.get("endAt"))
        if start and end and start >= end:
            r.error(where, "시작 시각이 종료 시각보다 늦어요")
        rot = b.get("rotation")
        cat = b.get("category", "character")
        if cat not in ("character", "memory"):
            r.error(where, f"category는 character 또는 memory여야 해요: {cat!r}")
        if cat == "memory":
            # 추억 뽑기: 픽업은 추억 id, 또는 pickupFrom(캐릭터 픽업 배너 → 그 픽업 캐릭터의 전용 추억)
            mem_ids = {m.get("id") for m in content.get("memories") or [] if isinstance(m, dict)}
            if isinstance(rot, dict):
                r.error(where, "추억 배너는 자동 로테이션을 쓸 수 없어요 (pickupFrom으로 캐릭터 로테이션을 따라가세요)")
            if b.get("type") == "pickup":
                src = b.get("pickupFrom")
                if src:
                    if src not in {x.get("id") for x in banners}:
                        r.error(where, f"pickupFrom의 배너가 없어요: {src!r}")
                elif not b.get("pickupIds"):
                    r.error(where, "추억 픽업 배너인데 픽업 추억도 pickupFrom도 없어요")
                for mid in b.get("pickupIds") or []:
                    if mid not in mem_ids:
                        r.error(where, f"픽업 추억이 없어요: {mid!r}")
            if not mem_ids:
                r.error(where, "추억 배너가 있는데 추억 데이터가 없어요")
            _check_asset(r, where, "bannerImage", b.get("bannerImage"), asset_exists)
            continue
        if b.get("type") == "pickup" and isinstance(rot, dict):
            # 자동 로테이션 픽업: 대상은 실행할 때 정해짐
            rot_rarity = rarity.normalize(rot.get("rarity"))
            if rot_rarity is None:
                r.error(where, f"rotation.rarity는 1~5 중 하나여야 해요: {rot.get('rarity')!r}")
            for key, lo, hi in (("count", 1, 4), ("days", 1, 60)):
                v = rot.get(key)
                if not isinstance(v, int) or not lo <= v <= hi:
                    r.error(where, f"rotation.{key}는 {lo}~{hi} 정수여야 해요: {v!r}")
            _check_date(r, where, "rotation.anchor", rot.get("anchor"), required=True)
            pool = [c for c in chars if rarity.grade_of(c) == rot_rarity and rarity.gachable(c)]
            if not pool:
                r.warn(where, f"로테이션할 {rarity.label(rot_rarity)} 캐릭터가 없어요 (그동안 배너가 숨겨져요)")
            elif len(pool) < (rot.get("count") or 0):
                r.warn(where, f"{rarity.label(rot_rarity)} 캐릭터가 {len(pool)}명뿐이라 매번 같은 픽업이에요")
        elif b.get("type") == "pickup":
            ids = b.get("pickupIds") or []
            if not ids:
                r.error(where, "픽업 배너인데 픽업 캐릭터가 없어요")
            if not end:
                r.warn(where, "픽업 배너에 종료 시각이 없어요")
            for cid in ids:
                if char_ref(where, cid, "픽업 캐릭터"):
                    if cid in npc_ids:
                        r.error(where, f"픽업 캐릭터 '{cid}'는 NPC 등급이라 뽑기에 안 나와요 → 픽업에서 빼거나 등급을 1~5로 바꿔 주세요")
                    rel = released_at.get(cid)
                    if rel and start and rel > start:
                        r.warn(where, f"픽업 캐릭터 '{cid}'의 공개 시각(addedAt)이 배너 시작보다 늦어요")
        _check_asset(r, where, "bannerImage", b.get("bannerImage"), asset_exists)
        rel_story = b.get("relatedStoryId")
        if rel_story and rel_story not in story_ids:
            if rel_story in held.get("stories", ()):
                r.error(where, f"관련 스토리 '{rel_story}'는 이번 배포에서 보류됐어요")
            else:
                r.error(where, f"관련 스토리가 없어요: {rel_story!r}")

    # ── 공지 / 우편 ──
    for n in _check_ids(r, "notices", content.get("notices")):
        where = f"notices/{n['id']}"
        if not str(n.get("title") or "").strip():
            r.error(where, "제목이 비어 있어요")
        _check_date(r, where, "date", n.get("date"), required=True)
    for m in _check_ids(r, "mail", content.get("mail")):
        where = f"mail/{m['id']}"
        if not str(m.get("title") or "").strip():
            r.error(where, "제목이 비어 있어요")
        for cur in ("gems", "tickets", "gold", "scrolls"):
            v = (m.get("rewards") or {}).get(cur, 0)
            if not isinstance(v, int) or v < 0:
                r.error(where, f"rewards.{cur}는 0 이상의 정수여야 해요")
        a = _check_date(r, where, "startAt", m.get("startAt"))
        b = _check_date(r, where, "endAt", m.get("endAt"))
        if a and b and a >= b:
            r.error(where, "시작 시각이 종료 시각보다 늦어요")
        if not m.get("endAt"):
            r.warn(where, "종료 시각이 없어요 (계속 받을 수 있음 — 한 번만 받을 수 있으니 문제는 없음)")

    for st in stages:
        if st["id"] not in used_stages:
            r.warn(f"stages/{st['id']}", "어느 스토리에도 쓰이지 않는 스테이지예요 (게임에서 싸울 수 없음)")
    _check_adventure(r, stages, index, content.get("stories") or {})

    # ── 밸런스 ──
    bal = content.get("balance")
    if bal is not None:
        if not isinstance(bal, dict):
            r.error("balance", "객체 형식이어야 해요")
        else:
            _check_balance(r, bal)
            if vocab and bal.get("defaultKit") is not None:
                kit.check_kit(r, "balance.defaultKit", bal["defaultKit"], vocab)

    # ── UI 에셋 (화면 배경 / 아이콘) ──
    from .uislots import SLOT_BY_KEY

    ui = content.get("ui") or {}
    for group in ("backgrounds", "icons"):
        items = ui.get(group) or {}
        if not isinstance(items, dict):
            r.error(f"ui/{group}", "객체 형식이어야 해요")
            continue
        for name, path in items.items():
            where = f"ui/{group}.{name}"
            if f"{group}.{name}" not in SLOT_BY_KEY:
                r.warn(where, "게임이 사용하지 않는 칸이에요")
            _check_asset(r, where, "그림", path, asset_exists)

    # ── 상점 ──
    if content.get("shop") is not None:
        check_shop(r, content["shop"], asset_exists)

    return r


MEMORY_KINDS = ("default", "generic", "signature")


def _check_memories(r, content, chars, npc_ids, asset_exists, vocab):
    """추억 카드: 3~5★, 부옵션 능력치, 패시브(일반 + 주인 보너스), 5★ 캐릭터마다 전용 추억 정확히 1장"""
    mems = _check_ids(r, "memories", content.get("memories") or [])
    char_by = {c["id"]: c for c in chars}
    sig_of = {}
    defaults = {}
    for m in mems:
        where = f"memories/{m['id']}"
        if not str(m.get("name") or "").strip():
            r.error(where, "이름(name)이 비어 있어요")
        if m.get("rarity") not in (3, 4, 5):
            r.error(where, f"추억 희귀도는 3~5여야 해요: {m.get('rarity')!r}")
        kind = m.get("kind", "generic")
        if kind not in MEMORY_KINDS:
            r.error(where, f"kind는 {', '.join(MEMORY_KINDS)} 중 하나: {kind!r}")
        if kind == "default":
            if m.get("role") not in kit.CHAR_ROLES:
                r.error(where, f"역할 기본 추억은 role이 필요해요 ({', '.join(kit.CHAR_ROLES)})")
            elif m.get("role") in defaults:
                r.error(where, f"역할 {m['role']}의 기본 추억이 둘이에요 ({defaults[m['role']]})")
            else:
                defaults[m["role"]] = m["id"]
        for key in ("signatureOf", "featuredCharacterId"):
            cid = m.get(key)
            if cid and cid not in char_by:
                r.error(where, f"{key}의 캐릭터가 없어요: {cid!r}")
            elif cid and cid in npc_ids and key == "signatureOf":
                r.error(where, f"NPC 등급 캐릭터({cid})는 전용 추억을 가질 수 없어요")
        if kind == "signature":
            cid = m.get("signatureOf")
            if not cid:
                r.error(where, "전용 추억은 signatureOf(주인 캐릭터 id)가 필요해요")
            else:
                if rarity.grade_of(char_by.get(cid, {})) != 5:
                    r.warn(where, f"전용 추억의 주인({cid})이 5★가 아니에요")
                sig_of.setdefault(cid, []).append(m["id"])
        sec = (m.get("secondary") or {}).get("stat")
        if sec not in kit.STAT_LIMITS:
            r.error(where, f"부옵션(secondary.stat) 능력치를 알 수 없어요: {sec!r}")
        passive = m.get("passive") or {}
        if not isinstance(passive, dict) or not passive.get("generic"):
            r.error(where, "passive.generic(누가 장착해도 켜지는 능력)이 필요해요")
        elif vocab:
            kit.check_passive(r, f"{where}.passive.generic", passive["generic"], vocab)
            if passive.get("owner"):
                kit.check_passive(r, f"{where}.passive.owner", passive["owner"], vocab)
        for key in ("image", "thumb"):
            if m.get(key):
                _check_asset(r, where, key, m[key], asset_exists)
        _check_date(r, where, "addedAt", m.get("addedAt"))
    for cid, ids in sig_of.items():
        if len(ids) > 1:
            r.error(f"memories", f"{cid}의 전용 추억이 {len(ids)}장이에요 ({', '.join(ids)}) — 5★ 캐릭터마다 정확히 1장")
    for c in chars:
        if c["id"] not in npc_ids and rarity.grade_of(c) == 5 and not c.get("retired") and c["id"] not in sig_of and mems:
            r.warn(f"characters/{c['id']}", "5★인데 전용 추억이 없어요 (추억 탭 → 전용 추억 만들기)")
    for role in kit.CHAR_ROLES:
        if mems and role not in defaults:
            r.warn("memories", f"역할 {role}의 기본 추억(kind: default)이 없어요 — 새 캐릭터에게 지급할 추억이 없음")


def _check_balance(r, bal):
    """balance.json 숫자 검사 (형식: js/config.js DEFAULTS와 같음)"""
    def nums(where, group, lo=0):
        if group is None:
            return
        if not isinstance(group, dict):
            r.error("balance", f"{where}는 객체여야 해요")
            return
        for k, v in group.items():
            if isinstance(v, dict):
                nums(f"{where}.{k}", v, lo)
            elif isinstance(v, list):
                for i, x in enumerate(v):
                    if isinstance(x, dict):
                        nums(f"{where}.{k}[{i}]", x, lo)
                    elif not kit._is_num(x) or x < lo:
                        r.error("balance", f"{where}.{k}[{i}]는 {lo} 이상의 숫자여야 해요: {x!r}")
            elif not kit._is_num(v) or v < lo:
                r.error("balance", f"{where}.{k}는 {lo} 이상의 숫자여야 해요: {v!r}")

    legacy = [k for k in ("rarityStats", "levelCost", "essenceTickets", "energy", "dailyTickets") if k in bal]
    if legacy:
        r.warn("balance", f"예전 형식의 키가 있어요 ({', '.join(legacy)}). 게임은 읽을 수 있지만 밸런스 탭에서 다시 저장하면 새 형식으로 바뀌어요")
    for group in ("gacha", "level", "essence", "daily", "power", "combat", "kitBudget", "memory", "memoryGacha", "gear", "stars", "repeat", "enemy", "expected", "tuner"):
        nums(group, bal.get(group))
    # 돌파 능력치 노드: {역할: [{stat, pct} × 4]} (돌파 1·3·4·5)
    nodes = (bal.get("breakthrough") or {}).get("statNodes")
    if nodes is not None:
        if not isinstance(nodes, dict):
            r.error("balance", "breakthrough.statNodes는 {역할: [...]} 객체여야 해요")
        else:
            for role, lst in nodes.items():
                if role not in kit.CHAR_ROLES:
                    r.error("balance", f"breakthrough.statNodes: 알 수 없는 역할 {role!r}")
                    continue
                if not isinstance(lst, list) or len(lst) != 4:
                    r.error("balance", f"breakthrough.statNodes.{role}는 노드 4개(돌파 1·3·4·5) 목록이어야 해요")
                    continue
                for i, n in enumerate(lst):
                    if not isinstance(n, dict) or n.get("stat") not in kit.STAT_LIMITS or not kit._is_num(n.get("pct")) or n["pct"] < 0:
                        r.error("balance", f"breakthrough.statNodes.{role}[{i}]: {{stat: 능력치 이름, pct: 0 이상}}이어야 해요")
    nums("breakthrough.lowRarityBoost", (bal.get("breakthrough") or {}).get("lowRarityBoost"))
    mg = (bal.get("memoryGacha") or {}).get("rates")
    if isinstance(mg, dict) and set(mg) - {"3", "4", "5"}:
        r.error("balance", "memoryGacha.rates의 키는 3~5여야 해요 (추억은 3★~5★)")
    stats = bal.get("stats")
    if isinstance(stats, dict):
        for key in ("growth", "critRate", "critDmg"):
            if key in stats and (not kit._is_num(stats[key]) or stats[key] < 0):
                r.error("balance", f"stats.{key}는 0 이상의 숫자여야 해요")
        for rar, st in (stats.get("byRarity") or {}).items():
            if rarity.normalize(rar) is None:
                r.error("balance", f"stats.byRarity의 키는 1~5여야 해요: {rar!r}")
            kit.check_stats(r, f"balance.stats.byRarity.{rar}", st)
    rates = (bal.get("gacha") or {}).get("rates")
    if isinstance(rates, dict):
        if set(rates) - {"1", "2", "3", "4", "5"}:
            r.error("balance", "gacha.rates의 키는 1~5여야 해요")
        total = sum(v for v in rates.values() if kit._is_num(v))
        if abs(total - 100) > 0.001:
            r.warn("balance", f"gacha.rates 합계가 100이 아니에요 ({total}). 비율로 계산돼요")
    if "powerWarnPct" in bal and not kit._is_num(bal["powerWarnPct"]):
        r.error("balance", "powerWarnPct는 숫자여야 해요")


def _check_adventure(r, stages, index, stories):
    """모험 규칙 (게임 js/systems/adventure.js adventureIssues와 같음):
    스테이지 1개 = 메인 스토리 1개(storyId) = 그 스토리 안의 전투 장면 1개"""
    story_ids = {s.get("id"): s for s in index if isinstance(s, dict)}
    by_stage = {st["id"]: st for st in stages}
    used = {}
    for st in stages:
        if st.get("retired"):
            continue
        sid = st.get("storyId")
        where = f"stages/{st['id']}"
        if not sid:
            continue  # storyId 없음은 위에서 오류
        if sid not in story_ids:
            r.error(where, f"storyId의 스토리가 없어요: {sid!r}")
        elif sid in used:
            r.error(where, f"스토리 {sid}를 {used[sid]}도 쓰고 있어요 (스토리 1개 = 스테이지 1개)")
        else:
            used[sid] = st["id"]
    for s in index:
        if not isinstance(s, dict) or s.get("kind") != "main":
            continue
        body = stories.get(s.get("id"))
        if not isinstance(body, dict):
            continue
        where = f"stories/{s['id']}"
        scenes = [sc for sc in body.get("scenes") or [] if isinstance(sc, dict)]
        battles = [sc for sc in scenes if sc.get("type") == "battle"]
        if len(battles) != 1:
            r.error(where, f"메인 스토리에는 전투 장면이 정확히 1개 있어야 해요 (지금 {len(battles)}개)")
            continue
        st = by_stage.get(battles[0].get("stageId"))
        if st and st.get("storyId") != s["id"]:
            r.error(where, f"전투 스테이지 {st['id']}의 storyId가 {st.get('storyId')!r}예요 → '{s['id']}'로 맞춰 주세요")
        # 선택지가 전투 장면을 건너뛰면 안 됨
        ids = [sc.get("id") for sc in scenes]
        b = scenes.index(battles[0])
        for i, sc in enumerate(scenes):
            for line in sc.get("lines") or []:
                for c in (line or {}).get("choices") or []:
                    to = ids.index(c.get("goto")) if c.get("goto") in ids else -1
                    if i < b < to:
                        r.error(f"{where}/{sc.get('id')}", f"선택지 '{c.get('text', '')[:20]}'가 전투 장면을 건너뛰어요 (→ {c.get('goto')})")

