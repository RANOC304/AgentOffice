// App-only office decisions, persisted in data/office-state.json: fired workers and removed
// projects. Nothing here touches the real sessions or folders.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'office-state.json');
const KEEP_MS = 14 * 24 * 3600_000;

interface Saved {
  fired?: Record<string, { at: number; persona?: string; name?: string; provider?: string }>;
  removedProjects?: Record<string, { at: number; path: string } | number>;
}

export interface FiredEntry {
  at: number;
  persona?: string;
  name?: string;
  provider?: string;
}

export class OfficeState {
  readonly fired = new Map<string, FiredEntry>();
  /** Lower-cased project path → when it was removed from the office, and its original spelling. */
  readonly removedProjects = new Map<string, { at: number; path: string }>();

  constructor() {
    try {
      const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Saved;
      for (const [id, f] of Object.entries(saved.fired ?? {})) if (f && typeof f.at === 'number') this.fired.set(id, f);
      for (const [p, v] of Object.entries(saved.removedProjects ?? {})) {
        if (typeof v === 'number') this.removedProjects.set(p, { at: v, path: p });
        else if (v && typeof v.at === 'number') this.removedProjects.set(p, { at: v.at, path: v.path ?? p });
      }
    } catch {
      // first run
    }
  }

  fire(id: string, info: Omit<FiredEntry, 'at'>, now: number) {
    this.fired.set(id, { at: now, ...info });
    this.save(now);
  }

  rehire(id: string, now: number) {
    if (this.fired.delete(id)) this.save(now);
  }

  removeProject(projectPath: string, now: number) {
    this.removedProjects.set(projectPath.toLowerCase(), { at: now, path: projectPath });
    this.save(now);
  }

  restoreProject(projectPath: string, now: number) {
    if (this.removedProjects.delete(projectPath.toLowerCase())) this.save(now);
  }

  save(now = Date.now()) {
    for (const [id, f] of this.fired) if (now - f.at > KEEP_MS) this.fired.delete(id);
    const data: Saved = { fired: Object.fromEntries(this.fired), removedProjects: Object.fromEntries(this.removedProjects) };
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data, null, 1), 'utf8');
    } catch (error) {
      console.error('[state] could not save office state', error);
    }
  }
}
