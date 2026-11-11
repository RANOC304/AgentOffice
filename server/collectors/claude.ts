// Reads Claude Code sessions: live session registry (~/.claude/sessions/<pid>.json),
// transcripts (~/.claude/projects/<slug>/<sessionId>.jsonl) and subagent transcripts.

import fs from 'node:fs';
import path from 'node:path';
import type { AgentSnapshot, AgentStatus, Attention, SourceStatus } from '../../shared/types.ts';
import { AgentRecord } from '../agent.ts';
import { config } from '../config.ts';
import { claudeToolActivity } from '../tools.ts';
import { JsonlTail } from '../util/tail.ts';
import { clean, firstSentence } from '../util/text.ts';
import { isAlive } from '../util/proc.ts';

interface LiveInfo {
  pid: number;
  sessionId: string;
  cwd?: string;
  name?: string;
  status?: string;
  entrypoint?: string;
  kind?: string;
  startedAt?: number;
  updatedAt?: number;
}

interface Tracked {
  record: AgentRecord;
  tail: JsonlTail;
  seenMessages: Set<string>;
  pending: Map<string, { name: string; at: number; waiting?: string }>;
  live?: LiveInfo;
  lastSeenLive: number;
  lastRecordAt: number;
  lastRecordType?: string;
  subagentsDir?: string;
  subagentMeta?: { agentType?: string; description?: string; finished?: boolean };
  metaFile?: string;
  hasTitle: boolean;
}

type Rec = Record<string, any>;

const ENTRYPOINT_LABEL: Record<string, string> = {
  'claude-desktop': 'Claude desktop',
  cli: 'Claude Code CLI',
  'sdk-ts': 'Claude Agent SDK',
  'sdk-py': 'Claude Agent SDK',
  vscode: 'Claude Code · VS Code',
  jetbrains: 'Claude Code · JetBrains',
};

function ts(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .filter((b: Rec) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b: Rec) => b.text)
      .join('\n');
  return '';
}

function isRealPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<command-') || t.startsWith('<local-command') || t.startsWith('Caveat:')) return false;
  if (t.startsWith('[Request interrupted')) return false;
  if (/^<[a-z-]+-event>/.test(t) || t.startsWith('<task-notification>') || t.startsWith('<system-reminder>')) return false;
  return true;
}

export class ClaudeCollector {
  private readonly sessionsDir = path.join(config.claudeHome, 'sessions');
  private readonly projectsDir = path.join(config.claudeHome, 'projects');
  private sessions = new Map<string, Tracked>();
  private subagents = new Map<string, Tracked>();
  private transcriptCache = new Map<string, string>();
  private lastProjectScan = 0;
  private lastSubagentScan = 0;
  private recentTranscripts = new Map<string, number>();
  status: SourceStatus = { provider: 'claude', ok: false, path: this.projectsDir };

  poll(now: number): AgentSnapshot[] {
    if (!fs.existsSync(this.projectsDir)) {
      this.status = { provider: 'claude', ok: false, path: this.projectsDir, message: 'Claude Code data folder not found' };
      return [];
    }
    const live = this.readLive();
    for (const info of live) {
      const file = this.findTranscript(info.sessionId);
      let tracked = this.sessions.get(info.sessionId);
      if (!tracked && file) tracked = this.track(info.sessionId, file);
      if (tracked) {
        tracked.live = info;
        tracked.lastSeenLive = now;
      }
    }
    const liveIds = new Set(live.map((l) => l.sessionId));
    for (const tracked of this.sessions.values()) if (!liveIds.has(tracked.record.id.slice(7))) tracked.live = undefined;

    // Headless/SDK sessions that never registered as live but are writing right now.
    if (now - this.lastProjectScan > 5000) {
      this.lastProjectScan = now;
      this.scanRecentTranscripts(now);
    }
    for (const [file, mtime] of this.recentTranscripts) {
      const sessionId = path.basename(file, '.jsonl');
      if (!this.sessions.has(sessionId) && now - mtime < 3 * 60_000) this.track(sessionId, file);
    }

    const out: AgentSnapshot[] = [];
    for (const [sessionId, tracked] of this.sessions) {
      this.ingest(tracked);
      const snap = this.sessionSnapshot(tracked, now);
      if (!snap) {
        if (!tracked.live && now - tracked.lastSeenLive > config.doneLingerMinutes * 60_000 * 2) this.sessions.delete(sessionId);
        continue;
      }
      out.push(snap);
    }

    if (now - this.lastSubagentScan > 3000) {
      this.lastSubagentScan = now;
      this.scanSubagents(now);
    }
    for (const [key, sub] of this.subagents) {
      this.ingest(sub);
      const snap = this.subagentSnapshot(sub, now);
      if (snap) out.push(snap);
      else if (now - sub.lastRecordAt > config.doneLingerMinutes * 60_000 * 3) this.subagents.delete(key);
    }

    this.status = { provider: 'claude', ok: true, path: this.projectsDir, message: `${live.length} live session(s)` };
    return out;
  }

  private readLive(): LiveInfo[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.sessionsDir).filter((n) => /^\d+\.json$/.test(n));
    } catch {
      return [];
    }
    const out: LiveInfo[] = [];
    for (const name of names) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, name), 'utf8')) as LiveInfo;
        if (info.sessionId && info.pid && isAlive(info.pid)) out.push(info);
      } catch {
        // Being rewritten; try next poll.
      }
    }
    return out;
  }

  private findTranscript(sessionId: string): string | undefined {
    const cached = this.transcriptCache.get(sessionId);
    if (cached && fs.existsSync(cached)) return cached;
    try {
      for (const dir of fs.readdirSync(this.projectsDir)) {
        const candidate = path.join(this.projectsDir, dir, `${sessionId}.jsonl`);
        if (fs.existsSync(candidate)) {
          this.transcriptCache.set(sessionId, candidate);
          return candidate;
        }
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private scanRecentTranscripts(now: number) {
    this.recentTranscripts.clear();
    try {
      for (const dir of fs.readdirSync(this.projectsDir)) {
        const full = path.join(this.projectsDir, dir);
        let entries: string[] = [];
        try {
          entries = fs.readdirSync(full);
        } catch {
          continue;
        }
        for (const name of entries) {
          if (!name.endsWith('.jsonl')) continue;
          const file = path.join(full, name);
          try {
            const { mtimeMs } = fs.statSync(file);
            if (now - mtimeMs < 3 * 60_000) this.recentTranscripts.set(file, mtimeMs);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private track(sessionId: string, file: string): Tracked {
    const record = new AgentRecord(`claude:${sessionId}`, 'claude', 'session');
    record.app = 'Claude Code';
    const tracked: Tracked = {
      record,
      tail: new JsonlTail(file, config.maxInitialBytes),
      seenMessages: new Set(),
      pending: new Map(),
      lastSeenLive: 0,
      lastRecordAt: 0,
      subagentsDir: path.join(path.dirname(file), sessionId, 'subagents'),
      hasTitle: false,
    };
    this.sessions.set(sessionId, tracked);
    return tracked;
  }

  private scanSubagents(now: number) {
    for (const parent of this.sessions.values()) {
      if (!parent.subagentsDir || (!parent.live && now - parent.lastRecordAt > config.doneLingerMinutes * 60_000)) continue;
      let names: string[] = [];
      try {
        names = fs.readdirSync(parent.subagentsDir).filter((n) => n.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const name of names) {
        const agentId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
        const key = `${parent.record.id}:${agentId}`;
        if (this.subagents.has(key)) continue;
        const file = path.join(parent.subagentsDir, name);
        const metaFile = file.replace(/\.jsonl$/, '.meta.json');
        let meta: Tracked['subagentMeta'];
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        } catch {
          meta = undefined;
        }
        let mtime = 0;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        // Skip old finished helpers without parsing them.
        if (meta?.finished && now - mtime > config.doneLingerMinutes * 60_000) continue;
        if (now - mtime > config.recentMinutes * 60_000) continue;
        const record = new AgentRecord(key, 'claude', 'subagent');
        record.parentId = parent.record.id;
        record.app = parent.record.app;
        record.role = meta?.agentType;
        record.setName(meta?.description ?? meta?.agentType ?? 'Subagent');
        record.setProject(parent.record.projectPath);
        this.subagents.set(key, {
          record,
          tail: new JsonlTail(file, config.maxInitialBytes),
          seenMessages: new Set(),
          pending: new Map(),
          lastSeenLive: 0,
          lastRecordAt: 0,
          subagentMeta: meta,
          metaFile,
          hasTitle: true,
        });
      }
    }
  }

  private ingest(t: Tracked) {
    const records = t.tail.read();
    if (!records) return;
    for (const raw of records) this.apply(t, raw as Rec);
    if (t.metaFile && records.length) {
      try {
        t.subagentMeta = JSON.parse(fs.readFileSync(t.metaFile, 'utf8'));
      } catch {
        // keep previous
      }
    }
  }

  private apply(t: Tracked, rec: Rec) {
    const r = t.record;
    const at = ts(rec.timestamp);
    if (at) t.lastRecordAt = Math.max(t.lastRecordAt, at);
    if (rec.type) t.lastRecordType = rec.type;
    if (rec.cwd && !r.projectPath) r.setProject(rec.cwd);
    if (rec.gitBranch && rec.gitBranch !== 'HEAD') r.branch = rec.gitBranch;
    if (rec.entrypoint && r.kind === 'session') r.app = ENTRYPOINT_LABEL[rec.entrypoint] ?? `Claude Code (${rec.entrypoint})`;

    switch (rec.type) {
      case 'custom-title':
        r.setName(rec.customTitle);
        t.hasTitle = true;
        return;
      case 'agent-name':
        if (!t.hasTitle) r.setName(rec.agentName);
        return;
      case 'summary':
        if (!t.hasTitle && rec.summary) r.setName(rec.summary);
        return;
      case 'relocated':
        if (rec.relocatedCwd) r.setProject(rec.relocatedCwd);
        return;
      case 'pr-link':
        r.event(at || Date.now(), 'tool', `Opened PR #${rec.prNumber}`, rec.prRepository, { devops: 1 });
        return;
      case 'system':
        if (rec.subtype === 'api_error' && at) {
          r.counts.errors += 1;
          r.lastErrorAt = at;
          r.event(at, 'error', `API hiccup: ${clean(rec.error?.formatted ?? rec.error?.message, 60)}`);
        } else if (rec.subtype === 'compact_boundary' && at) {
          r.event(at, 'thinking', 'Compacting the conversation');
        }
        return;
      case 'user':
        this.applyUser(t, rec, at);
        return;
      case 'assistant':
        this.applyAssistant(t, rec, at);
        return;
      default:
        return;
    }
  }

  private applyUser(t: Tracked, rec: Rec, at: number) {
    const r = t.record;
    const content = rec.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as Rec[]) {
        if (block?.type !== 'tool_result') continue;
        const pending = t.pending.get(block.tool_use_id);
        t.pending.delete(block.tool_use_id);
        if (block.is_error && at) {
          r.counts.errors += 1;
          r.lastErrorAt = at;
          r.event(at, 'error', `${pending?.name ?? 'Tool'} failed`, clean(textOf(block.content) || String(block.content ?? ''), 100));
        }
      }
    }
    if (rec.isMeta || rec.isCompactSummary || rec.toolUseResult) return;
    const text = textOf(content);
    if (!isRealPrompt(text) || !at) return;
    // A sidechain's first user message is the delegation prompt.
    r.prompt(at, text);
    if (r.kind === 'session') r.waitingReason = undefined;
  }

  private applyAssistant(t: Tracked, rec: Rec, at: number) {
    const r = t.record;
    const msg = rec.message ?? {};
    if (msg.model && msg.model !== '<synthetic>') r.model = msg.model;
    if (msg.id && msg.usage && !t.seenMessages.has(msg.id)) {
      t.seenMessages.add(msg.id);
      if (t.seenMessages.size > 3000) t.seenMessages = new Set([...t.seenMessages].slice(-1500));
      const u = msg.usage;
      const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      const cached = u.cache_read_input_tokens ?? 0;
      const output = u.output_tokens ?? 0;
      r.tokens.input += input;
      r.tokens.cached += cached;
      r.tokens.output += output;
      r.tokens.total += input + cached + output;
    }
    if (!at) return;
    r.touch(at);
    const content = Array.isArray(msg.content) ? (msg.content as Rec[]) : [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        r.message(at, block.text);
        r.say(at, /\?\s*$/.test(block.text.trim()) ? 'ask' : 'say', firstSentence(block.text));
      } else if (block.type === 'thinking' && block.thinking) {
        r.say(at, 'think', firstSentence(block.thinking, 90));
      } else if (block.type === 'tool_use') {
        const act = claudeToolActivity(block.name, block.input ?? {});
        r.tool(block.name);
        if (act.counter) r.counts[act.counter] += 1;
        if (act.browser) r.lastBrowserAt = at;
        if (act.file) r.file(act.file);
        if (act.think) r.say(at, 'think', act.think);
        r.event(at, act.kind, act.label, act.detail, act.hints);
        r.say(at, 'action', act.label);
        t.pending.set(block.id, { name: block.name, at, waiting: act.waiting });
        if (act.waiting) r.waitingReason = act.waiting;
      }
    }
  }

  private pendingWaiting(t: Tracked): string | undefined {
    for (const p of t.pending.values()) if (p.waiting) return p.waiting;
    return undefined;
  }

  private sessionSnapshot(t: Tracked, now: number): AgentSnapshot | null {
    const r = t.record;
    const live = t.live;
    if (live) {
      if (live.name) r.setName(live.name);
      if (live.cwd) r.setProject(live.cwd);
      if (live.entrypoint) r.app = ENTRYPOINT_LABEL[live.entrypoint] ?? `Claude Code (${live.entrypoint})`;
      if (live.startedAt && (!r.startedAt || live.startedAt < r.startedAt)) r.startedAt = live.startedAt;
    }
    let status: AgentStatus;
    const waiting = this.pendingWaiting(t);
    if (live) {
      const s = (live.status ?? '').toLowerCase();
      if (waiting) status = 'waiting';
      else if (/wait|permission|approv|input|blocked|requires/.test(s)) {
        status = 'waiting';
        r.waitingReason ??= 'Waiting for your approval';
      } else if (s === 'busy' || s === 'running' || s === 'working') status = 'working';
      else status = 'idle';
      if (live.updatedAt) r.touch(Math.min(live.updatedAt, now));
    } else {
      // Not registered as live: a headless run still writing, or a session that just ended.
      if (now - t.lastRecordAt < 60_000) status = 'working';
      else status = 'done';
      const last = Math.max(t.lastRecordAt, t.lastSeenLive);
      if (status === 'done' && now - last > config.doneLingerMinutes * 60_000) return null;
      if (!r.app || r.app === 'Claude Code') r.app = 'Claude Code (headless)';
    }
    if (status !== 'waiting') r.waitingReason = undefined;
    if (!r.name) r.setName(r.lastPrompt ?? 'Claude session');
    return r.snapshot(now, status, { attention: attentionFor(r, status, now) });
  }

  private subagentSnapshot(t: Tracked, now: number): AgentSnapshot | null {
    const r = t.record;
    const parent = r.parentId ? this.sessions.get(r.parentId.slice(7)) : undefined;
    const finished = Boolean(t.subagentMeta?.finished);
    let status: AgentStatus;
    if (finished || !parent || (!parent.live && now - t.lastRecordAt > 60_000)) status = 'done';
    else if (this.pendingWaiting(t)) status = 'waiting';
    else if (now - t.lastRecordAt < 5 * 60_000) status = 'working';
    else status = 'done';
    if (status === 'done' && now - t.lastRecordAt > config.doneLingerMinutes * 60_000) return null;
    return r.snapshot(now, status, { attention: attentionFor(r, status, now) });
  }
}

export function attentionFor(r: AgentRecord, status: AgentStatus, now: number): Attention | undefined {
  if (status === 'waiting') return { level: 'alert', reason: r.waitingReason ?? 'Waiting for you' };
  if (status === 'working' && r.lastErrorAt && now - r.lastErrorAt < 90_000) return { level: 'warn', reason: 'Hit an error just now' };
  if (status === 'idle' && r.lastMessage && /\?\s*$/.test(r.lastMessage) && now - r.lastMessageAt < 6 * 3600_000)
    return { level: 'warn', reason: 'Asked you something' };
  if (status === 'idle' && r.kind === 'session') return { level: 'info', reason: 'Ready for your next message' };
  return undefined;
}
