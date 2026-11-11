// Character simulation: who sits where, walking between rooms, entering/leaving, speech bubbles.

import type { RoomId } from '../../../shared/rooms.ts';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { type Look, lookFor, type Pose, type View } from './character.ts';
import { hashString } from './iso.ts';
import { buildOffice, idx, type OfficeMap, type Seat } from './map.ts';
import { findPath, type Step } from './path.ts';

export type BubbleKind = 'say' | 'think' | 'action' | 'ask' | 'idle';

export interface Bubble {
  text: string;
  kind: BubbleKind;
  start: number;
  end: number;
}

export interface Character {
  id: string;
  agent: AgentSnapshot;
  look: Look;
  x: number;
  y: number;
  path: Step[];
  seat: Seat | null;
  spot: Step | null;
  mode: 'walk' | 'sit' | 'stand' | 'leave' | 'gone';
  view: View;
  flip: boolean;
  alpha: number;
  leaving: boolean;
  bubble: Bubble | null;
  nextBubbleAt: number;
  nextWanderAt: number;
  phase: number;
  targetKey: string;
  walkTime: number;
}

const SPEED = 2.6; // tiles per second
const MAX_BUBBLES = 7;

const IDLE_LINES = [
  '☕ Refilling my context window',
  'Ready when you are!',
  'Waiting for the next prompt…',
  'Anyone seen my cached tokens?',
  'Coffee break ☕',
  'That last task went well 😌',
  'Ping me if you need me',
  'Stretching my attention heads',
  'Still here, just resting my tokens',
  'Tabs or spaces? Discuss.',
  'Who left the GPU running?',
  'I could really go for a fresh prompt',
];
const BROWSER_LINES = ['So many tabs…', 'Clicking with care 🖱️', 'Reading the page…', 'Neo, take me there!', 'Checking it in a real browser'];
const SUB_LINES = ['On it, boss… I mean, session!', 'Reporting back soon', 'Helper mode: engaged'];

export class World {
  readonly map: OfficeMap = buildOffice();
  readonly chars = new Map<string, Character>();
  private seatOwner = new Map<string, string>();
  private spotOwner = new Map<number, string>();
  private initialized = false;
  selectedId: string | null = null;
  hoverId: string | null = null;

  sync(agents: AgentSnapshot[], now: number) {
    const present = new Set<string>();
    for (const agent of agents) {
      present.add(agent.id);
      let c = this.chars.get(agent.id);
      if (!c) {
        if (agent.status === 'done') continue;
        c = this.create(agent, now, !this.initialized);
        this.chars.set(agent.id, c);
        continue;
      }
      c.agent = agent;
      if (c.leaving) continue;
      if (agent.status === 'done') {
        this.leave(c, now);
        continue;
      }
      const key = targetKey(agent);
      if (key !== c.targetKey) this.retarget(c, now, false);
    }
    for (const c of this.chars.values()) if (!present.has(c.id) && !c.leaving) this.leave(c, now);
    this.initialized = true;
  }

  private create(agent: AgentSnapshot, now: number, instant: boolean): Character {
    const h = hashString(agent.id);
    const c: Character = {
      id: agent.id,
      agent,
      look: lookFor(agent.id, agent.provider, agent.kind),
      x: this.map.spawn.x,
      y: this.map.spawn.y,
      path: [],
      seat: null,
      spot: null,
      mode: 'stand',
      view: 'front',
      flip: false,
      alpha: instant ? 1 : 0,
      leaving: false,
      bubble: null,
      nextBubbleAt: now + 1500 + (h % 6000),
      nextWanderAt: now + 6000 + (h % 9000),
      phase: (h % 1000) / 1000,
      targetKey: '',
      walkTime: 0,
    };
    this.retarget(c, now, instant);
    if (!instant) c.bubble = { text: greeting(agent), kind: 'say', start: now, end: now + 3500 };
    return c;
  }

  private release(c: Character) {
    if (c.seat && this.seatOwner.get(c.seat.id) === c.id) this.seatOwner.delete(c.seat.id);
    if (c.spot) {
      const k = idx(c.spot.x, c.spot.y);
      if (this.spotOwner.get(k) === c.id) this.spotOwner.delete(k);
    }
    c.seat = null;
    c.spot = null;
  }

  private retarget(c: Character, now: number, instant: boolean) {
    this.release(c);
    const agent = c.agent;
    c.targetKey = targetKey(agent);
    const room = agent.room;
    const wantSeatKinds: Seat['kind'][] = room === 'lounge' ? ['sofa', 'stool'] : ['desk'];
    const seat = this.freeSeat(room, wantSeatKinds, c.id);
    let target: Step | null = null;
    if (seat) {
      c.seat = seat;
      this.seatOwner.set(seat.id, c.id);
      target = { x: seat.x, y: seat.y };
    } else {
      const spot = this.freeSpot(room, c.id, now);
      if (spot) {
        c.spot = spot;
        this.spotOwner.set(idx(spot.x, spot.y), c.id);
        target = spot;
      }
    }
    if (!target) return;
    if (instant) {
      c.x = target.x;
      c.y = target.y;
      c.path = [];
      this.arrive(c);
      return;
    }
    const path = findPath(this.map.walkable, { x: c.x, y: c.y }, target);
    if (path) {
      c.path = path;
      c.mode = 'walk';
    } else {
      c.x = target.x;
      c.y = target.y;
      this.arrive(c);
    }
  }

  private freeSeat(room: RoomId, kinds: Seat['kind'][], id: string): Seat | null {
    const seats = this.map.seats.filter((s) => s.room === room && kinds.includes(s.kind) && !this.seatOwner.has(s.id));
    if (!seats.length) return null;
    // Stable preference per agent so characters return to "their" desk.
    seats.sort((a, b) => (hashString(id + a.id) % 997) - (hashString(id + b.id) % 997));
    return seats[0];
  }

  private freeSpot(room: RoomId, id: string, now: number): Step | null {
    const area = this.map.rooms.get(room);
    if (!area) return null;
    const options: Step[] = [];
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) {
        const i = idx(x, y);
        if (!this.map.walkable[i] || this.spotOwner.has(i)) continue;
        if (this.map.seats.some((s) => s.x === x && s.y === y)) continue;
        options.push({ x, y });
      }
    }
    if (!options.length) return { x: area.x0 + 3, y: area.y0 + 2 };
    return options[(hashString(id) + Math.floor(now / 1000)) % options.length];
  }

  private leave(c: Character, now: number) {
    this.release(c);
    c.leaving = true;
    c.targetKey = 'leaving';
    const path = findPath(this.map.walkable, { x: c.x, y: c.y }, this.map.spawn);
    c.path = path ?? [];
    c.mode = 'leave';
    c.bubble = { text: c.agent.kind === 'subagent' ? 'Done! Reporting back 👋' : 'Signing off 👋', kind: 'say', start: now, end: now + 3000 };
  }

  private arrive(c: Character) {
    if (c.leaving) return;
    if (c.seat) {
      c.view = c.seat.facing === 'front' ? 'front' : 'back';
      c.mode = c.agent.status === 'waiting' && c.seat.kind === 'desk' ? 'stand' : 'sit';
      c.flip = hashString(c.id) % 2 === 0;
    } else {
      c.mode = 'stand';
      c.view = 'front';
    }
  }

  update(dt: number, now: number) {
    let activeBubbles = 0;
    for (const c of this.chars.values()) if (c.bubble && c.bubble.end > now) activeBubbles++;

    for (const c of [...this.chars.values()]) {
      // Fade in/out.
      if (c.leaving && !c.path.length) {
        c.alpha -= dt * 1.8;
        if (c.alpha <= 0) {
          c.mode = 'gone';
          this.chars.delete(c.id);
          if (this.selectedId === c.id) this.selectedId = null;
          continue;
        }
      } else if (c.alpha < 1) c.alpha = Math.min(1, c.alpha + dt * 1.6);

      // Walking.
      if (c.path.length) {
        const next = c.path[0];
        const dx = next.x - c.x;
        const dy = next.y - c.y;
        const dist = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (dist <= step) {
          c.x = next.x;
          c.y = next.y;
          c.path.shift();
          if (!c.path.length) this.arrive(c);
        } else {
          c.x += (dx / dist) * step;
          c.y += (dy / dist) * step;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          c.view = dx > 0 ? 'front' : 'back';
          c.flip = dx > 0;
        } else if (dy !== 0) {
          c.view = dy > 0 ? 'front' : 'back';
          c.flip = dy < 0;
        }
        c.walkTime += dt;
        if (c.mode !== 'leave') c.mode = 'walk';
      } else if (c.mode === 'sit' && c.agent.status === 'waiting') {
        c.mode = 'stand';
      } else if (c.mode === 'stand' && c.seat && c.agent.status !== 'waiting') {
        this.arrive(c);
      }

      // Idle characters without a seat stroll around the lounge.
      if (!c.leaving && !c.path.length && !c.seat && c.agent.status === 'idle' && now > c.nextWanderAt) {
        c.nextWanderAt = now + 9000 + Math.random() * 14000;
        const spot = this.freeSpot(c.agent.room, c.id + now, now);
        if (spot) {
          if (c.spot) this.spotOwner.delete(idx(c.spot.x, c.spot.y));
          c.spot = spot;
          this.spotOwner.set(idx(spot.x, spot.y), c.id);
          c.path = findPath(this.map.walkable, { x: c.x, y: c.y }, spot) ?? [];
          if (c.path.length) c.mode = 'walk';
        }
      }

      // Speech bubbles.
      if (c.bubble && c.bubble.end <= now) c.bubble = null;
      const priority = c.id === this.selectedId || c.id === this.hoverId;
      if (!c.bubble && !c.leaving && now >= c.nextBubbleAt && (activeBubbles < MAX_BUBBLES || priority)) {
        const line = pickLine(c.agent, now);
        c.nextBubbleAt = now + (c.agent.status === 'working' ? 5000 : 9000) + Math.random() * 9000;
        if (line) {
          const duration = Math.min(8000, 3200 + line.text.length * 45);
          c.bubble = { ...line, start: now, end: now + duration };
          activeBubbles++;
        }
      }
    }
  }

  /** Pose to draw this frame. */
  pose(c: Character, now: number): Pose {
    if (c.mode === 'walk' || c.mode === 'leave') {
      if (!c.path.length) return 'stand';
      return Math.floor(c.walkTime * 6) % 2 === 0 ? 'walk0' : 'walk1';
    }
    if (c.mode === 'sit') {
      if (c.agent.status === 'working' && c.seat?.kind === 'desk') return Math.floor(now / 180 + c.phase * 7) % 2 === 0 ? 'type0' : 'type1';
      return 'sit';
    }
    if (c.agent.status === 'waiting') return Math.floor(now / 600 + c.phase * 3) % 3 === 0 ? 'cheer' : 'stand';
    return 'stand';
  }

  occupancy(): Map<RoomId, number> {
    const counts = new Map<RoomId, number>();
    for (const c of this.chars.values()) {
      if (c.leaving) continue;
      counts.set(c.agent.room, (counts.get(c.agent.room) ?? 0) + 1);
    }
    return counts;
  }
}

function targetKey(agent: AgentSnapshot): string {
  return `${agent.room}|${agent.status === 'waiting' ? 'working' : agent.status}`;
}

function greeting(agent: AgentSnapshot): string {
  if (agent.kind === 'subagent') return `Hi! I'm helping with ${agent.role ?? 'a task'}`;
  return agent.status === 'working' ? 'Morning! Getting to work 💼' : 'Hello office 👋';
}

function pickLine(agent: AgentSnapshot, now: number): { text: string; kind: BubbleKind } | null {
  const rand = Math.random();
  if (agent.status === 'waiting') return { text: agent.attention?.reason ?? agent.activity ?? 'Waiting for you', kind: 'ask' };
  if (agent.status === 'idle') {
    if (rand < 0.45) return { text: IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)], kind: 'idle' };
    const ask = agent.lines.filter((l) => l.kind === 'ask').at(-1);
    if (ask && rand < 0.7) return { text: ask.text, kind: 'ask' };
    const say = agent.lines.filter((l) => l.kind === 'say').at(-1);
    return say ? { text: say.text, kind: 'say' } : { text: 'Ready for the next task', kind: 'idle' };
  }
  if (agent.status !== 'working') return null;
  if (agent.usingBrowser && rand < 0.25) return { text: BROWSER_LINES[Math.floor(Math.random() * BROWSER_LINES.length)], kind: 'think' };
  if (agent.kind === 'subagent' && rand < 0.12) return { text: SUB_LINES[Math.floor(Math.random() * SUB_LINES.length)], kind: 'say' };
  const fresh = agent.lines.filter((l) => now - l.at < 15 * 60_000).slice(-6);
  if (rand < 0.35 || !fresh.length) return { text: agent.activity, kind: 'action' };
  const line = fresh[Math.floor(Math.random() * fresh.length)];
  return { text: line.text, kind: line.kind === 'ask' ? 'ask' : line.kind };
}
