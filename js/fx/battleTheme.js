// 전투 화면의 모든 숫자 (배치 · 크기 · 색 · 움직임) — 기준 문서는 BATTLE_UI.md
// 장면/컴포넌트 코드에는 숫자를 직접 쓰지 않고 여기서 가져옴. 값을 바꾸면 BATTLE_UI.md도 같이 고침.
// 시간은 전부 1배속 기준 ms (2배속은 장면의 timeScale이 처리, 히트스톱만 motion.js가 보정)

export const BT = Object.freeze({
  W: 1280,
  H: 720,

  // ── 1장: 화면 배치 ──
  area: {
    top: { x: 0, y: 0, w: 1280, h: 56 },
    queue: { x: 16, y: 72, w: 96, h: 600 },
    enemy: { x: 128, y: 72, w: 944, h: 280 },
    ally: { x: 128, y: 420, w: 944, h: 284 },
    hand: { x: 1088, y: 400, w: 176, h: 240 },
    sp: { x: 1088, y: 650, w: 176, h: 40 },
  },
  /** 적 카드 줄의 가운데 높이 (예고 배지가 위쪽 가장자리에 걸치도록 영역 가운데보다 조금 아래) */
  enemyRowDy: 14,
  minText: 20, // 기준 해상도에서 글자 최소 크기
  minTouch: 88, // 터치 대상 최소 크기
  background: { brightness: 0.6, vignette: 0.55 },

  // ── 카드 크기 ──
  card: {
    ally: { w: 156, h: 218, gap: 18 },
    enemy: { w: 140, h: 196, gap: 20 },
    boss: { w: 184, h: 258, gap: 28 },
    crowd: { from: 5, scale: 0.85, gap: 14 }, // 적이 5~6명일 때
    hand: { w: 112, h: 156, fan: 6, spread: 58 }, // spread = 두 카드 가운데 사이 간격
    radius: 14,
    rarityLine: 2,
    artTop: 0.55, // 일러스트 위쪽 몇 %를 카드에 쓰는지
    artTopEnemy: 0.62,
    shade: 0.4, // 아래 어두운 그라데이션 높이 비율
    shadeAlpha: 0.85,
    energyH: 4,
    hpH: 8,
    hpInset: 10, // HP 막대 좌우 여백 / 아래 여백
    nameSize: 20,
    nameStroke: 3,
    roleIcon: 28,
    effectIcon: 24,
    effectMax: 4,
    turnDots: 3,
    resPip: 9, // 자원(스택) 마름모 한 변
    resMaxPips: 8, // 이보다 많으면 세로 막대로
    shieldAlpha: 0.35,
    shieldLine: 2,
    tauntLine: 6,
    stateLine: 3, // 대상 가능 / 낮은 HP / 강화 번쩍임 테두리
    res: 2, // 구운 카드 텍스처 해상도 배율 (확대 화면에서 흐려지지 않게)
  },

  // ── 3장: 모션 토큰 ──
  motion: { instant: 80, fast: 140, base: 220, slow: 360, dramatic: 600 },
  ease: {
    out: 'Cubic.easeOut',
    in: 'Cubic.easeIn',
    pop: 'Back.easeOut',
    loop: 'Sine.easeInOut',
    linear: 'Linear', // 진행 막대 같은 예외만
  },
  backOvershoot: 1.6,
  speed2HitStopDiv: 1.5, // 2배속에서 히트스톱은 ÷1.5만

  // ── 4장: 카드 상태 ──
  state: {
    idleBob: 2,
    idlePeriod: 3000,
    hoverScale: 1.03,
    pressScale: 0.97,
    activeLift: 18,
    activeScale: 1.06,
    aimScale: 1.05,
    targetPulse: 600,
    lowHpPulse: 1200,
    readyPulse: 520, // 궁극기 준비 테두리 빛 (투명도 1 ↔ 0.4)
    readyAlphaMin: 0.4,
    dimTint: 0x777777,
    stunTint: 0x8a8a8a,
    aimSpin: 2400, // 조준 표시 한 바퀴
  },
  shadow: { dy: 8, alpha: 0.45, liftDy: 20, liftAlpha: 0.3, liftScale: 1.12, pad: 26 },
  glow: { pad: 30 },

  // ── 2장: HP / 기력 ──
  hp: { trailDelay: 250, trailDur: 300, healLead: 80, healFollow: 200, mid: 0.5, low: 0.3 },

  // ── 7장: 행동 연출 ──
  hit: {
    backoff: 14,
    windupScale: 1.08,
    windup: 120,
    dash: 140,
    dashRatio: 0.7,
    tilt: 6,
    stop: 60,
    critStop: 90,
    flash: 60,
    shakeDur: 120,
    shake: 0.004,
    critShake: 0.008,
    knock: 16,
    ret: 260,
    multiGap: 110,
    aoeStagger: 40,
    sparks: 10,
    critSparks: 16,
  },
  skill: { showScale: 1.15, show: 300, absorb: 200, beam: 'fast' },
  aoe: { forward: 40, scale: 1.1 },
  ult: { flashAlpha: 0.6, flash: 80, stop: 100, shake: 0.012, shakeDur: 260, bandH: 120, bandAngle: -12 },
  death: { flash: 80, crack: 160, fall: 360, drop: 30, reflowStagger: 30 },
  wave: { dropFrom: 120, dropScale: 1.2, stagger: 60, bandHold: 520, bandH: 110 },
  // 화면 가운데 띠 (WAVE / 페이즈 / 광폭화)
  band: { size: 52, sub: 24 },

  // ── 8장: 떠오르는 숫자 ──
  number: {
    dmg: { size: 34, color: 0xffffff },
    crit: { size: 46, color: 0xffc23d, angle: -6 },
    dot: { size: 26, color: 0xc58cff },
    heal: { size: 30, color: 0x6ff0a0 },
    absorb: { size: 26, color: 0x9fd8ff },
    total: { size: 64, color: 0xffc23d },
    stroke: 6,
    popFrom: 0.6,
    popPeak: 1.15,
    pop: 160,
    rise: 40,
    riseDur: 600,
    stackDy: 26,
    jitterX: 18,
    poolSize: 24,
  },

  // ── 9장: 행동 순서 ──
  queue: { cur: 72, size: 56, gap: 10, count: 7, ring: 3, enterDy: 24, exitDy: 30, pulse: 1000 },

  // ── 5장: 조작 ──
  press: { long: 400, ringDelay: 150, slop: 12, ringR: 30, ringW: 5 },
  hand: { liftScale: 1.1, hideDy: 60, shakeX: 6 },
  arrow: { gap: 28, speed: 120, snap: 20, chevron: 22, attack: 0xff6a4d, support: 0x6ff0a0, lift: 120 },
  intent: { badge: 44, icon: 36, dotR: 4, dotGap: 12, idleAlpha: 0.3, liveAlpha: 1, bigPulse: 1.08, bigPulseDur: 420 },

  // ── 10장: 정보창 ──
  info: { dim: 0.72, cardScale: 2.2, cardX: 250, slide: 40, delay: 60, panel: { x: 470, y: 48, w: 776, h: 624 }, pad: 28, line: 30 },

  // ── 11장: 색 ──
  color: {
    bg: 0x0b0812,
    text: '#ffffff',
    textMid: '#c9c4d6',
    textDim: '#8a8499',
    textStroke: '#140c22',
    ally: 0x6cc8ff, // 아군 강조 (테마색 없을 때 기본)
    enemy: 0xff7a4d, // 적 강조
    gold: 0xffc23d, // 치명타 · 궁극기 · 강화에만
    heal: 0x6ff0a0, // 회복에만
    debuff: 0xb06cff, // 약화 · 지속 피해에만
    shield: 0x9fd8ff,
    hpMid: 0xffb13d,
    hpLow: 0xff4d5e,
    hpBg: 0x1a1226,
    trail: 0xffffff,
    energyBg: 0x140e22,
    cardBg: 0x1b1430,
    panel: 0x161026,
    panelLine: 0x4b3a78,
    stone: 0x9a8f80, // 도발 프레임
    transform: 0xff8ae0,
    white: 0xffffff,
    black: 0x000000,
    dark: 0x07040f,
    crack: 0xffffff,
  },
  radius: { card: 14, badge: 10, panel: 10 },

  // ── 13-1장: 성능 ──
  particles: { burst: 16, max: 150 },
  font: { body: '500', bold: '800' },
});

export const MOTION = BT.motion;
