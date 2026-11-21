// 회귀 스냅샷: 모든 스테이지를 기준 팀으로 시드 고정 자동 전투 → tests/snapshots/stages.json과 비교
// 다르면 실패 + 바뀐 줄 목록. 일부러 바꾼 거면 갱신:
//   브라우저(개발 도구 /preview/tests/): 테스트 페이지의 '스냅샷 갱신' 버튼 · Node: node tests/run.js --update
import { describe, it, expect } from './lib/runner.js';
import { loadJson } from './lib/load.js';
import { loadGameData } from './lib/gameData.js';
import { computeSnapshot, diffSnapshot, SNAPSHOT_PATH } from './lib/snapshot.js';

const data = await loadGameData();
const current = computeSnapshot(data);
let saved = null;
try {
  saved = await loadJson(SNAPSHOT_PATH);
} catch {
  saved = null;
}
// 테스트 페이지/러너가 '갱신'할 때 쓰도록 공개
globalThis.__tgSnapshot = { current, path: SNAPSHOT_PATH };

describe('회귀 스냅샷 (모든 스테이지 × 기준 팀 × 시드)', () => {
  it('스냅샷 파일이 있음', () => {
    expect(!!saved, `${SNAPSHOT_PATH}가 없어요 → 스냅샷 갱신으로 만들어 주세요`).toBe(true);
  });
  it('저장된 결과와 같음 (다르면 바뀐 전투 목록)', () => {
    if (!saved) return;
    const diff = diffSnapshot(saved, current);
    if (diff.length) throw new Error(`${diff.length}곳이 달라요 — 일부러 바꾼 거면 스냅샷을 갱신하세요:\n${diff.slice(0, 40).join('\n')}${diff.length > 40 ? '\n…' : ''}`);
  });
});
