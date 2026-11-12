// Replay: rebuilds the office at any moment of a recorded day from the server's compact frames
// (who was where) and events (what they did and said).

import type { RoomId } from '../../shared/rooms.ts';
import type { ActivityEvent, ActivityKind, AgentSnapshot, AgentStatus, Provider, SpeechLine } from '../../shared/types.ts';

type FrameAgent = [string, string, Provider, AgentSnapshot['kind'], AgentStatus, string, string, string, string, string];

export interface ReplayData {
  day: string;
  frames: Array<{ t: number; a: FrameAgent[] }>;
  events: Array<{ t: number; id: string; c: string; x: string }>;
}

export interface ReplayIndex {
  data: ReplayData;
  start: number;
  end: number;
  /** Events per agent, oldest first. */
  byAgent: Map<string, ReplayData['events']>;
  firstSeen: Map<string, number>;
}

const SPEECH = new Set(['say', 'think', 'ask']);

export function indexReplay(data: ReplayData): ReplayIndex | null {
  if (!data.frames.length) return null;
  data.frames.sort((a, b) => a.t - b.t);
  data.events.sort((a, b) => a.t - b.t);
  const byAgent = new Map<string, ReplayData['events']>();
  for (const e of data.events) {
    let list = byAgent.get(e.id);
    if (!list) byAgent.set(e.id, (list = []));
    list.push(e);
  }
  const firstSeen = new Map<string, number>();
  for (const f of data.frames) for (const a of f.a) if (!firstSeen.has(a[0])) firstSeen.set(a[0], f.t);
  const start = data.frames[0].t;
  const end = Math.max(data.frames.at(-1)!.t, data.events.at(-1)?.t ?? 0);
  return { data, start, end, byAgent, firstSeen };
}

/** Index of the last item with t <= at. */
function lastAt<T extends { t: number }>(list: T[], at: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The office as it was at time `at`. */
export function agentsAt(index: ReplayIndex, at: number): AgentSnapshot[] {
  const fi = lastAt(index.data.frames, at);
  if (fi < 0) return [];
  const frame = index.data.frames[fi];
  return frame.a.map(([id, persona, provider, kind, status, room, project, name, parentId, host]) => {
    const events = index.byAgent.get(id) ?? [];
    const upto = events.slice(0, lastAt(events, at) + 1);
    const actions = upto.filter((e) => !SPEECH.has(e.c)).slice(-20);
    const lines: SpeechLine[] = upto
      .filter((e) => SPEECH.has(e.c) && at - e.t < 90_000)
      .slice(-6)
      .map((e) => ({ at: e.t, kind: e.c as SpeechLine['kind'], text: e.x }));
    const recent: ActivityEvent[] = actions.map((e) => ({ at: e.t, kind: e.c as ActivityKind, label: e.x }));
    const last = upto.at(-1);
    return {
      id,
      persona,
      provider,
      kind,
      parentId: parentId || undefined,
      name,
      app: 'Replay',
      projectName: project || undefined,
      status,
      activity: actions.at(-1)?.x ?? (status === 'idle' ? 'Taking a break' : 'Working'),
      room: room as RoomId,
      domain: room as RoomId,
      usingBrowser: room === 'browser',
      startedAt: index.firstSeen.get(id) ?? frame.t,
      lastActivityAt: last?.t ?? frame.t,
      tokens: { input: 0, output: 0, cached: 0, total: 0 },
      counts: { turns: 0, tools: actions.length, edits: 0, commands: 0, reads: 0, searches: 0, browser: 0, subagents: 0, errors: 0 },
      topTools: [],
      filesTouched: [],
      lines,
      recent,
      pulses: [],
      host: host || undefined,
    } satisfies AgentSnapshot;
  });
}
