// Combines every collector into one office snapshot.

import os from 'node:os';
import type { AgentSnapshot, Attention, OfficeSnapshot, ProjectSummary, Provider } from '../shared/types.ts';
import { ClaudeCollector } from './collectors/claude.ts';
import { CodexCollector } from './collectors/codex.ts';
import { config } from './config.ts';
import { gitInfo } from './git.ts';

const SKIP_GIT = (p: string) => /^[A-Z]:\\?$/i.test(p) || p.toLowerCase() === os.homedir().toLowerCase();

export class Office {
  private claude = new ClaudeCollector();
  private codex = new CodexCollector();

  snapshot(now = Date.now()): OfficeSnapshot {
    const agents: AgentSnapshot[] = [];
    for (const collector of [this.claude, this.codex]) {
      try {
        agents.push(...collector.poll(now));
      } catch (error) {
        console.error(`[office] collector failed:`, error);
      }
    }
    // Subagents whose parent is not in the office keep their own desk but lose the link.
    const ids = new Set(agents.map((a) => a.id));
    for (const agent of agents) if (agent.parentId && !ids.has(agent.parentId)) agent.parentId = undefined;

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
      sources: [this.claude.status, this.codex.status],
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
      if (!project.providers.includes(agent.provider)) project.providers.push(agent.provider as Provider);
      if (agent.status === 'working') project.working += 1;
      if (agent.status === 'waiting') project.waiting += 1;
      project.lastActivityAt = Math.max(project.lastActivityAt, agent.lastActivityAt);
      if (agent.attention && agent.attention.level !== 'info')
        project.attention.push({ level: agent.attention.level, reason: `${agent.name}: ${agent.attention.reason}` });
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
