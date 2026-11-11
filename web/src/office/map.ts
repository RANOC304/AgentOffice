// Office floor plan: a 4×4 grid of rooms separated by low partitions with doorways,
// tall back walls, a front entrance into the open space, and furniture per room.

import { ROOMS, type RoomDef, type RoomId } from '../../../shared/rooms.ts';

export const COLS = 4;
export const ROWS = 4;
export const CW = 8; // cell width in tiles (7 interior + 1 wall)
export const CH = 7; // cell height in tiles (6 interior + 1 wall)
export const W = COLS * CW + 1; // 33
export const H = ROWS * CH + 1; // 29
/** Pathing grid includes three rows in front of the building for the entrance porch. */
export const GW = W;
export const GH = H + 3;

export type FurnitureType =
  | 'desk'
  | 'chair'
  | 'plant'
  | 'smallPlant'
  | 'shelf'
  | 'rack'
  | 'whiteboard'
  | 'screen'
  | 'globe'
  | 'safe'
  | 'arcade'
  | 'easel'
  | 'printer'
  | 'pedestal'
  | 'camera'
  | 'light'
  | 'sofa'
  | 'stool'
  | 'table'
  | 'counter'
  | 'vending'
  | 'cooler'
  | 'reception'
  | 'tree'
  | 'pine'
  | 'bush';

export interface Item {
  type: FurnitureType;
  x: number;
  y: number;
  room: RoomId | null;
  /** Monitor faces the viewer (seat is in front of the desk). */
  screenFront?: boolean;
  /** Chair/sofa facing: +1 toward +y (front), −1 toward −y (back). */
  facing?: 1 | -1;
  blocks: boolean;
  seed: number;
}

export interface Seat {
  id: string;
  x: number;
  y: number;
  room: RoomId;
  /** Direction the sitter looks: 'front' (toward viewer, +y) or 'back' (−y). */
  facing: 'front' | 'back';
  kind: 'desk' | 'sofa' | 'stool';
  desk?: Item;
}

export interface RoomArea {
  def: RoomDef;
  x0: number;
  y0: number;
  x1: number; // inclusive interior bounds
  y1: number;
}

export interface OfficeMap {
  walkable: Uint8Array;
  wall: Uint8Array; // 0 none, 1 partition, 2 back wall, 3 front glass
  roomOf: (RoomId | null)[];
  items: Item[];
  seats: Seat[];
  rooms: Map<RoomId, RoomArea>;
  spawn: { x: number; y: number };
  door: { x: number; y: number };
}

export const idx = (x: number, y: number) => y * GW + x;
export const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < GW && y < GH;

const BASE = ['DD...DD', 'bb...bb', '.......', '.......', 'ff...ff', 'DD...DD'];
const LOUNGE = ['KK...VP', 'uu...oo', '...T...', '...T...', 'oo...oo', 'Pt...tw'];
const LOBBY = ['DD...QQ', 'bb.....', '.......', '.......', 'ff...oo', 'DD...tP'];

type Glyph = string;
interface RoomSpec {
  template?: string[];
  center: [Glyph, Glyph];
  pool: Glyph[];
}

const SPECS: Record<RoomId, RoomSpec> = {
  web: { center: ['G', 'P'], pool: ['S', 'P', 'W'] },
  backend: { center: ['R', 'R'], pool: ['R', 'P', 'W'] },
  data: { center: ['W', 'R'], pool: ['S', 'W', 'P'] },
  devops: { center: ['G', 'R'], pool: ['R', 'R', 'P'] },
  mobile: { center: ['G', 'P'], pool: ['S', 'P', 'W'] },
  browser: { center: ['H', '.'], pool: ['G', 'P', 'G'] },
  security: { center: ['X', 'R'], pool: ['R', 'S', 'P'] },
  systems: { center: ['R', 'W'], pool: ['S', 'R', 'P'] },
  gamedev: { center: ['A', 'A'], pool: ['A', 'P', 'S'] },
  research: { center: ['S', 'S'], pool: ['S', 'S', 'P'] },
  lounge: { template: LOUNGE, center: ['T', 'T'], pool: ['P', 'V', 'P'] },
  writing: { center: ['S', 'P'], pool: ['S', 'W', 'P'] },
  threed: { center: ['3', 'c'], pool: ['c', 'P', '3'] },
  media: { center: ['M', 'L'], pool: ['L', 'P', 'M'] },
  design: { center: ['E', 'E'], pool: ['P', 'E', 'W'] },
  lobby: { template: LOBBY, center: ['.', '.'], pool: ['P', 'p', 'P'] },
};

const GLYPH: Record<string, FurnitureType> = {
  P: 'plant',
  p: 'smallPlant',
  S: 'shelf',
  R: 'rack',
  W: 'whiteboard',
  G: 'screen',
  H: 'globe',
  X: 'safe',
  A: 'arcade',
  E: 'easel',
  '3': 'printer',
  c: 'pedestal',
  M: 'camera',
  L: 'light',
  T: 'table',
  t: 'table',
  K: 'counter',
  V: 'vending',
  w: 'cooler',
  Q: 'reception',
};

export function buildOffice(): OfficeMap {
  const walkable = new Uint8Array(GW * GH);
  const wall = new Uint8Array(GW * GH);
  const roomOf: (RoomId | null)[] = new Array(GW * GH).fill(null);
  const items: Item[] = [];
  const seats: Seat[] = [];
  const rooms = new Map<RoomId, RoomArea>();
  let seed = 1;

  // Floor and walls.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const isWall = x % CW === 0 || y % CH === 0;
      if (!isWall) {
        walkable[idx(x, y)] = 1;
        continue;
      }
      if (x === 0 || y === 0) wall[idx(x, y)] = 2;
      else if (x === W - 1 || y === H - 1) wall[idx(x, y)] = 3;
      else wall[idx(x, y)] = 1;
    }
  }
  const byCell = new Map<string, RoomDef>();
  for (const def of ROOMS) byCell.set(def.cell.join(','), def);

  // Doors between neighbouring rooms.
  const openDoor = (x: number, y: number) => {
    wall[idx(x, y)] = 0;
    walkable[idx(x, y)] = 1;
  };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c < COLS - 1) for (const dy of [3, 4]) openDoor((c + 1) * CW, r * CH + dy);
      if (r < ROWS - 1) for (const dx of [3, 4, 5]) openDoor(c * CW + dx, (r + 1) * CH);
    }
  }
  // Front entrance into the open space, and the porch outside it.
  const lobby = ROOMS.find((d) => d.id === 'lobby')!;
  const ex = lobby.cell[0] * CW;
  for (const dx of [3, 4, 5]) openDoor(ex + dx, H - 1);
  for (let y = H; y < GH; y++) for (let x = ex + 2; x <= ex + 6; x++) walkable[idx(x, y)] = 1;

  // Rooms.
  for (const def of ROOMS) {
    const [c, r] = def.cell;
    const x0 = c * CW + 1;
    const y0 = r * CH + 1;
    const area: RoomArea = { def, x0, y0, x1: x0 + 6, y1: y0 + 5 };
    rooms.set(def.id, area);
    for (let y = y0; y <= area.y1; y++) for (let x = x0; x <= area.x1; x++) roomOf[idx(x, y)] = def.id;

    const spec = SPECS[def.id];
    const rows = (spec.template ?? BASE).map((row) => row.split(''));
    rows[2][3] = rows[2][3] === '.' ? spec.center[0] : rows[2][3];
    rows[3][3] = rows[3][3] === '.' ? spec.center[1] : rows[3][3];
    // Walls without a doorway get decor in the cells a doorway would have used.
    const pool = spec.pool;
    let pi = 0;
    const next = (front: boolean) => (front ? (pi++ % 2 === 0 ? 'P' : 'p') : pool[pi++ % pool.length]);
    const isLobby = def.id === 'lobby';
    if (r === 0) for (const lx of [2, 3, 4]) if (rows[0][lx] === '.') rows[0][lx] = next(false);
    if (c === 0) for (const ly of [2, 3]) if (rows[ly][0] === '.') rows[ly][0] = next(false);
    if (c === COLS - 1) for (const ly of [2, 3]) if (rows[ly][6] === '.') rows[ly][6] = next(true);
    if (r === ROWS - 1 && !isLobby) for (const lx of [2, 4]) if (rows[5][lx] === '.') rows[5][lx] = next(true);

    for (let ly = 0; ly < 6; ly++) {
      for (let lx = 0; lx < 7; lx++) {
        const g = rows[ly][lx];
        const x = x0 + lx;
        const y = y0 + ly;
        if (g === '.') continue;
        if (g === 'b' || g === 'f' || g === 'u' || g === 'o') {
          const facing = g === 'b' || g === 'u' ? 'back' : 'front';
          const kind = g === 'o' ? 'sofa' : g === 'u' ? 'stool' : 'desk';
          const seat: Seat = { id: `${def.id}:${lx},${ly}`, x, y, room: def.id, facing, kind };
          seats.push(seat);
          items.push({
            type: kind === 'sofa' ? 'sofa' : kind === 'stool' ? 'stool' : 'chair',
            x,
            y,
            room: def.id,
            facing: facing === 'front' ? 1 : -1,
            blocks: false,
            seed: seed++,
          });
          continue;
        }
        if (g === 'D') {
          const below = rows[ly + 1]?.[lx];
          items.push({ type: 'desk', x, y, room: def.id, screenFront: below === 'b', blocks: true, seed: seed++ });
          walkable[idx(x, y)] = 0;
          continue;
        }
        const type = GLYPH[g];
        if (!type) continue;
        items.push({ type, x, y, room: def.id, blocks: true, seed: seed++ });
        walkable[idx(x, y)] = 0;
      }
    }
  }
  // Link desk seats to their desks.
  for (const seat of seats) {
    if (seat.kind !== 'desk') continue;
    const dy = seat.facing === 'back' ? -1 : 1;
    seat.desk = items.find((i) => i.type === 'desk' && i.x === seat.x && i.y === seat.y + dy);
  }
  for (let i = 0; i < GW * GH; i++) if (wall[i]) walkable[i] = 0;

  return {
    walkable,
    wall,
    roomOf,
    items,
    seats,
    rooms,
    spawn: { x: ex + 4, y: GH - 1 },
    door: { x: ex + 4, y: H - 1 },
  };
}

/** Decorative outdoor trees around the island (not part of the pathing grid). */
export function outdoorItems(): Item[] {
  const spots: Array<[FurnitureType, number, number]> = [
    ['pine', -2, 3],
    ['tree', -2, 9],
    ['pine', -2, 16],
    ['bush', -2, 21],
    ['tree', -2, 26],
    ['pine', 4, -2],
    ['tree', 13, -2],
    ['pine', 21, -2],
    ['bush', 28, -2],
    ['tree', W + 1, 4],
    ['pine', W + 1, 11],
    ['bush', W + 1, 18],
    ['tree', W + 1, 24],
    ['pine', 3, H + 1],
    ['bush', 9, H + 1],
    ['tree', 15, H + 2],
    ['bush', 21, H + 1],
    ['pine', W + 1, H + 1],
    ['bush', 30, H + 2],
  ];
  return spots.map(([type, x, y], i) => ({ type, x, y, room: null, blocks: false, seed: 900 + i }));
}
