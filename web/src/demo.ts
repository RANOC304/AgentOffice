// Synthetic office for ?demo — lets you preview the office without live sessions.

import type { RoomId } from '../../shared/rooms.ts';
import type { ActivityEvent, AgentSnapshot, AgentStatus, OfficeSnapshot, Provider } from '../../shared/types.ts';

interface Persona {
  id: string;
  provider: Provider;
  app: string;
  name: string;
  project: string;
  rooms: RoomId[];
  lines: string[];
  parent?: string;
  role?: string;
}

const PERSONAS: Persona[] = [
  { id: 'd1', provider: 'claude', app: 'Claude desktop', name: 'Landing page redesign', project: 'PortfolioSite', rooms: ['web', 'design', 'browser'], lines: ['Tightening the hero spacing', 'Checking the mobile layout in Neo', 'The gradient needs more contrast'] },
  { id: 'd2', provider: 'codex', app: 'Codex CLI', name: 'Fix flaky API tests', project: 'ShopBackend', rooms: ['backend', 'devops'], lines: ['Found the race in the order service', 'Re-running the suite', 'Mocking the payment webhook'] },
  { id: 'd3', provider: 'chatgpt', app: 'ChatGPT app', name: 'Roblox obby checkpoints', project: 'RobloxStudio', rooms: ['gamedev', 'threed'], lines: ['Saving checkpoints with DataStore', 'Testing the respawn flow', 'Adding a lava kill brick'] },
  { id: 'd4', provider: 'claude', app: 'Claude Code CLI', name: 'Blender product render', project: 'AnimatedVideos', rooms: ['threed', 'media'], lines: ['Baking the AO map', 'Lighting with a softbox HDRI', 'Render at 1080x1920'] },
  { id: 'd5', provider: 'chatgpt', app: 'ChatGPT app', name: 'Quantum MaxCut study', project: 'quantumcomputing', rooms: ['data', 'research'], lines: ['Building the cost Hamiltonian', 'QAOA depth 2 looks better', 'Why are my counts reversed?'] },
  { id: 'd6', provider: 'claude', app: 'Claude desktop', name: 'Security review', project: 'LegalPagesCreator', rooms: ['security', 'writing'], lines: ['Checking CSP headers', 'No secrets in the bundle', 'Writing the findings report'] },
  { id: 'd7', provider: 'codex', app: 'Codex IDE', name: 'Android build', project: 'ScooterApp', rooms: ['mobile', 'systems'], lines: ['Gradle sync is slow today', 'Bumping compileSdk', 'APK builds fine now'] },
  { id: 'd8', provider: 'claude', app: 'Claude desktop', name: 'TikTok short script', project: 'YoutubeKids', rooms: ['media', 'writing', 'browser'], lines: ['Timing the voiceover to 24s', 'Adding captions', 'Exporting the vertical cut'] },
  { id: 'd9', provider: 'claude', app: 'Claude desktop', name: 'Explore', role: 'Explore', parent: 'claude:d1', project: 'PortfolioSite', rooms: ['research', 'web'], lines: ['Mapping the components folder', 'Found 3 hero variants'] },
  { id: 'd10', provider: 'chatgpt', app: 'ChatGPT app', name: 'Bohr', role: 'desktop shell', parent: 'chatgpt:d3', project: 'RobloxStudio', rooms: ['gamedev'], lines: ['Wiring the UI buttons', 'Reporting back soon'] },
  { id: 'd11', provider: 'codex', app: 'Codex CLI', name: 'Docs cleanup', project: 'ConnectWOL', rooms: ['writing', 'systems'], lines: ['Rewriting the README', 'Documenting wake-on-LAN flags'] },
  { id: 'd12', provider: 'chatgpt', app: 'ChatGPT app', name: 'Brand palette ideas', project: 'AlbaTaure', rooms: ['design', 'research'], lines: ['Warmer terracotta for the CTA?', 'Testing type pairings'] },
];

const STATUSES: AgentStatus[] = ['working', 'working', 'working', 'idle', 'waiting', 'working', 'idle'];

export function demoSnapshot(start: number, now: number): OfficeSnapshot {
  const phase = Math.floor((now - start) / 14000);
  const agents: AgentSnapshot[] = PERSONAS.map((p, i) => {
    const status = p.parent ? (phase + i) % 5 === 4 ? 'done' : 'working' : STATUSES[(phase + i * 3) % STATUSES.length];
    const domain = p.rooms[(phase + i) % p.rooms.length];
    const usingBrowser = status === 'working' && domain === 'browser';
    const room: RoomId = status === 'idle' ? 'lounge' : domain;
    const recent: ActivityEvent[] = p.lines.map((text, k) => ({ at: now - k * 45_000, kind: k === 0 ? 'edit' : 'command', label: text }));
    const pulses = Array.from({ length: 30 + i * 7 }, (_, k) => now - ((k * 97_000 + i * 13_000) % (3 * 3600_000)));
    return {
      id: `${p.provider}:${p.id}`,
      provider: p.provider,
      kind: p.parent ? 'subagent' : 'session',
      parentId: p.parent,
      name: p.name,
      role: p.role,
      app: p.app,
      model: p.provider === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1',
      projectPath: `C:\\Demo\\${p.project}`,
      projectName: p.project,
      branch: 'main',
      status,
      activity: status === 'waiting' ? 'Asks: ship it now or after review?' : status === 'idle' ? 'Idle, waiting for a new task' : p.lines[phase % p.lines.length],
      room,
      domain: domain === 'browser' ? p.rooms[0] : domain,
      usingBrowser,
      startedAt: start - i * 600_000,
      lastActivityAt: now - (status === 'working' ? 3000 : 120_000),
      tokens: { input: 120_000 * (i + 1), output: 9_000 * (i + 2), cached: 800_000 * (i + 1), total: 929_000 * (i + 1) },
      counts: { turns: 3 + i, tools: 40 + i * 9, edits: 6 + i, commands: 12 + i * 2, reads: 15 + i, searches: 4, browser: usingBrowser ? 12 : 0, subagents: p.parent ? 0 : i % 3, errors: i % 4 === 0 ? 1 : 0 },
      topTools: [
        { name: 'Edit', count: 12 + i },
        { name: 'Bash', count: 9 + i },
        { name: 'Read', count: 7 },
      ],
      filesTouched: [`src\\feature${i}.ts`, 'README.md'],
      lastPrompt: `Please work on: ${p.name.toLowerCase()}`,
      lastMessage: p.lines[(phase + 1) % p.lines.length],
      lines: p.lines.map((text, k) => ({ at: now - k * 30_000, kind: k % 3 === 2 ? 'think' : 'say', text })),
      recent,
      attention: status === 'waiting' ? { level: 'alert', reason: 'Asks: ship it now or after review?' } : undefined,
      pulses,
    };
  });
  const projects = [...new Set(agents.map((a) => a.projectName!))].map((name) => {
    const mine = agents.filter((a) => a.projectName === name);
    return {
      path: `C:\\Demo\\${name}`,
      name,
      agents: mine.map((a) => a.id),
      providers: [...new Set(mine.map((a) => a.provider))],
      working: mine.filter((a) => a.status === 'working').length,
      waiting: mine.filter((a) => a.status === 'waiting').length,
      lastActivityAt: Math.max(...mine.map((a) => a.lastActivityAt)),
      git: { branch: 'main', dirty: name.length % 4, ahead: name.length % 2, behind: 0 },
      attention: mine.filter((a) => a.attention).map((a) => a.attention!),
    };
  });
  return {
    version: 1,
    generatedAt: now,
    host: 'demo',
    agents,
    projects,
    sources: [
      { provider: 'claude', ok: true, path: 'demo', message: 'Demo data' },
      { provider: 'codex', ok: true, path: 'demo', message: 'Demo data' },
    ],
    windowMs: 3 * 3600_000,
  };
}
