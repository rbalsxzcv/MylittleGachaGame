// Node로 테스트 실행: node tests/run.js [이름 일부] [--update]
//   --update: 회귀 스냅샷(tests/snapshots/stages.json)을 지금 결과로 갱신
// (Node 18 이상. 브라우저에서는 tests/index.html)
import { run } from './lib/runner.js';
import './all.js';

const args = process.argv.slice(2);
if (args.includes('--update') && globalThis.__tgSnapshot) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const url = new URL(`../${globalThis.__tgSnapshot.path}`, import.meta.url);
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, JSON.stringify(globalThis.__tgSnapshot.current, null, 2) + '\n');
  console.log(`스냅샷을 갱신했어요: ${globalThis.__tgSnapshot.path}`);
}
const filter = args.find((a) => !a.startsWith('--')) || '';
let lastSuite = '';
const res = await run({
  filter,
  onResult(r) {
    if (r.suite !== lastSuite) {
      console.log(`\n${r.suite}`);
      lastSuite = r.suite;
    }
    console.log(`  ${r.ok ? '✓' : '✕'} ${r.name} (${r.ms}ms)`);
    if (!r.ok) console.log(`      ${r.error.replace(/\n/g, '\n      ')}`);
  },
});
console.log(`\n${res.failed ? 'FAIL' : 'PASS'} — 통과 ${res.passed} / 실패 ${res.failed} (${res.ms}ms)`);
process.exitCode = res.failed ? 1 : 0;
