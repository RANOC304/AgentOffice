// Target joint angles for each thing a character can be doing. Limbs point down by default;
// a negative x rotation swings a limb forward, the elbow/knee bend is relative to its parent.

import { type Joints, STAND } from './person.ts';

export type PoseName =
  | 'stand'
  | 'walk'
  | 'sit'
  | 'type'
  | 'sitDrink'
  | 'sitPhone'
  | 'sitTalk'
  | 'lounge'
  | 'drink'
  | 'holdCup'
  | 'talk'
  | 'listen'
  | 'wave'
  | 'phone'
  | 'handsBehind'
  | 'stretch'
  | 'pingpong'
  | 'arcade'
  | 'brew'
  | 'watch'
  | 'run'
  | 'floorSit'
  | 'bossSlap'
  | 'bossKick'
  | 'slapped'
  | 'kicked'
  | 'sitSlapped'
  | 'sitKicked'
  | 'jump';

const sitBase = (seat: number): Partial<Joints> => ({
  hipsY: seat + 0.07,
  thighL: -1.5,
  thighR: -1.5,
  kneeL: 1.48,
  kneeR: 1.48,
});

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Smoothstep: eases in and out. */
const ease = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** Upper body of someone just slapped: the head snaps to his right, a hand goes to the cheek. */
function slappedUpper(p: number): Partial<Joints> {
  const snap = clamp01(p / 0.05) * (1 - ease((p - 0.3) / 0.55));
  const cheek = ease((p - 0.12) / 0.2) * (1 - ease((p - 0.7) / 0.28));
  return {
    headRy: -1.2 * snap,
    headRx: -0.16 * snap,
    torsoRy: -0.32 * snap,
    armLx: -1.35 * cheek,
    armLz: 0.07 + 0.3 * cheek,
    elbowL: -0.12 - 2.15 * cheek,
    armRz: -0.07 - 0.35 * snap,
  };
}

/** t is seconds; phase offsets keep characters out of sync; p is the progress of a short action (0–1). */
export function pose(name: PoseName, t: number, seat = 0.47, walkPhase = 0, p = 0): Joints {
  const s = Math.sin;
  const bell = s(Math.min(1, Math.max(0, p)) * Math.PI);
  switch (name) {
    case 'bossSlap': {
      // Raise the right hand to face height, pull it back to the right, then sweep it across the
      // front (the hit lands mid-sweep), follow through and come back.
      const wind = ease(p / 0.28);
      const strike = ease((p - 0.28) / 0.2);
      const k = 1 - ease((p - 0.58) / 0.42);
      return {
        ...STAND,
        torsoRy: (-0.5 * wind + 1.05 * strike) * k,
        torsoRx: 0.06 * k,
        armRx: -1.68 * wind * k,
        armRy: (-1.2 * wind + 2.05 * strike) * k,
        armRz: -0.07,
        elbowR: -0.12 + (-0.85 * wind + 0.8 * strike) * k,
        armLx: -0.4 * k,
        elbowL: -0.12 - 0.7 * k,
        headRy: 0.18 * strike * k,
        thighL: -0.22 * wind * k,
        kneeL: 0.18 * wind * k,
      };
    }
    case 'bossKick':
      return {
        ...STAND,
        hipsY: 0.9,
        torsoRx: -0.28 * bell,
        thighR: -1.55 * bell,
        kneeR: 0.95 * (1 - bell) * (p < 0.5 ? 1 : 0.3) + 0.08,
        thighL: 0.12 * bell,
        kneeL: 0.15 * bell,
        armLx: -0.7 * bell,
        armLz: 0.55 * bell,
        armRx: 0.55 * bell,
        armRz: -0.5 * bell,
        elbowL: -0.5,
        elbowR: -0.5,
      };
    case 'slapped': {
      // A small step back while the head snaps away.
      const step = clamp01(p / 0.08) * (1 - ease((p - 0.25) / 0.4));
      return { ...STAND, ...slappedUpper(p), thighR: 0.25 * step, kneeR: 0.2 * step, torsoRx: -0.08 * step };
    }
    case 'kicked': {
      // Knocked off his feet: falls on his back, lies there dazed, then gets back up.
      const fall = ease(p / 0.15);
      const rise = clamp01((p - 0.62) / 0.34);
      const down = fall * (1 - ease(rise));
      const crouch = s(rise * Math.PI);
      const air = s(clamp01(p / 0.15) * Math.PI);
      const daze = down * (1 - air);
      return {
        ...STAND,
        hipsY: 0.925 - 0.785 * down - 0.18 * crouch,
        hipsRx: -1.5 * down,
        torsoRx: -0.3 * air + 0.75 * crouch,
        headRx: 0.32 * daze + 0.2 * air,
        headRy: s(t * 1.4) * 0.35 * daze,
        thighL: -0.7 * air - 1.25 * crouch - 0.12 * daze + s(t * 3.1) * 0.06 * daze,
        thighR: -0.45 * air - 1.0 * crouch - 0.05 * daze,
        kneeL: 0.6 * air + 1.8 * crouch + 0.3 * daze,
        kneeR: 0.4 * air + 1.6 * crouch + 0.15 * daze,
        armLz: 0.07 + 1.2 * down + s(t * 21) * 0.35 * air,
        armRz: -0.07 - 1.2 * down - s(t * 21) * 0.35 * air,
        armLx: -0.9 * air - 0.55 * crouch - 0.15 * daze,
        armRx: -0.9 * air - 0.55 * crouch - 0.15 * daze,
        elbowL: -0.3,
        elbowR: -0.3,
      };
    }
    case 'sitSlapped':
      return { ...STAND, ...sitBase(seat), ...slappedUpper(p), armRx: -0.3, elbowR: -0.6 };
    case 'jump':
      return { ...STAND, torsoRx: 0.08, thighL: -0.75, kneeL: 1.25, thighR: -0.35, kneeR: 0.8, armLx: -0.5, armRx: -0.5, armLz: 0.55, armRz: -0.55, elbowL: -0.5, elbowR: -0.5, headRx: -0.08 };
    case 'sitKicked':
      return { ...STAND, ...sitBase(seat), torsoRx: -0.45 * bell, headRx: 0.3 * bell, armLz: 0.9 * bell, armRz: -0.9 * bell, armLx: -0.6 * bell, armRx: -0.6 * bell, elbowL: -0.5, elbowR: -0.5 };
    case 'walk': {
      const p = walkPhase;
      const sw = s(p);
      return {
        ...STAND,
        hipsY: 0.925 + Math.abs(s(p)) * 0.025 - 0.012,
        torsoRx: 0.04,
        thighL: sw * 0.5,
        thighR: -sw * 0.5,
        kneeL: Math.max(0, s(p + 1.4)) * 0.75,
        kneeR: Math.max(0, s(p + 1.4 + Math.PI)) * 0.75,
        armLx: -sw * 0.42,
        armRx: sw * 0.42,
        elbowL: -0.25 - Math.max(0, -sw) * 0.25,
        elbowR: -0.25 - Math.max(0, sw) * 0.25,
        headRx: 0.04,
      };
    }
    case 'run': {
      const p = walkPhase;
      const sw = s(p);
      return {
        ...STAND,
        hipsY: 0.9 + Math.abs(s(p)) * 0.055,
        torsoRx: 0.2,
        headRx: -0.12,
        thighL: sw * 0.95 - 0.15,
        thighR: -sw * 0.95 - 0.15,
        kneeL: 0.25 + Math.max(0, s(p + 1.2)) * 1.45,
        kneeR: 0.25 + Math.max(0, s(p + 1.2 + Math.PI)) * 1.45,
        armLx: -sw * 0.95,
        armRx: sw * 0.95,
        armLz: 0.12,
        armRz: -0.12,
        elbowL: -1.45,
        elbowR: -1.45,
      };
    }
    case 'floorSit':
      // On the floor, legs stretched out, leaning back on the hands.
      return {
        ...STAND,
        hipsY: 0.13,
        torsoRx: -0.28,
        headRx: 0.12 + s(t * 0.4) * 0.04,
        headRy: s(t * 0.3) * 0.2,
        thighL: -1.42,
        thighR: -1.32,
        kneeL: 0.18,
        kneeR: 0.38,
        armLx: 0.75,
        armRx: 0.75,
        armLz: 0.28,
        armRz: -0.28,
        elbowL: -0.1,
        elbowR: -0.1,
      };
    case 'sit':
      return { ...STAND, ...sitBase(seat), torsoRx: -0.06, elbowL: -0.5, elbowR: -0.5, armLx: -0.25, armRx: -0.25 };
    case 'type': {
      const a = s(t * 11) * 0.06;
      const b = s(t * 13 + 1.3) * 0.06;
      return {
        ...STAND,
        ...sitBase(seat),
        torsoRx: 0.1,
        headRx: 0.16 + s(t * 0.7) * 0.04,
        headRy: s(t * 0.4) * 0.08,
        armLx: -0.55,
        armRx: -0.55,
        armLz: 0.14,
        armRz: -0.14,
        elbowL: -1.0 + a,
        elbowR: -1.0 + b,
      };
    }
    case 'sitDrink': {
      const sip = Math.max(0, s(t * 0.9)) ** 3;
      return { ...STAND, ...sitBase(seat), torsoRx: -0.05, armRx: -0.35 - sip * 0.25, armRz: -0.12, elbowR: -1.4 - sip * 0.9, headRx: -sip * 0.15, armLx: -0.3, elbowL: -0.6 };
    }
    case 'sitPhone':
      return { ...STAND, ...sitBase(seat), torsoRx: 0.05, headRx: 0.38, armLx: -0.35, armRx: -0.35, armLz: 0.2, armRz: -0.2, elbowL: -1.35, elbowR: -1.35 };
    case 'sitTalk': {
      const g = s(t * 2.1);
      return { ...STAND, ...sitBase(seat), torsoRx: 0.02, headRy: s(t * 0.8) * 0.25, headRx: s(t * 3) * 0.05, armRx: -0.5 - g * 0.15, armRz: -0.2, elbowR: -1.3 + g * 0.3, armLx: -0.3, elbowL: -0.7 };
    }
    case 'lounge':
      return { ...STAND, ...sitBase(seat), torsoRx: -0.22, headRx: -0.05, armLz: 0.35, armRz: -0.35, elbowL: -0.4, elbowR: -0.4, thighL: -1.3, thighR: -1.3, kneeL: 1.15, kneeR: 1.25 };
    case 'drink': {
      const sip = Math.max(0, s(t * 0.8)) ** 3;
      return { ...STAND, armRx: -0.3 - sip * 0.3, armRz: -0.1, elbowR: -1.35 - sip * 0.95, headRx: -sip * 0.15 };
    }
    case 'holdCup':
      return { ...STAND, armRx: -0.25, armRz: -0.1, elbowR: -1.35 };
    case 'talk': {
      const g = s(t * 2.4);
      const h = s(t * 1.7 + 0.5);
      return {
        ...STAND,
        headRy: s(t * 0.9) * 0.2,
        headRx: s(t * 3.2) * 0.05,
        torsoRy: s(t * 0.6) * 0.06,
        armRx: -0.45 - g * 0.25,
        armRz: -0.25,
        elbowR: -1.2 + g * 0.35,
        armLx: -0.2 - Math.max(0, h) * 0.4,
        armLz: 0.2,
        elbowL: -0.8 - Math.max(0, h) * 0.4,
      };
    }
    case 'listen':
      return { ...STAND, headRx: 0.06 + s(t * 2.2) * 0.06, headRy: s(t * 0.5) * 0.08, armLx: 0.25, armRx: 0.25, elbowL: -0.5, elbowR: -0.5 };
    case 'wave': {
      const w = s(t * 7);
      return { ...STAND, armRz: -2.55, armRx: -0.2, elbowR: -0.55 + w * 0.45, headRx: -0.08, torsoRy: 0.08 };
    }
    case 'phone':
      return { ...STAND, armRx: -0.45, armRz: -0.35, elbowR: -2.35, headRy: 0.15, headRx: s(t * 1.3) * 0.05, armLx: 0.3, elbowL: -0.4 };
    case 'handsBehind':
      return { ...STAND, armLx: 0.45, armRx: 0.45, armLz: 0.18, armRz: -0.18, elbowL: -1.2, elbowR: -1.2, headRx: -0.08 + s(t * 0.4) * 0.05, headRy: s(t * 0.25) * 0.3 };
    case 'stretch': {
      const k = (s(t * 1.5) + 1) / 2;
      return { ...STAND, ...sitBase(seat), torsoRx: -0.25, armLx: -2.7 - k * 0.2, armRx: -2.7 - k * 0.2, armLz: -0.15, armRz: 0.15, elbowL: -0.35, elbowR: -0.35, headRx: -0.25 };
    }
    case 'pingpong': {
      const sw = s(t * 3.4);
      return {
        ...STAND,
        hipsY: 0.88,
        thighL: -0.35,
        thighR: -0.15,
        kneeL: 0.5,
        kneeR: 0.35,
        torsoRx: 0.18,
        torsoRy: sw * 0.35,
        armRx: -0.9 - sw * 0.4,
        armRz: -0.45,
        elbowR: -0.9,
        armLx: -0.4,
        elbowL: -0.9,
      };
    }
    case 'arcade': {
      const j = s(t * 9) * 0.07;
      return { ...STAND, torsoRx: 0.12, headRx: -0.05, armLx: -0.85 + j, armRx: -0.85 - j, armLz: 0.1, armRz: -0.1, elbowL: -0.55, elbowR: -0.55 };
    }
    case 'brew':
      return { ...STAND, torsoRx: 0.08, headRx: 0.25, armRx: -0.75, armRz: -0.05, elbowR: -0.7 + s(t * 2) * 0.1, armLx: -0.2 };
    case 'watch':
      return { ...STAND, headRx: -0.15, armLx: 0.1, armRx: -0.1, armRz: -0.3, elbowR: -1.6, armLz: 0.3, elbowL: -1.4 };
    case 'stand':
    default:
      return { ...STAND, headRy: s(t * 0.35) * 0.15, armLz: 0.07 + s(t * 0.8) * 0.01 };
  }
}
