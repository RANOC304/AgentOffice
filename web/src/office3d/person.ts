// Procedural 3D man with a joint hierarchy (hips, torso, head, arms, legs) so he can walk, sit,
// type, drink, wave and talk. Each rigid segment is one vertex-coloured mesh plus a dark outline
// shell, which keeps characters crisp against the softer office.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Look } from './look.ts';

const BODY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.03 });
const OUTLINE = new THREE.MeshBasicMaterial({ color: '#17131f', side: THREE.BackSide });
const HIT = new THREE.MeshBasicMaterial({ visible: false });
const CUP = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.35 });
const COFFEE = new THREE.MeshStandardMaterial({ color: '#4a2c1a', roughness: 0.3 });
const PHONE = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.3, metalness: 0.4 });
const PHONE_SCREEN = new THREE.MeshStandardMaterial({ color: '#5aa9ff', emissive: '#5aa9ff', emissiveIntensity: 0.9 });
const PADDLE = new THREE.MeshStandardMaterial({ color: '#c8473b', roughness: 0.5 });

interface Part {
  geo: THREE.BufferGeometry;
  color: string;
}

const m4 = new THREE.Matrix4();
const qt = new THREE.Quaternion();
const eu = new THREE.Euler();

function part(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Part {
  eu.set(rx, ry, rz);
  qt.setFromEuler(eu);
  m4.compose(new THREE.Vector3(x, y, z), qt, new THREE.Vector3(sx, sy, sz));
  const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m4);
  if (g !== geo) geo.dispose();
  return { geo: g, color };
}

const sphere = (r: number, w = 18, h = 12) => new THREE.SphereGeometry(r, w, h);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14);

function segment(parts: Part[], outline = 0.011): THREE.Group {
  const geos = parts.map(({ geo, color }) => {
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  });
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(merged, BODY);
  mesh.castShadow = true;
  const shell = merged.clone();
  shell.deleteAttribute('color');
  const pos = shell.getAttribute('position');
  const nor = shell.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * outline, pos.getY(i) + nor.getY(i) * outline, pos.getZ(i) + nor.getZ(i) * outline);
  const out = new THREE.Mesh(shell, OUTLINE);
  group.add(mesh, out);
  return group;
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

export interface Joints {
  hipsY: number;
  hipsRx: number;
  torsoRx: number;
  torsoRy: number;
  headRx: number;
  headRy: number;
  armLx: number;
  armLz: number;
  elbowL: number;
  armRx: number;
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
  armLz: 0.07,
  elbowL: -0.12,
  armRx: 0,
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
  private props: Record<'cup' | 'phone' | 'paddle', THREE.Object3D>;
  readonly joints: Joints = { ...STAND };
  readonly height: number;

  constructor(look: Look) {
    this.height = look.height;
    const L = look;
    const w = L.build;
    const sleeveLong = L.top !== 'tee';
    const darkSkin = mix(L.skin, '#5a3020', 0.25);

    // Hips and legs.
    this.hips.add(
      segment([
        part(new RoundedBoxGeometry(0.31 * w, 0.2, 0.21, 2, 0.06), L.pants, 0, -0.02, 0),
        part(new THREE.BoxGeometry(0.315 * w, 0.035, 0.215), '#2a2420', 0, 0.075, 0),
        part(new THREE.BoxGeometry(0.04, 0.03, 0.012), '#b8a46a', 0, 0.075, 0.108),
      ]),
    );
    for (const [thigh, knee, side] of [
      [this.thighL, this.kneeL, 1],
      [this.thighR, this.kneeR, -1],
    ] as const) {
      thigh.position.set(0.09 * side * w, -0.03, 0);
      thigh.add(segment([part(capsule(0.072, 0.3), L.pants, 0, -0.21, 0)]));
      knee.position.set(0, -0.43, 0);
      knee.add(
        segment([
          part(capsule(0.057, 0.3), L.pants, 0, -0.2, 0),
          part(new RoundedBoxGeometry(0.11, 0.075, 0.27, 2, 0.03), L.shoes, 0, -0.43, 0.045),
          part(new THREE.BoxGeometry(0.112, 0.018, 0.272), mix(L.shoes, '#ffffff', 0.5), 0, -0.462, 0.045),
        ]),
      );
      thigh.add(knee);
      this.hips.add(thigh);
    }

    // Torso, neck, clothes details.
    this.torso.position.set(0, 0.05, 0);
    const torsoParts: Part[] = [
      part(capsule(0.16, 0.21), L.shirt, 0, 0.27, 0, 0, 0, 0, 1.18 * w, 1, 0.74),
      part(sphere(0.078), L.shirt, 0.198 * w, 0.46, 0),
      part(sphere(0.078), L.shirt, -0.198 * w, 0.46, 0),
      part(new THREE.CylinderGeometry(0.052, 0.056, 0.12, 14), L.skin, 0, 0.57, 0),
    ];
    if (L.top === 'shirt') {
      torsoParts.push(part(new THREE.TorusGeometry(0.062, 0.017, 6, 18), mix(L.shirt, '#ffffff', 0.55), 0, 0.53, 0.005, Math.PI / 2 - 0.15));
      for (let i = 0; i < 4; i++) torsoParts.push(part(sphere(0.008, 6, 4), mix(L.shirt, '#ffffff', 0.7), 0, 0.42 - i * 0.09, 0.122));
    } else if (L.top === 'hoodie') {
      torsoParts.push(part(sphere(0.12), mix(L.shirt, '#000000', 0.15), 0, 0.52, -0.1, 0, 0, 0, 1.35, 0.62, 0.75));
      torsoParts.push(part(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 5), '#f2f0ea', 0.04, 0.42, 0.12));
      torsoParts.push(part(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 5), '#f2f0ea', -0.04, 0.42, 0.12));
      torsoParts.push(part(new RoundedBoxGeometry(0.2, 0.08, 0.04, 2, 0.015), mix(L.shirt, '#000000', 0.12), 0, 0.16, 0.115));
    } else if (L.top === 'sweater') {
      torsoParts.push(part(new THREE.TorusGeometry(0.06, 0.02, 6, 18), mix(L.shirt, '#000000', 0.18), 0, 0.535, 0, Math.PI / 2));
      torsoParts.push(part(new THREE.TorusGeometry(0.17, 0.018, 6, 22), mix(L.shirt, '#000000', 0.15), 0, 0.03, 0, Math.PI / 2, 0, 0, 1.18 * w, 1, 0.74));
    } else {
      torsoParts.push(part(new THREE.TorusGeometry(0.058, 0.012, 6, 18), mix(L.shirt, '#000000', 0.2), 0, 0.535, 0.01, Math.PI / 2 - 0.1));
    }
    if (L.tie) {
      torsoParts.push(part(new RoundedBoxGeometry(0.05, 0.042, 0.024, 2, 0.01), L.tie, 0, 0.5, 0.118));
      torsoParts.push(part(new THREE.BoxGeometry(0.052, 0.27, 0.014), L.tie, 0, 0.34, 0.13, 0, 0, 0, 1, 1, 1));
      torsoParts.push(part(new THREE.ConeGeometry(0.037, 0.05, 4), L.tie, 0, 0.19, 0.13, Math.PI, Math.PI / 4, 0, 1, 1, 0.4));
    }
    if (L.badge) {
      torsoParts.push(part(new THREE.BoxGeometry(0.012, 0.22, 0.008), '#f2f0ea', 0.04, 0.41, 0.123, 0, 0, -0.2));
      torsoParts.push(part(new THREE.BoxGeometry(0.012, 0.22, 0.008), '#f2f0ea', -0.04, 0.41, 0.123, 0, 0, 0.2));
      torsoParts.push(part(new RoundedBoxGeometry(0.075, 0.1, 0.012, 2, 0.006), '#ffffff', 0, 0.27, 0.126));
    }
    this.torso.add(segment(torsoParts));

    // Head.
    this.head.position.set(0, 0.6, 0);
    const hp: Part[] = [
      part(sphere(0.112, 24, 16), L.skin, 0, 0.11, 0, 0, 0, 0, 0.92, 1.1, 1.0),
      part(sphere(0.085), L.skin, 0, 0.04, 0.018, 0, 0, 0, 0.95, 0.82, 0.95),
      part(sphere(0.028), L.skin, 0.102, 0.105, -0.005, 0, 0, 0, 0.55, 1, 0.9),
      part(sphere(0.028), L.skin, -0.102, 0.105, -0.005, 0, 0, 0, 0.55, 1, 0.9),
      part(sphere(0.021), mix(L.skin, '#8a4a30', 0.08), 0, 0.093, 0.107, 0, 0, 0, 0.85, 1.1, 1.3),
      part(sphere(0.017, 10, 8), '#f7f4ee', 0.038, 0.128, 0.093),
      part(sphere(0.017, 10, 8), '#f7f4ee', -0.038, 0.128, 0.093),
      part(sphere(0.0105, 10, 8), '#221a14', 0.038, 0.128, 0.105),
      part(sphere(0.0105, 10, 8), '#221a14', -0.038, 0.128, 0.105),
      part(new THREE.BoxGeometry(0.042, 0.011, 0.012), L.hair, 0.04, 0.157, 0.103, 0, 0, -0.08),
      part(new THREE.BoxGeometry(0.042, 0.011, 0.012), L.hair, -0.04, 0.157, 0.103, 0, 0, 0.08),
      part(new THREE.BoxGeometry(0.038, 0.008, 0.01), '#9c4d42', 0, 0.052, 0.098),
    ];
    const cap = (r: number, theta: number) => new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, theta);
    const hair = L.hairStyle === 'buzz' ? mix(L.hair, L.skin, 0.3) : L.hair;
    if (L.hairStyle !== 'bald' && !L.cap) {
      hp.push(part(cap(0.122, L.hairStyle === 'buzz' ? 1.25 : 1.32), hair, 0, 0.112, -0.012, -0.5, 0, 0, 0.96, 1.08, 1.04));
      if (L.hairStyle === 'side') hp.push(part(sphere(0.05), hair, 0.045, 0.214, 0.05, 0, 0, 0.3, 1.5, 0.55, 1.3));
      if (L.hairStyle === 'quiff') hp.push(part(sphere(0.06), hair, 0, 0.228, 0.06, 0.3, 0, 0, 1.35, 0.8, 1.2));
      if (L.hairStyle === 'curly') for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        hp.push(part(sphere(0.042, 10, 8), hair, Math.sin(a) * 0.075, 0.2 + Math.cos(a * 2) * 0.012, Math.cos(a) * 0.07 - 0.01));
      }
      if (L.hairStyle === 'long') hp.push(part(new RoundedBoxGeometry(0.21, 0.17, 0.07, 2, 0.03), hair, 0, 0.05, -0.08));
      if (L.hairStyle === 'bun') hp.push(part(sphere(0.045), hair, 0, 0.2, -0.105));
    }
    if (L.hairStyle === 'bald' && !L.cap) hp.push(part(new THREE.TorusGeometry(0.1, 0.018, 6, 20, Math.PI), hair, 0, 0.1, -0.01, Math.PI / 2, 0, Math.PI));
    if (L.beard === 'full' || L.beard === 'stubble') {
      const beard = L.beard === 'full' ? L.hair : mix(L.skin, L.hair, 0.42);
      hp.push(part(new THREE.SphereGeometry(0.099, 22, 10, 0, Math.PI, Math.PI * 0.52, Math.PI * 0.45), beard, 0, 0.083, 0.012, 0, 0, 0, 0.98, 1.08, L.beard === 'full' ? 1.08 : 1.0));
      if (L.beard === 'full') hp.push(part(new THREE.BoxGeometry(0.07, 0.016, 0.02), beard, 0, 0.068, 0.103));
    }
    if (L.beard === 'goatee') hp.push(part(sphere(0.03), L.hair, 0, 0.012, 0.085, 0, 0, 0, 1, 1.35, 0.7));
    if (L.beard === 'goatee' || L.beard === 'mustache') hp.push(part(new THREE.BoxGeometry(0.065, 0.014, 0.016), L.hair, 0, 0.068, 0.104));
    if (L.glasses) {
      for (const side of [1, -1]) {
        hp.push(part(new THREE.TorusGeometry(0.025, 0.0045, 6, 16), '#1c1c22', 0.039 * side, 0.128, 0.113));
        hp.push(part(new THREE.BoxGeometry(0.004, 0.004, 0.1), '#1c1c22', 0.064 * side, 0.13, 0.065));
      }
      hp.push(part(new THREE.BoxGeometry(0.022, 0.004, 0.004), '#1c1c22', 0, 0.13, 0.114));
    }
    if (L.cap) {
      const capColor = mix(L.shirt, '#000000', 0.3);
      hp.push(part(cap(0.125, 1.45), capColor, 0, 0.112, -0.004, -0.15, 0, 0, 0.98, 1.0, 1.04));
      hp.push(part(new RoundedBoxGeometry(0.17, 0.014, 0.11, 2, 0.006), mix(capColor, '#000000', 0.2), 0, 0.18, 0.12, 0.18));
      hp.push(part(sphere(0.012, 8, 6), mix(capColor, '#ffffff', 0.3), 0, 0.245, 0));
    }
    this.head.add(segment(hp));
    this.torso.add(this.head);

    // Arms.
    for (const [arm, elbow, side] of [
      [this.armL, this.elbowL, 1],
      [this.armR, this.elbowR, -1],
    ] as const) {
      arm.position.set(0.205 * side * w, 0.465, 0);
      arm.add(segment([part(capsule(0.047, 0.2), L.shirt, 0, -0.14, 0)]));
      elbow.position.set(0, -0.28, 0);
      elbow.add(
        segment([
          part(capsule(0.041, 0.19), sleeveLong ? L.shirt : L.skin, 0, -0.12, 0),
          ...(sleeveLong ? [part(new THREE.CylinderGeometry(0.043, 0.043, 0.03, 12), mix(L.shirt, '#000000', 0.15), 0, -0.225, 0)] : []),
          part(sphere(0.046), L.skin, 0, -0.27, 0.005, 0, 0, 0, 0.72, 1.05, 0.55),
          part(sphere(0.02), darkSkin, 0.03 * side, -0.25, 0.02),
        ]),
      );
      arm.add(elbow);
      this.torso.add(arm);
    }

    // Props held in the right hand.
    const hand = new THREE.Group();
    hand.position.set(0, -0.29, 0.03);
    this.elbowR.add(hand);
    const cup = new THREE.Group();
    cup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.1, 16), CUP));
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.034, 16), COFFEE);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.045;
    cup.add(coffee);
    cup.position.set(0, -0.02, 0.04);
    const phone = new THREE.Group();
    phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.01), PHONE));
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

  private apply() {
    const j = this.joints;
    this.hips.position.y = j.hipsY;
    this.hips.rotation.x = j.hipsRx;
    this.torso.rotation.set(j.torsoRx, j.torsoRy, 0);
    this.head.rotation.set(j.headRx, j.headRy, 0);
    this.armL.rotation.set(j.armLx, 0, j.armLz);
    this.elbowL.rotation.x = j.elbowL;
    this.armR.rotation.set(j.armRx, 0, j.armRz);
    this.elbowR.rotation.x = j.elbowR;
    this.thighL.rotation.x = j.thighL;
    this.kneeL.rotation.x = j.kneeL;
    this.thighR.rotation.x = j.thighR;
    this.kneeR.rotation.x = j.kneeR;
  }

  /** Height of the top of the head above the root (for labels). */
  get topY(): number {
    return (this.joints.hipsY + 0.05 + 0.6 + 0.24) * this.height;
  }

  dispose() {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}
