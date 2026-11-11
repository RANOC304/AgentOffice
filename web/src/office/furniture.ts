// Procedural pixel-art furniture. Every sprite is drawn once into a small canvas and cached.

import { ROOM_BY_ID } from '../../../shared/rooms.ts';
import { box, ctx2d, dot, faceY, makeCanvas, type Painter, quad, rng, shade } from './iso.ts';
import type { Item } from './map.ts';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Offset from the sprite's top-left corner to the tile's top vertex. */
  ax: number;
  ay: number;
}

const cache = new Map<string, Sprite>();

const WOOD = '#c99a6b';
const WOOD_DARK = '#9c7048';
const DESK = '#f4efe6';
const METAL = '#8a93a6';
const DARK = '#2b3140';
const SCREEN = '#1c2333';
const LEAF = ['#5aa65a', '#6fbf5e', '#4c8f4f', '#7fcf68'];
const POT = '#d0794f';
const BOOKS = ['#e06d5b', '#f2b84b', '#5b9bd5', '#7bc47f', '#a77fd1', '#f08cae', '#53b8b0'];

function roomColors(item: Item) {
  const def = item.room ? ROOM_BY_ID[item.room] : undefined;
  return { wall: def?.wall ?? '#8fae86', accent: def?.accent ?? '#5e8455', floor: def?.floor ?? '#e9efe6' };
}

function sprite(key: string, height: number, draw: (p: Painter) => void, width = 40): Sprite {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(width, height + 18);
  const ctx = ctx2d(canvas);
  const ax = Math.floor(width / 2);
  const ay = height;
  draw({ ctx, ox: ax, oy: ay });
  const made = { canvas, ax, ay };
  cache.set(key, made);
  return made;
}

function leaves(p: Painter, x: number, y: number, z: number, w: number, d: number, h: number, seed: number) {
  const r = rng(seed);
  box(p, x, y, z, w, d, h, LEAF[Math.floor(r() * LEAF.length)]);
  for (let i = 0; i < 6; i++) dot(p, x + r() * w, y + r() * d, z + h - r() * h, shade(LEAF[3], 0.25));
}

function screenContent(p: Painter, x: number, y: number, z: number, w: number, h: number, accent: string, seed: number) {
  const r = rng(seed);
  faceY(p, x, y, z, w, h, SCREEN);
  const rows = Math.floor((h - 2) / 2);
  for (let i = 0; i < rows; i++) {
    const len = 0.15 + r() * (w - 0.25);
    const indent = Math.floor(r() * 3) * 0.05;
    const color = [accent, shade(accent, 0.4), '#8fd18f', '#f2c96b'][Math.floor(r() * 4)];
    faceY(p, x + 0.04 + indent, y - 0.001, z + h - 2 - i * 2, Math.min(len, w - 0.08 - indent), 1, color);
  }
}

export function furnitureSprite(item: Item): Sprite {
  const { wall, accent } = roomColors(item);
  const variant = item.seed % 4;
  const key = `${item.type}:${item.room}:${item.screenFront ? 1 : 0}:${item.facing ?? 0}:${variant}`;
  switch (item.type) {
    case 'desk':
      return sprite(key, 34, (p) => {
        for (const [lx, ly] of [
          [0.1, 0.16],
          [0.84, 0.16],
          [0.1, 0.8],
          [0.84, 0.8],
        ])
          box(p, lx, ly, 0, 0.06, 0.06, 12, METAL);
        box(p, 0.06, 0.12, 12, 0.88, 0.78, 2, { top: DESK, left: '#d9d2c4', right: '#c4bcae' });
        if (item.screenFront) {
          box(p, 0.46, 0.3, 14, 0.08, 0.06, 2, DARK);
          box(p, 0.2, 0.24, 16, 0.6, 0.08, 12, { top: '#3a4256', left: '#3a4256', right: '#2a3042' });
          screenContent(p, 0.23, 0.321, 17, 0.54, 10, accent, item.seed);
          quad(p, 0.28, 0.55, 14, 0.44, 0.16, '#d6d9e0');
          if (variant === 1) box(p, 0.78, 0.6, 14, 0.1, 0.1, 4, '#e86f5a');
          if (variant === 2) quad(p, 0.1, 0.5, 14, 0.18, 0.26, '#ffffff');
        } else {
          box(p, 0.46, 0.6, 14, 0.08, 0.06, 2, DARK);
          box(p, 0.2, 0.58, 16, 0.6, 0.08, 12, { top: '#3a4256', left: '#596178', right: '#2a3042' });
          dot(p, 0.5, 0.66, 23, shade(accent, 0.3), 2, 2);
          quad(p, 0.28, 0.2, 14, 0.44, 0.16, '#d6d9e0');
          if (variant === 1) box(p, 0.8, 0.22, 14, 0.1, 0.1, 4, '#5b9bd5');
        }
      });
    case 'chair':
      return sprite(key, 26, (p) => {
        quad(p, 0.3, 0.3, 0, 0.4, 0.4, '#5d6475');
        box(p, 0.46, 0.46, 0, 0.08, 0.08, 7, DARK);
        box(p, 0.24, 0.24, 7, 0.52, 0.52, 3, accent);
        if (item.facing === 1) box(p, 0.24, 0.16, 10, 0.52, 0.1, 10, shade(accent, -0.1));
        else box(p, 0.24, 0.74, 10, 0.52, 0.1, 7, shade(accent, -0.1));
      });
    case 'stool':
      return sprite(key, 20, (p) => {
        box(p, 0.44, 0.44, 0, 0.12, 0.12, 9, DARK);
        quad(p, 0.32, 0.32, 0, 0.36, 0.36, '#5d6475');
        box(p, 0.28, 0.28, 9, 0.44, 0.44, 3, accent);
      });
    case 'sofa':
      return sprite(key, 24, (p) => {
        const c = shade(accent, 0.25);
        box(p, 0.04, 0.08, 0, 0.92, 0.86, 7, c);
        if (item.facing === 1) box(p, 0.04, 0.04, 7, 0.92, 0.2, 10, shade(c, -0.08));
        else box(p, 0.04, 0.76, 7, 0.92, 0.2, 8, shade(c, -0.08));
        box(p, 0.04, 0.08, 7, 0.14, 0.86, 4, shade(c, -0.12));
        box(p, 0.82, 0.08, 7, 0.14, 0.86, 4, shade(c, -0.12));
      });
    case 'plant':
      return sprite(key, 34, (p) => {
        box(p, 0.3, 0.3, 0, 0.4, 0.4, 8, { top: '#5a3d2b', left: POT, right: shade(POT, -0.2) });
        leaves(p, 0.18, 0.18, 8, 0.64, 0.64, 9, item.seed);
        leaves(p, 0.27, 0.27, 17, 0.46, 0.46, 7, item.seed + 1);
        leaves(p, 0.38, 0.38, 24, 0.24, 0.24, 5, item.seed + 2);
      });
    case 'smallPlant':
      return sprite(key, 20, (p) => {
        box(p, 0.34, 0.34, 0, 0.32, 0.32, 6, { top: '#5a3d2b', left: POT, right: shade(POT, -0.2) });
        leaves(p, 0.26, 0.26, 6, 0.48, 0.48, 7, item.seed);
      });
    case 'shelf':
      return sprite(key, 40, (p) => {
        box(p, 0.08, 0.3, 0, 0.84, 0.42, 32, { top: WOOD, left: WOOD_DARK, right: shade(WOOD_DARK, -0.15) });
        const r = rng(item.seed);
        for (const z of [3, 13, 23]) {
          faceY(p, 0.12, 0.721, z, 0.76, 8, '#5b3f2b');
          let x = 0.13;
          while (x < 0.84) {
            const w = 0.05 + r() * 0.05;
            const h = 5 + Math.floor(r() * 3);
            faceY(p, x, 0.722, z, Math.min(w, 0.86 - x), h, BOOKS[Math.floor(r() * BOOKS.length)]);
            x += w + 0.01;
          }
        }
      });
    case 'rack':
      return sprite(key, 40, (p) => {
        box(p, 0.16, 0.24, 0, 0.68, 0.52, 32, { top: '#3a4152', left: DARK, right: '#222733' });
        const r = rng(item.seed);
        for (let z = 3; z < 30; z += 4) {
          faceY(p, 0.2, 0.761, z, 0.6, 2, '#3c4456');
          dot(p, 0.24 + r() * 0.1, 0.77, z + 2, r() > 0.3 ? '#4ef08a' : '#4ec8f0');
          dot(p, 0.4 + r() * 0.1, 0.77, z + 2, r() > 0.5 ? '#f0c04e' : '#4ef08a');
        }
      });
    case 'whiteboard':
      return sprite(key, 36, (p) => {
        box(p, 0.14, 0.5, 0, 0.05, 0.05, 12, METAL);
        box(p, 0.8, 0.5, 0, 0.05, 0.05, 12, METAL);
        box(p, 0.08, 0.46, 10, 0.84, 0.08, 20, { top: '#c7ccd6', left: '#ffffff', right: '#b9c0cc' });
        const r = rng(item.seed);
        for (let i = 0; i < 4; i++) faceY(p, 0.14 + r() * 0.3, 0.541, 14 + i * 4, 0.1 + r() * 0.35, 1, [accent, '#e06d5b', '#5b9bd5'][i % 3]);
        for (let i = 0; i < 5; i++) faceY(p, 0.62 + i * 0.05, 0.541, 13, 0.03, 3 + Math.floor(r() * 10), shade(accent, 0.1));
      });
    case 'screen':
      return sprite(key, 36, (p) => {
        box(p, 0.4, 0.42, 0, 0.2, 0.16, 8, DARK);
        box(p, 0.06, 0.44, 8, 0.88, 0.08, 22, { top: '#3a4256', left: '#3a4256', right: '#2a3042' });
        if (item.room === 'browser') {
          faceY(p, 0.09, 0.521, 10, 0.82, 18, '#eef3f7');
          faceY(p, 0.09, 0.522, 25, 0.82, 3, '#2bb5a0');
          faceY(p, 0.13, 0.523, 18, 0.3, 5, '#9fd8cf');
          faceY(p, 0.5, 0.523, 13, 0.36, 10, '#d0e7ff');
          faceY(p, 0.13, 0.523, 12, 0.3, 4, '#f2b84b');
        } else screenContent(p, 0.09, 0.521, 10, 0.82, 18, accent, item.seed);
      });
    case 'globe':
      return sprite(key, 40, (p) => {
        box(p, 0.22, 0.22, 0, 0.56, 0.56, 6, { top: '#1f6f66', left: '#16514a', right: '#0f3e39' });
        box(p, 0.3, 0.3, 6, 0.4, 0.4, 2, '#2bb5a0');
      });
    case 'safe':
      return sprite(key, 26, (p) => {
        box(p, 0.16, 0.22, 0, 0.68, 0.56, 18, { top: '#9aa3b5', left: '#7c869a', right: '#5f687c' });
        faceY(p, 0.22, 0.781, 3, 0.56, 12, '#6e788c');
        dot(p, 0.5, 0.79, 11, '#f2c96b', 2, 2);
      });
    case 'arcade':
      return sprite(key, 40, (p) => {
        const body = variant % 2 ? '#7656b8' : '#c4527a';
        box(p, 0.16, 0.26, 0, 0.68, 0.5, 32, { top: shade(body, 0.2), left: body, right: shade(body, -0.25) });
        faceY(p, 0.22, 0.761, 17, 0.56, 9, '#101522');
        faceY(p, 0.26, 0.762, 19, 0.2, 3, '#4ef08a');
        faceY(p, 0.5, 0.762, 21, 0.2, 3, '#f0c04e');
        box(p, 0.18, 0.7, 12, 0.64, 0.14, 2, '#1c1c28');
        dot(p, 0.35, 0.78, 14, '#e05555', 2, 1);
        dot(p, 0.6, 0.78, 14, '#5b9bd5', 2, 1);
        faceY(p, 0.22, 0.761, 28, 0.56, 3, '#f2b84b');
      });
    case 'easel':
      return sprite(key, 36, (p) => {
        box(p, 0.2, 0.55, 0, 0.05, 0.05, 26, WOOD_DARK);
        box(p, 0.75, 0.55, 0, 0.05, 0.05, 26, WOOD_DARK);
        box(p, 0.47, 0.3, 0, 0.05, 0.05, 24, WOOD_DARK);
        box(p, 0.14, 0.5, 9, 0.72, 0.06, 18, { top: '#e8e2d4', left: '#fbf8f0', right: '#d9d2c4' });
        const r = rng(item.seed);
        const colors = ['#e06d5b', '#f2b84b', '#5b9bd5', '#7bc47f', '#d77fb8'];
        for (let i = 0; i < 6; i++) faceY(p, 0.2 + r() * 0.5, 0.561, 11 + r() * 13, 0.06 + r() * 0.12, 2 + Math.floor(r() * 3), colors[i % colors.length]);
      });
    case 'printer':
      return sprite(key, 32, (p) => {
        box(p, 0.14, 0.14, 0, 0.72, 0.72, 4, { top: '#3a4256', left: DARK, right: '#222733' });
        for (const [px, py] of [
          [0.16, 0.16],
          [0.78, 0.16],
          [0.16, 0.78],
          [0.78, 0.78],
        ])
          box(p, px, py, 4, 0.06, 0.06, 18, METAL);
        box(p, 0.14, 0.14, 22, 0.72, 0.72, 2, { top: '#f0a446', left: '#c87a17', right: '#a8650f' });
        box(p, 0.4, 0.4, 4, 0.2, 0.2, 6, '#f0a446');
        box(p, 0.44, 0.44, 12, 0.12, 0.12, 6, METAL);
      });
    case 'pedestal':
      return sprite(key, 30, (p) => {
        box(p, 0.28, 0.28, 0, 0.44, 0.44, 12, { top: '#ffffff', left: '#e6e1d8', right: '#cfc8bb' });
        box(p, 0.36, 0.36, 12, 0.28, 0.28, 9, { top: shade(accent, 0.3), left: accent, right: shade(accent, -0.25) });
      });
    case 'camera':
      return sprite(key, 34, (p) => {
        box(p, 0.48, 0.48, 0, 0.05, 0.05, 20, DARK);
        box(p, 0.25, 0.5, 0, 0.04, 0.04, 14, DARK);
        box(p, 0.7, 0.5, 0, 0.04, 0.04, 14, DARK);
        box(p, 0.32, 0.36, 20, 0.36, 0.26, 7, { top: '#3a4256', left: '#232838', right: '#1b1f2c' });
        box(p, 0.42, 0.62, 21, 0.16, 0.14, 5, '#596178');
        dot(p, 0.6, 0.4, 28, '#e05555', 1, 1);
      });
    case 'light':
      return sprite(key, 38, (p) => {
        box(p, 0.47, 0.47, 0, 0.06, 0.06, 26, DARK);
        quad(p, 0.3, 0.3, 0, 0.4, 0.4, '#5d6475');
        box(p, 0.28, 0.4, 24, 0.44, 0.16, 10, { top: '#d9dde6', left: '#fffbe0', right: '#b9c0cc' });
      });
    case 'table':
      return sprite(key, 18, (p) => {
        box(p, 0.46, 0.46, 0, 0.08, 0.08, 7, WOOD_DARK);
        box(p, 0.2, 0.2, 7, 0.6, 0.6, 2, { top: WOOD, left: WOOD_DARK, right: shade(WOOD_DARK, -0.15) });
        if (variant !== 3) box(p, 0.42 + (variant - 1) * 0.08, 0.38, 9, 0.1, 0.1, 3, '#ffffff');
      });
    case 'counter':
      return sprite(key, 30, (p) => {
        box(p, 0.04, 0.12, 0, 0.92, 0.76, 14, { top: '#e9e2d6', left: WOOD, right: WOOD_DARK });
        if (variant % 2 === 0) {
          box(p, 0.28, 0.24, 14, 0.44, 0.36, 11, { top: '#3a4256', left: '#c4473b', right: '#9c3329' });
          dot(p, 0.5, 0.6, 20, '#f2c96b', 2, 1);
        } else {
          box(p, 0.3, 0.3, 14, 0.1, 0.1, 3, '#ffffff');
          box(p, 0.5, 0.36, 14, 0.1, 0.1, 3, '#ffffff');
          box(p, 0.62, 0.22, 14, 0.18, 0.18, 2, '#f2b84b');
        }
      });
    case 'vending':
      return sprite(key, 38, (p) => {
        box(p, 0.12, 0.24, 0, 0.76, 0.52, 30, { top: '#5b9bd5', left: '#3f7fbd', right: '#2f6399' });
        faceY(p, 0.16, 0.761, 8, 0.46, 19, '#cfe9f2');
        const r = rng(item.seed);
        for (let z = 10; z < 26; z += 4) for (let x = 0.19; x < 0.58; x += 0.1) faceY(p, x, 0.762, z, 0.06, 2, BOOKS[Math.floor(r() * BOOKS.length)]);
        faceY(p, 0.66, 0.762, 16, 0.16, 6, '#1c2333');
      });
    case 'cooler':
      return sprite(key, 32, (p) => {
        box(p, 0.3, 0.3, 0, 0.4, 0.4, 14, { top: '#e6e9ef', left: '#ffffff', right: '#cfd5df' });
        box(p, 0.34, 0.34, 14, 0.32, 0.32, 10, { top: '#a9d8f5', left: '#7cc3ef', right: '#5aa9db' });
      });
    case 'reception':
      return sprite(key, 28, (p) => {
        box(p, 0.02, 0.28, 0, 0.96, 0.6, 14, { top: '#f4efe6', left: wall, right: shade(wall, -0.2) });
        faceY(p, 0.06, 0.881, 9, 0.88, 2, '#ffffff');
        if (variant % 2 === 0) box(p, 0.6, 0.38, 14, 0.12, 0.12, 6, '#7bc47f');
      });
    case 'tree':
      return sprite(
        key,
        60,
        (p) => {
          box(p, 0.42, 0.42, 0, 0.16, 0.16, 16, { top: '#7a5235', left: '#8a5d3b', right: '#6a4529' });
          leaves(p, 0.05, 0.05, 14, 0.9, 0.9, 14, item.seed);
          leaves(p, 0.15, 0.15, 28, 0.7, 0.7, 12, item.seed + 3);
          leaves(p, 0.3, 0.3, 40, 0.4, 0.4, 8, item.seed + 5);
        },
        48,
      );
    case 'pine':
      return sprite(
        key,
        64,
        (p) => {
          box(p, 0.43, 0.43, 0, 0.14, 0.14, 12, { top: '#7a5235', left: '#8a5d3b', right: '#6a4529' });
          const g = ['#3f7d4f', '#4a8f58', '#57a064'];
          box(p, 0.08, 0.08, 10, 0.84, 0.84, 12, g[0]);
          box(p, 0.18, 0.18, 22, 0.64, 0.64, 12, g[1]);
          box(p, 0.3, 0.3, 34, 0.4, 0.4, 11, g[2]);
          box(p, 0.42, 0.42, 45, 0.16, 0.16, 8, g[2]);
        },
        48,
      );
    case 'bush':
      return sprite(key, 22, (p) => {
        leaves(p, 0.1, 0.15, 0, 0.8, 0.7, 9, item.seed);
        leaves(p, 0.25, 0.25, 9, 0.5, 0.5, 5, item.seed + 1);
        dot(p, 0.4, 0.5, 12, '#f08cae', 2, 1);
      });
    default:
      return sprite(key, 10, (p) => box(p, 0.3, 0.3, 0, 0.4, 0.4, 8, '#999'));
  }
}

/** Height in pixels of an item, used for occlusion decisions. */
export function itemHeight(item: Item): number {
  switch (item.type) {
    case 'shelf':
    case 'rack':
    case 'arcade':
    case 'vending':
      return 32;
    case 'tree':
    case 'pine':
      return 60;
    default:
      return 20;
  }
}

