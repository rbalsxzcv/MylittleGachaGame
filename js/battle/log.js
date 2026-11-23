// 전투 이벤트 → 전투 기록 문장 (한국어). 화면 없이도 쓸 수 있는 순수 함수
const ACTION_LABEL = { basic: '기본 공격', skill: '스킬', ultimate: '궁극기', follow_up: '추가 공격', counter: '반격' };
const STAT_LABEL = { atk: '공격력', def: '방어력', spd: '속도', critRate: '치명타 확률', critDmg: '치명타 피해', dmgDealt: '주는 피해', dmgTaken: '받는 피해', energyRegen: '기력 회복', effectHit: '효과 적중', effectRes: '효과 저항', healBonus: '치유 보너스', shieldBonus: '보호막 보너스' };
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
    case 'stack':
      return { kind: 'buff', text: `· ${tgt()} ${ev.name} ${ev.value}/${ev.cap} (${signed(ev.delta)})` };
    case 'mark':
      return { kind: 'debuff', text: `· ${tgt()}에게 표식 ${ev.n}개 (${ev.turns}턴)` };
    case 'detonate':
      return { kind: 'damage', text: `· ${tgt()}의 표식 ${ev.n}개 폭발` };
    case 'resist':
      return { kind: 'info', text: `· ${tgt()}이(가) 효과에 저항` };
    case 'transform':
      return { kind: 'buff', text: `${nameOf(ev.uid)} 변신 (${ev.turns}턴)` };
    case 'transform_end':
      return { kind: 'info', text: `${nameOf(ev.uid)} 변신 해제` };
    case 'token_add':
      return { kind: ev.big ? 'ultimate' : 'info', text: `${nameOf(ev.owner)} → ${ev.kind === 'charge' ? '차지' : '소환'} 「${ev.name}」${ev.big ? ' (큰 공격, 차단 가능)' : ''}` };
    case 'token_act':
      return { kind: 'action', text: `${nameOf(ev.owner)} → 「${ev.name}」 ${ev.kind === 'charge' ? '발동' : '행동'}` };
    case 'token_end':
      return ev.why === 'interrupted' ? { kind: 'info', text: '차지가 끊겼어요' } : null;
    case 'round':
      return { kind: 'round', text: `라운드 ${ev.round}` };
    case 'wave':
      return { kind: 'wave', text: `웨이브 ${ev.wave}/${ev.total}` };
    case 'action':
      return { kind: ev.action === 'ultimate' ? 'ultimate' : 'action', text: `${nameOf(ev.uid)} · ${ACTION_LABEL[ev.action] || '행동'} 「${ev.name}」` };
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
    case 'sp':
      return ev.src ? null : { kind: 'buff', text: `SP ${signed(ev.delta)} (${ev.sp})` };
    case 'av':
      return { kind: ev.pct < 0 ? 'buff' : 'debuff', text: `→ ${tgt()} 행동 ${Math.abs(ev.pct)}% ${ev.pct < 0 ? '당김' : '밀림'}` };
    case 'interrupt':
      return { kind: ev.ok ? 'buff' : 'muted', text: ev.ok ? `→ ${tgt()}의 큰 공격을 끊었다!` : `→ ${tgt()} 차단 (끊을 큰 공격 없음)` };
    case 'stagger':
      return { kind: 'buff', text: `${nameOf(ev.uid)} 흐트러짐 — 「${ev.name}」 실패` };
    case 'phase':
      return { kind: 'wave', text: `${nameOf(ev.uid)} — ${ev.name}` };
    case 'enrage':
      return { kind: 'debuff', text: `${nameOf(ev.uid)} 광폭화!` };
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
