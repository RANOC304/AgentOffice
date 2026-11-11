// Isometric math and crisp pixel drawing primitives (2:1 tiles, scanline fills, no anti-aliasing).

export const HW = 16; // half tile width in pixels
export const HH = 8; // half tile height in pixels

export interface Pt {
  x: number;
  y: number;
}

/** Tile coordinates (x right-down, y left-down, z up in pixels) → world pixel coordinates. */
export function iso(x: number, y: number, z = 0): Pt {
  return { x: (x - y) * HW, y: (x + y) * HH - z };
}

/** World pixel coordinates (at floor level) → tile coordinates. */
export function tileAt(px: number, py: number): Pt {
  return { x: (py / HH + px / HW) / 2, y: (py / HH - px / HW) / 2 };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Fills a polygon with whole pixels using a scanline pass, so edges stay crisp. */
export function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[], color: string) {
  ctx.fillStyle = color;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const xs: number[] = [];
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.round(xs[k]);
      const xb = Math.round(xs[k + 1]);
      if (xb > xa) ctx.fillRect(xa, y, xb - xa, 1);
    }
  }
}

// ---------- colour helpers ----------

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** amount < 0 darkens, > 0 lightens (−1..1). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parse(hex);
  if (amount >= 0) return `#${toHex(r + (255 - r) * amount)}${toHex(g + (255 - g) * amount)}${toHex(b + (255 - b) * amount)}`;
  const f = 1 + amount;
  return `#${toHex(r * f)}${toHex(g * f)}${toHex(b * f)}`;
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------- isometric shapes relative to a tile origin (ox, oy) = tile's top vertex ----------

export interface Painter {
  ctx: CanvasRenderingContext2D;
  ox: number;
  oy: number;
}

const P = (p: Painter, x: number, y: number, z: number): Pt => {
  const s = iso(x, y, z);
  return { x: p.ox + s.x, y: p.oy + s.y };
};

/** Flat parallelogram on the plane z. */
export function quad(p: Painter, x: number, y: number, z: number, w: number, d: number, color: string) {
  fillPoly(p.ctx, [P(p, x, y, z), P(p, x + w, y, z), P(p, x + w, y + d, z), P(p, x, y + d, z)], color);
}

export interface BoxColors {
  top: string;
  left?: string; // face toward +y (lower-left on screen)
  right?: string; // face toward +x (lower-right on screen)
}

/** Box with its back-top corner at (x, y), base at z, footprint w × d tiles, h pixels tall. */
export function box(p: Painter, x: number, y: number, z: number, w: number, d: number, h: number, colors: BoxColors | string) {
  const c = typeof colors === 'string' ? { top: colors } : colors;
  const left = c.left ?? shade(c.top, -0.14);
  const right = c.right ?? shade(c.top, -0.28);
  // Left face: along the +y edge.
  fillPoly(p.ctx, [P(p, x, y + d, z + h), P(p, x + w, y + d, z + h), P(p, x + w, y + d, z), P(p, x, y + d, z)], left);
  // Right face: along the +x edge.
  fillPoly(p.ctx, [P(p, x + w, y, z + h), P(p, x + w, y + d, z + h), P(p, x + w, y + d, z), P(p, x + w, y, z)], right);
  quad(p, x, y, z + h, w, d, c.top);
}

/** Vertical rectangle on the face x = const (seen from the lower-right). */
export function faceX(p: Painter, x: number, y: number, z: number, d: number, h: number, color: string) {
  fillPoly(p.ctx, [P(p, x, y, z + h), P(p, x, y + d, z + h), P(p, x, y + d, z), P(p, x, y, z)], color);
}

/** Vertical rectangle on the face y = const (seen from the lower-left). */
export function faceY(p: Painter, x: number, y: number, z: number, w: number, h: number, color: string) {
  fillPoly(p.ctx, [P(p, x, y, z + h), P(p, x + w, y, z + h), P(p, x + w, y, z), P(p, x, y, z)], color);
}

/** Pixel at an isometric point (for tiny details such as LEDs). */
export function dot(p: Painter, x: number, y: number, z: number, color: string, w = 1, h = 1) {
  const s = P(p, x, y, z);
  p.ctx.fillStyle = color;
  p.ctx.fillRect(Math.round(s.x), Math.round(s.y), w, h);
}

/** Deterministic pseudo-random generator for stable decorations. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
