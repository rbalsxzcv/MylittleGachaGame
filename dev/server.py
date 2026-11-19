"""Tiny Gacha 개발 도구 실행 파일.

    (가상환경을 켠 상태에서) python server.py
    → 브라우저에서 http://127.0.0.1:5050 이 열립니다.

내 컴퓨터(127.0.0.1)에서만 접속할 수 있고, 인터넷에 공개되지 않습니다.
"""
import os
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tinydev import config, genai, store  # noqa: E402
from tinydev.api import app  # noqa: E402


def main():
    created = store.ensure_workspace()
    url = f"http://127.0.0.1:{config.PORT}"
    print("=" * 60)
    print(" Tiny Gacha 개발 도구")
    print(f" 주소: {url}")
    print(f" AI 모드: {'모의(MOCK) — Vertex 설정 없음 또는 TG_MOCK=1' if genai.is_mock() else 'Vertex AI'}")
    if created:
        print(" 작업 공간을 새로 만들었어요 (dev/workspace ← data/, assets/ 복사)")
    print(" 종료: Ctrl + C")
    print("=" * 60)
    if os.getenv("TG_NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    # 127.0.0.1에만 열기 → 같은 와이파이의 다른 기기에서도 접속 불가
    app.run(host="127.0.0.1", port=config.PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
