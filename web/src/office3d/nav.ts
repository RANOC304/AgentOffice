// A* on the 0.5 m navigation grid with a binary heap (8 directions, no corner cutting).

import { CELL, cellCenter, navIndex, ND, NW } from './layout.ts';

export interface P {
  x: number;
  z: number;
}

export class Nav {
  private blocked: Uint8Array;
  private g = new Float32Array(NW * ND);
  private came = new Int32Array(NW * ND);
  private stamp = new Uint32Array(NW * ND);
  private closed = new Uint32Array(NW * ND);
  private run = 0;

  constructor(blocked: Uint8Array) {
    this.blocked = blocked;
  }

  free(i: number) {
    return this.blocked[i] === 0;
  }

  /** Nearest walkable cell to a point (breadth-first). */
  nearestFree(x: number, z: number): number {
    const start = navIndex(x, z);
    if (this.free(start)) return start;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const c = queue.shift()!;
      const cx = c % NW;
      const cz = Math.floor(c / NW);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= NW || nz >= ND) continue;
        const n = nz * NW + nx;
        if (seen.has(n)) continue;
        if (this.free(n)) return n;
        seen.add(n);
        queue.push(n);
      }
    }
    return start;
  }

  path(from: P, to: P): P[] {
    const start = this.nearestFree(from.x, from.z);
    const goal = this.nearestFree(to.x, to.z);
    const run = ++this.run;
    const heap: number[] = [];
    const f = new Map<number, number>();
    const push = (i: number, score: number) => {
      f.set(i, score);
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f.get(heap[p])! <= f.get(heap[k])!) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && f.get(heap[l])! < f.get(heap[m])!) m = l;
          if (r < heap.length && f.get(heap[r])! < f.get(heap[m])!) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const gx = goal % NW;
    const gz = Math.floor(goal / NW);
    const h = (i: number) => {
      const dx = Math.abs((i % NW) - gx);
      const dz = Math.abs(Math.floor(i / NW) - gz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    this.stamp[start] = run;
    this.g[start] = 0;
    this.came[start] = -1;
    push(start, h(start));
    let found = false;
    let guard = 0;
    while (heap.length && guard++ < 40000) {
      const c = pop();
      if (this.closed[c] === run) continue;
      this.closed[c] = run;
      if (c === goal) {
        found = true;
        break;
      }
      const cx = c % NW;
      const cz = Math.floor(c / NW);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= NW || nz >= ND) continue;
          const n = nz * NW + nx;
          if (!this.free(n) || this.closed[n] === run) continue;
          if (dx && dz && (!this.free(cz * NW + nx) || !this.free(nz * NW + cx))) continue;
          const cost = this.g[c] + (dx && dz ? 1.414 : 1);
          if (this.stamp[n] !== run || cost < this.g[n]) {
            this.stamp[n] = run;
            this.g[n] = cost;
            this.came[n] = c;
            push(n, cost + h(n));
          }
        }
      }
    }
    if (!found) return [to];
    const cells: number[] = [];
    for (let c = goal; c !== -1 && c !== start; c = this.came[c]) cells.push(c);
    cells.reverse();
    // Drop points on straight runs.
    const pts: P[] = [];
    for (let i = 0; i < cells.length; i++) {
      const prev = i > 0 ? cells[i - 1] : start;
      const next = cells[i + 1];
      if (next !== undefined) {
        const d1 = cells[i] - prev;
        const d2 = next - cells[i];
        if (d1 === d2) continue;
      }
      pts.push(cellCenter(cells[i]));
    }
    pts.push({ x: to.x, z: to.z });
    return pts;
  }
}

export { CELL };
