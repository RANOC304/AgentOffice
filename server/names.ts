// Character names: an editable list (config/names.txt) and stable per-agent assignments
// (data/personas.json). Free names are reused; when all are taken a new male name is invented.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const NAMES_FILE = path.join(root, 'config', 'names.txt');
const ASSIGN_FILE = path.join(root, 'data', 'personas.json');
/** A name is released when its agent has been gone this long. */
const RELEASE_MS = 30 * 60_000;

const HEADER = [
  '# AgentOffice character names',
  '# One male first name per line. Lines starting with # are ignored.',
  '# Each new session or agent gets a name nobody in the office is using.',
  '# When every name is taken, AgentOffice invents a new male name.',
  '# You can also edit this list from the dashboard (Names tab).',
  '',
];

const START = ['Al', 'Bar', 'Bren', 'Cal', 'Dar', 'Ed', 'Fen', 'Gar', 'Hal', 'Jor', 'Kel', 'Lor', 'Mar', 'Nor', 'Os', 'Ren', 'Sev', 'Tor', 'Val', 'Wil', 'Ad', 'Bas', 'Cor', 'Dam', 'Elio', 'Gus', 'Iv', 'Lu', 'Mat', 'Rom'];
const END = ['an', 'ric', 'on', 'ius', 'en', 'dan', 'mar', 'ton', 'vin', 'win', 'ard', 'ias', 'ek', 'ian', 'ald', 'ert', 'ond', 'o', 'is', 'el'];

interface Assignment {
  name: string;
  lastSeen: number;
}

const NAME_RE = /^[\p{L}][\p{L}' .-]{0,29}$/u;

export function cleanNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 400) break;
  }
  return out;
}

export class Names {
  private list: string[] = [];
  private listMtime = 0;
  private assignments = new Map<string, Assignment>();
  private dirty = false;
  private lastSave = 0;

  constructor() {
    this.loadList();
    try {
      const saved = JSON.parse(fs.readFileSync(ASSIGN_FILE, 'utf8')) as Record<string, Assignment>;
      for (const [id, a] of Object.entries(saved)) if (a && typeof a.name === 'string') this.assignments.set(id, a);
    } catch {
      // first run
    }
  }

  get names(): string[] {
    this.loadList();
    return [...this.list];
  }

  private loadList() {
    try {
      const stat = fs.statSync(NAMES_FILE);
      if (stat.mtimeMs === this.listMtime) return;
      this.listMtime = stat.mtimeMs;
      const lines = fs.readFileSync(NAMES_FILE, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
      this.list = cleanNames(lines);
    } catch {
      if (!this.list.length) this.list = ['Lucas', 'Hugo', 'Louis', 'Arthur', 'Jules', 'Adam', 'Léo', 'Nathan', 'Paul', 'Victor'];
    }
  }

  saveList(names: string[]) {
    const clean = cleanNames(names);
    fs.mkdirSync(path.dirname(NAMES_FILE), { recursive: true });
    fs.writeFileSync(NAMES_FILE, [...HEADER, ...clean, ''].join('\n'), 'utf8');
    this.listMtime = 0;
    this.loadList();
    return clean;
  }

  /** Returns the persona name for every agent id, assigning new ones as needed. */
  assign(ids: string[], now: number): Map<string, string> {
    this.loadList();
    const present = new Set(ids);
    // Release names of agents that left a while ago.
    for (const [id, a] of this.assignments) {
      if (!present.has(id) && now - a.lastSeen > RELEASE_MS) {
        this.assignments.delete(id);
        this.dirty = true;
      }
    }
    const taken = new Set<string>();
    for (const [id, a] of this.assignments) if (present.has(id) || now - a.lastSeen <= RELEASE_MS) taken.add(a.name.toLowerCase());

    const out = new Map<string, string>();
    for (const id of ids) {
      let a = this.assignments.get(id);
      if (!a) {
        const name = this.pick(id, taken);
        taken.add(name.toLowerCase());
        a = { name, lastSeen: now };
        this.assignments.set(id, a);
        this.dirty = true;
      }
      if (now - a.lastSeen > 60_000) this.dirty = true;
      a.lastSeen = now;
      out.set(id, a.name);
    }
    if (this.dirty && now - this.lastSave > 10_000) this.save(now);
    return out;
  }

  /** Gives a character a new name chosen by the user. Returns an error message, or null when done. */
  rename(id: string, raw: string, now: number): string | null {
    const [name] = cleanNames([raw]);
    if (!name) return 'Use letters, spaces, hyphens or apostrophes (up to 30 characters).';
    for (const [other, a] of this.assignments) {
      if (other !== id && a.name.toLowerCase() === name.toLowerCase() && now - a.lastSeen <= RELEASE_MS) return `${name} is already working here.`;
    }
    this.assignments.set(id, { name, lastSeen: now });
    this.save(now);
    return null;
  }

  private pick(id: string, taken: Set<string>): string {
    const free = this.list.filter((n) => !taken.has(n.toLowerCase()));
    if (free.length) return free[hash(id) % free.length];
    const h = hash(id);
    for (let i = 0; i < START.length * END.length; i++) {
      const k = (h + i * 7919) % (START.length * END.length);
      const name = START[k % START.length] + END[Math.floor(k / START.length)];
      if (!taken.has(name.toLowerCase()) && !this.list.some((n) => n.toLowerCase() === name.toLowerCase())) return name;
    }
    return `${START[h % START.length]}${END[h % END.length]} ${taken.size + 1}`;
  }

  private save(now: number) {
    try {
      fs.mkdirSync(path.dirname(ASSIGN_FILE), { recursive: true });
      fs.writeFileSync(ASSIGN_FILE, JSON.stringify(Object.fromEntries(this.assignments), null, 1), 'utf8');
      this.dirty = false;
      this.lastSave = now;
    } catch (error) {
      console.error('[names] could not save assignments', error);
    }
  }
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
