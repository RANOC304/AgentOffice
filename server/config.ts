import os from 'node:os';
import path from 'node:path';

const env = process.env;
const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const home = os.homedir();

export const config = {
  port: num(env.AGENTOFFICE_PORT, 4317),
  /** Only ever bind to loopback: the office must never be reachable from the network. */
  host: '127.0.0.1',
  claudeHome: env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'),
  codexHome: env.CODEX_HOME ?? path.join(home, '.codex'),
  /** How often collectors look for changes. */
  pollMs: num(env.AGENTOFFICE_POLL_MS, 1500),
  /** Codex/ChatGPT threads stay in the office this long after their last activity. */
  recentMinutes: num(env.AGENTOFFICE_RECENT_MIN, 120),
  /** Finished sessions and subagents linger this long before walking out. */
  doneLingerMinutes: num(env.AGENTOFFICE_DONE_LINGER_MIN, 6),
  /** A session with an open turn but no writes for this long is treated as stalled/idle. */
  stallMinutes: num(env.AGENTOFFICE_STALL_MIN, 8),
  /** BrowserOS neo usage within this window sends the agent to the Neo hub. */
  browserWindowMs: num(env.AGENTOFFICE_BROWSER_WINDOW_S, 90) * 1000,
  /** Analytics timeline length. */
  windowMs: num(env.AGENTOFFICE_WINDOW_MIN, 180) * 60_000,
  /** Largest transcript tail parsed on first sight of a file. Older lines only feed totals when cheap. */
  maxInitialBytes: num(env.AGENTOFFICE_MAX_INITIAL_MB, 24) * 1024 * 1024,
};

export type Config = typeof config;
