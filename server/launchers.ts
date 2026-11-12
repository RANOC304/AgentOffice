// Finds the Claude Code and Codex command-line tools, and opens sessions in their apps, a terminal
// or the file explorer. Every command is built from server-side data (validated ids and known
// folders) and run without a shell, so nothing from the browser is ever executed as text.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MissionProvider } from '../shared/types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESKTOP_ID = /^local_[0-9a-f-]{36}$/i;

let cache: { at: number; tools: Record<MissionProvider, string | null> } | null = null;

function onPath(name: string): string | null {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && fs.existsSync(l) && !/\.(cmd|bat|ps1)$/i.test(l));
    return first ?? null;
  } catch {
    return null;
  }
}

function codexFromStore(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-AppxPackage -Name OpenAI.Codex).InstallLocation'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    }).trim();
    const exe = out ? path.join(out.split(/\r?\n/)[0].trim(), 'app', 'resources', 'codex.exe') : '';
    return exe && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

/** Paths of the CLIs (cached for ten minutes; set AGENTOFFICE_CLAUDE / AGENTOFFICE_CODEX to override). */
export function tools(): Record<MissionProvider, string | null> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.tools;
  const exists = (p: string | undefined) => (p && fs.existsSync(p) ? p : null);
  const claude =
    exists(process.env.AGENTOFFICE_CLAUDE) ??
    exists(path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')) ??
    onPath('claude');
  const codex = exists(process.env.AGENTOFFICE_CODEX) ?? onPath('codex') ?? codexFromStore();
  cache = { at: Date.now(), tools: { 'claude-code': claude, codex } };
  return cache.tools;
}

/** The CLI paths if they were already looked up (never blocks). */
export function toolsIfKnown(): Record<MissionProvider, string | null> | null {
  return cache?.tools ?? null;
}

/** Opens a URL with the system handler (claude://, codex://). */
function openUrl(url: string) {
  if (process.platform === 'win32') spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

export function openClaudeDesktop(hostSessionId?: string, cliSessionId?: string): string | null {
  if (hostSessionId && DESKTOP_ID.test(hostSessionId)) openUrl(`claude://code/continue?session=${hostSessionId}`);
  else if (cliSessionId && UUID.test(cliSessionId)) openUrl(`claude://resume?session=${cliSessionId}`);
  else return 'This session has no link the Claude app understands.';
  return null;
}

export function openCodexThread(threadId: string): string | null {
  if (!UUID.test(threadId)) return 'Unknown Codex thread.';
  openUrl(`codex://threads/${threadId}`);
  return null;
}

export function openFolder(dir: string): string | null {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 'That folder does not exist on this computer.';
  if (process.platform === 'win32') spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else openUrl(dir);
  return null;
}

/** Opens a terminal in the project folder that resumes the session interactively. */
export function resumeInTerminal(provider: MissionProvider, sessionId: string, dir: string): string | null {
  if (!UUID.test(sessionId)) return 'Unknown session.';
  const exe = tools()[provider];
  if (!exe) return `${provider === 'codex' ? 'Codex' : 'Claude Code'} was not found on this computer.`;
  if (!dir || !fs.existsSync(dir)) return 'The project folder does not exist on this computer.';
  const args = provider === 'codex' ? ['resume', sessionId] : ['--resume', sessionId];
  if (process.platform !== 'win32') return 'Opening a terminal is only supported on Windows for now.';
  const wt = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe');
  if (fs.existsSync(wt)) {
    spawn(wt, ['-d', dir, exe, ...args], { detached: true, stdio: 'ignore' }).unref();
    return null;
  }
  // No Windows Terminal: a plain console window. cmd parses this line, so refuse unusual folder names.
  if (/["%^&|<>]/.test(dir) || /["%^&|<>]/.test(exe)) return 'This folder name cannot be opened safely in a console.';
  spawn('cmd.exe', ['/c', 'start', '""', '/D', dir, exe, ...args], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return null;
}

/** Ends a process and its children. */
export function killTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 4) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 8000 });
    } catch {
      // already gone
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

export const isUuid = (s: string) => UUID.test(s);
