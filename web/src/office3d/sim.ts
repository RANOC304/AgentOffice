// Character behaviour. Working agents sit at a desk in their domain room and type; agents that need
// you stand up and wave; idle agents take coffee, chat with each other, play ping-pong, sit on sofas,
// look out of the window or watch the Neo screen. Everyone arrives and leaves by the elevator.

import type { RoomId } from '../../../shared/rooms.ts';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { BOTTOM, type Elevator } from './elevator.ts';
import { cellCenter, ELEVATOR, type Layout, type Seat, type Spot } from './layout.ts';
import { hash, lookFor } from './look.ts';
import type { Nav, P } from './nav.ts';
import { Person, type Prop } from './person.ts';
import { pose, type PoseName } from './poses.ts';

const FLOOR_Y = 0.02;
const WALK = 2.1;

type Mode = 'hidden' | 'riding' | 'stepping' | 'walking' | 'acting' | 'queue';
type ActKind = 'work' | 'wait' | 'brew' | 'coffee' | 'chat' | 'meeting' | 'sofa' | 'window' | 'pingpong' | 'arcade' | 'watch' | 'stand' | 'leave';

interface Act {
  kind: ActKind;
  seat?: Seat;
  spot?: Spot;
  x: number;
  z: number;
  heading: number;
  until: number;
  partner?: string;
  prop: Prop;
}

export interface Bubble {
  text: string;
  kind: 'say' | 'think' | 'action' | 'ask' | 'idle';
  until: number;
}

export interface Char {
  id: string;
  agent: AgentSnapshot;
  person: Person;
  x: number;
  z: number;
  y: number;
  heading: number;
  path: P[];
  mode: Mode;
  act: Act | null;
  pending: Act | null;
  wantKey: string;
  walkPhase: number;
  phase: number;
  step?: { from: P; to: P; t: number; dur: number; then: () => void };
  slot: number;
  bubble: Bubble | null;
  nextBubbleAt: number;
  speaking: boolean;
  nextSwap: number;
}

const IDLE_LINES = [
  'Coffee first, then the next prompt ☕',
  'Ready when you are!',
  'Anyone seen my cached tokens?',
  'That last task went well 😌',
  'Ping me if you need me',
  'Stretching my attention heads',
  'Tabs or spaces? Discuss.',
  'Who left the GPU running?',
];
const CHAT_OPENERS = [
  'Hey {p}, how is {project} going?',
  '{p}! Did your tests pass?',
  'Busy day, {p}?',
  'What are you working on, {p}?',
  'This coffee is excellent, {p}.',
];
const CHAT_REPLIES = ['All green on my side ✅', 'Just shipped a fix 🚀', 'Waiting for the next prompt', 'Still thinking about it 🤔', 'Refactoring, as usual', 'Pretty good, thanks!'];
const PINGPONG = ['Nice shot! 🏓', 'Point for me!', 'Rematch?', 'Watch this spin'];

export class Sim {
  readonly chars = new Map<string, Char>();
  private seatOwner = new Map<string, string>();
  private spotOwner = new Map<string, string>();
  private initialized = false;
  private layout: Layout;
  private nav: Nav;
  private elevator: Elevator;
  private addToScene: (c: Char) => void;
  private removeFromScene: (c: Char) => void;
  selectedId: string | null = null;
  hoverId: string | null = null;

  constructor(layout: Layout, nav: Nav, elevator: Elevator, add: (c: Char) => void, remove: (c: Char) => void) {
    this.layout = layout;
    this.nav = nav;
    this.elevator = elevator;
    this.addToScene = add;
    this.removeFromScene = remove;
  }

  // ------------------------------------------------------------------ sync with data

  sync(agents: AgentSnapshot[], now: number) {
    const present = new Set<string>();
    for (const agent of agents) {
      present.add(agent.id);
      let c = this.chars.get(agent.id);
      if (!c) {
        if (agent.status === 'done') continue;
        c = this.create(agent, now);
        continue;
      }
      c.agent = agent;
      const leaving = isLeaving(c);
      if (agent.status === 'done') {
        if (!leaving && c.mode !== 'hidden' && c.mode !== 'riding' && c.mode !== 'stepping') this.leave(c, now);
        continue;
      }
      if (leaving && !this.elevator.isRiding(c.id) && c.mode !== 'stepping' && c.mode !== 'riding') {
        // Came back before boarding: cancel the departure.
        this.elevator.cancel(c.id);
        this.decide(c, now, false);
        continue;
      }
      const key = wantKey(agent);
      if (key !== c.wantKey && (c.mode === 'acting' || c.mode === 'walking')) this.decide(c, now, false);
    }
    for (const c of this.chars.values()) {
      if (present.has(c.id)) continue;
      if (!isLeaving(c) && c.mode !== 'hidden' && c.mode !== 'riding' && c.mode !== 'stepping') this.leave(c, now);
      if (c.mode === 'hidden') {
        this.elevator.cancel(c.id);
        this.destroy(c);
      }
    }
    this.initialized = true;
  }

  private create(agent: AgentSnapshot, now: number): Char {
    const person = new Person(lookFor(agent.id, agent.provider, agent.kind));
    const h = hash(agent.id);
    const c: Char = {
      id: agent.id,
      agent,
      person,
      x: ELEVATOR.x,
      z: ELEVATOR.z,
      y: FLOOR_Y,
      heading: 0,
      path: [],
      mode: 'hidden',
      act: null,
      pending: null,
      wantKey: '',
      walkPhase: 0,
      phase: (h % 1000) / 100,
      slot: 0,
      bubble: null,
      nextBubbleAt: now + 2000 + (h % 6000),
      speaking: false,
      nextSwap: 0,
    };
    this.chars.set(agent.id, c);
    this.addToScene(c);
    if (!this.initialized) {
      this.decide(c, now, true);
    } else {
      person.root.visible = false;
      this.elevator.requestArrival(c.id);
    }
    return c;
  }

  private destroy(c: Char) {
    this.releaseAll(c);
    this.chars.delete(c.id);
    this.removeFromScene(c);
    c.person.dispose();
    if (this.selectedId === c.id) this.selectedId = null;
  }

  // ------------------------------------------------------------------ elevator hooks

  readonly hooks = {
    load: (ids: string[]) => {
      ids.forEach((id, i) => {
        const c = this.chars.get(id);
        if (!c) return;
        const s = this.elevator.slot(i);
        c.mode = 'riding';
        c.slot = i;
        c.x = s.x;
        c.z = s.z;
        c.heading = 0;
        c.person.root.visible = true;
      });
    },
    unload: (ids: string[]) => {
      ids.forEach((id, i) => {
        const c = this.chars.get(id);
        if (!c) return;
        const to = this.elevator.exitSpot(i);
        c.mode = 'stepping';
        c.step = {
          from: { x: c.x, z: c.z },
          to,
          t: -i * 0.35,
          dur: 1.1,
          then: () => {
            c.mode = 'acting';
            c.act = null;
            c.bubble = { text: greeting(c.agent), kind: 'say', until: performance.now() + 3800 };
            this.decide(c, Date.now(), false);
          },
        };
      });
    },
    board: (ids: string[]) => {
      ids.forEach((id, i) => {
        const c = this.chars.get(id);
        if (!c) return;
        const to = this.elevator.slot(i);
        c.slot = i;
        c.mode = 'stepping';
        c.step = {
          from: { x: c.x, z: c.z },
          to,
          t: -i * 0.25,
          dur: 1.2,
          then: () => {
            c.mode = 'riding';
            c.heading = 0;
          },
        };
      });
    },
    remove: (ids: string[]) => {
      for (const id of ids) {
        const c = this.chars.get(id);
        if (c) this.destroy(c);
      }
    },
  };

  // ------------------------------------------------------------------ decisions

  private decide(c: Char, now: number, instant: boolean) {
    const a = c.agent;
    c.wantKey = wantKey(a);
    if (a.status === 'done') return this.leave(c, now);
    if (a.status === 'working' || a.status === 'waiting') {
      const room = deskRoom(a.room);
      const seat = this.claimSeat(c, room, ['desk']) ?? this.claimSeat(c, 'general', ['desk']);
      if (seat) return this.goTo(c, { kind: a.status === 'working' ? 'work' : 'wait', seat, x: seat.x, z: seat.z, heading: seat.heading, until: Infinity, prop: null }, instant);
      return this.goTo(c, this.standIn(c, room, now), instant);
    }
    this.leisure(c, now, instant);
  }

  private leisure(c: Char, now: number, instant: boolean) {
    this.releaseAll(c);
    const r = Math.random();
    const options: Array<[number, () => Act | null]> = [
      [3, () => this.coffeeAct(c, now)],
      [4, () => this.pairAct(c, now, 'chat')],
      [1.6, () => this.pairAct(c, now, 'pingpong')],
      [2, () => this.meetingAct(c, now)],
      [3, () => this.sofaAct(c, now)],
      [1.2, () => this.spotAct(c, now, 'window', 'window', 14_000 + r * 12_000)],
      [1.2, () => this.spotAct(c, now, 'arcade', 'arcade', 18_000 + r * 15_000)],
      [0.8, () => this.spotAct(c, now, 'watch', 'watch', 12_000 + r * 10_000)],
    ];
    const total = options.reduce((s, [w]) => s + w, 0);
    let pick = Math.random() * total;
    const ordered: Array<() => Act | null> = [];
    for (const [w, fn] of options) {
      if (pick < w && !ordered.length) ordered.push(fn);
      pick -= w;
    }
    ordered.push(...options.map(([, fn]) => fn));
    for (const fn of ordered) {
      const act = fn();
      if (act) return this.goTo(c, act, instant);
    }
    this.goTo(c, this.standIn(c, 'cafe', now), instant);
  }

  private coffeeAct(c: Char, now: number): Act | null {
    const spot = this.claimSpot(c, (s) => s.kind === 'coffee');
    if (!spot) return null;
    return { kind: 'brew', spot, x: spot.x, z: spot.z, heading: spot.heading, until: now + 4500, prop: null };
  }

  private sofaAct(c: Char, now: number): Act | null {
    const seat = this.claimSeat(c, null, ['sofa', 'beanbag', 'bench']);
    if (!seat) return null;
    return { kind: 'sofa', seat, x: seat.x, z: seat.z, heading: seat.heading, until: now + 25_000 + Math.random() * 30_000, prop: Math.random() > 0.4 ? 'phone' : null };
  }

  private spotAct(c: Char, now: number, kind: Spot['kind'], act: ActKind, duration: number): Act | null {
    const spot = this.claimSpot(c, (s) => s.kind === kind);
    if (!spot) return null;
    return { kind: act, spot, x: spot.x, z: spot.z, heading: spot.heading, until: now + duration, prop: null };
  }

  /** Two idle agents meet: a chat at a standing table, or a ping-pong game. */
  private pairAct(c: Char, now: number, kind: 'chat' | 'pingpong'): Act | null {
    const partner = this.freePartner(c);
    if (!partner) return null;
    const spotKind = kind === 'chat' ? 'chat' : 'pingpong';
    const free = this.layout.spots.filter((s) => s.kind === spotKind && s.pair && !this.spotOwner.has(s.id) && !this.spotOwner.has(s.pair));
    if (!free.length) return null;
    const mine = free[Math.floor(Math.random() * free.length)];
    const theirs = this.layout.spots.find((s) => s.id === mine.pair)!;
    const until = now + (kind === 'chat' ? 22_000 + Math.random() * 18_000 : 30_000 + Math.random() * 25_000);
    this.releaseAll(partner);
    this.spotOwner.set(mine.id, c.id);
    this.spotOwner.set(theirs.id, partner.id);
    const prop: Prop = kind === 'pingpong' ? 'paddle' : null;
    this.goTo(partner, { kind, spot: theirs, x: theirs.x, z: theirs.z, heading: theirs.heading, until, partner: c.id, prop: partner.act?.prop === 'cup' && kind === 'chat' ? 'cup' : prop }, false);
    c.speaking = true;
    partner.speaking = false;
    return { kind, spot: mine, x: mine.x, z: mine.z, heading: mine.heading, until, partner: partner.id, prop };
  }

  /** Two idle agents sit across the meeting table and talk. */
  private meetingAct(c: Char, now: number): Act | null {
    const partner = this.freePartner(c);
    if (!partner) return null;
    const free = [0, 1, 2]
      .map((i) => [this.layout.seats.find((x) => x.id === `meeting:n${i}`), this.layout.seats.find((x) => x.id === `meeting:s${i}`)] as const)
      .filter(([a, b]) => a && b && !this.seatOwner.has(a.id) && !this.seatOwner.has(b.id));
    if (!free.length) return null;
    const [mine, theirs] = free[Math.floor(Math.random() * free.length)] as [Seat, Seat];
    const until = now + 30_000 + Math.random() * 25_000;
    this.releaseAll(partner);
    this.seatOwner.set(mine.id, c.id);
    this.seatOwner.set(theirs.id, partner.id);
    this.goTo(partner, { kind: 'meeting', seat: theirs, x: theirs.x, z: theirs.z, heading: theirs.heading, until, partner: c.id, prop: null }, false);
    c.speaking = true;
    partner.speaking = false;
    return { kind: 'meeting', seat: mine, x: mine.x, z: mine.z, heading: mine.heading, until, partner: partner.id, prop: null };
  }

  private freePartner(c: Char): Char | undefined {
    return [...this.chars.values()].find(
      (o) => o !== c && o.agent.status === 'idle' && o.mode === 'acting' && o.act && ['sofa', 'window', 'watch', 'stand', 'coffee', 'arcade'].includes(o.act.kind) && !o.act.partner,
    );
  }

  private standIn(c: Char, room: RoomId, now: number): Act {
    const zone = this.layout.zones.get(room) ?? this.layout.zones.get('cafe')!;
    for (let k = 0; k < 30; k++) {
      const x = zone.x0 + 0.8 + Math.random() * (zone.x1 - zone.x0 - 1.6);
      const z = zone.z0 + 0.8 + Math.random() * (zone.z1 - zone.z0 - 1.6);
      const cell = this.nav.nearestFree(x, z);
      const p = cellCenter(cell);
      if ([...this.chars.values()].some((o) => o !== c && Math.hypot(o.x - p.x, o.z - p.z) < 0.8)) continue;
      return { kind: 'stand', x: p.x, z: p.z, heading: Math.random() * Math.PI * 2, until: now + 15_000 + Math.random() * 15_000, prop: Math.random() > 0.6 ? 'phone' : null };
    }
    return { kind: 'stand', x: zone.x0 + 3, z: zone.z0 + 3, heading: 0, until: now + 15_000, prop: null };
  }

  private leave(c: Char, now: number) {
    this.releaseAll(c);
    const slotIndex = [...this.chars.values()].filter((o) => o !== c && isLeaving(o)).length;
    const q = this.elevator.queueSpot(slotIndex);
    c.bubble = { text: c.agent.kind === 'subagent' ? 'Done! Reporting back 👋' : 'Signing off 👋', kind: 'say', until: performance.now() + 3500 };
    this.goTo(c, { kind: 'leave', x: q.x, z: q.z, heading: Math.PI, until: Infinity, prop: null }, false);
    void now;
  }

  // ------------------------------------------------------------------ reservations

  private claimSeat(c: Char, room: RoomId | null, kinds: Seat['kind'][]): Seat | null {
    if (c.act?.seat && (room === null || c.act.seat.room === room) && kinds.includes(c.act.seat.kind)) return c.act.seat;
    const seats = this.layout.seats.filter((s) => (room === null || s.room === room) && kinds.includes(s.kind) && !this.seatOwner.has(s.id));
    if (!seats.length) return null;
    seats.sort((a, b) => (hash(c.id + a.id) % 997) - (hash(c.id + b.id) % 997));
    const seat = room === null ? seats[Math.floor(Math.random() * seats.length)] : seats[0];
    this.releaseAll(c);
    this.seatOwner.set(seat.id, c.id);
    return seat;
  }

  private claimSpot(c: Char, filter: (s: Spot) => boolean): Spot | null {
    const free = this.layout.spots.filter((s) => filter(s) && !this.spotOwner.has(s.id));
    if (!free.length) return null;
    const spot = free[Math.floor(Math.random() * free.length)];
    this.releaseAll(c);
    this.spotOwner.set(spot.id, c.id);
    return spot;
  }

  private releaseAll(c: Char) {
    for (const [k, v] of this.seatOwner) if (v === c.id) this.seatOwner.delete(k);
    for (const [k, v] of this.spotOwner) if (v === c.id) this.spotOwner.delete(k);
    if (c.act?.partner) {
      const p = this.chars.get(c.act.partner);
      if (p?.act?.partner === c.id) p.act.partner = undefined;
    }
  }

  private goTo(c: Char, act: Act, instant: boolean) {
    if (act.seat) this.seatOwner.set(act.seat.id, c.id);
    if (act.spot) this.spotOwner.set(act.spot.id, c.id);
    if (instant) {
      c.x = act.x;
      c.z = act.z;
      c.heading = act.heading;
      c.act = act;
      c.mode = 'acting';
      c.person.setProp(act.prop);
      return;
    }
    c.pending = act;
    c.act = null;
    c.path = this.nav.path({ x: c.x, z: c.z }, { x: act.x, z: act.z });
    c.mode = 'walking';
    c.person.setProp(act.prop === 'cup' ? 'cup' : null);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, now: number) {
    const t = performance.now() / 1000;
    for (const c of [...this.chars.values()]) {
      if (c.mode === 'hidden') continue;
      let poseName: PoseName = 'stand';
      let seatHeight = 0.47;

      if (c.mode === 'riding') {
        c.y = this.elevator.y + 0.02;
        poseName = this.elevator.y < -20 ? 'handsBehind' : 'stand';
        c.heading = 0;
      } else if (c.mode === 'stepping' && c.step) {
        const s = c.step;
        s.t += dt / s.dur;
        if (s.t > 0) {
          const k = Math.min(1, s.t);
          c.x = s.from.x + (s.to.x - s.from.x) * k;
          c.z = s.from.z + (s.to.z - s.from.z) * k;
          c.heading = Math.atan2(s.to.x - s.from.x, s.to.z - s.from.z);
          c.walkPhase += dt * 9;
          poseName = 'walk';
        }
        c.y = this.elevator.y + 0.02;
        if (s.t >= 1) {
          c.step = undefined;
          c.y = FLOOR_Y;
          s.then();
        }
      } else if (c.mode === 'walking') {
        c.y = FLOOR_Y;
        poseName = 'walk';
        let budget = WALK * dt;
        while (budget > 0 && c.path.length) {
          const p = c.path[0];
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < 1e-3) {
            c.path.shift();
            continue;
          }
          const step = Math.min(d, budget);
          c.x += (dx / d) * step;
          c.z += (dz / d) * step;
          budget -= step;
          turnToward(c, Math.atan2(dx, dz), dt * 8);
          if (step >= d) c.path.shift();
        }
        c.walkPhase += dt * 8.5;
        if (!c.path.length) this.arrive(c, now);
      } else if (c.mode === 'queue') {
        c.y = FLOOR_Y;
        turnToward(c, Math.PI, dt * 6);
        poseName = 'stand';
      } else if (c.mode === 'acting' && c.act) {
        c.y = FLOOR_Y;
        const a = c.act;
        turnToward(c, a.heading, dt * 6);
        seatHeight = a.seat?.height ?? 0.47;
        poseName = this.actPose(c, a, now, t);
        if (now > a.until) this.finish(c, now);
      }

      // Keep in sync with status changes that happened mid-activity.
      if (c.mode === 'acting' && c.act && (c.act.kind === 'work' || c.act.kind === 'wait')) {
        const want = c.agent.status === 'waiting' ? 'wait' : c.agent.status === 'working' ? 'work' : null;
        if (want && want !== c.act.kind) c.act.kind = want;
      }

      c.person.root.position.set(c.x, c.y, c.z);
      c.person.root.rotation.y = c.heading;
      c.person.blend(pose(poseName, t + c.phase, seatHeight, c.walkPhase), dt, poseName === 'walk' ? 14 : 8);
      this.bubbles(c, now);
    }
  }

  private arrive(c: Char, now: number) {
    const act = c.pending;
    c.pending = null;
    if (!act) {
      c.mode = 'acting';
      return;
    }
    if (act.kind === 'leave') {
      c.mode = 'queue';
      c.act = act;
      this.elevator.requestDeparture(c.id);
      return;
    }
    c.x = act.x;
    c.z = act.z;
    c.act = act;
    c.mode = 'acting';
    c.person.setProp(act.prop);
    if (act.kind === 'chat' || act.kind === 'pingpong' || act.kind === 'meeting') c.nextSwap = now + 3000;
  }

  private finish(c: Char, now: number) {
    const a = c.act!;
    if (a.kind === 'brew') {
      // Coffee ready: drink it on a sofa or at a standing table.
      this.spotOwner.delete(a.spot!.id);
      const seat = Math.random() > 0.45 ? this.claimSeat(c, null, ['sofa', 'bench']) : null;
      if (seat) return this.goTo(c, { kind: 'coffee', seat, x: seat.x, z: seat.z, heading: seat.heading, until: now + 25_000 + Math.random() * 20_000, prop: 'cup' }, false);
      const spot = this.claimSpot(c, (s) => s.kind === 'chat' || s.kind === 'window');
      if (spot) return this.goTo(c, { kind: 'coffee', spot, x: spot.x, z: spot.z, heading: spot.heading, until: now + 20_000 + Math.random() * 15_000, prop: 'cup' }, false);
      c.act = { ...a, kind: 'coffee', until: now + 20_000, prop: 'cup' };
      c.person.setProp('cup');
      return;
    }
    if (c.agent.status === 'idle') this.leisure(c, now, false);
    else this.decide(c, now, false);
  }

  private actPose(c: Char, a: Act, now: number, t: number): PoseName {
    switch (a.kind) {
      case 'work': {
        // Small breaks: stretch or sip from the desk mug now and then.
        const cycle = (t + c.phase * 7) % 70;
        if (cycle > 66) return 'stretch';
        if (cycle > 40 && cycle < 43) return 'sitDrink';
        return 'type';
      }
      case 'wait':
        return Math.floor(t / 2.5 + c.phase) % 3 === 0 ? 'stand' : 'wave';
      case 'brew':
        return 'brew';
      case 'coffee':
        return a.seat ? 'sitDrink' : 'drink';
      case 'sofa':
        return a.seat?.kind === 'beanbag' ? 'lounge' : a.prop === 'phone' ? 'sitPhone' : 'lounge';
      case 'chat': {
        if (now > c.nextSwap) {
          c.speaking = !c.speaking;
          c.nextSwap = now + 3500 + Math.random() * 3000;
          if (c.speaking) this.say(c, chatLine(c, this.chars.get(a.partner ?? '')), 'say');
        }
        if (a.prop === 'cup') return c.speaking ? 'talk' : 'drink';
        return c.speaking ? 'talk' : 'listen';
      }
      case 'meeting':
        if (now > c.nextSwap) {
          c.speaking = !c.speaking;
          c.nextSwap = now + 4000 + Math.random() * 3000;
          if (c.speaking) this.say(c, chatLine(c, this.chars.get(a.partner ?? '')), 'say');
        }
        return c.speaking ? 'sitTalk' : 'sit';
      case 'pingpong':
        if (now > c.nextSwap) {
          c.nextSwap = now + 9000 + Math.random() * 8000;
          if (Math.random() > 0.5) this.say(c, PINGPONG[Math.floor(Math.random() * PINGPONG.length)], 'say');
        }
        return 'pingpong';
      case 'arcade':
        return 'arcade';
      case 'window':
        return 'handsBehind';
      case 'watch':
        return 'watch';
      case 'stand':
        return a.prop === 'phone' ? 'phone' : 'stand';
      default:
        return 'stand';
    }
  }

  // ------------------------------------------------------------------ bubbles

  private say(c: Char, text: string, kind: Bubble['kind']) {
    c.bubble = { text, kind, until: performance.now() + Math.min(8000, 3000 + text.length * 50) };
    c.nextBubbleAt = Date.now() + 6000;
  }

  private bubbles(c: Char, now: number) {
    if (c.bubble && c.bubble.until < performance.now()) c.bubble = null;
    if (c.bubble || now < c.nextBubbleAt || c.mode === 'riding' || c.mode === 'hidden') return;
    const active = [...this.chars.values()].filter((o) => o.bubble).length;
    const priority = c.id === this.selectedId || c.id === this.hoverId;
    c.nextBubbleAt = now + (c.agent.status === 'working' ? 6000 : 10_000) + Math.random() * 9000;
    if (active >= 7 && !priority) return;
    const line = pickLine(c);
    if (line) this.say(c, line.text, line.kind);
  }

  /** Where a character's label should float (world). */
  labelPos(c: Char) {
    return { x: c.x, y: c.y + c.person.topY + 0.22, z: c.z };
  }

  /** Seats where someone is typing, for the lit monitors. */
  activeScreens(): Map<string, RoomId> {
    const out = new Map<string, RoomId>();
    for (const c of this.chars.values()) {
      if (c.mode === 'acting' && c.act?.seat?.screen && (c.act.kind === 'work' || c.act.kind === 'wait')) out.set(c.act.seat.id, c.act.seat.room);
    }
    return out;
  }

  /** Is anyone brewing coffee (for steam)? */
  brewing(): Spot[] {
    return [...this.chars.values()].filter((c) => c.mode === 'acting' && c.act?.kind === 'brew' && c.act.spot).map((c) => c.act!.spot!);
  }

  playing(): boolean {
    const players = [...this.chars.values()].filter((c) => c.mode === 'acting' && c.act?.kind === 'pingpong');
    return players.length >= 2;
  }
}

function isLeaving(c: Char): boolean {
  return c.act?.kind === 'leave' || c.pending?.kind === 'leave' || c.mode === 'queue';
}

function wantKey(a: AgentSnapshot): string {
  if (a.status === 'idle') return 'idle';
  if (a.status === 'done') return 'done';
  return `desk|${deskRoom(a.room)}`;
}

function deskRoom(room: RoomId): RoomId {
  return ['atrium', 'cafe', 'meeting', 'chill'].includes(room) ? 'general' : room;
}

function turnToward(c: Char, target: number, rate: number) {
  let d = target - c.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  c.heading += Math.sign(d) * Math.min(Math.abs(d), rate);
}

function greeting(a: AgentSnapshot): string {
  if (a.kind === 'subagent') return `Hi! I'm here to help with ${a.role ?? 'a task'}`;
  return a.status === 'working' ? `Morning! On my way to ${a.projectName ?? 'work'} 💼` : 'Hello everyone 👋';
}

function chatLine(c: Char, partner: Char | undefined): string {
  const r = Math.random();
  if (partner && r < 0.45) {
    const opener = CHAT_OPENERS[Math.floor(Math.random() * CHAT_OPENERS.length)];
    return opener.replace('{p}', partner.agent.persona).replace('{project}', partner.agent.projectName ?? 'your project');
  }
  const say = c.agent.lines.filter((l) => l.kind === 'say').slice(-4);
  if (say.length && r < 0.8) return say[Math.floor(Math.random() * say.length)].text;
  return CHAT_REPLIES[Math.floor(Math.random() * CHAT_REPLIES.length)];
}

function pickLine(c: Char): { text: string; kind: Bubble['kind'] } | null {
  const a = c.agent;
  const r = Math.random();
  if (a.status === 'waiting') return { text: a.attention?.reason ?? 'I need you for a second!', kind: 'ask' };
  if (a.status === 'idle') {
    if (c.act?.kind === 'chat' || c.act?.kind === 'pingpong' || c.act?.kind === 'meeting') return null;
    if (r < 0.5) return { text: IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)], kind: 'idle' };
    const say = a.lines.filter((l) => l.kind === 'say' || l.kind === 'ask').at(-1);
    return say ? { text: say.text, kind: say.kind === 'ask' ? 'ask' : 'say' } : null;
  }
  if (a.status !== 'working') return null;
  const fresh = a.lines.filter((l) => Date.now() - l.at < 15 * 60_000).slice(-6);
  if (r < 0.35 || !fresh.length) return { text: a.activity, kind: 'action' };
  const line = fresh[Math.floor(Math.random() * fresh.length)];
  return { text: line.text, kind: line.kind };
}

export { BOTTOM };
