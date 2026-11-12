// Two extra camera modes: a free-flying camera (ZQSD + drag to look) and the idle tour, which glides
// around the office forever, visiting random rooms and then each worker in turn.

import * as THREE from 'three';
import type { RoomId } from '../../../shared/rooms.ts';
import type { Elevator } from './elevator.ts';
import { D, ELEVATOR, type Layout, W } from './layout.ts';
import type { Char, Sim } from './sim.ts';

const UP = new THREE.Vector3(0, 1, 0);

export class FreeFly {
  private camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  readonly keys = new Set<string>();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  begin() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.keys.clear();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0035;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -1.45, 1.45);
  }

  dolly(amount: number) {
    this.camera.position.addScaledVector(this.forward(), amount);
  }

  /** Aims the camera at a point from a few metres away. */
  lookAt(point: THREE.Vector3) {
    const dir = point.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }

  update(dt: number) {
    const k = this.keys;
    const speed = (k.has('shift') ? 22 : 8) * dt;
    const fwd = this.forward();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const move = new THREE.Vector3();
    // ZQSD layout (AZERTY): Z forward, S back, Q left, D right, E up, A down.
    if (k.has('z') || k.has('arrowup')) move.add(fwd);
    if (k.has('s') || k.has('arrowdown')) move.sub(fwd);
    if (k.has('d') || k.has('arrowright')) move.add(right);
    if (k.has('q') || k.has('arrowleft')) move.sub(right);
    if (k.has('e') || k.has(' ')) move.y += 1;
    if (k.has('a') || k.has('control')) move.y -= 1;
    if (move.lengthSq() > 0) this.camera.position.addScaledVector(move.normalize(), speed);
    const p = this.camera.position;
    p.x = THREE.MathUtils.clamp(p.x, -120, W + 120);
    p.z = THREE.MathUtils.clamp(p.z, -120, D + 120);
    p.y = THREE.MathUtils.clamp(p.y, -90, 160);
    this.camera.lookAt(p.clone().add(fwd));
  }
}

type ShotKind = 'overview' | 'room' | 'worker' | 'elevator';

interface Shot {
  kind: ShotKind;
  target: THREE.Vector3;
  radius: number;
  elevation: number;
  angle: number;
  spin: number;
  hold: number;
  charId?: string;
  room?: RoomId;
}

/** Idle mode: an endless, smooth camera tour of the office and its workers. */
export class Tour {
  private camera: THREE.PerspectiveCamera;
  private sim: Sim;
  private layout: Layout;
  private elevator: Elevator;
  private shot: Shot | null = null;
  private elapsed = 0;
  private step = 0;
  private workerCursor = 0;
  private lastRooms: RoomId[] = [];
  readonly pos = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  focusId: string | null = null;
  private pending: string | null = null;

  constructor(camera: THREE.PerspectiveCamera, sim: Sim, layout: Layout, elevator: Elevator) {
    this.camera = camera;
    this.sim = sim;
    this.layout = layout;
    this.elevator = elevator;
  }

  begin(target: THREE.Vector3) {
    this.pos.copy(this.camera.position);
    this.target.copy(target);
    this.step = 0;
    this.next();
  }

  /** Swings over to this worker now, then carries on touring. */
  visit(id: string) {
    this.pending = id;
    if (this.shot) this.elapsed = this.shot.hold;
  }

  private workerShot(c: Char): Shot {
    return {
      kind: 'worker',
      target: new THREE.Vector3(c.x, c.y + 1.2, c.z),
      radius: 6.5,
      elevation: 0.42,
      angle: c.heading + (Math.random() > 0.5 ? 0.55 : -0.55),
      spin: Math.random() > 0.5 ? 0.05 : -0.05,
      hold: 9,
      charId: c.id,
    };
  }

  private next() {
    this.elapsed = 0;
    const chosen = this.pending ? this.sim.chars.get(this.pending) : undefined;
    this.pending = null;
    if (chosen) {
      this.shot = this.workerShot(chosen);
      this.focusId = chosen.id;
      return;
    }
    const s = this.step++;
    const workers = [...this.sim.chars.values()].filter((c) => c.person.root.visible && c.mode !== 'riding' && c.mode !== 'hidden');
    if (this.elevator.status !== 'idle' && Math.random() < 0.5 && s % 3 === 1) {
      this.shot = { kind: 'elevator', target: new THREE.Vector3(ELEVATOR.x, this.elevator.y + 1, ELEVATOR.z), radius: 22, elevation: 0.12, angle: 0.5, spin: 0.05, hold: 10 };
      this.focusId = null;
      return;
    }
    if (s % 6 === 0) {
      this.shot = { kind: 'overview', target: new THREE.Vector3(W / 2, -5, D / 2 + 1), radius: 82, elevation: 0.5, angle: 0.3 + Math.random() * 0.9, spin: 0.035, hold: 16 };
      this.focusId = null;
      return;
    }
    if (s % 2 === 1 && workers.length) {
      const c = workers[this.workerCursor++ % workers.length];
      this.shot = this.workerShot(c);
      this.focusId = c.id;
      return;
    }
    // A sub-office, preferring ones where somebody is.
    const busy = new Set(workers.map((c) => c.agent.room));
    const zones = [...this.layout.zones.values()].filter((z) => !this.lastRooms.includes(z.def.id));
    const pool = zones.filter((z) => busy.has(z.def.id));
    const zone = (pool.length && Math.random() < 0.7 ? pool : zones)[Math.floor(Math.random() * (pool.length && Math.random() < 0.7 ? pool.length : zones.length))] ?? zones[0];
    this.lastRooms = [zone.def.id, ...this.lastRooms].slice(0, 4);
    this.shot = {
      kind: 'room',
      target: new THREE.Vector3((zone.x0 + zone.x1) / 2, 0.8, (zone.z0 + zone.z1) / 2),
      radius: zone.def.id === 'atrium' ? 18 : 13,
      elevation: 0.72,
      angle: 0.25 + Math.random() * 1.0,
      spin: (Math.random() > 0.5 ? 1 : -1) * 0.03,
      hold: 10,
      room: zone.def.id,
    };
    this.focusId = null;
  }

  update(dt: number) {
    if (!this.shot) this.next();
    const shot = this.shot!;
    this.elapsed += dt;
    if (shot.kind === 'worker' && shot.charId) {
      const c = this.sim.chars.get(shot.charId);
      if (c) shot.target.set(c.x, c.y + 1.2, c.z);
      else this.elapsed = shot.hold;
    }
    if (shot.kind === 'elevator') shot.target.y = this.elevator.y + 1.2;
    const angle = shot.angle + shot.spin * this.elapsed;
    const desired = new THREE.Vector3(
      shot.target.x + Math.sin(angle) * Math.cos(shot.elevation) * shot.radius,
      shot.target.y + Math.sin(shot.elevation) * shot.radius,
      shot.target.z + Math.cos(angle) * Math.cos(shot.elevation) * shot.radius,
    );
    // Critically damped glide toward the shot: smooth transitions and smooth tracking.
    const k = 1 - Math.exp(-dt * 0.9);
    this.pos.lerp(desired, k);
    this.target.lerp(shot.target, 1 - Math.exp(-dt * 1.4));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
    if (this.elapsed > shot.hold) this.next();
  }
}
