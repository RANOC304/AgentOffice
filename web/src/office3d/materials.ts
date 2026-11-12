// Shared materials and procedural textures. Environment colours stay soft and slightly muted so the
// characters (saturated clothes, dark outlines) read clearly against them.

import * as THREE from 'three';

const cache = new Map<string, THREE.Material>();

export function mat(color: string, opts: { roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `std:${color}:${opts.roughness ?? 0.8}:${opts.metalness ?? 0}:${opts.emissive ?? ''}:${opts.emissiveIntensity ?? 0}`;
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.8, metalness: opts.metalness ?? 0 });
    if (opts.emissive) {
      m.emissive.set(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    cache.set(key, m);
  }
  return m;
}

export function glassMat(): THREE.MeshStandardMaterial {
  let m = cache.get('glass') as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: '#cfe8f2', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false });
    cache.set('glass', m);
  }
  return m;
}

export function texturedMat(key: string, make: () => THREE.Texture, opts: { roughness?: number; repeat?: [number, number]; color?: string } = {}): THREE.MeshStandardMaterial {
  const k = `tex:${key}`;
  let m = cache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const map = make();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) map.repeat.set(opts.repeat[0], opts.repeat[1]);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    m = new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.85, color: opts.color ?? '#ffffff' });
    cache.set(k, m);
  }
  return m;
}

// ---------- procedural textures ----------

function canvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  return new THREE.CanvasTexture(c);
}

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

export function woodTexture(base: string, seed = 1) {
  return canvas(512, (ctx, s) => {
    const r = rand(seed);
    const plankH = s / 8;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      const offset = r() * s * 0.62;
      for (let k = -1; k < 2; k++) {
        const x = offset + k * s * 0.62;
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.08);
        ctx.fillRect(x, i * plankH, s * 0.62, plankH);
      }
      for (let g = 0; g < 26; g++) {
        ctx.strokeStyle = `rgba(80,50,25,${0.04 + r() * 0.06})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const y = i * plankH + r() * plankH;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.3, y + (r() - 0.5) * 6, s * 0.6, y + (r() - 0.5) * 6, s, y + (r() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(60,40,20,0.35)';
      ctx.fillRect(0, i * plankH, s, 1.5);
    }
  });
}

export function carpetTexture(base: string, seed = 2) {
  return canvas(256, (ctx, s) => {
    const r = rand(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 22;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s);
  });
}

export function concreteTexture(base: string, seed = 3) {
  return canvas(512, (ctx, s) => {
    const r = rand(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = r() * s;
      const y = r() * s;
      const rad = 10 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() > 0.5;
      g.addColorStop(0, dark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s);
  });
}

export function terrazzoTexture(base: string, seed = 4) {
  return canvas(512, (ctx, s) => {
    const r = rand(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const chips = ['#9aa3a0', '#b8a58a', '#7f8a94', '#e8e2d6', '#a98f78', '#6f7c78'];
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = chips[Math.floor(r() * chips.length)];
      ctx.globalAlpha = 0.5 + r() * 0.5;
      const x = r() * s;
      const y = r() * s;
      const w = 2 + r() * 7;
      ctx.beginPath();
      ctx.ellipse(x, y, w, w * (0.5 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

export function tileTexture(base: string) {
  return canvas(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
  });
}

export function grassTexture(seed = 5) {
  return canvas(512, (ctx, s) => {
    const r = rand(seed);
    ctx.fillStyle = '#7fb36a';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const x = r() * s;
      const y = r() * s;
      const g = 140 + Math.floor(r() * 70);
      ctx.fillStyle = `rgba(${70 + Math.floor(r() * 40)},${g},${60 + Math.floor(r() * 30)},${0.35 + r() * 0.4})`;
      ctx.fillRect(x, y, 1.5, 3 + r() * 4);
    }
  });
}

export function plasterTexture(base: string, seed = 6) {
  return canvas(256, (ctx, s) => {
    const r = rand(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)';
      ctx.fillRect(r() * s, r() * s, 2 + r() * 3, 2 + r() * 3);
    }
  });
}

/** Soft round sprite used for clouds and the waterfall mist. */
export function softDot(color = '255,255,255') {
  return canvas(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, `rgba(${color},0.95)`);
    g.addColorStop(0.55, `rgba(${color},0.55)`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export { shade };
