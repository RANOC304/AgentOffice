// Reads BrowserOS neo's local activity log (read-only): which agent session opened which page,
// and the screenshots Neo saved. Chats from the ChatGPT and Claude apps are cloud-only, so this
// log is how their sessions show up in the office when they drive Neo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentSnapshot, AgentStatus, Provider, SourceStatus } from '../../shared/types.ts';
import { AgentRecord } from '../agent.ts';
import { hintsForText } from '../classify.ts';
import { config } from '../config.ts';
import { clean } from '../util/text.ts';

export interface NeoEvent {
  at: number;
  tool: string;
  url?: string;
  title?: string;
}

export interface NeoTabState {
  id: string;
  url?: string;
  title?: string;
  at: number;
  shotId?: number;
  closed: boolean;
}

export interface NeoSession {
  sessionId: string;
  client: string;
  label: string;
  first: number;
  last: number;
  actions: number;
  url?: string;
  title?: string;
  urlAt?: number;
  task?: string;
  taskTitle?: string;
  ended: boolean;
  shotFile?: string;
  events: NeoEvent[];
  tabs: Map<string, NeoTabState>;
}

const SYSTEM_CLIENTS = /^(neo-startup-check|neo-bridge)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function candidates(): string[] {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const list = [
    process.env.AGENTOFFICE_NEO_DIR,
    path.join(local, 'BrowserClaw', 'User Data', '.browseros', '.browserclaw'),
    path.join(os.homedir(), '.browserclaw'),
  ].filter(Boolean) as string[];
  return list.filter((dir) => fs.existsSync(path.join(dir, 'browserclaw.sqlite')));
}

function newest(dirs: string[]): string | undefined {
  let best: string | undefined;
  let bestTime = -1;
  for (const dir of dirs) {
    for (const f of ['browserclaw.sqlite-wal', 'browserclaw.sqlite']) {
      try {
        const t = fs.statSync(path.join(dir, f)).mtimeMs;
        if (t > bestTime) {
          bestTime = t;
          best = dir;
        }
      } catch {
        // ignore
      }
    }
  }
  return best;
}

export function host(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function describeNeoEvent(e: NeoEvent): string {
  const where = e.title ? `“${clean(e.title, 50)}”` : host(e.url) ?? 'a page';
  if (/navigate|open|tabs/i.test(e.tool) && e.url) return `Opening ${host(e.url) ?? 'a page'}`;
  if (/observe|snapshot|read|grep|extract/i.test(e.tool)) return `Reading ${where}`;
  if (/act|click|fill|type/i.test(e.tool)) return `Clicking around ${where}`;
  if (/screenshot/i.test(e.tool)) return `Screenshotting ${where}`;
  if (/^run$/i.test(e.tool)) return 'Running a browser script';
  if (/download/i.test(e.tool)) return 'Downloading a file';
  if (/name_session/i.test(e.tool)) return 'Starting a browser task';
  return `Browsing (${e.tool.replace(/[._]/g, ' ')})`;
}

export class NeoCollector {
  status: SourceStatus = { id: 'neo', label: 'BrowserOS neo', ok: false, path: '' };
  private dir?: string;
  private db: DatabaseSync | null = null;
  private lastId = 0;
  private lastDirCheck = 0;
  private lastTaskRefresh = 0;
  readonly sessions = new Map<string, NeoSession>();
  private records = new Map<string, { record: AgentRecord; seen: number }>();

  poll(now: number): NeoSession[] {
    try {
      this.ensureDb(now);
      if (!this.db) return [];
      this.readDispatches(now);
      if (now - this.lastTaskRefresh > 8000) {
        this.lastTaskRefresh = now;
        this.refreshTasks(now);
      }
      const out: NeoSession[] = [];
      for (const [id, s] of this.sessions) {
        if (now - s.last > config.windowMs) {
          this.sessions.delete(id);
          continue;
        }
        if (SYSTEM_CLIENTS.test(s.client)) continue;
        if (now - s.last < 30 * 60_000) s.shotFile = this.latestShot(id) ?? s.shotFile;
        out.push(s);
      }
      this.status = { id: 'neo', label: 'BrowserOS neo', ok: true, path: this.dir ?? '', message: `${out.filter((s) => now - s.last < 120_000).length} browsing now` };
      return out.sort((a, b) => b.last - a.last);
    } catch (error) {
      this.status = { id: 'neo', label: 'BrowserOS neo', ok: false, path: this.dir ?? '', message: (error as Error).message };
      this.db?.close();
      this.db = null;
      return [];
    }
  }

  private ensureDb(now: number) {
    if (this.db && now - this.lastDirCheck < 60_000) return;
    this.lastDirCheck = now;
    const dir = newest(candidates());
    if (!dir) {
      this.status = { id: 'neo', label: 'BrowserOS neo', ok: false, path: '', message: 'BrowserOS neo data not found' };
      return;
    }
    if (dir === this.dir && this.db) return;
    this.db?.close();
    this.dir = dir;
    this.db = new DatabaseSync(path.join(dir, 'browserclaw.sqlite'), { readOnly: true });
    this.sessions.clear();
    const row = this.db
      .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM tool_dispatches WHERE created_at < ?')
      .get(now - config.windowMs) as { id: number } | undefined;
    this.lastId = Number(row?.id ?? 0);
  }

  private readDispatches(now: number) {
    const rows = this.db!
      .prepare(
        'SELECT id, created_at, session_id, agent_label, tool_name, url, title, args_json, tab_id, page_id, has_screenshot FROM tool_dispatches WHERE id > ? ORDER BY id LIMIT 4000',
      )
      .all(this.lastId) as Array<Record<string, unknown>>;
    for (const r of rows) {
      this.lastId = Math.max(this.lastId, Number(r.id));
      const sessionId = String(r.session_id);
      const at = Number(r.created_at);
      let s = this.sessions.get(sessionId);
      if (!s) {
        const start = this.db!
          .prepare('SELECT client_name, agent_label FROM agent_session_starts WHERE session_id = ? LIMIT 1')
          .get(sessionId) as { client_name?: string; agent_label?: string } | undefined;
        s = {
          sessionId,
          client: String(start?.client_name ?? r.agent_label ?? 'unknown'),
          label: String(start?.agent_label ?? r.agent_label ?? ''),
          first: at,
          last: at,
          actions: 0,
          ended: false,
          events: [],
          tabs: new Map(),
        };
        this.sessions.set(sessionId, s);
      }
      s.last = Math.max(s.last, at);
      s.first = Math.min(s.first, at);
      s.actions += 1;
      s.ended = false;
      const tool = String(r.tool_name ?? 'tool');
      const url = typeof r.url === 'string' && r.url ? r.url : undefined;
      const title = typeof r.title === 'string' && r.title ? r.title : undefined;
      const tabKey = r.tab_id != null ? String(r.tab_id) : r.page_id != null ? `p${r.page_id}` : null;
      if (tabKey) {
        let tab = s.tabs.get(tabKey);
        if (!tab) s.tabs.set(tabKey, (tab = { id: tabKey, at, closed: false }));
        tab.at = Math.max(tab.at, at);
        if (url && /^https?:/i.test(url)) {
          tab.url = url;
          tab.title = title ?? tab.title;
        }
        tab.closed = /close/i.test(tool);
        if (Number(r.has_screenshot)) tab.shotId = Number(r.id);
      }
      if (url && /^https?:/i.test(url) && at >= (s.urlAt ?? 0)) {
        s.url = url;
        s.title = title;
        s.urlAt = at;
      }
      if (/name_session/i.test(tool) && typeof r.args_json === 'string') {
        try {
          const args = JSON.parse(r.args_json) as { name?: string };
          if (args.name) s.task = args.name;
        } catch {
          // ignore
        }
      }
      if (!/tab_groups|name_session|tabs$/i.test(tool) || url) {
        s.events.push({ at, tool, url, title });
        if (s.events.length > 40) s.events.splice(0, s.events.length - 40);
      }
    }
    void now;
  }

  private refreshTasks(now: number) {
    const stmt = this.db!.prepare('SELECT title, ended_at FROM tasks WHERE session_id = ?');
    for (const s of this.sessions.values()) {
      if (now - s.last > 60 * 60_000) continue;
      const t = stmt.get(s.sessionId) as { title?: string; ended_at?: number | null } | undefined;
      if (!t) continue;
      if (t.title && !/^Session on /.test(t.title)) s.taskTitle = t.title;
      s.ended = t.ended_at != null && Number(t.ended_at) >= s.last;
    }
  }

  private shotDir(sessionId: string): string | undefined {
    if (!this.dir) return undefined;
    const enc = Buffer.from(sessionId).toString('base64');
    for (const name of [enc, enc.replace(/=+$/, ''), Buffer.from(sessionId).toString('base64url')]) {
      const dir = path.join(this.dir, 'screenshots', `s-${name}`);
      if (fs.existsSync(dir)) return dir;
    }
    return undefined;
  }

  private latestShot(sessionId: string): string | undefined {
    const dir = this.shotDir(sessionId);
    if (!dir) return undefined;
    let best: string | undefined;
    let bestTime = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\w+\.(jpe?g|png|webp)$/i.test(f)) continue;
      const t = fs.statSync(path.join(dir, f)).mtimeMs;
      if (t > bestTime) {
        bestTime = t;
        best = f;
      }
    }
    return best;
  }

  /** A session's tabs, newest first, with screenshot paths for the ones Neo captured. */
  tabsOf(s: NeoSession): Array<{ id: string; url?: string; title?: string; at: number; shot?: string; closed: boolean }> {
    const dir = this.shotDir(s.sessionId);
    return [...s.tabs.values()]
      .filter((t) => t.url)
      .sort((a, b) => b.at - a.at)
      .slice(0, 16)
      .map((t) => {
        const file = t.shotId !== undefined ? `${t.shotId}.jpg` : undefined;
        const shot = file && dir && fs.existsSync(path.join(dir, file)) ? `/api/neo/shot/${s.sessionId}/${file}` : undefined;
        return { id: t.id, url: t.url, title: t.title, at: t.at, shot, closed: t.closed };
      });
  }

  /** Absolute path of a screenshot, only if it lives inside Neo's screenshots folder. */
  shotPath(sessionId: string, file: string): string | null {
    if (!UUID.test(sessionId) || !/^\w+\.(jpe?g|png|webp)$/i.test(file)) return null;
    const dir = this.shotDir(sessionId);
    if (!dir) return null;
    const full = path.join(dir, file);
    return full.startsWith(dir) && fs.existsSync(full) ? full : null;
  }

  /** A character for a chat (ChatGPT or Claude app) seen only through its Neo activity. */
  chatAgent(s: NeoSession, provider: Provider, now: number): AgentSnapshot | null {
    const sinceLast = now - s.last;
    let status: AgentStatus;
    if (sinceLast < 120_000) status = 'working';
    else if (sinceLast < 20 * 60_000) status = 'idle';
    else return null;

    let entry = this.records.get(s.sessionId);
    if (!entry) {
      const record = new AgentRecord(`${provider}:neo:${s.sessionId}`, provider, 'session');
      record.app = provider === 'chatgpt' ? 'ChatGPT app · via BrowserOS neo' : 'Claude app · via BrowserOS neo';
      entry = { record, seen: 0 };
      this.records.set(s.sessionId, entry);
    }
    const r = entry.record;
    const name = s.task ? humanize(s.task) : s.taskTitle ?? `${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'} chat`;
    r.setName(name);
    for (const e of s.events) {
      if (e.at <= entry.seen) continue;
      const label = describeNeoEvent(e);
      r.tool(`neo/${e.tool}`);
      r.counts.browser += 1;
      r.lastBrowserAt = e.at;
      r.event(e.at, 'browser', label, e.url, { research: 0.6, ...hintsForText(`${e.title ?? ''} ${host(e.url) ?? ''}`, 0.6) });
      if (e.title) r.say(e.at, 'action', label);
    }
    entry.seen = Math.max(entry.seen, ...s.events.map((e) => e.at));
    if (!r.startedAt || s.first < r.startedAt) r.startedAt = s.first;
    for (const [id, e] of this.records) if (now - e.record.lastActivityAt > config.windowMs) this.records.delete(id);
    return r.snapshot(now, status, {
      attention: status === 'idle' ? { level: 'info', reason: 'Chat paused in BrowserOS neo' } : undefined,
    });
  }
}

function humanize(task: string): string {
  const text = task.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
