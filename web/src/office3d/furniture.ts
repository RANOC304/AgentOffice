// Furniture and architecture built from simple solids, merged per material into a few draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM_BY_ID } from '../../../shared/rooms.ts';
import type { Furn } from './layout.ts';
import { glassMat, mat, shade } from './materials.ts';

export class Batch {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private noShadow = new Set<THREE.Material>();

  add(geo: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4, castShadow = true) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(g);
    if (!castShadow) this.noShadow.add(material);
  }

  build(parent: THREE.Object3D) {
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      const transparent = (material as THREE.MeshStandardMaterial).transparent;
      mesh.castShadow = !transparent && !this.noShadow.has(material);
      mesh.receiveShadow = !transparent;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      for (const g of list) g.dispose();
    }
    this.buckets.clear();
  }
}

const tmp = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

/** Places solids in an item's local frame (front faces +z), then rotates/translates into the world. */
export class Builder {
  private base: THREE.Matrix4;
  private batch: Batch;
  constructor(batch: Batch, x: number, z: number, rot: number, y = 0) {
    this.batch = batch;
    this.base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
  }
  private put(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, shadow = true) {
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    v.set(x, y, z);
    s.set(sx, sy, sz);
    tmp.compose(v, q, s).premultiply(this.base);
    this.batch.add(geo, m, tmp, shadow);
    geo.dispose();
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) {
    this.put(new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
  }
  rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0) {
    this.put(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), m, x, y, z, rx, ry);
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 16, rx = 0, rz = 0) {
    this.put(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z, rx, 0, rz);
  }
  sphere(r: number, x: number, y: number, z: number, m: THREE.Material, sx = 1, sy = 1, sz = 1, detail = 1) {
    this.put(new THREE.IcosahedronGeometry(r, detail), m, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  smooth(r: number, x: number, y: number, z: number, m: THREE.Material, sx = 1, sy = 1, sz = 1) {
    this.put(new THREE.SphereGeometry(r, 18, 12), m, x, y, z, 0, 0, 0, sx, sy, sz);
  }
  torus(r: number, t: number, x: number, y: number, z: number, m: THREE.Material, rx = 0) {
    this.put(new THREE.TorusGeometry(r, t, 8, 24), m, x, y, z, rx);
  }
  rock(r: number, x: number, y: number, z: number, m: THREE.Material, sx = 1, sy = 1, sz = 1) {
    this.put(new THREE.DodecahedronGeometry(r, 0), m, x, y, z, x * 3.1, y * 1.7, z * 2.3, sx, sy, sz);
  }
  cone(r: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 10) {
    this.put(new THREE.ConeGeometry(r, h, seg), m, x, y, z);
  }
  /** Flat panel that never casts shadows (labels, screens' faces, strokes). */
  plane(w: number, h: number, x: number, y: number, z: number, m: THREE.Material, ry = 0) {
    this.put(new THREE.PlaneGeometry(w, h), m, x, y, z, 0, ry, 0, 1, 1, 1, false);
  }
}

// ---------- palette ----------
const OAK = () => mat('#c8a27a', { roughness: 0.65 });
const OAK_DARK = () => mat('#8a6446', { roughness: 0.7 });
const WHITE = () => mat('#eeebe5', { roughness: 0.55 });
const METAL = () => mat('#9aa1ab', { roughness: 0.35, metalness: 0.7 });
const DARK_METAL = () => mat('#3a3f48', { roughness: 0.45, metalness: 0.5 });
const BLACK = () => mat('#1e2127', { roughness: 0.4, metalness: 0.2 });
const FABRIC = () => mat('#4a4f5a', { roughness: 0.95 });
const SCREEN_OFF = () => mat('#14181f', { roughness: 0.25, metalness: 0.3 });
const POTS = ['#c9734f', '#e9e4dc', '#4a4f5a', '#9c8a6e'];
const LEAVES = ['#4e8a47', '#5c9a4f', '#3f7a45', '#6aa758'];
const BOOKS = ['#b5523b', '#d9a441', '#4f7fb5', '#5f9a68', '#8a68b0', '#c46a8a', '#3f8c88', '#e7dcc8', '#2f3a4f'];

function rng(seed: number) {
  let x = seed * 9301 + 49297;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

export function buildFurniture(batch: Batch, f: Furn) {
  const b = new Builder(batch, f.x, f.z, f.rot);
  const r = rng(f.variant * 7 + 3);
  const accent = ROOM_BY_ID[f.room]?.accent ?? '#6f8f63';
  const soft = mat(shade(accent, 0.12), { roughness: 0.9 });
  switch (f.type) {
    case 'desk': {
      b.box(1.4, 0.035, 0.7, 0, 0.74, 0, OAK());
      for (const sx of [-0.66, 0.66]) b.box(0.04, 0.72, 0.62, sx, 0.36, 0, WHITE());
      b.box(1.28, 0.3, 0.02, 0, 0.55, 0.3, WHITE());
      // Monitor (faces the sitter at local −z) with its stand; the lit screen is a separate mesh.
      b.box(0.62, 0.37, 0.03, 0, 1.06, 0.22, BLACK());
      b.box(0.05, 0.16, 0.04, 0, 0.83, 0.25, DARK_METAL());
      b.box(0.22, 0.012, 0.16, 0, 0.765, 0.25, DARK_METAL());
      b.box(0.42, 0.015, 0.13, 0, 0.765, -0.12, mat('#2c3038', { roughness: 0.6 }));
      b.rbox(0.06, 0.025, 0.1, 0.012, 0.32, 0.77, -0.12, mat('#2c3038', { roughness: 0.6 }));
      if (r() > 0.4) b.cyl(0.04, 0.035, 0.1, -0.5, 0.81, -0.05, mat(['#f2efe8', '#c9734f', '#4f7fb5', '#2f3a4f'][Math.floor(r() * 4)], { roughness: 0.4 }));
      if (r() > 0.5) b.box(0.21, 0.01, 0.29, 0.48, 0.763, 0.08, mat('#fbfaf6'), 0, 0.2);
      if (r() > 0.6) {
        b.cyl(0.05, 0.04, 0.09, -0.52, 0.8, 0.22, mat('#e9e4dc'));
        b.sphere(0.08, -0.52, 0.9, 0.22, mat(LEAVES[Math.floor(r() * 4)]), 1, 0.8, 1, 1);
      }
      break;
    }
    case 'chair': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.box(0.04, 0.03, 0.3, Math.sin(a) * 0.14, 0.06, Math.cos(a) * 0.14, DARK_METAL(), 0, a);
        b.smooth(0.025, Math.sin(a) * 0.28, 0.03, Math.cos(a) * 0.28, BLACK());
      }
      b.cyl(0.025, 0.025, 0.32, 0, 0.24, 0, METAL());
      b.rbox(0.5, 0.08, 0.48, 0.035, 0, 0.44, 0, FABRIC());
      b.rbox(0.46, 0.5, 0.07, 0.035, 0, 0.78, -0.25, FABRIC(), -0.08);
      b.box(0.04, 0.22, 0.04, 0, 0.55, -0.24, DARK_METAL());
      for (const sx of [-0.27, 0.27]) b.rbox(0.05, 0.03, 0.26, 0.012, sx, 0.62, 0, BLACK());
      break;
    }
    case 'divider':
      b.rbox(4.6, 0.38, 0.04, 0.015, 0, 0.94, 0, soft);
      break;
    case 'plant':
    case 'tallPlant': {
      const tall = f.type === 'tallPlant';
      const pot = mat(POTS[Math.floor(r() * POTS.length)], { roughness: 0.7 });
      b.cyl(tall ? 0.22 : 0.17, tall ? 0.17 : 0.13, tall ? 0.42 : 0.32, 0, tall ? 0.21 : 0.16, 0, pot, 20);
      b.cyl(tall ? 0.2 : 0.15, tall ? 0.2 : 0.15, 0.02, 0, tall ? 0.41 : 0.31, 0, mat('#4a3a2c'), 20);
      if (tall) {
        b.cyl(0.025, 0.035, 0.9, 0, 0.85, 0, mat('#7a5a3e'));
        for (let i = 0; i < 9; i++) {
          const a = r() * Math.PI * 2;
          const h = 0.9 + r() * 0.75;
          const d = 0.12 + r() * 0.22;
          b.sphere(0.17 + r() * 0.06, Math.sin(a) * d, h, Math.cos(a) * d, mat(LEAVES[Math.floor(r() * 4)], { roughness: 0.8 }), 1, 0.7, 1, 0);
        }
      } else {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + r();
          b.box(0.05, 0.42 + r() * 0.25, 0.012, Math.sin(a) * 0.06, 0.55, Math.cos(a) * 0.06, mat(LEAVES[Math.floor(r() * 4)], { roughness: 0.8 }), (r() - 0.5) * 0.5, a, (r() - 0.5) * 0.4);
        }
      }
      break;
    }
    case 'shelf': {
      for (const sx of [-0.48, 0.48]) b.box(0.04, 1.85, 0.36, sx, 0.925, 0, OAK_DARK());
      b.box(1.0, 0.04, 0.36, 0, 1.83, 0, OAK_DARK());
      b.box(0.96, 1.81, 0.02, 0, 0.925, -0.17, mat('#6b4c33'));
      for (const y of [0.06, 0.5, 0.94, 1.38]) {
        b.box(0.94, 0.03, 0.32, 0, y + 0.015, 0.01, OAK());
        let x = -0.44;
        while (x < 0.4) {
          const w = 0.035 + r() * 0.05;
          const h = 0.24 + r() * 0.14;
          if (r() > 0.12) b.box(w, h, 0.22, x + w / 2, y + 0.03 + h / 2, 0.04, mat(BOOKS[Math.floor(r() * BOOKS.length)], { roughness: 0.75 }), 0, 0, r() > 0.9 ? 0.18 : 0);
          x += w + 0.006;
        }
      }
      break;
    }
    case 'rack': {
      b.box(0.62, 1.95, 0.85, 0, 0.975, 0, mat('#262a31', { roughness: 0.5, metalness: 0.4 }));
      b.box(0.56, 1.85, 0.01, 0, 0.98, 0.43, mat('#3a3f48', { roughness: 0.4, metalness: 0.6 }));
      for (let y = 0.15; y < 1.85; y += 0.12) {
        b.box(0.5, 0.02, 0.005, 0, y, 0.436, mat('#4a505b', { metalness: 0.6, roughness: 0.4 }));
        b.box(0.03, 0.012, 0.004, -0.2, y + 0.04, 0.44, mat(r() > 0.3 ? '#3df08a' : '#3fb6ff', { emissive: r() > 0.3 ? '#3df08a' : '#3fb6ff', emissiveIntensity: 2.2 }));
        if (r() > 0.4) b.box(0.03, 0.012, 0.004, -0.14, y + 0.04, 0.44, mat('#ffc24a', { emissive: '#ffc24a', emissiveIntensity: 2 }));
      }
      break;
    }
    case 'whiteboard': {
      for (const sx of [-0.62, 0.62]) {
        b.box(0.04, 1.75, 0.04, sx, 0.875, 0, METAL());
        b.box(0.04, 0.03, 0.45, sx, 0.05, 0, METAL());
      }
      b.box(1.3, 0.9, 0.03, 0, 1.3, 0, mat('#fbfbf8', { roughness: 0.25 }));
      b.box(1.34, 0.03, 0.05, 0, 0.84, 0.02, METAL());
      const pens = ['#2f5fb0', '#c8473b', '#2f8f5b', '#2b2d33'];
      for (let i = 0; i < 6; i++) b.box(0.15 + r() * 0.45, 0.012, 0.004, -0.4 + r() * 0.5, 1.05 + r() * 0.55, 0.017, mat(pens[i % 4]));
      for (let i = 0; i < 5; i++) {
        const h = 0.08 + r() * 0.3;
        b.box(0.06, h, 0.004, 0.2 + i * 0.09, 0.95 + h / 2, 0.017, mat(shade(accent, -0.05)));
      }
      break;
    }
    case 'tv': {
      b.box(0.5, 0.05, 0.35, 0, 0.025, 0, DARK_METAL());
      b.box(0.06, 1.0, 0.06, 0, 0.55, 0, DARK_METAL());
      b.box(1.35, 0.78, 0.05, 0, 1.35, 0.02, BLACK());
      b.plane(1.27, 0.7, 0, 1.35, 0.047, mat('#13202c', { emissive: shade(accent, -0.1), emissiveIntensity: 0.35, roughness: 0.3 }));
      for (let i = 0; i < 5; i++) b.plane(0.2 + r() * 0.6, 0.04, -0.4 + r() * 0.3, 1.55 - i * 0.1, 0.049, mat('#cfe6ff', { emissive: '#cfe6ff', emissiveIntensity: 0.6 }));
      break;
    }
    case 'arcade': {
      const body = mat(r() > 0.5 ? '#7b5fb5' : '#c4527a', { roughness: 0.5 });
      b.box(0.72, 1.75, 0.7, 0, 0.875, -0.02, body);
      b.box(0.6, 0.45, 0.04, 0, 1.3, 0.3, BLACK(), -0.25);
      b.plane(0.5, 0.36, 0, 1.3, 0.33, mat('#18242f', { emissive: '#3fd1ff', emissiveIntensity: 0.55 }));
      b.box(0.68, 0.06, 0.32, 0, 0.98, 0.42, BLACK(), 0.15);
      b.cyl(0.02, 0.02, 0.07, -0.12, 1.04, 0.42, mat('#e0433a'));
      b.smooth(0.03, -0.12, 1.08, 0.42, mat('#e0433a', { roughness: 0.3 }));
      b.cyl(0.025, 0.025, 0.02, 0.08, 1.03, 0.44, mat('#3fb6ff', { emissive: '#3fb6ff', emissiveIntensity: 1 }));
      b.cyl(0.025, 0.025, 0.02, 0.18, 1.03, 0.44, mat('#ffc24a', { emissive: '#ffc24a', emissiveIntensity: 1 }));
      b.box(0.72, 0.18, 0.5, 0, 1.68, 0.05, mat('#ffd36a', { emissive: '#ffb84a', emissiveIntensity: 0.6 }));
      break;
    }
    case 'easel': {
      b.box(0.04, 1.7, 0.04, -0.3, 0.83, 0.08, OAK(), 0.12, 0, 0.18);
      b.box(0.04, 1.7, 0.04, 0.3, 0.83, 0.08, OAK(), 0.12, 0, -0.18);
      b.box(0.04, 1.6, 0.04, 0, 0.78, -0.22, OAK(), -0.25);
      b.box(0.7, 0.9, 0.03, 0, 1.25, 0.12, mat('#f6f1e6'), -0.12);
      const paint = ['#c8473b', '#e8a93a', '#3f7fbf', '#5fa66a', '#b8558f'];
      for (let i = 0; i < 7; i++) b.sphere(0.06 + r() * 0.08, -0.22 + r() * 0.44, 1.0 + r() * 0.5, 0.14 + (1.25 - (1.0 + r() * 0.5)) * 0.12, mat(paint[i % 5]), 1, 1, 0.08, 1);
      break;
    }
    case 'printer3d': {
      b.box(0.7, 0.5, 0.6, 0, 0.25, 0, mat('#e9e6e0', { roughness: 0.5 }));
      for (const [px, pz] of [
        [-0.3, -0.25],
        [0.3, -0.25],
        [-0.3, 0.25],
        [0.3, 0.25],
      ])
        b.box(0.03, 0.6, 0.03, px, 0.8, pz, METAL());
      b.box(0.66, 0.04, 0.56, 0, 1.1, 0, BLACK());
      b.box(0.5, 0.02, 0.45, 0, 0.62, 0, mat('#2c3038'));
      b.box(0.12, 0.08, 0.1, 0.05, 0.85, 0, mat(accent));
      b.sphere(0.07, 0, 0.7, 0, mat('#f0a446', { roughness: 0.4 }), 1, 1, 1, 0);
      break;
    }
    case 'pedestal': {
      b.box(0.45, 1.0, 0.45, 0, 0.5, 0, WHITE());
      b.torus(0.12, 0.045, 0, 1.2, 0, mat(accent, { roughness: 0.3, metalness: 0.3 }), 0.6);
      break;
    }
    case 'camera': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.box(0.025, 1.3, 0.025, Math.sin(a) * 0.18, 0.62, Math.cos(a) * 0.18, BLACK(), Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
      }
      b.rbox(0.28, 0.18, 0.16, 0.02, 0, 1.36, 0, BLACK());
      b.cyl(0.06, 0.07, 0.14, 0, 1.36, 0.14, mat('#2c3038'), 16, Math.PI / 2);
      b.smooth(0.012, 0.1, 1.46, 0, mat('#e0433a', { emissive: '#e0433a', emissiveIntensity: 2 }));
      break;
    }
    case 'softbox': {
      b.cyl(0.02, 0.02, 1.5, 0, 0.75, 0, BLACK());
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.box(0.02, 0.02, 0.3, Math.sin(a) * 0.13, 0.02, Math.cos(a) * 0.13, BLACK(), 0, a);
      }
      b.box(0.55, 0.42, 0.25, 0, 1.55, 0, BLACK(), -0.2);
      b.plane(0.5, 0.37, 0, 1.58, 0.14, mat('#fffaf0', { emissive: '#fff6e0', emissiveIntensity: 1.4 }), 0);
      break;
    }
    case 'safe':
      b.rbox(0.7, 0.95, 0.65, 0.03, 0, 0.475, 0, mat('#6e7686', { roughness: 0.4, metalness: 0.6 }));
      b.cyl(0.07, 0.07, 0.03, 0.12, 0.55, 0.33, mat('#c9a24a', { metalness: 0.8, roughness: 0.3 }), 20, Math.PI / 2);
      b.box(0.04, 0.2, 0.04, -0.2, 0.5, 0.34, METAL());
      break;
    case 'sofa':
    case 'armchair': {
      const w = f.type === 'sofa' ? 2.0 : 0.9;
      const cloth = mat(shade(accent, -0.05), { roughness: 0.95 });
      b.rbox(w, 0.3, 0.85, 0.06, 0, 0.25, 0, cloth);
      b.rbox(w - 0.2, 0.12, 0.62, 0.05, 0, 0.44, 0.06, mat(shade(accent, 0.06), { roughness: 0.95 }));
      b.rbox(w, 0.5, 0.2, 0.07, 0, 0.6, -0.33, cloth);
      for (const sx of [-w / 2 + 0.09, w / 2 - 0.09]) b.rbox(0.18, 0.32, 0.85, 0.06, sx, 0.52, 0, cloth);
      for (const [lx, lz] of [
        [-w / 2 + 0.1, -0.35],
        [w / 2 - 0.1, -0.35],
        [-w / 2 + 0.1, 0.35],
        [w / 2 - 0.1, 0.35],
      ])
        b.cyl(0.025, 0.02, 0.1, lx, 0.05, lz, OAK_DARK());
      break;
    }
    case 'beanbag':
      b.smooth(0.42, 0, 0.26, 0, mat(['#d07a3c', '#4f7fb5', '#b8558f'][f.variant % 3], { roughness: 0.95 }), 1, 0.62, 1);
      break;
    case 'coffeeTable':
      b.rbox(1.0, 0.05, 0.6, 0.02, 0, 0.42, 0, OAK());
      for (const [lx, lz] of [
        [-0.42, -0.24],
        [0.42, -0.24],
        [-0.42, 0.24],
        [0.42, 0.24],
      ])
        b.cyl(0.02, 0.02, 0.4, lx, 0.2, lz, BLACK());
      b.cyl(0.04, 0.035, 0.09, 0.15, 0.49, 0.05, WHITE());
      b.box(0.25, 0.02, 0.18, -0.2, 0.455, 0, mat('#4f7fb5'));
      break;
    case 'counter':
      b.box(3.6, 0.9, 0.62, 0, 0.45, -0.02, mat('#5b4637', { roughness: 0.6 }));
      b.box(3.7, 0.05, 0.72, 0, 0.925, 0, mat('#e3ded5', { roughness: 0.3 }));
      for (let i = 0; i < 6; i++) b.cyl(0.035, 0.03, 0.08, -1.5 + i * 0.12, 0.99, -0.2, WHITE());
      break;
    case 'coffeeMachine':
      b.rbox(0.42, 0.5, 0.42, 0.04, 0, 1.2, 0, mat('#2b2e35', { roughness: 0.35, metalness: 0.5 }));
      b.box(0.36, 0.08, 0.06, 0, 1.35, 0.2, mat('#c8473b', { roughness: 0.4 }));
      b.box(0.3, 0.02, 0.18, 0, 0.96, 0.18, METAL());
      b.cyl(0.03, 0.03, 0.08, 0, 1.12, 0.2, METAL());
      b.smooth(0.01, 0.12, 1.4, 0.215, mat('#3df08a', { emissive: '#3df08a', emissiveIntensity: 2 }));
      break;
    case 'standTable':
      b.cyl(0.36, 0.36, 0.04, 0, 1.05, 0, OAK(), 28);
      b.cyl(0.035, 0.035, 1.03, 0, 0.52, 0, BLACK());
      b.cyl(0.25, 0.25, 0.03, 0, 0.015, 0, BLACK(), 24);
      break;
    case 'meetingTable':
      b.rbox(3.4, 0.05, 1.4, 0.02, 0, 0.75, 0, mat('#a57f5c', { roughness: 0.5 }));
      for (const sx of [-1.1, 1.1]) b.box(0.08, 0.72, 0.9, sx, 0.36, 0, BLACK());
      b.box(0.4, 0.02, 0.4, 0, 0.785, 0, BLACK());
      break;
    case 'pingpong': {
      b.box(2.74, 0.04, 1.52, 0, 0.76, 0, mat('#2f6aa3', { roughness: 0.4 }));
      b.box(2.74, 0.004, 0.02, 0, 0.782, 0, mat('#ffffff'));
      for (const sz of [-0.75, 0.75]) b.box(2.74, 0.004, 0.02, 0, 0.782, sz, mat('#ffffff'));
      for (const sx of [-1.36, 1.36]) b.box(0.02, 0.004, 1.52, sx, 0.782, 0, mat('#ffffff'));
      b.box(0.02, 0.15, 1.62, 0, 0.855, 0, mat('#f2f2f2', { roughness: 0.9 }));
      for (const [lx, lz] of [
        [-1.1, -0.6],
        [1.1, -0.6],
        [-1.1, 0.6],
        [1.1, 0.6],
      ])
        b.box(0.05, 0.74, 0.05, lx, 0.37, lz, BLACK());
      break;
    }
    case 'cooler':
      b.box(0.32, 0.95, 0.32, 0, 0.475, 0, WHITE());
      b.cyl(0.14, 0.14, 0.42, 0, 1.17, 0, mat('#8fc8ea', { roughness: 0.1 }), 18);
      break;
    case 'bench':
      for (let i = 0; i < 4; i++) b.box(1.6, 0.04, 0.1, 0, 0.44, -0.18 + i * 0.12, OAK());
      for (const sx of [-0.65, 0.65]) b.box(0.06, 0.42, 0.45, sx, 0.21, 0, BLACK());
      break;
    case 'planter': {
      b.box(1.0, 0.55, 1.0, 0, 0.275, 0, mat('#b9b4aa', { roughness: 0.9 }));
      b.box(0.92, 0.04, 0.92, 0, 0.55, 0, mat('#4a3a2c'));
      for (let i = 0; i < 6; i++) b.sphere(0.24 + r() * 0.1, (r() - 0.5) * 0.5, 0.75 + r() * 0.3, (r() - 0.5) * 0.5, mat(LEAVES[Math.floor(r() * 4)]), 1, 0.85, 1, 0);
      break;
    }
    case 'fridge':
      b.rbox(0.66, 1.75, 0.62, 0.03, 0, 0.875, 0, mat('#e8e6e1', { roughness: 0.35, metalness: 0.2 }));
      b.box(0.03, 0.5, 0.03, -0.25, 1.2, 0.32, METAL());
      break;
    default:
      break;
  }
}

export { glassMat, SCREEN_OFF };
