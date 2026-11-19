@echo off
REM Tiny Gacha 로컬 실행: 이 폴더에서 웹 서버를 켜고 브라우저로 게임을 엽니다.
REM (이 파일은 Windows 한글 인코딩 CP949로 저장되어 있어요. UTF-8로 바꾸면 글자가 깨져요)
cd /d "%~dp0"
set PORT=8000

set PY=
where py >nul 2>nul && set PY=py
if not defined PY (
  where python >nul 2>nul && set PY=python
)
if not defined PY (
  echo [오류] Python을 찾을 수 없어요.
  echo https://www.python.org 에서 설치하고 "Add python.exe to PATH"를 체크해 주세요.
  pause
  exit /b 1
)

echo ============================================
echo  Tiny Gacha 로컬 서버: http://localhost:%PORT%
echo  이 창을 닫으면 서버가 꺼져요.
echo ============================================
start "" http://localhost:%PORT%/
%PY% -m http.server %PORT% --bind 127.0.0.1
pause
