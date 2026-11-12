import type {
  ActivityEvent,
  ActivityKind,
  AgentCounts,
  AgentKind,
  AgentSnapshot,
  AgentStatus,
  Attention,
  Provider,
  SpeechLine,
  TokenUsage,
} from '../shared/types.ts';
import type { RoomId } from '../shared/rooms.ts';
import { DomainTracker, type Hints, hintsForText } from './classify.ts';
import { config } from './config.ts';
import { clean, normalizePath, projectNameFromPath } from './util/text.ts';

const MAX_RECENT = 30;
const MAX_LINES = 14;
const MAX_FILES = 14;

/** Mutable per-agent state shared by the Claude and Codex collectors. */
export class AgentRecord {
  readonly id: string;
  provider: Provider;
  kind: AgentKind;
  parentId?: string;
  name = '';
  role?: string;
  app = '';
  model?: string;
  projectPath?: string;
  branch?: string;
  startedAt = 0;
  lastActivityAt = 0;
  tokens: TokenUsage = { input: 0, output: 0, cached: 0, total: 0 };
  counts: AgentCounts = { turns: 0, tools: 0, edits: 0, commands: 0, reads: 0, searches: 0, browser: 0, subagents: 0, errors: 0 };
  toolCounts = new Map<string, number>();
  files: string[] = [];
  lastPrompt?: string;
  lastMessage?: string;
  lastMessageAt = 0;
  lines: SpeechLine[] = [];
  recent: ActivityEvent[] = [];
  pulses: number[] = [];
  readonly domain = new DomainTracker();
  lastBrowserAt = 0;
  lastErrorAt = 0;
  /** Current activity label set by the most recent tool call. */
  activity = '';
  activityAt = 0;
  /** Set when the agent is blocked on the user. */
  waitingReason?: string;

  constructor(id: string, provider: Provider, kind: AgentKind) {
    this.id = id;
    this.provider = provider;
    this.kind = kind;
  }

  setProject(p: string | undefined) {
    const normalized = normalizePath(p);
    if (!normalized) return;
    if (normalized !== this.projectPath) {
      this.projectPath = normalized;
      this.updatePrior();
    }
  }

  setName(name: string | undefined) {
    const value = clean(name, 70);
    if (value && value !== this.name) {
      this.name = value;
      this.updatePrior();
    }
  }

  private updatePrior() {
    const prior: Hints = {};
    const merge = (h: Hints, w: number) => {
      for (const [k, v] of Object.entries(h)) prior[k as keyof Hints] = (prior[k as keyof Hints] ?? 0) + (v as number) * w;
    };
    if (this.projectPath) merge(hintsForText(this.projectPath.replace(/[\\/_-]+/g, ' ')), 0.8);
    if (this.name) merge(hintsForText(this.name), 1);
    if (this.lastPrompt) merge(hintsForText(this.lastPrompt), 0.7);
    if (this.role) merge(hintsForText(this.role), 0.8);
    this.domain.setPrior(prior);
  }

  touch(at: number) {
    if (at > this.lastActivityAt) this.lastActivityAt = at;
    if (!this.startedAt || (at && at < this.startedAt)) this.startedAt = at;
  }

  event(at: number, kind: ActivityKind, label: string, detail?: string, hints?: Hints) {
    if (!at) return;
    this.touch(at);
    this.recent.push({ at, kind, label: clean(label, 90), detail: detail ? clean(detail, 120) : undefined });
    if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);
    this.pulses.push(at);
    if (hints) this.domain.add(at, hints);
    if (kind !== 'prompt' && kind !== 'message' && kind !== 'thinking') {
      this.activity = clean(label, 80);
      this.activityAt = at;
    }
  }

  say(at: number, kind: SpeechLine['kind'], text: string | undefined) {
    const value = clean(text, 120);
    if (!value || value.length < 3) return;
    if (this.lines.some((l) => l.text === value)) return;
    this.lines.push({ at, kind, text: value });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  prompt(at: number, text: string) {
    const value = clean(text, 220);
    if (!value) return;
    this.lastPrompt = value;
    this.counts.turns += 1;
    this.event(at, 'prompt', `New task: ${clean(text, 70)}`, undefined, hintsForText(text, 1.2));
    this.updatePrior();
  }

  message(at: number, text: string) {
    const value = clean(text, 280);
    if (!value) return;
    this.lastMessage = value;
    this.lastMessageAt = at;
  }

  tool(name: string) {
    this.counts.tools += 1;
    this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + 1);
  }

  file(p: string | undefined) {
    const normalized = normalizePath(p);
    if (!normalized) return;
    this.files = [normalized, ...this.files.filter((f) => f !== normalized)].slice(0, MAX_FILES);
  }

  prune(now: number) {
    const cutoff = now - config.windowMs;
    if (this.pulses.length && this.pulses[0] < cutoff) this.pulses = this.pulses.filter((t) => t >= cutoff);
    if (this.pulses.length > 4000) this.pulses = this.pulses.slice(-4000);
  }

  usingBrowser(now: number): boolean {
    return this.lastBrowserAt > 0 && now - this.lastBrowserAt < config.browserWindowMs;
  }

  snapshot(now: number, status: AgentStatus, extra: { attention?: Attention; activity?: string } = {}): AgentSnapshot {
    this.prune(now);
    const domain = this.domain.resolve(now) as RoomId;
    const usingBrowser = this.usingBrowser(now) && status === 'working';
    let room: RoomId = domain;
    if (usingBrowser) room = 'browser';
    else if (status === 'idle') room = 'cafe';

    let activity = extra.activity ?? this.activity;
    if (status === 'waiting') activity = this.waitingReason ?? 'Waiting for you';
    else if (status === 'idle') activity = 'Idle, waiting for a new task';
    else if (status === 'done') activity = this.kind === 'subagent' ? 'Finished and reported back' : 'Session ended';
    else if (!activity || now - this.activityAt > 180_000) activity = 'Thinking…';

    return {
      id: this.id,
      persona: '',
      provider: this.provider,
      kind: this.kind,
      parentId: this.parentId,
      name: this.name || (this.kind === 'subagent' ? 'Subagent' : 'Untitled session'),
      role: this.role,
      app: this.app,
      model: this.model,
      projectPath: this.projectPath,
      projectName: projectNameFromPath(this.projectPath),
      branch: this.branch,
      status,
      activity,
      room,
      domain,
      usingBrowser,
      browserAt: this.lastBrowserAt || undefined,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      tokens: { ...this.tokens },
      counts: { ...this.counts },
      topTools: [...this.toolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count })),
      filesTouched: [...this.files],
      lastPrompt: this.lastPrompt,
      lastMessage: this.lastMessage,
      lines: [...this.lines],
      recent: [...this.recent].reverse(),
      attention: extra.attention,
      pulses: [...this.pulses],
    };
  }
}
