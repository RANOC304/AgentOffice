// Plan usage and rate limits: Claude from the desktop app's local plan-usage history, Codex from
// the rate-limit figures written into its rollouts. Read-only, cached, nothing leaves the computer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageGauge } from '../shared/types.ts';
import { config } from './config.ts';

interface Cached {
  at: number;
  claude: UsageGauge[];
  codex: UsageGauge[];
}

let cache: Cached | null = null;

export function usageGauges(now: number): { claude: UsageGauge[]; codex: UsageGauge[] } {
  if (cache && now - cache.at < 30_000) return cache;
  cache = { at: now, claude: claudeUsage(), codex: codexUsage(now) };
  return cache;
}

function claudeUsage(): UsageGauge[] {
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Claude-Data') : path.join(os.homedir(), '.claude-data');
  let newest: { file: string; mtime: number } | null = null;
  try {
    for (const dir of fs.readdirSync(root)) {
      const file = path.join(root, dir, 'plan-usage-history.json');
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file, mtime };
      } catch {
        // not this folder
      }
    }
  } catch {
    return [];
  }
  if (!newest) return [];
  try {
    const data = JSON.parse(fs.readFileSync(newest.file, 'utf8')) as { samples?: Array<{ t: number; u?: { fh?: number; sd?: number } }> };
    const last = data.samples?.at(-1);
    if (!last?.u) return [];
    const out: UsageGauge[] = [];
    if (typeof last.u.fh === 'number') out.push({ id: 'claude-5h', label: '5-hour limit', usedPercent: last.u.fh, at: last.t });
    if (typeof last.u.sd === 'number') out.push({ id: 'claude-week', label: 'Weekly limit', usedPercent: last.u.sd, at: last.t });
    return out;
  } catch {
    return [];
  }
}

/** Latest rate limits from the most recently written Codex rollouts (last week). */
function codexUsage(now: number): UsageGauge[] {
  const root = path.join(config.codexHome, 'sessions');
  const files: Array<{ file: string; mtime: number }> = [];
  for (let back = 0; back < 8; back++) {
    const d = new Date(now - back * 86_400_000);
    const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        files.push({ file, mtime: fs.statSync(file).mtimeMs });
      }
    } catch {
      // no sessions that day
    }
    if (files.length >= 6) break;
  }
  files.sort((a, b) => b.mtime - a.mtime);
  let best: { at: number; limits: Record<string, any> } | null = null;
  for (const { file } of files.slice(0, 6)) {
    const found = lastRateLimits(file);
    if (found && (!best || found.at > best.at)) best = found;
  }
  if (!best) return [];
  const out: UsageGauge[] = [];
  const add = (id: string, w: Record<string, any> | undefined) => {
    if (!w || typeof w.used_percent !== 'number') return;
    const minutes = Number(w.window_minutes) || 0;
    const label = minutes >= 7 * 1440 - 60 ? 'Weekly limit' : minutes ? `${Math.round(minutes / 60)}-hour limit` : 'Limit';
    // A window that already reset is back to zero.
    const resetsAt = typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined;
    out.push({ id, label, usedPercent: resetsAt && resetsAt < now ? 0 : w.used_percent, resetsAt, at: best!.at });
  };
  add('codex-primary', best.limits.primary);
  add('codex-secondary', best.limits.secondary);
  return out;
}

function lastRateLimits(file: string): { at: number; limits: Record<string, any> } | null {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"rate_limits"')) continue;
      try {
        const rec = JSON.parse(line);
        const limits = rec.payload?.rate_limits;
        // Some events only carry credit info; keep looking for real windows.
        if (limits && (limits.primary || limits.secondary)) return { at: Date.parse(rec.timestamp) || fs.statSync(file).mtimeMs, limits };
      } catch {
        // partial line
      }
    }
  } catch {
    // unreadable
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return null;
}
