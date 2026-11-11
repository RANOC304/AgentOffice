import type { AgentSnapshot, AgentStatus } from '../../shared/types.ts';

export function ago(ts: number, now = Date.now()): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function duration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'Working',
  waiting: 'Needs you',
  idle: 'Idle',
  done: 'Finished',
};

export const STATUS_ICON: Record<AgentStatus, string> = {
  working: '●',
  waiting: '!',
  idle: '◌',
  done: '✓',
};

export function shortModel(model?: string): string {
  if (!model) return '';
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export function childrenOf(agents: AgentSnapshot[], id: string): AgentSnapshot[] {
  return agents.filter((a) => a.parentId === id);
}
