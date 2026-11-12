// Mission board and headless runs. A mission is a task for a project; started, it runs
// `claude -p` or `codex exec` in the project folder with the chosen permission level, and its
// worker shows up in the office like any other session. Replies and hand-offs are missions that
// continue an existing session. Everything is stored in data/missions.json (local, ignored).

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mission, MissionPermission, MissionProvider } from '../shared/types.ts';
import { isUuid, killTree, tools } from './launchers.ts';
import { JsonlTail } from './util/tail.ts';
import { clean, projectNameFromPath } from './util/text.ts';
import { isAlive } from './util/proc.ts';

const DATA = path.join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const FILE = path.join(DATA, 'missions.json');
const LOGS = path.join(DATA, 'missions');
const KEEP_DONE_MS = 7 * 24 * 3600_000;
/** Finished mission workers stay in the office (idle) this long, so you can reply or hand off. */
export const RETAIN_MS = 30 * 60_000;

interface Run {
  pid: number;
  tail: JsonlTail;
  stopping: boolean;
  exitCode?: number | null;
  sawResult: boolean;
  failed: boolean;
}

interface Saved {
  missions: Mission[];
  pids?: Record<string, number>;
}

export interface NewMission {
  title?: string;
  prompt: string;
  projectPath: string;
  provider: MissionProvider;
  permission: MissionPermission;
  model?: string;
  from?: { agentId: string; persona: string };
  /** Continue this session (reply or assignment) instead of starting a new one. */
  sessionId?: string;
}

export class Missions {
  readonly list: Mission[] = [];
  private runs = new Map<string, Run>();
  private dirty = false;

  constructor() {
    try {
      const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Saved;
      for (const m of saved.missions ?? []) if (m && typeof m.id === 'string') this.list.push(m);
      // Runs that outlived a server restart keep being followed through their log file.
      for (const [id, pid] of Object.entries(saved.pids ?? {})) {
        const m = this.get(id);
        if (m?.status === 'running' && isAlive(pid)) this.follow(m, pid);
      }
      for (const m of this.list)
        if (m.status === 'running' && !this.runs.has(m.id)) {
          m.status = 'failed';
          m.error = m.error ?? 'Interrupted while AgentOffice was not running.';
          m.endedAt = m.endedAt ?? Date.now();
        }
    } catch {
      // first run
    }
  }

  get(id: string): Mission | undefined {
    return this.list.find((m) => m.id === id);
  }

  forAgent(agentId: string): Mission | undefined {
    let best: Mission | undefined;
    for (const m of this.list) if (m.agentId === agentId && (!best || (m.startedAt ?? 0) > (best.startedAt ?? 0))) best = m;
    return best;
  }

  /** Is this session being run (or was just run) by a mission? */
  running(agentId: string): boolean {
    return this.list.some((m) => m.agentId === agentId && m.status === 'running');
  }

  retained(agentId: string, now: number): boolean {
    return this.list.some((m) => m.agentId === agentId && (m.status === 'running' || (m.endedAt && now - m.endedAt < RETAIN_MS)));
  }

  /** Adds a mission to the board (to do). */
  add(input: NewMission, now: number): Mission {
    const prompt = input.prompt.trim().slice(0, 8000);
    const m: Mission = {
      id: crypto.randomUUID(),
      title: (input.title?.trim() || firstLine(prompt)).slice(0, 120),
      prompt,
      projectPath: input.projectPath,
      projectName: projectNameFromPath(input.projectPath) ?? input.projectPath,
      provider: input.provider,
      permission: input.permission,
      model: input.model,
      status: 'todo',
      createdAt: now,
      from: input.from,
      runs: 0,
    };
    if (input.sessionId) {
      m.sessionId = input.sessionId;
      m.resume = true;
      m.agentId = `${input.provider === 'codex' ? 'codex' : 'claude'}:${input.sessionId}`;
    }
    this.list.unshift(m);
    this.save();
    return m;
  }

  update(id: string, patch: Partial<Pick<Mission, 'title' | 'prompt' | 'projectPath' | 'provider' | 'permission' | 'model'>>): string | null {
    const m = this.get(id);
    if (!m) return 'Unknown mission.';
    if (m.status === 'running') return 'The mission is running.';
    Object.assign(m, patch);
    if (patch.projectPath) m.projectName = projectNameFromPath(patch.projectPath) ?? patch.projectPath;
    this.save();
    return null;
  }

  remove(id: string): string | null {
    const m = this.get(id);
    if (!m) return 'Unknown mission.';
    if (m.status === 'running') return 'Stop the mission first.';
    this.list.splice(this.list.indexOf(m), 1);
    fs.rm(path.join(LOGS, `${id}.log`), { force: true }, () => undefined);
    this.save();
    return null;
  }

  /**
   * Starts (or restarts) a mission. With `sessionId` it continues that session (assign to an idle
   * worker); otherwise a new session is created.
   */
  start(id: string, now: number, sessionId?: string): string | null {
    const m = this.get(id);
    if (!m) return 'Unknown mission.';
    if (m.status === 'running') return 'Already running.';
    const exe = tools()[m.provider];
    if (!exe) return `${m.provider === 'codex' ? 'Codex' : 'Claude Code'} was not found on this computer.`;
    if (!fs.existsSync(m.projectPath) || !fs.statSync(m.projectPath).isDirectory()) return 'The project folder does not exist on this computer.';
    if (sessionId) {
      if (!isUuid(sessionId)) return 'Unknown session.';
      m.sessionId = sessionId;
      m.resume = true;
    } else if (!m.resume || !m.sessionId) {
      m.resume = false;
      m.sessionId = m.provider === 'claude-code' ? crypto.randomUUID() : undefined;
    }
    if (m.provider === 'claude-code' && m.sessionId) m.agentId = `claude:${m.sessionId}`;
    else if (m.provider === 'codex' && m.sessionId) m.agentId = `codex:${m.sessionId}`;
    else m.agentId = undefined;

    fs.mkdirSync(LOGS, { recursive: true });
    const logFile = path.join(LOGS, `${m.id}.log`);
    fs.writeFileSync(logFile, '');
    const out = fs.openSync(logFile, 'a');
    const args = m.provider === 'claude-code' ? claudeArgs(m) : codexArgs(m);
    let child;
    try {
      child = spawn(exe, args, { cwd: m.projectPath, stdio: ['pipe', out, out], windowsHide: true, detached: true, env: { ...process.env } });
    } catch (error) {
      fs.closeSync(out);
      return `Could not start: ${(error as Error).message}`;
    }
    // The child keeps its own copy of the log handle.
    fs.closeSync(out);
    // Both CLIs read the prompt from stdin, so it is never parsed as command-line options.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(m.prompt);
    child.on('error', (error) => {
      m.error = clean(error.message, 200);
    });
    child.on('exit', (code) => {
      const run = this.runs.get(m.id);
      if (run) run.exitCode = code;
    });
    child.unref();
    if (!child.pid) return 'Could not start the process.';

    m.status = 'running';
    m.startedAt = now;
    m.endedAt = undefined;
    m.result = undefined;
    m.error = undefined;
    m.runs += 1;
    this.follow(m, child.pid);
    this.save();
    return null;
  }

  stop(id: string): string | null {
    const m = this.get(id);
    const run = m && this.runs.get(m.id);
    if (!m || !run) return 'That mission is not running.';
    run.stopping = true;
    killTree(run.pid);
    return null;
  }

  /** Is this process one of ours? */
  pidOf(agentId: string): number | undefined {
    for (const m of this.list) if (m.agentId === agentId && m.status === 'running') return this.runs.get(m.id)?.pid;
    return undefined;
  }

  /** Reads new output from running missions and settles finished ones. */
  poll(now: number) {
    for (const [id, run] of this.runs) {
      const m = this.get(id);
      if (!m) {
        this.runs.delete(id);
        continue;
      }
      for (const raw of run.tail.read() ?? []) this.apply(m, run, raw as Record<string, any>);
      const alive = run.exitCode === undefined && isAlive(run.pid);
      if (alive) continue;
      // Drain what was written last.
      for (const raw of run.tail.read() ?? []) this.apply(m, run, raw as Record<string, any>);
      this.runs.delete(id);
      m.endedAt = now;
      if (run.stopping) m.status = 'stopped';
      else if (run.failed || (!run.sawResult && run.exitCode !== 0)) {
        m.status = 'failed';
        if (!m.error) m.error = run.exitCode != null ? `Exited with code ${run.exitCode}` : 'Ended without a result';
      } else m.status = 'done';
      this.dirty = true;
    }
    if (this.dirty) this.save();
  }

  private follow(m: Mission, pid: number) {
    this.runs.set(m.id, { pid, tail: new JsonlTail(path.join(LOGS, `${m.id}.log`), 4 * 1024 * 1024), stopping: false, sawResult: false, failed: false });
  }

  /** Understands Claude stream-json and Codex --json events. */
  private apply(m: Mission, run: Run, e: Record<string, any>) {
    // Claude Code
    if (e.type === 'system' && e.subtype === 'init' && typeof e.session_id === 'string') {
      if (e.session_id !== m.sessionId) {
        m.sessionId = e.session_id;
        m.agentId = `claude:${e.session_id}`;
        this.dirty = true;
      }
      return;
    }
    if (e.type === 'result') {
      run.sawResult = true;
      run.failed = Boolean(e.is_error) || (typeof e.subtype === 'string' && e.subtype !== 'success');
      if (typeof e.result === 'string') m.result = clean(e.result, 600);
      if (run.failed && !m.error) m.error = clean(typeof e.result === 'string' ? e.result : e.subtype, 200);
      if (typeof e.total_cost_usd === 'number') m.costUsd = (m.costUsd ?? 0) + e.total_cost_usd;
      this.dirty = true;
      return;
    }
    // Codex
    if (e.type === 'thread.started' && typeof e.thread_id === 'string') {
      m.sessionId = e.thread_id;
      m.agentId = `codex:${e.thread_id}`;
      this.dirty = true;
      return;
    }
    if (e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string') {
      m.result = clean(e.item.text, 600);
      this.dirty = true;
      return;
    }
    if (e.type === 'turn.completed') {
      run.sawResult = true;
      return;
    }
    if (e.type === 'turn.failed' || e.type === 'error') {
      run.failed = true;
      m.error = clean(e.error?.message ?? e.message ?? 'Codex reported an error', 200);
      this.dirty = true;
    }
  }

  save() {
    this.dirty = false;
    const now = Date.now();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (m.status !== 'todo' && m.status !== 'running' && m.endedAt && now - m.endedAt > KEEP_DONE_MS) this.list.splice(i, 1);
    }
    const pids: Record<string, number> = {};
    for (const [id, run] of this.runs) pids[id] = run.pid;
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ missions: this.list, pids } satisfies Saved, null, 1), 'utf8');
    } catch (error) {
      console.error('[missions] could not save', error);
    }
  }
}

function firstLine(text: string): string {
  return clean(text.split(/\r?\n/).find((l) => l.trim()) ?? 'Mission', 80);
}

const CLAUDE_MODE: Record<MissionPermission, string> = { 'read-only': 'dontAsk', edit: 'acceptEdits', full: 'bypassPermissions' };
const CODEX_SANDBOX: Record<MissionPermission, string> = { 'read-only': 'read-only', edit: 'workspace-write', full: 'danger-full-access' };

function claudeArgs(m: Mission): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', CLAUDE_MODE[m.permission]];
  if (m.resume && m.sessionId) args.push('--resume', m.sessionId);
  else if (m.sessionId) args.push('--session-id', m.sessionId);
  if (m.model) args.push('--model', m.model);
  return args;
}

function codexArgs(m: Mission): string[] {
  const common = ['--json', '--skip-git-repo-check', '-c', 'approval_policy="never"'];
  if (m.model) common.push('-m', m.model);
  if (m.resume && m.sessionId) {
    return ['exec', 'resume', ...common, '-c', `sandbox_mode="${CODEX_SANDBOX[m.permission]}"`, m.sessionId, '-'];
  }
  return ['exec', ...common, '-s', CODEX_SANDBOX[m.permission], '-C', m.projectPath, '-'];
}
