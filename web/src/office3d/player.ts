// Boss mode: you walk around the office like in a video game. Z Q S D move (AZERTY), the mouse turns
// your head, Shift runs. First-person view looks from your eyes; third-person view follows you from
// behind and never goes through walls.

import * as THREE from 'three';
import { D, navIndex, W } from './layout.ts';
import type { Nav } from './nav.ts';
import type { Char } from './sim.ts';

export type BossView = 'fpv' | 'tpv';

const WALK = 2.4;
const RUN = 4.8;
const RADIUS = 0.2;

export class PlayerControl {
  yaw = 0;
  pitch = -0.08;
  view: BossView = 'tpv';
  readonly keys = new Set<string>();
  private distance = 3.4;
  private velocity = new THREE.Vector3();
  private camera: THREE.PerspectiveCamera;
  private nav: Nav;
  private hit: (origin: THREE.Vector3, dir: THREE.Vector3) => THREE.Intersection | undefined;
  private smoothed = new THREE.Vector3();
  private fresh = true;

  constructor(camera: THREE.PerspectiveCamera, nav: Nav, hit: (origin: THREE.Vector3, dir: THREE.Vector3) => THREE.Intersection | undefined) {
    this.camera = camera;
    this.nav = nav;
    this.hit = hit;
  }

  begin() {
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.fresh = true;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0026;
    const max = this.view === 'fpv' ? 1.35 : 0.55;
    const min = this.view === 'fpv' ? -1.35 : -1.1;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0026, min, max);
  }

  /** Scroll: camera distance in third person. */
  zoom(deltaY: number) {
    this.distance = THREE.MathUtils.clamp(this.distance * Math.pow(1.0015, deltaY), 1.6, 9);
  }

  setView(view: BossView) {
    this.view = view;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.1, view === 'fpv' ? 1.35 : 0.55);
    this.fresh = true;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  private walkable(x: number, z: number): boolean {
    if (x < RADIUS || z < RADIUS || x > W - RADIUS || z > D - RADIUS) return false;
    for (const [dx, dz] of [
      [0, 0],
      [RADIUS, 0],
      [-RADIUS, 0],
      [0, RADIUS],
      [0, -RADIUS],
    ])
      if (!this.nav.free(navIndex(x + dx, z + dz))) return false;
    return true;
  }

  /**
   * Moves the boss (when he can be controlled) and places the camera. `eyeY` is the eye height
   * above his feet; `floorY` is where his feet are (the elevator cabin while riding).
   */
  update(dt: number, c: Char, controllable: boolean, floorY: number) {
    const k = this.keys;
    const want = new THREE.Vector3();
    if (controllable) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      // Camera right (forward × up).
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      if (k.has('z') || k.has('w') || k.has('arrowup')) want.add(fwd);
      if (k.has('s') || k.has('arrowdown')) want.sub(fwd);
      if (k.has('d') || k.has('arrowright')) want.add(right);
      if (k.has('q') || k.has('a') || k.has('arrowleft')) want.sub(right);
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(k.has('shift') ? RUN : WALK);
    }
    this.velocity.lerp(want, 1 - Math.exp(-dt * 10));
    if (!controllable) this.velocity.set(0, 0, 0);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (controllable && speed > 0.01) {
      // Slide along walls and desks: try each axis on its own.
      const nx = c.x + this.velocity.x * dt;
      if (this.walkable(nx, c.z)) c.x = nx;
      else this.velocity.x = 0;
      const nz = c.z + this.velocity.z * dt;
      if (this.walkable(c.x, nz)) c.z = nz;
      else this.velocity.z = 0;
    }
    c.playerSpeed = controllable ? speed : 0;
    if (controllable) {
      // First person: the body faces where you look. Third person: it turns toward where you walk.
      // Face the way you push, even against a wall.
      const target = this.view === 'fpv' ? this.yaw : want.lengthSq() > 0 ? Math.atan2(want.x, want.z) : c.heading;
      let d = target - c.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      c.heading += d * Math.min(1, dt * (this.view === 'fpv' ? 30 : 10));
    }

    const height = c.person.height;
    const eye = new THREE.Vector3(c.x, floorY + 1.6 * height, c.z);
    const dir = this.forward();
    if (this.view === 'fpv') {
      const flat = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.camera.position.copy(eye).addScaledVector(flat, 0.12);
      this.camera.lookAt(this.camera.position.clone().add(dir));
      this.fresh = true;
      return;
    }
    // Third person: behind and slightly above, pulled in when something is in the way.
    const shoulder = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(0.38);
    const pivot = new THREE.Vector3(c.x, floorY + 1.5 * height, c.z).add(shoulder);
    const back = dir.clone().negate();
    let dist = this.distance;
    const blocker = this.hit(pivot, back);
    if (blocker && blocker.distance < dist + 0.25) dist = Math.max(0.45, blocker.distance - 0.25);
    const desired = pivot.clone().addScaledVector(back, dist).add(new THREE.Vector3(0, 0.25, 0));
    if (this.fresh) {
      this.smoothed.copy(desired);
      this.fresh = false;
    } else this.smoothed.lerp(desired, 1 - Math.exp(-dt * 14));
    // Never trail behind a wall the smoothing has not caught up with.
    if (this.smoothed.distanceTo(pivot) > dist + 0.6) this.smoothed.copy(desired);
    this.camera.position.copy(this.smoothed);
    this.camera.lookAt(pivot.clone().addScaledVector(dir, 1.2).add(new THREE.Vector3(0, 0.1, 0)));
  }
}
