// Read-only Git status per project, cached. Uses --no-optional-locks so it never takes the index lock.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface GitInfo {
  branch?: string;
  dirty: number;
  ahead: number;
  behind: number;
}

const cache = new Map<string, { at: number; info: GitInfo | null; pending: boolean }>();
const TTL_MS = 30_000;

function isRepo(dir: string): boolean {
  let current = dir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return false;
}

function refresh(dir: string) {
  const entry = cache.get(dir) ?? { at: 0, info: null, pending: false };
  entry.pending = true;
  cache.set(dir, entry);
  if (!fs.existsSync(dir) || !isRepo(dir)) {
    cache.set(dir, { at: Date.now(), info: null, pending: false });
    return;
  }
  execFile(
    'git',
    ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v1', '--branch', '--untracked-files=normal'],
    { timeout: 4000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    (error, stdout) => {
      if (error) {
        cache.set(dir, { at: Date.now(), info: null, pending: false });
        return;
      }
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '';
      const branch = head.split('...')[0].replace(/^No commits yet on /, '') || undefined;
      const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
      const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
      cache.set(dir, { at: Date.now(), info: { branch, dirty: lines.length, ahead, behind }, pending: false });
    },
  );
}

/** Returns the cached status (possibly stale) and schedules a refresh when needed. */
export function gitInfo(dir: string): GitInfo | undefined {
  const entry = cache.get(dir);
  if (!entry || (!entry.pending && Date.now() - entry.at > TTL_MS)) refresh(dir);
  return entry?.info ?? undefined;
}
