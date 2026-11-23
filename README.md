# Tiny Gacha

가로 화면용 작은 캐릭터 수집 가챠 게임이에요. 빌드 과정 없이 HTML/CSS/JS(ES 모듈)만으로 동작하고, GitHub Pages에 그대로 올릴 수 있어요.
콘텐츠(캐릭터, 배너, 스토리, 공지, 우편, 상점 상품)는 모두 `data/`의 JSON으로 관리해요. 콘텐츠만 바꿀 때는 게임 코드를 고칠 필요가 없어요.
비상업 개인 프로젝트이며 실제 결제나 수익화 요소는 없어요. 캐시 상점의 원화 가격은 **가상 결제 연출**일 뿐이고, 돈은 나가지 않고 아이템만 들어와요.

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
| `__tg.simulate(100000, 'banner_0003')` | 특정 배너 기준. 픽업 비율은 약 66%(50% + 확정)면 정상이에요 |
| `__tg.addGems(10000)` | 테스트용 보석 추가 |
| `__tg.addTickets(10000)` | 테스트용 티켓 추가 |
| `__tg.addGold(1000000)` / `__tg.addScrolls(10)` | 테스트용 골드 / 모집 증서 추가 |
| `__tg.sim('stage_0004', 200)` | 지금 편성으로 스테이지 자동 전투 200판 (세이브 영향 없음) |
| `__tg.battleTest()` | 전투 엔진 자체 검사 (공식, 결정론, HP 범위) |
| `__tg.replay()` | 마지막 전투의 시드와 행동 기록 (같은 시드 + 행동 = 같은 결과) |

주소 뒤에 다음 옵션을 붙이면 미리보기를 할 수 있어요(localhost 전용).
- `?preview=1`: 실제 세이브와 분리된 미리보기 세이브를 써요.
- `&now=2026-12-07T00:00:00%2B09:00`: 그 시각으로 시간을 옮겨요.
- `&story=story_0001` 또는 `&banner=<id>`: 해당 스토리나 배너를 바로 열어요.
- `&ownAll=1`: (preview=1일 때) 모든 캐릭터를 가진 상태로 시작해요.
- `&screen=adventure` (growth, team, collection, gacha …): 그 화면을 바로 열어요.
- `&battle=stage_0012`: 그 스테이지 전투를 바로 시작해요 (보상 없음, 편성이 비면 전투력 상위 5명).

**테스트**: 같은 서버에서 http://localhost:8000/tests/index.html 을 열면 전부 실행돼요 (Node가 있으면 `node tests/run.js`). 가챠 연출만 확인하려면 http://localhost:8000/dev/fx-test.html.

## 조작
| 키 | 동작 |
|---|---|
| G / T / U / P / C / S | 뽑기 / 스토리 / 육성 / 편성 / 도감 / 상점 |
| M / N / O | 우편 / 공지 / 설정 (위쪽 아이콘) |
| F | 전체화면 |
| Esc, Backspace | 뒤로 / 팝업 닫기 |
| 1 / 0 / I / ← → | (뽑기) 1회 / 10회 / 상세·확률 / 배너 전환 |
| Space, 탭 / S, Esc | (뽑기 연출) 다음 단계 / 건너뛰기 · 결과 격자에서 Space, Enter = 확인 |
| Space / A / L / S / 1~4 | (스토리) 다음 / 자동 / 대사 기록 / 건너뛰기 / 선택지 |
| 1 / 2 / 3 / ← → | (육성) 레벨업 / 스킬 / 돌파 탭, ↑ ↓ 캐릭터 |
| 1~5 | (편성) 칸 고르기 |
| 1 / 2 / ↑ ↓ / ← → | (상점) 골드 / 캐시 탭, 캐시 분류, 상품 넘기기 |
| 1 / 2 · 숫자 · A · X · R · Esc | (전투) 기본 공격 / 스킬 · 대상 고르기 · AUTO · 2배속 · 즉시 결과 · 취소/일시정지 (궁극기는 빛나는 초상 탭) |

터치 기기에서는 모든 기능을 탭으로 쓸 수 있어요.

## 게임 규칙
- 1회 100 보석, 10회 1,000 보석. 희귀도는 1★~5★, 확률은 1★ 40% · 2★ 30% · 3★ 20% · 4★ 8% · 5★ 2%예요.
- **천장**: 70번째 뽑기까지 5★가 없으면 70번째는 5★ 확정이에요. 상시 배너와 픽업 배너는 천장 카운트를 따로 세요.
- **10회 뽑기**는 4★ 이상 1장이 확정이에요.
- **픽업**: 5★가 나오면 50% 확률로 픽업 캐릭터예요. 놓치면 다음 5★는 픽업 확정이에요.
- 중복 캐릭터를 얻으면 **정수 +1**이에요. 정수 1개로 돌파 1단계(최대 5)를 열어요. 돌파 + 정수가 5가 된 뒤의 중복은 티켓으로 바뀌어요 (5★ 200 · 4★ 80 · 3★ 이하 30).
- 카드 왼쪽 위 배지가 희귀도(1★~5★), 카드 아래 별 칸은 돌파 단계예요. 예전 데이터의 R/SR/SSR은 3★/4★/5★로 읽어요.
- 첫 시작에 보석 1,000개 + 골드 20,000을 받아요. 매일 첫 접속(한국 시간 자정 기준)마다 보석 300개 + 티켓 30장 + 골드 3,000을 받아요.
- 골드가 생기기 전의 세이브도 처음 열 때 골드 20,000을 한 번 받아요.

### 재화 / 상점
| 재화 | 쓰는 곳 | 얻는 곳 |
|---|---|---|
| 보석 | 뽑기 (1회 100) | 출석, 스토리, 첫 클리어, 우편, 상점 |
| 모집 증서 | 뽑기 1회 = 1장 (있으면 보석보다 먼저 써요) | 골드 상점, 캐시 상점, 우편 |
| 골드 | 레벨업, 골드 상점 | 스테이지 클리어, 출석, 우편, 골드 환전 |
| 티켓 | 레벨업 | 스테이지 클리어, 출석, 우편, 중복 캐릭터, 상점 |

- **골드 상점**: 골드(또는 보석)로 티켓, 모집 증서, 보석을 사요. 상품마다 하루 / 주 / 달 구매 횟수가 있고 한국 시간 자정(주는 월요일, 달은 1일)에 초기화돼요. 매일 무료 선물이 있으면 홈의 상점 메뉴에 빨간 점이 떠요.
- **캐시 상점(가상 결제)**: 추천 · 패키지(트럭 포함) · 성장 · 보석 · 월정액. 결제창에서 결제하기를 누르면 아이템이 바로 들어와요.
  - 보석 상품은 상품별로 **첫 구매 2배**예요. 성장 지원 패키지는 스토리 전투를 일정 개수 깨야 열려요.
  - **월간 축복**: 즉시 보석 300 + 30일 동안 매일 첫 접속 때 보석 100. 다시 사면 30일 연장(남은 기간 최대 180일).
  - **후원 등급(VIP)**: 누적 가상 결제 금액에 따라 VIP 1~10이 표시돼요 (꾸미기용, 효과 없음).

### 육성 / 편성 / 전투
- 숫자는 모두 `data/balance.json`에서 바꿀 수 있어요 (코드는 `js/config.js`가 읽어서 씀).
- 능력치 = 기본 × (1 + 0.08 × (레벨 − 1)), 레벨 제한 없음. 속도와 치명타 확률/피해(기본 5% / 50%)는 레벨로 오르지 않고 능력으로만 바뀌어요.
- 레벨 lv → lv+1 비용: `ceil(10 × lv^1.25)` 티켓 + 그 티켓 × 10 골드. 티켓과 골드는 스테이지 클리어, 출석, 우편, 상점에서 얻어요.
- 전투력 = 2·공격 + 1.5·방어 + 0.2·HP + 2·속도 + 300·치명타 확률 + 100·치명타 피해. 큰 숫자는 1.2만처럼 보여요.
- 전투는 **속도 타임라인** 턴제예요. 행동 간격 = 10000 ÷ 속도 (빠를수록 자주). 왼쪽에 다음 행동 순서 8명이 보여요.
  - 아군 차례: 시간 제한 없이 고르기. **기본 공격**(팀 SP +1, 기력 +20) 또는 **스킬**(SP −1, SP 0이면 못 씀, 기력 +30) → 대상. SP는 3으로 시작, 최대 5.
  - **궁극기**: 기력 100이 되면 초상이 빛나요. 아군 차례 중 언제든 탭 → 턴을 쓰지 않아요. 맞으면 기력 +10.
  - 적은 다음 행동을 **예고**해요 (아이콘 + ⏱몇 번 뒤 + 노리는 칸 또는 '광역'). 빨간 예고(큰 공격)는 차단 효과로 끊을 수 있어요. 보스는 HP에 따라 페이즈가 바뀌고, 오래 끌면 광폭화해요.
  - 도발한 아군이 있으면 적의 단일 공격은 그쪽으로 가요.
- 피해 = 능력치 × 배율 × 100/(100 + 방어) × 치명타(1 + 치명타 피해) × 강화, 내림, 최소 1.
- AUTO: 궁극기는 큰 공격 예고 중이거나 적을 쓰러뜨릴 수 있을 때, 스킬은 SP 2 이상이거나 치유/보호막이 필요할 때, 아니면 기본 공격. 2배속, 즉시 결과(연출 없이 끝까지), 일시정지가 있어요.
- **모험**: 스테이지 1개 = 스토리 1개 + 전투 1개. 스테이지를 고르면 스토리가 열리고, 스토리 중간의 전투에서 이겨야 다음 장면으로 가요. 다 보면 다음 스테이지가 열려요. 전에 깬 전투는 건너뛸 수 있고, 다시 싸우면 클리어 보상을 또 받아요 (첫 클리어 보상은 한 번).
- 뽑기 연출과 전투 화면만 움직여요 (Phaser). 설정에서 뽑기 연출 2배속 / 건너뛰기, 전투 2배속을 고를 수 있어요. 기기의 '동작 줄이기' 설정을 켜면 페이드만 나와요.
- 스토리를 처음 다 읽으면 보상을 받아요. 우편은 기간 안에 한 번만 받을 수 있어요.
- 모든 시간은 **한국 시간(KST)** 기준으로 판정하고 표시해요.
- 진행 상황은 브라우저(localStorage, `tinygacha_save_v2`)에 저장돼요. **설정 → 세이브 코드**(`TG2:`)로 다른 기기에 옮길 수 있어요.
- 예전 세이브는 처음 열 때 순서대로 옮겨져요 (v1 → v2: 중복 획득은 정수(최대 5)로, 넘치는 몫은 티켓 / v2 → v3: 연출 설정 추가). v1 원본은 백업으로 그대로 남아요. 예전 세이브 코드(`TG1:`, v2의 `TG2:`)도 불러올 수 있어요.

## 콘텐츠 데이터 형식

보통은 개발 도구로 편집해요. 손으로 고쳐도 되고, 잘못된 항목은 건너뛰고 나머지는 정상 동작해요. 원인은 브라우저 콘솔(F12)에 나와요.
시각은 모두 `"2026-12-01T00:00:00+09:00"`처럼 **+09:00이 붙은 ISO 형식**으로 써요. `null`이면 제한이 없다는 뜻이에요.

### `data/characters.json`
```json
[{ "id": "char_0007", "name": "루미", "rarity": 5, "title": "별을 엮는 무녀",
   "description": "소개문", "image": "assets/chars/char_0007.png", "addedAt": "2026-11-15T00:00:00+09:00" }]
```
- **id는 개발 도구가 자동으로 정해요** (규칙: `<종류>_<4자리 번호>` — `char_0001`, `enemy_0001`, `stage_0001`, `story_0001`, `banner_0001`, `notice_0001`, `mail_0001`, `shop_0001`, `prop_0001`, `bg_0001`). 번호는 늘기만 하고 삭제해도 다시 쓰지 않아요 (`dev/ids.json`). 세이브가 id로 기록되니 손으로 만들거나 바꾸지 마세요 — 배포 검사가 규칙에 맞지 않는 id를 막아요.
- 예전 id를 바꿨을 때는 `data/id_aliases.json`(종류 → {예전 id: 새 id})이 남아서, 게임이 예전 세이브/세이브 코드를 새 id로 옮겨요. 지우지 마세요.
- `image`는 배경이 투명한 PNG(원본 해상도, 투명 여백만 잘라냄)예요. 비어 있거나 파일이 없으면 희귀도 색 카드로 대신 표시돼요.
- `addedAt`(공개 시각) 전에는 뽑기와 도감에 나오지 않아요.
- **등급** `rarity`: `1`~`5`(별 개수) 또는 `"npc"`. **NPC 등급**은 뽑기(상시/픽업/로테이션) · 도감 · 육성 · 편성에 나오지 않고, 스토리의 화자나 전투의 적(아래 `enemies.json`의 `charId`)으로만 나와요.
  - 등급을 1~5 ↔ NPC로 바꾸면 가챠 풀이 바로 따라가요 (풀은 데이터에서 매번 새로 만들어요). 이미 가진 플레이어의 세이브 기록은 지우지 않고 보관만 해서, 다시 1~5로 바꾸면 레벨/돌파/편성이 그대로 돌아와요.
  - 뽑기에서만 빼고 가진 사람은 계속 쓰게 하려면 NPC 대신 `"retired": true`(은퇴)를 써요.
  - 예전 방식 `"pullable": false`(스토리 전용 인물)는 NPC로 읽어요.
- 메인 스토리 목록(`stories/index.json`)의 `arc`, `arcTitle`은 챕터(12장 묶음) 번호와 제목이에요. 게임 목록에 챕터 머리글과 "챕터 1 · 3장"으로 보여요.
- 배경 그림 장면은 `{ "type": "image", "value": "assets/bg/x.jpg", "color": "#2a2152" }`처럼 `color`를 함께 쓰면, 그림이 아직 없을 때 그 색으로 보여요. 픽업 배너 시작 시각과 맞추면 신규 캐릭터 데뷔가 돼요.
- 새로 추가된 캐릭터는 도감에 **NEW**로 표시돼요.

캐릭터 전투 데이터(선택, 보통 개발 도구 **캐릭터 탭 → 전투 데이터**로 편집):
```json
{ "nameEn": "Lumi", "role": "support", "themeColor": "#8fb8ff", "quote": "소원은 내가 엮어 줄게.",
  "stats": { "atk": 125, "def": 55, "hp": 1250, "spd": 106, "critRate": 0.05, "critDmg": 0.5 },
  "kit": {
    "basic":    { "name": "별가루 화살", "description": "...", "targeting": "enemy_single", "effects": [{ "type": "damage", "mult": 1.0 }] },
    "skill":    { "name": "별실 매듭", "targeting": "ally_all", "effects": [{ "type": "buff", "stat": "atk", "pct": 20, "turns": 2 }] },
    "ultimate": { "name": "소원의 별자리", "targeting": "enemy_all", "effects": [{ "type": "damage", "mult": 1.6 }, { "type": "heal", "mult": 0.8, "target": "ally_all" }] } },
  "breakthroughs": [
    { "name": "반짝이는 손끝", "trigger": "onCrit", "targeting": "self", "effects": [{ "type": "energy_gain", "n": 10 }] },
    { "name": "별의 축복", "modifiers": [{ "type": "ultimate_cost", "delta": -20 }] } ] }
```
- 빠진 `stats` 칸은 희귀도 기본값, 빠진 `kit` 칸은 `balance.json`의 기본 스킬을 써요. `breakthroughs`는 최대 5개, N번째가 돌파 N단계에서 켜져요.
- 스킬에는 대기 시간(cooldown)이 없어요 (팀 SP로 조절). 예전 데이터의 cooldown은 무시돼요.
- `nameEn`, `role`(`attacker`/`defender`/`support`/`healer`), `themeColor`, `quote`, `cutout`은 뽑기 컷인과 전투 초상에 써요 (선택). 은퇴는 `"retired": true` (뽑기에서 빠지고 보유는 유지).
- 쓸 수 있는 대상·효과·발동 조건·조건·수정자는 **`js/battle/vocab.json`** 한 곳에 정의돼 있어요 (게임, 개발 도구 폼, 배포 검사, AI 초안이 모두 이 파일을 읽음).
  - 대상: `self`, `ally_single`, `ally_all`, `ally_lowest_hp`, `enemy_single`, `enemy_all`, `enemy_random_n`(+`count`), 돌파 능력만 `trigger_target`
  - 효과: `damage`, `heal`, `shield`, `buff`, `debuff`(능력치에 `spd` 포함), `energy_gain`, `sp_gain`, `advance_action`, `delay_action`, `interrupt`, `dot`, `cleanse`, `taunt` (효과마다 `target`, `chance` 선택)
  - 발동: `onBattleStart`, `onTurnStart`, `onBasic`, `onSkill`, `onUltimate`, `onCrit`, `onKill`, `onHit`, `onHpBelow`(+`pct`) · 조건 `conditions` · 횟수 `limit`
  - 상시 수정자: `action_targeting`, `ultimate_cost`, `sp_cost`, `energy_gain`, `stat_bonus`, `effect_power`, `extra_effects`
- 새 효과 종류를 추가할 때만 코드가 필요해요: `js/battle/effects/`에 모듈 하나 + `effects/index.js`에 한 줄 + `vocab.json`에 한 항목.

### `data/enemies.json` / `data/stages/` / `data/balance.json`
```json
[{ "id": "enemy_0007", "name": "왕 슬라임", "image": "assets/enemies/enemy_0007.png", "boss": true,
   "stats": { "atk": 80, "def": 30, "hp": 1500, "spd": 102 },
   "actions": { "bite": { "name": "물기", "targeting": "enemy_single", "icon": "attack", "effects": [ ... ] },
                "quake": { "name": "대지 진동", "targeting": "enemy_all", "icon": "aoe", "big": true, "effects": [ ... ] } },
   "pattern": [{ "action": "bite", "target": "lowest_hp" }, { "action": "bite" }, { "action": "quake" }],
   "phases": [{ "hpBelow": 50, "name": "분노한 왕", "pattern": [ ... ], "enterEffects": [ ... ] }],
   "enrage": { "round": 15, "effects": [{ "type": "buff", "stat": "atk", "pct": 50, "turns": 20 }] },
   "passives": [{ "name": "분노", "trigger": "onHpBelow", "pct": 50, "limit": 1, "targeting": "self", "effects": [ ... ] }] }]
```
- 적은 캐릭터와 같은 효과 엔진을 써요. `pattern` 순서대로 행동을 예고하고 반복해요. `target` 규칙: `random`(기본) / `lowest_hp` / `highest_atk` / `slot1`~`slot5`. `big: true`는 큰 공격(빨간 예고, 차단 가능).
- 보스는 `phases`(HP % 아래로 → 패턴 교체 + 들어갈 때 효과)와 `enrage`(정한 라운드부터 효과)를 쓸 수 있어요. 패시브는 항상 켜져 있어요. 그림이 없으면 기본 카드로 보여요.
- 예전 `kit` 형식도 읽어요 (기본 패턴으로 바뀜). 개발 도구 적 탭에서 저장하면 새 형식이 돼요.

모험 스테이지는 챕터 파일로 나뉘어요: `data/stages/index.json`(`["ch01", ...]`) + `data/stages/ch01.json`
```json
{ "chapter": "ch01", "title": "챕터 1: 청구서는 피로 쓴다",
  "stages": [{ "id": "stage_0004", "name": "암시장 뒷골목 소탕", "storyId": "story_0004", "recommendedPower": 4050,
               "waves": [[{ "enemyId": "enemy_0001", "level": 4 }], [{ "enemyId": "enemy_0002" }]],
               "roundLimit": 20, "rewards": { "tickets": 55, "gems": 0, "gold": 550 }, "firstClearRewards": { "tickets": 190, "gems": 50, "gold": 1900 } }] }
```
- **스테이지 1개 = 메인 스토리 1개(`storyId`) + 그 스토리 안의 전투 장면 1개**. 메인 스토리마다 전투 장면이 정확히 하나 있어야 해요 (배포 검사가 확인).
- 웨이브는 최대 6명. `level`을 비우면 추천 전투력으로 계산해요. `roundLimit`(라운드)을 넘기면 패배, `null`이면 제한 없음.
- 보상 묶음(스테이지, 우편, 상점)에는 `gems`, `tickets`, `gold`, `scrolls`(모집 증서)를 쓸 수 있어요.
- `balance.json`: 뽑기(확률/천장/비용/10연 확정/픽업), 성장률, 희귀도 기본 능력치(속도 포함), 레벨업 비용, 정수→티켓, 출석, 전투력 가중치, 전투(기력/SP/타임라인/연출 시간), 기본 스킬. 형식은 `js/config.js`의 DEFAULTS.

### `data/banners.json`
```json
[{ "id": "banner_0004", "title": "별빛 축제 픽업", "type": "pickup",
   "pickupIds": ["char_0007", "char_0006"],
   "startAt": "2026-11-15T00:00:00+09:00", "endAt": "2026-12-07T00:00:00+09:00",
   "bannerImage": "assets/banners/banner_0004.jpg", "description": "설명",
   "relatedStoryId": "story_0013" }]
```
- `type`은 `standard`(상시) 또는 `pickup`(픽업)이에요.
- **자동 로테이션 픽업**: `pickupIds` 대신 `"rotation": { "rarity": 5, "count": 2, "days": 7, "anchor": "2026-11-16T00:00:00+09:00" }`.
  - `anchor`부터 `days`일마다 그 희귀도의 뽑을 수 있는 캐릭터(공개 시각 → id 순서)에서 다음 `count`명이 픽업돼요. 새 캐릭터는 자동으로 순서에 들어가요.
  - 남은 시간은 이번 로테이션이 끝나는 시각이에요. 대상 캐릭터가 없으면 배너가 숨겨져요. 그림이 없으면 픽업 캐릭터 그림이 배너에 보여요.
- 진행 중인 배너만 홈 캐러셀에 남은 시간과 함께 보여요. 시작 전이거나 끝난 배너는 숨겨져요.
- 진행 중인 상시 배너가 없으면 기본 상시 모집이 자동으로 나와요.

### `data/stories/index.json` + `data/stories/<id>.json`
```json
[{ "id": "story_0002", "kind": "main", "chapter": 2, "title": "골목길의 길잡이", "summary": "한 줄 소개",
   "characterId": null,
   "unlock": [{ "type": "prevChapter" }],
   "reward": { "gems": 50 } }]
```
- `kind`는 `main` / `character` / `event` 중 하나예요. 캐릭터 스토리는 `characterId`가 필요해요.
- `unlock`에는 조건을 여러 개 넣을 수 있고, 모두 만족해야 열려요.
  - `{ "type": "prevChapter" }`: 같은 묶음의 이전 장을 읽어야 해요.
  - `{ "type": "ownsCharacter", "characterId": "char_0007" }`: 그 캐릭터를 보유해야 해요.
  - `{ "type": "period", "startAt": "...", "endAt": "..." }`: 기간 한정이에요. 시작 전에는 목록에서 숨겨지고, 끝난 뒤에는 이미 읽은 사람만 다시 볼 수 있어요.

본문(`stories/story_0002.json`):
```json
{ "id": "story_0002", "title": "골목길의 길잡이",
  "scenes": [
    { "id": "s1", "background": { "type": "color", "value": "#3a2f5c" },
      "lines": [
        { "speaker": "narrator", "text": "지문" },
        { "speaker": "r_doha", "text": "대사", "side": "right" },
        { "speaker": "r_mina", "text": "어떻게 할까?",
          "choices": [{ "text": "솔직하게 말한다", "goto": "honest" }, { "text": "괜찮은 척한다", "goto": "pretend" }] }
      ] },
    { "id": "honest", "background": { "type": "image", "value": "assets/bg/bg_0002.jpg" }, "next": "merge", "lines": [ ... ] }
  ] }
```
- `speaker`에는 캐릭터 id 또는 `"narrator"`를 써요.
- `name`으로 표시 이름을 바꿀 수 있어요(예: `"???"`). `side`는 `left` 또는 `right`예요.
- 장면은 순서대로 진행돼요. `next`로 다른 장면에 합류하거나 `"end"`로 끝낼 수 있어요.
- 선택지의 `goto`에는 장면 id나 `"end"`를 써요.
- 전투 장면: `{ "id": "b1", "type": "battle", "stageId": "st_story_0002_1", "next": "merge" }`. 이겨야 다음 장면으로 가요. 건너뛰기(S)는 다음 선택지나 아직 깨지 않은 전투에서 멈춰요.

### `data/notices.json` / `data/mail.json` / `data/version.json`
```json
[{ "id": "notice_0001", "title": "제목", "body": "내용", "date": "2026-11-15T00:00:00+09:00", "popup": true }]
```
```json
[{ "id": "mail_0001", "title": "오픈 기념 선물", "body": "내용", "rewards": { "gems": 1000, "tickets": 100 },
   "startAt": "2026-11-15T00:00:00+09:00", "endAt": "2027-01-01T00:00:00+09:00" }]
```
```json
{ "contentVersion": 1, "patchNotes": [{ "version": 1, "date": "2026-11-15T00:00:00+09:00", "notes": ["변경 사항"] }] }
```
- 공지는 `date`부터 보여요. `popup: true`면 게임 시작 시 팝업으로 떠요("다시 보지 않기" 가능).
- 우편은 id 기준으로 한 번만 받을 수 있어요 (id는 자동, 바뀌지 않음).
- `contentVersion`이 올라가면 플레이어에게 "업데이트 내역" 팝업이 떠요. 개발 도구의 배포 탭이 자동으로 올려줘요.

### `data/shop.json` (상점 상품)
```json
{ "gold": [{ "id": "shop_0002", "name": "티켓 꾸러미", "desc": "레벨업 티켓 100장", "icon": "ticket",
             "cost": { "gold": 3000 }, "rewards": { "tickets": 100 }, "limit": { "per": "day", "count": 5 } }],
  "cash": [{ "id": "shop_0020", "category": "gems", "name": "보석 1,980개", "priceKRW": 33000,
             "rewards": { "gems": 1980 }, "firstBonus": { "gems": 1980 }, "tier": "rare", "badges": ["BEST"] }],
  "vip": [10000, 30000, 50000] }
```
- 개발 도구의 **상점 탭**에서 편집해요 (작업 공간 → 배포). 직접 고쳐도 돼요.
- `cost`: `gold` 또는 `gems` (둘 다 0이면 무료 상품). `limit.per`: `day` / `week` / `month` / `once`, 없으면 무제한.
- 캐시 상품: `category`(`featured` 추천 · `package` 패키지 · `growth` 성장 · `gems` 보석 · `pass` 월정액), `tier`(`normal` · `rare` · `legend` · `truck` 큰 카드), `badges`(리본, 최대 3개), `value`("1500%" 도장), `originalKRW`(취소선 정가), `firstBonus`(상품별 첫 구매 보너스), `requires.stagesCleared`(해금 조건), `pass`(`days`, `dailyGems`, `maxDays`).
- `icon`: `gem` · `ticket` · `gold` · `scroll` · `gift` · `chest` · `cart` · `crown` · `moon` · `sprout`. `ui.json` icons에 `shop_<icon>` 그림을 넣으면 CSS 메달 대신 그림으로 보여요.
- `image`(선택): 상품 전용 그림 (`assets/props/<id>.png` 같은 투명 PNG). 있으면 가장 먼저 쓰고, 없거나 못 불러오면 `shop_<icon>` → CSS 메달 순서로 보여요.
- 세이브는 상품 id로 구매 횟수를 기록해요 (id는 자동, 바뀌지 않음).

### `data/ui.json` (화면 디자인 에셋)
```json
{ "backgrounds": { "home": "assets/ui/bg_home.jpg", "gacha": "assets/ui/bg_gacha.jpg" },
  "icons": { "logo": "assets/ui/icon_logo.png", "gem": "assets/ui/icon_gem.png", "menu_gacha": "assets/ui/icon_menu_gacha.png" } }
```
- 게임 화면의 배경, 로고, 아이콘을 그림 에셋으로 바꿔요. 개발 도구의 **UI 에셋 탭**에서 AI로 뽑아서 채워요.
- 배경 칸: `home`, `gacha`, `reveal`, `collection`, `stories`, `mail`, `notices`, `settings`, `shop`
- 아이콘 칸: `logo`, `gem`, `menu_gacha`, `menu_collection`, `menu_stories`, `menu_mail`, `menu_notices`, `menu_settings`
- 빠진 칸이나 불러오기에 실패한 그림은 CSS 기본 디자인으로 보여요.

## 폴더 구조
```
index.html, style.css, manifest.webmanifest
js/
  main.js        시작점 (데이터 → 세이브 → 화면 → 시작 팝업)
  core/          스테이지 크기 조정, 데이터 로더/검증, 세이브, KST 시간, 난수(시드 포함), 이벤트
  systems/       게임 규칙 (재화, 가챠·픽업, 도감, 육성, 편성, 스테이지 기록, 배너 일정, 스토리 해금, 우편·공지, 상점)
  config.js      조정 수치 (balance.json 검사/기본값), 희귀도/큰 숫자 도우미
  battle/        전투 엔진 (DOM 없음, 시드로 재현): 타임라인/SP/예고, vocab.json, effects/, 대상·조건·수정자, AI, 설명 문장, 시뮬레이터, 자체 검사
  fx/            Phaser 장면 (뽑기 연출, 전투 화면, 컷인) — 연출 레이어에서만 움직임
  vendor/        phaser.min.js (3.90.0)
  ui/            화면 (홈, 뽑기, 결과, 모험, 도감, 육성, 편성, 전투, 스토리 뷰어, 우편, 공지, 설정, 상점)
data/            콘텐츠 JSON (stages/는 모험 챕터 파일)
assets/          chars/(캐릭터), banners/(배너), bg/(스토리 배경), enemies/(적), fonts/(Pretendard, OFL), icon.svg
tests/           테스트 (브라우저 tests/index.html, Node node tests/run.js) — 자세한 건 CLAUDE.md
dev/             로컬 전용 개발 도구 (dev/README.md)
```
새 기능(미션, 출석 등)은 다음 순서로 붙일 수 있어요 (상점 `systems/shop.js` + `ui/shopView.js`가 예시예요).
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
