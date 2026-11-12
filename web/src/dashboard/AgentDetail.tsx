import { useEffect, useState } from 'react';
import { PROVIDER_META, ROOM_BY_ID } from '../../../shared/rooms.ts';
import { act } from '../api.ts';
import type { ActivityKind, AgentSnapshot } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { ago, childrenOf, clock, compact, duration, shortModel, STATUS_ICON, STATUS_LABEL } from '../format.ts';
import { AgentCard } from './AgentList.tsx';
import { HBars, Sparkline } from './charts.tsx';

const KIND_ICON: Record<ActivityKind, string> = {
  prompt: '📝',
  message: '💬',
  thinking: '💭',
  edit: '✏️',
  read: '📖',
  command: '⌨️',
  search: '🔎',
  web: '🌐',
  browser: '🛰️',
  mcp: '🔌',
  subagent: '🤝',
  error: '⚠️',
  tool: '🧰',
};

export function AgentDetail({
  agent,
  agents,
  onSelect,
  demo,
}: {
  agent: AgentSnapshot;
  agents: AgentSnapshot[];
  onSelect: (id: string | null, focus?: boolean) => void;
  demo: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(agent.persona);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEditing(false);
    setError(null);
    setDraft(agent.persona);
  }, [agent.id, agent.persona]);

  const rename = async () => {
    const name = draft.trim();
    if (!name || name === agent.persona) return setEditing(false);
    setBusy(true);
    const err = await act({ type: 'rename', id: agent.id, name });
    setBusy(false);
    setError(err);
    if (!err) setEditing(false);
  };
  const fire = async () => {
    const kids = agents.filter((a) => a.parentId === agent.id).length;
    const ok = window.confirm(
      `Fire ${agent.persona}? He will take the elevator out of the office${kids ? ` with his ${kids} helper${kids > 1 ? 's' : ''}` : ''}.

The real session is not touched; he comes back if you give that session a new task.`,
    );
    if (!ok) return;
    setBusy(true);
    const err = await act({ type: 'fire', id: agent.id });
    setBusy(false);
    setError(err);
  };

  const meta = PROVIDER_META[agent.provider];
  const room = ROOM_BY_ID[agent.room];
  const domain = ROOM_BY_ID[agent.domain];
  const parent = agent.parentId ? agents.find((a) => a.id === agent.parentId) : undefined;
  const kids = childrenOf(agents, agent.id);
  const now = Date.now();
  const stats: Array<[string, string]> = [
    ['Tokens', compact(agent.tokens.total)],
    ['Output', compact(agent.tokens.output)],
    ['Tool calls', String(agent.counts.tools)],
    ['Edits', String(agent.counts.edits)],
    ['Commands', String(agent.counts.commands)],
    ['Searches', String(agent.counts.searches)],
    ['Neo actions', String(agent.counts.browser)],
    ['Helpers', String(agent.counts.subagents)],
    ['Errors', String(agent.counts.errors)],
    ['Uptime', duration(now - agent.startedAt)],
  ];

  return (
    <div className="detail" style={{ ['--provider' as string]: meta.color }}>
      <button type="button" className="back" onClick={() => onSelect(null)}>
        ← All agents
      </button>
      <div className="detail-head">
        <Avatar agent={agent} size={72} />
        <div>
          {editing ? (
            <form
              className="rename"
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={30} autoFocus aria-label="New name" />
              <button type="submit" className="primary" disabled={busy}>
                Save
              </button>
              <button type="button" className="ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h2>
              {agent.persona}
              <button type="button" className="icon-btn" title={demo ? 'Not available in demo mode' : 'Rename this character'} onClick={() => setEditing(true)} disabled={demo}>
                ✎
              </button>
            </h2>
          )}
          <p className="detail-session">{agent.kind === 'subagent' ? '↳ ' : ''}{agent.name}</p>
          <p className="detail-sub">
            <span className="swatch" style={{ background: meta.color }} /> {meta.label} · {agent.app}
            {agent.model && ` · ${shortModel(agent.model)}`}
          </p>
          <p className="detail-sub">
            {agent.projectName ?? 'No project'}
            {agent.branch && ` · ⎇ ${agent.branch}`}
          </p>
        </div>
      </div>

      <div className="detail-actions">
        <button type="button" className="danger" onClick={fire} disabled={demo || busy} title={demo ? 'Not available in demo mode' : 'Send him out through the elevator'}>
          Fire {agent.persona}
        </button>
        {error && <span className="attn attn-warn">{error}</span>}
      </div>

      <div className={`now now-${agent.status}`}>
        <span className={`pill pill-${agent.status}`}>
          <span aria-hidden="true">{STATUS_ICON[agent.status]}</span> {STATUS_LABEL[agent.status]}
        </span>
        <span className="now-text">{agent.activity}</span>
        <span className="now-room">
          {room.icon} In the {room.label}
          {agent.room !== agent.domain && ` · work is ${domain.short}`} · active {ago(agent.lastActivityAt)}
        </span>
        {agent.attention && agent.attention.level !== 'info' && <span className={`attn attn-${agent.attention.level}`}>{agent.attention.reason}</span>}
      </div>

      <Sparkline pulses={agent.pulses} now={now} windowMs={3 * 3600_000} color={meta.color} />

      <dl className="stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {agent.lastPrompt && (
        <section>
          <h3>Last task from you</h3>
          <p className="quote">{agent.lastPrompt}</p>
        </section>
      )}
      {agent.lastMessage && (
        <section>
          <h3>Latest reply</h3>
          <p className="quote reply">{agent.lastMessage}</p>
        </section>
      )}

      {parent && (
        <section>
          <h3>Working for</h3>
          <AgentCard agent={parent} selected={false} onSelect={onSelect} compact />
        </section>
      )}
      {kids.length > 0 && (
        <section>
          <h3>Helpers ({kids.length})</h3>
          {kids.map((k) => (
            <AgentCard key={k.id} agent={k} selected={false} onSelect={onSelect} compact />
          ))}
        </section>
      )}

      {agent.topTools.length > 0 && (
        <section>
          <h3>Most used tools</h3>
          <HBars rows={agent.topTools.map((t) => ({ key: t.name, label: t.name, value: t.count }))} color={meta.color} label="Most used tools" />
        </section>
      )}

      {agent.filesTouched.length > 0 && (
        <section>
          <h3>Files changed</h3>
          <ul className="files">
            {agent.filesTouched.map((f) => (
              <li key={f} title={f}>
                {f.split(/[\\/]/).slice(-2).join('/')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Recent activity</h3>
        <ol className="timeline">
          {agent.recent.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`ev ev-${e.kind}`}>
              <span className="ev-time">{clock(e.at)}</span>
              <span className="ev-icon" aria-hidden="true">
                {KIND_ICON[e.kind]}
              </span>
              <span className="ev-label">
                {e.label}
                {e.detail && e.kind !== 'edit' && <span className="ev-detail">{e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export { KIND_ICON };
