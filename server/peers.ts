// Remote computers. Another computer runs `npm run peer`, which writes a compact, redacted snapshot
// of its own agents into a shared folder (OneDrive, Google Drive, Dropbox, Syncthing, a network
// share…). This office reads every peer file in that folder and shows those agents too, tagged with
// their computer's name. No network listener and no outbound request: the sync tool moves the files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_META, ROOM_BY_ID } from '../shared/rooms.ts';
import type { AgentSnapshot, NeoPage, PeerStatus } from '../shared/types.ts';

const SETTINGS = path.join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'settings.json');
/** A peer that has not written for this long is offline and its agents leave. Long enough to ride out a Syncthing retry. */
export const PEER_STALE_MS = 6 * 60_000;
const MAX_FILE = 4 * 1024 * 1024;

export interface PeerFile {
  version: 1;
  host: string;
  generatedAt: number;
  agents: AgentSnapshot[];
  neoPages: NeoPage[];
}

interface Settings {
  peersDir?: string;
}

export function readSettings(): Settings {
  try {
    // Tolerate a byte-order mark: Windows editors and PowerShell add one, and it would make the file unreadable.
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8').replace(/^﻿/, '')) as Settings;
  } catch {
    return {};
  }
}

export function writeSettings(patch: Settings) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 1), 'utf8');
}

/** File name for a computer in the peers folder. */
export function peerFileName(host: string): string {
  return `${host.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'computer'}.agentoffice.json`;
}

export class Peers {
  private cache = new Map<string, { mtime: number; data: PeerFile | null }>();
  list: PeerStatus[] = [];
  /** Why the shared folder cannot be used right now; the dashboard shows it. */
  problem?: string;

  get dir(): string | undefined {
    return process.env.AGENTOFFICE_PEERS_DIR || readSettings().peersDir || undefined;
  }

  /** Sets (or clears) the shared folder. Creates it when its parent exists. */
  setDir(dir: string | null): string | null {
    if (!dir) {
      writeSettings({ peersDir: undefined });
      return null;
    }
    if (!path.isAbsolute(dir)) return 'Use a full folder path.';
    const resolved = path.resolve(dir);
    try {
      if (!fs.existsSync(resolved)) {
        if (!fs.existsSync(path.dirname(resolved))) return 'That folder does not exist.';
        fs.mkdirSync(resolved);
      }
      if (!fs.statSync(resolved).isDirectory()) return 'That is not a folder.';
    } catch (error) {
      return `Cannot use that folder: ${(error as Error).message}`;
    }
    writeSettings({ peersDir: resolved });
    this.cache.clear();
    return null;
  }

  /** Agents from every online peer, with ids namespaced by computer. */
  poll(now: number): { agents: AgentSnapshot[]; neoPages: NeoPage[] } {
    const dir = this.dir;
    const out = { agents: [] as AgentSnapshot[], neoPages: [] as NeoPage[] };
    this.list = [];
    this.problem = undefined;
    if (!dir) return out;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.agentoffice.json'));
    } catch {
      this.problem = 'The shared folder cannot be read. Check that it exists and that your sync tool is running.';
      return out;
    }
    const self = peerFileName(os.hostname());
    for (const name of names) {
      if (name === self) continue;
      const file = path.join(dir, name);
      let data: PeerFile | null = null;
      try {
        const stat = fs.statSync(file);
        const cached = this.cache.get(file);
        if (cached && cached.mtime === stat.mtimeMs) data = cached.data;
        else if (stat.size <= MAX_FILE) {
          try {
            data = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
          } catch {
            data = cached?.data ?? null; // being synced; keep the previous copy
          }
          this.cache.set(file, { mtime: stat.mtimeMs, data });
        }
      } catch {
        continue;
      }
      if (!data) continue;
      const online = now - data.generatedAt < PEER_STALE_MS;
      this.list.push({ host: data.host, online, updatedAt: data.generatedAt, agents: online ? data.agents.length : 0 });
      if (!online) continue;
      const prefix = `peer:${data.host}:`;
      for (const a of data.agents) {
        out.agents.push({
          ...a,
          id: prefix + a.id,
          parentId: a.parentId ? prefix + a.parentId : undefined,
          host: data.host,
          controls: { reply: null, canStop: false, open: [] },
          neo: a.neo ? { ...a.neo, shot: undefined, agentId: prefix + a.id, tabs: a.neo.tabs.map((t) => ({ ...t, shot: undefined })) } : undefined,
        });
      }
      for (const p of data.neoPages) out.neoPages.push({ ...p, shot: undefined, agentId: p.agentId ? prefix + p.agentId : undefined, tabs: p.tabs.map((t) => ({ ...t, shot: undefined })) });
    }
    this.list.sort((a, b) => a.host.localeCompare(b.host));
    return out;
  }
}

/** Light sanity check of a peer file; anything odd is ignored. */
function validate(raw: unknown): PeerFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PeerFile>;
  if (r.version !== 1 || typeof r.host !== 'string' || typeof r.generatedAt !== 'number' || !Array.isArray(r.agents)) return null;
  const host = r.host.replace(/[^\w.-]/g, '').slice(0, 60);
  if (!host) return null;
  const agents = r.agents.slice(0, 200).map(normalizeAgent).filter((a): a is AgentSnapshot => a !== null);
  const pages = Array.isArray(r.neoPages) ? r.neoPages.slice(0, 20).filter((p) => p && typeof p.sessionId === 'string' && Array.isArray(p.tabs)) : [];
  return { version: 1, host, generatedAt: r.generatedAt, agents, neoPages: pages };
}

const STATUSES = new Set(['working', 'waiting', 'idle', 'done']);
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Fills every field the office relies on, so a damaged or older peer file cannot break the page. */
function normalizeAgent(raw: unknown): AgentSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, any>;
  if (typeof a.id !== 'string' || !(a.provider in PROVIDER_META) || !STATUSES.has(a.status)) return null;
  const room = a.room in ROOM_BY_ID ? a.room : 'general';
  const counts = a.counts && typeof a.counts === 'object' ? a.counts : {};
  const tokens = a.tokens && typeof a.tokens === 'object' ? a.tokens : {};
  const list = <T>(v: unknown, max: number, ok: (x: any) => boolean): T[] => (Array.isArray(v) ? (v.filter(ok).slice(-max) as T[]) : []);
  return {
    id: a.id.slice(0, 200),
    persona: '',
    provider: a.provider,
    kind: a.kind === 'subagent' ? 'subagent' : 'session',
    parentId: str(a.parentId, 200),
    name: str(a.name, 200) ?? 'Session',
    role: str(a.role, 200),
    app: str(a.app, 80) ?? '',
    model: str(a.model, 80),
    projectPath: str(a.projectPath, 400),
    projectName: str(a.projectName, 120),
    branch: str(a.branch, 120),
    status: a.status,
    activity: str(a.activity, 160) ?? '',
    room,
    domain: a.domain in ROOM_BY_ID ? a.domain : room,
    usingBrowser: Boolean(a.usingBrowser),
    browserAt: typeof a.browserAt === 'number' ? a.browserAt : undefined,
    neo: a.neo && typeof a.neo === 'object' && Array.isArray(a.neo.tabs) ? a.neo : undefined,
    startedAt: num(a.startedAt),
    lastActivityAt: num(a.lastActivityAt),
    lastPromptAt: typeof a.lastPromptAt === 'number' ? a.lastPromptAt : undefined,
    tokens: { input: num(tokens.input), output: num(tokens.output), cached: num(tokens.cached), total: num(tokens.total) },
    counts: {
      turns: num(counts.turns),
      tools: num(counts.tools),
      edits: num(counts.edits),
      commands: num(counts.commands),
      reads: num(counts.reads),
      searches: num(counts.searches),
      browser: num(counts.browser),
      subagents: num(counts.subagents),
      errors: num(counts.errors),
    },
    topTools: list(a.topTools, 8, (t) => t && typeof t.name === 'string' && typeof t.count === 'number'),
    filesTouched: list(a.filesTouched, 40, (f) => typeof f === 'string'),
    lastPrompt: str(a.lastPrompt, 400),
    lastMessage: str(a.lastMessage, 600),
    lines: list(a.lines, 30, (l) => l && typeof l.text === 'string' && typeof l.at === 'number' && ['say', 'think', 'action', 'ask'].includes(l.kind)),
    recent: list(a.recent, 40, (e) => e && typeof e.label === 'string' && typeof e.at === 'number' && typeof e.kind === 'string'),
    attention:
      a.attention && typeof a.attention.reason === 'string' && ['info', 'warn', 'alert'].includes(a.attention.level)
        ? { level: a.attention.level, reason: a.attention.reason.slice(0, 200) }
        : undefined,
    pulses: list(a.pulses, 400, (p) => typeof p === 'number'),
  };
}
