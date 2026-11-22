// The office soundscape, driven by what happens in the 3D scene: the elevator hum, its doors and
// bell, footsteps, keyboards, the coffee machine, ping-pong, wind, birds by day and crickets at
// night, slapstick hits, and every character's voice. Music plays underneath.

import type * as THREE from 'three';
import type { Elevator } from '../office3d/elevator.ts';
import { ELEVATOR } from '../office3d/layout.ts';
import { BOSS_ID, type Char, type Sim, type SimSound } from '../office3d/sim.ts';
import { audio, type Vec3 } from './engine.ts';
import { Music } from './music.ts';
import { babble, ouch, speak, stopSpeech, voiceFor } from './voice.ts';

interface Loop {
  gain: GainNode;
  stop: () => void;
  panner?: PannerNode;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export class OfficeSound {
  private sim: Sim;
  private elevator: Elevator;
  private camera: THREE.Camera;
  private music = new Music();
  private hum: Loop | null = null;
  private wind: Loop | null = null;
  private brew: Loop | null = null;
  private lastElevY = 0;
  private lastDoors = 0;
  private doorsMoving = false;
  private elevMoving = false;
  private steps = new Map<string, number>();
  private typing = new Map<string, number>();
  private nextCritter = 0;
  private ball: { x: number; y: number; vx: number; vy: number } | null = null;
  private unsub: () => void;
  private began = false;
  private listenerPos = v(0, 0, 0);

  constructor(sim: Sim, elevator: Elevator, camera: THREE.Camera) {
    this.sim = sim;
    this.elevator = elevator;
    this.camera = camera;
    this.unsub = audio.onReady(() => this.begin());
  }

  private begin() {
    if (this.began || !audio.ctx) return;
    this.began = true;
    this.music.start();
    this.hum = this.loop('hum', v(ELEVATOR.x, 1, ELEVATOR.z));
    this.wind = this.loop('wind');
    this.brew = this.loop('brew', v(0, 1, 0));
  }

  dispose() {
    this.unsub();
    this.music.stop();
    for (const l of [this.hum, this.wind, this.brew]) l?.stop();
    stopSpeech();
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, now: number, opts: { selectedId: string | null; bossMode: boolean; ball: THREE.Vector3 | null }) {
    if (!audio.running || !this.began) return;
    const cam = this.camera;
    const fwd = { x: 0, y: 0, z: -1 };
    const e = cam.matrixWorld.elements;
    fwd.x = -e[8];
    fwd.y = -e[9];
    fwd.z = -e[10];
    this.listenerPos = v(cam.position.x, cam.position.y, cam.position.z);
    audio.setListener(this.listenerPos, fwd, { x: e[4], y: e[5], z: e[6] });
    const ctx = audio.ctx!;
    const t = ctx.currentTime;

    // Elevator: hum while moving, doors sliding, a bell when it arrives.
    const ey = this.elevator.y;
    const speed = dt > 0 ? Math.abs(ey - this.lastElevY) / dt : 0;
    this.lastElevY = ey;
    const moving = speed > 0.3;
    if (this.hum) {
      this.place(this.hum.panner!, v(ELEVATOR.x, ey + 1.2, ELEVATOR.z));
      this.hum.gain.gain.setTargetAtTime(moving ? 0.16 : 0, t, 0.25);
    }
    if (this.elevMoving && !moving && Math.abs(ey) < 0.3) this.ding(v(ELEVATOR.x, 2.6, ELEVATOR.z));
    this.elevMoving = moving;
    const doors = this.elevator.doorAmount;
    const doorsMoving = Math.abs(doors - this.lastDoors) > 0.0005;
    if (doorsMoving && !this.doorsMoving && Math.abs(ey) < 1) this.slide(v(ELEVATOR.x, 1.2, ELEVATOR.z + 1.2));
    this.doorsMoving = doorsMoving;
    this.lastDoors = doors;

    // People: footsteps and typing, only near the listener.
    const typists: Array<{ c: Char; d: number }> = [];
    let brewing: Char | undefined;
    for (const c of this.sim.chars.values()) {
      if (c.mode === 'hidden') continue;
      const d = Math.hypot(c.x - this.listenerPos.x, c.y - this.listenerPos.y, c.z - this.listenerPos.z);
      const walking = c.mode === 'walking' || c.mode === 'stepping' || (c.mode === 'player' && (c.playerSpeed ?? 0) > 0.25 && !c.sitting);
      if (walking && d < 16) {
        const half = Math.floor(c.walkPhase / Math.PI);
        const last = this.steps.get(c.id);
        if (last !== undefined && half !== last) this.step(v(c.x, c.y + 0.05, c.z), c.id === BOSS_ID ? ((c.playerSpeed ?? 0) > 3.6 ? 1.5 : 1.1) : 0.55);
        this.steps.set(c.id, half);
      } else this.steps.delete(c.id);
      if (c.mode === 'acting' && c.act?.kind === 'work' && d < 13 && !c.hit) typists.push({ c, d });
      if (c.mode === 'acting' && c.act?.kind === 'brew' && !brewing) brewing = c;
    }
    typists.sort((a, b) => a.d - b.d);
    for (const { c } of typists.slice(0, 4)) {
      const next = this.typing.get(c.id) ?? 0;
      if (now < next) continue;
      this.key(v(c.x + Math.sin(c.heading) * 0.45, 0.8, c.z + Math.cos(c.heading) * 0.45));
      // Bursts of keys with thinking pauses in between.
      this.typing.set(c.id, now + (Math.random() < 0.08 ? 600 + Math.random() * 1400 : 55 + Math.random() * 110));
    }
    if (this.brew) {
      const spot = brewing?.act?.spot;
      if (spot) this.place(this.brew.panner!, v(spot.x, 1.1, spot.z));
      this.brew.gain.gain.setTargetAtTime(spot ? 0.12 : 0, t, 0.3);
    }

    // Ping-pong: a tock on every paddle hit and table bounce.
    if (opts.ball) {
      const b = opts.ball;
      if (this.ball) {
        const vx = b.x - this.ball.x;
        const vy = b.y - this.ball.y;
        if (Math.sign(vx) !== Math.sign(this.ball.vx) && this.ball.vx !== 0) this.tock(v(b.x, b.y, b.z), 1);
        if (vy > 0 && this.ball.vy < 0) this.tock(v(b.x, b.y, b.z), 0.6);
        this.ball = { x: b.x, y: b.y, vx, vy };
      } else this.ball = { x: b.x, y: b.y, vx: 0, vy: 0 };
    } else this.ball = null;

    // Outdoors: wind always, birds by day, crickets at night.
    if (this.wind) this.wind.gain.gain.setTargetAtTime(0.05 + 0.03 * Math.sin(now / 4000), t, 1);
    if (now > this.nextCritter) {
      const h = new Date(now).getHours();
      const night = h >= 21 || h < 6;
      const a = Math.random() * Math.PI * 2;
      const at = v(17.5 + Math.cos(a) * 24, 3 + Math.random() * 4, 13 + Math.sin(a) * 20);
      if (night) this.cricket(at);
      else if (h >= 6 && h < 20) this.bird(at);
      this.nextCritter = now + (night ? 900 + Math.random() * 2200 : 3500 + Math.random() * 8000);
    }
  }

  // ------------------------------------------------------------------ voices and events

  /** A character says something: read aloud nearby (local voices), babble further away. */
  chatter(c: Char, kind: string, text: string, selectedId: string | null) {
    // Nobody talks to an empty room: no voices while the office is in a background tab.
    if (!audio.running || kind === 'action' || kind === 'think' || document.hidden) return;
    const at = v(c.x, c.y + 1.6, c.z);
    const d = Math.hypot(at.x - this.listenerPos.x, at.y - this.listenerPos.y, at.z - this.listenerPos.z);
    const profile = voiceFor(c.id, c.id === BOSS_ID);
    const boss = this.sim.boss;
    const nearBoss = boss && boss.mode === 'player' && Math.hypot(boss.x - c.x, boss.z - c.z) < 4.5;
    const priority = c.id === selectedId || nearBoss ? 3 : d < 8 ? 2 : 1;
    if (priority >= 2 && speak(c.id, text, profile, Math.max(0.25, 1.3 - d / 14), priority)) return;
    if (d < 32) babble(text, profile, at, kind === 'idle' ? 0.6 : 1);
  }

  /** One-shot sounds from the simulation. */
  fx(name: SimSound, x: number, y: number, z: number, from?: Char) {
    if (!audio.running) return;
    const at = v(x, y, z);
    if (name === 'slap') this.slap(at);
    else if (name === 'kick') this.thump(at);
    else if (name === 'whoosh') this.whoosh(at);
    else if (name === 'ding') this.ding(at);
    else if (name === 'land') this.step(at, 1.9);
    else if (name === 'ouch' && from) ouch(voiceFor(from.id), at, from.hit?.kind ?? 'slap');
  }

  // ------------------------------------------------------------------ synthesis

  private place(p: PannerNode, at: Vec3) {
    const t = audio.ctx!.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(at.x, t, 0.05);
      p.positionY.setTargetAtTime(at.y, t, 0.05);
      p.positionZ.setTargetAtTime(at.z, t, 0.05);
    } else p.setPosition(at.x, at.y, at.z);
  }

  /** Continuous sounds whose volume is driven every frame. */
  private loop(kind: 'hum' | 'wind' | 'brew', at?: Vec3): Loop {
    const ctx = audio.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = at ? audio.panner(at, audio.effects, kind === 'hum' ? 3 : 2, 50) : undefined;
    gain.connect(panner ?? audio.effects);
    const nodes: Array<AudioScheduledSourceNode> = [];
    if (kind === 'hum') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 55;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      o.connect(lp).connect(gain);
      const n = audio.noiseSource(true);
      const lp2 = ctx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.value = 320;
      const ng = ctx.createGain();
      ng.gain.value = 0.5;
      n.connect(lp2).connect(ng).connect(gain);
      nodes.push(o, n);
    } else if (kind === 'wind') {
      const n = audio.noiseSource(true);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 160;
      lfo.connect(lfoGain).connect(lp.frequency);
      n.connect(lp).connect(gain);
      nodes.push(n, lfo);
    } else {
      // Coffee machine: a hiss with a gurgling wobble.
      const n = audio.noiseSource(true);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 750;
      bp.Q.value = 1.2;
      const wob = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 6.5;
      lfoGain.gain.value = 0.5;
      wob.gain.value = 0.6;
      lfo.connect(lfoGain).connect(wob.gain);
      n.connect(bp).connect(wob).connect(gain);
      nodes.push(n, lfo);
    }
    for (const n of nodes) n.start();
    return {
      gain,
      panner,
      stop: () => {
        for (const n of nodes)
          try {
            n.stop();
          } catch {
            // already stopped
          }
        gain.disconnect();
      },
    };
  }

  /** A short filtered noise burst at a point. */
  private burst(at: Vec3, opts: { type: BiquadFilterType; freq: number; q?: number; peak: number; decay: number; attack?: number; ref?: number; sweepTo?: number }) {
    const ctx = audio.ctx!;
    const t = ctx.currentTime + 0.005;
    const n = audio.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.decay);
    if (opts.q) f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.peak, t + (opts.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.attack ?? 0.003) + opts.decay);
    const out = audio.panner(at, audio.effects, opts.ref ?? 2);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 1.5);
    n.stop(t + opts.decay + 0.05);
    n.onended = () => out.disconnect();
  }

  private tone(at: Vec3, freq: number, peak: number, decay: number, type: OscillatorType = 'sine', glideTo?: number, delay = 0) {
    const ctx = audio.ctx!;
    const t = ctx.currentTime + 0.005 + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const out = audio.panner(at, audio.effects, 2.5);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
    o.onended = () => out.disconnect();
  }

  private step(at: Vec3, loud: number) {
    this.burst(at, { type: 'lowpass', freq: 700 + Math.random() * 300, peak: 0.16 * loud, decay: 0.07 });
    this.tone(at, 70 + Math.random() * 20, 0.08 * loud, 0.06);
  }

  private key(at: Vec3) {
    this.burst(at, { type: 'highpass', freq: 2600 + Math.random() * 1500, peak: 0.05, decay: 0.018, ref: 1.2 });
  }

  private tock(at: Vec3, loud: number) {
    this.tone(at, 1450 + Math.random() * 200, 0.12 * loud, 0.05, 'triangle');
    this.burst(at, { type: 'bandpass', freq: 2600, q: 3, peak: 0.05 * loud, decay: 0.03 });
  }

  /** Elevator bell: two soft, bright notes. */
  private ding(at: Vec3) {
    for (const [f, delay] of [
      [1318.5, 0],
      [1046.5, 0.32],
    ] as const) {
      this.tone(at, f, 0.12, 1.4, 'sine', undefined, delay);
      this.tone(at, f * 2.76, 0.025, 0.5, 'sine', undefined, delay);
    }
  }

  private slide(at: Vec3) {
    this.burst(at, { type: 'bandpass', freq: 500, q: 0.8, peak: 0.07, decay: 0.85, attack: 0.15, sweepTo: 900 });
  }

  private slap(at: Vec3) {
    this.burst(at, { type: 'highpass', freq: 1500, peak: 0.6, decay: 0.09, ref: 2.5 });
    this.burst(at, { type: 'bandpass', freq: 3200, q: 1.5, peak: 0.35, decay: 0.05, ref: 2.5 });
  }

  private thump(at: Vec3) {
    this.tone(at, 110, 0.55, 0.22, 'sine', 42);
    this.burst(at, { type: 'lowpass', freq: 900, peak: 0.3, decay: 0.12, ref: 2.5 });
  }

  private whoosh(at: Vec3) {
    this.burst(at, { type: 'bandpass', freq: 500, q: 1.4, peak: 0.12, decay: 0.24, attack: 0.08, sweepTo: 2400 });
  }

  /** A quick little bird song: two to four chirps. */
  private bird(at: Vec3) {
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1600;
    for (let i = 0; i < n; i++) this.tone(at, base * (1 + Math.random() * 0.3), 0.045, 0.09, 'sine', base * (1.35 + Math.random() * 0.3), i * 0.13);
  }

  private cricket(at: Vec3) {
    for (let i = 0; i < 3; i++) this.tone(at, 4500 + Math.random() * 300, 0.02, 0.05, 'sine', undefined, i * 0.07);
  }
}
