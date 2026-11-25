"""배포: 작업 공간 → 공개 폴더(data/, assets/).

1) 기준 시각(cutoff)보다 늦게 시작하는 콘텐츠는 '보류' (공개 저장소에 스포일러가 올라가지 않게)
2) 검사(validate) — 오류가 있으면 배포 불가
3) 공개 파일과 비교해서 바뀐 파일 목록 + 패치노트 초안
4) 적용: 파일 쓰기 + contentVersion 올리기 + git 명령 안내
"""
import json
import shutil
import subprocess

from . import config, rarity, store, uislots, validate
from . import profile as profile_mod
from .timeutil import now_iso, parse

LIST_KEYS = ("characters", "banners", "storyIndex", "notices", "mail", "enemies", "stages", "memories")
PUBLIC_FILE = {
    "characters": "data/characters.json",
    "banners": "data/banners.json",
    "storyIndex": "data/stories/index.json",
    "notices": "data/notices.json",
    "mail": "data/mail.json",
    "enemies": "data/enemies.json",
    "stages": "data/stages/index.json",  # 실제로는 챕터 파일 여러 개 (_stage_targets)
    "memories": "data/memories.json",
}
BATTLE_FIELDS = ("role", "statTweak", "stats", "resource", "kit", "talents", "bt2", "bt6", "breakthroughs", "archetype", "kitGen")
# 개발 도구 전용 메모 (외형 키워드, 작가용 설정 — 스포일러가 있을 수 있음) → 공개 파일에는 넣지 않음
DEV_ONLY_FIELDS = {"characters": ("keywords", "lore", "appearance"), "enemies": ("keywords", "memo"), "memories": ("theme", "scene"), "stages": ("backgroundPrompt",)}


def _start_of(kind, item):
    """항목이 공개되는 시각 (보류 판정용)"""
    if kind in ("characters", "memories"):
        return item.get("addedAt")
    if kind == "banners" or kind == "mail":
        return item.get("startAt")
    if kind == "notices":
        return item.get("date")
    if kind == "storyIndex":
        unlock = item.get("unlock") or []
        if isinstance(unlock, dict):
            unlock = [unlock]
        for c in unlock:
            if isinstance(c, dict) and c.get("type") == "period":
                return c.get("startAt")
    return None


def _load_workspace():
    """작업 공간 전체 읽기. JSON 문법 오류는 따로 모음"""
    store.ensure_workspace()
    content, syntax = {}, []
    for key in LIST_KEYS:
        try:
            content[key] = store.read_list(key)
        except store.JsonError as e:
            content[key] = []
            syntax.append({"level": "error", "where": store.LIST_FILES[key], "message": str(e)})
    stories = {}
    folder = store.ws_data("stories")
    if folder.exists():
        for p in sorted(folder.glob("*.json")):
            if p.name == "index.json":
                continue
            try:
                stories[p.stem] = store.read_json(p)
            except store.JsonError as e:
                syntax.append({"level": "error", "where": f"stories/{p.name}", "message": str(e)})
    content["stories"] = stories
    try:
        content["ui"] = store.read_ui()
    except store.JsonError as e:
        content["ui"] = uislots.empty_ui()
        syntax.append({"level": "error", "where": store.UI_FILE, "message": str(e)})
    try:
        content["balance"] = store.read_balance()
    except store.JsonError as e:
        content["balance"] = {}
        syntax.append({"level": "error", "where": store.BALANCE_FILE, "message": str(e)})
    try:
        content["shop"] = store.read_shop()
    except store.JsonError as e:
        content["shop"] = store.empty_shop()
        syntax.append({"level": "error", "where": store.SHOP_FILE, "message": str(e)})
    return content, syntax


def _public_json(rel):
    try:
        return store.read_json(config.ROOT / rel, None)
    except store.JsonError:
        return "__broken__"


def _public_content():
    """지금 공개된 데이터(data/)를 _referenced_assets가 읽는 모양으로"""
    def lst(rel):
        data = _public_json(rel)
        return [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []

    index = lst(PUBLIC_FILE["storyIndex"])
    stories = {}
    for s in index:
        body = _public_json(f"data/stories/{s.get('id')}.json")
        if isinstance(body, dict):
            stories[s.get("id")] = body
    ui = _public_json(f"data/{store.UI_FILE}")
    shop = _public_json(f"data/{store.SHOP_FILE}")
    return {
        "characters": lst(PUBLIC_FILE["characters"]),
        "banners": lst(PUBLIC_FILE["banners"]),
        "enemies": lst(PUBLIC_FILE["enemies"]),
        "stages": _public_stages(),
        "stories": stories,
        "ui": ui if isinstance(ui, dict) else {},
        "shop": shop if isinstance(shop, dict) else {},
    }


def _referenced_assets(content):
    paths = set()
    for c in content["characters"]:
        if c.get("image"):
            paths.add(c["image"])
    for b in content["banners"]:
        if b.get("bannerImage"):
            paths.add(b["bannerImage"])
    for e in content.get("enemies") or []:
        if isinstance(e, dict) and e.get("image"):
            paths.add(e["image"])
    for m in content.get("memories") or []:
        for key in ("image", "thumb"):
            if isinstance(m, dict) and m.get(key):
                paths.add(m[key])
    for body in content["stories"].values():
        for sc in (body or {}).get("scenes") or []:
            bg = (sc or {}).get("background") or {}
            if bg.get("type") == "image" and bg.get("value"):
                paths.add(bg["value"])
    for st in content.get("stages") or []:
        if isinstance(st, dict) and st.get("background"):
            paths.add(st["background"])  # 스테이지 전투 배경 (assets/battle/)
    for group in uislots.GROUPS:
        paths.update(v for v in (content.get("ui", {}).get(group) or {}).values() if v)
    shop = content.get("shop") or {}
    for tab in ("gold", "cash"):
        for it in shop.get(tab) or []:
            if isinstance(it, dict) and it.get("image"):
                paths.add(it["image"])
    return {p for p in paths if isinstance(p, str) and p.startswith("assets/") and ".." not in p}


def plan(cutoff=None):
    """배포 미리 계산 (아무것도 쓰지 않음)"""
    cutoff_dt = parse(cutoff) if cutoff else None
    ws, syntax = _load_workspace()

    # ── 1) 보류 판정 ──
    out = {}
    held_items, held = [], {"characters": set(), "banners": set(), "stories": set(), "notices": set(), "mail": set()}
    held_key = {"storyIndex": "stories"}
    for key in LIST_KEYS:
        keep = []
        for item in ws[key]:
            start = parse(_start_of(key, item)) if isinstance(item, dict) else None
            if cutoff_dt and start and start > cutoff_dt:
                held[held_key.get(key, key)].add(item.get("id"))
                held_items.append({"type": key, "id": item.get("id"), "title": item.get("name") or item.get("title") or "", "startAt": _start_of(key, item)})
            else:
                keep.append(item)
        drop = DEV_ONLY_FIELDS.get(key, ())
        out[key] = [{k: v for k, v in it.items() if k not in drop} if isinstance(it, dict) else it for it in keep] if drop else keep
    index_ids = {s.get("id") for s in out["storyIndex"] if isinstance(s, dict)}
    out["stories"] = {sid: body for sid, body in ws["stories"].items() if sid in index_ids}
    out["ui"] = ws["ui"]  # UI 에셋은 기간이 없어서 보류하지 않음
    out["balance"] = ws["balance"]
    out["shop"] = ws["shop"]  # 상점도 기간이 없어서 보류하지 않음

    # ── 2) 검사 ──
    report = validate.validate(out, store.asset_exists_ws, held)
    issues = syntax + report.items
    # 말투 카드(profile.voice)는 작가용 — 검사한 뒤 공개 파일에서는 뺌 (게임이 안 씀, 약점/욕망 = 스포일러)
    out["characters"] = [profile_mod.strip_voice(c) for c in out["characters"]]

    # ── 3) 바뀐 파일 ──
    targets = {}  # 공개 경로 → ('json', 객체) | ('asset', 작업공간 경로)
    for key in LIST_KEYS:
        if key == "stages":
            targets.update(_stage_targets(out["stages"]))
        else:
            targets[PUBLIC_FILE[key]] = ("json", out[key])
    for sid, body in out["stories"].items():
        targets[f"data/stories/{sid}.json"] = ("json", body)
    targets[f"data/{store.UI_FILE}"] = ("json", out["ui"])
    targets[f"data/{store.BALANCE_FILE}"] = ("json", out["balance"])
    targets[f"data/{store.SHOP_FILE}"] = ("json", out["shop"])
    # 콘텐츠 id 별칭 (예전 id → 새 id) — 게임이 예전 세이브를 옮길 때 씀. 계속 남겨 둠
    aliases = store.read_aliases()
    if aliases or (config.PUBLIC_DATA / store.ALIASES_FILE).exists():
        targets[f"data/{store.ALIASES_FILE}"] = ("json", aliases)
    for rel in sorted(_referenced_assets(out)):
        if store.asset_exists_ws(rel):
            targets[rel] = ("asset", config.WORKSPACE / rel)

    changes = []
    for rel, (kind, value) in targets.items():
        dest = config.ROOT / rel
        if not dest.exists():
            changes.append({"file": rel, "status": "added"})
        elif kind == "json":
            if _public_json(rel) != value:
                changes.append({"file": rel, "status": "modified"})
        elif dest.read_bytes() != value.read_bytes():
            changes.append({"file": rel, "status": "modified"})
    # 예전 data/stages.json / 없어진 챕터 파일은 삭제
    if (config.PUBLIC_DATA / "stages.json").exists():
        changes.append({"file": "data/stages.json", "status": "removed"})
    pub_stage_dir = config.PUBLIC_DATA / "stages"
    if pub_stage_dir.exists():
        for p in pub_stage_dir.glob("*.json"):
            rel = f"data/stages/{p.name}"
            if rel not in targets:
                changes.append({"file": rel, "status": "removed"})
    pub_stories = config.PUBLIC_DATA / "stories"
    if pub_stories.exists():
        for p in pub_stories.glob("*.json"):
            rel = f"data/stories/{p.name}"
            if p.name != "index.json" and rel not in targets:
                changes.append({"file": rel, "status": "removed"})
    # 지금 공개 데이터가 쓰던 그림 중 새 데이터에서 아무도 안 쓰는 것 (삭제한 캐릭터/적/배너 그림) → 공개 폴더에서 삭제
    # (공개 데이터가 원래 쓰지 않던 파일 — 아이콘, 글꼴 등 — 은 건드리지 않음)
    for rel in sorted(_referenced_assets(_public_content()) - _referenced_assets(out)):
        if (config.ROOT / rel).is_file() and rel not in targets:
            changes.append({"file": rel, "status": "removed"})

    version = _public_json("data/version.json")
    current = version.get("contentVersion", 0) if isinstance(version, dict) else 0
    return {
        "cutoff": cutoff,
        "issues": issues,
        "errorCount": sum(1 for i in issues if i["level"] == "error"),
        "held": held_items,
        "changes": sorted(changes, key=lambda c: c["file"]),
        "currentVersion": current,
        "nextVersion": current + 1,
        "draftNotes": draft_notes(out),
        "_targets": targets,
    }


def _stage_targets(stages):
    """스테이지 목록 → 공개 파일들 {'data/stages/index.json': ..., 'data/stages/ch01.json': ...}"""
    ids, files = store.split_stages(stages, store.stage_chapter_titles(), list(store.stage_chapter_titles()))
    out = {"data/stages/index.json": ("json", ids)}
    for ch, payload in files.items():
        out[f"data/stages/{ch}.json"] = ("json", payload)
    return out


def _public_stages():
    """공개 스테이지 (챕터 파일 → 한 목록, 예전 stages.json도)"""
    got = store._read_stage_chapters(config.PUBLIC_DATA / "stages")
    if got:
        return got[2]
    data = _public_json("data/stages.json")
    return [{**s, "chapter": store.chapter_of(s)} for s in data if isinstance(s, dict)] if isinstance(data, list) else []


def _flatten(obj, prefix=""):
    """{'a': {'b': 1}} → {'a.b': 1} (defaultKit처럼 큰 덩어리는 통째로)"""
    out = {}
    for k, v in (obj or {}).items():
        key = f"{prefix}{k}"
        if isinstance(v, dict) and k != "defaultKit":
            out.update(_flatten(v, key + "."))
        else:
            out[key] = v
    return out


def balance_diff(old, new):
    """balance.json에서 바뀐 숫자 → ['gacha.pity 70 → 80', ...] (패치노트용)"""
    a, b = _flatten(old), _flatten(new)
    lines = []
    for key in sorted(set(a) | set(b)):
        if a.get(key) == b.get(key):
            continue
        if key == "defaultKit":
            lines.append("기본 스킬 변경")
        elif key not in a:
            lines.append(f"{key} 추가 ({b[key]})")
        elif key not in b:
            lines.append(f"{key} 삭제")
        else:
            lines.append(f"{key} {a[key]} → {b[key]}")
    return lines


def draft_notes(out):
    """공개 데이터와 비교해서 패치노트 초안 만들기"""
    notes = []

    def public_list(key):
        if key == "stages":
            return {x.get("id"): x for x in _public_stages()}
        data = _public_json(PUBLIC_FILE[key])
        return {x.get("id"): x for x in data if isinstance(x, dict)} if isinstance(data, list) else {}

    pub = {k: public_list(k) for k in LIST_KEYS}
    for c in out["characters"]:
        if c["id"] not in pub["characters"]:
            if not rarity.is_npc(c):  # NPC 등급은 패치노트에 '새 캐릭터'로 쓰지 않음
                notes.append(f"새 캐릭터: {c.get('name')} ({rarity.label(c.get('rarity'))})")
            continue
        old = pub["characters"][c["id"]]
        og, ng = rarity.grade_of(old), rarity.grade_of(c)
        if og != ng:
            if ng == rarity.NPC:
                notes.append(f"{c.get('name')}: 뽑기에서 제외 (NPC)")
            elif og == rarity.NPC:
                notes.append(f"새 캐릭터: {c.get('name')} ({rarity.label(ng)})")
            else:
                notes.append(f"등급 변경: {c.get('name')} {rarity.label(og)} → {rarity.label(ng)}")
        if any(old.get(k) != c.get(k) for k in BATTLE_FIELDS):
            notes.append(f"전투 데이터 수정: {c.get('name')}")
        if any(old.get(k) != c.get(k) for k in set(old) | set(c) if k not in BATTLE_FIELDS):
            notes.append(f"캐릭터 정보 수정: {c.get('name')}")
    for st in out["stages"]:
        if st["id"] not in pub["stages"]:
            notes.append(f"새 스테이지: {st.get('name')}")
        elif pub["stages"][st["id"]] != st:
            notes.append(f"스테이지 수정: {st.get('name')}")
    changed_enemies = [e.get("name") for e in out["enemies"] if pub["enemies"].get(e["id"]) != e]
    if changed_enemies:
        notes.append(f"적 추가/수정: {', '.join(changed_enemies)}")
    pub_bal = _public_json(f"data/{store.BALANCE_FILE}")
    if out.get("balance") and pub_bal != out["balance"]:
        diffs = balance_diff(pub_bal if isinstance(pub_bal, dict) else {}, out["balance"])
        shown = ", ".join(diffs[:6]) + (f" 외 {len(diffs) - 6}개" if len(diffs) > 6 else "")
        notes.append(f"전투/육성 밸런스 조정{': ' + shown if diffs else ''}")
    for b in out["banners"]:
        if b["id"] not in pub["banners"]:
            label = "픽업 모집" if b.get("type") == "pickup" else "모집"
            notes.append(f"{label}: {b.get('title')}")
        elif pub["banners"][b["id"]] != b:
            notes.append(f"모집 정보 수정: {b.get('title')}")
    kinds = {"main": "메인", "character": "캐릭터", "event": "이벤트"}
    for s in out["storyIndex"]:
        label = kinds.get(s.get("kind"), "")
        if s["id"] not in pub["storyIndex"]:
            notes.append(f"{label} 스토리 추가: {s.get('title')}")
        else:
            body_pub = _public_json(f"data/stories/{s['id']}.json")
            if pub["storyIndex"][s["id"]] != s or body_pub != out["stories"].get(s["id"]):
                notes.append(f"{label} 스토리 수정: {s.get('title')}")
    for n in out["notices"]:
        if n["id"] not in pub["notices"]:
            notes.append(f"공지: {n.get('title')}")
    for m in out["mail"]:
        if m["id"] not in pub["mail"]:
            notes.append(f"우편 선물: {m.get('title')}")
    # 상점: 상품 추가/수정/삭제 (그림 파일만 바뀐 경우 포함)
    pub_shop = _public_json(f"data/{store.SHOP_FILE}")
    pub_shop = pub_shop if isinstance(pub_shop, dict) else {}
    pub_items = {it.get("id"): it for tab in ("gold", "cash") for it in (pub_shop.get(tab) or []) if isinstance(it, dict)}
    new_items = {it.get("id"): it for tab in ("gold", "cash") for it in (out.get("shop", {}).get(tab) or []) if isinstance(it, dict)}

    def _img_changed(it):
        p = it.get("image")
        return bool(p) and store.asset_exists_ws(p) and (not (config.ROOT / p).exists() or (config.ROOT / p).read_bytes() != (config.WORKSPACE / p).read_bytes())

    added = [it.get("name") for i, it in new_items.items() if i not in pub_items]
    edited = [it.get("name") for i, it in new_items.items() if i in pub_items and (pub_items[i] != it or _img_changed(it))]
    removed = [it.get("name") for i, it in pub_items.items() if i not in new_items]
    if added:
        notes.append(f"상점 새 상품: {', '.join(added)}")
    if edited:
        notes.append(f"상점 상품 변경: {', '.join(edited)}")
    if removed:
        notes.append(f"상점 판매 종료: {', '.join(removed)}")
    if (pub_shop.get("vip") or []) != (out.get("shop", {}).get("vip") or []) and pub_shop:
        notes.append("후원 등급(VIP) 기준 조정")

    # UI 에셋: 칸별로 바뀐 것 (그림 파일 내용이 바뀐 경우 포함)
    from . import uislots

    pub_ui = _public_json(f"data/{store.UI_FILE}")
    pub_ui = pub_ui if isinstance(pub_ui, dict) else {}
    changed = []
    for slot in uislots.SLOTS:
        new, old = uislots.get_path(out["ui"], slot["key"]), uislots.get_path(pub_ui, slot["key"])
        if new == old and (not new or not store.asset_exists_ws(new) or ((config.ROOT / new).exists() and (config.ROOT / new).read_bytes() == (config.WORKSPACE / new).read_bytes())):
            continue
        changed.append(slot["label"])
    if changed:
        notes.append(f"화면 디자인 변경: {', '.join(changed)}")
    return notes


def apply(cutoff, notes):
    """실제 배포: 공개 폴더에 쓰기 + 버전 올리기"""
    p = plan(cutoff)
    if p["errorCount"]:
        raise ValueError(f"오류 {p['errorCount']}개를 먼저 고쳐 주세요")
    if not p["changes"]:
        raise ValueError("바뀐 내용이 없어요")

    written = []
    for change in p["changes"]:
        rel = change["file"]
        dest = config.ROOT / rel
        if change["status"] == "removed":
            store.move_to_trash(dest)
            written.append(rel)
            continue
        kind, value = p["_targets"][rel]
        dest.parent.mkdir(parents=True, exist_ok=True)
        if kind == "json":
            store.write_json(dest, value)
        else:
            shutil.copyfile(value, dest)
        written.append(rel)

    version = _public_json("data/version.json")
    if not isinstance(version, dict):
        version = {"contentVersion": 0, "patchNotes": []}
    version["contentVersion"] = p["nextVersion"]
    clean = [n.strip() for n in notes if isinstance(n, str) and n.strip()]
    version.setdefault("patchNotes", []).insert(0, {"version": p["nextVersion"], "date": now_iso(), "notes": clean})
    store.write_json(config.PUBLIC_DATA / "version.json", version)
    written.append("data/version.json")

    return {
        "version": p["nextVersion"],
        "files": written,
        "commands": git_commands(written, p["nextVersion"]),
    }


# ── git ──────────────────────────────────────────────────
def commit_message(version):
    return f"콘텐츠 업데이트 v{version}"


def git_commands(files, version):
    quoted = " ".join(f'"{f}"' for f in files)
    return [
        f"git add {quoted}",
        f'git commit -m "{commit_message(version)}"',
        "git push",
    ]


def _git(*args, timeout=60):
    r = subprocess.run(["git", *args], cwd=config.ROOT, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    return {"cmd": "git " + " ".join(args), "code": r.returncode, "out": (r.stdout + r.stderr).strip()}


def git_status():
    if not shutil.which("git"):
        return {"available": False}
    branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    remote = _git("remote")
    return {"available": True, "branch": branch["out"], "hasRemote": bool(remote["out"])}


def git_commit_push(files, message, push):
    """지정한 파일만 커밋 (다른 작업 중인 파일은 건드리지 않음) + 선택적으로 push"""
    if not shutil.which("git"):
        raise ValueError("git이 설치되어 있지 않아요")
    safe = [f for f in files if isinstance(f, str) and (f.startswith("data/") or f.startswith("assets/")) and ".." not in f]
    if not safe:
        raise ValueError("커밋할 파일이 없어요")
    log = [_git("add", "-A", "--", *safe)]
    if log[-1]["code"] == 0:
        log.append(_git("commit", "-m", message, "--", *safe))
    if push and log[-1]["code"] == 0:
        log.append(_git("push", timeout=120))
    return log


def public_json_dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2)
