// 실제 게임 데이터(data/)가 게임의 검사기를 통과하고, 모험 연결이 맞고, 모든 스테이지가 끝까지 돌아가는지
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { loadGameData } from './lib/gameData.js';
import { RARITIES, NPC } from '../js/config.js';
import { createBattle } from '../js/battle/engine.js';
import { buildPools, isPoolEmpty } from '../js/systems/gacha.js';
import { adventureIssues } from '../js/systems/adventure.js';

const d = await loadGameData({ stories: true });

describe('data: 실제 데이터 파일', () => {
  it("경고 없이 불러와지고 등급은 1–5 정수 또는 'npc' (예전 pullable 없음)", async () => {
    expect(d.warnings, d.warnings.join(' / ')).toEqual([]);
    expect(d.characters.length).toBeGreaterThanOrEqual(1);
    for (const c of d.characters) expect(RARITIES.includes(c.rarity) || c.rarity === NPC, `${c.id}: ${c.rarity}`).toBe(true);
    const raw = await loadJson('data/characters.json');
    for (const c of raw) {
      expect(typeof c.rarity === 'number' || c.rarity === NPC, `${c.id} 파일 안의 등급: ${c.rarity}`).toBe(true);
      expect('pullable' in c, `${c.id}: 예전 pullable 필드 (등급 npc로)`).toBe(false);
    }
  });
  it('배너 로테이션 희귀도도 숫자, 상시 배너 풀이 비어 있지 않음', () => {
    for (const b of d.banners) if (b.rotation) expect(b.rotation.rarity).toBe(5);
    const std = d.banners.find((b) => b.type === 'standard');
    expect(isPoolEmpty(buildPools(d.characters, std))).toBe(false);
  });
  it('적: 새 형식 (actions + pattern), 예전 kit/cooldown 없음', async () => {
    const raw = await loadJson('data/enemies.json');
    for (const e of raw) {
      expect(!!e.actions && Array.isArray(e.pattern), `${e.id}`).toBe(true);
      expect('kit' in e, `${e.id} kit`).toBe(false);
      expect(JSON.stringify(e).includes('cooldown'), `${e.id} cooldown`).toBe(false);
    }
  });
});

describe('data: 모험 (스테이지 = 스토리 1 + 전투 1)', () => {
  it('챕터 파일에서 스테이지를 읽음 (예전 data/stages.json 없음)', async () => {
    expect(d.chapters.length).toBeGreaterThanOrEqual(1);
    expect(d.stages.length).toBe(d.chapters.reduce((a, c) => a + c.stageIds.length, 0));
    let legacy = true;
    try {
      await loadJson('data/stages.json');
    } catch {
      legacy = false;
    }
    expect(legacy, 'data/stages.json이 남아 있음').toBe(false);
  });
  it('모든 스테이지 ↔ 메인 스토리 1개 ↔ 전투 장면 1개', () => {
    const issues = adventureIssues(d.stages, d.storyIndex, d.stories);
    expect(issues, issues.join(' / ')).toEqual([]);
    const mains = d.storyIndex.filter((s) => s.kind === 'main');
    expect(d.stages.length).toBe(mains.length);
  });
  it('선택지로 전투를 건너뛸 수 없음 (전투 장면 뒤로 바로 가는 선택지 없음)', () => {
    for (const [id, body] of Object.entries(d.stories)) {
      const ids = body.scenes.map((s) => s.id);
      const b = body.scenes.findIndex((s) => s.type === 'battle');
      if (b < 0) continue;
      body.scenes.forEach((s, i) => {
        for (const l of s.lines) for (const c of l.choices) {
          const to = ids.indexOf(c.goto);
          expect(i < b && to > b, `${id} ${s.id} → ${c.goto}`).toBe(false);
        }
      });
    }
  });
  it('모든 스테이지가 자동 전투로 끝까지 진행됨 (예외 없음)', () => {
    const team = d.characters.filter((c) => c.pullable).slice(0, 5).map((c) => ({ charId: c.id, level: 20, breakthrough: 0 }));
    for (const stage of d.stages) {
      const b = createBattle({ team, stage, data: d, seed: 1 });
      b.runToEnd();
      expect(['win', 'lose'].includes(b.state.result), `${stage.id}: ${b.state.result}`).toBe(true);
    }
  });
});
