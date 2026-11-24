// 움직임 도우미 — 모든 트윈은 여기로 (BATTLE_UI.md 3장 · 12장 · 13장)
// - 시간은 토큰 이름(instant/fast/base/slow/dramatic) 또는 ms. 배속은 장면의 timeScale이 처리
// - 같은 대상 · 같은 속성에 걸린 이전 트윈을 먼저 정리 (떨림 방지)
// - 동작 줄이기(reduced): 장식용 이동(돌진 · 밀림 · 떠 있음)과 흔들림 · 화면 섬광 · 히트스톱은 부르는 쪽이 m.reduced로 건너뜀,
//   배치 이동(재정렬 · 순서 칩)은 fast + Cubic.easeOut으로 짧게 — 정보는 그대로
// - 즉시 결과(instant): 모든 트윈이 끝 값으로 바로 맞춰지고 바로 끝남
import { BT } from './battleTheme.js';

const EASE = BT.ease;

/** 토큰 → ms */
export const dur = (token) => (typeof token === 'number' ? token : BT.motion[token] ?? BT.motion.base);

/**
 * @param {Phaser.Scene} scene
 * @param {{speed?:1|2, reduced?:boolean}} o
 */
export function createMotion(scene, { speed = 1, reduced = false } = {}) {
  const m = {
    speed,
    reduced,
    instant: false,
    stops: 0, // 진행 중인 히트스톱 수

    /**
     * 트윈 하나 → Promise (끝나거나 멈추면 resolve)
     * @param {object|object[]} targets
     * @param {object} props 끝 값 (from/to 객체도 가능)
     * @param {string|number} token
     * @param {'out'|'in'|'pop'|'loop'|'linear'} ease
     * @param {object} [extra] delay, yoyo, onUpdate …
     */
    tween(targets, props, token = 'base', ease = 'out', extra = {}) {
      const list = (Array.isArray(targets) ? targets : [targets]).filter((t) => t && (t.active !== false || t.scene === undefined));
      if (!list.length) return Promise.resolve();
      const keys = Object.keys(props);
      m.kill(list, keys);
      if (m.instant) {
        for (const t of list) {
          for (const k of keys) {
            const v = endValue(props[k]);
            if (v !== undefined) t[k] = v;
          }
        }
        extra.onUpdate?.();
        extra.onComplete?.();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const done = () => {
          extra.onComplete?.();
          resolve();
        };
        scene.tweens.add({
          targets: list,
          ...props,
          duration: dur(token),
          ease: EASE[ease] || ease,
          easeParams: ease === 'pop' ? [BT.backOvershoot] : undefined,
          ...extra,
          onComplete: done,
          onStop: resolve,
        });
      });
    },

    /** 반복 트윈 (맥박 · 빛 · 떠 있음). 핸들(stop) 반환 */
    loop(target, props, period, { ease = 'loop', delay = 0 } = {}) {
      if (!target) return { stop() {} };
      m.kill([target], Object.keys(props));
      const tw = scene.tweens.add({ targets: target, ...props, duration: period / 2, ease: EASE[ease] || ease, yoyo: true, repeat: -1, delay });
      return {
        tween: tw,
        stop() {
          tw.remove();
        },
      };
    },

    /** 같은 대상 · 같은 속성의 트윈 정리 (keys가 없으면 그 대상 전부) */
    kill(targets, keys = null) {
      for (const t of Array.isArray(targets) ? targets : [targets]) {
        if (!t) continue;
        for (const tw of scene.tweens.getTweensOf(t)) {
          if (!keys || !tw.data || tw.data.some((d) => keys.includes(d.key))) tw.remove();
        }
      }
    },

    /** 기다리기 (장면 시간 → 배속 반영, 즉시 결과면 바로) */
    wait(token) {
      if (m.instant) return Promise.resolve();
      const ms = dur(token);
      if (ms <= 0) return Promise.resolve();
      return new Promise((r) => scene.time.delayedCall(ms, r));
    },

    /** 목록을 시차 두고 차례로 시작 (끝을 다 기다림) */
    async stagger(list, fn, gap) {
      const all = [];
      for (let i = 0; i < list.length; i++) {
        all.push(fn(list[i], i));
        if (i < list.length - 1 && gap > 0) await m.wait(gap);
      }
      await Promise.all(all);
    },

    /** 히트스톱: 모든 트윈을 잠깐 멈춤 (2배속은 ÷1.5만, 동작 줄이기/즉시 결과는 없음) */
    hitStop(ms) {
      if (m.reduced || m.instant || ms <= 0) return Promise.resolve();
      const real = m.speed === 2 ? ms / BT.speed2HitStopDiv : ms;
      // 장면 시간은 speed배로 흐르므로 real ms가 되게 맞춤
      const sceneMs = real * scene.time.timeScale;
      m.stops += 1;
      scene.tweens.pauseAll();
      return new Promise((r) =>
        scene.time.delayedCall(sceneMs, () => {
          m.stops -= 1;
          if (m.stops <= 0 && !scene.time.paused) scene.tweens.resumeAll();
          r();
        }),
      );
    },

    /** 카메라 흔들림 (카메라는 timeScale을 안 따르므로 직접 나눔) */
    shake(level, ms = BT.hit.shakeDur) {
      if (m.reduced || m.instant || !level) return;
      scene.cameras.main.shake(ms / m.speed, level);
    },

    /** 흰색 번쩍임 (setTintFill이 되는 그림) */
    flash(target, ms = BT.hit.flash, color = 0xffffff) {
      if (m.instant || !target?.setTintFill) return Promise.resolve();
      target.setTintFill(color);
      return m.wait(ms).then(() => target.active && target.clearTint?.());
    },
  };
  return m;
}

/** {from, to} 같은 값에서 끝 값 */
function endValue(v) {
  if (v && typeof v === 'object') return v.to ?? v.value ?? v.from;
  if (typeof v === 'string' && /^[+-]=/.test(v)) return undefined; // 상대 값은 즉시 모드에서 쓰지 않음
  return v;
}
