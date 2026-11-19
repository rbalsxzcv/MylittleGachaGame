"""작업 공간(dev/workspace) 읽기/쓰기.

개발 도구의 모든 수정은 먼저 작업 공간에 저장됩니다. 공개 폴더(data/, assets/)에는
'배포' 단계에서만 반영됩니다 → 아직 공개하지 않은 콘텐츠가 공개 저장소에 올라가지 않음.
"""
import json
import os
import re
import shutil
import tempfile
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
}
ASSET_DIRS = ("chars", "banners", "bg")


def valid_id(value):
    return isinstance(value, str) and bool(ID_RE.match(value))


def ws_data(rel=""):
    return config.WORKSPACE / "data" / rel


def ws_assets(rel=""):
    return config.WORKSPACE / "assets" / rel


def ensure_workspace():
    """작업 공간이 없으면 공개 데이터를 복사해서 만듦"""
    if ws_data().exists():
        return False
    reset_workspace()
    return True


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
    data = read_json(ws_data(LIST_FILES[key]), [])
    return data if isinstance(data, list) else []


def write_list(key, items):
    write_json(ws_data(LIST_FILES[key]), items)


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
