// 전투 연출 확인용 (dev/battle-ui-test.html만 import — 게임은 쓰지 않음)
// 실제 전투의 유닛으로 가짜 이벤트를 만들어 장면의 연출만 돌림. 엔진 상태는 바꾸지 않고, 끝나면 화면을 엔진 상태로 되돌림
import { groupBeats } from './battleChoreo.js';

export const DEMOS = {
  basic: '기본 공격',
  crit: '치명타',
  multi: '여러 번 때리기',
  skill: '스킬',
  aoe: '광역',
  ult: '궁극기',
  enemy: '적 공격',
  heal: '회복',
  buff: '강화 · 약화',
  shieldBreak: '보호막 깨짐',
  death: '쓰러짐',
  wave: '웨이브 등장',
  info: '정보창',
};

/** 연출 하나 → Promise (끝날 때) */
export async function runDemo(scene, kind) {
  if (scene.playing || scene.ended || scene.info.open) return false;
  const st = scene.battle.state;
  const allies = st.allies.filter((u) => u.alive && scene.cards.get(u.uid)?.alive);
  const enemies = st.enemies.filter((u) => u.alive && scene.cards.get(u.uid)?.alive);
  if (!allies.length || !enemies.length) return false;
  const a = allies[0];
  const e = enemies[0];
  const hpAfter = (u, n) => Math.max(1, u.hp - n);
  const dmg = (src, tgt, amount, o = {}) => ({ t: 'damage', src: src.uid, tgt: tgt.uid, amount, absorbed: 0, crit: false, hp: hpAfter(tgt, amount), ...o });
  const act = (u, action, name, o = {}) => ({ t: 'action', uid: u.uid, action, name, side: u.side, ...o });
  const pct = (u, p) => Math.max(1, Math.round(u.maxHp * p));
  let events = [];
  switch (kind) {
    case 'basic':
      events = [act(a, 'basic', a.kit?.basic?.name || '기본 공격'), dmg(a, e, pct(e, 0.12))];
      break;
    case 'crit':
      events = [act(a, 'basic', a.kit?.basic?.name || '기본 공격'), dmg(a, e, pct(e, 0.25), { crit: true })];
      break;
    case 'multi': {
      const n = pct(e, 0.06);
      events = [act(a, 'basic', '연속 공격'), dmg(a, e, n), { ...dmg(a, e, n), hp: hpAfter(e, n * 2) }, { ...dmg(a, e, n, { crit: true }), hp: hpAfter(e, n * 3) }];
      break;
    }
    case 'skill':
      events = [act(a, 'skill', a.kit?.skill?.name || '스킬'), { t: 'sp', sp: Math.max(0, st.sp.ally - 1), delta: -1 }, dmg(a, e, pct(e, 0.2))];
      break;
    case 'aoe':
      events = [act(a, 'skill', '광역 스킬'), ...enemies.map((x, i) => dmg(a, x, pct(x, 0.1 + i * 0.02), { crit: i === 1 }))];
      break;
    case 'ult':
      events = [act(a, 'ultimate', a.kit?.ultimate?.name || '궁극기'), { t: 'energy', src: a.uid, tgt: a.uid, n: -a.ultCost }, ...enemies.map((x) => dmg(a, x, pct(x, 0.3), { crit: true }))];
      break;
    case 'enemy': {
      const it = scene.battle.intents().find((x) => x.uid === e.uid);
      const tgt = allies.find((x) => x.uid === it?.targetUid) || allies[0];
      events = [act(e, 'basic', it?.name || '공격'), dmg(e, tgt, pct(tgt, 0.15))];
      break;
    }
    case 'heal':
      events = [act(allies.at(-1), 'skill', '치유'), ...allies.map((x) => ({ t: 'heal', src: allies.at(-1).uid, tgt: x.uid, amount: pct(x, 0.1), hp: x.hp }))];
      // 회복이 보이게 먼저 깎아 둠
      for (const x of allies) scene.cards.get(x.uid)?.setHp(Math.max(0.05, x.hp / x.maxHp - 0.25), { instant: true });
      break;
    case 'buff':
      events = [
        act(a, 'skill', '강화'),
        { t: 'status', src: a.uid, tgt: a.uid, kind: 'buff', stat: 'atk', value: 20, turns: 2 },
        { t: 'status', src: a.uid, tgt: e.uid, kind: 'debuff', stat: 'def', value: -15, turns: 2 },
        { t: 'resist', src: a.uid, tgt: e.uid, effect: 'debuff' },
      ];
      break;
    case 'shieldBreak': {
      const tgt = allies[0];
      const s = pct(tgt, 0.1);
      events = [act(allies.at(-1), 'skill', '보호막'), { t: 'shield', src: allies.at(-1).uid, tgt: tgt.uid, amount: s, turns: 2 }, act(e, 'basic', '공격'), dmg(e, tgt, s + pct(tgt, 0.05), { absorbed: s })];
      break;
    }
    case 'death': {
      const last = enemies.at(-1);
      events = [act(a, 'basic', '마무리'), { ...dmg(a, last, last.hp), hp: 0 }, { t: 'death', uid: last.uid, by: a.uid }];
      break;
    }
    case 'wave':
      events = [{ t: 'wave', wave: Math.min(st.waveCount, st.wave + 2), total: Math.max(2, st.waveCount), uids: [] }];
      break;
    case 'info':
      scene.openInfo(scene.cards.get(a.uid));
      return true;
    default:
      return false;
  }
  scene.playing = true;
  scene.mode = 'busy';
  scene.hand.hide();
  try {
    for (const beat of groupBeats(events, (uid) => scene.sideOf(uid))) await scene.playBeat(beat);
  } finally {
    scene.playing = false;
  }
  // 쓰러짐/웨이브 확인 뒤에는 카드를 엔진 상태대로 다시 놓음
  if (kind === 'death' || kind === 'wave') resetCards(scene);
  scene.afterBatch();
  return true;
}

function resetCards(scene) {
  for (const [uid, c] of [...scene.cards]) {
    c.destroy();
    scene.cards.delete(uid);
  }
  scene.makeCards('ally', true);
  scene.makeCards('enemy', true);
}
