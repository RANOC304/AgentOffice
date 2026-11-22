// Character behaviour. Working agents sit at a desk in their domain room and type; agents that need
// you stand up and wave; idle agents take coffee, chat with each other, play ping-pong, sit on sofas,
// look out of the window or watch the Neo screen. Everyone arrives and leaves by the elevator.

import type { RoomId } from '../../../shared/rooms.ts';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { BOTTOM, type Elevator } from './elevator.ts';
import { cellCenter, ELEVATOR, type Layout, navIndex, type Seat, type Spot } from './layout.ts';
import { BOSS_LOOK, hash, type Look, lookFor } from './look.ts';
import type { Nav, P } from './nav.ts';
import { Person, type Prop } from './person.ts';
import { pose, type PoseName } from './poses.ts';
import { bossLine, bystanderLine, conversation, idleLine, type Line, reactionLine, type TalkCtx, type Where, workThought } from './talk.ts';

/** Sounds the office makes, for the audio engine. */
export type SimSound = 'slap' | 'kick' | 'whoosh' | 'ouch' | 'ding' | 'land';

/** You, when you walk around the office. */
export const BOSS_ID = 'boss';

const FLOOR_Y = 0.02;
const WALK = 2.1;

type Mode = 'hidden' | 'riding' | 'stepping' | 'walking' | 'acting' | 'queue' | 'player';
type ActKind = 'work' | 'wait' | 'brew' | 'coffee' | 'chat' | 'meeting' | 'sofa' | 'window' | 'pingpong' | 'arcade' | 'watch' | 'stand' | 'leave' | 'visit';

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
  /** say/think/ask/action come from the real session; chat and idle are office small talk. */
  kind: 'say' | 'think' | 'action' | 'ask' | 'idle' | 'chat';
  until: number;
}

/** A conversation between two characters, spoken line by line. */
interface Talk {
  /** order[0] started the current topic. */
  order: [string, string];
  where: Where;
  topic: string;
  lines: Line[];
  i: number;
  nextAt: number;
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
  /** Real session lines already said, so each one is said once. */
  said: Set<string>;
  /** Small-talk lines said recently, so they do not repeat. */
  npcSaid: Set<string>;
  lastActivity: string;
  lastAsk: string;
  /** Key of the conversation this character is part of. */
  talk: string | null;
  /** Hand-off visit in progress. */
  visit?: { to: string; project?: string; stage: number };
  /** Boss mode: walking speed set by the player controller (m/s). */
  playerSpeed?: number;
  /** When this worker may talk to the boss again. */
  bossNextAt?: number;
  metBoss?: boolean;
  /** Turn toward the boss until then (standing workers). */
  faceBossUntil?: number;
  /** Boss mode: sitting on a seat, or on the floor. */
  sitting?: { seat?: Seat; floor: boolean };
  /** The mouth moves until then (ms, office clock). */
  talkUntil?: number;
  /** Slapped or kicked by the boss: reaction pose and knockback. */
  hit?: { kind: 'slap' | 'kick'; at: number; until: number; vx: number; vz: number; seated: boolean };
  /** The boss's own slap or kick animation. */
  bossAction?: { kind: 'slap' | 'kick'; at: number; dur: number };
  /** A quick step toward the target, so the hand or foot actually reaches him. */
  lunge?: { fx: number; fz: number; tx: number; tz: number; at: number; dur: number };
  /** Boss mode: height of the current jump above the floor. */
  jumpY?: number;
}

export class Sim {
  readonly chars = new Map<string, Char>();
  private seatOwner = new Map<string, string>();
  private spotOwner = new Map<string, string>();
  private initialized = false;
  private talks = new Map<string, Talk>();
  private recentTopics: string[] = [];
  /** Small-talk lines said anywhere in the office recently, so two characters do not echo each other. */
  private recentNpc = new Map<string, number>();
  private arrivals: Array<{ id: string; at: number }> = [];
  /** Hand-offs waiting for both workers to be in place: the giver walks over to the receiver. */
  private handoffs: Array<{ from: string; to: string; at: number; project?: string }> = [];
  private layout: Layout;
  private nav: Nav;
  private elevator: Elevator;
  private addToScene: (c: Char) => void;
  private removeFromScene: (c: Char) => void;
  selectedId: string | null = null;
  hoverId: string | null = null;
  /** Shifts the office clock, so a replay runs on the recorded day's time. */
  offset = 0;

  clock(): number {
    return Date.now() + this.offset;
  }
  /** Called when the boss steps out of the elevator and can be controlled. */
  onBossArrived?: (c: Char) => void;
  private bossTalkAt = 0;
  private pendingHits: Array<{ target: string; kind: 'slap' | 'kick'; at: number }> = [];
  private pendingLines: Array<{ id: string; at: number; text: string }> = [];
  /** Called for one-shot sounds at a position. */
  onSound?: (name: SimSound, x: number, y: number, z: number, from?: Char) => void;
  /** Called whenever a character says or thinks something in a bubble. */
  onChatter?: (c: Char, kind: Bubble['kind'], text: string) => void;

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
      if (present.has(c.id) || c.id === BOSS_ID) continue;
      if (!isLeaving(c) && c.mode !== 'hidden' && c.mode !== 'riding' && c.mode !== 'stepping') this.leave(c, now);
      if (c.mode === 'hidden') {
        this.elevator.cancel(c.id);
        this.destroy(c);
      }
    }
    this.initialized = true;
  }

  private create(agent: AgentSnapshot, now: number, look?: Look, viaElevator = false): Char {
    const person = new Person(look ?? lookFor(agent.id, agent.provider, agent.kind));
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
      // Lines from before the character showed up are history: only the latest may still be said.
      said: new Set(agent.lines.slice(0, -1).map(lineKey)),
      npcSaid: new Set(),
      lastActivity: agent.activity,
      lastAsk: '',
      talk: null,
    };
    for (const l of agent.lines) if (now - l.at > 2 * 60_000) c.said.add(lineKey(l));
    this.chars.set(agent.id, c);
    this.addToScene(c);
    if (!this.initialized && !viaElevator) {
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

  get boss(): Char | undefined {
    return this.chars.get(BOSS_ID);
  }

  /** You come into the office: the elevator brings you up from below the island. */
  spawnBoss(): Char {
    const old = this.chars.get(BOSS_ID);
    if (old) {
      // The previous you may still be riding down: take him out of that trip, or the elevator
      // would remove the new you when it reaches the bottom.
      this.elevator.evict(BOSS_ID);
      this.destroy(old);
    }
    const now = this.clock();
    const agent: AgentSnapshot = {
      id: BOSS_ID,
      persona: 'Boss',
      provider: 'claude-code',
      kind: 'session',
      name: 'You',
      app: 'AgentOffice',
      status: 'idle',
      activity: 'Visiting the office',
      room: 'atrium',
      domain: 'atrium',
      usingBrowser: false,
      startedAt: now,
      lastActivityAt: now,
      tokens: { input: 0, output: 0, cached: 0, total: 0 },
      counts: { turns: 0, tools: 0, edits: 0, commands: 0, reads: 0, searches: 0, browser: 0, subagents: 0, errors: 0 },
      topTools: [],
      filesTouched: [],
      lines: [],
      recent: [],
      pulses: [],
    };
    for (const c of this.chars.values()) c.metBoss = false;
    return this.create(agent, now, BOSS_LOOK, true);
  }

  /** You leave: walk to the elevator and ride down (or vanish if you had not arrived yet). */
  leaveBoss() {
    const c = this.chars.get(BOSS_ID);
    if (!c) return;
    this.bossStand();
    if (c.mode === 'player') {
      c.playerSpeed = 0;
      this.leave(c, this.clock());
      return;
    }
    if (!this.elevator.isRiding(BOSS_ID)) {
      this.elevator.cancel(BOSS_ID);
      this.destroy(c);
    }
  }

  /**
   * You sit down: on the nearest free chair, sofa, bench or beanbag within reach, or on the floor
   * right where you are. Returns what you sat on.
   */
  bossSit(): 'seat' | 'floor' | null {
    const c = this.chars.get(BOSS_ID);
    if (!c || c.mode !== 'player') return null;
    if (c.sitting) return c.sitting.floor ? 'floor' : 'seat';
    let best: Seat | undefined;
    let bestD = 1.9;
    for (const s of this.layout.seats) {
      const owner = this.seatOwner.get(s.id);
      if (owner && owner !== BOSS_ID) continue;
      const d = Math.hypot(s.x - c.x, s.z - c.z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    c.playerSpeed = 0;
    if (best) {
      this.seatOwner.set(best.id, BOSS_ID);
      c.x = best.x;
      c.z = best.z;
      c.heading = best.heading;
      c.sitting = { seat: best, floor: false };
      return 'seat';
    }
    c.sitting = { floor: true };
    return 'floor';
  }

  /** Back on your feet in front of the elevator, facing the office. */
  resetBoss(): boolean {
    const c = this.chars.get(BOSS_ID);
    if (!c || c.mode !== 'player') return false;
    this.bossStand();
    const spot = this.elevator.exitSpot(4);
    c.x = spot.x;
    c.z = spot.z;
    c.heading = 0;
    c.jumpY = 0;
    c.lunge = undefined;
    c.playerSpeed = 0;
    return true;
  }

  /** You stand up again, a step in front of the seat if it sits inside furniture. */
  bossStand() {
    const c = this.chars.get(BOSS_ID);
    if (!c?.sitting) return;
    const seat = c.sitting.seat;
    c.sitting = undefined;
    if (!seat) return;
    if (this.seatOwner.get(seat.id) === BOSS_ID) this.seatOwner.delete(seat.id);
    const p = cellCenter(this.nav.nearestFree(seat.x + Math.sin(seat.heading) * 0.45, seat.z + Math.cos(seat.heading) * 0.45));
    c.x = p.x;
    c.z = p.z;
  }

  /**
   * Just for fun: the boss slaps or kicks the worker in front of him. Only the 3D characters react
   * (a pose, a little knockback and a comic line); nothing about the real sessions changes.
   */
  bossAttack(kind: 'slap' | 'kick', aimYaw: number): boolean {
    const boss = this.chars.get(BOSS_ID);
    if (!boss || boss.mode !== 'player') return false;
    const now = this.clock();
    if (boss.bossAction && now - boss.bossAction.at < boss.bossAction.dur) return false;
    if (boss.sitting) this.bossStand();
    const reach = kind === 'slap' ? 1.4 : 1.7;
    let target: Char | undefined;
    let best = reach;
    for (const c of this.chars.values()) {
      if (c === boss || c.mode === 'hidden' || c.mode === 'riding' || c.mode === 'stepping' || c.mode === 'queue') continue;
      const dx = c.x - boss.x;
      const dz = c.z - boss.z;
      const d = Math.hypot(dx, dz);
      if (d > best) continue;
      // In front of where you look, or of where your body faces (third person).
      const off = (yaw: number) => {
        let diff = Math.atan2(dx, dz) - yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return Math.abs(diff);
      };
      if (Math.min(off(aimYaw), off(boss.heading)) > 1.15) continue;
      target = c;
      best = d;
    }
    if (target) {
      boss.heading = Math.atan2(target.x - boss.x, target.z - boss.z);
      // Step in to arm's (or leg's) length.
      const want = kind === 'slap' ? 0.6 : 0.78;
      const d = Math.hypot(target.x - boss.x, target.z - boss.z);
      if (d > want + 0.04) {
        // Walk the line toward him in small steps and stop at the last free spot (desks and chairs
        // may be in the way), never closer than arm's length.
        const ux = (target.x - boss.x) / d;
        const uz = (target.z - boss.z) / d;
        let tx = boss.x;
        let tz = boss.z;
        for (let step = 0.05; step <= d - want; step += 0.05) {
          const px = boss.x + ux * step;
          const pz = boss.z + uz * step;
          if (!this.nav.free(navIndex(px, pz))) break;
          tx = px;
          tz = pz;
        }
        if (tx !== boss.x || tz !== boss.z) boss.lunge = { fx: boss.x, fz: boss.z, tx, tz, at: now, dur: kind === 'slap' ? 150 : 200 };
      }
    }
    boss.bossAction = { kind, at: now, dur: kind === 'slap' ? 440 : 620 };
    this.onSound?.('whoosh', boss.x, 1.2, boss.z);
    // The hit lands when the hand (or foot) is right in front of him.
    if (target) this.pendingHits.push({ target: target.id, kind, at: now + (kind === 'slap' ? 190 : 270) });
    return Boolean(target);
  }

  private applyHit(c: Char, kind: 'slap' | 'kick', boss: Char, now: number) {
    // A kick knocks anyone off his feet, even off his chair; a slap leaves sitters seated.
    const seated = kind === 'slap' && c.mode === 'acting' && Boolean(c.act?.seat);
    const dx = c.x - boss.x;
    const dz = c.z - boss.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const speed = seated ? 0 : kind === 'slap' ? 0.9 : 3.6;
    // He faces the boss, so a kick sends him onto his back, away from him.
    if (kind === 'kick' || !seated) c.heading = Math.atan2(-dx, -dz);
    c.hit = { kind, at: now, until: now + (kind === 'slap' ? 1500 : 3200), vx: (dx / d) * speed, vz: (dz / d) * speed, seated };
    c.faceBossUntil = now + 4000;
    this.onSound?.(kind, c.x, kind === 'slap' ? 1.55 : 1.0, c.z, c);
    this.onSound?.('ouch', c.x, 1.6, c.z, c);
    this.pendingLines.push({ id: c.id, at: now + 380, text: reactionLine(kind, seated, c.npcSaid) });
    // Somebody nearby may comment.
    const witness = [...this.chars.values()].find(
      (o) => o !== c && o !== boss && o.mode !== 'hidden' && o.mode !== 'riding' && Math.hypot(o.x - c.x, o.z - c.z) < 5 && Math.random() < 0.4,
    );
    if (witness) this.pendingLines.push({ id: witness.id, at: now + 1300, text: bystanderLine(witness.npcSaid) });
  }

  /** After a knockback: walk back to where he was going. */
  private recover(c: Char) {
    if (c.mode === 'walking' && c.pending) {
      c.path = this.nav.path({ x: c.x, z: c.z }, { x: c.pending.x, z: c.pending.z });
      return;
    }
    const act = c.act;
    if ((c.mode === 'acting' || c.mode === 'queue') && act && Math.hypot(act.x - c.x, act.z - c.z) > 0.15) {
      c.act = null;
      c.pending = act;
      c.mode = 'walking';
      c.path = this.nav.path({ x: c.x, z: c.z }, { x: act.x, z: act.z });
    }
  }

  private updateFun(now: number) {
    const boss = this.chars.get(BOSS_ID);
    for (let i = this.pendingHits.length - 1; i >= 0; i--) {
      const h = this.pendingHits[i];
      if (now < h.at) continue;
      this.pendingHits.splice(i, 1);
      const c = this.chars.get(h.target);
      if (c && boss && c.mode !== 'hidden' && c.mode !== 'riding') this.applyHit(c, h.kind, boss, now);
    }
    for (let i = this.pendingLines.length - 1; i >= 0; i--) {
      const l = this.pendingLines[i];
      if (now < l.at) continue;
      this.pendingLines.splice(i, 1);
      const c = this.chars.get(l.id);
      if (!c) continue;
      c.npcSaid.add(l.text);
      this.say(c, l.text, 'chat', Math.min(6000, 2600 + l.text.length * 50));
    }
  }

  /** Where a character turns his head: his conversation partner, or the boss when he is close. */
  private lookTarget(c: Char, now: number): { yaw: number; pitch: number } {
    let target: Char | undefined;
    const partner = c.act?.partner ?? c.pending?.partner;
    if (partner && (c.act?.kind === 'chat' || c.act?.kind === 'meeting' || c.act?.kind === 'pingpong' || c.act?.kind === 'visit')) target = this.chars.get(partner);
    const boss = c.id !== BOSS_ID ? this.chars.get(BOSS_ID) : undefined;
    if (boss && boss.mode === 'player') {
      const d = Math.hypot(boss.x - c.x, boss.z - c.z);
      if (d < 2.2 || ((c.faceBossUntil ?? 0) > now && d < 5)) target = boss;
    }
    if (!target || target.mode === 'hidden') return { yaw: 0, pitch: 0 };
    let yaw = Math.atan2(target.x - c.x, target.z - c.z) - c.heading;
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    if (Math.abs(yaw) > 2.2) return { yaw: 0, pitch: 0 };
    const dist = Math.max(0.4, Math.hypot(target.x - c.x, target.z - c.z));
    const rise = target.y + target.person.topY - (c.y + c.person.topY);
    return { yaw: Math.max(-1, Math.min(1, yaw)), pitch: Math.max(-0.35, Math.min(0.35, -Math.atan2(rise, dist))) };
  }

  /** The worker nearest to the boss (within reach) says something to him right away. */
  greetBoss(id?: string): string | null {
    const boss = this.chars.get(BOSS_ID);
    if (!boss || boss.mode !== 'player') return null;
    const target = id ? this.chars.get(id) : this.nearestToBoss(boss, 3.2, true);
    if (!target || target === boss) return null;
    this.talkToBoss(target, boss, this.clock());
    return target.id;
  }

  private nearestToBoss(boss: Char, reach: number, ignoreCooldown: boolean, now = 0): Char | undefined {
    let best: Char | undefined;
    let bestD = reach;
    for (const c of this.chars.values()) {
      if (c === boss || c.mode === 'hidden' || c.mode === 'riding' || c.mode === 'stepping' || isLeaving(c)) continue;
      if (!ignoreCooldown && now < (c.bossNextAt ?? 0)) continue;
      const d = Math.hypot(c.x - boss.x, c.z - boss.z);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  private talkToBoss(c: Char, boss: Char, now: number) {
    const line = bossLine(c.agent, this.talkCtx(now), c.npcSaid, !c.metBoss, Boolean(c.talk));
    c.npcSaid.add(line);
    c.metBoss = true;
    c.bossNextAt = now + 25_000 + Math.random() * 20_000;
    c.faceBossUntil = now + 6500;
    this.bossTalkAt = now + 3200;
    this.say(c, line, c.agent.status === 'waiting' ? 'ask' : 'chat', Math.min(9000, 3200 + line.length * 55));
    void boss;
  }

  /** Workers near the boss talk to him, one at a time. */
  private updateBoss(now: number) {
    const boss = this.chars.get(BOSS_ID);
    if (!boss || boss.mode !== 'player' || now < this.bossTalkAt) return;
    const c = this.nearestToBoss(boss, 2.6, false, now);
    if (c) this.talkToBoss(c, boss, now);
  }

  /** Removes everyone at once; the next sync places the workers directly at their spots. */
  reset() {
    for (const c of [...this.chars.values()]) this.destroy(c);
    this.talks.clear();
    this.seatOwner.clear();
    this.spotOwner.clear();
    this.arrivals = [];
    this.handoffs = [];
    this.elevator.reset();
    this.initialized = false;
  }

  /** One worker brings his result over to another (a mission hand-off). */
  handoff(from: string, to: string, project?: string) {
    if (from === to || this.handoffs.some((h) => h.from === from && h.to === to)) return;
    this.handoffs.push({ from, to, at: this.clock(), project });
  }

  private updateHandoffs(now: number) {
    for (let i = this.handoffs.length - 1; i >= 0; i--) {
      const h = this.handoffs[i];
      if (now - h.at > 4 * 60_000) {
        this.handoffs.splice(i, 1);
        continue;
      }
      const a = this.chars.get(h.from);
      const b = this.chars.get(h.to);
      if (!a || !b || a.mode !== 'acting' || isLeaving(a) || b.mode !== 'acting' || !b.act) continue;
      this.handoffs.splice(i, 1);
      // Stand next to the receiver, facing him.
      const angle = b.heading + Math.PI / 2;
      const cell = this.nav.nearestFree(b.x + Math.sin(angle) * 0.9, b.z + Math.cos(angle) * 0.9);
      const p = cellCenter(cell);
      const heading = Math.atan2(b.x - p.x, b.z - p.z);
      this.releaseAll(a);
      this.goTo(a, { kind: 'visit', x: p.x, z: p.z, heading, until: Infinity, partner: b.id, prop: null }, false);
      a.visit = { to: b.id, project: h.project, stage: 0 };
    }
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
            if (c.id === BOSS_ID) {
              c.mode = 'player';
              c.act = null;
              c.playerSpeed = 0;
              this.onBossArrived?.(c);
              return;
            }
            c.mode = 'acting';
            c.act = null;
            this.arrivals.unshift({ id: c.id, at: this.clock() });
            this.arrivals.length = Math.min(this.arrivals.length, 8);
            this.say(c, greeting(c.agent), 'idle');
            this.decide(c, this.clock(), false);
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
    this.startTalk(c, partner, kind, now);
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
    this.startTalk(c, partner, 'meeting', now);
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
    if (c.id !== BOSS_ID) this.say(c, c.agent.kind === 'subagent' ? 'Done! Reporting back 👋' : 'Signing off 👋', 'say');
    this.goTo(c, { kind: 'leave', x: q.x, z: q.z, heading: Math.PI, until: Infinity, prop: null }, false);
    void now;
  }

  // ------------------------------------------------------------------ conversations

  private talkCtx(now: number): TalkCtx {
    return { now, everyone: [...this.chars.values()].filter((c) => c.mode !== 'hidden' && c.id !== BOSS_ID).map((c) => c.agent), arrivals: this.arrivals };
  }

  private startTalk(a: Char, b: Char, where: Where, now: number) {
    this.endTalk(a);
    this.endTalk(b);
    const key = `${a.id}|${b.id}`;
    this.talks.set(key, { order: [a.id, b.id], where, topic: '', lines: [], i: 0, nextAt: now + 1500 });
    a.talk = key;
    b.talk = key;
    a.speaking = false;
    b.speaking = false;
  }

  private endTalk(c: Char) {
    const key = c.talk;
    if (!key) return;
    const t = this.talks.get(key);
    this.talks.delete(key);
    for (const id of t?.order ?? []) {
      const x = this.chars.get(id);
      if (x && x.talk === key) {
        x.talk = null;
        x.speaking = false;
      }
    }
    c.talk = null;
    c.speaking = false;
  }

  /** Advances every conversation: one line at a time, with pauses between topics. */
  private updateTalks(now: number) {
    for (const [key, t] of this.talks) {
      const a = this.chars.get(t.order[0]);
      const b = this.chars.get(t.order[1]);
      const together = (x: Char | undefined, y: Char | undefined) => {
        const act = x?.act ?? x?.pending;
        return Boolean(x && y && act && x.talk === key && act.partner === y.id && ['chat', 'meeting', 'pingpong'].includes(act.kind));
      };
      if (!a || !b || !together(a, b) || !together(b, a)) {
        if (a) this.endTalk(a);
        if (b) this.endTalk(b);
        this.talks.delete(key);
        continue;
      }
      // Only talk once both have arrived.
      if (a.mode !== 'acting' || b.mode !== 'acting' || !a.act || !b.act) {
        t.nextAt = Math.max(t.nextAt, now + 1200);
        continue;
      }
      if (now < t.nextAt) continue;
      if (t.i >= t.lines.length) {
        const left = Math.min(a.act.until, b.act.until) - now;
        if (left < 12_000) {
          t.nextAt = now + 4000;
          continue;
        }
        // A new topic; either of them may start it.
        if (t.lines.length && Math.random() < 0.5) t.order = [t.order[1], t.order[0]];
        const first = this.chars.get(t.order[0])!;
        const second = this.chars.get(t.order[1])!;
        const next = conversation(first.agent, second.agent, t.where, this.talkCtx(now), this.recentTopics);
        if (!next) {
          t.nextAt = now + 8000;
          continue;
        }
        t.topic = next.topic;
        t.lines = next.lines;
        t.i = 0;
        this.recentTopics = [next.topic, ...this.recentTopics.filter((x) => x !== next.topic)].slice(0, 6);
      }
      const line = t.lines[t.i++];
      const speaker = this.chars.get(t.order[line.who])!;
      const listener = this.chars.get(t.order[line.who === 0 ? 1 : 0])!;
      const ms = 1700 + line.text.length * 55;
      this.say(speaker, line.text, 'chat', ms + 900);
      speaker.speaking = true;
      listener.speaking = false;
      t.nextAt = now + ms + (t.i >= t.lines.length ? 5000 + Math.random() * 6000 : 0);
    }
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
    this.endTalk(c);
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
    this.updateTalks(now);
    this.updateHandoffs(now);
    this.updateBoss(now);
    this.updateFun(now);
    for (const c of [...this.chars.values()]) {
      if (c.mode === 'hidden') continue;
      let poseName: PoseName = 'stand';
      let seatHeight = 0.47;
      let progress = 0;
      const hit = c.hit && now < c.hit.until ? c.hit : undefined;
      if (c.hit && !hit) {
        c.hit = undefined;
        this.recover(c);
      }

      if (hit) {
        // Knocked about by the boss: slide back (never through furniture), then recover.
        progress = (now - hit.at) / (hit.until - hit.at);
        if (!hit.seated) {
          const k = Math.exp(-(now - hit.at) / (hit.kind === 'slap' ? 110 : 230));
          const nx = c.x + hit.vx * k * dt;
          const nz = c.z + hit.vz * k * dt;
          if (this.nav.free(navIndex(nx, c.z))) c.x = nx;
          if (this.nav.free(navIndex(c.x, nz))) c.z = nz;
        }
        seatHeight = c.act?.seat?.height ?? 0.47;
        poseName = hit.kind === 'kick' ? 'kicked' : hit.seated ? 'sitSlapped' : 'slapped';
      } else if (c.mode === 'riding') {
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
      } else if (c.mode === 'player') {
        // Moved by the player controller.
        c.y = FLOOR_Y + (c.jumpY ?? 0);
        const lunge = c.lunge;
        if (lunge) {
          const k = Math.min(1, (now - lunge.at) / lunge.dur);
          const e = k * k * (3 - 2 * k);
          c.x = lunge.fx + (lunge.tx - lunge.fx) * e;
          c.z = lunge.fz + (lunge.tz - lunge.fz) * e;
          if (k >= 1) c.lunge = undefined;
        }
        const speed = c.playerSpeed ?? 0;
        if (c.sitting) {
          const seat = c.sitting.seat;
          poseName = !seat ? 'floorSit' : seat.kind === 'beanbag' || seat.kind === 'sofa' ? 'lounge' : 'sit';
          seatHeight = seat?.height ?? 0;
        } else {
          poseName = (c.jumpY ?? 0) > 0.03 ? 'jump' : speed > 3.6 ? 'run' : speed > 0.25 ? 'walk' : 'stand';
          // Longer strides when running: the legs cycle a little slower per metre.
          c.walkPhase += dt * speed * (speed > 3.6 ? 2.6 : 4.1);
        }
        const action = c.bossAction;
        if (action && now - action.at < action.dur) {
          poseName = action.kind === 'slap' ? 'bossSlap' : 'bossKick';
          progress = (now - action.at) / action.dur;
        }
      } else if (c.mode === 'queue') {
        c.y = FLOOR_Y;
        turnToward(c, Math.PI, dt * 6);
        poseName = 'stand';
      } else if (c.mode === 'acting' && c.act) {
        c.y = FLOOR_Y;
        const a = c.act;
        const boss = c.faceBossUntil && c.faceBossUntil > now && !a.seat ? this.chars.get(BOSS_ID) : undefined;
        turnToward(c, boss ? Math.atan2(boss.x - c.x, boss.z - c.z) : a.heading, dt * 6);
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
      // Short actions follow their own curves closely; everything else eases between poses.
      const action = hit !== undefined || poseName === 'bossSlap' || poseName === 'bossKick';
      const quick = poseName === 'walk' || poseName === 'run' || poseName === 'jump';
      c.person.blend(pose(poseName, t + c.phase, seatHeight, c.walkPhase, progress), dt, action ? 42 : quick ? 16 : 8);
      // Face: blinking, a moving mouth while talking, and a head that turns toward whoever he talks to.
      c.person.animateFace(dt, t + c.phase * 3, (c.talkUntil ?? 0) > now ? 1 : 0);
      // While reeling from a hit, the head does what the hit does.
      const look = hit ? { yaw: 0, pitch: 0 } : this.lookTarget(c, now);
      c.person.look(look.yaw, look.pitch, dt);
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
    if (act.kind === 'visit' && c.visit) {
      // The hand-off itself: a few words each, then back to work.
      const b = this.chars.get(c.visit.to);
      const project = c.visit.project ?? c.agent.projectName ?? 'this';
      this.say(c, b ? `${b.agent.persona}, here is my work on ${project}. Can you take it from here?` : `Here is my work on ${project}.`, 'chat', 5200);
      act.until = now + 9000;
      if (b) {
        const reply = b;
        setTimeout(() => {
          if (this.chars.get(reply.id) === reply) this.say(reply, `Got it, ${c.agent.persona}. On it 👍`, 'chat', 4200);
        }, 3800);
      }
    }
  }

  private finish(c: Char, now: number) {
    const a = c.act!;
    // Let a conversation finish its current topic before splitting up.
    const talk = c.talk ? this.talks.get(c.talk) : undefined;
    if (talk && talk.lines.length && talk.i < talk.lines.length && now - a.until < 30_000) {
      a.until = now + 3000;
      return;
    }
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
    c.visit = undefined;
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
        const talking = c.speaking && Boolean(c.bubble);
        if (a.prop === 'cup') return talking ? 'talk' : 'drink';
        return talking ? 'talk' : 'listen';
      }
      case 'meeting':
        return c.speaking && c.bubble ? 'sitTalk' : 'sit';
      case 'pingpong':
        return 'pingpong';
      case 'visit':
        return c.bubble ? 'talk' : 'listen';
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

  /** Shows a bubble. Repeats of a question the user already saw stay out of the chat feed. */
  private say(c: Char, text: string, kind: Bubble['kind'], ms?: number, feed = true) {
    c.bubble = { text, kind, until: performance.now() + (ms ?? Math.min(8000, 3000 + text.length * 50)) };
    if (kind !== 'action' && kind !== 'think') c.talkUntil = this.clock() + Math.min(5200, 500 + text.length * 52);
    if (feed) this.onChatter?.(c, kind, text);
    c.nextBubbleAt = this.clock() + 6000;
  }

  private bubbles(c: Char, now: number) {
    if (c.bubble && c.bubble.until < performance.now()) c.bubble = null;
    if (c.id === BOSS_ID) return;
    if (c.bubble || now < c.nextBubbleAt || c.mode === 'riding' || c.mode === 'hidden') return;
    const active = [...this.chars.values()].filter((o) => o.bubble).length;
    const priority = c.id === this.selectedId || c.id === this.hoverId;
    const status = c.agent.status;
    c.nextBubbleAt = now + (status === 'working' ? 7000 + Math.random() * 8000 : status === 'waiting' ? 12_000 + Math.random() * 6000 : 22_000 + Math.random() * 20_000);
    if (active >= 7 && !priority && status !== 'waiting') return;
    const line = this.pickLine(c, now);
    if (line) this.say(c, line.text, line.kind, undefined, line.feed ?? true);
  }

  /**
   * What a character says next on his own. Real lines from the session are said once each; a finished
   * worker says his final words once, then only makes small talk.
   */
  private pickLine(c: Char, now: number): { text: string; kind: Bubble['kind']; feed?: boolean } | null {
    const a = c.agent;
    if (a.status === 'waiting') {
      const reason = a.attention?.reason ?? 'I need you for a second!';
      const fresh = reason !== c.lastAsk;
      c.lastAsk = reason;
      return { text: reason, kind: 'ask', feed: fresh };
    }
    c.lastAsk = '';
    const unsaid = a.lines.filter((l) => !c.said.has(lineKey(l)) && now - l.at < 15 * 60_000);
    if (a.status === 'working') {
      // Keep up with the session: older unsaid lines are skipped, the two newest are said in order.
      for (const l of unsaid.slice(0, -2)) c.said.add(lineKey(l));
      const l = unsaid.slice(-2)[0];
      if (l) {
        c.said.add(lineKey(l));
        return { text: l.text, kind: l.kind };
      }
      if (a.activity && a.activity !== c.lastActivity) {
        c.lastActivity = a.activity;
        return { text: a.activity, kind: 'action' };
      }
      if (Math.random() < 0.45) {
        const t = this.freshNpc(c, now, () => workThought(a, c.npcSaid));
        if (t) return { text: t, kind: 'idle' };
      }
      return null;
    }
    if (a.status !== 'idle') return null;
    if (unsaid.length) {
      // The job just finished: its final words, once.
      for (const l of unsaid) c.said.add(lineKey(l));
      const last = unsaid.filter((l) => l.kind === 'say' || l.kind === 'ask').at(-1);
      if (last) return { text: last.text, kind: 'say' };
    }
    if (c.talk) return null;
    const t = this.freshNpc(c, now, () => idleLine(a, this.talkCtx(now), c.npcSaid));
    return t ? { text: t, kind: 'idle' } : null;
  }

  /** A small-talk line nobody in the office said in the last ten minutes. */
  private freshNpc(c: Char, now: number, make: () => string | null): string | null {
    for (let i = 0; i < 4; i++) {
      const t = make();
      if (!t) return null;
      c.npcSaid.add(t);
      const at = this.recentNpc.get(t);
      if (at !== undefined && now - at < 10 * 60_000) continue;
      this.recentNpc.set(t, now);
      if (this.recentNpc.size > 300) for (const [k, v] of this.recentNpc) if (now - v > 10 * 60_000) this.recentNpc.delete(k);
      return t;
    }
    return null;
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

function lineKey(l: { at: number; text: string }): string {
  return `${l.at}|${l.text}`;
}

export { BOTTOM };
