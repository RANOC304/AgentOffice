// Boss mode: you walk around the office like in a video game. Z Q S D move (AZERTY), the mouse turns
// your head, Shift (or a double tap on Z) sprints. First-person view looks from your eyes; third-person
// view follows you over your shoulder and never goes through walls.

import * as THREE from 'three';
import { cellCenter, D, navIndex, W } from './layout.ts';
import type { Nav } from './nav.ts';
import type { Char } from './sim.ts';

export type BossView = 'fpv' | 'tpv';

const WALK = 2.3;
const SPRINT = 6.6;
/** Take-off speed and gravity of a jump: about 1.75 m high, a second in the air. */
const JUMP_SPEED = 6.75;
const GRAVITY = 13;
const RADIUS = 0.2;
/** Field of view in boss mode (degrees): wider than the orbit camera, like a game. */
const FOV = { fpv: 72, tpv: 62 };
const SPRINT_FOV = 10;
const FORWARD = ['z', 'w', 'arrowup'];

export class PlayerControl {
  yaw = 0;
  pitch = -0.08;
  view: BossView = 'tpv';
  readonly keys = new Set<string>();
  /** Sprinting right now (for the HUD and the footsteps). */
  sprinting = false;
  private distance = 3.4;
  private velocity = new THREE.Vector3();
  private camera: THREE.PerspectiveCamera;
  private nav: Nav;
  private hit: (origin: THREE.Vector3, dir: THREE.Vector3) => THREE.Intersection | undefined;
  private smoothed = new THREE.Vector3();
  private fresh = true;
  private lastForwardTap = 0;
  private latched = false;
  private vy = 0;
  private jumpQueued = false;
  /** True for one frame when you land from a jump (for the thud). */
  landed = false;

  constructor(camera: THREE.PerspectiveCamera, nav: Nav, hit: (origin: THREE.Vector3, dir: THREE.Vector3) => THREE.Intersection | undefined) {
    this.camera = camera;
    this.nav = nav;
    this.hit = hit;
  }

  begin() {
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.fresh = true;
    this.latched = false;
  }

  /** A key went down: Space jumps; a quick double tap on forward starts a sprint until you let go. */
  press(key: string, repeat: boolean) {
    if (key === ' ' && !repeat) this.jumpQueued = true;
    if (repeat || !FORWARD.includes(key)) return;
    const now = performance.now();
    if (now - this.lastForwardTap < 320) this.latched = true;
    this.lastForwardTap = now;
  }

  release(key: string) {
    if (FORWARD.includes(key) && !FORWARD.some((k) => k !== key && this.keys.has(k))) this.latched = false;
  }

  /** Is a movement key held? */
  get moving(): boolean {
    return ['z', 'w', 'arrowup', 's', 'arrowdown', 'q', 'a', 'arrowleft', 'd', 'arrowright'].some((k) => this.keys.has(k));
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

  /** Back to a standstill (after a reset). */
  stop() {
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.latched = false;
    this.fresh = true;
  }

  private inside(x: number, z: number): boolean {
    return x >= RADIUS && z >= RADIUS && x <= W - RADIUS && z <= D - RADIUS;
  }

  /** How many of the body's sample points touch furniture or walls (0 = completely free). */
  private overlap(x: number, z: number): number {
    if (!this.inside(x, z)) return 9;
    let n = 0;
    for (const [dx, dz] of [
      [0, 0],
      [RADIUS, 0],
      [-RADIUS, 0],
      [0, RADIUS],
      [0, -RADIUS],
      [RADIUS * 0.7, RADIUS * 0.7],
      [-RADIUS * 0.7, RADIUS * 0.7],
      [RADIUS * 0.7, -RADIUS * 0.7],
      [-RADIUS * 0.7, -RADIUS * 0.7],
    ])
      if (!this.nav.free(navIndex(x + dx, z + dz))) n += dx === 0 && dz === 0 ? 4 : 1;
    return n;
  }

  /**
   * A step is allowed when it lands somewhere free, or when it does not make things worse: that
   * way you can always slide out of a tight spot between chairs and desks instead of being stuck.
   */
  private canStep(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const after = this.overlap(toX, toZ);
    if (after === 0) return true;
    if (!this.inside(toX, toZ)) return false;
    return after <= this.overlap(fromX, fromZ) && after < 4;
  }

  /**
   * Moves the boss (when he can walk) and places the camera. `floorY` is where his feet are (the
   * elevator cabin while riding). The eyes follow the body, so sitting lowers the view.
   */
  update(dt: number, c: Char, canWalk: boolean, floorY: number) {
    const k = this.keys;
    const want = new THREE.Vector3();
    const sprintKey = k.has('shift') || this.latched;
    if (canWalk) {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      // Camera right (forward × up).
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      if (FORWARD.some((key) => k.has(key))) want.add(fwd);
      if (k.has('s') || k.has('arrowdown')) want.sub(fwd);
      if (k.has('d') || k.has('arrowright')) want.add(right);
      if (k.has('q') || k.has('a') || k.has('arrowleft')) want.sub(right);
      if (want.lengthSq() > 0) want.normalize().multiplyScalar(sprintKey ? SPRINT : WALK);
    }
    // Sprints build up a little slower than walks, like a real run-up.
    this.velocity.lerp(want, 1 - Math.exp(-dt * (sprintKey ? 6 : 10)));
    if (!canWalk) this.velocity.set(0, 0, 0);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (canWalk && speed > 0.01) {
      // Slide along walls and desks: try each axis on its own.
      const nx = c.x + this.velocity.x * dt;
      if (this.canStep(c.x, c.z, nx, c.z)) c.x = nx;
      else this.velocity.x = 0;
      const nz = c.z + this.velocity.z * dt;
      if (this.canStep(c.x, c.z, c.x, nz)) c.z = nz;
      else this.velocity.z = 0;
    }
    // Inside furniture (after sitting, a slap lunge or a respawn)? Drift gently out to free floor.
    if (canWalk && this.overlap(c.x, c.z) >= 4) {
      const p = cellCenter(this.nav.nearestFree(c.x, c.z));
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01) {
        const step = Math.min(d, 2.5 * dt);
        c.x += (dx / d) * step;
        c.z += (dz / d) * step;
      }
    }
    this.sprinting = canWalk && sprintKey && speed > WALK + 0.5;
    c.playerSpeed = canWalk ? speed : 0;
    // Jump: a quick hop with snappy gravity; you keep your momentum in the air.
    this.landed = false;
    let jumpY = c.jumpY ?? 0;
    if (this.jumpQueued && canWalk && jumpY <= 0) this.vy = JUMP_SPEED;
    this.jumpQueued = false;
    if (jumpY > 0 || this.vy > 0) {
      // Exact for constant gravity, so the height does not depend on the frame rate.
      jumpY += (this.vy - 0.5 * GRAVITY * dt) * dt;
      this.vy -= GRAVITY * dt;
      if (jumpY <= 0) {
        jumpY = 0;
        this.vy = 0;
        this.landed = true;
      }
    }
    c.jumpY = canWalk ? jumpY : 0;
    if (canWalk) {
      // First person: the body faces where you look. Third person: it turns toward where you push.
      const target = this.view === 'fpv' ? this.yaw : want.lengthSq() > 0 ? Math.atan2(want.x, want.z) : c.heading;
      let d = target - c.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      c.heading += d * Math.min(1, dt * (this.view === 'fpv' ? 30 : 10));
    }

    // Wider view in boss mode, a little wider still while sprinting.
    const fov = FOV[this.view] + (this.sprinting ? SPRINT_FOV : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 6));
      this.camera.updateProjectionMatrix();
    }

    const height = c.person.height;
    const top = c.person.topY;
    const dir = this.forward();
    if (this.view === 'fpv') {
      const bob = canWalk ? Math.sin(c.walkPhase * 2) * Math.min(1, speed / WALK) * (this.sprinting ? 0.045 : 0.022) : 0;
      const eye = new THREE.Vector3(c.x, floorY + top - 0.12 * height + bob, c.z);
      const flat = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.camera.position.copy(eye).addScaledVector(flat, 0.12);
      this.camera.lookAt(this.camera.position.clone().add(dir));
      this.fresh = true;
      return;
    }
    // Third person: behind and slightly above, pulled in when something is in the way.
    const shoulder = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(0.38);
    const pivot = new THREE.Vector3(c.x, floorY + top - 0.22 * height, c.z).add(shoulder);
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
