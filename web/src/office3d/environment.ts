// The floating island, garden, waterfall, clouds, sky dome, floors and walls.

import * as THREE from 'three';
import { Batch, Builder } from './furniture.ts';
import { D, ELEVATOR, type Layout, W } from './layout.ts';
import {
  carpetTexture,
  concreteTexture,
  glassMat,
  grassTexture,
  mat,
  plasterTexture,
  shade,
  softDot,
  terrazzoTexture,
  texturedMat,
  tileTexture,
  woodTexture,
} from './materials.ts';

export const ISLAND_TOP = -0.15;
const CX = W / 2;
const CZ = D / 2;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Island outline radius at angle a (superellipse around the building plus a garden margin). */
function outline(a: number): number {
  const hx = W / 2 + 6.5;
  const hz = D / 2 + 6.0;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const n = 4;
  const r = 1 / Math.pow(Math.pow(c / hx, n) + Math.pow(s / hz, n), 1 / n);
  return r * (1 + 0.035 * Math.sin(a * 5 + 1) + 0.025 * Math.sin(a * 11 + 2));
}

export function insideIsland(x: number, z: number, margin = 0): boolean {
  const a = Math.atan2(z - CZ, x - CX);
  return Math.hypot(x - CX, z - CZ) < outline(a) - margin;
}

export interface Environment {
  group: THREE.Group;
  sky: THREE.Mesh;
  update(t: number): void;
  setSky(top: string, horizon: string, bottom: string): void;
  lamps: THREE.Mesh[];
}

export function buildEnvironment(layout: Layout): Environment {
  const group = new THREE.Group();
  const batch = new Batch();
  group.add(buildIsland());

  // ---- grass top
  const shape = new THREE.Shape();
  const N = 128;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = outline(a);
    const x = CX + Math.cos(a) * r;
    const z = CZ + Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  const top = new THREE.ShapeGeometry(shape, 8);
  top.rotateX(-Math.PI / 2);
  top.translate(0, ISLAND_TOP, 0);
  const uv = top.getAttribute('uv');
  const pos = top.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6);
  const grass = new THREE.Mesh(top, texturedMat('grass', () => grassTexture(), { roughness: 0.95 }));
  grass.receiveShadow = true;
  group.add(grass);

  // ---- building slab and floors
  const plinth = new Builder(batch, CX, CZ, 0);
  plinth.box(W + 0.8, 0.35, D + 0.8, 0, -0.175, 0, mat('#cfc9bd', { roughness: 0.9 }));
  plinth.box(W + 1.0, 0.06, D + 1.0, 0, -0.33, 0, mat('#a39e94', { roughness: 0.9 }));
  for (const zone of layout.zones.values()) {
    const def = zone.def;
    const w = zone.x1 - zone.x0;
    const key = `${def.floor}:${def.floorColor}`;
    const material = texturedMat(
      key,
      () =>
        def.floor === 'wood'
          ? woodTexture(def.floorColor, w * 3)
          : def.floor === 'carpet'
            ? carpetTexture(def.floorColor)
            : def.floor === 'concrete'
              ? concreteTexture(def.floorColor)
              : def.floor === 'terrazzo'
                ? terrazzoTexture(def.floorColor)
                : tileTexture(def.floorColor),
      { roughness: def.floor === 'terrazzo' ? 0.35 : def.floor === 'wood' ? 0.6 : 0.95 },
    );
    const tileSize = def.floor === 'wood' ? 2.2 : def.floor === 'carpet' ? 1 : 3;
    const pieces: Array<[number, number, number, number]> = [];
    if (def.id === 'atrium') {
      const e = ELEVATOR;
      const hx = e.size / 2;
      pieces.push([zone.x0, zone.z0, zone.x1, e.z - hx]);
      pieces.push([zone.x0, e.z + hx, zone.x1, zone.z1]);
      pieces.push([zone.x0, e.z - hx, e.x - hx, e.z + hx]);
      pieces.push([e.x + hx, e.z - hx, zone.x1, e.z + hx]);
    } else pieces.push([zone.x0, zone.z0, zone.x1, zone.z1]);
    for (const [x0, z0, x1, z1] of pieces) {
      const g = new THREE.BoxGeometry(x1 - x0, 0.02, z1 - z0);
      const u = g.getAttribute('uv');
      const p = g.getAttribute('position');
      for (let i = 0; i < u.count; i++) u.setXY(i, (p.getX(i) + (x0 + x1) / 2) / tileSize, (p.getZ(i) + (z0 + z1) / 2) / tileSize);
      const mesh = new THREE.Mesh(g, material);
      mesh.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (def.id === 'atrium') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.25, 48), mat('#b49a74', { roughness: 0.4 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(ELEVATOR.x, 0.022, ELEVATOR.z);
      ring.receiveShadow = true;
      group.add(ring);
    }
    // Area rugs in lounges.
    if (def.kind === 'cafe' || def.kind === 'chill' || def.id === 'research' || def.id === 'design') {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(def.kind === 'chill' ? 4.2 : 3.2, 2.2), mat(shade(def.accent, 0.18), { roughness: 1 }));
      rug.rotation.x = -Math.PI / 2;
      const rx = def.kind === 'cafe' ? zone.x0 + 5.0 : zone.x0 + 3.5;
      const rz = def.kind === 'cafe' ? zone.z0 + 3.4 : def.kind === 'chill' ? zone.z0 + 3.0 : zone.z0 + 5.4;
      rug.position.set(rx, 0.025, rz);
      rug.receiveShadow = true;
      group.add(rug);
    }
  }

  // ---- walls
  const plaster = texturedMat('plaster', () => plasterTexture('#efe9df'), { roughness: 0.92 });
  const trim = mat('#d9d2c6', { roughness: 0.6 });
  const frame = mat('#3a3f48', { roughness: 0.4, metalness: 0.6 });
  const glass = glassMat();
  const H = 3.4;
  const T = 0.25;
  const wallPiece = (a: number, b: number, y0: number, y1: number, axis: 'x' | 'z') => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const len = b - a;
    const bld = axis === 'x' ? new Builder(batch, (a + b) / 2, -T / 2, 0) : new Builder(batch, -T / 2, (a + b) / 2, Math.PI / 2);
    bld.box(len, y1 - y0, T, 0, (y0 + y1) / 2, 0, plaster);
  };
  for (const axis of ['x', 'z'] as const) {
    const length = axis === 'x' ? W : D;
    const wins = layout.windows.filter((w) => w.axis === axis).map((w) => (axis === 'x' ? w.x : w.z)).sort((p, q) => p - q);
    let cursor = axis === 'x' ? -T : 0;
    for (const c of wins) {
      const a = c - 1.1;
      const b = c + 1.1;
      wallPiece(cursor, a, 0, H, axis);
      wallPiece(a, b, 0, 0.85, axis);
      wallPiece(a, b, 2.55, H, axis);
      const bld = axis === 'x' ? new Builder(batch, c, -T / 2, 0) : new Builder(batch, -T / 2, c, Math.PI / 2);
      bld.box(2.2, 1.7, 0.03, 0, 1.7, 0, glass);
      bld.box(2.24, 0.06, 0.12, 0, 0.88, 0.05, trim);
      bld.box(2.2, 0.05, 0.06, 0, 2.52, 0.02, frame);
      bld.box(0.05, 1.7, 0.06, 0, 1.7, 0.02, frame);
      for (const side of [-1.08, 1.08]) bld.box(0.05, 1.7, 0.06, side, 1.7, 0.02, frame);
      cursor = b;
    }
    wallPiece(cursor, length, 0, H, axis);
    // Skirting and top cap.
    const len = length + T;
    const bld = axis === 'x' ? new Builder(batch, length / 2 - T / 2, -T / 2, 0) : new Builder(batch, -T / 2, length / 2, Math.PI / 2);
    bld.box(len, 0.1, 0.02, 0, 0.05, T / 2 + 0.01, mat('#6b6257', { roughness: 0.7 }));
    bld.box(len + 0.05, 0.08, T + 0.08, 0, H + 0.04, 0, trim);
  }
  // Low partitions with glass above, and the glass balustrade around the open sides.
  for (const s of layout.walls) {
    if (s.kind === 'back') continue;
    const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    const along = s.x1 === s.x2 ? Math.PI / 2 : 0;
    const bld = new Builder(batch, (s.x1 + s.x2) / 2, (s.z1 + s.z2) / 2, along);
    if (s.kind === 'partition') {
      bld.box(len, 0.95, 0.12, 0, 0.475, 0, mat('#e7e1d6', { roughness: 0.85 }));
      bld.box(len, 0.04, 0.16, 0, 0.97, 0, mat('#c4b8a6', { roughness: 0.5 }));
      bld.box(len, 1.35, 0.02, 0, 1.67, 0, glass);
      bld.box(len, 0.04, 0.06, 0, 2.36, 0, frame);
      const posts = Math.max(1, Math.round(len / 1.7));
      for (let i = 0; i <= posts; i++) bld.box(0.04, 1.4, 0.05, -len / 2 + (i * len) / posts, 1.66, 0, frame);
    } else {
      bld.box(len, 1.05, 0.02, 0, 0.55, 0, glass);
      bld.cyl(0.025, 0.025, len, 0, 1.08, 0, mat('#b9bec6', { roughness: 0.25, metalness: 0.8 }), 10, 0, Math.PI / 2);
      const posts = Math.max(1, Math.round(len / 2));
      for (let i = 0; i <= posts; i++) bld.box(0.04, 1.06, 0.04, -len / 2 + (i * len) / posts, 0.53, 0, frame);
    }
  }

  // ---- garden: trees, bushes, rocks, flowers, lamps, benches, pond
  const r = rng(1234);
  const lamps: THREE.Mesh[] = [];
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < 260 && spots.length < 46; i++) {
    const a = r() * Math.PI * 2;
    const rad = outline(a) - 1.2 - r() * 4.5;
    const x = CX + Math.cos(a) * rad;
    const z = CZ + Math.sin(a) * rad;
    if (x > -1.2 && x < W + 1.2 && z > -1.2 && z < D + 1.2) continue;
    if (Math.hypot(x - (W + 3.6), z - 7.5) < 3.2) continue;
    if (spots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 2.2)) continue;
    spots.push([x, z]);
  }
  for (const [i, [x, z]] of spots.entries()) {
    const front = z > D + 0.5 || x > W + 0.5;
    const kind = front ? (i % 2 === 0 ? 2 : 4) : i % 5;
    const b = new Builder(batch, x, z, r() * Math.PI, ISLAND_TOP);
    const leaf = ['#4d8a49', '#5b9a52', '#3f7a4a', '#6aa35a', '#7aa84f'];
    if (kind === 0 || kind === 3) {
      const h = 1.8 + r() * 1.2;
      b.cyl(0.11, 0.17, h, 0, h / 2, 0, mat('#6e4f37', { roughness: 0.9 }), 8);
      for (let k = 0; k < 6; k++) {
        b.sphere(0.7 + r() * 0.45, (r() - 0.5) * 1.1, h + 0.2 + r() * 1.0, (r() - 0.5) * 1.1, mat(leaf[Math.floor(r() * 5)], { roughness: 0.85 }), 1, 0.85, 1, 1);
      }
    } else if (kind === 1) {
      const h = 3.4 + r() * 2;
      b.cyl(0.1, 0.16, h * 0.4, 0, h * 0.2, 0, mat('#5f4430'), 8);
      for (let k = 0; k < 4; k++) b.cone(1.2 - k * 0.24, 1.5, 0, h * 0.25 + k * 1.05, 0, mat(['#2f6b45', '#356f48', '#3c7a4e'][k % 3], { roughness: 0.85 }), 9);
    } else if (kind === 2) {
      for (let k = 0; k < 3; k++) b.sphere(0.45 + r() * 0.3, (r() - 0.5) * 0.9, 0.35, (r() - 0.5) * 0.9, mat(leaf[Math.floor(r() * 5)]), 1, 0.75, 1, 1);
      if (r() > 0.5) for (let k = 0; k < 5; k++) b.smooth(0.06, (r() - 0.5) * 1, 0.6 + r() * 0.2, (r() - 0.5) * 1, mat(['#f08cae', '#fff3b0', '#ffffff', '#c9a0f0'][k % 4]));
    } else {
      b.rock(0.5 + r() * 0.5, 0, 0.2, 0, mat('#8d877d', { roughness: 0.95 }), 1.3, 0.7, 1);
      if (r() > 0.5) b.rock(0.3, 0.7, 0.12, 0.3, mat('#a19b90', { roughness: 0.95 }), 1, 0.6, 1);
    }
  }
  // Flower patches (instanced).
  const flowerGeo = new THREE.IcosahedronGeometry(0.06, 0);
  const colors = ['#f2a3c0', '#fff1a8', '#ffffff', '#c9a7f2', '#ff9b7a'];
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), 700);
  const dummy = new THREE.Object3D();
  let fi = 0;
  for (let p = 0; p < 30 && fi < 700; p++) {
    const a = r() * Math.PI * 2;
    const rad = outline(a) - 1 - r() * 5;
    const px = CX + Math.cos(a) * rad;
    const pz = CZ + Math.sin(a) * rad;
    if (px > -0.8 && px < W + 0.8 && pz > -0.8 && pz < D + 0.8) continue;
    const color = new THREE.Color(colors[p % colors.length]);
    for (let k = 0; k < 24 && fi < 700; k++) {
      dummy.position.set(px + (r() - 0.5) * 2, ISLAND_TOP + 0.06, pz + (r() - 0.5) * 2);
      dummy.scale.setScalar(0.7 + r() * 0.6);
      dummy.updateMatrix();
      flowers.setMatrixAt(fi, dummy.matrix);
      flowers.setColorAt(fi, color);
      fi++;
    }
  }
  flowers.count = fi;
  group.add(flowers);
  // Lamp posts and benches along the front lawn.
  for (const [k, x] of [4, 12, 23, 31].entries()) {
    const b = new Builder(batch, x, D + 2.4, 0, ISLAND_TOP);
    b.cyl(0.05, 0.07, 2.6, 0, 1.3, 0, mat('#2f343c', { metalness: 0.6, roughness: 0.4 }), 10);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffd89a', emissiveIntensity: 0.2 }));
    lamp.position.set(x, ISLAND_TOP + 2.75, D + 2.4);
    group.add(lamp);
    lamps.push(lamp);
    if (k % 2 === 0) {
      const bench = new Builder(batch, x + 2.2, D + 2.6, Math.PI, ISLAND_TOP);
      for (let i = 0; i < 3; i++) bench.box(1.6, 0.04, 0.12, 0, 0.45, -0.15 + i * 0.14, mat('#a57f5c'));
      bench.box(1.6, 0.35, 0.05, 0, 0.7, -0.25, mat('#a57f5c'));
      for (const sx of [-0.65, 0.65]) bench.box(0.05, 0.45, 0.45, sx, 0.22, 0, mat('#2f343c'));
    }
  }

  // Pond with a waterfall pouring off the right edge.
  const pondX = W + 3.6;
  const pondZ = 7.5;
  const water = new THREE.MeshStandardMaterial({ color: '#5fa9c9', roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.88 });
  const pond = new THREE.Mesh(new THREE.CircleGeometry(2.1, 40), water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(pondX, ISLAND_TOP + 0.03, pondZ);
  group.add(pond);
  const rim = new Builder(batch, pondX, pondZ, 0, ISLAND_TOP);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    if (Math.cos(a) > 0.85) continue;
    rim.sphere(0.32, Math.cos(a) * 2.25, 0.08, Math.sin(a) * 2.25, mat(['#9a958c', '#86827a', '#a8a399'][i % 3], { roughness: 0.95 }), 1.2, 0.55, 1, 0);
  }
  const edgeX = CX + outline(Math.atan2(pondZ - CZ, W + 10 - CX)) * Math.cos(Math.atan2(pondZ - CZ, W + 10 - CX));
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.5, edgeX - pondX - 1.6), 0.9), water);
  stream.rotation.x = -Math.PI / 2;
  stream.position.set((pondX + 1.8 + edgeX) / 2, ISLAND_TOP + 0.035, pondZ);
  group.add(stream);
  const fallTex = waterfallTexture();
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 24, 1, 12), new THREE.MeshStandardMaterial({ map: fallTex, transparent: true, opacity: 0.85, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide }));
  const fp = fall.geometry.getAttribute('position');
  for (let i = 0; i < fp.count; i++) {
    const t = (12 - fp.getY(i)) / 24;
    fp.setZ(i, t * t * 4.5);
  }
  fall.geometry.computeVertexNormals();
  fall.rotation.y = -Math.PI / 2;
  fall.position.set(edgeX + 0.05, ISLAND_TOP - 12, pondZ);
  group.add(fall);
  const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), transparent: true, opacity: 0.5, depthWrite: false }));
  mist.scale.set(9, 5, 1);
  mist.position.set(edgeX + 4.5, ISLAND_TOP - 23, pondZ);
  group.add(mist);

  // ---- clouds
  const cloudMat = new THREE.SpriteMaterial({ map: softDot(), transparent: true, opacity: 0.75, depthWrite: false, fog: false });
  const clouds: Array<{ s: THREE.Sprite; speed: number; base: THREE.Vector3 }> = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const rad = 45 + r() * 60;
    const base = new THREE.Vector3(CX + Math.cos(a) * rad, -32 + r() * 34, CZ + Math.sin(a) * rad);
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Sprite(cloudMat);
      const scale = 9 + r() * 12;
      s.scale.set(scale * 1.6, scale, 1);
      const p = base.clone().add(new THREE.Vector3((r() - 0.5) * 12, (r() - 0.5) * 3, (r() - 0.5) * 8));
      s.position.copy(p);
      group.add(s);
      clouds.push({ s, speed: 0.4 + r() * 0.6, base: p });
    }
  }

  // ---- sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color('#9fb4e8') }, horizon: { value: new THREE.Color('#f3d7e4') }, bottom: { value: new THREE.Color('#c9bde8') } },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos; void main(){ float h = vPos.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.5)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat);
  sky.renderOrder = -1;
  group.add(sky);

  batch.build(group);

  return {
    group,
    sky,
    lamps,
    update(t: number) {
      fallTex.offset.y = (t * 0.6) % 1;
      for (const c of clouds) c.s.position.x = c.base.x + Math.sin(t * 0.02 * c.speed + c.base.z) * 6;
    },
    setSky(topC: string, horizonC: string, bottomC: string) {
      skyMat.uniforms.top.value.set(topC);
      skyMat.uniforms.horizon.value.set(horizonC);
      skyMat.uniforms.bottom.value.set(bottomC);
    },
  };
}

function waterfallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(150,205,230,0.75)';
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 3, 8 + Math.random() * 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  return tex;
}

/** Rock island: rings that shrink with depth, jittered for a natural cliff, with soil and rock strata. */
function buildIsland(): THREE.Mesh {
  const r = rng(77);
  const N = 72;
  const depths = [0, -0.7, -2.4, -4.8, -7.8, -11.2, -15.2, -19.0];
  const shrink = [1.0, 0.985, 0.93, 0.8, 0.64, 0.45, 0.26, 0.1];
  const rings: THREE.Vector3[][] = depths.map((y, k) =>
    Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      const jitter = k === 0 ? 0 : (r() - 0.5) * 0.12;
      const rad = outline(a) * shrink[k] * (1 + jitter);
      return new THREE.Vector3(CX + Math.cos(a) * rad, ISLAND_TOP + y + (k === 0 ? 0 : (r() - 0.5) * 0.8), CZ + Math.sin(a) * rad);
    }),
  );
  const tip = new THREE.Vector3(ELEVATOR.x, ISLAND_TOP - 23, ELEVATOR.z);
  const colorAt = (k: number): THREE.Color => {
    const palette = ['#6ea75a', '#7a5a3e', '#8b6a4a', '#8d8478', '#7b736a', '#6f6a63', '#5f5a55', '#4f4b47'];
    return new THREE.Color(palette[Math.min(k, palette.length - 1)]).offsetHSL(0, 0, (r() - 0.5) * 0.05);
  };
  const positions: number[] = [];
  const colors: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const a = rings[k][i];
      const b = rings[k][(i + 1) % N];
      const c = rings[k + 1][(i + 1) % N];
      const d = rings[k + 1][i];
      const color = colorAt(k);
      pushTri(a, b, d, color);
      pushTri(b, c, d, color.clone().offsetHSL(0, 0, -0.02));
    }
  }
  const last = rings[rings.length - 1];
  for (let i = 0; i < N; i++) pushTri(last[i], last[(i + 1) % N], tip, colorAt(7));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  // Hanging roots and stones under the island.
  return mesh;
}

