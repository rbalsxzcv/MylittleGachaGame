// 효과 등록표 — 새 효과는 (1) 이 폴더에 모듈 하나 (2) 여기 한 줄 (3) vocab.json effects에 한 항목
import * as damage from './damage.js';
import * as heal from './heal.js';
import * as shield from './shield.js';
import * as buff from './buff.js';
import * as debuff from './debuff.js';
import * as energyGain from './energyGain.js';
import * as cooldownReduce from './cooldownReduce.js';
import * as dot from './dot.js';
import * as cleanse from './cleanse.js';
import * as taunt from './taunt.js';

export const EFFECTS = {
  damage: damage.apply,
  heal: heal.apply,
  shield: shield.apply,
  buff: buff.apply,
  debuff: debuff.apply,
  energy_gain: energyGain.apply,
  cooldown_reduce: cooldownReduce.apply,
  dot: dot.apply,
  cleanse: cleanse.apply,
  taunt: taunt.apply,
};
