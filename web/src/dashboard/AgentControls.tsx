import { useEffect, useState } from 'react';
import type { AgentSnapshot, MissionPermission, OfficeSnapshot } from '../../../shared/types.ts';
import { act, copy, OPEN_LABEL, PERMISSION_LABEL } from '../api.ts';
import type { MissionPreset } from './MissionForm.tsx';

/**
 * Reply, open in app, stop and hand off, for one worker. Replies to sessions that are not open
 * elsewhere continue them headlessly; live sessions get the text copied and their app opened.
 */
export function AgentControls({
  agent,
  snapshot,
  demo,
  onHandoff,
}: {
  agent: AgentSnapshot;
  snapshot: OfficeSnapshot | null;
  demo: boolean;
  onHandoff: (preset: MissionPreset) => void;
}) {
  const c = agent.controls;
  const [text, setText] = useState('');
  const [permission, setPermission] = useState<MissionPermission>('read-only');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  useEffect(() => {
    setText('');
    setNote(null);
  }, [agent.id]);

  if (agent.host)
    return (
      <section className="controls">
        <p className="muted">
          🖥 Runs on <b>{agent.host}</b>. Replies, stop and open work from that computer.
        </p>
      </section>
    );
  if (!c) return null;
  const mission = c.missionId ? snapshot?.missions.find((m) => m.id === c.missionId) : undefined;
  const appTarget = c.open.find((t) => t === 'claude-app' || t === 'codex-app');

  const run = async (fn: () => Promise<string | null>, ok: string) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    setNote(err ? { tone: 'warn', text: err } : { tone: 'ok', text: ok });
    return !err;
  };

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    if (c.reply === 'resume') {
      if (permission === 'full' && !window.confirm('Full access lets the agent run any command and change any file without asking. Send anyway?')) return;
      if (await run(() => act({ type: 'reply', id: agent.id, text: message, permission }), `Sent. ${agent.persona} is back at work.`)) setText('');
      return;
    }
    // Live in another app: copy the reply and open that app on the session.
    const copied = await copy(message);
    if (appTarget) await run(() => act({ type: 'open', id: agent.id, target: appTarget }), copied ? 'Reply copied. Paste it in the app that just opened.' : 'App opened. Copy your reply from the box.');
    else setNote({ tone: copied ? 'ok' : 'warn', text: copied ? 'Reply copied: paste it where the session runs.' : 'Copy your reply from the box.' });
  };

  const stop = () => {
    const what = mission?.status === 'running' ? `the mission "${mission.title}"` : `${agent.persona}'s session (its terminal process is ended; the conversation is kept)`;
    if (!window.confirm(`Stop ${what}?`)) return;
    void run(() => act({ type: 'stop', id: agent.id }), 'Stopped.');
  };

  const handoff = () => {
    const last = agent.lastMessage ? `\n\nTheir last message:\n${agent.lastMessage}` : '';
    onHandoff({
      from: agent,
      projectPath: agent.projectPath,
      provider: agent.provider === 'codex' ? 'claude-code' : 'codex',
      title: `Review ${agent.persona}'s work`,
      prompt: `${agent.persona} (${agent.provider === 'codex' ? 'Codex' : 'Claude Code'}) just worked on ${agent.projectName ?? 'this project'}: ${agent.name}.\nReview the changes in the working tree, check for bugs and say what should be fixed.${last}`,
    });
  };

  const canHandoff = agent.kind === 'session' && Boolean(agent.projectPath) && (agent.provider === 'claude-code' || agent.provider === 'codex');
  return (
    <section className="controls">
      {mission && (
        <p className="mission-chip">
          🎯 Mission <b>{mission.title}</b> · {mission.status}
          {mission.costUsd ? ` · $${mission.costUsd.toFixed(2)}` : ''}
        </p>
      )}
      {c.reply && (
        <form
          className="reply"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor={`reply-${agent.id}`}>
            Reply to {agent.persona}
          </label>
          <textarea
            id={`reply-${agent.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={agent.status === 'waiting' ? 3 : 2}
            maxLength={8000}
            placeholder={agent.status === 'waiting' ? `${agent.persona} is waiting: answer him…` : `Message ${agent.persona}…`}
          />
          <div className="reply-row">
            {c.reply === 'resume' && (
              <select value={permission} onChange={(e) => setPermission(e.target.value as MissionPermission)} aria-label="Permissions for this reply">
                {(Object.keys(PERMISSION_LABEL) as MissionPermission[]).map((p) => (
                  <option key={p} value={p}>
                    {PERMISSION_LABEL[p]}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="primary" disabled={busy || demo || !text.trim()}>
              {c.reply === 'resume' ? 'Send' : 'Copy & open app'}
            </button>
          </div>
          {c.reply === 'app' && <p className="muted small">This session is open live in its app, so the reply goes there.</p>}
        </form>
      )}
      <div className="control-buttons">
        {c.open.map((t) => (
          <button key={t} type="button" className="ghost" disabled={busy || demo} onClick={() => void run(() => act({ type: 'open', id: agent.id, target: t }), 'Opened.')}>
            {OPEN_LABEL[t]}
          </button>
        ))}
        {canHandoff && (
          <button type="button" className="ghost" disabled={demo} onClick={handoff} title="Send this worker's result to another worker, e.g. for a review">
            Hand off ↗
          </button>
        )}
        {c.canStop && (
          <button type="button" className="danger" disabled={busy || demo} onClick={stop}>
            Stop
          </button>
        )}
      </div>
      {note && <p className={note.tone === 'ok' ? 'note-ok' : 'attn attn-warn'}>{note.text}</p>}
    </section>
  );
}
