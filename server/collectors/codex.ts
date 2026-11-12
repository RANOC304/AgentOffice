// Reads Codex threads from ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Every Codex thread (ChatGPT desktop app, CLI, IDE, ACP) is shown as Codex; the app is in the label.

import fs from 'node:fs';
import path from 'node:path';
import type { AgentSnapshot, AgentStatus, Provider, SourceStatus } from '../../shared/types.ts';
import { AgentRecord } from '../agent.ts';
import { hintsForText, isBrowserOsNeo } from '../classify.ts';
import { config } from '../config.ts';
import { commandActivity, fileActivity, mcpActivity, type ToolActivity } from '../tools.ts';
import { JsonlTail } from '../util/tail.ts';
import { attentionFor } from './claude.ts';
import { clean, firstSentence } from '../util/text.ts';

type Rec = Record<string, any>;

interface Thread {
  record: AgentRecord;
  tail: JsonlTail;
  turnOpen: boolean;
  lastRecordAt: number;
  pendingInput: Set<string>;
  pendingCalls: Map<string, { at: number; act: ToolActivity }>;
  parentThreadId?: string;
  originator?: string;
}

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function providerForOriginator(originator: string | undefined): { provider: Provider; app: string } {
  switch (originator) {
    case 'Codex Desktop':
      return { provider: 'codex', app: 'Codex · ChatGPT app' };
    case 'codex_work_desktop':
      return { provider: 'codex', app: 'Codex · ChatGPT app (work)' };
    case 'acpx':
      return { provider: 'codex', app: 'Codex via ACP' };
    case 'codex_exec':
      return { provider: 'codex', app: 'Codex exec' };
    case 'codex_vscode':
      return { provider: 'codex', app: 'Codex IDE' };
    case 'codex_cli_rs':
      return { provider: 'codex', app: 'Codex CLI' };
    default:
      return { provider: 'codex', app: originator ? `Codex (${originator})` : 'Codex' };
  }
}

function ts(value: unknown): number {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Strips the ChatGPT app's attachment preamble so only the user's request remains. */
function userRequest(text: string): string {
  const marker = text.lastIndexOf('## My request:');
  if (marker >= 0) return text.slice(marker + '## My request:'.length).trim();
  return text;
}

/** Nested tool calls made from Codex code-mode "exec" scripts. */
function execActivity(input: string): ToolActivity | null {
  if (isBrowserOsNeo(input)) {
    const tool = input.match(/browseros[_-]?neo__(\w+)/i)?.[1] ?? 'run';
    return mcpActivity('browseros-neo', tool);
  }
  const cmd = input.match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? input.match(/cmd\s*:\s*'((?:[^'\\]|\\.)*)'/)?.[1];
  if (cmd) {
    let unescaped = cmd;
    try {
      unescaped = JSON.parse(`"${cmd}"`);
    } catch {
      // keep raw
    }
    return commandActivity(unescaped);
  }
  const nested = input.match(/tools\.(\w+)\(/);
  if (nested) {
    const name = nested[1];
    const mcp = name.match(/^mcp__(.+?)__(.+)$/);
    if (mcp) return mcpActivity(mcp[1], mcp[2]);
    if (/apply_patch/.test(name)) return { kind: 'edit', label: 'Patching files', counter: 'edits' };
    if (/view_image/.test(name)) return { kind: 'read', label: 'Looking at an image', hints: { design: 0.6 } };
    return { kind: 'tool', label: `Using ${name.replace(/_/g, ' ')}` };
  }
  return null;
}

export class CodexCollector {
  private readonly sessionsDir = path.join(config.codexHome, 'sessions');
  private readonly indexFile = path.join(config.codexHome, 'session_index.jsonl');
  private threads = new Map<string, Thread>();
  private names = new Map<string, string>();
  private indexTail = new JsonlTail(this.indexFile, 8 * 1024 * 1024);
  private lastScan = 0;
  private candidates = new Map<string, string>();
  status: SourceStatus = { id: 'codex', label: 'Codex', ok: false, path: this.sessionsDir };

  poll(now: number): AgentSnapshot[] {
    if (!fs.existsSync(this.sessionsDir)) {
      this.status = { id: 'codex', label: 'Codex', ok: false, path: this.sessionsDir, message: 'Codex sessions folder not found' };
      return [];
    }
    for (const raw of this.indexTail.read() ?? []) {
      const rec = raw as Rec;
      if (rec.id && rec.thread_name) {
        this.names.set(rec.id, rec.thread_name);
        this.threads.get(rec.id)?.record.setName(rec.thread_name);
      }
    }
    if (now - this.lastScan > 4000) {
      this.lastScan = now;
      this.scan(now);
    }
    for (const [id, file] of this.candidates) if (!this.threads.has(id)) this.track(id, file);

    const out: AgentSnapshot[] = [];
    for (const [id, thread] of this.threads) {
      for (const raw of thread.tail.read() ?? []) this.apply(thread, raw as Rec);
      const snap = this.snapshot(thread, now);
      if (snap) out.push(snap);
      else if (!this.candidates.has(id)) this.threads.delete(id);
    }
    this.status = { id: 'codex', label: 'Codex', ok: true, path: this.sessionsDir, message: `${out.length} recent thread(s)` };
    return out;
  }

  /** Finds rollouts modified within the recent window (only today's and yesterday's folders). */
  private scan(now: number) {
    this.candidates.clear();
    const windowMs = config.recentMinutes * 60_000;
    const days = new Set<string>();
    for (let offset = 0; offset <= windowMs + 86_400_000; offset += 86_400_000) {
      const d = new Date(now - offset);
      days.add(path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
      const u = new Date(now - offset);
      days.add(path.join(String(u.getUTCFullYear()), String(u.getUTCMonth() + 1).padStart(2, '0'), String(u.getUTCDate()).padStart(2, '0')));
    }
    for (const day of days) {
      const dir = path.join(this.sessionsDir, day);
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const id = name.match(UUID_RE)?.[1];
        if (!id) continue;
        const file = path.join(dir, name);
        try {
          if (now - fs.statSync(file).mtimeMs < windowMs) this.candidates.set(id, file);
        } catch {
          // ignore
        }
      }
    }
  }

  private track(id: string, file: string) {
    const record = new AgentRecord(`codex:${id}`, 'codex', 'session');
    const thread: Thread = {
      record,
      tail: new JsonlTail(file, config.maxInitialBytes),
      turnOpen: false,
      lastRecordAt: 0,
      pendingInput: new Set(),
      pendingCalls: new Map(),
    };
    const name = this.names.get(id);
    if (name) record.setName(name);
    this.threads.set(id, thread);
  }

  private apply(t: Thread, rec: Rec) {
    const r = t.record;
    const at = ts(rec.timestamp);
    if (at) t.lastRecordAt = Math.max(t.lastRecordAt, at);
    const p = rec.payload ?? {};
    switch (rec.type) {
      case 'session_meta': {
        t.originator = p.originator;
        const { provider, app } = providerForOriginator(p.originator);
        r.provider = provider;
        r.app = app;
        r.setProject(p.cwd);
        if (p.timestamp) r.startedAt = ts(p.timestamp);
        const spawn = p.source?.subagent?.thread_spawn;
        if (spawn) {
          r.kind = 'subagent';
          t.parentThreadId = spawn.parent_thread_id;
          r.parentId = `codex:${spawn.parent_thread_id}`;
          r.role = spawn.agent_role ?? spawn.agent_path?.replace(/^\/root\//, '').replace(/_/g, ' ');
          r.setName(spawn.agent_nickname ?? r.role ?? 'Subagent');
        } else if (p.source?.subagent) {
          r.kind = 'subagent';
          r.role = typeof p.source.subagent.other === 'string' ? p.source.subagent.other : 'helper';
          if (p.parent_thread_id) r.parentId = `codex:${p.parent_thread_id}`;
          r.setName(`${r.role} reviewer`);
        }
        if (p.git?.branch) r.branch = p.git.branch;
        return;
      }
      case 'turn_context':
        if (p.model) r.model = p.model;
        if (p.cwd) r.setProject(p.cwd);
        return;
      case 'event_msg':
        this.applyEvent(t, p, at);
        return;
      case 'response_item':
        this.applyResponse(t, p, at);
        return;
      default:
        return;
    }
  }

  private applyEvent(t: Thread, p: Rec, at: number) {
    const r = t.record;
    switch (p.type) {
      case 'task_started':
        t.turnOpen = true;
        if (at) r.touch(at);
        return;
      case 'task_complete':
        t.turnOpen = false;
        t.pendingInput.clear();
        t.pendingCalls.clear();
        if (p.last_agent_message && at) {
          r.message(at, p.last_agent_message);
          r.say(at, /\?\s*$/.test(p.last_agent_message.trim()) ? 'ask' : 'say', firstSentence(p.last_agent_message));
          r.event(at, 'message', 'Finished the turn');
        }
        return;
      case 'turn_aborted':
        t.turnOpen = false;
        t.pendingInput.clear();
        t.pendingCalls.clear();
        if (at) r.event(at, 'error', 'Turn interrupted');
        return;
      case 'token_count': {
        const u = p.info?.total_token_usage;
        if (u) {
          r.tokens = {
            input: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
            cached: u.cached_input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            total: u.total_tokens ?? 0,
          };
        }
        return;
      }
      case 'error':
      case 'stream_error':
        if (at) {
          r.counts.errors += 1;
          r.lastErrorAt = at;
          r.event(at, 'error', clean(p.message ?? 'Error', 80));
        }
        return;
      case 'item_completed':
        if (p.item) this.applyItem(t, p.item, at);
        return;
      default:
        return;
    }
  }

  private applyItem(t: Thread, item: Rec, at: number) {
    const r = t.record;
    if (!at) return;
    const act = (a: ToolActivity, toolName: string) => {
      r.tool(toolName);
      if (a.counter) r.counts[a.counter] += 1;
      if (a.browser) r.lastBrowserAt = at;
      if (a.file) r.file(a.file);
      r.event(at, a.kind, a.label, a.detail, a.hints);
      r.say(at, 'action', a.label);
    };
    switch (item.type) {
      case 'UserMessage': {
        const text = (item.content ?? []).map((c: Rec) => c.text ?? '').join('\n');
        const request = userRequest(text);
        r.prompt(at, request);
        if (!r.name) r.setName(this.names.get(r.id.slice(6)) ?? request);
        return;
      }
      case 'AgentMessage': {
        const text = (item.content ?? []).map((c: Rec) => c.text ?? '').join('\n');
        if (item.phase === 'commentary') r.say(at, 'say', firstSentence(text));
        else r.message(at, text);
        r.touch(at);
        return;
      }
      case 'Reasoning': {
        const summary = (item.summary_text ?? []).join(' ');
        if (summary) r.say(at, 'think', firstSentence(summary, 90));
        r.touch(at);
        return;
      }
      case 'CommandExecution': {
        const command = Array.isArray(item.command) ? String(item.command[item.command.length - 1]) : String(item.command ?? '');
        const a = commandActivity(command);
        if (item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0)) {
          r.counts.errors += 1;
          r.lastErrorAt = at;
        }
        act(a, 'shell');
        return;
      }
      case 'McpToolCall': {
        const a = mcpActivity(String(item.server ?? 'mcp'), String(item.tool ?? 'tool'), item.arguments ?? {});
        if (item.result?.isError || item.status === 'failed') {
          r.counts.errors += 1;
          r.lastErrorAt = at;
        }
        act(a, `${item.server}/${item.tool}`);
        return;
      }
      case 'FileChange': {
        const files = Object.keys(item.changes ?? {});
        for (const f of files) {
          const a = fileActivity('Editing', f);
          r.counts.edits += 1;
          r.file(f);
          r.domain.add(at, a.hints ?? {});
        }
        if (files.length) {
          r.tool('apply_patch');
          r.event(at, 'edit', files.length === 1 ? fileActivity('Editing', files[0]).label : `Editing ${files.length} files`);
        }
        return;
      }
      case 'Extension':
        if (item.kind === 'web.search') {
          const q = item.query ?? item.action?.query ?? '';
          act({ kind: 'web', label: `Searching the web: ${clean(q, 60)}`, counter: 'searches', hints: { research: 1, ...hintsForText(q, 0.5) } }, 'web_search');
          r.say(at, 'think', `Let me look up “${clean(q, 60)}”`);
        } else {
          act({ kind: 'tool', label: `Using ${String(item.kind ?? 'an extension')}` }, String(item.kind ?? 'extension'));
        }
        return;
      case 'ImageView':
        act({ kind: 'read', label: 'Looking at an image', hints: { design: 0.6 } }, 'view_image');
        return;
      case 'ImageGeneration':
        act({ kind: 'tool', label: 'Generating an image', hints: { design: 1.5 } }, 'image_generation');
        return;
      case 'SubAgentActivity':
        if (item.kind === 'started') {
          r.counts.subagents += 1;
          r.event(at, 'subagent', `Started helper ${String(item.agent_path ?? '').replace(/^\/root\//, '')}`);
        }
        return;
      case 'CollabAgentToolCall':
        r.event(at, 'subagent', 'Coordinating helpers');
        return;
      case 'ContextCompaction':
        r.event(at, 'thinking', 'Compacting the conversation');
        return;
      default:
        return;
    }
  }

  private applyResponse(t: Thread, p: Rec, at: number) {
    const r = t.record;
    if (p.type === 'function_call') {
      if (/request_user_input/.test(p.name)) {
        t.pendingInput.add(p.call_id);
        r.waitingReason = 'Asked you a question';
        if (at) r.event(at, 'tool', 'Asking you a question');
      } else if (p.name === 'spawn_agent' && at) {
        r.event(at, 'subagent', 'Spawning a helper agent');
      }
    } else if (p.type === 'function_call_output') {
      t.pendingInput.delete(p.call_id);
    } else if (p.type === 'custom_tool_call' && typeof p.input === 'string' && at) {
      const a = execActivity(p.input);
      if (a) {
        t.pendingCalls.set(p.call_id, { at, act: a });
        if (a.browser) r.lastBrowserAt = at;
        r.activity = a.label;
        r.activityAt = at;
        r.touch(at);
      }
    } else if (p.type === 'custom_tool_call_output') {
      t.pendingCalls.delete(p.call_id);
    }
  }

  private snapshot(t: Thread, now: number): AgentSnapshot | null {
    const r = t.record;
    const last = Math.max(t.lastRecordAt, r.lastActivityAt);
    const sinceLast = now - last;
    let status: AgentStatus;
    if (t.turnOpen && t.pendingInput.size) status = 'waiting';
    else if (t.turnOpen && sinceLast < config.stallMinutes * 60_000) status = 'working';
    else status = 'idle';

    if (r.kind === 'subagent') {
      if (status === 'idle') status = 'done';
      if (status === 'done' && sinceLast > config.doneLingerMinutes * 60_000) return null;
      const parent = t.parentThreadId ? this.threads.get(t.parentThreadId) : undefined;
      if (!parent && status === 'done') return null;
    } else if (status === 'idle' && sinceLast > config.recentMinutes * 60_000) {
      return null;
    }
    if (status !== 'waiting') r.waitingReason = undefined;
    // In-flight exec call keeps the BrowserOS neo flag fresh during long browser scripts.
    for (const call of t.pendingCalls.values()) if (call.act.browser && status === 'working') r.lastBrowserAt = now;
    if (!r.name) r.setName(r.lastPrompt ?? 'Codex thread');
    return r.snapshot(now, status, { attention: attentionFor(r, status, now) });
  }
}
