// Glass elevator in the middle of the office. Its shaft runs down through the island and hangs
// below it, so new agents can be watched riding up from the clouds; finished agents ride down.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ELEVATOR } from './layout.ts';
import { glassMat, mat } from './materials.ts';

export const BOTTOM = -62;
const TOP_Y = 0.02;
const SPEED_UP = 7.5;
const SPEED_FAST = 16;

interface Job {
  kind: 'arrive' | 'depart';
  ids: string[];
}

export interface ElevatorHooks {
  /** Riders appear inside the cabin (at the bottom). */
  load(ids: string[]): void;
  /** Doors open at the office floor: riders step out. */
  unload(ids: string[]): void;
  /** Doors open for departures: waiting riders step in. */
  board(ids: string[]): void;
  /** Riders reached the bottom and leave the scene. */
  remove(ids: string[]): void;
}

export class Elevator {
  readonly group = new THREE.Group();
  readonly cabin = new THREE.Group();
  y = TOP_Y;
  private doorL: THREE.Mesh;
  private doorR: THREE.Mesh;
  private outerL: THREE.Mesh;
  private outerR: THREE.Mesh;
  private light: THREE.MeshStandardMaterial;
  private doors = 0;
  private doorTarget = 0;
  private arrivals: string[] = [];
  private departures: string[] = [];
  private job: Job | null = null;
  private steps: Array<() => boolean> = [];
  private wait = 0;
  private move: { from: number; to: number; t: number; dur: number } | null = null;
  status: 'idle' | 'up' | 'down' = 'idle';

  constructor() {
    const { x, z, size } = ELEVATOR;
    const h = size / 2;
    const metal = mat('#2f343c', { roughness: 0.35, metalness: 0.75 });
    const glass = glassMat();
    const shaftTop = 3.7;
    const shaftLen = shaftTop - (BOTTOM - 4);
    const midY = (shaftTop + BOTTOM - 4) / 2;
    for (const [cx, cz] of [
      [-h, -h],
      [h, -h],
      [-h, h],
      [h, h],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, shaftLen, 0.12), metal);
      post.position.set(x + cx, midY, z + cz);
      post.castShadow = true;
      this.group.add(post);
    }
    const pane = (w: number, hgt: number, px: number, py: number, pz: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), glass);
      m.material.side = THREE.DoubleSide;
      m.position.set(px, py, pz);
      m.rotation.y = ry;
      m.renderOrder = 2;
      this.group.add(m);
    };
    pane(size, shaftLen, x, midY, z - h, 0);
    pane(size, shaftLen, x - h, midY, z, Math.PI / 2);
    pane(size, shaftLen, x + h, midY, z, Math.PI / 2);
    pane(size, shaftTop - 2.35, x, (shaftTop + 2.35) / 2, z + h, 0);
    pane(size, -0.4 - (BOTTOM - 4), x, (-0.4 + BOTTOM - 4) / 2, z + h, 0);
    for (let y = -26; y > BOTTOM - 4; y -= 4) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(size + 0.16, 0.1, size + 0.16), metal);
      ring.position.set(x, y, z);
      this.group.add(ring);
    }
    const crown = new THREE.Mesh(new RoundedBoxGeometry(size + 0.3, 0.25, size + 0.3, 2, 0.05), metal);
    crown.position.set(x, shaftTop + 0.12, z);
    crown.castShadow = true;
    this.group.add(crown);
    this.light = new THREE.MeshStandardMaterial({ color: '#d9ffe9', emissive: '#3df08a', emissiveIntensity: 0.4 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(size + 0.32, 0.05, size + 0.32), this.light);
    strip.position.set(x, shaftTop - 0.02, z);
    this.group.add(strip);
    // Door frame on the office floor and outer landing doors.
    const header = new THREE.Mesh(new THREE.BoxGeometry(size, 0.18, 0.14), metal);
    header.position.set(x, 2.35, z + h);
    this.group.add(header);
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.02), this.light);
    indicator.position.set(x, 2.35, z + h + 0.08);
    this.group.add(indicator);
    const doorMat = mat('#a9b0ba', { roughness: 0.25, metalness: 0.85 });
    this.outerL = new THREE.Mesh(new THREE.BoxGeometry(0.58, 2.25, 0.04), doorMat);
    this.outerR = this.outerL.clone();
    for (const d of [this.outerL, this.outerR]) {
      d.position.set(x, 1.13, z + h + 0.03);
      d.castShadow = true;
      this.group.add(d);
    }

    // Cabin.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(size - 0.25, 0.1, size - 0.25), mat('#5b4a3c', { roughness: 0.6 }));
    floor.position.y = -0.05;
    floor.receiveShadow = true;
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(size - 0.25, 0.08, size - 0.25), metal);
    ceiling.position.y = 2.32;
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d8', emissiveIntensity: 1.6 }));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.y = 2.27;
    const back = new THREE.Mesh(new THREE.BoxGeometry(size - 0.25, 2.3, 0.05), mat('#c7ccd3', { roughness: 0.3, metalness: 0.6 }));
    back.position.set(0, 1.15, -h + 0.15);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, size - 0.4, 10), mat('#d4b46a', { metalness: 0.9, roughness: 0.25 }));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 0.95, -h + 0.22);
    this.cabin.add(floor, ceiling, lamp, back, rail);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.25, 2.3), glass);
      side.rotation.y = Math.PI / 2;
      side.position.set(sx * (h - 0.13), 1.15, 0);
      this.cabin.add(side);
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.35, 0.06), metal);
        post.position.set(sx * (h - 0.13), 1.15, sz * (h - 0.13));
        this.cabin.add(post);
      }
    }
    this.doorL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.2, 0.035), doorMat);
    this.doorR = this.doorL.clone();
    for (const d of [this.doorL, this.doorR]) {
      d.position.set(0, 1.12, h - 0.14);
      this.cabin.add(d);
    }
    this.cabin.position.set(x, this.y, z);
    this.cabin.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== glass) o.castShadow = true;
    });
    this.group.add(this.cabin);
    this.applyDoors();
  }

  /** Where rider i stands inside the cabin (world x/z). */
  slot(i: number): { x: number; z: number } {
    const offsets = [
      [-0.38, 0.05],
      [0.38, 0.05],
      [-0.38, -0.5],
      [0.38, -0.5],
      [0, -0.2],
    ];
    const [ox, oz] = offsets[i % offsets.length];
    return { x: ELEVATOR.x + ox, z: ELEVATOR.z + oz };
  }

  /** Where a departing rider waits for the doors. */
  queueSpot(i: number): { x: number; z: number } {
    return { x: ELEVATOR.x + [-0.5, 0.5, -1.2, 1.2, 0][i % 5], z: ELEVATOR.z + ELEVATOR.size / 2 + 0.9 + (i >= 4 ? 0.6 : 0) };
  }

  /** Where riders step out to. */
  exitSpot(i: number): { x: number; z: number } {
    return { x: ELEVATOR.x + [-0.4, 0.4, -1.0, 1.0, 0][i % 5], z: ELEVATOR.z + ELEVATOR.size / 2 + 1.1 };
  }

  get atFloor() {
    return Math.abs(this.y - TOP_Y) < 0.01;
  }

  requestArrival(id: string) {
    if (!this.arrivals.includes(id)) this.arrivals.push(id);
  }

  requestDeparture(id: string) {
    if (!this.departures.includes(id)) this.departures.push(id);
  }

  /** How far the doors are open (0 closed, 1 open), for the door sound. */
  get doorAmount(): number {
    return this.doors;
  }

  /** Empties the cabin and the queues at once (the office is being rebuilt, e.g. for a replay). */
  reset() {
    this.arrivals = [];
    this.departures = [];
    this.job = null;
    this.steps = [];
    this.move = null;
    this.wait = 0;
    this.y = TOP_Y;
    this.doorTarget = 0;
    this.doors = 0;
    this.status = 'idle';
  }

  /** Takes someone out of the cabin's current trip too (he is being replaced). */
  evict(id: string) {
    this.cancel(id);
    const i = this.job?.ids.indexOf(id) ?? -1;
    if (this.job && i >= 0) this.job.ids.splice(i, 1);
  }

  cancel(id: string) {
    this.arrivals = this.arrivals.filter((a) => a !== id);
    this.departures = this.departures.filter((a) => a !== id);
  }

  isRiding(id: string) {
    return this.job?.ids.includes(id) ?? false;
  }

  update(dt: number, hooks: ElevatorHooks) {
    // Doors.
    this.doors += Math.sign(this.doorTarget - this.doors) * Math.min(Math.abs(this.doorTarget - this.doors), dt * 1.6);
    this.applyDoors();
    // Motion.
    if (this.move) {
      const m = this.move;
      m.t = Math.min(1, m.t + dt / m.dur);
      const e = m.t < 0.5 ? 4 * m.t ** 3 : 1 - (-2 * m.t + 2) ** 3 / 2;
      this.y = m.from + (m.to - m.from) * e;
      if (m.t >= 1) this.move = null;
    }
    this.cabin.position.y = this.y;
    if (this.wait > 0) this.wait -= dt;

    if (!this.job) {
      const departing = this.departures.splice(0, 4);
      if (departing.length) this.start({ kind: 'depart', ids: departing }, hooks);
      else if (this.arrivals.length) this.start({ kind: 'arrive', ids: this.arrivals.splice(0, 4) }, hooks);
      else {
        this.light.emissiveIntensity = 0.35;
        this.status = 'idle';
      }
    }
    while (this.steps.length && !this.move && this.wait <= 0 && Math.abs(this.doors - this.doorTarget) < 0.01) {
      const done = this.steps[0]();
      if (!done) break;
      this.steps.shift();
    }
    if (this.job && !this.steps.length && !this.move && this.wait <= 0) this.job = null;
  }

  private start(job: Job, hooks: ElevatorHooks) {
    this.job = job;
    const go = (to: number, speed: number) => () => {
      this.move = { from: this.y, to, t: 0, dur: Math.max(0.3, Math.abs(to - this.y) / speed) };
      return true;
    };
    const doors = (open: boolean) => () => {
      this.doorTarget = open ? 1 : 0;
      return true;
    };
    const pause = (s: number) => () => {
      this.wait = s;
      return true;
    };
    const run = (fn: () => void) => () => {
      fn();
      return true;
    };
    if (job.kind === 'arrive') {
      this.status = 'up';
      this.light.color.set('#3df08a');
      this.light.emissive.set('#3df08a');
      this.light.emissiveIntensity = 1.4;
      this.steps = [doors(false), go(BOTTOM, SPEED_FAST), run(() => hooks.load(job.ids)), pause(0.6), go(TOP_Y, SPEED_UP), doors(true), run(() => hooks.unload(job.ids)), pause(2.6), doors(false)];
    } else {
      this.status = 'down';
      this.light.color.set('#ffb84a');
      this.light.emissive.set('#ffb84a');
      this.light.emissiveIntensity = 1.4;
      this.steps = [
        go(TOP_Y, SPEED_FAST),
        doors(true),
        run(() => hooks.board(job.ids)),
        pause(1.8),
        doors(false),
        go(BOTTOM, SPEED_UP),
        run(() => {
          hooks.remove(job.ids);
          // Pick up waiting arrivals on the way back up.
          const next = this.arrivals.splice(0, 4);
          if (next.length) {
            job.kind = 'arrive';
            job.ids = next;
            this.status = 'up';
            this.light.color.set('#3df08a');
            this.light.emissive.set('#3df08a');
            this.steps.push(run(() => hooks.load(next)), pause(0.6), go(TOP_Y, SPEED_UP), doors(true), run(() => hooks.unload(next)), pause(2.6), doors(false));
          } else this.steps.push(go(TOP_Y, SPEED_FAST));
        }),
      ];
    }
  }

  private applyDoors() {
    const o = this.doors * 0.56;
    const atFloor = this.y > -0.5 && this.y < 0.5;
    this.doorL.position.x = -0.28 - o;
    this.doorR.position.x = 0.28 + o;
    const outer = atFloor ? o : 0;
    this.outerL.position.x = ELEVATOR.x - 0.29 - outer;
    this.outerR.position.x = ELEVATOR.x + 0.29 + outer;
  }
}
