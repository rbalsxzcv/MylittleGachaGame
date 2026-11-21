# 외부 라이브러리 (빌드 없이 그대로 포함)

| 파일 | 버전 | 출처 | 라이선스 |
|---|---|---|---|
| `phaser.min.js` | Phaser 3.90.0 | https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js | MIT (https://github.com/phaserjs/phaser/blob/master/LICENSE.md) |

가챠 연출(`js/fx/GachaFxScene.js`)과 전투 화면(`js/fx/BattleScene.js`)이 처음 필요할 때 `js/fx/phaserHost.js`가 `<script>`로 불러와요.
글꼴은 `assets/fonts/` (Pretendard 1.3.9 subset, SIL OFL 1.1 — `assets/fonts/OFL.txt`).
