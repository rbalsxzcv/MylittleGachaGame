"""작업 공간(dev/workspace) 읽기/쓰기.

개발 도구의 모든 수정은 먼저 작업 공간에 저장됩니다. 공개 폴더(data/, assets/)에는
'배포' 단계에서만 반영됩니다 → 아직 공개하지 않은 콘텐츠가 공개 저장소에 올라가지 않음.
"""
import json
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path

from . import config

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# 작업 공간에서 관리하는 목록 파일
LIST_FILES = {
    "characters": "characters.json",
    "banners": "banners.json",
    "storyIndex": "stories/index.json",
    "notices": "notices.json",
    "mail": "mail.json",
    "enemies": "enemies.json",
    "stages": "stages/index.json",  # 모험 챕터 목록 → stages/<챕터>.json (read_list/write_list가 합쳐서 다룸)
    "props": "props.json",  # 소품 그림 목록 (개발 도구 전용 — 배포하지 않음, 그림만 상점 등에서 참조)
}
ASSET_DIRS = ("chars", "banners", "bg", "ui", "enemies", "props")
UI_FILE = "ui.json"  # 게임 화면 에셋(배경/아이콘) 연결 정보 — 목록이 아니라 객체
BALANCE_FILE = "balance.json"  # 전투/육성 숫자 (객체)
SHOP_FILE = "shop.json"  # 골드 상점 / 가상 캐시 상점 상품 (객체)


def valid_id(value):
    return isinstance(value, str) and bool(ID_RE.match(value))


def ws_data(rel=""):
    return config.WORKSPACE / "data" / rel


def ws_assets(rel=""):
    return config.WORKSPACE / "assets" / rel


def ensure_workspace():
    """작업 공간이 없으면 공개 데이터를 복사해서 만듦"""
    if ws_data().exists():
        _ensure_extras()
        return False
    reset_workspace()
    return True


def _ensure_extras():
    """나중에 추가된 파일/폴더를 예전 작업 공간에도 만들어 줌 (공개 파일이 있으면 복사)"""
    for sub in ASSET_DIRS:
        ws_assets(sub).mkdir(parents=True, exist_ok=True)
    if not ws_data(UI_FILE).exists():
        public = config.PUBLIC_DATA / UI_FILE
        write_json(ws_data(UI_FILE), read_json(public, None) or {"backgrounds": {}, "icons": {}})
    if not ws_data(BALANCE_FILE).exists():
        write_json(ws_data(BALANCE_FILE), read_json(config.PUBLIC_DATA / BALANCE_FILE, None) or {})
    if not ws_data(SHOP_FILE).exists():
        write_json(ws_data(SHOP_FILE), read_json(config.PUBLIC_DATA / SHOP_FILE, None) or empty_shop())
    for key in ("enemies", "props"):
        if not ws_data(LIST_FILES[key]).exists():
            write_json(ws_data(LIST_FILES[key]), read_json(config.PUBLIC_DATA / LIST_FILES[key], None) or [])
    # 스테이지: 작업 공간에 챕터 파일도 예전 stages.json도 없으면 공개 데이터에서 복사
    if not ws_data("stages/index.json").exists() and not ws_data("stages.json").exists():
        pub = config.PUBLIC_DATA / "stages"
        if (pub / "index.json").exists():
            shutil.copytree(pub, ws_data("stages"), dirs_exist_ok=True)
        else:
            write_json(ws_data("stages.json"), read_json(config.PUBLIC_DATA / "stages.json", None) or [])


def read_ui():
    ensure_workspace()
    ui = read_json(ws_data(UI_FILE), None)
    if not isinstance(ui, dict):
        ui = {}
    ui.setdefault("backgrounds", {})
    ui.setdefault("icons", {})
    return ui


def write_ui(ui):
    write_json(ws_data(UI_FILE), ui)


def read_balance():
    ensure_workspace()
    b = read_json(ws_data(BALANCE_FILE), None)
    return b if isinstance(b, dict) else {}


def write_balance(balance):
    write_json(ws_data(BALANCE_FILE), balance)


def empty_shop():
    return {"gold": [], "cash": [], "vip": []}


def read_shop():
    ensure_workspace()
    shop = read_json(ws_data(SHOP_FILE), None)
    if not isinstance(shop, dict):
        shop = {}
    for key in ("gold", "cash", "vip"):
        if not isinstance(shop.get(key), list):
            shop[key] = []
    return shop


def write_shop(shop):
    write_json(ws_data(SHOP_FILE), shop)


def reset_workspace():
    """공개 데이터로 작업 공간을 덮어씀 (작업 중이던 미공개 내용은 dev/trash로 백업)"""
    if config.WORKSPACE.exists():
        backup = config.TRASH / f"workspace-{_stamp()}"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(config.WORKSPACE), str(backup))
    ws_data().mkdir(parents=True, exist_ok=True)
    if config.PUBLIC_DATA.exists():
        shutil.copytree(config.PUBLIC_DATA, ws_data(), dirs_exist_ok=True)
    for sub in ASSET_DIRS:
        src = config.PUBLIC_ASSETS / sub
        dst = ws_assets(sub)
        dst.mkdir(parents=True, exist_ok=True)
        if src.exists():
            shutil.copytree(src, dst, dirs_exist_ok=True)
    (ws_data("stories")).mkdir(parents=True, exist_ok=True)
    for key, rel in LIST_FILES.items():
        if not ws_data(rel).exists():
            write_json(ws_data(rel), [])
    _ensure_extras()


def _stamp():
    from .timeutil import stamp

    return stamp()


# ── JSON 입출력 ─────────────────────────────────────────
class JsonError(Exception):
    pass


def read_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise JsonError(f"{path.name}: JSON 문법 오류 ({e.lineno}행 {e.colno}열) {e.msg}") from e


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def write_json(path, obj):
    """원자적 저장: 임시 파일에 쓴 뒤 교체 → 저장 중 꺼져도 파일이 깨지지 않음"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(dumps(obj))
    os.replace(tmp, path)


def read_list(key):
    if key == "stages":
        return read_stages()
    data = read_json(ws_data(LIST_FILES[key]), [])
    return data if isinstance(data, list) else []


def write_list(key, items):
    if key == "stages":
        return write_stages(items)
    write_json(ws_data(LIST_FILES[key]), items)


# ── 모험 스테이지: 챕터 파일 (data/stages/index.json + data/stages/<챕터>.json) ──
# 개발 도구 안에서는 모든 챕터의 스테이지를 한 목록으로 다루고, 항목마다 chapter 필드를 붙임
CHAPTER_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
_STAGE_ARC = re.compile(r"^st_(\d+)_")


def chapter_of(stage):
    """스테이지의 챕터 id (없으면 id의 st_NN_ → chNN, 그래도 없으면 ch01)"""
    ch = stage.get("chapter") if isinstance(stage, dict) else None
    if isinstance(ch, str) and CHAPTER_RE.match(ch):
        return ch
    m = _STAGE_ARC.match(str((stage or {}).get("id") or ""))
    return f"ch{int(m.group(1)):02d}" if m else "ch01"


def _read_stage_chapters(folder):
    """폴더(작업 공간 또는 공개 data/stages) → (챕터 id 순서, {챕터: 제목}, 스테이지 목록)"""
    idx = read_json(folder / "index.json", None)
    if not isinstance(idx, list):
        return None
    order, titles, items = [], {}, []
    for ch in idx:
        ch = ch if isinstance(ch, str) else (ch or {}).get("id")
        if not isinstance(ch, str) or not CHAPTER_RE.match(ch):
            continue
        data = read_json(folder / f"{ch}.json", {}) or {}
        order.append(ch)
        titles[ch] = data.get("title") or ch
        for st in data.get("stages") or []:
            if isinstance(st, dict):
                items.append({**st, "chapter": ch})
    return order, titles, items


def read_stages():
    got = _read_stage_chapters(ws_data("stages"))
    if got is not None:
        return got[2]
    legacy = read_json(ws_data("stages.json"), [])  # 예전 한 파일 형식
    return [{**st, "chapter": chapter_of(st)} for st in legacy if isinstance(st, dict)] if isinstance(legacy, list) else []


def stage_chapter_titles():
    got = _read_stage_chapters(ws_data("stages"))
    return got[1] if got else {}


_CHAPTER_PREFIX = re.compile(r"^\s*챕터\s*\d+\s*[:：.·\-]?\s*")


def strip_chapter_prefix(title):
    """'챕터 2: 가성비 좋은 상속 전쟁' → '가성비 좋은 상속 전쟁' (게임이 '챕터 N'을 따로 붙여서 두 번 나오지 않게)"""
    return _CHAPTER_PREFIX.sub("", str(title or "")).strip()


def chapter_title(ch, given="", arc_title=""):
    """챕터 파일 제목: 직접 정한 제목 → '챕터 N: <스토리 챕터 제목>' → '챕터 N'
    ('챕터 ch02'처럼 자동으로 붙었던 임시 제목은 없는 것으로 봄)"""
    m = re.fullmatch(r"ch(\d+)", ch or "")
    label = f"챕터 {int(m.group(1))}" if m else f"챕터 {ch}"
    given = str(given or "").strip()
    if given and not re.fullmatch(r"(챕터\s*)?(ch\d+|\d+)", given):
        return given
    rest = strip_chapter_prefix(arc_title)
    return f"{label}: {rest}" if rest else label


def split_stages(items, titles=None, order=None):
    """한 목록 → (index.json 내용, {챕터: 파일 내용}). 챕터 순서는 기존 순서 → 새 챕터는 이름순"""
    titles = titles or {}
    groups = {}
    for st in items:
        if not isinstance(st, dict):
            continue
        ch = chapter_of(st)
        groups.setdefault(ch, []).append({k: v for k, v in st.items() if k != "chapter"})
    ids = [c for c in (order or []) if c in groups] + sorted(c for c in groups if c not in (order or []))
    arc_titles = {}
    for s in read_list("storyIndex"):
        if isinstance(s, dict) and s.get("arc") and s.get("arcTitle"):
            arc_titles.setdefault(f"ch{int(s['arc']):02d}", s["arcTitle"])
    files = {ch: {"chapter": ch, "title": chapter_title(ch, titles.get(ch), arc_titles.get(ch)), "stages": groups[ch]} for ch in ids}
    return ids, files


def write_stages(items):
    got = _read_stage_chapters(ws_data("stages"))
    order, titles = (got[0], got[1]) if got else ([], {})
    ids, files = split_stages(items, titles, order)
    for ch, payload in files.items():
        write_json(ws_data(f"stages/{ch}.json"), payload)
    write_json(ws_data("stages/index.json"), ids)
    # 비게 된 챕터 파일 / 예전 stages.json은 휴지통으로
    for p in ws_data("stages").glob("*.json"):
        if p.name != "index.json" and p.stem not in files:
            move_to_trash(p)
    move_to_trash(ws_data("stages.json"))


def load_all():
    """화면에 필요한 작업 공간 데이터 전체 + 파일별 오류"""
    ensure_workspace()
    out = {"errors": {}}
    for key in LIST_FILES:
        try:
            out[key] = read_list(key)
        except JsonError as e:
            out[key] = []
            out["errors"][key] = str(e)
    try:
        out["version"] = read_json(config.PUBLIC_DATA / "version.json", {"contentVersion": 0, "patchNotes": []})
    except JsonError as e:
        out["version"] = {"contentVersion": 0, "patchNotes": []}
        out["errors"]["version"] = str(e)
    try:
        out["ui"] = read_ui()
    except JsonError as e:
        out["ui"] = {"backgrounds": {}, "icons": {}}
        out["errors"]["ui"] = str(e)
    try:
        out["balance"] = read_balance()
    except JsonError as e:
        out["balance"] = {}
        out["errors"]["balance"] = str(e)
    try:
        out["shop"] = read_shop()
    except JsonError as e:
        out["shop"] = empty_shop()
        out["errors"]["shop"] = str(e)
    return out


def story_path(story_id):
    if not valid_id(story_id):
        raise ValueError("잘못된 스토리 id")
    return ws_data(f"stories/{story_id}.json")


def read_story(story_id):
    return read_json(story_path(story_id), None)


def write_story(story_id, body):
    write_json(story_path(story_id), body)


def move_to_trash(path):
    """파일 삭제 대신 dev/trash로 이동 (실수 복구용)"""
    path = Path(path)
    if not path.exists():
        return
    dst = config.TRASH / f"{_stamp()}-{path.name}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(dst))


def asset_exists_ws(rel_path):
    """'assets/chars/x.png' 같은 경로가 작업 공간에 있는지"""
    if not isinstance(rel_path, str) or not rel_path.startswith("assets/") or ".." in rel_path:
        return False
    return (config.WORKSPACE / rel_path).is_file()


# ── id 자동 발급 (dev/ids.json, git에 올라감 — 작업 공간을 초기화해도 남음) ──
# 규칙: <종류>_<4자리 번호> (예: char_0001). 종류마다 번호는 1씩 늘기만 하고 다시 쓰지 않아요 (삭제해도).
# 개발자는 id를 정하지 않아요 — 새로 만들 때 서버가 next_id()로 발급.
# 플레이어 세이브는 id로 기록되므로, 예전 id를 바꿀 때는 data/id_aliases.json(예전 → 새 id)을 남겨서 게임이 세이브를 옮겨요.
ID_KINDS = {
    # 종류: (접두사, 목록 키 또는 None)
    "char": ("char", "characters"),
    "enemy": ("enemy", "enemies"),
    "stage": ("stage", "stages"),
    "story": ("story", "storyIndex"),
    "banner": ("banner", "banners"),
    "notice": ("notice", "notices"),
    "mail": ("mail", "mail"),
    "shop": ("shop", None),  # 상점 상품 (골드/캐시 공용 번호)
    "prop": ("prop", "props"),
    "bg": ("bg", None),  # 스토리 배경 그림 (설정집 backgrounds 키 = 파일 이름)
}
KIND_OF_LIST = {v[1]: k for k, v in ID_KINDS.items() if v[1]}
AUTO_ID_RE = re.compile(r"^([a-z]+)_(\d{4,})$")
IDS_FILE = config.DEV / "ids.json"
_ids_lock = threading.Lock()


def is_auto_id(kind, value):
    """이 종류의 자동 id 형식인지 (char_0001 …)"""
    m = AUTO_ID_RE.match(str(value or ""))
    return bool(m) and m.group(1) == ID_KINDS[kind][0]


def _id_number(kind, value):
    m = AUTO_ID_RE.match(str(value or ""))
    return int(m.group(2)) if m and m.group(1) == ID_KINDS[kind][0] else 0


def _read_ids():
    data = read_json(IDS_FILE, {}) or {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("next", {})
    data.setdefault("deleted", {})
    return data


def _existing_ids(kind):
    """작업 공간에 지금 있는 이 종류의 id들"""
    if kind == "shop":
        shop = read_shop()
        return {it.get("id") for tab in ("gold", "cash") for it in shop.get(tab) or [] if isinstance(it, dict)}
    if kind == "bg":
        from . import bible  # 순환 import 방지

        return set(bible.load().get("backgrounds") or {}) | {p.stem for p in ws_assets("bg").glob("*.*")}
    return {x.get("id") for x in read_list(ID_KINDS[kind][1]) if isinstance(x, dict)}


def peek_next_id(kind):
    """다음에 발급될 id (발급하지는 않음 — 화면 안내용)"""
    data = _read_ids()
    used = [_id_number(kind, x) for x in _existing_ids(kind) | set(data["deleted"].get(kind, []))]
    n = max([int(data["next"].get(kind, 1))] + [u + 1 for u in used])
    return f"{ID_KINDS[kind][0]}_{n:04d}"


def next_id(kind):
    """새 id 발급 (번호는 늘기만 함 → 중복/재사용 없음)"""
    if kind not in ID_KINDS:
        raise ValueError(f"알 수 없는 id 종류: {kind}")
    with _ids_lock:
        data = _read_ids()
        new = peek_next_id(kind)
        data["next"][kind] = _id_number(kind, new) + 1
        write_json(IDS_FILE, data)
        return new


def issued(kind, value):
    """이 id가 자동 형식이고 이미 발급된 번호인지 (손으로 만든 id 막기)"""
    data = _read_ids()
    return is_auto_id(kind, value) and _id_number(kind, value) < int(data["next"].get(kind, 1))


def deleted_ids(kind="char"):
    kind = KIND_OF_LIST.get(kind, kind)  # 예전 호출 "characters"도 받음
    return set(_read_ids()["deleted"].get(kind, []))


def remember_deleted(kind, item_id, name=""):
    """삭제한 id 기록 (형식이 맞으면 번호가 다시 발급되지 않고, 배포 검사가 같은 id 재사용을 막음)"""
    kind = KIND_OF_LIST.get(kind, kind)
    with _ids_lock:
        data = _read_ids()
        items = data["deleted"].setdefault(kind, [])
        if item_id not in items:
            items.append(item_id)
        write_json(IDS_FILE, data)


# ── id 별칭 (data/id_aliases.json: 종류 → {예전 id: 새 id}) — 배포돼서 게임이 세이브를 옮길 때 씀 ──
ALIASES_FILE = "id_aliases.json"


def read_aliases():
    data = read_json(ws_data(ALIASES_FILE), {}) or {}
    return data if isinstance(data, dict) else {}


def write_aliases(data):
    write_json(ws_data(ALIASES_FILE), data)
