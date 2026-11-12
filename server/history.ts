// Day history for the replay and the daily standup. Compact frames (who is where, doing what) are
// written when the office changes, and short redacted events (actions and speech lines) as they
// happen, into data/history/YYYY-MM-DD.jsonl. A per-day ledger keeps totals per worker for the
// standup report. Kept for a week, local only.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSnapshot, Mission, OfficeSnapshot, Provider } from '../shared/types.ts';
import { baseName } from './util/text.ts';

const DIR = path.join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'history');
const KEEP_DAYS = 7;
const HEARTBEAT_MS = 5 * 60_000;

/** One worker in a replay frame: id, persona, provider, kind, status, room, project, name, parent, host. */
export type FrameAgent = [string, string, Provider, AgentSnapshot['kind'], AgentSnapshot['status'], string, string, string, string, string];
export interface Frame {
  t: number;
  k: 'f';
  a: FrameAgent[];
}
/** An action or a speech line: agent id, kind, text. */
export interface HistEvent {
  t: number;
  k: 'e';
  id: string;
  c: string;
  x: string;
}

interface LedgerEntry {
  id: string;
  persona: string;
  provider: Provider;
  name: string;
  host?: string;
  projectPath?: string;
  projectName?: string;
  firstAt: number;
  lastAt: number;
  tokens: number;
  edits: number;
  commands: number;
  errors: number;
  turns: number;
  files: string[];
  prs: number;
}

export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PR_RE = /pull request|\bgh pr create\b|\bgpr\b|\bgbbpr\b|opened (?:a )?PR\b/i;

export class History {
  private day = '';
  private lastFrameKey = '';
  private lastFrameAt = 0;
  private seenEvent = new Map<string, number>();
  private ledger = new Map<string, LedgerEntry>();
  private ledgerSavedAt = 0;

  constructor() {
    this.cleanup();
  }

  record(snap: OfficeSnapshot) {
    const now = snap.generatedAt;
    const day = dayKey(now);
    if (day !== this.day) {
      if (this.day) this.saveLedger(true);
      this.day = day;
      this.lastFrameKey = '';
      this.ledger = this.loadLedger(day);
      this.cleanup();
    }
    const lines: string[] = [];
    const agents: FrameAgent[] = snap.agents.map((a) => [
      a.id,
      a.persona,
      a.provider,
      a.kind,
      a.status,
      a.room,
      a.projectName ?? '',
      a.name.slice(0, 80),
      a.parentId ?? '',
      a.host ?? '',
    ]);
    const key = JSON.stringify(agents);
    if (key !== this.lastFrameKey || now - this.lastFrameAt > HEARTBEAT_MS) {
      this.lastFrameKey = key;
      this.lastFrameAt = now;
      lines.push(JSON.stringify({ t: now, k: 'f', a: agents } satisfies Frame));
    }
    for (const a of snap.agents) {
      const since = this.seenEvent.get(a.id) ?? now - 60_000;
      let max = since;
      const fresh: HistEvent[] = [];
      for (const e of a.recent) if (e.at > since) fresh.push({ t: e.at, k: 'e', id: a.id, c: e.kind, x: e.label });
      for (const l of a.lines) if (l.at > since && l.kind !== 'action') fresh.push({ t: l.at, k: 'e', id: a.id, c: l.kind, x: l.text });
      for (const e of fresh) max = Math.max(max, e.t);
      this.seenEvent.set(a.id, max);
      fresh.sort((x, y) => x.t - y.t);
      for (const e of fresh) lines.push(JSON.stringify(e));
      this.track(a, fresh, now);
    }
    if (lines.length) {
      try {
        fs.mkdirSync(DIR, { recursive: true });
        fs.appendFileSync(path.join(DIR, `${day}.jsonl`), lines.join('\n') + '\n', 'utf8');
      } catch (error) {
        console.error('[history] could not write', error);
      }
    }
    if (now - this.ledgerSavedAt > 60_000) this.saveLedger(false);
  }

  private track(a: AgentSnapshot, fresh: HistEvent[], now: number) {
    if (a.status === 'done' && !this.ledger.has(a.id)) return;
    let e = this.ledger.get(a.id);
    if (!e) {
      e = {
        id: a.id,
        persona: a.persona,
        provider: a.provider,
        name: a.name,
        host: a.host,
        projectPath: a.projectPath,
        projectName: a.projectName,
        firstAt: now,
        lastAt: now,
        tokens: 0,
        edits: 0,
        commands: 0,
        errors: 0,
        turns: 0,
        files: [],
        prs: 0,
      };
      this.ledger.set(a.id, e);
    }
    e.persona = a.persona;
    e.name = a.name;
    if (a.status === 'working' || a.status === 'waiting') e.lastAt = now;
    e.tokens = Math.max(e.tokens, a.tokens.total);
    e.edits = Math.max(e.edits, a.counts.edits);
    e.commands = Math.max(e.commands, a.counts.commands);
    e.errors = Math.max(e.errors, a.counts.errors);
    e.turns = Math.max(e.turns, a.counts.turns);
    for (const f of a.filesTouched) {
      const b = baseName(f);
      if (b && !e.files.includes(b)) e.files.push(b);
    }
    if (e.files.length > 40) e.files.splice(0, e.files.length - 40);
    e.prs += fresh.filter((x) => PR_RE.test(x.x)).length;
  }

  /** Replay data for one day. */
  replay(day: string): { day: string; frames: Frame[]; events: HistEvent[] } {
    const out = { day, frames: [] as Frame[], events: [] as HistEvent[] };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return out;
    let text = '';
    try {
      const file = path.join(DIR, `${day}.jsonl`);
      const size = fs.statSync(file).size;
      // Very busy days: keep the latest 12 MB.
      if (size > 12 * 1024 * 1024) {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(12 * 1024 * 1024);
        fs.readSync(fd, buf, 0, buf.length, size - buf.length);
        fs.closeSync(fd);
        text = buf.toString('utf8');
        text = text.slice(text.indexOf('\n') + 1);
      } else text = fs.readFileSync(file, 'utf8');
    } catch {
      return out;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as Frame | HistEvent;
        if (rec.k === 'f') out.frames.push(rec);
        else if (rec.k === 'e') out.events.push(rec);
      } catch {
        // partial line
      }
    }
    return out;
  }

  days(): string[] {
    try {
      return fs
        .readdirSync(DIR)
        .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1])
        .filter((d): d is string => Boolean(d))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /** The daily standup: what happened per project on a given day. */
  async standup(day: string, missions: Mission[]): Promise<Standup> {
    if (day === this.day) this.saveLedger(false);
    const ledger = day === this.day ? [...this.ledger.values()] : [...this.loadLedger(day).values()];
    const byProject = new Map<string, StandupProject>();
    for (const e of ledger) {
      const key = (e.projectPath ?? e.projectName ?? 'Other').toLowerCase();
      let p = byProject.get(key);
      if (!p) {
        p = { name: e.projectName ?? 'Other', path: e.projectPath, workers: [], tokens: 0, edits: 0, commands: 0, errors: 0, prs: 0, files: [], commits: [], missions: [] };
        byProject.set(key, p);
      }
      p.workers.push({ persona: e.persona, provider: e.provider, name: e.name, host: e.host, from: e.firstAt, to: e.lastAt });
      p.tokens += e.tokens;
      p.edits += e.edits;
      p.commands += e.commands;
      p.errors += e.errors;
      p.prs += e.prs;
      for (const f of e.files) if (!p.files.includes(f)) p.files.push(f);
    }
    const start = new Date(`${day}T00:00:00`).getTime();
    const end = start + 86_400_000;
    for (const m of missions) {
      const t = m.endedAt ?? m.startedAt ?? m.createdAt;
      if (t < start || t >= end) continue;
      const key = m.projectPath.toLowerCase();
      let p = byProject.get(key);
      if (!p) {
        p = { name: m.projectName, path: m.projectPath, workers: [], tokens: 0, edits: 0, commands: 0, errors: 0, prs: 0, files: [], commits: [], missions: [] };
        byProject.set(key, p);
      }
      p.missions.push({ title: m.title, status: m.status });
    }
    await Promise.all(
      [...byProject.values()].map(async (p) => {
        if (p.path && fs.existsSync(path.join(p.path, '.git'))) p.commits = await commits(p.path, start, end);
      }),
    );
    const projects = [...byProject.values()].sort((a, b) => b.commits.length + b.edits - (a.commits.length + a.edits));
    return { day, generatedAt: Date.now(), projects };
  }

  private loadLedger(day: string): Map<string, LedgerEntry> {
    const map = new Map<string, LedgerEntry>();
    try {
      const list = JSON.parse(fs.readFileSync(path.join(DIR, `${day}.ledger.json`), 'utf8')) as LedgerEntry[];
      for (const e of list) if (e?.id) map.set(e.id, e);
    } catch {
      // nothing yet
    }
    return map;
  }

  private saveLedger(force: boolean) {
    if (!this.day || (!force && !this.ledger.size)) return;
    this.ledgerSavedAt = Date.now();
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(path.join(DIR, `${this.day}.ledger.json`), JSON.stringify([...this.ledger.values()]), 'utf8');
    } catch (error) {
      console.error('[history] could not save the ledger', error);
    }
  }

  private cleanup() {
    const cutoff = dayKey(Date.now() - KEEP_DAYS * 86_400_000);
    try {
      for (const n of fs.readdirSync(DIR)) {
        const d = n.match(/^(\d{4}-\d{2}-\d{2})\./)?.[1];
        if (d && d < cutoff) fs.rmSync(path.join(DIR, n), { force: true });
      }
    } catch {
      // no history yet
    }
  }
}

export interface StandupProject {
  name: string;
  path?: string;
  workers: Array<{ persona: string; provider: Provider; name: string; host?: string; from: number; to: number }>;
  tokens: number;
  edits: number;
  commands: number;
  errors: number;
  prs: number;
  files: string[];
  commits: Array<{ hash: string; subject: string; at: number }>;
  missions: Array<{ title: string; status: Mission['status'] }>;
}

export interface Standup {
  day: string;
  generatedAt: number;
  projects: StandupProject[];
}

/** Commits made that day in a local repository (read-only git log). */
function commits(dir: string, start: number, end: number): Promise<StandupProject['commits']> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'log', '--all', `--since=${new Date(start).toISOString()}`, `--until=${new Date(end).toISOString()}`, '--pretty=format:%h%x09%ct%x09%s', '-n', '60'],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve([]);
        resolve(
          stdout
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              const [hash, ct, ...rest] = l.split('\t');
              return { hash, at: Number(ct) * 1000, subject: rest.join('\t').slice(0, 140) };
            }),
        );
      },
    );
  });
}
