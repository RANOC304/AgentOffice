// Character voices. Every character has his own voice: a pitch, a pace and a timbre picked from his
// id. Nearby speakers read their lines aloud with the computer's own (local) text-to-speech voices;
// everyone else "babbles" a few vowel-like syllables, positioned where he stands. Online voices are
// never used, so the text never leaves the computer.

import { audio, type Vec3 } from './engine.ts';

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface VoiceProfile {
  /** Babble fundamental (Hz): a male range. */
  f0: number;
  /** Speech pitch and rate for text-to-speech. */
  pitch: number;
  rate: number;
  /** Index into the available local male voices. */
  pick: number;
  /** Vowel formant shift (bigger or smaller head). */
  formant: number;
}

export function voiceFor(id: string, boss = false): VoiceProfile {
  const h = hash(id);
  if (boss) return { f0: 92, pitch: 0.82, rate: 0.98, pick: 0, formant: 0.92 };
  return {
    f0: 88 + (h % 70),
    pitch: 0.72 + ((h >> 3) % 40) / 100,
    rate: 0.95 + ((h >> 7) % 25) / 100,
    pick: (h >> 11) % 7,
    formant: 0.9 + ((h >> 13) % 25) / 100,
  };
}

// Vowel formants (F1, F2) for a male voice.
const VOWELS: Array<[number, number]> = [
  [730, 1090],
  [530, 1840],
  [390, 1990],
  [570, 840],
  [440, 1020],
  [660, 1720],
  [300, 870],
];

const MALE = /david|mark|george|guy|james|richard|ryan|daniel|alex|fred|paul|thomas|sean|liam|eric|aaron|arthur|oliver|william|brian|christopher|andrew|roger|tony|matthew|henri|claude|stefan|ravi|hemant/i;
const FEMALE = /zira|hazel|susan|linda|heather|catherine|eva|jenny|aria|sonia|libby|natasha|clara|emma|amy|samantha|victoria|karen|moira|tessa|fiona|julie|hortense|elsa|helena|sabina|heera|kalpana|zira/i;

let maleVoices: SpeechSynthesisVoice[] = [];
let lowVoices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  // Only voices that run on this computer: online voices would send the text to a service.
  const local = speechSynthesis.getVoices().filter((v) => v.localService);
  const en = local.filter((v) => /^en/i.test(v.lang));
  const pool = en.length ? en : local;
  maleVoices = pool.filter((v) => MALE.test(v.name) && !FEMALE.test(v.name));
  lowVoices = maleVoices.length ? [] : pool;
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

/** Can lines be read aloud with a local voice? */
export function speechAvailable(): boolean {
  return maleVoices.length + lowVoices.length > 0;
}

let speaking: { id: string; priority: number; until: number } | null = null;

/** Strips what a voice should not read: emojis, links, code marks. */
function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[`*_#>|[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reads a line aloud with a local voice. Higher priority lines (someone talking to the boss, the
 * selected worker) interrupt lower ones; otherwise a busy voice is left alone.
 */
export function speak(id: string, text: string, profile: VoiceProfile, volume: number, priority: number): boolean {
  if (!speechAvailable() || audio.settings.voiceMode !== 'speech' || !audio.settings.enabled) return false;
  const clean = speakable(text);
  if (!clean) return false;
  const now = performance.now();
  const busy = speaking && speaking.until > now && speechSynthesis.speaking;
  if (busy && speaking!.priority >= priority) return false;
  if (busy) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean.slice(0, 220));
  const list = maleVoices.length ? maleVoices : lowVoices;
  u.voice = list[profile.pick % list.length];
  // Without a male voice, a lower pitch keeps everyone sounding like a man.
  u.pitch = maleVoices.length ? profile.pitch : Math.min(0.7, profile.pitch * 0.75);
  u.rate = profile.rate;
  u.volume = Math.max(0, Math.min(1, volume * audio.settings.voices * audio.settings.master));
  speaking = { id, priority, until: now + 900 + clean.length * 75 };
  u.onend = () => {
    if (speaking?.id === id) speaking = null;
  };
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeech() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  speaking = null;
}

/**
 * Sims-style gibberish: one buzzing source shaped by two moving vowel formants, a syllable per few
 * letters, with a little intonation (questions go up at the end).
 */
export function babble(text: string, profile: VoiceProfile, at: Vec3, loud = 1) {
  const ctx = audio.ctx;
  if (!ctx || audio.settings.voiceMode === 'off') return;
  const clean = speakable(text);
  const syllables = Math.max(2, Math.min(12, Math.round(clean.length / 5)));
  const t0 = ctx.currentTime + 0.02;
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f2.type = 'bandpass';
  f1.Q.value = 6;
  f2.Q.value = 9;
  const g1 = ctx.createGain();
  const g2 = ctx.createGain();
  g1.gain.value = 1;
  g2.gain.value = 0.55;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const out = audio.panner(at, audio.voices, 1.6, 40);
  src.connect(f1).connect(g1).connect(amp);
  src.connect(f2).connect(g2).connect(amp);
  amp.connect(out);
  const question = /\?\s*$/.test(clean);
  const exclaim = /!\s*$/.test(clean);
  let t = t0;
  for (let i = 0; i < syllables; i++) {
    const len = 0.075 + Math.random() * 0.06;
    const [a, b] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
    const last = i === syllables - 1;
    const pitch = profile.f0 * (1 + (Math.random() - 0.5) * 0.18 + (last && question ? 0.35 : 0) + (exclaim && i === 0 ? 0.2 : 0) - (last && !question ? 0.12 : 0));
    src.frequency.setTargetAtTime(pitch, t, 0.02);
    f1.frequency.setTargetAtTime(a * profile.formant, t, 0.015);
    f2.frequency.setTargetAtTime(b * profile.formant, t, 0.015);
    amp.gain.setTargetAtTime(0.32 * loud, t, 0.012);
    amp.gain.setTargetAtTime(0.0001, t + len, 0.02);
    t += len + 0.03 + Math.random() * 0.04;
    if (Math.random() < 0.12) t += 0.08;
  }
  src.start(t0);
  src.stop(t + 0.2);
  src.onended = () => out.disconnect();
}

/** A short exclamation ("ow!", "oof!") after a slap or a kick. */
export function ouch(profile: VoiceProfile, at: Vec3, kind: 'slap' | 'kick') {
  const ctx = audio.ctx;
  if (!ctx || audio.settings.voiceMode === 'off') return;
  const t = ctx.currentTime + 0.05;
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 5;
  const amp = ctx.createGain();
  const out = audio.panner(at, audio.voices, 1.6, 40);
  src.connect(f1).connect(amp).connect(out);
  const f0 = profile.f0 * (kind === 'slap' ? 1.6 : 1.25);
  src.frequency.setValueAtTime(f0, t);
  src.frequency.exponentialRampToValueAtTime(f0 * (kind === 'slap' ? 0.62 : 0.55), t + 0.32);
  f1.frequency.setValueAtTime(700 * profile.formant, t);
  f1.frequency.linearRampToValueAtTime(380 * profile.formant, t + 0.3);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  src.start(t);
  src.stop(t + 0.42);
  src.onended = () => out.disconnect();
}
