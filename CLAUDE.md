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
- 파일: `battleUi`(전투 화면 순수 부분: 장면 묶기 · 카드 배치 · 숫자 위치 · 순서 칩) / `config` / `stats`(능력치 모델) / `kitgen`(아키타입 생성기 · 번들 분리) / `memory`(추억) / `gear`(장비 · 드롭 · 반복/소탕) / `tuner`(적 아키타입 · 기대 성장 · 튜너) / `save`(마이그레이션) / `progression` / `gacha`(10만 회 시드 통계) / `data`(실제 데이터 + 모험 연결) / `effects`(효과마다) / `battle`(`js/battle/selftest.js` 검사 하나씩) / `snapshot`(회귀) / `deletion`(캐릭터 삭제 정리) / `aliases`(id 별칭으로 세이브 옮기기 + 지금 id가 규칙대로인지) / `npc`(NPC 등급 ↔ 1–5 전환 시 가챠 풀/플레이어 화면/적 연결) / `profile`(프로필 정리 · 검사 · 해금 · 화면 데이터 · profileSeen).
- 개발 도구 파이썬 테스트: `dev/.venv/Scripts/python -m unittest discover -s dev/tests -t dev` (프로필 검사, 글 모델 고르기, 프롬프트 내용, 검수 구조 잠금).
- 새 테스트 파일은 `tests/all.js`에 한 줄. 러너 `tests/lib/runner.js`, 실제 데이터 로더 `tests/lib/gameData.js`, 전투 픽스처 `js/battle/testkit.js`, 샘플 `tests/fixtures/`.
- **회귀 스냅샷** `tests/snapshots/stages.json`: 모든 스테이지 × 기준 팀(`tests/fixtures/teams.js`) × 시드 1~3 자동 전투 (`승패 라운드 피해/…`). 다르면 실패 + 바뀐 줄 목록 → 의도한 변경이면 갱신.
- 연출 확인: `dev/fx-test.html` (정적 서버) 또는 개발 도구 `/fx-test` — 희귀도 조합 강제, 2배속, 모션 줄이기, `?auto=5&fake=1` 자동 실행.
  전투 화면: `dev/battle-ui-test.html` 또는 개발 도구 `/battle-ui-test` — 연출별 반복(`js/fx/battleDemo.js`, 엔진 상태는 안 바뀜), 2배속/동작 줄이기, 1280×720 ↔ 844×390, fps,
  `?auto=all[&speed=2&reduced=1&end=1]` = 전부 차례로 → `#result`에 오류 목록 (자동 확인용), `?stage=<id>`, `?demo=<이름>`.
- 게임 미리보기 주소 옵션 (localhost만): `?preview=1` (분리된 세이브, 재화 넉넉히), `&ownAll=1`, `?screen=adventure|growth|team|collection|gacha`, `?battle=stage_0004`, `?banner=<id>`, `?story=<id>`, `?now=<ISO 시각>`.
- 콘솔: `__tg.simulate(100000[, 배너])`, `__tg.sim(스테이지, N)`, `__tg.battleTest()`.

## 스키마

### data/balance.json (형식 = `js/config.js` DEFAULTS, 예전 평평한 형식도 읽음)
```
gacha:   { rates:{1..5: %}, cost:{single, ten}, pity, tenGuaranteeMin, pickupShare }
stats:   { growth, byRarity:{1..5:{atk,def,hp,spd}} (적/레거시 기본값), critRate, critDmg,
           rarityMul:{1..5}, roleTemplate:{attacker|defender|support|healer: {능력치 11개}}, tweakWarnPct }
level:   { costBase, costExp, goldPerTicket }
essence: { maxBreakthrough (≤ MAX_BREAKTHROUGH 6), overflowTickets:{1..5} }
daily:   { tickets, gold }
power:   { atk, def, hp, spd, critRate, critDmg, energyRegen(1 넘는 만큼), effectHit, effectRes, healBonus, shieldBonus }  // 전투력 가중치
powerWarnPct                                           // 같은 희귀도 평균보다 이 % 넘으면 개발 도구 경고 (15)
combat:  { avBase, roundAv, queuePreview, maxRounds,
           energy:{max,basic,skill,hit,ultimateCost}, sp:{start,max,basicGain,skillCost},
           enemyLevel:{refPower, perLevel}, fx:{actionMs,cutinMs} }
defaultKit: { basic, skill, ultimate }                  // 스킬이 없는 캐릭터용
breakthrough: { statNodes:{역할: [{stat, pct} × 4] (돌파 1·3·4·5)}, lowRarityBoost:{1..5} }
kitBudget:  { points:{효과: 점수}, statWeight, targetFactor, caps:{basic,skill,ultimate,talent,bt2,bt6,signature}, rarityFactor:{1..5}, tolerancePct }
memory:     { maxLevel, growth, atkBase:{3..5}, secondary:{3..5}, secGrowth, cost:{costBase,costExp,goldPerTicket}, refineScale[5], overflowMaterial:{3..5}, materialTickets }
memoryGacha:{ rates:{3..5: %}, cost, pity, tenGuaranteeMin, pickupShare }
gear:       { tiers, maxEnh, slotBase:{hp|def|crit|atk: {능력치: 값}}, tierMul, enhStep, enhCost, salvage, drop:{count, rates, matPerClear}, regionTier:{챕터: 티어} }
stars: { star3Ratio }   repeat: { maxRuns }
enemy:      { base:{atk,def,hp,spd}, archetypes:{grunt|brute|caster|healer|shielder|assassin|elite|boss: 배율} }
expected:   { levelStart, levelPerStage, breakthrough:{1..5}, memory:{rarity,levelRatio,refine}, gearEnhPerStage }
tuner:      { targetWinRate:{normal,elite,boss}, runs, tolerance, difficulty:{min,max}, maxIter }
```
- `loadConfig`의 새 묶음은 `like()`(기본값 모양만 남김, 숫자 0 이상)로 정리. 개발 도구 밸런스 탭은 이 묶음들을 JSON으로 편집.

### characters.json 항목
```
id, name, rarity: 1–5 | "npc" (예전 'R'/'SR'/'SSR' → 3/4/5, 예전 pullable:false → "npc"), title, description, image, addedAt,
retired (true = 뽑기 제외, 보유 유지),            // 게임 데이터의 pullable은 계산값 (= NPC 아님). 파일에는 쓰지 않음
nameEn, role (attacker|defender|support|healer, 기본 attacker), cutout, themeColor, quote,   // 컷인/전투 초상용, 선택
cardCrop { y: 0–0.5 } (전투 카드 그림을 위에서 얼마나 내려 자를지 — 얼굴이 잘릴 때, 선택. 적도 같음),
statTweak { 능력치: % } (±10% 넘으면 경고), stats { 능력치 11개 } (절대값 — 있으면 역할 템플릿 대신),
archetype, kitGen { archetype, variants, seed, version } (생성기 기록), resource { name, cap, start },
kit { basic, skill, ultimate:{…, cost?}, transformed? } (없으면 defaultKit), talents [상시 패시브 ≤4], bt2, bt6 (돌파 2·6),
breakthroughs [패시브 ≤6] (예전 방식),
profile { facts{age,height,origin,affiliation,likes[],dislikes[],hobby}, stories[{title,text,unlock:{breakthrough 1–6}} ≤3],
          lines{obtain,team,levelUp,breakthrough,battleStart,ultimate,idle[]}, relations[{id,label,note} ≤6], voice{…}, version }   // CHARACTER_PROFILE.md
```
- 프로필(`js/systems/profile.js`, 순수): 게임은 facts/stories/lines/relations만 읽음(`cleanProfile`, 길이 제한 `PROFILE_LIMITS`), `voice`(작가용 말투 카드)는 배포 때 빠짐(`profile.strip_voice`).
  NPC는 voice만. `quote`가 비어 있으면 `lines.obtain`(`quoteOf`). 해금: 보유 = facts · lines, 돌파 = `stories[].unlock.breakthrough`(기본 1/3/6), 관계 = 상대도 보유(NPC 상대는 바로).
  검사: 게임 `profileIssues` = 개발 도구 `tinydev/profile.py issues`(같은 규칙). 배포 검사 오류 = 길이 · 형식 · relations id · voice.address 키(캐릭터 id 또는 `protagonist`) · unlock 1~6, 경고 = 프로필 없음 / voice 없음 / weakness · never 빈 칸.
- Skill = `{ name, description, targeting, count?, effects[], useIf?[조건] }` — **cooldown 없음** (스킬은 팀 SP. 예전 cooldown은 경고 후 무시)
- Effect = `{ type, ...params, target?, chance? }` / Passive = `{ name, description, trigger?, pct?, conditions[], targeting, count?, effects[], modifiers[], limit?, perRound? }`

### enemies.json 항목
```
id, name, image, boss, charId? (NPC 캐릭터 연결 — 적 그림이 없으면 그 그림, data.linkEnemyNpcs), archetype?, resource?, stats {…, spd, effectRes?},
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
- 전투 배경 `background?`(스테이지 전용 그림, 개발 도구가 `assets/battle/<스테이지 id>.jpg`로 저장, 장면 설명 메모 `backgroundPrompt`는 배포 때 빠짐).
  게임은 `adventure.battleBackgrounds({stage, story, ui})` = 스테이지 전용 → 스토리 배경(`storyBattleBackground`: 전투 장면 그림 → 가까운 앞 장면 → 뒤 장면) → `ui.json backgrounds.battle`(기본, 선술집 테이블) 순서로 시도.
- `level`이 없으면 `config.enemyLevelFor`: `max(1, round(1 + (추천 전투력 ÷ 5 − refPower) ÷ perLevel))`.
- 개발 도구 안에서는 모든 챕터를 한 목록(항목마다 `chapter`)으로 다룸: `store.read_list("stages")` / `write_list("stages")`가 챕터 파일로 나눠 저장. 예전 `data/stages.json`도 읽음.

### memories.json 항목 (추억 카드 — 무기 대신, 누구나 장착)
```
id (memory_0001), name, rarity 3–5, kind: default(역할 기본) | generic | signature(5★ 전용), role?(default), signatureOf?, featuredCharacterId?,
baseAtk?(없으면 balance.memory.atkBase), secondary { stat }, passive { generic, owner? }, image(.webp 카드), thumb, addedAt, retired?,
genKey (생성기 항목: generic:<key> | signature:<캐릭터 id>), theme[] (그림 장면 태그, 개발 도구 전용 — 배포 때 빠짐)
```
- 생성: `node tools/memgen/cli.js [--apply]` 또는 개발 도구 추억 탭 '생성기로 다시 만들기' (일반 라이브러리 `tools/memgen/library.js` + 5★마다 아키타입 signature 변형).
  genKey가 같으면 id · 그림 · 공개 시각 유지. id는 `dev/ids.json` memory 카운터.
- 규칙(`js/systems/memories.js`): 역할 기본 추억 캐릭터당 1장(`memGranted`, `ctx.commit`마다 확인), 중복 → 재련 +1(레벨 높은 카드) → R5면 추억 재료,
  레벨업 티켓(재료 1 = materialTickets 티켓 먼저), 재련 = 패시브 숫자 × refineScale, owner 패시브는 장착자 = signatureOf일 때만.
  능력치: 기본 공격력은 레벨 기본값에 더하고 부옵션은 %. `teams.extrasOf(ctx, id)` → 멤버 `extras` → statsOf/charPower/createBattle.
- 추억 뽑기: 배너 `category: 'memory'`, `gacha.rulesFor`(balance.memoryGacha, 1·2★ 0%), 천장 키 memory / memoryPickup, `pickupFrom`(캐릭터 픽업 배너 → 그 픽업의 전용 추억),
  진행 중인 추억 상시 배너가 없으면 `STANDARD_MEMORY_BANNER`. 뽑기 화면 캐릭터/추억 탭.
- 그림: 개발 도구 job 종류 `memory` — 등장 캐릭터 외형 슬롯(`characters.appearance {body, hair, eyes, outfit, props}`, 승인할 때 저장 / 없으면 승인 그림 프롬프트에서 한 번 만듦)
  을 프롬프트 맨 앞에 그대로 + AI(또는 theme 태그 템플릿)는 장면만 → 832×1216(1차만) → 카드 WebP 높이 1024 + 썸네일 256.
  하이레스는 선택: 검토 패널 '하이레스로 다듬기' = 그 시도 원본을 `comfy.memoryHires`(1.25× · 13스텝 · denoise 0.4)로 img2img 한 번 → 새 시도 (`imaging.hires_attempt`, `POST /api/jobs/<id>/hires`). 선택 img2img(컷아웃 합성).
  seed는 시도마다 기록, 입력 `seed`로 다시 그리기. 테두리는 게임 CSS(`.mem-card.rar-N`).

### 장비 (`js/systems/gear.js`, 클리어 처리 `js/systems/farming.js`)
- 4칸 고정 주옵션 hp · def · crit(확률+피해) · atk, 티어 T1–T`gear.tiers`, 강화 +0–+`maxEnh`. 수치 = slotBase × tierMul^(티어−1) × (1 + enhStep × 강화), 고정값 (stats.gearPieceStats).
- 세이브는 개수로 쌓음 `gear['atk.3.2'] = {n, lock}`, 장착하면 하나 빠짐 → `equips[id].g.atk = '3.2'`. 자동 장착(칸마다 티어 → 강화), 강화(강화석), 분해(기본 + 쓴 강화석 × enhRefund, 잠금 제외), 일괄 분해(티어 이하).
- 드롭: 지역 = 챕터, 지역 티어 = 챕터 순서 + 1(`gear.regionTier` 덮어쓰기), [티어−1, 티어] 비율 rates.normal / 챕터 마지막 스테이지 rates.boss + count.boss, 강화석 matPerClear × 티어. 칸은 무작위.
- 별점: ★1 승리 · ★2 쓰러진 아군 없음 · ★3 + 라운드 ≤ ceil(제한 × star3Ratio). `stages[id].stars` = 최고.
- `farming.clearStage(ctx, stage, summary, rand)` = 별점 + recordClear + 드롭 (스토리 전투 · 반복 · 소탕 공용). 반복 전투 = `sim.runOne` AUTO, 렌더 없음, 지면 멈춤. 소탕 = ★3만, 전투 없이. 스태미나 없음.
- 화면: 육성 장비 탭(키 5), 모험에서 클리어한 스테이지 → 스테이지 창(드롭 표 · 반복 N · 소탕 N · 스토리 다시 보기), 전투 결과에 별점 · 드롭.

### 세이브 (localStorage `tinygacha_save_v2`, 안의 `v` = schemaVersion, 지금 4)
```
v, gems, tickets, gold, scrolls, createdAt, lastLoginDate,
owned { id: { level, essence, breakthrough(0–6), count, firstAt } },
pity { standard, pickup, memory, memoryPickup }, guaranteed { pickup, memoryPickup }, teams { active, presets[3] { name, slots[5] } },
stages { id: { clears, firstClaimed, bestRounds, stars } }, readStories, profileSeen { 캐릭터 id: [읽은 프로필 이야기 번호] }, claimedMail, hiddenNotices, …,
settings { fxSpeed: 1|2, fxSkip, battleSpeed: 1|2, battleAuto },
memories [{ u: 'm<n>', id, lv, r }], memSeq, memMat, memGranted[], gear { '<칸>.<티어>.<강화>': { n, lock } }, gearMat,
equips { 캐릭터 id: { m: 추억 u | null, g: { hp|def|crit|atk: '<티어>.<강화>' | null } } }
```
마이그레이션 `MIGRATIONS` (한 칸씩, 순서대로): 1→2 중복→정수(넘치면 희귀도별 티켓), 2→3 settings 추가, 3→4 추억 · 장비 · 장착 · 추억 천장 · 별점 자리.
새 버전: 목록 끝에 `{from, to, run}` + `SAVE_VERSION` 올림 + `tests/save.test.js` 케이스. 세이브 코드 `TG2:`(v2–v4), 예전 `TG1:`도 읽음.
저장: `ctx.commit()`은 500ms 모아서 한 번 쓰기, 화면 숨김/pagehide 때 바로(`ctx.flush()`). 세이브 교체/초기화는 바로 저장.

## 공식 / 규칙

### 가챠 (`js/systems/gacha.js`, 순수 · 시드)
- 확률 1★ 40 / 2★ 30 / 3★ 20 / 4★ 8 / 5★ 2 %. 색 토큰 `--rar-1..5` (회색/초록/파랑/보라/금) + `--rar-npc`, 클래스 `.rar-1..5` / `.rar-npc`.
- 풀(`buildPools`)/로테이션/픽업에서 NPC 등급 · 은퇴는 빠짐 (`config.isNpc`, `banners.isPullable`). 등급 도우미: `config.normalizeGrade / isNpc / gradeRank / rarityLabel`.
- 천장: 배너 종류(상시/픽업)별 카운터, 5★ 없이 70번째 = 5★. 10연: 앞 9장에 4★+ 없으면 10번째는 4★/5★ (8:2).
- 픽업: 5★일 때 확정이면 픽업, 아니면 50%, 놓치면 다음 5★ 확정. 빈 희귀도 → 가까운 낮은 희귀도 → 가까운 높은 희귀도.
- 실제 5★ 비율은 천장/확정 때문에 약 3%. 지금 1·2★ 캐릭터가 없어서 그 몫은 3★로 대체됨 (가챠 시뮬로 확인).
- 중복: 정수 +1, 보유 가능 = 6 − 돌파, 넘치면 바로 티켓 (5★ 200 / 4★ 80 / ≤3★ 30). 돌파: 정수 1 → +1단계(최대 6, `MAX_BREAKTHROUGH`).
  1·3·4·5 = 역할 능력치 노드(`balance.breakthrough.statNodes` × `lowRarityBoost`, 실행 시 공식), 2 = `bt2`(메커니즘 강화), 6 = `bt6`(메커니즘 변형).
  화면용 칸 목록 `progression.breakthroughNodes`.

### 육성 / 능력치 (`js/systems/stats.js computeStats`, `progression.statsOf`는 래퍼)
- 능력치 11개: atk, def, hp, spd, critRate, critDmg, energyRegen(기본 1), effectHit, effectRes, healBonus, shieldBonus.
- 기본: 캐릭터에 `role`이 있고 절대값 `stats`가 없으면 `round(rarityMul[희귀도] × roleTemplate[역할][능력치] × (1 + statTweak%))` (희귀도 배율은 atk/def/hp만).
  절대값 `stats`가 있으면 그 값(적, 예전 데이터, 테스트), 빠진 칸은 `byRarity` / 기본값.
- 최종 = floor((floor(기본 × (1 + 0.08 × (lv − 1))) + 추억 공격력) × (1 + Σ%)) + Σ장비. Σ% = 돌파 1·3·4·5 노드 + `stat_bonus` + 추억 부옵션.
  비율 능력치는 % 포인트(+6 → +0.06), spd/비율 능력치는 레벨과 무관.
- 상시 능력(`activePassives`): 적 = passives / 캐릭터 = talents + bt2(돌파 2+) + bt6(돌파 6) + 예전 breakthroughs[0..돌파−1] + 바깥(추억).
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
- 효과: damage(perStack, vsMarked), heal, shield(perStack), buff, debuff, energy_gain, sp_gain, advance_action, delay_action, interrupt, dot, cleanse, taunt,
  stack_gain, stack_spend, mark, mark_detonate, follow_up, counter, transform, charge, summon. 수정자: action_targeting, ultimate_cost, sp_cost, energy_gain, stat_bonus, effect_power, extra_effects.
- 발동: onBattleStart, onTurnStart, onBasic, onSkill, onUltimate, onCrit, onKill, onHit, onHpBelow, onAllyAttack(다른 아군이 상대를 공격한 뒤), onStackFull(가득 찬 순간 한 번).
  패시브 `limit`(전투당) / `perRound`(라운드당). 조건에 stacks_at_least, stacks_full, target_marked, is_transformed, sp_at_least 추가.
- 새 능력치: 기력 획득 × energyRegen, 치유 × (1 + healBonus), 보호막 × (1 + shieldBonus).
  효과 적중: 상대에게 거는 debuff/dot/delay_action/mark = 확률 × (1 + effectHit) × (1 − effectRes), 대상마다. 1 이상이면 난수 안 굴림, 실패 = 'resist' 이벤트.
- 자원(스택): 키트 `resource {name, cap, start}` → 유닛 `res`. 표식: 대상 `marks[{src, n, turns}]` (대상 턴 끝에 −1).
  변신: `kit.transformed {basic?, skill?, ultimate?}`로 turns턴 교체 (자기 턴 끝에 −1, 받은 턴엔 안 줄어듦).
- 반응 큐(follow_up/counter): 행동이 끝난 뒤(afterAction 끝, 턴 시작 패시브 뒤) 실행, 턴/SP 안 씀, 반응 · 토큰 행동은 발동 조건을 부르지 않음.
- 토큰(charge/summon): `state.tokens`, 유닛처럼 av가 줄어 차례가 되면 주인 능력치로 효과 실행. 같은 av면 유닛 먼저.
  차지 = 주인 한 턴 × delayPct%, 1번 (big이면 interrupt로 끊김). 소환 = 자기 속도로 actions번. 주인이 쓰러지면 사라짐. `api.queueItems()` = 유닛 + 토큰.
- AUTO: 스킬/궁극기에 `useIf [조건]`이 있으면 그 조건일 때 사용 (스킬은 SP가 가득이면 조건과 상관없이).
- 적: 스테이지 `difficulty` 배율 → 적 atk/hp × difficulty (buildUnit).

### 연출 (`js/fx/`)
- `phaserHost.js`: Phaser.Game 하나(1280×720 FIT, `#fx-layer` — CSS 확대되는 #stage 밖), 글꼴 Pretendard(FontFace)를 먼저 불러옴, 끝나면 레이어 숨기고 루프 재움. 레이어가 떠 있으면 `main.js` 키 처리는 Phaser에 양보.
- `GachaFxScene.js`: 진입 → 희귀도 암시(5★ 30% 보라→금, 4★+ 흔들림/진동) → 폭발(섬광·빛줄기·충격파·Bloom) → 카드(1회 자동 / 10회 탭으로 모두, Shine/Glow, 별 찍기) → 컷인(모든 5★ + 새 4★) → `gachaFxComplete`. SKIP/탭/2배속/모션 줄이기.
- `CutIn.js`: 재사용 컷인 (가챠 full, 전투 궁극기 short ≤1초).
- **전투 화면 = 카드형, 기준 문서 `BATTLE_UI.md`** (배치 · 카드 구조 · 모션 토큰 · 시간표 · 금지 목록). 숫자는 전부 `battleTheme.js`, 트윈은 전부 `motion.js`
  (토큰 instant/fast/base/slow/dramatic, 같은 속성 트윈 정리, 히트스톱 2x ÷1.5, `freeze/thaw` — `tweens.pauseAll()`은 매니저 전체를 멈춰 새 트윈도 멈추므로 쓰지 않음).
  `BattleScene.js`는 엔진 이벤트 → `battleChoreo.groupBeats`(순수, 행동 · 대상 · 광역 · 다단히트를 이벤트 src로) → 컴포넌트 메서드를 await만:
  `BattleCard`(구운 캔버스 앞면 + 회색판, HP 잔상 막대 · 기력 · 효과 아이콘 4+n · 보호막 · 도발 · 변신 · 예고 배지, 앞면에 숫자 없음) · `TurnQueue`(칩 짝 맞추기 `diffQueue`로 미끄러짐) ·
  `ActionHand`+`SpGauge`(손패 끌기/탭 조준, SP 크리스털) · `TargetArrow`/`IntentArrows` · `InfoOverlay`(길게 누르기 400ms · 우클릭 · I) · `battleFx`(입자 이미터 · 숫자 BitmapText 풀 `numberFont.js` · 섬광 · 띠).
  아이콘은 `icons.js`가 코드로 그린 텍스처 `bicon:<이름>` — `assets/ui/icons/<이름>.png`을 넣고 `assets/ui/icons/index.json`에 이름을 넣으면 그 그림이 이김. 이모지/유니코드 기호 아이콘 금지.
  연출 중 입력 잠금(건너뛰기 · 일시정지 · AUTO · 2배속 · 즉시 결과 · 정보창만). 2x는 timeScale. 게임 `?fps=1`(localhost) = fps 표시.
- 전투 배경 후보는 장면 `backgrounds[]`(못 불러오면 다음).
- HTML 쪽: `ui/gachaView.js revealScreen`(연출 → 결과 격자), `ui/battleView.js mountBattle`(장면 → 결과/보상, 스토리 본문을 받아 배경 후보 계산), 실패하면 연출 없이 결과만.

## 키트 생성기 (`tools/kitgen/`, 게임은 import 안 함 — `tests/kitgen.test.js`가 검사)
- `archetypes.js`: 아키타입 10종(1 스택 폭발 · 2 표식 사냥 · 3 추가 공격 · 4 반격 탱커 · 5 타임라인 조작 · 6 보호막 전환 · 7 지속 치유 ·
  8 지속 피해 확산 · 9 변신 캐리 · 10 SP 배터리/버퍼). 템플릿마다 basic/skill/ultimate(+transformed)/talents, bt2 변형 ≥3, bt6 변형 ≥3, 전용 추억 ≥2.
  숫자 칸 `S(id, base, min, max, step)`, 이름 후보, 한 줄 설명(`{res}을(를)` → 조사 맞춤).
- `budget.js`: 점수 = `kitBudget.points[효과] × 크기 × 대상 계수 × 확률`, 패시브 × `triggerWeight` + `modifierPoints`. 상한 = `caps[칸] × rarityFactor[희귀도]`.
  `solve`가 칸들을 같은 배율로 이분 탐색 → ±`tolerancePct`. 패시브가 모자라면 역할 주 능력치 `stat_bonus`로 채움(generate).
- `generate.js generateKit({id, role, rarity, archetype, variants, seed})` → 같은 입력 = 같은 출력 (시드 기본 = id 해시).
  `kitFields`가 저장 칸(role, archetype, kitGen, resource, kit, talents, bt2, bt6). `budgetOf`(수동 편집 검사), `archetypeSpread` / `suggestArchetype`.
- 기존 캐릭터 배정 `bootstrap.js` → `node tools/kitgen/cli.js bootstrap [--apply] [--force]` (작업 공간 + data/ 둘 다, kitGen 있으면 그대로).
- 개발 도구: '키트 일괄' 탭(격자 · 예산 · 빠른 시뮬 · 전체/카드별 승인), 캐릭터 전투 편집기(역할/손조정/자원/스킬/변신/특성/돌파 2·6 + 예산 + 빠른 시뮬 + 생성기).
  `/preview/tools/*`로 불러옴.

## 적 아키타입 · 밸런스 툴킷 (`tools/enemygen/`, `tools/balance/`, AI 없음)
- 적 아키타입 8종(grunt · brute · caster · healer · shielder · assassin · elite · boss): 능력치 = `balance.enemy.base × archetypes[아키타입]`,
  행동은 칸(basic/skill/ultimate) × 기존 아이콘별 템플릿 → **행동 id · 이름 · 아이콘 · 페이즈 이름 · 웨이브 구성은 그대로**, 효과/패턴/페이즈/광폭화/패시브만 새로.
  보스 큰 공격 = 차지(예고 big → 반 턴 뒤 터지는 big 토큰, 둘 다 차단 가능). 배정 `ENEMY_BOOTSTRAP`, 개발 도구 적 탭 '아키타입으로 수치 다시 계산'.
- 스테이지: 적 레벨 = 기대 레벨(`expected.levelStart + levelPerStage × 전체 순서`), `stageType`(보스/정예 적 → boss/elite), `difficulty`(튜너), `recommendedPower` = 기대 전투력.
  `node tools/enemygen/cli.js --apply` (작업 공간 · data/ 각각 — 공개 안 한 그림이 공개 파일로 안 넘어감).
- 기대 성장(`expected.js`): 스테이지마다 레벨 · 돌파(희귀도별 × 0→`breakthroughRamp` 스테이지에 걸쳐) · 추억(역할 기본, 레벨 × levelRatio) ·
  장비(지역 안 `gearFromPosition`번째부터 지역 티어, 그 전은 이전 지역 티어 / 첫 지역 초반은 없음). 기준 팀 = NPC·은퇴 제외, 챕터별 최고 희귀도(`maxRarityByChapter`),
  3★+ 탱커 1 · 치유/지원 1 → 나머지 기대 전투력 순.
- 튜너(`tuner.js`): 기준 팀 × 시드 1..runs AUTO → difficulty 로그 이분 탐색(min~max, maxIter) → 목표 승률 ±tolerance. `node tools/balance/cli.js tune [--apply] [--runs N]`.
- 평가(`evaluate.js`): 캐릭터 교체 테스트(돌0/돌6/전용 추억 → 티어), 추억 교체, 장비 곡선(4칸 교체 기대 판 수), 조합 몬테카를로 상위 1%. `cli.js eval`.
  보고서 `reports/tune-*.md|json`, `reports/eval-*.md|json` (밸런스 탭 '자동 튜너 · 평가'에서도 돌리고 저장 → `POST /api/reports`).
- 전투 결과가 바뀌는 수치(적 · 기대 성장 · 키트)를 고치면: enemygen(추천 전투력) → tune --apply → 스냅샷 차이 확인 → `node tests/run.js --update`.

## 개발 도구 (dev/)
- 희귀도 `tinydev/rarity.py`, 전투 검사 `tinydev/kit.py`(vocab 기반, 적 actions/pattern/phases/enrage), 콘텐츠 검사 `tinydev/validate.py`(모험 규칙 포함), 배포 `publish.py`(스테이지 챕터 파일, 밸런스 변경 요약 패치노트).
- UI 에셋 칸 `tinydev/uislots.py` (ui.json `backgrounds` · `icons`): 화면 배경 + 전투 기본 배경(`backgrounds.battle`, 프롬프트 종류 `battle_bg`).
  스테이지 전투 배경 = 작업 종류 `stagebg`(`POST /api/stagebg/generate`, 승인 → `assets/battle/<id>.jpg` + `stage.background`, `GET /api/stages/<id>/background` = 실제로 쓰일 배경), 일괄 생성 묶음 `stagebg`.
- 웹: 캐릭터 전투 편집(`web/js/battleEditor.js` + `battleForm.js`), 적 편집(행동/패턴/페이즈/광폭화), 스테이지(챕터/연결 스토리/자동 레벨/전투 배경), 밸런스(전투 시뮬, 가챠 시뮬, 전투력 표, balance.json 편집), `/fx-test`, `/preview/tests/`.
- 개발 도구 웹은 `/preview/js/...`로 게임 모듈을 그대로 import (progression, schema, data, sim, gacha).
- 글 생성 모델(`settings.json textModels [{id,label,provider,model}]` + `textModelFor {story,review,recap,profile,describe,imagePrompt}`, 설정 탭):
  `genai.generate_text(…, task=, model=)` → `resolve_text_model` = 지정 id > 작업별 기본 > 환경 변수 `TG_TEXT_MODEL`(id `env`), 목록에 없는 id는 400.
  제공자별 함수 `genai._PROVIDERS`(지금 gemini만, 키는 `dev/.env`에만). 생성 버튼 옆 `web/js/modelPicker.js`. 기록 `dev/history/text-…/record.json`(`texthist`) + 장 초안은 설정집 장 정보 `model`.
- 프로필(`tinydev/profile.py`): `draft(id | 'protagonist', part all|stories|lines|voice)` = `prompts.profile_draft`(다른 캐릭터 말투 요약 · 주인공 카드 · 대본 발췌 ≤3000자 · 문체 지침)
  → `POST /api/char/profile`(저장 안 함) → 폼(`web/js/profileForm.js`, 캐릭터 탭 '프로필' / 스토리 탭 '주인공 말투 카드') → `PUT /api/characters/<id>/profile` · `PUT /api/story-bible/protagonist`.
  주인공 카드는 `story_bible.json protagonist {name, voice}`. 설정집 문체 지침 한도 `bible.STYLE_LIMIT` 20000자(넘으면 저장 거부 — 예전엔 3000자에서 조용히 잘렸음).
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

### 키트 · 돌파 · 추억 · 장비 · 밸런스 (balance-kit-gear-spec v2)
| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 설정 (역할 템플릿, 새 능력치, 예산, 돌파 노드, 추억, 장비, 적, 기대 성장, 튜너) | ✅ |
| 2 | 엔진 (효과 적중/저항, 자원, 표식, 추가 공격, 반격, 변신, 차지, 소환, 반응 큐, 토큰) | ✅ |
| 3–4 | 아키타입 10종 + 결정론 키트 생성기 · 예산 → 기존 10명 적용, 키트 일괄 탭 | ✅ |
| 5 | 돌파 1–6 | ✅ |
| 6 | 추억 (데이터 · 생성기 · 세이브 · 추억 뽑기 · 화면 · 추억 탭 · 카드 그림) | ✅ |
| 7 | 장비 (드롭 · 강화 · 분해 · 자동 장착 · 별점 · 반복 전투 · 소탕) | ✅ |
| 8–9 | 적 아키타입 · 스테이지 재계산 · 기대 성장 · 자동 튜너 · 평가 | ✅ |
| 10 | 세이브 v4 · 저장 디바운스 · 스냅샷(장착 팀) · AI 스위치 · 문서 | ✅ |

## 알아 둘 것 (남은 일)
- 1★/2★ 캐릭터가 아직 없음 → 그 확률은 3★로 대체됨. (1★ 뜨내기 용병은 있음)
- 추억 카드 그림이 아직 없음 (게임은 이름 카드로 보여 줌) → 개발 도구 추억 탭 / 일괄 생성 '추억 카드'로 그리기.
- 새 캐릭터 AI 문구 다듬기(이름/설명) 버튼은 아직 없음 — 키트 생성기 이름 후보 + 한 줄 설명 템플릿을 씀 (AI로 다시 쓰기는 전투 편집기에 있음).
- 스테이지 난이도는 자동 튜너로 맞춤 (reports/의 마지막 tune/eval 보고서 참고). 평가에서 안나(치유) 돌파 효과가 작고, 1★ 탱커는 보스 칸에서 약함.
- `enemy_0006`(광휘교단 이단 사냥꾼, 1-7 적) 그림은 작업 공간에만 있음 → 배포하면 공개됨.
- 전투 기본 배경(선술집 테이블)은 작업 공간에만 있음 → 배포하면 공개됨. 스테이지 전용 전투 배경은 칸만 있고 그림은 아직 없음 → 개발 도구 스테이지 탭 / 일괄 생성으로 뽑기.
- 1-1/1-2/1-3/1-5/1-7 스토리의 전투 장면과 도입 대사(b0)는 초안 — 스토리 탭에서 다듬기.
