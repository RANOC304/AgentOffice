// Stable appearance per agent: every character is a man; clothes follow the provider colour.

import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { AgentKind, Provider } from '../../../shared/types.ts';

export type HairStyle = 'short' | 'side' | 'buzz' | 'curly' | 'bald' | 'quiff' | 'long' | 'bun';
export type Beard = 'none' | 'stubble' | 'full' | 'goatee' | 'mustache';
export type Top = 'tee' | 'shirt' | 'hoodie' | 'sweater';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  beard: Beard;
  top: Top;
  shirt: string;
  pants: string;
  shoes: string;
  glasses: boolean;
  cap: boolean;
  badge: boolean;
  height: number;
  build: number;
  /** Tie colour (the boss's suit). */
  tie?: string;
}

const SKINS = ['#f2cfb3', '#e8b994', '#d9a27c', '#bf8460', '#9a6243', '#73452d', '#f5d6bf'];
const HAIRS = ['#1f1914', '#3b2a1e', '#5a3d27', '#7a5232', '#a77845', '#c9a46a', '#8f3f25', '#6b6b6b', '#2b2b30'];
const PANTS = ['#2f3d56', '#3b4a68', '#2a2c31', '#5b5245', '#4a5a4a', '#6d6658', '#1f2a3d'];
const SHOES = ['#f2f0ea', '#2a2a2e', '#6b4a32', '#3c4a5c'];
const STYLES: HairStyle[] = ['short', 'side', 'buzz', 'curly', 'bald', 'quiff', 'long', 'bun', 'short', 'side', 'quiff'];
const BEARDS: Beard[] = ['none', 'none', 'stubble', 'full', 'goatee', 'mustache', 'stubble', 'none'];
const TOPS: Top[] = ['tee', 'shirt', 'hoodie', 'sweater'];

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function tint(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** You: dark suit, white collar, red tie, a little taller than everyone. */
export const BOSS_LOOK: Look = {
  skin: '#e8b994',
  hair: '#2b2b30',
  hairStyle: 'side',
  beard: 'stubble',
  top: 'shirt',
  shirt: '#1e2638',
  pants: '#1a2030',
  shoes: '#1c1c20',
  glasses: false,
  cap: false,
  badge: false,
  height: 1.06,
  build: 1.08,
  tie: '#c0392b',
};

export function lookFor(id: string, provider: Provider, kind: AgentKind): Look {
  const r = rng(hash(id));
  const cloth = PROVIDER_META[provider].cloth;
  const shade = [-0.22, -0.1, 0, 0.12][Math.floor(r() * 4)];
  return {
    skin: SKINS[Math.floor(r() * SKINS.length)],
    hair: HAIRS[Math.floor(r() * HAIRS.length)],
    hairStyle: STYLES[Math.floor(r() * STYLES.length)],
    beard: BEARDS[Math.floor(r() * BEARDS.length)],
    top: TOPS[Math.floor(r() * TOPS.length)],
    shirt: tint(cloth, shade),
    pants: PANTS[Math.floor(r() * PANTS.length)],
    shoes: SHOES[Math.floor(r() * SHOES.length)],
    glasses: r() < 0.3,
    cap: kind === 'subagent',
    badge: kind === 'subagent',
    height: 0.95 + r() * 0.11,
    build: 0.96 + r() * 0.16,
  };
}
