// Floor plan in metres: x to the right, z towards the camera, y up. The office is a 5 × 4 grid of
// 7 m × 6.5 m zones. The middle column is an open spine: BrowserOS neo hub at the back, the elevator
// atrium in the centre and the café at the front.

import { GRID, ROOMS, type RoomDef, type RoomId } from '../../../shared/rooms.ts';

export const W = GRID.cols * GRID.cellW; // 35
export const D = GRID.rows * GRID.cellD; // 26
export const CELL = 0.5;
export const NW = Math.round(W / CELL);
export const ND = Math.round(D / CELL);
export const ELEVATOR = { x: W / 2, z: D / 2, size: 2.4 };

export type FurnType =
  | 'desk'
  | 'chair'
  | 'divider'
  | 'plant'
  | 'tallPlant'
  | 'shelf'
  | 'rack'
  | 'whiteboard'
  | 'tv'
  | 'arcade'
  | 'easel'
  | 'printer3d'
  | 'pedestal'
  | 'camera'
  | 'softbox'
  | 'safe'
  | 'sofa'
  | 'armchair'
  | 'beanbag'
  | 'coffeeTable'
  | 'counter'
  | 'coffeeMachine'
  | 'standTable'
  | 'stool'
  | 'meetingTable'
  | 'pingpong'
  | 'cooler'
  | 'bench'
  | 'planter'
  | 'fridge';

export interface Furn {
  type: FurnType;
  x: number;
  z: number;
  /** Rotation around y; 0 means the front of the item faces +z (the camera). */
  rot: number;
  room: RoomId;
  variant: number;
}

export type SeatKind = 'desk' | 'sofa' | 'stool' | 'meeting' | 'beanbag' | 'bench';

export interface Seat {
  id: string;
  x: number;
  z: number;
  /** Direction the sitter faces: (sin h, cos h). */
  heading: number;
  room: RoomId;
  kind: SeatKind;
  height: number;
  /** Monitor in front of a desk seat (for the screen glow). */
  screen?: { x: number; z: number; rot: number };
}

export type SpotKind = 'coffee' | 'window' | 'chat' | 'arcade' | 'pingpong' | 'stand' | 'watch';

export interface Spot {
  id: string;
  x: number;
  z: number;
  heading: number;
  room: RoomId;
  kind: SpotKind;
  /** Partner spot for two-person activities (chat, ping-pong). */
  pair?: string;
}

export interface WallSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  kind: 'back' | 'partition' | 'glass';
  room?: RoomId;
}

export interface Zone {
  def: RoomDef;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Layout {
  zones: Map<RoomId, Zone>;
  furniture: Furn[];
  seats: Seat[];
  spots: Spot[];
  walls: WallSeg[];
  windows: Array<{ x: number; z: number; axis: 'x' | 'z' }>;
  blocked: Uint8Array;
}

const PI = Math.PI;

export function zoneOf(def: RoomDef): Zone {
  const [c, r] = def.cell;
  return { def, x0: c * GRID.cellW, z0: r * GRID.cellD, x1: (c + 1) * GRID.cellW, z1: (r + (def.rowSpan ?? 1)) * GRID.cellD };
}

const PROPS: Partial<Record<RoomId, FurnType[]>> = {
  web: ['tallPlant', 'shelf', 'whiteboard', 'plant', 'tv', 'plant'],
  backend: ['rack', 'rack', 'whiteboard', 'plant', 'shelf', 'plant'],
  data: ['rack', 'whiteboard', 'plant', 'shelf', 'tv', 'tallPlant'],
  devops: ['rack', 'rack', 'tv', 'plant', 'plant', 'shelf'],
  mobile: ['shelf', 'plant', 'whiteboard', 'tallPlant', 'tv', 'plant'],
  security: ['safe', 'rack', 'shelf', 'plant', 'tv', 'plant'],
  systems: ['rack', 'shelf', 'whiteboard', 'plant', 'plant', 'rack'],
  research: ['shelf', 'shelf', 'shelf', 'tallPlant', 'pedestal', 'armchair'],
  gamedev: ['arcade', 'arcade', 'tv', 'beanbag', 'plant', 'shelf'],
  design: ['easel', 'easel', 'tallPlant', 'shelf', 'whiteboard', 'plant'],
  media: ['camera', 'softbox', 'softbox', 'plant', 'tv', 'shelf'],
  writing: ['shelf', 'shelf', 'plant', 'armchair', 'whiteboard', 'tallPlant'],
  threed: ['printer3d', 'pedestal', 'pedestal', 'plant', 'tv', 'shelf'],
  general: ['plant', 'shelf', 'whiteboard', 'tallPlant', 'cooler', 'plant'],
};

export function buildLayout(): Layout {
  const zones = new Map<RoomId, Zone>();
  const furniture: Furn[] = [];
  const seats: Seat[] = [];
  const spots: Spot[] = [];
  const walls: WallSeg[] = [];
  const windows: Layout['windows'] = [];
  let variant = 1;
  const add = (type: FurnType, x: number, z: number, rot: number, room: RoomId) => furniture.push({ type, x, z, rot, room, variant: variant++ });

  for (const def of ROOMS) zones.set(def.id, zoneOf(def));

  // ---- walls
  walls.push({ x1: 0, z1: 0, x2: W, z2: 0, kind: 'back' });
  walls.push({ x1: 0, z1: 0, x2: 0, z2: D, kind: 'back' });
  walls.push({ x1: 0, z1: D, x2: W, z2: D, kind: 'glass' });
  walls.push({ x1: W, z1: 0, x2: W, z2: D, kind: 'glass' });
  const spine = (x: number) => x >= 14 && x < 21;
  for (let c = 1; c < GRID.cols; c++) {
    const x = c * GRID.cellW;
    for (let r = 0; r < GRID.rows; r++) {
      const z0 = r * GRID.cellD;
      const doorA = z0 + 2.45;
      const doorB = z0 + 4.05;
      walls.push({ x1: x, z1: z0, x2: x, z2: doorA, kind: 'partition' });
      walls.push({ x1: x, z1: doorB, x2: x, z2: z0 + GRID.cellD, kind: 'partition' });
    }
  }
  for (let r = 1; r < GRID.rows; r++) {
    const z = r * GRID.cellD;
    for (let c = 0; c < GRID.cols; c++) {
      const x0 = c * GRID.cellW;
      if (spine(x0)) continue;
      walls.push({ x1: x0, z1: z, x2: x0 + 2.7, z2: z, kind: 'partition' });
      walls.push({ x1: x0 + 4.3, z1: z, x2: x0 + GRID.cellW, z2: z, kind: 'partition' });
    }
  }
  for (let c = 0; c < GRID.cols; c++) if (c !== 2) for (const dx of [1.75, 5.25]) windows.push({ x: c * GRID.cellW + dx, z: 0, axis: 'x' });
  for (let r = 0; r < GRID.rows; r++) for (const dz of [1.4, 5.1]) windows.push({ x: 0, z: r * GRID.cellD + dz, axis: 'z' });

  // ---- desk rooms
  for (const zone of zones.values()) {
    const { def, x0, z0 } = zone;
    if (def.kind !== 'desks') continue;
    for (const [i, dx] of [2.0, 3.5, 5.0].entries()) {
      const x = x0 + dx;
      add('desk', x, z0 + 2.75, 0, def.id);
      add('chair', x, z0 + 2.13, 0, def.id);
      seats.push({ id: `${def.id}:a${i}`, x, z: z0 + 2.13, heading: 0, room: def.id, kind: 'desk', height: 0.47, screen: { x, z: z0 + 2.95, rot: PI } });
      add('desk', x, z0 + 3.5, PI, def.id);
      add('chair', x, z0 + 4.12, PI, def.id);
      seats.push({ id: `${def.id}:b${i}`, x, z: z0 + 4.12, heading: PI, room: def.id, kind: 'desk', height: 0.47, screen: { x, z: z0 + 3.3, rot: 0 } });
    }
    add('divider', x0 + 3.5, z0 + 3.125, 0, def.id);
    const props = PROPS[def.id] ?? [];
    const slots: Array<[number, number, number]> = [
      [x0 + 0.55, z0 + 0.5, 0],
      [x0 + 6.45, z0 + 0.5, 0],
      [x0 + 1.75, z0 + 0.42, 0],
      [x0 + 0.55, z0 + 6.0, PI],
      [x0 + 5.25, z0 + 0.42, 0],
      [x0 + 6.45, z0 + 6.0, PI],
    ];
    props.forEach((type, k) => {
      const [x, z, rot] = slots[k];
      add(type, x, z, rot, def.id);
      if (type === 'armchair') seats.push({ id: `${def.id}:arm${k}`, x, z: z + (rot === 0 ? 0.05 : -0.05), heading: rot, room: def.id, kind: 'sofa', height: 0.42 });
      if (type === 'beanbag') seats.push({ id: `${def.id}:bean${k}`, x, z, heading: rot, room: def.id, kind: 'beanbag', height: 0.3 });
      if (type === 'arcade') spots.push({ id: `${def.id}:arc${k}`, x, z: z + 0.75, heading: PI, room: def.id, kind: 'arcade' });
    });
    if (z0 === 0) spots.push({ id: `${def.id}:win`, x: x0 + 3.5, z: 0.75, heading: PI, room: def.id, kind: 'window' });
    if (x0 === 0) spots.push({ id: `${def.id}:winL`, x: 0.75, z: z0 + 3.25, heading: -PI / 2, room: def.id, kind: 'window' });
  }

  // ---- BrowserOS neo hub: desks facing the giant screen on the back wall
  const neo = zones.get('browser')!;
  for (const [row, z] of [2.7, 4.5].entries()) {
    for (const [i, x] of [15.5, 17.5, 19.5].entries()) {
      add('desk', x, z, PI, 'browser');
      add('chair', x, z + 0.62, PI, 'browser');
      seats.push({ id: `browser:${row}${i}`, x, z: z + 0.62, heading: PI, room: 'browser', kind: 'desk', height: 0.47, screen: { x, z: z - 0.2, rot: 0 } });
    }
  }
  add('tallPlant', neo.x0 + 0.5, 0.55, 0, 'browser');
  add('tallPlant', neo.x1 - 0.5, 0.55, 0, 'browser');
  spots.push({ id: 'browser:watch1', x: 15.0, z: 1.6, heading: PI, room: 'browser', kind: 'watch' });
  spots.push({ id: 'browser:watch2', x: 20.0, z: 1.6, heading: PI, room: 'browser', kind: 'watch' });

  // ---- atrium around the elevator
  add('planter', 14.8, 7.3, 0, 'atrium');
  add('planter', 20.2, 7.3, 0, 'atrium');
  add('planter', 14.8, 18.7, 0, 'atrium');
  add('planter', 20.2, 18.7, 0, 'atrium');
  add('bench', 15.0, 13, PI / 2, 'atrium');
  add('bench', 20.0, 13, -PI / 2, 'atrium');
  seats.push({ id: 'atrium:b1', x: 14.95, z: 12.6, heading: -PI / 2, room: 'atrium', kind: 'bench', height: 0.45 });
  seats.push({ id: 'atrium:b2', x: 14.95, z: 13.4, heading: -PI / 2, room: 'atrium', kind: 'bench', height: 0.45 });
  seats.push({ id: 'atrium:b3', x: 20.05, z: 12.6, heading: PI / 2, room: 'atrium', kind: 'bench', height: 0.45 });
  seats.push({ id: 'atrium:b4', x: 20.05, z: 13.4, heading: PI / 2, room: 'atrium', kind: 'bench', height: 0.45 });
  spots.push({ id: 'atrium:c1', x: 16.2, z: 9.0, heading: PI / 2, room: 'atrium', kind: 'chat', pair: 'atrium:c2' });
  spots.push({ id: 'atrium:c2', x: 17.2, z: 9.0, heading: -PI / 2, room: 'atrium', kind: 'chat', pair: 'atrium:c1' });
  spots.push({ id: 'atrium:c3', x: 18.0, z: 17.2, heading: PI / 2, room: 'atrium', kind: 'chat', pair: 'atrium:c4' });
  spots.push({ id: 'atrium:c4', x: 19.0, z: 17.2, heading: -PI / 2, room: 'atrium', kind: 'chat', pair: 'atrium:c3' });

  // ---- café
  add('counter', 14.55, 22.5, PI / 2, 'cafe');
  add('coffeeMachine', 14.55, 21.6, PI / 2, 'cafe');
  add('coffeeMachine', 14.55, 23.4, PI / 2, 'cafe');
  spots.push({ id: 'cafe:m1', x: 15.45, z: 21.6, heading: -PI / 2, room: 'cafe', kind: 'coffee' });
  spots.push({ id: 'cafe:m2', x: 15.45, z: 23.4, heading: -PI / 2, room: 'cafe', kind: 'coffee' });
  for (const [k, z] of [21.3, 24.3].entries()) {
    add('standTable', 17.0, z, 0, 'cafe');
    spots.push({ id: `cafe:t${k}a`, x: 16.45, z, heading: PI / 2, room: 'cafe', kind: 'chat', pair: `cafe:t${k}b` });
    spots.push({ id: `cafe:t${k}b`, x: 17.55, z, heading: -PI / 2, room: 'cafe', kind: 'chat', pair: `cafe:t${k}a` });
  }
  for (const [k, z] of [21.5, 24.5].entries()) {
    add('sofa', 20.35, z, -PI / 2, 'cafe');
    add('coffeeTable', 19.2, z, PI / 2, 'cafe');
    add('armchair', 18.25, z, PI / 2, 'cafe');
    seats.push({ id: `cafe:s${k}a`, x: 20.25, z: z - 0.5, heading: -PI / 2, room: 'cafe', kind: 'sofa', height: 0.44 });
    seats.push({ id: `cafe:s${k}b`, x: 20.25, z: z + 0.5, heading: -PI / 2, room: 'cafe', kind: 'sofa', height: 0.44 });
    seats.push({ id: `cafe:arm${k}`, x: 18.3, z, heading: PI / 2, room: 'cafe', kind: 'sofa', height: 0.42 });
  }
  add('fridge', 14.45, 25.45, PI / 2, 'cafe');
  add('plant', 20.5, 19.95, 0, 'cafe');
  add('plant', 20.5, 25.6, PI, 'cafe');

  // ---- meeting room
  const meet = zones.get('meeting')!;
  const mx = meet.x0 + 3.5;
  const mz = meet.z0 + 3.25;
  add('meetingTable', mx, mz, 0, 'meeting');
  for (const [i, dx] of [-1.1, 0, 1.1].entries()) {
    add('chair', mx + dx, mz - 0.95, 0, 'meeting');
    add('chair', mx + dx, mz + 0.95, PI, 'meeting');
    seats.push({ id: `meeting:n${i}`, x: mx + dx, z: mz - 0.95, heading: 0, room: 'meeting', kind: 'meeting', height: 0.47 });
    seats.push({ id: `meeting:s${i}`, x: mx + dx, z: mz + 0.95, heading: PI, room: 'meeting', kind: 'meeting', height: 0.47 });
  }
  add('tv', meet.x1 - 0.45, mz, -PI / 2, 'meeting');
  add('plant', meet.x0 + 0.55, meet.z0 + 0.55, 0, 'meeting');
  add('tallPlant', meet.x0 + 0.55, meet.z1 - 0.55, 0, 'meeting');

  // ---- game lounge
  const chill = zones.get('chill')!;
  const px = chill.x0 + 3.5;
  const pz = chill.z0 + 3.0;
  add('pingpong', px, pz, 0, 'chill');
  spots.push({ id: 'chill:p1', x: px - 1.75, z: pz, heading: PI / 2, room: 'chill', kind: 'pingpong', pair: 'chill:p2' });
  spots.push({ id: 'chill:p2', x: px + 1.75, z: pz, heading: -PI / 2, room: 'chill', kind: 'pingpong', pair: 'chill:p1' });
  add('arcade', chill.x0 + 0.9, chill.z0 + 0.6, 0, 'chill');
  add('arcade', chill.x0 + 1.9, chill.z0 + 0.6, 0, 'chill');
  spots.push({ id: 'chill:arc1', x: chill.x0 + 0.9, z: chill.z0 + 1.35, heading: PI, room: 'chill', kind: 'arcade' });
  spots.push({ id: 'chill:arc2', x: chill.x0 + 1.9, z: chill.z0 + 1.35, heading: PI, room: 'chill', kind: 'arcade' });
  for (const [k, dx] of [2.6, 3.7, 4.8].entries()) {
    add('beanbag', chill.x0 + dx, chill.z1 - 0.8, PI, 'chill');
    seats.push({ id: `chill:bb${k}`, x: chill.x0 + dx, z: chill.z1 - 0.8, heading: PI, room: 'chill', kind: 'beanbag', height: 0.3 });
  }
  add('tallPlant', chill.x1 - 0.5, chill.z0 + 0.55, 0, 'chill');
  add('plant', chill.x0 + 0.55, chill.z1 - 0.55, 0, 'chill');

  return { zones, furniture, seats, spots, walls, windows, blocked: buildNav(furniture, walls) };
}

/** Footprint (width along x, depth along z) of each item before rotation. */
const SIZE: Partial<Record<FurnType, [number, number]>> = {
  desk: [1.4, 0.7],
  divider: [4.6, 0.12],
  plant: [0.5, 0.5],
  tallPlant: [0.6, 0.6],
  shelf: [1.0, 0.4],
  rack: [0.7, 0.9],
  whiteboard: [1.4, 0.4],
  tv: [1.4, 0.4],
  arcade: [0.8, 0.8],
  easel: [0.8, 0.6],
  printer3d: [0.8, 0.8],
  pedestal: [0.6, 0.6],
  camera: [0.8, 0.8],
  softbox: [0.7, 0.7],
  safe: [0.8, 0.7],
  sofa: [2.0, 0.9],
  armchair: [0.9, 0.85],
  coffeeTable: [1.0, 0.6],
  counter: [3.6, 0.7],
  standTable: [0.7, 0.7],
  meetingTable: [3.4, 1.4],
  pingpong: [2.74, 1.52],
  cooler: [0.4, 0.4],
  bench: [1.6, 0.5],
  planter: [1.0, 1.0],
  fridge: [0.7, 0.7],
};

function buildNav(furniture: Furn[], walls: WallSeg[]): Uint8Array {
  const blocked = new Uint8Array(NW * ND);
  const fill = (x0: number, z0: number, x1: number, z1: number) => {
    for (let gz = Math.max(0, Math.floor(z0 / CELL)); gz <= Math.min(ND - 1, Math.floor((z1 - 1e-3) / CELL)); gz++)
      for (let gx = Math.max(0, Math.floor(x0 / CELL)); gx <= Math.min(NW - 1, Math.floor((x1 - 1e-3) / CELL)); gx++) blocked[gz * NW + gx] = 1;
  };
  for (const f of furniture) {
    const size = SIZE[f.type];
    if (!size) continue;
    const swap = Math.abs(Math.sin(f.rot)) > 0.5;
    const w = swap ? size[1] : size[0];
    const d = swap ? size[0] : size[1];
    fill(f.x - w / 2 + 0.05, f.z - d / 2 + 0.05, f.x + w / 2 - 0.05, f.z + d / 2 - 0.05);
  }
  for (const s of walls) {
    if (s.x1 === s.x2) fill(s.x1 - 0.2, Math.min(s.z1, s.z2), s.x1 + 0.2, Math.max(s.z1, s.z2));
    else fill(Math.min(s.x1, s.x2), s.z1 - 0.2, Math.max(s.x1, s.x2), s.z1 + 0.2);
  }
  // Outer edges and the elevator shaft (its door side stays open for boarding).
  fill(0, 0, W, 0.3);
  fill(0, 0, 0.3, D);
  fill(0, D - 0.3, W, D);
  fill(W - 0.3, 0, W, D);
  const e = ELEVATOR;
  fill(e.x - e.size / 2, e.z - e.size / 2, e.x + e.size / 2, e.z + e.size / 2 - 0.6);
  return blocked;
}

export function navIndex(x: number, z: number): number {
  const gx = Math.max(0, Math.min(NW - 1, Math.floor(x / CELL)));
  const gz = Math.max(0, Math.min(ND - 1, Math.floor(z / CELL)));
  return gz * NW + gx;
}

export function cellCenter(i: number): { x: number; z: number } {
  return { x: ((i % NW) + 0.5) * CELL, z: (Math.floor(i / NW) + 0.5) * CELL };
}
