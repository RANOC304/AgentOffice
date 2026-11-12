// Turns a tool call (from any provider) into an office activity.

import type { ActivityKind, AgentCounts } from '../shared/types.ts';
import {
  type Hints,
  hintsForCommand,
  hintsForMcp,
  hintsForPath,
  hintsForSkill,
  hintsForText,
  isBrowserOsNeo,
} from './classify.ts';
import { baseName, clean, describeCommand } from './util/text.ts';

export interface ToolActivity {
  kind: ActivityKind;
  label: string;
  detail?: string;
  hints?: Hints;
  counter?: keyof AgentCounts;
  browser?: boolean;
  file?: string;
  waiting?: string;
  /** Optional thought bubble for this action. */
  think?: string;
}

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

const UUID_SERVER = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const KNOWN_SERVERS: Record<string, string> = {
  '82ae82d1': 'Canva',
  '48ce0fd9': 'Figma',
  '0d3c177c': 'Cloudinary',
  '23985401': 'Supabase',
  '959cd67f': 'Vercel',
  '1a59c906': 'Docs',
  '0c782f7b': 'Drive',
  '7b7b0cfc': 'Calendar',
  c82b39cf: 'TinyPages',
  '2ee938ec': 'Jobs',
};

export function serverLabel(server: string): string {
  if (UUID_SERVER.test(server)) return KNOWN_SERVERS[server.slice(0, 8)] ?? 'Connector';
  return server.replace(/^Claude_/, '').replace(/[-_]+/g, ' ');
}

/** Splits "mcp__server__tool" into its parts. */
export function splitMcp(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? { server: m[1], tool: m[2] } : null;
}

export function mcpActivity(server: string, tool: string, input: Input = {}): ToolActivity {
  if (isBrowserOsNeo(server)) {
    const url = str(input.url) ?? str(input.targetUrl);
    const host = hostOf(url);
    let label = 'Driving BrowserOS neo';
    if (tool === 'run') label = 'Running a Neo browser script';
    else if (tool === 'navigate' || (tool === 'tabs' && host)) label = host ? `Browsing ${host} in Neo` : 'Navigating in Neo';
    else if (tool === 'screenshot') label = 'Taking a Neo screenshot';
    else if (tool === 'act') label = 'Clicking around in Neo';
    else if (tool === 'read' || tool === 'grep' || tool === 'snapshot') label = 'Reading a page in Neo';
    else if (tool === 'tabs') label = 'Managing Neo tabs';
    else if (tool === 'name_session') label = `Starting Neo task “${clean(str(input.name), 30)}”`;
    return { kind: 'browser', label, detail: `browseros-neo · ${tool}`, browser: true, counter: 'browser', hints: { research: 0.4 } };
  }
  const nice = serverLabel(server);
  const title = str(input.title);
  return {
    kind: 'mcp',
    label: title ? `${nice}: ${clean(title, 50)}` : `${nice}: ${tool.replace(/[-_]+/g, ' ')}`,
    detail: `${server} · ${tool}`,
    hints: { ...hintsForMcp(server), ...hintsForMcp(tool) },
  };
}

export function commandActivity(command: string, description?: string): ToolActivity {
  const label = description ? clean(description, 70) : `Running ${describeCommand(command)}`;
  // Only an actual call through the Neo bridge counts, not a command that merely mentions it.
  const browser = /browseros-neo-bridge[\\/]bridge\.mjs/i.test(command);
  return {
    kind: browser ? 'browser' : 'command',
    label: browser ? 'Driving BrowserOS neo from the shell' : label,
    detail: describeCommand(command),
    hints: { ...hintsForCommand(command), ...(description ? hintsForText(description, 0.6) : {}) },
    counter: browser ? 'browser' : 'commands',
    browser,
  };
}

export function fileActivity(verb: 'Editing' | 'Writing' | 'Reading', file: string): ToolActivity {
  const name = baseName(file);
  const hints = hintsForPath(file);
  if (verb === 'Reading') {
    for (const key of Object.keys(hints) as Array<keyof Hints>) hints[key] = (hints[key] ?? 0) * 0.5;
  }
  return {
    kind: verb === 'Reading' ? 'read' : 'edit',
    label: `${verb} ${name}`,
    detail: file,
    hints,
    counter: verb === 'Reading' ? 'reads' : 'edits',
    file: verb === 'Reading' ? undefined : file,
  };
}

/** Claude Code tool_use → activity. */
export function claudeToolActivity(name: string, input: Input = {}): ToolActivity {
  const mcp = splitMcp(name);
  if (mcp) {
    if (mcp.server === 'ccd_turn' && mcp.tool === 'update_plan') return planActivity(input);
    if (mcp.server === 'ccd_turn' && mcp.tool === 'wrap_up')
      return { kind: 'message', label: 'Wrapping up the task', think: clean(str(input.recap), 100) };
    if (mcp.server.startsWith('ccd_')) return { kind: 'tool', label: `Managing the desktop app (${mcp.tool.replace(/_/g, ' ')})` };
    return mcpActivity(mcp.server, mcp.tool, input);
  }
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return commandActivity(str(input.command) ?? '', str(input.description));
    case 'Read':
      return fileActivity('Reading', str(input.file_path) ?? '');
    case 'Edit':
    case 'MultiEdit':
      return fileActivity('Editing', str(input.file_path) ?? '');
    case 'Write':
      return fileActivity('Writing', str(input.file_path) ?? '');
    case 'NotebookEdit':
      return { ...fileActivity('Editing', str(input.notebook_path) ?? ''), hints: { data: 1.2 } };
    case 'Grep':
    case 'Glob':
      return {
        kind: 'search',
        label: `Searching the code for “${clean(str(input.pattern), 40)}”`,
        counter: 'searches',
        hints: str(input.path) ? hintsForPath(str(input.path)!) : undefined,
      };
    case 'WebSearch':
      return {
        kind: 'web',
        label: `Searching the web: ${clean(str(input.query), 60)}`,
        counter: 'searches',
        hints: { research: 1, ...hintsForText(str(input.query) ?? '', 0.5) },
        think: `Let me look up “${clean(str(input.query), 60)}”`,
      };
    case 'WebFetch':
      return { kind: 'web', label: `Reading ${hostOf(str(input.url)) ?? 'a web page'}`, counter: 'searches', hints: { research: 1 } };
    case 'Agent':
    case 'Task':
      return {
        kind: 'subagent',
        label: `Delegating: ${clean(str(input.description) ?? str(input.subagent_type), 60)}`,
        detail: str(input.subagent_type),
        counter: 'subagents',
        hints: hintsForText(`${str(input.description) ?? ''} ${str(input.prompt)?.slice(0, 400) ?? ''}`, 0.6),
      };
    case 'Skill':
      return { kind: 'tool', label: `Using the ${clean(str(input.skill), 40)} skill`, hints: hintsForSkill(str(input.skill) ?? '') };
    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? (input.questions as Input[]) : [];
      const q = str(questions[0]?.question);
      return { kind: 'tool', label: 'Asking you a question', waiting: q ? `Asks: ${clean(q, 90)}` : 'Asked you a question' };
    }
    case 'ExitPlanMode':
      return { kind: 'tool', label: 'Presenting a plan', waiting: 'Plan ready for your approval' };
    case 'TodoWrite':
      return planActivity({ items: input.todos });
    case 'Artifact':
      return { kind: 'tool', label: 'Publishing an artifact', hints: { writing: 0.6, design: 0.6, web: 0.4 } };
    case 'SendUserFile':
      return { kind: 'tool', label: 'Sending you a file' };
    case 'ToolSearch':
      return { kind: 'tool', label: 'Looking for the right tool' };
    default:
      return { kind: 'tool', label: `Using ${name}` };
  }
}

function planActivity(input: Input): ToolActivity {
  const items = Array.isArray(input.items) ? (input.items as Input[]) : [];
  const current = items.find((i) => i.status === 'in_progress');
  const text = str(current?.content) ?? str(current?.activeForm);
  return {
    kind: 'tool',
    label: text ? `Plan: ${clean(text, 60)}` : 'Updating the plan',
    hints: text ? hintsForText(text, 0.8) : undefined,
    think: text ? `Next up: ${clean(text, 70)}` : undefined,
  };
}
