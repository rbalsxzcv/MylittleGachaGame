// 상시 수정자 등록표: 유닛을 만들 때 한 번 적용 (unit, modifier) → unit 직접 수정
// stat_bonus는 능력치 계산(progression.statsOf)에서 이미 반영됨

export const MODIFIERS = {
  action_targeting: (u, m) => {
    const s = u.kit[m.action];
    if (!s) return;
    s.targeting = m.targeting;
    if (m.count) s.count = m.count;
  },
  ultimate_cost: (u, m) => {
    u.ultCost += m.delta;
  },
  cooldown: (u, m) => {
    if (u.kit.skill) u.kit.skill.cooldown = Math.max(0, (u.kit.skill.cooldown || 0) + m.delta);
  },
  energy_gain: (u, m) => {
    u.energyGain[m.source] = (u.energyGain[m.source] || 0) + m.delta;
  },
  stat_bonus: () => {},
  effect_power: (u, m) => {
    u.effectPower.push({ action: m.action, effect: m.effect, pct: m.pct });
  },
  extra_effects: (u, m) => {
    const s = u.kit[m.action];
    if (!s) return;
    for (const e of m.effects) s.effects.push(m.target && !e.target ? { ...e, target: m.target } : { ...e });
  },
};
