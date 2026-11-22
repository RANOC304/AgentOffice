// Audio engine: one Web Audio context with music, effects and voice buses, positional sound through
// the camera as the listener, and persisted settings. Every sound is synthesised in the browser:
// no audio files, nothing is downloaded. The context starts on the first click or key press, as
// browsers require.

export type VoiceMode = 'speech' | 'babble' | 'off';

export interface SoundSettings {
  enabled: boolean;
  master: number;
  music: number;
  effects: number;
  voices: number;
  /** speech: nearby characters read their lines aloud (local system voices), others babble. */
  voiceMode: VoiceMode;
}

const KEY = 'agentoffice.sound';
const DEFAULTS: SoundSettings = { enabled: true, master: 0.8, music: 0.4, effects: 0.75, voices: 0.85, voiceMode: 'speech' };

function load(): SoundSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  effects!: GainNode;
  voices!: GainNode;
  settings: SoundSettings = load();
  private noise: AudioBuffer | null = null;
  private listeners = new Set<() => void>();
  private started = false;

  constructor() {
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  /** Creates (or resumes) the audio context. Safe to call often. */
  start() {
    if (!this.settings.enabled) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'playback' });
        this.master = this.ctx.createGain();
        this.music = this.ctx.createGain();
        this.effects = this.ctx.createGain();
        this.voices = this.ctx.createGain();
        // A gentle limiter so many sounds at once never clip.
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.music.connect(this.master);
        this.effects.connect(this.master);
        this.voices.connect(this.master);
        this.master.connect(comp).connect(this.ctx.destination);
        this.apply();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.started && this.ctx.state === 'running') {
        this.started = true;
        for (const fn of this.listeners) fn();
      }
      if (!this.started)
        this.ctx.addEventListener(
          'statechange',
          () => {
            if (this.ctx?.state === 'running' && !this.started) {
              this.started = true;
              for (const fn of this.listeners) fn();
            }
          },
          { once: true },
        );
    } catch {
      this.ctx = null;
    }
  }

  /** Runs when audio is ready (now, if it already is). */
  onReady(fn: () => void): () => void {
    this.listeners.add(fn);
    if (this.started) fn();
    return () => this.listeners.delete(fn);
  }

  get running(): boolean {
    return Boolean(this.ctx && this.ctx.state === 'running' && this.settings.enabled);
  }

  update(patch: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // private mode
    }
    if (this.settings.enabled) this.start();
    this.apply();
    window.dispatchEvent(new Event('agentoffice-sound'));
  }

  private apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.enabled ? s.master : 0, t, 0.08);
    this.music.gain.setTargetAtTime(s.music * 0.55, t, 0.15);
    this.effects.gain.setTargetAtTime(s.effects, t, 0.08);
    this.voices.gain.setTargetAtTime(s.voiceMode === 'off' ? 0 : s.voices, t, 0.08);
  }

  /** Places the listener at the camera. */
  setListener(pos: Vec3, forward: Vec3, up: Vec3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.03);
      l.positionY.setTargetAtTime(pos.y, t, 0.03);
      l.positionZ.setTargetAtTime(pos.z, t, 0.03);
      l.forwardX.setTargetAtTime(forward.x, t, 0.03);
      l.forwardY.setTargetAtTime(forward.y, t, 0.03);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.03);
      l.upX.setTargetAtTime(up.x, t, 0.03);
      l.upY.setTargetAtTime(up.y, t, 0.03);
      l.upZ.setTargetAtTime(up.z, t, 0.03);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** A positional output at a point in the office. */
  panner(at: Vec3, bus: AudioNode, refDistance = 2.2, maxDistance = 60): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.maxDistance = maxDistance;
    p.rolloffFactor = 1.25;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else p.setPosition(at.x, at.y, at.z);
    p.connect(bus);
    return p;
  }

  /** Two seconds of white noise, shared by every noisy sound. */
  noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = loop;
    if (!loop) src.playbackRate.value = 0.9 + Math.random() * 0.2;
    return src;
  }
}

export const audio = new AudioEngine();

/** React-friendly settings access. */
export function subscribeSound(fn: () => void): () => void {
  window.addEventListener('agentoffice-sound', fn);
  return () => window.removeEventListener('agentoffice-sound', fn);
}
