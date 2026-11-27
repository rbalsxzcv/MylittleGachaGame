// 자동 튜너 (순수 계산, AI 없음) — 기준: 전투력
//   권장 전투력 R = 기대 전투력 ÷ 톱니 비율 (expected.recommendedPower). 'R 전투력 팀'(expected.teamAtPower, 레벨로 맞춤)으로 시드 N판 AUTO 전투 →
//   처치 턴 수(1턴 = 1라운드)를 balance.tuner.killTurns[종류]에 맞춤:
//     내가 잡는 턴   = 적 HP 합 ÷ 아군 라운드당 피해            ← hpScale (적 HP만)
//     적이 잡는 턴   = 아군 HP 합 ÷ 적 라운드당 피해(보호막 · 치유 전) ← difficulty (적 공격력 — 이때 difficulty × hpScale = 적 실제 HP는 고정)
//   두 손잡이를 passes번 번갈아. 그다음 전투력 검사(powerCheck): R의 80 · 90 · 100 · 120 · 150% 팀 승률이 표 안인지 (정예 · 보스는 전부, 일반은 100% 이상).
//   같은 시드 묶음 → 결정론
import { runOne } from '../../js/battle/sim.js';
import { statsOf, powerOf } from '../../js/systems/progression.js';
import { enemyLevelFor } from '../../js/config.js';
import { referenceTeam, expectedState, stageLevelCap, recommendedPower, teamAtPower, teamPower, sawtoothRatio } from './expected.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

/** 적 파티(모든 웨이브)의 HP 합 · 전투력 합 (난이도 · HP 배율 반영) */
export function enemyParty(stage, data, difficulty = stage.difficulty ?? 1, hpScale = stage.hpScale ?? 1) {
  let hp = 0;
  let power = 0;
  for (const e of stage.waves.flat()) {
    const ent = data.enemyMap.get(e.enemyId);
    if (!ent) continue;
    const s = statsOf(ent, enemyLevelFor(e, stage, data.balance), 0, data.balance);
    const scaled = { ...s, atk: Math.floor(s.atk * difficulty), hp: Math.max(1, Math.floor(s.hp * difficulty * hpScale)) };
    hp += scaled.hp;
    power += powerOf(scaled, data.balance);
  }
  return { hp, power };
}

/**
 * 이 팀 · 스테이지 · 배율로 시드 1..runs → 지표
 * @returns {{winRate, avgRounds, winRounds, p90Rounds, timeoutRate, wipeRate, deaths, hpLeft, peakLoss, myKill, enemyKill, allyHit, allyMaxHit, enemyHit, enemyMaxHit}}
 *   myKill = 적 HP 합 ÷ 아군 라운드당 피해, enemyKill = 아군 HP 합 ÷ 적 라운드당 피해(보호막 · 치유 전) — 처치 턴 수
 *   hpLeft = 전투 끝에 남은 팀 HP 비율(쓰러진 아군은 0, 판 평균), peakLoss = 1 − 전투 중 팀 HP 최저점,
 *   allyHit/enemyHit = 아군→적 / 적→아군 평균 1타 (대상 최대 HP 대비), Max = 가장 큰 1타
 */
export function winRateAt(stage, difficulty, team, data, runs, seedStart = 1, hpScale = stage.hpScale ?? 1) {
  const st = { ...stage, difficulty, hpScale };
  const enemyHp = enemyParty(st, data, difficulty, hpScale).hp;
  let wins = 0;
  let rounds = 0;
  let timeouts = 0;
  let deaths = 0;
  let hpLeft = 0;
  let peakLoss = 0;
  let dealt = 0;
  let taken = 0;
  let teamHp = 0;
  const winRoundList = [];
  const hit = { n: 0, sum: 0, max: 0, tn: 0, tsum: 0, tmax: 0 };
  for (let i = 0; i < runs; i++) {
    const s = runOne({ team, stage: st, data, seed: seedStart + i });
    if (s.result === 'win') {
      wins += 1;
      winRoundList.push(s.rounds);
    } else if (s.reason === 'timeout') timeouts += 1;
    rounds += s.rounds;
    let maxHp = 0;
    let left = 0;
    for (const u of s.units) {
      if (!u.alive) deaths += 1;
      maxHp += u.maxHp;
      left += u.alive ? Math.max(0, u.hp) : 0;
      dealt += u.dealt || 0;
      taken += u.takenRaw || 0;
      hit.n += u.hits || 0;
      hit.sum += u.hitPct || 0;
      hit.max = Math.max(hit.max, u.maxHitPct || 0);
      hit.tn += u.hitsTaken || 0;
      hit.tsum += u.takenPct || 0;
      hit.tmax = Math.max(hit.tmax, u.maxTakenPct || 0);
    }
    teamHp = maxHp;
    hpLeft += maxHp ? left / maxHp : 0;
    peakLoss += 1 - (s.minTeamHp ?? 1);
  }
  winRoundList.sort((a, b) => a - b);
  return {
    winRate: wins / runs,
    avgRounds: r1(rounds / runs),
    winRounds: winRoundList.length ? r1(winRoundList.reduce((a, b) => a + b, 0) / winRoundList.length) : null,
    p90Rounds: winRoundList.length ? winRoundList[Math.min(winRoundList.length - 1, Math.floor(winRoundList.length * 0.9))] : null,
    timeoutRate: timeouts / runs,
    wipeRate: (runs - wins - timeouts) / runs,
    deaths: r1(deaths / runs),
    hpLeft: r3(hpLeft / runs),
    peakLoss: r3(peakLoss / runs),
    myKill: dealt ? r1((enemyHp * rounds) / dealt) : null,
    enemyKill: taken ? r1((teamHp * rounds) / taken) : 99,
    allyHit: hit.n ? r3(hit.sum / hit.n) : 0,
    allyMaxHit: r3(hit.max),
    enemyHit: hit.tn ? r3(hit.tsum / hit.tn) : 0,
    enemyMaxHit: r3(hit.tmax),
  };
}

/** 처치 턴 목표 (스테이지 종류별) → {myMin, myMax, enemyMin, enemyMax} */
export const targetsFor = (stage, balance) => balance.tuner.killTurns[stage.stageType || 'normal'] ?? balance.tuner.killTurns.normal;

/** 범위 안이면 0, 아래면 −(모자란 만큼), 위면 +(넘친 만큼) */
const outside = (v, min, max) => (v == null ? Infinity : v < min ? v - min : v > max ? v - max : 0);

/** 지표가 목표 안인지 → {my, enemy, timeout, ok} */
export function checkTargets(r, target, balance) {
  const my = outside(r.myKill, target.myMin, target.myMax) === 0;
  const enemy = outside(r.enemyKill, target.enemyMin, target.enemyMax) === 0;
  const timeout = r.timeoutRate <= balance.tuner.maxTimeoutRate;
  return { my, enemy, timeout, ok: my && enemy && timeout };
}

/** 목표에서 얼마나 먼지 (작을수록 좋음 — 수렴 못 했을 때 가장 나은 칸 고르기) */
function miss(r, target, balance) {
  const m = Math.abs(outside(r.myKill, target.myMin, target.myMax));
  const e = Math.abs(outside(r.enemyKill, target.enemyMin, target.enemyMax));
  const to = Math.max(0, r.timeoutRate - balance.tuner.maxTimeoutRate) * 20;
  return (Number.isFinite(m) ? m : 50) + (Number.isFinite(e) ? e : 50) + to;
}

/** 범위의 가운데 (위가 열려 있으면 아래 + 10%) */
const mid = (min, max) => (max >= 50 ? min * 1.1 : (min + max) / 2);

/**
 * 스테이지 하나 튜닝 → {stageId, …, recommended, enemyPower, difficulty, hpScale, ...지표(100% 팀), ok, okMy, okEnemy, okTimeout, powerCheck[], atCap}
 * @param {object} [opts] { runs, team(직접 줄 때 — 전투력 검사 생략), check: 전투력 · 상한 검사도 (기본 true) }
 */
export function tuneStage(stage, data, opts = {}) {
  const B = data.balance;
  const T = B.tuner;
  const runs = opts.runs ?? T.runs;
  const target = targetsFor(stage, B);
  const R = recommendedPower(stage, data);
  const base = opts.team ? { team: opts.team, level: opts.team[0]?.level ?? null, power: teamPower(opts.team, data) } : teamAtPower(stage, data, R);
  const team = base.team;
  const clampD = (x) => Math.min(T.difficulty.max, Math.max(T.difficulty.min, x));
  const clampH = (x) => Math.min(T.hpScale.max, Math.max(T.hpScale.min, x));
  const history = [];
  const cache = new Map();
  const measure = (d, hp) => {
    const key = `${r3(d)}|${r3(hp)}`;
    if (!cache.has(key)) {
      const r = { difficulty: r3(d), hpScale: r3(hp), ...winRateAt(stage, d, team, data, runs, 1, hp) };
      cache.set(key, r);
      history.push({ difficulty: r.difficulty, hpScale: r.hpScale, myKill: r.myKill, enemyKill: r.enemyKill, winRate: r.winRate });
    }
    return cache.get(key);
  };
  let best = null;
  const consider = (r) => {
    if (!best || miss(r, target, B) < miss(best, target, B)) best = r;
  };
  let d = clampD(stage.difficulty || 1);
  let hp = clampH(stage.hpScale || 1);
  const myGoal = mid(target.myMin, target.myMax);
  for (let pass = 0; pass < T.passes; pass++) {
    // (a) 적이 잡는 턴: difficulty 로그 이분 탐색 — 적 실제 HP(difficulty × hpScale)는 그대로 두고 공격력만 움직임
    const H = d * hp;
    let lo = T.difficulty.min;
    let hi = T.difficulty.max;
    let passBest = null;
    for (let it = 0; it < T.maxIter; it++) {
      hp = clampH(H / d);
      const r = measure(d, hp);
      consider(r);
      const off = outside(r.enemyKill, target.enemyMin, target.enemyMax);
      if (!passBest || Math.abs(off) < Math.abs(outside(passBest.enemyKill, target.enemyMin, target.enemyMax))) passBest = r;
      if (off === 0) break;
      if (off > 0) lo = d; // 적이 너무 느리게 잡음 → 더 세게
      else hi = d;
      d = Math.sqrt(lo * hi);
    }
    d = passBest.difficulty;
    hp = passBest.hpScale;
    if (checkTargets(passBest, target, B).ok) break;
    // (b) 내가 잡는 턴: 적 HP에 거의 비례 → hpScale × 목표/실제
    const next = clampH(passBest.myKill ? hp * (myGoal / passBest.myKill) : hp * 0.5);
    if (Math.abs(next - hp) < 0.002 && outside(passBest.enemyKill, target.enemyMin, target.enemyMax) === 0) break;
    hp = next;
  }
  const chk = checkTargets(best, target, B);
  const out = {
    stageId: stage.id,
    name: stage.name,
    stageType: stage.stageType || 'normal',
    target,
    recommended: R,
    sawtooth: r3(sawtoothRatio(stage, data)),
    teamLevel: base.level,
    teamPowerRatio: r3(base.power / R),
    enemyPower: enemyParty(stage, data, best.difficulty, best.hpScale).power,
    ...best,
    iterations: history.length,
    ok: chk.ok,
    okMy: chk.my,
    okEnemy: chk.enemy,
    okTimeout: chk.timeout,
    team: team.map((m) => m.charId),
    history,
  };
  if (opts.check !== false && !opts.team) {
    out.powerCheck = powerCheck(stage, data, best.difficulty, best.hpScale, R, Math.max(20, Math.round(runs / 3)));
    out.powerOk = out.powerCheck.every((c) => c.ok);
    out.atCap = capCheck(stage, data, best.difficulty, best.hpScale, Math.max(10, Math.round(runs / 5)));
  }
  return out;
}

/**
 * 전투력 검사: 권장 전투력의 ratio배 팀(레벨로 맞춤)으로 승률 → balance.tuner.powerCheck 표 안인지
 * 일반 스테이지는 100% 이상 칸만 판정 (일반은 처치 턴 표가 우선 — 80%로도 이길 수 있음). 레벨 1보다 약하게는 못 만듦(실제 비율 표시)
 * @returns {Array<{key, ratio, actual, level, winRate, hpLeft, winRounds, checked, ok}>}
 */
export function powerCheck(stage, data, difficulty, hpScale, R, runs) {
  const P = data.balance.tuner.powerCheck;
  const strict = (stage.stageType || 'normal') !== 'normal';
  return Object.entries(P).map(([key, c]) => {
    const t = teamAtPower(stage, data, R * c.ratio);
    const r = winRateAt(stage, difficulty, t.team, data, runs, 1, hpScale);
    const checked = strict || c.ratio >= 1;
    const ok = !checked || (r.winRate >= c.minWin - 1e-9 && r.winRate <= c.maxWin + 1e-9);
    return { key, ratio: c.ratio, actual: r3(t.power / R), level: t.level, winRate: r.winRate, hpLeft: r.hpLeft, winRounds: r.winRounds, checked, ok };
  });
}

/** 상한 레벨 검사: 아군 = 이 챕터 레벨 상한일 때 (과성장하면 얼마나 쉬운지) */
export function capCheck(stage, data, difficulty, hpScale, runs) {
  const level = stageLevelCap(stage, data);
  const team = referenceTeam(stage, data, { state: expectedState(stage, data, { level }) });
  const r = winRateAt(stage, difficulty, team, data, runs, 1, hpScale);
  return { level, winRate: r.winRate, winRounds: r.winRounds, deaths: r.deaths };
}

/** 전체 스테이지 일괄 (onProgress(i, n, result)) */
export function tuneAll(data, opts = {}, onProgress = () => {}) {
  const stages = data.stages.filter((s) => !s.retired);
  const out = [];
  stages.forEach((st, i) => {
    const r = tuneStage(st, data, opts);
    out.push(r);
    onProgress(i + 1, stages.length, r);
  });
  return out;
}

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const range = (a, b) => (b >= 50 ? `${a}+` : `${a}~${b}`);

/** 튜닝 결과 → Markdown 보고서 (+ 경제 표가 있으면 끝에) */
export function tuneReport(results, balance, economy = null) {
  const T = balance.tuner;
  const K = T.killTurns;
  const S = balance.expected.sawtooth;
  const mark = (ok) => (ok ? '' : ' ⚠');
  const pc = (r) => (r.powerCheck || []).map((c) => `${Math.round(c.ratio * 100)}${c.actual && Math.abs(c.actual - c.ratio) > 0.05 ? `(실제 ${Math.round(c.actual * 100)})` : ''}: ${pct(c.winRate)}${c.checked && !c.ok ? '⚠' : ''}`).join(' · ');
  const lines = [
    '# 자동 튜너 보고서 (전투력 기준)',
    '',
    `권장 전투력 = 기대 전투력 ÷ 톱니 비율 (챕터 시작 ${S.start} → 보스 앞 ${S.end} → 챕터 보스 ${S.boss}). 아래 지표는 '권장 전투력 팀'(레벨로 맞춤) 기준, 1턴 = 1라운드.`,
    `처치 턴 목표 (내가 잡는 턴 / 적이 나를 잡는 턴, 보호막 · 치유 전): ${['normal', 'elite', 'boss'].map((k) => `${{ normal: '일반', elite: '정예', boss: '보스' }[k]} ${range(K[k].myMin, K[k].myMax)} / ${range(K[k].enemyMin, K[k].enemyMax)}`).join(' · ')}`,
    `전투력 검사 (권장 대비 → AUTO 승률): ${Object.values(T.powerCheck).map((c) => `${Math.round(c.ratio * 100)}% ${pct(c.minWin)}~${pct(c.maxWin)}`).join(' · ')} — 정예 · 보스는 전부, 일반은 100% 이상만. 판 수 ${T.runs}`,
    '',
    '| 스테이지 | 종류 | 톱니 | 권장 전투력 | 적 전투력 | 100% 팀 Lv | 난이도 | HP 배율 | 내가 잡는 턴 | 적이 잡는 턴 | 승률 | 남은 HP | 라운드 | 쓰러진 아군 | 1타 아군→적 · 적→아군 (최대) | 전투력별 승률 | 상한 Lv |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.stageId} ${r.name || ''} | ${r.stageType} | ${r.sawtooth} | ${r.recommended} | ${r.enemyPower} | ${r.teamLevel}${Math.abs(r.teamPowerRatio - 1) > 0.05 ? ` (${pct(r.teamPowerRatio)})` : ''} | ×${r.difficulty} | ×${r.hpScale} | ${r.myKill ?? '-'}${mark(r.okMy)} | ${r.enemyKill}${mark(r.okEnemy)} | ${pct(r.winRate)}${mark(r.okTimeout)} | ${pct(r.hpLeft)} | ${r.winRounds ?? '-'} | ${r.deaths} | ${pct(r.allyHit)} · ${pct(r.enemyHit)} (${pct(r.enemyMaxHit)}) | ${pc(r)} | ${r.atCap ? `Lv${r.atCap.level}: ${pct(r.atCap.winRate)} · ${r.atCap.winRounds ?? '-'}` : '-'} |`,
    ),
    '',
    `처치 턴 목표 안: ${results.filter((r) => r.ok).length}/${results.length} (내가 ${results.filter((r) => r.okMy).length} · 적이 ${results.filter((r) => r.okEnemy).length} · 시간 초과 ${results.filter((r) => r.okTimeout).length}), 전투력 검사 통과: ${results.filter((r) => r.powerOk).length}/${results.length}`,
  ];
  if (economy) lines.push('', ...economyReport(economy));
  return lines.join('\n') + '\n';
}

/** 경제 표 → Markdown 줄 */
export function economyReport(rows) {
  return [
    '## 경제 검사 (기준 팀 5명을 기대 레벨까지 — 누적)',
    '',
    '| 챕터 | 기대 레벨 | 필요 티켓 | 수입 티켓 | 필요 골드 | 수입 골드 | 판정 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((e) => `| ${e.chapter} | ${e.fromLevel}→${e.toLevel} | ${e.costTickets.toLocaleString()} | ${e.incomeTickets.toLocaleString()} | ${e.costGold.toLocaleString()} | ${e.incomeGold.toLocaleString()} | ${e.ok ? '됨' : '⚠ 모자람'} |`),
    '',
    '수입 = 첫 클리어 + 스테이지마다 반복 expected.repeatsPerStage회 + 일일 보상 expected.daysPerChapter일 (추억 레벨업 티켓은 빼고 계산)',
  ];
}
