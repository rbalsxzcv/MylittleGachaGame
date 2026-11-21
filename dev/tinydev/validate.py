"""콘텐츠 검사: 알 수 없는 캐릭터 id, 없는 이미지, 날짜 형식/범위, 잘못된 참조 등.

결과는 [{level: 'error'|'warning', where: '파일/항목', message: '설명'}] 목록.
error가 하나라도 있으면 배포할 수 없습니다.
"""
import re

from . import kit
from .store import valid_id
from .timeutil import parse

RARITIES = ("R", "SR", "SSR")
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


def _check_ids(r, label, items):
    """목록 공통: 배열인지, 각 항목에 올바른 id가 있고 중복이 없는지"""
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
    released_at = {}
    for c in chars:
        where = f"characters/{c['id']}"
        if not str(c.get("name") or "").strip():
            r.error(where, "이름(name)이 비어 있어요")
        if c.get("rarity") not in RARITIES:
            r.error(where, f"희귀도(rarity)는 R/SR/SSR 중 하나여야 해요: {c.get('rarity')!r}")
        # 스토리 전용 인물(pullable: false)은 그림이 없어도 경고하지 않음
        _check_asset(r, where, "image", c.get("image"), asset_exists, required=c.get("pullable") is not False)
        released_at[c["id"]] = _check_date(r, where, "addedAt", c.get("addedAt"))
        if not c.get("addedAt"):
            r.warn(where, "addedAt(추가 시각)이 없어요")
        if vocab:
            kit.check_character_battle(r, where, c, vocab)

    # ── 적 / 스테이지 ──
    enemies = _check_ids(r, "enemies", content.get("enemies") or [])
    enemy_ids = {e["id"] for e in enemies}
    for e in enemies:
        where = f"enemies/{e['id']}"
        if not str(e.get("name") or "").strip():
            r.error(where, "이름(name)이 비어 있어요")
        _check_asset(r, where, "image", e.get("image"), asset_exists)
        if vocab:
            kit.check_enemy_battle(r, where, e, vocab)
    stages = _check_ids(r, "stages", content.get("stages") or [])
    stage_ids = {s["id"] for s in stages}
    for st in stages:
        where = f"stages/{st['id']}"
        if not str(st.get("name") or "").strip():
            r.warn(where, "이름(name)이 비어 있어요")
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
                if not isinstance(lv, int) or isinstance(lv, bool) or lv < 1:
                    r.error(ew, f"level은 1 이상의 정수여야 해요: {lv!r}")
        tl = st.get("turnLimit")
        if tl is not None and not (isinstance(tl, int) and 1 <= tl <= 999):
            r.error(where, f"turnLimit은 비우거나 1~999 정수여야 해요: {tl!r}")
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
                char_ref(where, cond.get("characterId"), "해금 조건 캐릭터")
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
        if b.get("type") == "pickup" and isinstance(rot, dict):
            # 자동 로테이션 픽업: 대상은 실행할 때 정해짐
            if rot.get("rarity") not in RARITIES:
                r.error(where, f"rotation.rarity는 R/SR/SSR 중 하나여야 해요: {rot.get('rarity')!r}")
            for key, lo, hi in (("count", 1, 4), ("days", 1, 60)):
                v = rot.get(key)
                if not isinstance(v, int) or not lo <= v <= hi:
                    r.error(where, f"rotation.{key}는 {lo}~{hi} 정수여야 해요: {v!r}")
            _check_date(r, where, "rotation.anchor", rot.get("anchor"), required=True)
            pool = [c for c in chars if c.get("rarity") == rot.get("rarity") and c.get("pullable") is not False]
            if not pool:
                r.warn(where, f"로테이션할 {rot.get('rarity')} 캐릭터가 없어요 (그동안 배너가 숨겨져요)")
            elif len(pool) < (rot.get("count") or 0):
                r.warn(where, f"{rot.get('rarity')} 캐릭터가 {len(pool)}명뿐이라 매번 같은 픽업이에요")
        elif b.get("type") == "pickup":
            ids = b.get("pickupIds") or []
            if not ids:
                r.error(where, "픽업 배너인데 픽업 캐릭터가 없어요")
            if not end:
                r.warn(where, "픽업 배너에 종료 시각이 없어요")
            for cid in ids:
                if char_ref(where, cid, "픽업 캐릭터"):
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

    # ── 밸런스 ──
    bal = content.get("balance")
    if bal is not None:
        if not isinstance(bal, dict):
            r.error("balance", "객체 형식이어야 해요")
        else:
            for key in ("growth", "maxBreakthrough", "dailyTickets", "dailyGold", "levelGoldPerTicket", "powerWarnPct"):
                if key in bal and not kit._is_num(bal[key]):
                    r.error("balance", f"{key}는 숫자여야 해요")
            for group in ("levelCost", "crit", "energy", "essenceTickets", "power"):
                for k, v in (bal.get(group) or {}).items():
                    if not kit._is_num(v) or v < 0:
                        r.error("balance", f"{group}.{k}는 0 이상의 숫자여야 해요: {v!r}")
            for rar, st in (bal.get("rarityStats") or {}).items():
                kit.check_stats(r, f"balance.rarityStats.{rar}", st)
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

    return r
