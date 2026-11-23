// tools(Node/개발 도구)용 데이터 불러오기: 게임과 같은 검사기로, 폴더를 골라서 (작업 공간 dev/workspace/data 또는 공개 data)
// 게임 main.js의 조립(characters 나누기, enemyMap, stageMap, memoryMap)과 같은 모양을 돌려줌
import { validateCharacters, validateEnemies, validateStages, validateMemories, splitCharacters, linkEnemyNpcs } from '../../js/core/data.js';
import { loadConfig } from '../../js/config.js';

/**
 * @param {(path:string)=>Promise<any>} readJson 파일 읽기 (Node: fs, 브라우저: fetch)
 * @param {string} dir 'dev/workspace/data' | 'data'
 * @param {object} vocab
 */
export async function loadToolData(readJson, dir, vocab) {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const balance = loadConfig(await readJson(`${dir}/balance.json`), vocab);
    const characters = validateCharacters(await readJson(`${dir}/characters.json`), vocab);
    const enemiesRaw = validateEnemies(await readJson(`${dir}/enemies.json`), vocab);
    const memories = validateMemories((await readJson(`${dir}/memories.json`).catch(() => [])) || [], vocab);
    const index = await readJson(`${dir}/stages/index.json`);
    const chapters = [];
    const stages = [];
    for (const id of index) {
      const j = await readJson(`${dir}/stages/${id}.json`);
      const list = validateStages(j, { chapter: id });
      chapters.push({ id, title: j.title, stageIds: list.map((s) => s.id) });
      stages.push(...list);
    }
    const split = splitCharacters(characters);
    const enemies = linkEnemyNpcs(enemiesRaw, split.allCharMap);
    return { vocab, balance, ...split, enemies, memories, stages, chapters, enemyMap: new Map(enemies.map((e) => [e.id, e])), stageMap: new Map(stages.map((s) => [s.id, s])), memoryMap: new Map(memories.map((m) => [m.id, m])) };
  } finally {
    console.warn = quiet;
  }
}
