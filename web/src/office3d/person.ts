// Procedural 3D man with a joint hierarchy (hips, torso, head, arms, legs) so he can walk, run, sit,
// type, drink, wave and talk. Each rigid segment is one vertex-coloured mesh (with per-vertex
// roughness, so skin, cloth, leather and eyes each catch the light differently) plus a thin dark
// outline shell that keeps characters crisp against the office. The face has its own small meshes so
// the eyes blink and the mouth moves while he talks.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Look } from './look.ts';

/** Vertex colours plus a per-vertex roughness attribute ("rough") read by the shader. */
const BODY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.02 });
BODY.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float rough;\nvarying float vRough;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vRough;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
};
BODY.customProgramCacheKey = () => 'person-rough-v1';

const OUTLINE = new THREE.MeshBasicMaterial({ color: '#17131f', side: THREE.BackSide });
const HIT = new THREE.MeshBasicMaterial({ visible: false });
const LENS = new THREE.MeshStandardMaterial({ color: '#cfe3ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
const CUP = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.35 });
const COFFEE = new THREE.MeshStandardMaterial({ color: '#4a2c1a', roughness: 0.3 });
const PHONE = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.3, metalness: 0.4 });
const PHONE_SCREEN = new THREE.MeshStandardMaterial({ color: '#5aa9ff', emissive: '#5aa9ff', emissiveIntensity: 0.9 });
const PADDLE = new THREE.MeshStandardMaterial({ color: '#c8473b', roughness: 0.5 });

/** Roughness of each kind of surface. */
const R = { skin: 0.5, cloth: 0.86, denim: 0.8, leather: 0.38, sole: 0.75, hair: 0.62, eye: 0.12, lip: 0.42, metal: 0.28, frame: 0.3, mouth: 0.6 };

interface Part {
  geo: THREE.BufferGeometry;
  color: string;
  rough: number;
}

const m4 = new THREE.Matrix4();
const qt = new THREE.Quaternion();
const eu = new THREE.Euler();

function part(geo: THREE.BufferGeometry, color: string, rough: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Part {
  eu.set(rx, ry, rz);
  qt.setFromEuler(eu);
  m4.compose(new THREE.Vector3(x, y, z), qt, new THREE.Vector3(sx, sy, sz));
  geo.applyMatrix4(m4);
  return { geo, color, rough };
}

/** Sphere with a vertex budget that follows its size. */
function sphere(r: number) {
  const w = r < 0.012 ? 8 : r < 0.03 ? 12 : r < 0.07 ? 16 : 22;
  return new THREE.SphereGeometry(r, w, Math.max(6, Math.round(w * 0.66)));
}
/** Limb section hanging down from its joint: radius r1 at the top, r2 at the bottom. */
function limb(r1: number, r2: number, len: number) {
  const g = new THREE.CylinderGeometry(r1, r2, len, 16, 1, true);
  g.translate(0, -len / 2, 0);
  return g;
}
const capsule = (r: number, len: number, radial = 12) => new THREE.CapsuleGeometry(r, len, 4, radial);
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
const ring = (r: number, tube: number, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, 6, 24, arc);
/** Body of revolution from [radius, y] points (scaled into an oval afterwards). */
const lathe = (pts: Array<[number, number]>, seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

function segment(parts: Part[], outline = 0.0068, shadow = true): THREE.Group {
  const geos = parts.map(({ geo, color, rough }) => {
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    const roughs = new Float32Array(n);
    const nor = geo.getAttribute('normal');
    for (let i = 0; i < n; i++) {
      // A touch of baked occlusion: surfaces facing down are slightly darker.
      const ao = 0.9 + 0.1 * (nor.getY(i) * 0.5 + 0.5);
      colors[i * 3] = c.r * ao;
      colors[i * 3 + 1] = c.g * ao;
      colors[i * 3 + 2] = c.b * ao;
      roughs[i] = rough;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('rough', new THREE.BufferAttribute(roughs, 1));
    return geo.index ? geo : geo.toNonIndexed();
  });
  // Mixed indexed / non-indexed inputs cannot be merged: make them all non-indexed if needed.
  const allIndexed = geos.every((g) => g.index);
  const merged = mergeGeometries(allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  for (const g of geos) g.dispose();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(merged, BODY);
  mesh.castShadow = shadow;
  group.add(mesh);
  if (outline > 0) {
    const shell = merged.clone();
    shell.deleteAttribute('color');
    shell.deleteAttribute('rough');
    const pos = shell.getAttribute('position');
    const nor = shell.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * outline, pos.getY(i) + nor.getY(i) * outline, pos.getZ(i) + nor.getZ(i) * outline);
    group.add(new THREE.Mesh(shell, OUTLINE));
  }
  return group;
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const IRIS = ['#5a3a22', '#6b4a2a', '#3c2a1c', '#4a6a8a', '#5b7a4a', '#7a6a3a', '#3a4a5a'];

export interface Joints {
  hipsY: number;
  hipsRx: number;
  torsoRx: number;
  torsoRy: number;
  headRx: number;
  headRy: number;
  armLx: number;
  /** Horizontal swing of the arm around the shoulder (after it is raised). */
  armLy: number;
  armLz: number;
  elbowL: number;
  armRx: number;
  armRy: number;
  armRz: number;
  elbowR: number;
  thighL: number;
  kneeL: number;
  thighR: number;
  kneeR: number;
}

export const STAND: Joints = {
  hipsY: 0.925,
  hipsRx: 0,
  torsoRx: 0,
  torsoRy: 0,
  headRx: 0,
  headRy: 0,
  armLx: 0,
  armLy: 0,
  armLz: 0.07,
  elbowL: -0.12,
  armRx: 0,
  armRy: 0,
  armRz: -0.07,
  elbowR: -0.12,
  thighL: 0,
  kneeL: 0,
  thighR: 0,
  kneeR: 0,
};

export type Prop = 'cup' | 'phone' | 'paddle' | null;

export class Person {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hit: THREE.Mesh;
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private elbowL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowR = new THREE.Group();
  private thighL = new THREE.Group();
  private kneeL = new THREE.Group();
  private thighR = new THREE.Group();
  private kneeR = new THREE.Group();
  private eyes = new THREE.Group();
  private mouth = new THREE.Group();
  private jaw = new THREE.Group();
  private props: Record<'cup' | 'phone' | 'paddle', THREE.Object3D>;
  readonly joints: Joints = { ...STAND };
  readonly height: number;
  /** Extra head turn toward someone (added on top of the pose). */
  private lookYaw = 0;
  private lookPitch = 0;
  private nextBlink = 1 + Math.random() * 4;
  private blinkT = -1;
  private mouthOpen = 0;

  constructor(look: Look) {
    this.height = look.height;
    const L = look;
    const w = L.build;
    const seed = hashString(`${L.skin}${L.hair}${L.shirt}${L.hairStyle}${L.pants}`);
    const darkSkin = mix(L.skin, '#5a3020', 0.22);
    const lip = mix(L.skin, '#a8524a', 0.38);
    const sole = L.shoes === '#f2f0ea' ? '#d8d3c8' : mix(L.shoes, '#ffffff', 0.55);
    const hem = mix(L.shirt, '#000000', 0.16);
    const sock = mix(L.pants, '#1a1a1e', 0.6);

    // ---------------------------------------------------------------- hips and legs
    this.hips.add(
      segment([
        // Pelvis and seat, a soft oval.
        part(lathe([[0.001, -0.12], [0.09, -0.115], [0.12, -0.07], [0.128, 0.0], [0.13, 0.06], [0.126, 0.09], [0.001, 0.09]]), L.pants, R.denim, 0, 0, 0, 0, 0, 0, 1.22 * w, 1, 0.78),
        // Belt and buckle.
        part(lathe([[0.131, 0.058], [0.133, 0.07], [0.133, 0.088], [0.131, 0.1]], 28), '#2b2420', R.leather, 0, 0, 0, 0, 0, 0, 1.22 * w, 1, 0.78),
        part(rbox(0.045, 0.034, 0.012, 0.004), '#b9a56a', R.metal, 0, 0.079, 0.102),
        // Fly seam and back pockets.
        part(rbox(0.008, 0.1, 0.01, 0.003), mix(L.pants, '#000000', 0.25), R.denim, 0, 0.0, 0.098),
        part(rbox(0.07, 0.07, 0.01, 0.01), mix(L.pants, '#000000', 0.12), R.denim, 0.06 * w, 0.0, -0.094),
        part(rbox(0.07, 0.07, 0.01, 0.01), mix(L.pants, '#000000', 0.12), R.denim, -0.06 * w, 0.0, -0.094),
      ]),
    );
    for (const [thigh, knee, side] of [
      [this.thighL, this.kneeL, 1],
      [this.thighR, this.kneeR, -1],
    ] as const) {
      thigh.position.set(0.09 * side * w, -0.03, 0);
      thigh.add(
        segment([
          part(sphere(0.08), L.pants, R.denim, 0, 0, 0),
          part(limb(0.08, 0.06, 0.43), L.pants, R.denim, 0, 0, 0, 0, 0, 0, w, 1, 1),
          part(sphere(0.061), L.pants, R.denim, 0, -0.43, 0.004),
        ]),
      );
      knee.position.set(0, -0.43, 0);
      knee.add(
        segment([
          part(limb(0.059, 0.045, 0.36), L.pants, R.denim, 0, 0, 0),
          // Calf.
          part(sphere(0.052), L.pants, R.denim, 0, -0.13, -0.014, 0, 0, 0, 1, 1.9, 1),
          // Hem, sock, shoe.
          part(limb(0.051, 0.05, 0.03), mix(L.pants, '#000000', 0.12), R.denim, 0, -0.345, 0),
          part(limb(0.036, 0.034, 0.05), sock, R.cloth, 0, -0.37, 0),
          part(rbox(0.108, 0.026, 0.285, 0.012), sole, R.sole, 0, -0.449, 0.045),
          part(rbox(0.098, 0.06, 0.24, 0.028), L.shoes, R.leather, 0, -0.412, 0.03),
          part(sphere(0.05), L.shoes, R.leather, 0, -0.423, 0.132, 0, 0, 0, 0.98, 0.62, 1.15),
          part(rbox(0.05, 0.012, 0.09, 0.005), mix(L.shoes, '#ffffff', 0.35), R.cloth, 0, -0.381, 0.075, -0.32),
          part(rbox(0.1, 0.05, 0.05, 0.02), mix(L.shoes, '#000000', 0.15), R.leather, 0, -0.41, -0.07),
        ]),
      );
      thigh.add(knee);
      this.hips.add(thigh);
    }

    // ---------------------------------------------------------------- torso and clothes
    this.torso.position.set(0, 0.05, 0);
    const chest: Array<[number, number]> = [
      [0.001, -0.02],
      [0.128, -0.02],
      [0.132, 0.06],
      [0.138, 0.16],
      [0.15, 0.26],
      [0.157, 0.34],
      [0.155, 0.41],
      [0.138, 0.46],
      [0.105, 0.5],
      [0.075, 0.53],
      [0.056, 0.55],
      [0.001, 0.555],
    ];
    const torsoParts: Part[] = [
      part(lathe(chest), L.shirt, R.cloth, 0, 0, 0, 0, 0, 0, 1.2 * w, 1, 0.72),
      // Trapezius and shoulders.
      part(sphere(0.05), L.shirt, R.cloth, 0.105 * w, 0.475, -0.012, 0, 0, -0.45, 1.35, 0.55, 0.85),
      part(sphere(0.05), L.shirt, R.cloth, -0.105 * w, 0.475, -0.012, 0, 0, 0.45, 1.35, 0.55, 0.85),
      part(sphere(0.064), L.shirt, R.cloth, 0.196 * w, 0.452, 0, 0, 0, 0, 1, 0.9, 0.95),
      part(sphere(0.064), L.shirt, R.cloth, -0.196 * w, 0.452, 0, 0, 0, 0, 1, 0.9, 0.95),
      // Neck.
      part(limb(0.05, 0.056, 0.12), L.skin, R.skin, 0, 0.635, 0),
      part(sphere(0.03), darkSkin, R.skin, 0, 0.555, 0.035, 0, 0, 0, 1.2, 0.5, 0.6),
    ];
    if (L.top === 'shirt') {
      const white = L.tie ? '#f4f2ec' : mix(L.shirt, '#ffffff', 0.55);
      if (L.tie) {
        // Suit: a white shirt in the jacket's V, lapels and the tie.
        torsoParts.push(part(new THREE.ConeGeometry(0.075, 0.2, 3), white, R.cloth, 0, 0.44, 0.098, Math.PI, 0, 0, 1, 1, 0.35));
        torsoParts.push(part(rbox(0.05, 0.2, 0.012, 0.004), mix(L.shirt, '#000000', 0.18), R.cloth, 0.05, 0.42, 0.113, 0, 0, -0.38));
        torsoParts.push(part(rbox(0.05, 0.2, 0.012, 0.004), mix(L.shirt, '#000000', 0.18), R.cloth, -0.05, 0.42, 0.113, 0, 0, 0.38));
        torsoParts.push(part(rbox(0.045, 0.04, 0.024, 0.01), L.tie, R.cloth, 0, 0.505, 0.105));
        torsoParts.push(part(rbox(0.05, 0.25, 0.012, 0.004), L.tie, R.cloth, 0, 0.36, 0.12));
        torsoParts.push(part(new THREE.ConeGeometry(0.035, 0.05, 4), L.tie, R.cloth, 0, 0.215, 0.12, Math.PI, Math.PI / 4, 0, 1, 1, 0.4));
        for (let i = 0; i < 2; i++) torsoParts.push(part(sphere(0.009), mix(L.shirt, '#000000', 0.35), R.metal, 0, 0.2 - i * 0.08, 0.119));
        torsoParts.push(part(rbox(0.07, 0.012, 0.01, 0.004), mix(L.shirt, '#000000', 0.2), R.cloth, 0.075 * w, 0.37, 0.112, 0, 0.3));
      } else {
        // Collar points, placket, buttons and a chest pocket.
        torsoParts.push(part(ring(0.06, 0.016), white, R.cloth, 0, 0.535, 0.005, Math.PI / 2 - 0.2));
        torsoParts.push(part(new THREE.ConeGeometry(0.03, 0.06, 3), white, R.cloth, 0.03, 0.51, 0.06, Math.PI + 0.35, 0, 0.35, 1, 1, 0.35));
        torsoParts.push(part(new THREE.ConeGeometry(0.03, 0.06, 3), white, R.cloth, -0.03, 0.51, 0.06, Math.PI + 0.35, 0, -0.35, 1, 1, 0.35));
        torsoParts.push(part(rbox(0.026, 0.46, 0.008, 0.003), mix(L.shirt, '#000000', 0.08), R.cloth, 0, 0.25, 0.117));
        for (let i = 0; i < 5; i++) torsoParts.push(part(sphere(0.0075), mix(L.shirt, '#ffffff', 0.7), R.metal, 0, 0.45 - i * 0.09, 0.121));
        torsoParts.push(part(rbox(0.062, 0.07, 0.008, 0.006), mix(L.shirt, '#000000', 0.07), R.cloth, 0.07 * w, 0.36, 0.115));
      }
    } else if (L.top === 'hoodie') {
      torsoParts.push(part(ring(0.085, 0.035), mix(L.shirt, '#000000', 0.12), R.cloth, 0, 0.52, -0.015, Math.PI / 2 - 0.25, 0, 0, 1.2, 1, 1));
      torsoParts.push(part(sphere(0.11), mix(L.shirt, '#000000', 0.15), R.cloth, 0, 0.53, -0.1, 0.3, 0, 0, 1.3, 0.6, 0.62));
      torsoParts.push(part(limb(0.006, 0.006, 0.15), '#f2f0ea', R.cloth, 0.035, 0.5, 0.11, 0.1));
      torsoParts.push(part(limb(0.006, 0.006, 0.15), '#f2f0ea', R.cloth, -0.035, 0.5, 0.11, 0.1));
      torsoParts.push(part(rbox(0.21, 0.09, 0.03, 0.012), mix(L.shirt, '#000000', 0.1), R.cloth, 0, 0.13, 0.112));
      torsoParts.push(part(lathe([[0.131, -0.025], [0.134, 0.035]]), hem, R.cloth, 0, 0, 0, 0, 0, 0, 1.2 * w, 1, 0.72));
    } else if (L.top === 'sweater') {
      torsoParts.push(part(ring(0.06, 0.021), hem, R.cloth, 0, 0.535, 0, Math.PI / 2));
      torsoParts.push(part(lathe([[0.131, -0.025], [0.134, 0.04]]), hem, R.cloth, 0, 0, 0, 0, 0, 0, 1.2 * w, 1, 0.72));
      // A knitted stripe across the chest.
      torsoParts.push(part(lathe([[0.1605, 0.29], [0.1665, 0.33]]), mix(L.shirt, '#ffffff', 0.28), R.cloth, 0, 0, 0, 0, 0, 0, 1.205 * w, 1, 0.725));
    } else {
      torsoParts.push(part(ring(0.058, 0.012), mix(L.shirt, '#000000', 0.2), R.cloth, 0, 0.535, 0.01, Math.PI / 2 - 0.1));
      torsoParts.push(part(lathe([[0.1295, -0.022], [0.1305, 0.012]]), hem, R.cloth, 0, 0, 0, 0, 0, 0, 1.205 * w, 1, 0.725));
    }
    if (L.badge) {
      torsoParts.push(part(rbox(0.012, 0.22, 0.008, 0.003), '#f2f0ea', R.cloth, 0.04, 0.41, 0.12, 0, 0, -0.2));
      torsoParts.push(part(rbox(0.012, 0.22, 0.008, 0.003), '#f2f0ea', R.cloth, -0.04, 0.41, 0.12, 0, 0, 0.2));
      torsoParts.push(part(rbox(0.075, 0.1, 0.012, 0.006), '#ffffff', R.cloth, 0, 0.27, 0.121));
      torsoParts.push(part(rbox(0.055, 0.02, 0.004, 0.002), mix(L.shirt, '#000000', 0.1), R.cloth, 0, 0.29, 0.128));
    }
    this.torso.add(segment(torsoParts));

    // ---------------------------------------------------------------- head
    this.head.position.set(0, 0.6, 0);
    const iris = IRIS[seed % IRIS.length];
    const hp: Part[] = [
      // Skull, jaw and chin.
      part(sphere(0.112), L.skin, R.skin, 0, 0.122, -0.006, 0, 0, 0, 0.9, 1.05, 1.0),
      part(sphere(0.094), L.skin, R.skin, 0, 0.074, 0.016, 0, 0, 0, 0.88, 0.86, 0.94),
      part(sphere(0.045), L.skin, R.skin, 0, 0.026, 0.068, 0, 0, 0, 1.05, 0.82, 0.9),
    ];
    // Facial features: no outline, so the face stays clean.
    const face: Part[] = [
      // Cheekbones and brow ridge.
      part(sphere(0.032), L.skin, R.skin, 0.052, 0.098, 0.07, 0, 0, 0, 1, 0.75, 0.8),
      part(sphere(0.032), L.skin, R.skin, -0.052, 0.098, 0.07, 0, 0, 0, 1, 0.75, 0.8),
      part(rbox(0.088, 0.02, 0.024, 0.009), L.skin, R.skin, 0, 0.142, 0.093),
      // Nose: bridge, tip, wings.
      part(rbox(0.02, 0.05, 0.026, 0.009), L.skin, R.skin, 0, 0.108, 0.1, -0.22),
      part(sphere(0.019), L.skin, R.skin, 0, 0.084, 0.114, 0, 0, 0, 1, 0.9, 1),
      part(sphere(0.011), mix(L.skin, '#8a4a30', 0.08), R.skin, 0.014, 0.08, 0.106),
      part(sphere(0.011), mix(L.skin, '#8a4a30', 0.08), R.skin, -0.014, 0.08, 0.106),
      part(sphere(0.016), darkSkin, R.skin, 0.112, 0.11, 0.0, 0, 0, 0, 0.4, 1, 0.7),
      part(sphere(0.016), darkSkin, R.skin, -0.112, 0.11, 0.0, 0, 0, 0, 0.4, 1, 0.7),
      // Eye sockets (they also read as closed lids when blinking) and lid creases.
      part(sphere(0.02), darkSkin, R.skin, 0.037, 0.124, 0.091, 0, 0, 0, 1.15, 0.85, 0.5),
      part(sphere(0.02), darkSkin, R.skin, -0.037, 0.124, 0.091, 0, 0, 0, 1.15, 0.85, 0.5),
      part(rbox(0.036, 0.006, 0.01, 0.003), darkSkin, R.skin, 0.037, 0.139, 0.1, 0, 0, -0.1),
      part(rbox(0.036, 0.006, 0.01, 0.003), darkSkin, R.skin, -0.037, 0.139, 0.1, 0, 0, 0.1),
      // Eyebrows.
      part(rbox(0.043, 0.011, 0.013, 0.005), L.hair, R.hair, 0.039, 0.155, 0.1, 0, 0, -0.12),
      part(rbox(0.043, 0.011, 0.013, 0.005), L.hair, R.hair, -0.039, 0.155, 0.1, 0, 0, 0.12),
      // Upper lip.
      part(rbox(0.044, 0.01, 0.014, 0.005), lip, R.lip, 0, 0.054, 0.1),
    ];
    // Ears keep their outline.
    hp.push(part(sphere(0.03), L.skin, R.skin, 0.104, 0.112, -0.006, 0, 0, 0, 0.42, 1, 0.72));
    hp.push(part(sphere(0.03), L.skin, R.skin, -0.104, 0.112, -0.006, 0, 0, 0, 0.42, 1, 0.72));
    const cap = (r: number, theta: number) => new THREE.SphereGeometry(r, 26, 14, 0, Math.PI * 2, 0, theta);
    const hair = L.hairStyle === 'buzz' ? mix(L.hair, L.skin, 0.32) : L.hair;
    const clump = (x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => part(sphere(r), hair, R.hair, x, y, z, rx, 0, rz, sx, sy, sz);
    if (L.hairStyle !== 'bald' && !L.cap) {
      hp.push(part(cap(0.121, L.hairStyle === 'buzz' ? 1.22 : 1.3), hair, R.hair, 0, 0.122, -0.016, -0.52, 0, 0, 0.95, 1.07, 1.05));
      if (L.hairStyle !== 'buzz') {
        // Sideburns.
        hp.push(part(rbox(0.012, 0.05, 0.028, 0.005), hair, R.hair, 0.099, 0.1, 0.03));
        hp.push(part(rbox(0.012, 0.05, 0.028, 0.005), hair, R.hair, -0.099, 0.1, 0.03));
      }
      switch (L.hairStyle) {
        case 'short':
          for (let i = 0; i < 5; i++) hp.push(clump(-0.06 + i * 0.03, 0.2 - Math.abs(i - 2) * 0.006, 0.082, 0.028, 1.1, 0.7, 0.9));
          break;
        case 'side':
          hp.push(clump(0.03, 0.212, 0.06, 0.055, 1.6, 0.55, 1.2, 0, 0.28));
          hp.push(clump(-0.055, 0.205, 0.045, 0.04, 1.2, 0.6, 1.1, 0, 0.2));
          break;
        case 'quiff':
          hp.push(clump(0, 0.232, 0.06, 0.062, 1.35, 0.85, 1.25, 0.35));
          hp.push(clump(0.04, 0.22, 0.02, 0.045, 1.1, 0.7, 1.2));
          hp.push(clump(-0.04, 0.22, 0.02, 0.045, 1.1, 0.7, 1.2));
          break;
        case 'curly':
          for (let i = 0; i < 22; i++) {
            const a = (i / 22) * Math.PI * 2;
            const ring2 = i % 2 ? 0.07 : 0.05;
            hp.push(clump(Math.sin(a) * ring2 * 1.1, 0.205 + (i % 2) * 0.018, Math.cos(a) * ring2 - 0.012, 0.036));
          }
          hp.push(clump(0, 0.235, -0.01, 0.05, 1.2, 0.7, 1.2));
          break;
        case 'long':
          hp.push(part(rbox(0.215, 0.2, 0.08, 0.035), hair, R.hair, 0, 0.04, -0.075));
          hp.push(part(rbox(0.04, 0.17, 0.06, 0.02), hair, R.hair, 0.1, 0.06, -0.01));
          hp.push(part(rbox(0.04, 0.17, 0.06, 0.02), hair, R.hair, -0.1, 0.06, -0.01));
          hp.push(clump(0.03, 0.208, 0.07, 0.045, 1.5, 0.55, 1.1, 0, 0.3));
          break;
        case 'bun':
          hp.push(clump(0, 0.21, -0.105, 0.045));
          hp.push(part(ring(0.03, 0.008), mix(hair, '#000000', 0.4), R.cloth, 0, 0.2, -0.085, 0.4));
          break;
      }
    }
    if (L.hairStyle === 'bald' && !L.cap) hp.push(part(ring(0.1, 0.019, Math.PI), hair, R.hair, 0, 0.105, -0.012, Math.PI / 2, 0, Math.PI));
    if (L.beard !== 'none') {
      const beard = L.beard === 'stubble' ? mix(L.skin, L.hair, 0.38) : L.hair;
      if (L.beard === 'full' || L.beard === 'stubble') {
        const thick = L.beard === 'full' ? 1.07 : 1.012;
        hp.push(part(new THREE.SphereGeometry(0.096, 26, 12, 0, Math.PI, Math.PI * 0.5, Math.PI * 0.48), beard, R.hair, 0, 0.078, 0.014, 0, 0, 0, 0.94 * thick, 0.94 * thick, thick));
        hp.push(part(sphere(0.046), beard, R.hair, 0, 0.026, 0.07, 0, 0, 0, 1.06 * thick, 0.86 * thick, 0.94 * thick));
      }
      if (L.beard === 'goatee') hp.push(part(sphere(0.03), beard, R.hair, 0, 0.012, 0.086, 0, 0, 0, 1, 1.35, 0.72));
      if (L.beard !== 'stubble') {
        // Mustache: two soft wings.
        hp.push(part(rbox(0.036, 0.013, 0.016, 0.006), beard, R.hair, 0.018, 0.064, 0.107, 0, 0, 0.2));
        hp.push(part(rbox(0.036, 0.013, 0.016, 0.006), beard, R.hair, -0.018, 0.064, 0.107, 0, 0, -0.2));
      }
    }
    if (L.glasses) {
      for (const side of [1, -1]) {
        hp.push(part(ring(0.024, 0.0042), '#1c1c22', R.frame, 0.039 * side, 0.125, 0.118, 0, 0, 0, 1.18, 0.88, 1));
        hp.push(part(rbox(0.004, 0.004, 0.1, 0.0015), '#1c1c22', R.frame, 0.068 * side, 0.128, 0.07));
      }
      hp.push(part(rbox(0.022, 0.004, 0.004, 0.0015), '#1c1c22', R.frame, 0, 0.13, 0.119));
    }
    if (L.cap) {
      const capColor = mix(L.shirt, '#000000', 0.3);
      hp.push(part(cap(0.125, 1.45), capColor, R.cloth, 0, 0.122, -0.004, -0.15, 0, 0, 0.98, 1.0, 1.04));
      hp.push(part(rbox(0.17, 0.014, 0.11, 0.006), mix(capColor, '#000000', 0.2), R.cloth, 0, 0.19, 0.122, 0.18));
      hp.push(part(sphere(0.012), mix(capColor, '#ffffff', 0.3), R.cloth, 0, 0.255, 0));
    }
    this.head.add(segment(hp, 0.0075));
    this.head.add(segment(face, 0, false));
    if (L.glasses) {
      for (const side of [1, -1]) {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.023, 18), LENS);
        lens.scale.set(1.18, 0.88, 1);
        lens.position.set(0.039 * side, 0.125, 0.12);
        this.head.add(lens);
      }
    }

    // Eyes: their own small mesh so they can blink (scale toward the lid line).
    this.eyes.position.set(0, 0.124, 0.099);
    const eyeParts: Part[] = [];
    for (const side of [1, -1]) {
      eyeParts.push(part(sphere(0.0155), '#f5f2ec', R.eye, 0.037 * side, 0, 0, 0, 0, 0, 1.1, 0.86, 0.66));
      eyeParts.push(part(sphere(0.0088), iris, R.eye, 0.037 * side, 0, 0.0085, 0, 0, 0, 1, 1, 0.45));
      eyeParts.push(part(sphere(0.0047), '#0d0b0a', R.eye, 0.037 * side, 0, 0.0115, 0, 0, 0, 1, 1, 0.45));
      eyeParts.push(part(sphere(0.0018), '#ffffff', R.eye, 0.037 * side + 0.004, 0.004, 0.0128));
    }
    this.eyes.add(segment(eyeParts, 0, false));
    this.head.add(this.eyes);

    // Mouth: a dark opening behind the lips and a lower lip on the jaw, both animated while talking.
    this.mouth.position.set(0, 0.046, 0.098);
    this.mouth.add(segment([part(sphere(0.017), '#3a1414', R.mouth, 0, 0, -0.002, 0, 0, 0, 1.35, 1, 0.5), part(rbox(0.026, 0.006, 0.006, 0.002), '#f2efe8', R.eye, 0, 0.006, 0.003)], 0, false));
    this.mouth.scale.y = 0.15;
    this.head.add(this.mouth);
    this.jaw.position.set(0, 0.038, 0.098);
    this.jaw.add(segment([part(rbox(0.04, 0.011, 0.014, 0.005), mix(lip, '#ffffff', 0.08), R.lip, 0, 0, 0.002)], 0, false));
    this.head.add(this.jaw);
    this.torso.add(this.head);

    // ---------------------------------------------------------------- arms and hands
    const sleeveLong = L.top !== 'tee';
    for (const [arm, elbow, side] of [
      [this.armL, this.elbowL, 1],
      [this.armR, this.elbowR, -1],
    ] as const) {
      arm.position.set(0.205 * side * w, 0.465, 0);
      // Yaw last: the arm is tilted out and raised first, then swung around the shoulder.
      arm.rotation.order = 'YXZ';
      const upper: Part[] = [part(sphere(0.054), L.shirt, R.cloth, 0, -0.01, 0), part(limb(0.054, 0.044, 0.28), sleeveLong ? L.shirt : L.skin, sleeveLong ? R.cloth : R.skin)];
      if (!sleeveLong) {
        // Tee sleeve over the top of the arm.
        upper.push(part(limb(0.058, 0.054, 0.13), L.shirt, R.cloth));
        upper.push(part(limb(0.0545, 0.0545, 0.012), hem, R.cloth, 0, -0.124, 0));
      }
      arm.add(segment(upper));
      elbow.position.set(0, -0.28, 0);
      const fore: Part[] = [
        part(sphere(0.045), sleeveLong ? L.shirt : L.skin, sleeveLong ? R.cloth : R.skin, 0, 0, 0),
        part(limb(0.045, 0.034, 0.22), sleeveLong ? L.shirt : L.skin, sleeveLong ? R.cloth : R.skin, 0, 0, 0, 0, 0, 0, 1, 1, 0.92),
        part(limb(0.033, 0.03, 0.03), L.skin, R.skin, 0, -0.215, 0),
      ];
      if (sleeveLong) fore.push(part(limb(0.039, 0.039, 0.028), L.tie ? '#f4f2ec' : hem, R.cloth, 0, -0.2, 0));
      // Hand: palm facing the body, four fingers and a thumb.
      const hx = 0;
      const hy = -0.245;
      fore.push(part(rbox(0.03, 0.075, 0.07, 0.013), L.skin, R.skin, hx, hy - 0.035, 0.006));
      const fingers: Array<[number, number]> = [
        [0.026, 0.04],
        [0.009, 0.046],
        [-0.009, 0.044],
        [-0.025, 0.036],
      ];
      for (const [fz, len] of fingers) fore.push(part(capsule(0.0085, len, 8), L.skin, R.skin, hx - 0.002 * side, hy - 0.072 - len / 2, fz + 0.006, 0.18, 0, 0));
      fore.push(part(capsule(0.0095, 0.034, 8), L.skin, R.skin, hx + 0.012 * side, hy - 0.035, 0.05, 0.75, 0, 0.35 * side));
      fore.push(part(sphere(0.012), darkSkin, R.skin, hx - 0.014 * side, hy - 0.03, 0.006, 0, 0, 0, 0.5, 1.4, 1.6));
      elbow.add(segment(fore));
      arm.add(elbow);
      this.torso.add(arm);
    }

    // Props held in the right hand.
    const hand = new THREE.Group();
    hand.position.set(0, -0.29, 0.03);
    this.elbowR.add(hand);
    const cup = new THREE.Group();
    cup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.1, 16), CUP));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI), CUP);
    handle.position.set(0.04, 0, 0);
    handle.rotation.z = -Math.PI / 2;
    cup.add(handle);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.034, 16), COFFEE);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.045;
    cup.add(coffee);
    cup.position.set(0, -0.02, 0.04);
    const phone = new THREE.Group();
    phone.add(new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.15, 0.01, 2, 0.004), PHONE));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.135), PHONE_SCREEN);
    screen.position.z = 0.006;
    phone.add(screen);
    phone.position.set(0, -0.01, 0.03);
    phone.rotation.x = -0.4;
    const paddle = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 18), PADDLE);
    blade.rotation.x = Math.PI / 2;
    blade.position.y = -0.12;
    paddle.add(blade, new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.02), CUP));
    for (const p of [cup, phone, paddle]) {
      p.visible = false;
      p.traverse((o) => (o.castShadow = true));
      hand.add(p);
    }
    this.props = { cup, phone, paddle };

    this.hips.add(this.torso);
    this.body.add(this.hips);
    this.body.scale.setScalar(look.height);
    this.root.add(this.body);

    // Invisible capsule for picking.
    this.hit = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 2, 8), HIT);
    this.hit.position.y = 0.9;
    this.root.add(this.hit);
    this.apply();
  }

  /** Hides the head (first-person view, so the camera does not look out from inside it). */
  setHeadVisible(on: boolean) {
    this.head.visible = on;
  }

  setProp(prop: Prop) {
    for (const [name, obj] of Object.entries(this.props)) obj.visible = name === prop;
  }

  /** Eases the joints toward a target pose. */
  blend(target: Joints, dt: number, rate = 9) {
    const k = 1 - Math.exp(-rate * dt);
    const j = this.joints as unknown as Record<string, number>;
    const t = target as unknown as Record<string, number>;
    for (const key of Object.keys(t)) j[key] += (t[key] - j[key]) * k;
    this.apply();
  }

  /** Turns the head toward someone, on top of the pose (radians; eased). */
  look(yaw: number, pitch: number, dt: number) {
    const k = 1 - Math.exp(-dt * 5);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
  }

  /**
   * Blinks now and then, and moves the mouth while talking. `talk` is 0 (quiet) to 1 (speaking);
   * `t` is a time in seconds, offset per character.
   */
  animateFace(dt: number, t: number, talk: number) {
    // Blink: a quick close and open every few seconds, sometimes twice.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.nextBlink = 2.2 + Math.random() * 4.5;
      if (Math.random() < 0.15) this.nextBlink = 0.35;
    }
    let lid = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const p = this.blinkT / 0.16;
      lid = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
      if (p >= 1) {
        this.blinkT = -1;
        lid = 1;
      }
    }
    this.eyes.scale.y = Math.max(0.06, lid);
    // Mouth: syllable-like openings while talking.
    const target = talk > 0 ? talk * (0.35 + 0.65 * Math.abs(Math.sin(t * 13) * Math.sin(t * 7.3 + 1.1))) : 0;
    this.mouthOpen += (target - this.mouthOpen) * (1 - Math.exp(-dt * 22));
    this.mouth.scale.y = 0.15 + this.mouthOpen * 0.95;
    this.jaw.position.y = 0.038 - this.mouthOpen * 0.011;
  }

  private apply() {
    const j = this.joints;
    this.hips.position.y = j.hipsY;
    this.hips.rotation.x = j.hipsRx;
    this.torso.rotation.set(j.torsoRx, j.torsoRy, 0);
    this.head.rotation.set(j.headRx + this.lookPitch, j.headRy + this.lookYaw, 0);
    this.armL.rotation.set(j.armLx, j.armLy, j.armLz);
    this.elbowL.rotation.x = j.elbowL;
    this.armR.rotation.set(j.armRx, j.armRy, j.armRz);
    this.elbowR.rotation.x = j.elbowR;
    this.thighL.rotation.x = j.thighL;
    this.kneeL.rotation.x = j.kneeL;
    this.thighR.rotation.x = j.thighR;
    this.kneeR.rotation.x = j.kneeR;
  }

  /** Height of the top of the head above the root (for labels). */
  get topY(): number {
    return (this.joints.hipsY + 0.05 + 0.6 + 0.25) * this.height;
  }

  dispose() {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}
