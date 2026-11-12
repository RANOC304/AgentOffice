// Data contract between the local collector server and the web office.

import type { RoomId } from './rooms.ts';

/** Which family of tool produced the session. */
export type Provider = 'claude-code' | 'codex' | 'claude-chat' | 'chatgpt';

export type AgentKind = 'session' | 'subagent';

/**
 * working  – actively producing output or running tools
 * waiting  – blocked on the user (question, approval)
 * idle     – turn finished, nothing pending
 * done     – the session or subagent has ended; it walks out of the office
 */
export type AgentStatus = 'working' | 'waiting' | 'idle' | 'done';

export type ActivityKind =
  | 'prompt'
  | 'message'
  | 'thinking'
  | 'edit'
  | 'read'
  | 'command'
  | 'search'
  | 'web'
  | 'browser'
  | 'mcp'
  | 'subagent'
  | 'error'
  | 'tool';

export interface ActivityEvent {
  at: number;
  kind: ActivityKind;
  /** Short label such as "Edited App.tsx" or "Ran npm test". */
  label: string;
  /** Tool name, server or file the event refers to. */
  detail?: string;
}

/** A line a character may say or think in a speech bubble. */
export interface SpeechLine {
  at: number;
  kind: 'say' | 'think' | 'action' | 'ask';
  text: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  total: number;
}

export interface AgentCounts {
  turns: number;
  tools: number;
  edits: number;
  commands: number;
  reads: number;
  searches: number;
  browser: number;
  subagents: number;
  errors: number;
}

export interface Attention {
  level: 'info' | 'warn' | 'alert';
  reason: string;
}

export interface AgentSnapshot {
  id: string;
  /** The character's first name, assigned from the editable names list. */
  persona: string;
  provider: Provider;
  kind: AgentKind;
  parentId?: string;
  /** Display name: session title, subagent nickname or type. */
  name: string;
  /** Subagent role or description. */
  role?: string;
  /** Application the session runs in, e.g. "Claude desktop" or "ChatGPT app". */
  app: string;
  model?: string;
  projectPath?: string;
  projectName?: string;
  branch?: string;
  status: AgentStatus;
  /** What the agent is doing right now, e.g. "Editing server.ts". */
  activity: string;
  room: RoomId;
  /** Domain the work belongs to, even while the agent sits in the lounge or browser room. */
  domain: RoomId;
  usingBrowser: boolean;
  /** Last BrowserOS neo action (ms), used to link Neo sessions to agents. */
  browserAt?: number;
  /** Page this agent currently has open in BrowserOS neo. */
  neo?: NeoPage;
  startedAt: number;
  lastActivityAt: number;
  tokens: TokenUsage;
  counts: AgentCounts;
  topTools: Array<{ name: string; count: number }>;
  filesTouched: string[];
  lastPrompt?: string;
  lastMessage?: string;
  lines: SpeechLine[];
  recent: ActivityEvent[];
  attention?: Attention;
  /** Activity timestamps (ms) in the analytics window, for timelines. */
  pulses: number[];
}

/** A page an agent is using in BrowserOS neo, for the Neo hub's giant screen. */
export interface NeoPage {
  sessionId: string;
  agentId?: string;
  persona?: string;
  client: string;
  task?: string;
  url?: string;
  title?: string;
  at: number;
  /** Server path of the latest screenshot, if Neo saved one. */
  shot?: string;
  actions: number;
}

export interface ProjectSummary {
  path: string;
  name: string;
  agents: string[];
  providers: Provider[];
  working: number;
  waiting: number;
  lastActivityAt: number;
  git?: {
    branch?: string;
    dirty: number;
    ahead: number;
    behind: number;
  };
  attention: Attention[];
}

export interface SourceStatus {
  id: string;
  label: string;
  ok: boolean;
  path: string;
  message?: string;
}

export interface OfficeSnapshot {
  version: 1;
  generatedAt: number;
  host: string;
  agents: AgentSnapshot[];
  projects: ProjectSummary[];
  sources: SourceStatus[];
  /** Pages currently open by agents in BrowserOS neo (newest first). */
  neoPages: NeoPage[];
  /** Analytics window in ms (timeline length). */
  windowMs: number;
}
