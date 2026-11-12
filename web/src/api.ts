// Dashboard actions on AgentOffice's own state (names, fired workers, hidden projects).
// Nothing here touches the real sessions or project folders.

export type Action =
  | { type: 'rename'; id: string; name: string }
  | { type: 'fire'; id: string }
  | { type: 'rehire'; id: string }
  | { type: 'removeProject'; path: string }
  | { type: 'restoreProject'; path: string };

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
