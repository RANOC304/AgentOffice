// Combines every collector into one office snapshot: agents, character names, Neo pages, projects.

import os from 'node:os';
import type { AgentSnapshot, Attention, FiredAgent, NeoPage, OfficeSnapshot, ProjectSummary, Provider } from '../shared/types.ts';
import { ClaudeCollector } from './collectors/claude.ts';
import { CodexCollector } from './collectors/codex.ts';
import { describeNeoEvent, NeoCollector, type NeoSession } from './collectors/neo.ts';
import { config } from './config.ts';
import { gitInfo } from './git.ts';
import { Names } from './names.ts';
import { OfficeState } from './state.ts';

const SKIP_GIT = (p: string) => /^[A-Z]:\\?$/i.test(p) || p.toLowerCase() === os.homedir().toLowerCase();

/** Which kind of app a BrowserOS neo client belongs to. */
function familyOf(client: string): Provider | null {
  if (/claude[-_ ]?code/i.test(client)) return 'claude-code';
  if (/codex|openai|chatgpt/i.test(client)) return 'codex';
  if (/claude/i.test(client)) return 'claude-chat';
  return null;
}

export class Office {
  private claude = new ClaudeCollector();
  private codex = new CodexCollector();
  readonly neo = new NeoCollector();
  readonly names = new Names();
  readonly state = new OfficeState();

  snapshot(now = Date.now()): OfficeSnapshot {
    const agents: AgentSnapshot[] = [];
    for (const collector of [this.claude, this.codex]) {
      try {
        agents.push(...collector.poll(now));
      } catch (error) {
        console.error('[office] collector failed:', error);
      }
    }

    // BrowserOS neo: attach pages to the agents that opened them, and give chats
    // (ChatGPT / Claude apps, which keep no local history) their own characters.
    const pageOwner = new Map<string, string>();
    for (const s of this.neo.poll(now)) {
      const family = familyOf(s.client);
      if (!family) continue;
      let owner: AgentSnapshot | undefined;
      if (family === 'claude-code' || family === 'codex') owner = matchAgent(agents, family, s);
      if (owner) {
        owner.neo = page(s, this.neo);
        pageOwner.set(s.sessionId, owner.id);
        if (now - s.last < config.browserWindowMs && owner.status === 'working') {
          owner.usingBrowser = true;
          owner.room = 'browser';
          owner.activity = describeNeoEvent(s.events.at(-1) ?? { at: s.last, tool: 'browse', url: s.url, title: s.title });
        }
        continue;
      }
      if (family === 'claude-code') continue;
      const chat = this.neo.chatAgent(s, family === 'codex' ? 'chatgpt' : 'claude-chat', now);
      if (chat) {
        chat.neo = page(s, this.neo);
        pageOwner.set(s.sessionId, chat.id);
        agents.push(chat);
      }
    }

    // Workers fired by the user leave the office until their session is given a new task.
    for (const agent of agents) {
      const f = this.state.fired.get(agent.id);
      if (f && (agent.lastPromptAt ?? 0) > f.at) this.state.rehire(agent.id, now);
    }
    const visible = agents.filter((agent) => {
      if (this.state.fired.has(agent.id)) return false;
      const parent = agent.parentId ? this.state.fired.get(agent.parentId) : undefined;
      return !(parent && agent.startedAt <= parent.at + 1000);
    });
    agents.length = 0;
    agents.push(...visible);
    const fired: FiredAgent[] = [...this.state.fired.entries()]
      .map(([id, f]) => ({ id, persona: f.persona ?? 'Agent', name: f.name ?? id, provider: (f.provider as Provider) ?? 'claude-code', firedAt: f.at }))
      .sort((a, b) => b.firedAt - a.firedAt);

    // Subagents whose parent is not in the office keep their own desk but lose the link.
    const ids = new Set(agents.map((a) => a.id));
    for (const agent of agents) if (agent.parentId && !ids.has(agent.parentId)) agent.parentId = undefined;

    // Character names.
    const personas = this.names.assign(
      agents.map((a) => a.id),
      now,
    );
    for (const agent of agents) agent.persona = personas.get(agent.id) ?? 'Alex';

    const neoPages: NeoPage[] = [...this.neo.sessions.values()]
      .filter((s) => s.url && now - s.last < 30 * 60_000 && familyOf(s.client))
      .sort((a, b) => b.last - a.last)
      .slice(0, 8)
      .map((s) => {
        const p = page(s, this.neo);
        p.agentId = pageOwner.get(s.sessionId);
        p.persona = p.agentId ? personas.get(p.agentId) : undefined;
        return p;
      });
    for (const agent of agents) if (agent.neo) agent.neo.persona = agent.persona;

    agents.sort((a, b) => {
      const rank = (s: AgentSnapshot) => ({ waiting: 0, working: 1, idle: 2, done: 3 })[s.status];
      return rank(a) - rank(b) || b.lastActivityAt - a.lastActivityAt;
    });

    return {
      version: 1,
      generatedAt: now,
      host: os.hostname(),
      agents,
      projects: this.projects(agents),
      sources: [this.claude.status, this.codex.status, this.neo.status],
      neoPages,
      fired,
      removedProjects: [...this.state.removedProjects.values()].map((r) => ({ path: r.path, name: r.path.split(/[\\/]/).pop() ?? r.path, removedAt: r.at })),
      windowMs: config.windowMs,
    };
  }

  private projects(agents: AgentSnapshot[]): ProjectSummary[] {
    const byPath = new Map<string, ProjectSummary>();
    for (const agent of agents) {
      if (!agent.projectPath) continue;
      const key = agent.projectPath.toLowerCase();
      let project = byPath.get(key);
      if (!project) {
        project = {
          path: agent.projectPath,
          name: agent.projectName ?? agent.projectPath,
          agents: [],
          providers: [],
          working: 0,
          waiting: 0,
          lastActivityAt: 0,
          attention: [],
        };
        byPath.set(key, project);
      }
      project.agents.push(agent.id);
      if (!project.providers.includes(agent.provider)) project.providers.push(agent.provider);
      if (agent.status === 'working') project.working += 1;
      if (agent.status === 'waiting') project.waiting += 1;
      project.lastActivityAt = Math.max(project.lastActivityAt, agent.lastActivityAt);
      if (agent.attention && agent.attention.level !== 'info')
        project.attention.push({ level: agent.attention.level, reason: `${agent.persona} (${agent.name}): ${agent.attention.reason}` });
    }
    // Projects removed by the user stay hidden until a worker starts new work there.
    for (const [key, project] of byPath) {
      const removedAt = this.state.removedProjects.get(key)?.at;
      if (removedAt === undefined) continue;
      const fresh = agents.some(
        (a) => a.projectPath?.toLowerCase() === key && (a.startedAt > removedAt || (a.lastPromptAt ?? 0) > removedAt),
      );
      if (fresh) this.state.restoreProject(project.path, Date.now());
      else byPath.delete(key);
    }
    for (const project of byPath.values()) {
      if (SKIP_GIT(project.path)) continue;
      const git = gitInfo(project.path);
      if (git) {
        project.git = git;
        const attention: Attention[] = [];
        if (git.dirty > 0 && project.working === 0)
          attention.push({ level: 'info', reason: `${git.dirty} uncommitted change${git.dirty > 1 ? 's' : ''}` });
        if (git.ahead > 0) attention.push({ level: 'info', reason: `${git.ahead} commit${git.ahead > 1 ? 's' : ''} not pushed` });
        if (git.behind > 0) attention.push({ level: 'warn', reason: `${git.behind} commit${git.behind > 1 ? 's' : ''} behind remote` });
        project.attention.push(...attention);
      }
    }
    const weight = (p: ProjectSummary) =>
      p.waiting * 100 + p.attention.filter((a) => a.level === 'alert').length * 50 + p.attention.filter((a) => a.level === 'warn').length * 10 + p.working;
    return [...byPath.values()].sort((a, b) => weight(b) - weight(a) || b.lastActivityAt - a.lastActivityAt);
  }
}

export type OfficeAction =
  | { type: 'rename'; id: string; name: string }
  | { type: 'fire'; id: string }
  | { type: 'rehire'; id: string }
  | { type: 'removeProject'; path: string }
  | { type: 'restoreProject'; path: string };

/** Applies a dashboard action. Only app state changes; real sessions and folders are never touched. */
export function applyAction(office: Office, action: OfficeAction, latest: OfficeSnapshot, now: number): string | null {
  const agent = 'id' in action ? latest.agents.find((a) => a.id === action.id) : undefined;
  switch (action.type) {
    case 'rename':
      if (!agent) return 'That worker is no longer in the office.';
      return office.names.rename(action.id, action.name, now);
    case 'fire':
      if (!agent) return 'That worker is no longer in the office.';
      office.state.fire(agent.id, { persona: agent.persona, name: agent.name, provider: agent.provider }, now);
      return null;
    case 'rehire':
      office.state.rehire(action.id, now);
      return null;
    case 'removeProject':
      if (!latest.projects.some((p) => p.path.toLowerCase() === action.path.toLowerCase())) return 'Unknown project.';
      office.state.removeProject(action.path, now);
      return null;
    case 'restoreProject':
      office.state.restoreProject(action.path, now);
      return null;
    default:
      return 'Unknown action.';
  }
}

function page(s: NeoSession, neo: NeoCollector): NeoPage {
  return {
    sessionId: s.sessionId,
    client: s.client,
    task: s.task ?? s.taskTitle,
    url: s.url,
    title: s.title,
    at: s.urlAt ?? s.last,
    shot: s.shotFile ? `/api/neo/shot/${s.sessionId}/${s.shotFile}` : undefined,
    actions: s.actions,
    tabs: neo.tabsOf(s),
  };
}

/** The Claude Code / Codex agent whose own BrowserOS neo calls line up with this Neo session. */
function matchAgent(agents: AgentSnapshot[], family: Provider, s: NeoSession): AgentSnapshot | undefined {
  let best: AgentSnapshot | undefined;
  let bestGap = Infinity;
  for (const a of agents) {
    if (a.provider !== family || !a.browserAt) continue;
    if (a.browserAt < s.first - 60_000 || a.browserAt > s.last + 90_000) continue;
    const gap = Math.abs(a.browserAt - s.last);
    if (gap < bestGap) {
      best = a;
      bestGap = gap;
    }
  }
  return best;
}
