// 테스트용: 실제 게임 데이터(data/)를 게임과 같은 검사기로 불러오기 (브라우저/Node 공용)
import { loadJson } from './load.js';
import { validateCharacters, validateEnemies, validateStages, validateBanners, validateStoryIndex, validateStory, validateMemories } from '../../js/core/data.js';
import { loadConfig } from '../../js/config.js';

/**
 * @param {{stories?:boolean}} [o] stories: 스토리 본문까지 (모험 연결 검사용)
 * @returns {Promise<{vocab, balance, characters, enemies, stages, chapters, banners, storyIndex, stories, warnings, charMap, enemyMap, stageMap}>}
 */
export async function loadGameData({ stories = false } = {}) {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const vocab = await loadJson('js/battle/vocab.json');
    const balance = loadConfig(await loadJson('data/balance.json'), vocab, (m) => warnings.push(m));
    const characters = validateCharacters(await loadJson('data/characters.json'), vocab);
    const enemies = validateEnemies(await loadJson('data/enemies.json'), vocab);
    const memories = validateMemories(await loadJson('data/memories.json'), vocab);
    const index = await loadJson('data/stages/index.json');
    const chapters = [];
    const stageList = [];
    for (const id of index) {
      const j = await loadJson(`data/stages/${id}.json`);
      const list = validateStages(j, { chapter: id });
      chapters.push({ id, title: j.title, stageIds: list.map((s) => s.id) });
      stageList.push(...list);
    }
    const banners = validateBanners(await loadJson('data/banners.json'));
    const storyIndex = validateStoryIndex(await loadJson('data/stories/index.json'));
    const bodies = {};
    if (stories) for (const s of storyIndex) bodies[s.id] = validateStory(await loadJson(`data/stories/${s.id}.json`), s.id);
    return {
      vocab,
      balance,
      characters,
      enemies,
      memories,
      memoryMap: new Map(memories.map((m) => [m.id, m])),
      stages: stageList,
      chapters,
      banners,
      storyIndex,
      stories: bodies,
      warnings,
      charMap: new Map(characters.map((c) => [c.id, c])),
      enemyMap: new Map(enemies.map((e) => [e.id, e])),
      stageMap: new Map(stageList.map((s) => [s.id, s])),
    };
  } finally {
    console.warn = origWarn;
  }
}
