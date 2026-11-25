"""글 생성 시도 기록: dev/history/text-<시각>-<hex>/record.json

어떤 작업을 어떤 모델로 썼는지 남김 (같은 장을 다른 모델로 뽑아 비교할 때).
job.json이 없어서 그림 작업 목록(jobs.list_jobs)에는 안 나옴.
"""
import secrets

from . import config, store
from .timeutil import now_iso, stamp

PROMPT_KEEP = 60000  # 프롬프트 전체 (모델 비교 · 디버깅용, 보통 10~30KB)


def record(task, model, target, prompt, output):
    rid = f"text-{stamp()}-{secrets.token_hex(2)}"
    store.write_json(
        config.HISTORY / rid / "record.json",
        {
            "id": rid,
            "task": task,
            "target": str(target)[:80],
            "model": {k: model.get(k) for k in ("id", "label", "provider", "model", "mock") if k in model},
            "at": now_iso(),
            "prompt": prompt[:PROMPT_KEEP],
            "promptLength": len(prompt),
            "output": output,
        },
    )
    return rid


def list_records(target=None, limit=30):
    if not config.HISTORY.exists():
        return []
    out = []
    for d in sorted(config.HISTORY.iterdir(), reverse=True):
        if not d.name.startswith("text-"):
            continue
        try:
            r = store.read_json(d / "record.json", None)
        except store.JsonError:
            continue
        if isinstance(r, dict) and (target is None or r.get("target") == target):
            out.append({k: r.get(k) for k in ("id", "task", "target", "model", "at")})
        if len(out) >= limit:
            break
    return out
