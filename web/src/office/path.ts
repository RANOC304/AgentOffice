// A* path finding on the office tile grid (4-directional, so walking follows the isometric axes).

import { GH, GW, idx, inGrid } from './map.ts';

export interface Step {
  x: number;
  y: number;
}

export function findPath(walkable: Uint8Array, from: Step, to: Step): Step[] | null {
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  if (!inGrid(sx, sy) || !inGrid(to.x, to.y)) return null;
  const start = idx(sx, sy);
  const goal = idx(to.x, to.y);
  if (start === goal) return [{ x: to.x, y: to.y }];

  const size = GW * GH;
  const g = new Float32Array(size).fill(Infinity);
  const came = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open: number[] = [start];
  const f = new Float32Array(size).fill(Infinity);
  g[start] = 0;
  f[start] = Math.abs(to.x - sx) + Math.abs(to.y - sy);

  const passable = (i: number) => walkable[i] === 1 || i === goal || i === start;

  while (open.length) {
    let best = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[best]]) best = k;
    const current = open[best];
    open.splice(best, 1);
    if (current === goal) break;
    closed[current] = 1;
    const cx = current % GW;
    const cy = Math.floor(current / GW);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inGrid(nx, ny)) continue;
      const n = idx(nx, ny);
      if (closed[n] || !passable(n)) continue;
      // Slight preference for continuing straight keeps paths tidy.
      const turn = came[current] >= 0 && came[current] !== current - dx - dy * GW ? 0.15 : 0;
      const cost = g[current] + 1 + turn;
      if (cost < g[n]) {
        g[n] = cost;
        f[n] = cost + Math.abs(to.x - nx) + Math.abs(to.y - ny);
        came[n] = current;
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  if (came[goal] < 0) return null;
  const path: Step[] = [];
  for (let c = goal; c !== start && c >= 0; c = came[c]) path.push({ x: c % GW, y: Math.floor(c / GW) });
  return path.reverse();
}
