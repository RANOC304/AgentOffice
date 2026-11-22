// Generative lo-fi music for the office: jazzy seventh chords on a soft electric piano, a round bass,
// a swung boom-bap beat, a little melody and vinyl crackle. It never repeats exactly: progressions,
// key and patterns change every few bars. Late at night it turns into a calm ambient pad.

import { audio } from './engine.ts';

const BPM = 74;
const STEP = 60 / BPM / 4;
const SWING = 0.17;

// Seventh chords as semitones above the key root (major key).
const I = [0, 4, 7, 11];
const ii = [2, 5, 9, 12];
const iii = [4, 7, 11, 14];
const IV = [5, 9, 12, 16];
const V = [7, 11, 14, 17];
const vi = [9, 12, 16, 19];
const PROGRESSIONS = [
  [I, vi, ii, V],
  [IV, iii, vi, V],
  [ii, V, I, vi],
  [I, IV, iii, vi],
  [vi, IV, I, V],
  [IV, V, iii, vi],
];
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];
const KEYS = [50, 52, 53, 55, 57]; // D3, E3, F3, G3, A3

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private bar = 0;
  private key = pick(KEYS);
  private progression = pick(PROGRESSIONS);
  private out: GainNode | null = null;
  private crackle: AudioBufferSourceNode | null = null;
  private melodyNote = 2;

  start() {
    const ctx = audio.ctx;
    if (!ctx || this.timer) return;
    // Warm lo-fi tone: everything goes through a gentle low-pass.
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 2);
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 5200;
    this.out.connect(warm).connect(audio.music);
    this.startCrackle();
    this.next = ctx.currentTime + 0.3;
    this.timer = setInterval(() => this.schedule(), 150);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.crackle?.stop();
    } catch {
      // already stopped
    }
    this.out?.disconnect();
    this.out = null;
  }

  private get night(): boolean {
    const h = new Date().getHours();
    return h >= 22 || h < 7;
  }

  private schedule() {
    const ctx = audio.ctx;
    if (!ctx || !this.out) return;
    if (audio.settings.music <= 0.001 || !audio.settings.enabled) {
      this.next = Math.max(this.next, ctx.currentTime + 0.1);
      return;
    }
    // Background tabs run timers once a second: schedule further ahead then.
    const ahead = document.hidden ? 2.6 : 0.6;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + ahead) {
      const swing = this.step % 2 === 1 ? SWING * STEP : 0;
      this.play(this.next + swing, this.step);
      this.next += STEP;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar += 1;
        if (this.bar % 8 === 0) {
          this.progression = pick(PROGRESSIONS);
          if (Math.random() < 0.25) this.key = pick(KEYS);
        }
      }
    }
  }

  private play(t: number, step: number) {
    const chord = this.progression[this.bar % 4];
    const root = this.key;
    const night = this.night;
    if (step === 0) {
      if (night) this.pad(t, chord.map((n) => root + 12 + n), STEP * 16);
      else this.chord(t, chord.map((n) => root + 12 + n), 0.85, STEP * 14);
    }
    if (!night && (step === 6 || step === 10) && Math.random() < 0.55) this.chord(t, chord.slice(1).map((n) => root + 12 + n), 0.45, STEP * 4);
    // Bass.
    if (step === 0) this.bass(t, root - 12 + chord[0], STEP * 5);
    if (step === 7 && Math.random() < 0.6) this.bass(t, root - 12 + chord[0] + (Math.random() < 0.5 ? 7 : 12), STEP * 2);
    if (step === 10 && !night) this.bass(t, root - 12 + chord[0], STEP * 3);
    if (step === 14 && Math.random() < 0.35) this.bass(t, root - 12 + chord[0] - 1, STEP * 1.5);
    // Beat.
    if (!night) {
      if (step === 0 || step === 10 || (step === 7 && Math.random() < 0.3)) this.kick(t);
      if (step === 4 || step === 12) this.snare(t);
      if (step % 2 === 0) this.hat(t, step % 4 === 0 ? 0.9 : 0.6);
      else if (Math.random() < 0.2) this.hat(t, 0.35);
    }
    // A sparse melody.
    if (step % 2 === 0 && Math.random() < (night ? 0.12 : 0.22)) {
      this.melodyNote = Math.max(0, Math.min(PENTATONIC.length - 1, this.melodyNote + pick([-2, -1, -1, 1, 1, 2])));
      this.lead(t, root + 24 + PENTATONIC[this.melodyNote], STEP * pick([2, 3, 4, 6]));
    }
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = audio.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** Electric piano: a two-operator FM voice per note, slightly strummed. */
  private chord(t: number, notes: number[], vel: number, dur: number) {
    const ctx = audio.ctx!;
    notes.forEach((m, i) => {
      const at = t + i * 0.012;
      const f = mtof(m);
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      car.frequency.value = f;
      mod.frequency.value = f;
      modGain.gain.setValueAtTime(f * 1.8 * vel, at);
      modGain.gain.exponentialRampToValueAtTime(f * 0.15, at + 0.5);
      mod.connect(modGain).connect(car.frequency);
      const g = this.env(at, 0.05 * vel, 0.006, dur + 0.5);
      car.connect(g).connect(this.out!);
      car.start(at);
      mod.start(at);
      car.stop(at + dur + 0.6);
      mod.stop(at + dur + 0.6);
    });
  }

  private pad(t: number, notes: number[], dur: number) {
    const ctx = audio.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 1.2);
    g.gain.setValueAtTime(0.03, t + dur - 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    filter.connect(g).connect(this.out!);
    for (const m of notes)
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = detune;
        o.connect(filter);
        o.start(t);
        o.stop(t + dur + 1.3);
      }
  }

  private bass(t: number, m: number, dur: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = this.env(t, 0.22, 0.012, dur);
    o.connect(f).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private kick(t: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = this.env(t, 0.55, 0.004, 0.32);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.4);
  }

  private snare(t: number) {
    const ctx = audio.ctx!;
    const n = audio.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = this.env(t, 0.2, 0.003, 0.17);
    n.connect(bp).connect(g).connect(this.out!);
    n.start(t, Math.random());
    n.stop(t + 0.22);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 185;
    const g2 = this.env(t, 0.08, 0.002, 0.07);
    o.connect(g2).connect(this.out!);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, vel: number) {
    const ctx = audio.ctx!;
    const n = audio.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = this.env(t, 0.06 * vel, 0.002, 0.045);
    n.connect(hp).connect(g).connect(this.out!);
    n.start(t, Math.random());
    n.stop(t + 0.08);
  }

  private lead(t: number, m: number, dur: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(m);
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.frequency.value = 5.2;
    vibGain.gain.value = mtof(m) * 0.004;
    vib.connect(vibGain).connect(o.frequency);
    const g = this.env(t, 0.045, 0.03, dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
  }

  /** Vinyl crackle: sparse clicks and a faint hiss, looped. */
  private startCrackle() {
    const ctx = audio.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.012;
      if (Math.random() < 0.00035) {
        const amp = 0.25 + Math.random() * 0.5;
        for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / 6);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(hp).connect(g).connect(this.out!);
    src.start();
    this.crackle = src;
  }
}
