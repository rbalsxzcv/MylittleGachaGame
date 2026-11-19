# Tiny Gacha

가로 화면용 작은 캐릭터 수집 가챠 게임이에요. 빌드 과정 없이 HTML/CSS/JS(ES 모듈)만으로 동작하고, GitHub Pages에 그대로 올릴 수 있어요.
콘텐츠(캐릭터, 배너, 스토리, 공지, 우편)는 모두 `data/`의 JSON으로 관리해요. 콘텐츠만 바꿀 때는 게임 코드를 고칠 필요가 없어요.
비상업 개인 프로젝트이며 결제나 수익화 요소는 없어요.

- **플레이어 게임**: 이 폴더 (`index.html`, `js/`, `data/`, `assets/`)
- **개발 도구** (PC 전용. 그림 AI는 Vertex 또는 ComfyUI: 캐릭터·UI 에셋 생성과 검사, 배너/스토리 편집, 배포): [`dev/README.md`](dev/README.md)

## 로컬에서 실행하기

`index.html`을 더블클릭해서 열면 동작하지 않아요. `file://`에서는 ES 모듈과 `fetch`가 막혀요.
아래 둘 중 하나로 **로컬 서버**를 띄워 주세요.

**방법 1: Python**
```bash
# 저장소 폴더에서
python -m http.server 8000
```
브라우저에서 http://localhost:8000 을 열어요. 종료는 터미널에서 `Ctrl + C`예요.

**방법 2: VS Code 확장 "Live Server"**
`index.html`을 우클릭하고 **Open with Live Server**를 눌러요.

### 휴대폰 화면으로 확인하기
크롬 개발자 도구(F12) → 기기 아이콘(Toggle device toolbar) → 가로 크기(예: 844×390)를 골라요.
세로로 돌리면 "기기를 가로로 돌려주세요" 안내가 떠요.

### 개발용 콘솔 명령 (localhost에서만)
| 명령 | 설명 |
|---|---|
| `__tg.simulate(100000)` | 10만 번 뽑기 시뮬레이션 (세이브 영향 없음) |
| `__tg.simulate(100000, 'pickup_starfest')` | 특정 배너 기준. 픽업 비율은 약 66%(50% + 확정)면 정상이에요 |
| `__tg.addGems(10000)` | 테스트용 보석 추가 |

주소 뒤에 다음 옵션을 붙이면 미리보기를 할 수 있어요(localhost 전용).
- `?preview=1`: 실제 세이브와 분리된 미리보기 세이브를 써요.
- `&now=2026-12-07T00:00:00%2B09:00`: 그 시각으로 시간을 옮겨요.
- `&story=main_01` 또는 `&banner=<id>`: 해당 스토리나 배너를 바로 열어요.

## 조작
| 키 | 동작 |
|---|---|
| G / C / T / M / N / O | 뽑기 / 도감 / 스토리 / 우편 / 공지 / 설정 |
| F | 전체화면 |
| Esc, Backspace | 뒤로 / 팝업 닫기 |
| 1 / 0 / I / ← → | (뽑기) 1회 / 10회 / 상세·확률 / 배너 전환 |
| Space, Enter / A / S | (결과) 다음 카드 / 모두 열기 / 건너뛰기 |
| Space / A / L / S / 1~4 | (스토리) 다음 / 자동 / 대사 기록 / 건너뛰기 / 선택지 |

터치 기기에서는 모든 기능을 탭으로 쓸 수 있어요.

## 게임 규칙
- 1회 100 보석, 10회 1,000 보석. 확률은 R 79% · SR 18% · SSR 3%예요.
- **천장**: 50번째 뽑기까지 SSR이 없으면 50번째는 SSR 확정이에요. 상시 배너와 픽업 배너는 천장 카운트를 따로 세요.
- **10회 뽑기**는 SR 이상 1장이 확정이에요.
- **픽업**: SSR이 나오면 50% 확률로 픽업 캐릭터예요. 놓치면 다음 SSR은 픽업 확정이에요.
- 중복 캐릭터를 얻으면 별 +1이에요 (최대 5개).
- 첫 시작에 보석 1,000개를 받아요. 매일 첫 접속(한국 시간 자정 기준)마다 300개를 받아요.
- 스토리를 처음 다 읽으면 보상을 받아요. 우편은 기간 안에 한 번만 받을 수 있어요.
- 모든 시간은 **한국 시간(KST)** 기준으로 판정하고 표시해요.
- 진행 상황은 브라우저(localStorage)에 저장돼요. **설정 → 세이브 코드**로 다른 기기에 옮길 수 있어요.

## 콘텐츠 데이터 형식

보통은 개발 도구로 편집해요. 손으로 고쳐도 되고, 잘못된 항목은 건너뛰고 나머지는 정상 동작해요. 원인은 브라우저 콘솔(F12)에 나와요.
시각은 모두 `"2026-12-01T00:00:00+09:00"`처럼 **+09:00이 붙은 ISO 형식**으로 써요. `null`이면 제한이 없다는 뜻이에요.

### `data/characters.json`
```json
[{ "id": "ssr_lumi", "name": "루미", "rarity": "SSR", "title": "별을 엮는 무녀",
   "description": "소개문", "image": "assets/chars/ssr_lumi.png", "addedAt": "2026-11-15T00:00:00+09:00" }]
```
- `id`는 영문, 숫자, `_`, `-`만 써요. 세이브가 id로 기록되니 **바꾸지 마세요**.
- `image`는 배경이 투명한 PNG(긴 변 512px)예요. 비어 있거나 파일이 없으면 희귀도 색 카드로 대신 표시돼요.
- `addedAt`(공개 시각) 전에는 뽑기와 도감에 나오지 않아요. 픽업 배너 시작 시각과 맞추면 신규 캐릭터 데뷔가 돼요.
- 새로 추가된 캐릭터는 도감에 **NEW**로 표시돼요.

### `data/banners.json`
```json
[{ "id": "pickup_starfest", "title": "별빛 축제 픽업", "type": "pickup",
   "pickupIds": ["ssr_lumi", "sr_ayeon"],
   "startAt": "2026-11-15T00:00:00+09:00", "endAt": "2026-12-07T00:00:00+09:00",
   "bannerImage": "assets/banners/pickup_starfest.jpg", "description": "설명",
   "relatedStoryId": "event_starfest" }]
```
- `type`은 `standard`(상시) 또는 `pickup`(픽업)이에요.
- 진행 중인 배너만 홈 캐러셀에 남은 시간과 함께 보여요. 시작 전이거나 끝난 배너는 숨겨져요.
- 진행 중인 상시 배너가 없으면 기본 상시 모집이 자동으로 나와요.

### `data/stories/index.json` + `data/stories/<id>.json`
```json
[{ "id": "main_02", "kind": "main", "chapter": 2, "title": "골목길의 길잡이", "summary": "한 줄 소개",
   "characterId": null,
   "unlock": [{ "type": "prevChapter" }],
   "reward": { "gems": 50 } }]
```
- `kind`는 `main` / `character` / `event` 중 하나예요. 캐릭터 스토리는 `characterId`가 필요해요.
- `unlock`에는 조건을 여러 개 넣을 수 있고, 모두 만족해야 열려요.
  - `{ "type": "prevChapter" }`: 같은 묶음의 이전 장을 읽어야 해요.
  - `{ "type": "ownsCharacter", "characterId": "ssr_lumi" }`: 그 캐릭터를 보유해야 해요.
  - `{ "type": "period", "startAt": "...", "endAt": "..." }`: 기간 한정이에요. 시작 전에는 목록에서 숨겨지고, 끝난 뒤에는 이미 읽은 사람만 다시 볼 수 있어요.

본문(`stories/main_02.json`):
```json
{ "id": "main_02", "title": "골목길의 길잡이",
  "scenes": [
    { "id": "s1", "background": { "type": "color", "value": "#3a2f5c" },
      "lines": [
        { "speaker": "narrator", "text": "지문" },
        { "speaker": "r_doha", "text": "대사", "side": "right" },
        { "speaker": "r_mina", "text": "어떻게 할까?",
          "choices": [{ "text": "솔직하게 말한다", "goto": "honest" }, { "text": "괜찮은 척한다", "goto": "pretend" }] }
      ] },
    { "id": "honest", "background": { "type": "image", "value": "assets/bg/alley.jpg" }, "next": "merge", "lines": [ ... ] }
  ] }
```
- `speaker`에는 캐릭터 id 또는 `"narrator"`를 써요.
- `name`으로 표시 이름을 바꿀 수 있어요(예: `"???"`). `side`는 `left` 또는 `right`예요.
- 장면은 순서대로 진행돼요. `next`로 다른 장면에 합류하거나 `"end"`로 끝낼 수 있어요.
- 선택지의 `goto`에는 장면 id나 `"end"`를 써요.

### `data/notices.json` / `data/mail.json` / `data/version.json`
```json
[{ "id": "notice_welcome", "title": "제목", "body": "내용", "date": "2026-11-15T00:00:00+09:00", "popup": true }]
```
```json
[{ "id": "mail_launch", "title": "오픈 기념 선물", "body": "내용", "rewards": { "gems": 1000 },
   "startAt": "2026-11-15T00:00:00+09:00", "endAt": "2027-01-01T00:00:00+09:00" }]
```
```json
{ "contentVersion": 1, "patchNotes": [{ "version": 1, "date": "2026-11-15T00:00:00+09:00", "notes": ["변경 사항"] }] }
```
- 공지는 `date`부터 보여요. `popup: true`면 게임 시작 시 팝업으로 떠요("다시 보지 않기" 가능).
- 우편은 id 기준으로 한 번만 받을 수 있어요. 공개한 뒤에는 id를 바꾸지 마세요.
- `contentVersion`이 올라가면 플레이어에게 "업데이트 내역" 팝업이 떠요. 개발 도구의 배포 탭이 자동으로 올려줘요.

### `data/ui.json` (화면 디자인 에셋)
```json
{ "backgrounds": { "home": "assets/ui/bg_home.jpg", "gacha": "assets/ui/bg_gacha.jpg" },
  "icons": { "logo": "assets/ui/icon_logo.png", "gem": "assets/ui/icon_gem.png", "menu_gacha": "assets/ui/icon_menu_gacha.png" } }
```
- 게임 화면의 배경, 로고, 아이콘을 그림 에셋으로 바꿔요. 개발 도구의 **UI 에셋 탭**에서 AI로 뽑아서 채워요.
- 배경 칸: `home`, `gacha`, `reveal`, `collection`, `stories`, `mail`, `notices`, `settings`
- 아이콘 칸: `logo`, `gem`, `menu_gacha`, `menu_collection`, `menu_stories`, `menu_mail`, `menu_notices`, `menu_settings`
- 빠진 칸이나 불러오기에 실패한 그림은 CSS 기본 디자인으로 보여요.

## 폴더 구조
```
index.html, style.css, manifest.webmanifest
js/
  main.js        시작점 (데이터 → 세이브 → 화면 → 시작 팝업)
  core/          스테이지 크기 조정, 데이터 로더/검증, 세이브, KST 시간, 난수, 이벤트
  systems/       게임 규칙 (재화, 가챠·픽업, 도감, 배너 일정, 스토리 해금, 우편·공지)
  ui/            화면 (홈, 뽑기, 결과, 도감, 스토리 목록/뷰어, 우편, 공지, 설정)
data/            콘텐츠 JSON
assets/          chars/(캐릭터), banners/(배너), bg/(스토리 배경), icon.svg
dev/             로컬 전용 개발 도구 (dev/README.md)
```
새 기능(미션, 출석, 상점 등)은 다음 순서로 붙일 수 있어요.
1. `systems/`에 규칙 파일을 추가해요.
2. `ui/`에 화면 파일을 추가해요.
3. `main.js`에서 `registerScreen`으로 등록해요.
4. `home.js`의 `MENU`에 한 줄 추가해요.

세이브 영역은 `registerSaveSlice`로 추가해요.

## 배포 (GitHub Pages)
1. GitHub 저장소 → **Settings → Pages**로 가요.
2. Source는 **Deploy from a branch**, Branch는 `main` / `/ (root)`로 정하고 Save를 눌러요.
3. 잠시 후 `https://<아이디>.github.io/<저장소이름>/`에서 열려요.

콘텐츠를 업데이트할 때는 개발 도구의 **배포 탭**에서 아래 순서로 진행하면 몇 분 뒤 사이트에 반영돼요.
1. 검사
2. 반영
3. `git push`

`dev/` 폴더의 코드도 저장소에 있지만 비밀 정보는 없어요. 키(`dev/.env`), 작업 공간(`dev/workspace`), 생성 기록(`dev/history`)은 git에 올라가지 않아요.

모바일에서는 브라우저 메뉴의 **홈 화면에 추가**로 설치하면 전체화면으로 실행돼요.
