"""예전 배경 제거(긴 변 512px로 줄이던 방식)로 만든 저화질 캐릭터/적 그림을 원본에서 다시 만들기.

  cd dev
  .venv\\Scripts\\python -m tinydev.recut --dry-run        # 무엇이 바뀔지 보기만
  .venv\\Scripts\\python -m tinydev.recut                  # 실제로 교체
  .venv\\Scripts\\python -m tinydev.recut --only char_0001,enemy_0003

- 지금 작업 공간 그림(assets/chars, assets/enemies)과 바이트(또는 픽셀)가 같은 '승인된 시도의 결과'를 찾아
  그 시도의 원본으로 배경 제거를 다시 함 (jobs.redo_cutout → 기록에 aNN-result-K.png로 남음).
- 새 결과의 긴 변이 지금 그림보다 10% 넘게 크면 저화질로 보고 교체. 아니면 그대로 (다시 실행해도 안전).
- RMBG를 못 쓰고 간단 모드로 떨어지면 아무것도 교체하지 않고 멈춤.
- 공개 폴더(assets/)는 개발 도구의 배포로 갱신.
"""
import argparse
import hashlib
import json
import sys

from PIL import Image

from . import config, cutout, images, jobs

KINDS = {"char": "assets/chars/", "enemy": "assets/enemies/"}
UPGRADE_RATIO = 1.1


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _candidates():
    """그림 경로 → 그 경로로 승인된 (작업, 시도) 목록 (새 작업 먼저)"""
    out = {}
    if not config.HISTORY.exists():
        return out
    for d in sorted(config.HISTORY.iterdir(), reverse=True):
        kind = d.name.split("-", 1)[0]
        if kind not in KINDS or not (d / "job.json").exists():
            continue
        try:
            job = json.loads((d / "job.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        ap = job.get("approved") or {}
        path = ap.get("path") or ""
        if not path.startswith(KINDS[kind]):
            continue
        try:
            attempt = jobs.get_attempt(job, ap["attempt"])
        except (ValueError, KeyError, TypeError):
            continue
        out.setdefault(path, []).append((job, attempt))
    return out


def _match(asset, pairs):
    """지금 그림과 바이트가 같은 결과를 가진 (작업, 시도)"""
    want = _digest(asset)
    for job, attempt in pairs:
        folder = jobs.job_dir(job["id"])
        for name in attempt.get("results") or []:
            f = folder / name
            if f.exists() and _digest(f) == want:
                return job, attempt
    return None


def _match_pixels(asset, all_pairs):
    """바이트는 달라도 픽셀이 같은 결과 (다른 그림을 복사해 다시 저장한 경우 — 예: NPC 캐릭터 그림을 적 그림으로 올림)"""
    want = Image.open(asset).convert("RGBA")
    for job, attempt in all_pairs:
        folder = jobs.job_dir(job["id"])
        for name in attempt.get("results") or []:
            f = folder / name
            if not f.exists():
                continue
            got = Image.open(f)
            if got.size == want.size and got.convert("RGBA").tobytes() == want.tobytes():
                return job, attempt
    return None


def run(dry_run=False, only=None):
    replaced, skipped = 0, 0
    cands = _candidates()
    all_pairs = [pair for pairs in cands.values() for pair in pairs]
    done = {}  # (작업 id, 시도 번호) → 이번에 새로 만든 결과 파일
    for path, pairs in sorted(cands.items()):
        aid = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        if only and aid not in only:
            continue
        asset = config.WORKSPACE / path
        if not asset.exists():
            print(f"{aid:12s} 건너뜀: 작업 공간에 그림 없음 (삭제된 항목?)")
            skipped += 1
            continue
        found = _match(asset, pairs) or _match_pixels(asset, all_pairs)
        if not found:
            print(f"{aid:12s} 건너뜀: 지금 그림을 만든 작업 기록을 못 찾음 (직접 그린 그림?)")
            skipped += 1
            continue
        job, attempt = found
        cur = Image.open(asset).size
        original = images.open_image(jobs.job_dir(job["id"]) / attempt["original"])
        src = f"{job['id']} a{attempt['n']:02d}"
        if dry_run:
            print(f"{aid:12s} {cur[0]}×{cur[1]}  원본 {original.size[0]}×{original.size[1]}  ({src})")
            continue

        key = (job["id"], attempt["n"])
        if key in done:  # 같은 원본을 이번에 이미 다시 만듦 → 그 결과를 그대로 복사
            result = done[key]
            got = Image.open(result).size
            asset.write_bytes(result.read_bytes())
            replaced += 1
            print(f"{aid:12s} {cur[0]}×{cur[1]} → {got[0]}×{got[1]}  교체 ({src} 결과 복사)")
            continue

        # 원본과 같은 크기인지 확인 (cutout_full이 다르면 오류를 냄) + 간단 모드면 중단
        full, method, warning = cutout.cutout_full(original, attempt.get("flatten"))
        if method != "rmbg":
            print(f"\nRMBG를 쓸 수 없어 멈춰요 (간단 모드로는 교체하지 않음): {warning}")
            return 2
        img = images.trim_transparent(full)  # 캐릭터/적은 줄이지 않음 (jobs._process와 같은 규칙)
        if max(img.size) <= max(cur) * UPGRADE_RATIO:
            print(f"{aid:12s} {cur[0]}×{cur[1]}  그대로 (이미 고화질, 새 결과 {img.size[0]}×{img.size[1]})")
            continue
        jobs.add_result(job, attempt, img, "png", method, warning, attempt.get("flatten"))  # 기록에 새 결과 남김
        result = jobs.job_dir(job["id"]) / attempt["result"]
        done[key] = result
        got = Image.open(result).size
        asset.write_bytes(result.read_bytes())
        replaced += 1
        print(f"{aid:12s} {cur[0]}×{cur[1]} → {got[0]}×{got[1]}  교체 (배경 제거 결과 {full.size[0]}×{full.size[1]} = 원본 {original.size[0]}×{original.size[1]} ✓)")
    print(f"\n교체 {replaced}개, 건너뜀 {skipped}개" + (" (미리 보기)" if dry_run else ""))
    if replaced:
        print("공개 폴더에 반영하려면 개발 도구에서 배포하세요.")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="저화질 캐릭터/적 그림을 원본에서 다시 배경 제거")
    p.add_argument("--dry-run", action="store_true", help="바꾸지 않고 목록만")
    p.add_argument("--only", default="", help="쉼표로 구분한 id (예: char_0001,enemy_0003)")
    a = p.parse_args(argv)
    only = {s.strip() for s in a.only.split(",") if s.strip()} or None
    return run(a.dry_run, only)


if __name__ == "__main__":
    sys.exit(main())
