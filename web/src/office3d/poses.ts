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
  | 'watch';

const sitBase = (seat: number): Partial<Joints> => ({
  hipsY: seat + 0.07,
  thighL: -1.5,
  thighR: -1.5,
  kneeL: 1.48,
  kneeR: 1.48,
});

/** t is seconds; phase offsets keep characters out of sync. */
export function pose(name: PoseName, t: number, seat = 0.47, walkPhase = 0): Joints {
  const s = Math.sin;
  switch (name) {
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
