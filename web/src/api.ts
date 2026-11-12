// Dashboard actions. Most only change AgentOffice's own state (names, fired workers, hidden or pinned
// projects). Missions, replies, stop and open are the explicit exceptions: they start or stop a
// Claude Code / Codex run, or open an app, and only ever when you click them.

import type { RoomId } from '../../shared/rooms.ts';
import type { MissionPermission, MissionProvider, OpenTarget } from '../../shared/types.ts';

export type Action =
  | { type: 'rename'; id: string; name: string }
  | { type: 'fire'; id: string }
  | { type: 'rehire'; id: string }
  | { type: 'removeProject'; path: string }
  | { type: 'restoreProject'; path: string }
  | {
      type: 'missionCreate';
      title?: string;
      prompt: string;
      projectPath: string;
      provider: MissionProvider;
      permission: MissionPermission;
      model?: string;
      start: boolean;
      from?: string;
      assignee?: string;
    }
  | { type: 'missionStart'; id: string; assignee?: string }
  | { type: 'missionStop'; id: string }
  | { type: 'missionRemove'; id: string }
  | { type: 'reply'; id: string; text: string; permission: MissionPermission }
  | { type: 'stop'; id: string }
  | { type: 'open'; id: string; target: OpenTarget }
  | { type: 'pin'; path: string; room: RoomId | null }
  | { type: 'peersDir'; dir: string | null };

/** Returns an error message, or null when the server accepted the action. */
export async function act(action: Action): Promise<string | null> {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentoffice': 'action' },
      body: JSON.stringify(action),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return 'Could not reach the local server.';
  }
}

export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const PERMISSION_LABEL: Record<MissionPermission, string> = {
  'read-only': 'Read-only (looks, never changes anything)',
  edit: 'Edit files in the project',
  full: 'Full access (no guard rails)',
};

export const OPEN_LABEL: Record<OpenTarget, string> = {
  'claude-app': 'Open in Claude',
  'codex-app': 'Open in Codex',
  terminal: 'Resume in a terminal',
  folder: 'Open folder',
};

/** Puts text on the clipboard; returns false when the browser refuses. */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
