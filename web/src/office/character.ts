// Procedural pixel characters. Each session gets a stable look derived from its id;
// shirt colour follows the provider (Claude, Codex, ChatGPT), subagents wear a cap and badge.

import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { AgentKind, Provider } from '../../../shared/types.ts';
import { ctx2d, hashString, makeCanvas, mix, rng, shade } from './iso.ts';

export const SPRITE_W = 16;
export const SPRITE_H = 26;
/** Feet position inside the sprite. */
export const FOOT_X = 8;
export const FOOT_Y = 25;

export type View = 'front' | 'back';
export type Pose = 'stand' | 'walk0' | 'walk1' | 'sit' | 'type0' | 'type1' | 'cheer';

export interface Look {
  key: string;
  skin: string;
  hair: string;
  hairStyle: number;
  shirt: string;
  pants: string;
  shoes: string;
  glasses: boolean;
  headset: boolean;
  cap: boolean;
  badge: string;
}

const SKINS = ['#f6d3b3', '#eebd94', '#d9a07a', '#b97d57', '#8d5a3b', '#f3c9a4'];
const HAIRS = ['#2d2420', '#5a3a26', '#8b5a2b', '#d9a441', '#e8d38a', '#b8452f', '#3b3f58', '#d7d7d7', '#6a4f8f', '#2f6f73'];
const PANTS = ['#3b4256', '#2f3a52', '#4f4a45', '#5c6b7f', '#3d5a4a', '#6b4f3b'];

export function lookFor(id: string, provider: Provider, kind: AgentKind): Look {
  const r = rng(hashString(id));
  const meta = PROVIDER_META[provider];
  const tint = r();
  const shirt = tint < 0.33 ? meta.color : tint < 0.66 ? mix(meta.color, '#ffffff', 0.18) : mix(meta.color, '#000000', 0.12);
  const look: Look = {
    key: '',
    skin: SKINS[Math.floor(r() * SKINS.length)],
    hair: HAIRS[Math.floor(r() * HAIRS.length)],
    hairStyle: Math.floor(r() * 7),
    shirt,
    pants: PANTS[Math.floor(r() * PANTS.length)],
    shoes: r() > 0.5 ? '#2a2a33' : '#f2f2f2',
    glasses: r() < 0.28,
    headset: kind === 'session' && r() < 0.18,
    cap: kind === 'subagent',
    badge: provider === 'claude' ? '#fff1e0' : provider === 'chatgpt' ? '#ffffff' : '#e4eaff',
  };
  look.key = [look.skin, look.hair, look.hairStyle, look.shirt, look.pants, look.shoes, look.glasses, look.headset, look.cap].join('|');
  return look;
}

const cache = new Map<string, HTMLCanvasElement>();

export function characterSprite(look: Look, view: View, pose: Pose): HTMLCanvasElement {
  const key = `${look.key}|${view}|${pose}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(SPRITE_W, SPRITE_H);
  const ctx = ctx2d(canvas);
  draw(ctx, look, view, pose);
  outline(ctx);
  cache.set(key, canvas);
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, look: Look, view: View, pose: Pose) {
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const sitting = pose === 'sit' || pose === 'type0' || pose === 'type1';
  const bob = pose === 'walk0' || pose === 'walk1' ? -1 : 0;
  const dy = (sitting ? 3 : 0) + bob;
  const skinShade = shade(look.skin, -0.12);
  const shirtShade = shade(look.shirt, -0.18);
  const front = view === 'front';

  // Legs and shoes.
  if (!sitting) {
    const lUp = pose === 'walk0' ? 1 : 0;
    const rUp = pose === 'walk1' ? 1 : 0;
    px(5, 19 + dy, 6, 2, look.pants);
    px(5, 21 + dy - lUp, 2, 3, look.pants);
    px(9, 21 + dy - rUp, 2, 3, look.pants);
    px(4, 24 + dy - lUp, 3, 1, look.shoes);
    px(9, 24 + dy - rUp, 3, 1, look.shoes);
  } else {
    px(4, 19 + dy, 8, 2, look.pants);
    if (front) {
      px(4, 21 + dy, 2, 1, look.pants);
      px(10, 21 + dy, 2, 1, look.pants);
    }
  }

  // Torso.
  px(4, 12 + dy, 8, 7, look.shirt);
  px(11, 12 + dy, 1, 7, shirtShade);
  if (front) {
    px(7, 11 + dy, 2, 1, skinShade);
    px(6, 12 + dy, 4, 1, shade(look.shirt, 0.15));
    if (look.cap) {
      px(7, 12 + dy, 1, 4, '#f2f2f2');
      px(7, 15 + dy, 2, 2, look.badge);
    } else px(9, 14 + dy, 2, 2, look.badge);
  }

  // Arms.
  const armL = pose === 'walk0' ? 1 : pose === 'walk1' ? -1 : 0;
  const armR = -armL;
  if (pose === 'type0' || pose === 'type1') {
    const t = pose === 'type0' ? 0 : 1;
    if (front) {
      px(3, 12 + dy, 1, 3, look.shirt);
      px(12, 12 + dy, 1, 3, shirtShade);
      px(4, 15 + dy - t, 2, 1, look.skin);
      px(10, 15 + dy - (1 - t), 2, 1, look.skin);
    } else {
      px(3, 12 + dy, 1, 3, look.shirt);
      px(12, 12 + dy, 1, 3, shirtShade);
      px(2, 14 + dy - t, 1, 2, look.skin);
      px(13, 14 + dy - (1 - t), 1, 2, look.skin);
    }
  } else if (pose === 'cheer') {
    px(3, 8 + dy, 1, 5, look.shirt);
    px(12, 8 + dy, 1, 5, shirtShade);
    px(3, 6 + dy, 1, 2, look.skin);
    px(12, 6 + dy, 1, 2, look.skin);
  } else {
    px(3, 12 + dy + armL, 1, 4, look.shirt);
    px(3, 16 + dy + armL, 1, 2, look.skin);
    px(12, 12 + dy + armR, 1, 4, shirtShade);
    px(12, 16 + dy + armR, 1, 2, skinShade);
  }

  // Head.
  px(4, 3 + dy, 8, 8, look.skin);
  px(11, 3 + dy, 1, 8, skinShade);
  if (front) {
    px(6, 7 + dy, 1, 2, '#2a2230');
    px(9, 7 + dy, 1, 2, '#2a2230');
    px(5, 9 + dy, 1, 1, '#f2a3a3');
    px(10, 9 + dy, 1, 1, '#f2a3a3');
    px(7, 9 + dy, 2, 1, shade(look.skin, -0.3));
    if (look.glasses) {
      px(5, 6 + dy, 3, 1, '#2a2230');
      px(8, 6 + dy, 3, 1, '#2a2230');
      px(5, 7 + dy, 1, 1, '#2a2230');
      px(10, 7 + dy, 1, 1, '#2a2230');
    }
  }

  // Hair.
  const hair = look.hair;
  const hairShade = shade(hair, -0.2);
  const s = look.hairStyle;
  if (front) {
    if (s === 4) px(4, 2 + dy, 8, 2, hair);
    else {
      px(4, 1 + dy, 8, 3, hair);
      px(4, 4 + dy, 1, 2, hair);
      px(11, 4 + dy, 1, 2, hairShade);
    }
    if (s === 1) {
      px(3, 3 + dy, 1, 9, hair);
      px(12, 3 + dy, 1, 9, hairShade);
    }
    if (s === 2) px(6, 0 + dy, 4, 1, hair);
    if (s === 3) {
      px(4, 0 + dy, 1, 1, hair);
      px(7, 0 + dy, 1, 1, hair);
      px(10, 0 + dy, 1, 1, hair);
    }
    if (s === 5) px(12, 4 + dy, 2, 6, hairShade);
    if (s === 6) {
      px(3, 0 + dy, 10, 4, hair);
      px(3, 4 + dy, 1, 4, hair);
      px(12, 4 + dy, 1, 4, hairShade);
    }
  } else {
    px(4, 1 + dy, 8, 9, hair);
    px(11, 1 + dy, 1, 9, hairShade);
    if (s === 4) px(4, 1 + dy, 8, 1, look.skin);
    if (s === 1) px(3, 3 + dy, 10, 10, hair);
    if (s === 2) px(6, 0 + dy, 4, 2, hairShade);
    if (s === 5) px(7, 8 + dy, 2, 6, hairShade);
    if (s === 6) px(3, 0 + dy, 10, 9, hair);
  }

  // Accessories.
  if (look.headset) {
    px(4, 0 + dy, 8, 1, '#2a2230');
    px(3, 5 + dy, 1, 3, '#2a2230');
    px(12, 5 + dy, 1, 3, '#2a2230');
    if (front) px(4, 8 + dy, 1, 2, '#2a2230');
  }
  if (look.cap) {
    const capColor = shade(look.shirt, -0.25);
    px(4, 0 + dy, 8, 3, capColor);
    px(6, 0 + dy, 4, 1, shade(capColor, 0.2));
    if (front) px(3, 3 + dy, 10, 1, shade(capColor, -0.2));
    else px(4, 3 + dy, 8, 1, shade(capColor, -0.2));
  }
}

/** Adds a soft 1px dark outline around the opaque pixels, for readability on any floor. */
function outline(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const src = new Uint8ClampedArray(img.data);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : src[(y * width + x) * 4 + 3]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) > 0) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        const i = (y * width + x) * 4;
        img.data[i] = 34;
        img.data[i + 1] = 28;
        img.data[i + 2] = 48;
        img.data[i + 3] = 150;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Front-facing portrait for the dashboard. */
export function drawAvatar(canvas: HTMLCanvasElement, look: Look, scale: number) {
  canvas.width = SPRITE_W * scale;
  canvas.height = 15 * scale;
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sprite = characterSprite(look, 'front', 'stand');
  ctx.drawImage(sprite, 0, 0, SPRITE_W, 15, 0, 0, SPRITE_W * scale, 15 * scale);
}
