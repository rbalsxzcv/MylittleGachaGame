// 전투 이벤트 → 전투 기록 문장 (한국어). 화면 없이도 쓸 수 있는 순수 함수
const ACTION_LABEL = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기' };
const STAT_LABEL = { atk: '공격력', def: '방어력', critRate: '치명타 확률', critDmg: '치명타 피해', dmgDealt: '주는 피해', dmgTaken: '받는 피해' };
const n = (v) => Number(v).toLocaleString('ko-KR');
const signed = (v) => `${v > 0 ? '+' : ''}${v}`;

/**
 * @param {object} ev 엔진 이벤트
 * @param {(uid:string)=>string} nameOf
 * @returns {{text:string, kind:string}|null} 기록에 남기지 않을 이벤트면 null
 */
export function eventText(ev, nameOf) {
  const tgt = () => nameOf(ev.tgt);
  switch (ev.t) {
    case 'round':
      return { kind: 'round', text: `라운드 ${ev.round}` };
    case 'wave':
      return { kind: 'wave', text: `웨이브 ${ev.wave}/${ev.total}` };
    case 'action':
      return { kind: 'action', text: `${nameOf(ev.uid)} · ${ACTION_LABEL[ev.action]} 「${ev.name}」` };
    case 'damage':
      if (ev.dot) return { kind: 'damage', text: `${tgt()} 지속 피해 ${n(ev.amount)}` };
      return {
        kind: ev.crit ? 'crit' : 'damage',
        text: `→ ${tgt()}에게 ${n(ev.amount)} 피해${ev.crit ? ' (치명타!)' : ''}${ev.absorbed ? ` (보호막 ${n(ev.absorbed)} 흡수)` : ''}`,
      };
    case 'heal':
      return ev.amount > 0 ? { kind: 'heal', text: `→ ${tgt()} HP ${n(ev.amount)} 회복` } : null;
    case 'shield':
      return { kind: 'buff', text: `→ ${tgt()} 보호막 ${n(ev.amount)} (${ev.turns}턴)` };
    case 'status':
      return { kind: ev.kind, text: `→ ${tgt()} ${STAT_LABEL[ev.stat] || ev.stat} ${signed(ev.value)}% (${ev.turns}턴)` };
    case 'energy':
      return ev.n ? { kind: 'buff', text: `→ ${tgt()} 기력 ${signed(ev.n)}` } : null;
    case 'cooldown':
      return ev.n ? { kind: 'buff', text: `→ ${tgt()} 스킬 대기 −${ev.n}` } : null;
    case 'dot':
      return { kind: 'debuff', text: `→ ${tgt()}에게 지속 피해 (${ev.turns}턴, 턴마다 ${n(ev.dmg)})` };
    case 'cleanse':
      return { kind: 'buff', text: `→ ${tgt()} 정화${ev.n ? ` (${ev.n}개 해제)` : ''}` };
    case 'taunt':
      return { kind: 'buff', text: `→ ${tgt()} 도발 (${ev.turns}턴)` };
    case 'passive':
      return { kind: 'passive', text: `✦ ${nameOf(ev.uid)} 「${ev.name}」` };
    case 'death':
      return { kind: 'death', text: `${nameOf(ev.uid)} 쓰러짐` };
    case 'end':
      return { kind: 'end', text: ev.result === 'win' ? '승리!' : ev.reason === 'timeout' ? '패배 (턴 초과)' : '패배' };
    default:
      return null;
  }
}
