// 테스트용 파일 읽기 — 브라우저는 fetch, Node는 fs (경로는 저장소 루트 기준, 예: 'js/battle/vocab.json')

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node;

/** 저장소 루트 기준 경로의 JSON 읽기 */
export async function loadJson(path) {
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    const url = new URL(`../../${path}`, import.meta.url);
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(new URL(`../../${path}`, import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
