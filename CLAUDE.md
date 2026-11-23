# Tiny Gacha — 작업 규칙 / 스키마 / 공식 / 테스트

정적 웹 가챠 게임 (빌드 단계 없음, ES 모듈) + 파이썬 개발 도구(`dev/`).
메뉴 화면은 정적 HTML/CSS, **움직임은 Phaser 장면(뽑기 연출 · 전투)에서만**.

## 작업 규칙
- 주석/화면 문구는 한국어. 빌드 단계 없음. Phaser는 `js/vendor/phaser.min.js`(3.90.0)를 `js/fx/phaserHost.js`가 처음 필요할 때 `<script>`로 불러옴.
- **조정 수치는 `data/balance.json`에만.** 코드는 `js/config.js`의 `loadConfig()` 결과(보통 `ctx.data.balance`)를 인자로 받아서 씀. 다른 파일에 숫자를 직접 쓰지 않음.
- 데이터를 고치면 **`data/`와 `dev/workspace/data/` 둘 다** (작업 공간이 배포 원본, `dev/tinydev/publish.py`가 data/로 복사). 보통은 개발 도구로.
- **id는 자동 발급**: `<종류>_<4자리>` (char / enemy / stage / story / banner / notice / mail / shop / prop / bg). 개발 도구 서버가 `store.next_id(kind)`로 발급(`POST /api/ids/new`),
  화면은 보기만. 번호는 늘기만 하고 재사용 없음 (`dev/ids.json`: next 카운터 + deleted). 서버는 발급 안 한/바뀐 id 저장을 거부(`_check_new_ids`), 배포 검사는 규칙 밖 id를 오류.
  챕터 팩은 구성안의 임시 이름 → 만들 때 `pack.assign_ids`(팩 기록의 idMap으로 이어서 만들어도 같은 id).
- id는 **바꾸지 않음**. 정말 바꿔야 하면 `data/id_aliases.json`(종류 → {예전: 새})에 남김 → 게임이 세이브를 옮김(`js/core/aliases.js remapSaveIds`, `save.migrate` 처음에 매번). 2026-11-22에 예전 id 전부를 이 규칙으로 바꿨음(별칭 파일 = 그 표, 지우지 않음). 은퇴는 `retired: true`.
- 세이브에 데이터에 없는 id가 있어도 지우지 않음 (무시만).
- **NPC 등급** (`rarity: "npc"`): 뽑기/도감/육성/편성/전투력/NEW/대표에 안 나오고 스토리 화자 · 적 연결(`enemies charId`)로만. 게임은 `data.splitCharacters`로
  `characters`/`charMap`(플레이어 캐릭터) ↔ `npcs`/`allCharMap`(전부 — 스토리 화자)을 나눔. 가챠 풀은 매번 데이터에서 만들어서 등급 1–5 ↔ NPC 전환을 바로 따라가고,
  가진 플레이어의 세이브 기록은 보관(되돌리면 그대로). 예전 `pullable: false` = NPC. 배포 검사: NPC 픽업/NPC "보유 시 해금" = 오류. `tests/npc.test.js`.
- **캐릭터 삭제** (보통은 은퇴 `retired`가 먼저): 개발 도구 삭제 → 참조(배너 픽업, 스토리 대상/해금/대사, 적 NPC 연결)가 남아 있으면 배포 검사 오류.
  배포하면 공개 그림도 삭제(공개 데이터가 쓰던 그림 중 더는 안 쓰는 것). 삭제한 id는 `dev/ids.json`(deleted)에 남고 다시 쓸 수 없음
  (세이브 기록이 새 캐릭터에 붙기 때문 — 승인 API, 챕터 팩, 배포 검사가 막음). 게임은 지워진 캐릭터를 도감/대표/NEW/편성/전투력/전투/뽑기/픽업/스토리 해금 어디에서도 쓰지 않음
  — 픽업이 전부 사라진 픽업 배너는 숨김, 지워진 캐릭터의 캐릭터 스토리·"보유 시 해금" 스토리도 숨김. `tests/deletion.test.js`.
- 순수 로직(가챠, 육성, 전투 엔진, 세이브 정리, 모험 규칙)은 DOM/Date/Math.random을 쓰지 않음 → 시드 난수(`createRng`)로 테스트.
- 새 효과: `js/battle/effects/<이름>.js` + `effects/index.js` 한 줄 + `vocab.json` 한 항목 + `tests/effects.test.js` 테스트. (개발 도구 폼/검사/AI 초안은 vocab을 읽어서 자동으로 따라옴)
- 아래 스키마/공식/규칙이 바뀌면 이 파일도 같이 고침. 전투 결과가 바뀌는 변경은 **회귀 스냅샷 차이를 확인하고** 커밋.

## 테스트
- 브라우저: 게임 폴더를 로컬 서버로 열고(`python -m http.server`) `tests/index.html` → 자동 실행. `?filter=gacha`로 일부만.
  개발 도구에서는 `http://127.0.0.1:5050/preview/tests/index.html` (작업 공간 데이터로 실행, 스냅샷 갱신 버튼이 파일로 저장).
- Node(설치했다면): `node tests/run.js [이름 일부] [--update]` (`npm test`). `--update` = 회귀 스냅샷 갱신.
- 파일: `config` / `save`(마이그레이션) / `progression` / `gacha`(10만 회 시드 통계) / `data`(실제 데이터 + 모험 연결) / `effects`(효과마다) / `battle`(`js/battle/selftest.js` 검사 하나씩) / `snapshot`(회귀) / `deletion`(캐릭터 삭제 정리) / `aliases`(id 별칭으로 세이브 옮기기 + 지금 id가 규칙대로인지) / `npc`(NPC 등급 ↔ 1–5 전환 시 가챠 풀/플레이어 화면/적 연결).
- 새 테스트 파일은 `tests/all.js`에 한 줄. 러너 `tests/lib/runner.js`, 실제 데이터 로더 `tests/lib/gameData.js`, 전투 픽스처 `js/battle/testkit.js`, 샘플 `tests/fixtures/`.
- **회귀 스냅샷** `tests/snapshots/stages.json`: 모든 스테이지 × 기준 팀(`tests/fixtures/teams.js`) × 시드 1~3 자동 전투 (`승패 라운드 피해/…`). 다르면 실패 + 바뀐 줄 목록 → 의도한 변경이면 갱신.
- 연출 확인: `dev/fx-test.html` (정적 서버) 또는 개발 도구 `/fx-test` — 희귀도 조합 강제, 2배속, 모션 줄이기, `?auto=5&fake=1` 자동 실행.
- 게임 미리보기 주소 옵션 (localhost만): `?preview=1` (분리된 세이브, 재화 넉넉히), `&ownAll=1`, `?screen=adventure|growth|team|collection|gacha`, `?battle=stage_0004`, `?banner=<id>`, `?story=<id>`, `?now=<ISO 시각>`.
- 콘솔: `__tg.simulate(100000[, 배너])`, `__tg.sim(스테이지, N)`, `__tg.battleTest()`.

## 스키마

### data/balance.json (형식 = `js/config.js` DEFAULTS, 예전 평평한 형식도 읽음)
```
gacha:   { rates:{1..5: %}, cost:{single, ten}, pity, tenGuaranteeMin, pickupShare }
stats:   { growth, byRarity:{1..5:{atk,def,hp,spd}}, critRate, critDmg }
level:   { costBase, costExp, goldPerTicket }
essence: { maxBreakthrough, overflowTickets:{1..5} }
daily:   { tickets, gold }
power:   { atk, def, hp, spd, critRate, critDmg }      // 전투력 가중치
powerWarnPct                                           // 같은 희귀도 평균보다 이 % 넘으면 개발 도구 경고 (15)
combat:  { avBase, roundAv, queuePreview, maxRounds,
           energy:{max,basic,skill,hit,ultimateCost}, sp:{start,max,basicGain,skillCost},
           enemyLevel:{refPower, perLevel}, fx:{actionMs,cutinMs} }
defaultKit: { basic, skill, ultimate }                  // 스킬이 없는 캐릭터용
```

### characters.json 항목
```
id, name, rarity: 1–5 | "npc" (예전 'R'/'SR'/'SSR' → 3/4/5, 예전 pullable:false → "npc"), title, description, image, addedAt,
retired (true = 뽑기 제외, 보유 유지),            // 게임 데이터의 pullable은 계산값 (= NPC 아님). 파일에는 쓰지 않음
nameEn, role (attacker|defender|support|healer), cutout, themeColor, quote,   // 컷인/전투 초상용, 선택
stats { atk, def, hp, spd, critRate, critDmg } (선택, 없으면 희귀도 기본값),
kit { basic, skill, ultimate:{…, cost?} } (선택, 없으면 defaultKit), breakthroughs [패시브 × 5]
```
- Skill = `{ name, description, targeting, count?, effects[] }` — **cooldown 없음** (스킬은 팀 SP. 예전 cooldown은 경고 후 무시)
- Effect = `{ type, ...params, target?, chance? }` / Passive = `{ name, description, trigger?, pct?, conditions[], targeting, count?, effects[], modifiers[], limit? }`

### enemies.json 항목
```
id, name, image, boss, charId? (NPC 캐릭터 연결 — 적 그림이 없으면 그 그림, data.linkEnemyNpcs), stats {…, spd},
actions { <id>: Skill & { icon: attack|aoe|buff|heal|debuff, big?: true } },
pattern [ { action, target?: random|lowest_hp|highest_atk|slot1..5 } ]       // 순서대로 예고 → 반복
phases  [ { hpBelow: 1–99, name, pattern, enterEffects[] } ]                  // 보스: HP % 미만이면 교체
enrage  { round, effects[] } | null                                           // 그 라운드부터 효과 (자신)
passives [Passive]                                                            // 항상 켜짐
```
NPC 연결 적은 보통 `image`를 비워 둠(= NPC 그림, NPC를 다시 뽑으면 전투에도 반영). 개발 도구 일괄 생성은 그런 적을 빼고 NPC 항목에 "적 겸용"으로 표시, 적 전용 그림은 덮어쓰기(배포 검사 경고, 적 탭 "NPC 그림으로 되돌리기").
예전 `kit{basic,skill,ultimate}`는 읽을 때 actions + 기본 패턴 `[basic, basic, skill(, ultimate=big)]`으로 바뀜 (`schema.cleanEnemyBehavior`).

### 모험 스테이지: data/stages/index.json + data/stages/<챕터>.json
```
index.json: ["ch01", …]
ch01.json:  { chapter: "ch01", title, stages: [ { id, name, storyId, recommendedPower,
              waves: [[{ enemyId, level? }]], roundLimit?, rewards{tickets,gems,gold,scrolls}, firstClearRewards, retired? } ] }
```
- **스테이지 1개 = 메인 스토리 1개(storyId) = 그 스토리 안의 전투 장면 `{type:"battle", stageId}` 1개.** 메인 스토리마다 전투 장면은 정확히 1개. 선택지가 전투 장면을 건너뛰면 안 됨. (`js/systems/adventure.js adventureIssues`, `dev/tinydev/validate.py _check_adventure`, `tests/data.test.js`)
- 챕터 제목: 스토리 목록의 `arcTitle`은 제목만 (게임이 "챕터 N · "을 붙임, `store.strip_chapter_prefix`), 챕터 파일 `title`은 "챕터 N: 제목" (`store.chapter_title` — "챕터 ch02" 같은 임시 제목은 없는 것으로 봄).
- 스토리 파일 이름 = 안의 `id` = 목록 id (`data/stories/<id>.json`). 손으로 이름을 바꾸지 않음.
- `level`이 없으면 `config.enemyLevelFor`: `max(1, round(1 + (추천 전투력 ÷ 5 − refPower) ÷ perLevel))`.
- 개발 도구 안에서는 모든 챕터를 한 목록(항목마다 `chapter`)으로 다룸: `store.read_list("stages")` / `write_list("stages")`가 챕터 파일로 나눠 저장. 예전 `data/stages.json`도 읽음.

### 세이브 (localStorage `tinygacha_save_v2`, 안의 `v` = schemaVersion, 지금 3)
```
v, gems, tickets, gold, scrolls, createdAt, lastLoginDate,
owned { id: { level, essence, breakthrough, count, firstAt } },
pity { standard, pickup }, guaranteed { pickup }, teams { active, presets[3] { name, slots[5] } },
stages { id: { clears, firstClaimed, bestRounds } }, readStories, claimedMail, hiddenNotices, …,
settings { fxSpeed: 1|2, fxSkip, battleSpeed: 1|2, battleAuto }
```
마이그레이션 `MIGRATIONS` (한 칸씩, 순서대로): 1→2 중복→정수(넘치면 희귀도별 티켓), 2→3 settings 추가.
새 버전: 목록 끝에 `{from, to, run}` + `SAVE_VERSION` 올림 + `tests/save.test.js` 케이스. 세이브 코드 `TG2:`(v2·v3), 예전 `TG1:`도 읽음.

## 공식 / 규칙

### 가챠 (`js/systems/gacha.js`, 순수 · 시드)
- 확률 1★ 40 / 2★ 30 / 3★ 20 / 4★ 8 / 5★ 2 %. 색 토큰 `--rar-1..5` (회색/초록/파랑/보라/금) + `--rar-npc`, 클래스 `.rar-1..5` / `.rar-npc`.
- 풀(`buildPools`)/로테이션/픽업에서 NPC 등급 · 은퇴는 빠짐 (`config.isNpc`, `banners.isPullable`). 등급 도우미: `config.normalizeGrade / isNpc / gradeRank / rarityLabel`.
- 천장: 배너 종류(상시/픽업)별 카운터, 5★ 없이 70번째 = 5★. 10연: 앞 9장에 4★+ 없으면 10번째는 4★/5★ (8:2).
- 픽업: 5★일 때 확정이면 픽업, 아니면 50%, 놓치면 다음 5★ 확정. 빈 희귀도 → 가까운 낮은 희귀도 → 가까운 높은 희귀도.
- 실제 5★ 비율은 천장/확정 때문에 약 3%. 지금 1·2★ 캐릭터가 없어서 그 몫은 3★로 대체됨 (가챠 시뮬로 확인).
- 중복: 정수 +1, 보유 가능 = 5 − 돌파, 넘치면 바로 티켓 (5★ 200 / 4★ 80 / ≤3★ 30). 돌파: 정수 1 → +1단계(최대 5), 단계마다 패시브 하나.

### 육성
- atk/def/hp = floor(floor(base × (1 + 0.08 × (lv − 1))) × (1 + 상시 보너스%)). spd/치명타는 레벨과 무관.
- 레벨업 lv→lv+1: 티켓 ceil(10 × lv^1.25), 골드 = 티켓 × 10. 전투력 = floor(2·atk + 1.5·def + 0.2·hp + 2·spd + 300·critRate + 100·critDmg). 큰 숫자 `formatBig` (1.2만, 3.4억).

### 전투 (`js/battle/engine.js`, 순수 · 시드 · 결정론)
- 타임라인: av = avBase(10000) ÷ 속도. 가장 작은 av가 행동 → 모두 그만큼 차감 → 행동한 유닛은 다시 한 턴. 동점은 아군 → 적, 칸 순.
  속도 강화/약화가 바뀌면 남은 av × (이전 속도 ÷ 새 속도). advance/delay_action(p%) = 한 턴 길이의 p%만큼 당김/밈 (행동 중인 유닛이면 다음 턴에 반영).
- 라운드 = 흐른 av ÷ roundAv(100) 올림. roundLimit 초과 → 패배(timeout). maxRounds 안전장치.
- 팀 SP: 시작 3, 최대 5. 기본 공격 +1, 스킬 −1(+ `sp_cost` 수정자), SP 부족하면 스킬 불가(기본 공격으로).
- 기력: 기본 +20, 스킬 +30, 피격 +10, 최대 100. 궁극기 = 기력 ≥ 비용이면 아군 입력 중 아무 때나, 턴을 쓰지 않음.
- 피해 = floor(S × 배율 × 100/(100+방어) × (치명 ? 1+critDmg : 1) × (1+주는 피해) × (1+받는 피해)), 최소 1, 타마다 치명 판정, 보호막이 먼저 흡수.
- 지속 시간은 가진 유닛의 턴 끝에 −1 (자기 턴에 받은 건 그 턴엔 안 줄어듦). 지속 피해는 턴 시작에.
- 적: 패턴 칸을 예고(intent: 이름 · 아이콘 · big · 대상 칸 / 광역) → 자기 차례에 실행 → 다음 칸 예고. 도발 아군이 있으면 대상이 그쪽.
  `interrupt`는 예고된 big만 취소 → 그 차례 '흐트러짐'. `api.intents()`의 `eta` = 그 적보다 먼저 행동하는 횟수(0 = 다음).
- AUTO(`ai.js`): 궁극기 — 피해형은 큰 공격 예고 중이거나 쓰러뜨릴 수 있을 때, 지원형은 큰 공격 예고/HP 50% 미만 아군/강화형이면. 스킬 — SP ≥ 2 또는 치유/보호막이 필요할 때. 아니면 기본. 대상: 도발 > 처치 가능(HP 낮은 순) > HP 최저 / 아군은 HP 비율 최저.
- API: `createBattle({team, stage, data, seed})` → `current() options() targets(action, uid?) act({action,target}) ultimate({uid,target}) auto() runToEnd() queue(n) intents() summary() record()`, `replayBattle`.
- 효과: damage, heal, shield, buff, debuff, energy_gain, sp_gain, advance_action, delay_action, interrupt, dot, cleanse, taunt. 수정자: action_targeting, ultimate_cost, sp_cost, energy_gain, stat_bonus, effect_power, extra_effects.

### 연출 (`js/fx/`)
- `phaserHost.js`: Phaser.Game 하나(1280×720 FIT, `#fx-layer` — CSS 확대되는 #stage 밖), 글꼴 Pretendard(FontFace)를 먼저 불러옴, 끝나면 레이어 숨기고 루프 재움. 레이어가 떠 있으면 `main.js` 키 처리는 Phaser에 양보.
- `GachaFxScene.js`: 진입 → 희귀도 암시(5★ 30% 보라→금, 4★+ 흔들림/진동) → 폭발(섬광·빛줄기·충격파·Bloom) → 카드(1회 자동 / 10회 탭으로 모두, Shine/Glow, 별 찍기) → 컷인(모든 5★ + 새 4★) → `gachaFxComplete`. SKIP/탭/2배속/모션 줄이기.
- `CutIn.js`: 재사용 컷인 (가챠 full, 전투 궁극기 short ≤1초). `BattleScene.js`: 전투 화면 (사양 배치), 행동 연출 ≤0.5초, 2x는 timeScale.
- HTML 쪽: `ui/gachaView.js revealScreen`(연출 → 결과 격자), `ui/battleView.js mountBattle`(장면 → 결과/보상), 실패하면 연출 없이 결과만.

## 개발 도구 (dev/)
- 희귀도 `tinydev/rarity.py`, 전투 검사 `tinydev/kit.py`(vocab 기반, 적 actions/pattern/phases/enrage), 콘텐츠 검사 `tinydev/validate.py`(모험 규칙 포함), 배포 `publish.py`(스테이지 챕터 파일, 밸런스 변경 요약 패치노트).
- 웹: 캐릭터 전투 편집(`web/js/battleEditor.js` + `battleForm.js`), 적 편집(행동/패턴/페이즈/광폭화), 스테이지(챕터/연결 스토리/자동 레벨), 밸런스(전투 시뮬, 가챠 시뮬, 전투력 표, balance.json 편집), `/fx-test`, `/preview/tests/`.
- 개발 도구 웹은 `/preview/js/...`로 게임 모듈을 그대로 import (progression, schema, data, sim, gacha).
- 배경 제거 `tinydev/cutout.py`: RMBG에서는 마스크만 → 원본 W×H로 LANCZOS 확대 → 1px 깎기 + 1px 부드럽게(`config.CUTOUT_*`) → **칠하지 않은 원본**에 알파로 적용(크기 다르면 오류) → 투명 여백 자르기.
  캐릭터/적은 줄이지 않음(원본 해상도), 소품 384 · UI 아이콘 256 · 로고 640만 줄임. 예전 512px 그림 다시 만들기: `python -m tinydev.recut [--dry-run]`.

## 구현 단계 (사양 Build order)
| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | config.js, 희귀도 1–5, 세이브 v3 + 마이그레이션 목록, 테스트 러너/샘플 | ✅ |
| 2 | 가챠 모듈 + 테스트 + 확률표 | ✅ |
| 3 | Phaser GachaFxScene + 컷인 + fx-test + 결과 격자 | ✅ |
| 4 | 효과/전투 엔진 (타임라인, SP, 궁극기, 예고/패턴/페이즈/광폭화/차단) + 테스트 | ✅ |
| 5 | Phaser BattleScene (AUTO, 2x, 즉시 결과, 일시정지, 컷인) | ✅ |
| 6 | 육성/편성/도감/홈 메뉴 | ✅ |
| 7 | 모험 (스테이지 = 스토리 1 + 전투 1, 챕터 파일) | ✅ |
| 8 | 개발 도구 (편집기, 가챠/밸런스 시뮬, 검사, 패치노트) | ✅ |
| 9 | 회귀 스냅샷 + 이 문서 | ✅ |

## 알아 둘 것 (남은 일)
- 1★/2★ 캐릭터가 아직 없음 → 그 확률은 3★로 대체됨.
- 실제 캐릭터에 kit/돌파 능력이 아직 없음 (모두 기본 스킬) → 개발 도구 AI 초안으로 채우기.
- 지금 스테이지는 Lv.1 팀으로도 거의 다 이김 (밸런스 탭/스냅샷으로 조정).
- `enemy_0006`(광휘교단 이단 사냥꾼, 1-7 적) 그림은 작업 공간에만 있음 → 배포하면 공개됨.
- 1-1/1-2/1-3/1-5/1-7 스토리의 전투 장면과 도입 대사(b0)는 초안 — 스토리 탭에서 다듬기.
