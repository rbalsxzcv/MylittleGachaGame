// 아주 작은 테스트 러너 (describe / it / expect) — 브라우저(tests/index.html)와 Node(tests/run.js) 공용
// 빌드 도구 없이 ES 모듈만 씁니다. it 안의 함수는 async여도 됩니다.

const suites = [];
let current = null;

/** 테스트 묶음 */
export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const prev = current;
  current = suite;
  try {
    fn();
  } finally {
    current = prev;
  }
}

/** 테스트 하나 */
export function it(name, fn) {
  if (!current) throw new Error('it()은 describe() 안에서 써 주세요');
  current.tests.push({ name, fn });
}

class AssertionError extends Error {}

const show = (v) => {
  try {
    return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x));
  } catch {
    return String(v);
  }
};

/** 깊은 비교 (객체 키 순서 무시, 배열 순서는 비교) */
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** expect(값).toBe(...) 형식의 검사 */
export function expect(actual, label = '') {
  const fail = (msg) => {
    throw new AssertionError(label ? `${label}: ${msg}` : msg);
  };
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) fail(`${show(actual)} 이(가) ${show(expected)} 이어야 해요`);
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) fail(`\n  받은 값: ${show(actual)}\n  기대 값: ${show(expected)}`);
    },
    toBeCloseTo(expected, eps = 1e-9) {
      if (!(Math.abs(actual - expected) <= eps)) fail(`${actual} 이(가) ${expected} ± ${eps} 안이어야 해요`);
    },
    toBeTruthy() {
      if (!actual) fail(`${show(actual)} 이(가) 참이어야 해요`);
    },
    toBeFalsy() {
      if (actual) fail(`${show(actual)} 이(가) 거짓이어야 해요`);
    },
    toBeLessThanOrEqual(n) {
      if (!(actual <= n)) fail(`${actual} 이(가) ${n} 이하여야 해요`);
    },
    toBeGreaterThanOrEqual(n) {
      if (!(actual >= n)) fail(`${actual} 이(가) ${n} 이상이어야 해요`);
    },
    toContain(item) {
      if (!actual?.includes?.(item)) fail(`${show(actual)} 에 ${show(item)} 이(가) 있어야 해요`);
    },
    toThrow() {
      try {
        actual();
      } catch {
        return;
      }
      fail('오류가 나야 하는데 나지 않았어요');
    },
  };
}

/**
 * 등록된 테스트를 모두 실행
 * @param {{onResult?:(r:{suite:string, name:string, ok:boolean, error:string|null, ms:number})=>void, filter?:string}} [opts]
 * @returns {Promise<{passed:number, failed:number, results:Array, ms:number}>}
 */
export async function run({ onResult, filter = '' } = {}) {
  const results = [];
  const t0 = Date.now();
  for (const suite of suites) {
    for (const test of suite.tests) {
      const full = `${suite.name} › ${test.name}`;
      if (filter && !full.includes(filter)) continue;
      const start = Date.now();
      let error = null;
      try {
        await test.fn();
      } catch (e) {
        error = e instanceof AssertionError ? e.message : `${e?.name || 'Error'}: ${e?.message || e}\n${(e?.stack || '').split('\n').slice(1, 4).join('\n')}`;
      }
      const r = { suite: suite.name, name: test.name, ok: !error, error, ms: Date.now() - start };
      results.push(r);
      onResult?.(r);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results, ms: Date.now() - t0 };
}
