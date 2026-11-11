import { useState } from 'react';
import { PROVIDER_META, ROOM_BY_ID } from '../../../shared/rooms.ts';
import type { AgentSnapshot, AgentStatus, Provider, SourceStatus } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { ago, STATUS_ICON, STATUS_LABEL } from '../format.ts';

interface Props {
  agents: AgentSnapshot[];
  selectedId: string | null;
  onSelect: (id: string | null, focus?: boolean) => void;
  sources: SourceStatus[];
}

const PROVIDERS: Provider[] = ['claude', 'codex', 'chatgpt'];

export function AgentList({ agents, selectedId, onSelect, sources }: Props) {
  const [providers, setProviders] = useState<Set<Provider>>(new Set(PROVIDERS));
  const [status, setStatus] = useState<AgentStatus | 'all'>('all');

  const visible = agents.filter((a) => providers.has(a.provider) && (status === 'all' || a.status === status));
  const ids = new Set(visible.map((a) => a.id));
  const roots = visible.filter((a) => !a.parentId || !ids.has(a.parentId));
  const children = (id: string) => visible.filter((a) => a.parentId === id);

  const toggle = (p: Provider) =>
    setProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p) && next.size > 1) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="agent-list">
      <div className="filters" role="group" aria-label="Filter agents">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            className={providers.has(p) ? 'chip on' : 'chip'}
            aria-pressed={providers.has(p)}
            onClick={() => toggle(p)}
          >
            <span className="swatch" style={{ background: PROVIDER_META[p].color }} />
            {PROVIDER_META[p].label}
            <span className="chip-count">{agents.filter((a) => a.provider === p).length}</span>
          </button>
        ))}
        <select value={status} onChange={(e) => setStatus(e.target.value as AgentStatus | 'all')} aria-label="Filter by status">
          <option value="all">Any status</option>
          <option value="working">Working</option>
          <option value="waiting">Needs you</option>
          <option value="idle">Idle</option>
          <option value="done">Finished</option>
        </select>
      </div>

      {!roots.length && (
        <div className="empty">
          <p className="empty-title">The office is quiet.</p>
          <p>No current Claude, Codex or ChatGPT sessions match these filters. Start a session and its character walks in within a couple of seconds.</p>
          <ul className="sources">
            {sources.map((s) => (
              <li key={s.provider}>
                <span className={s.ok ? 'ok' : 'bad'}>{s.ok ? '✓' : '✗'}</span> {s.provider === 'claude' ? 'Claude Code' : 'Codex & ChatGPT app'} · {s.message}
              </li>
            ))}
          </ul>
          <p className="hint">
            Preview a busy office with <a href="?demo">demo data</a>.
          </p>
        </div>
      )}

      <ul className="cards">
        {roots.map((agent) => (
          <li key={agent.id}>
            <AgentCard agent={agent} selected={agent.id === selectedId} onSelect={onSelect} />
            {children(agent.id).length > 0 && (
              <ul className="sub-cards">
                {children(agent.id).map((child) => (
                  <li key={child.id}>
                    <AgentCard agent={child} selected={child.id === selectedId} onSelect={onSelect} compact />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentCard({
  agent,
  selected,
  onSelect,
  compact,
}: {
  agent: AgentSnapshot;
  selected: boolean;
  onSelect: (id: string | null, focus?: boolean) => void;
  compact?: boolean;
}) {
  const room = ROOM_BY_ID[agent.room];
  return (
    <button
      type="button"
      className={`card status-${agent.status}${selected ? ' selected' : ''}${compact ? ' compact' : ''}`}
      onClick={() => onSelect(agent.id, true)}
      style={{ ['--provider' as string]: PROVIDER_META[agent.provider].color }}
    >
      <Avatar agent={agent} scale={compact ? 2 : 3} />
      <span className="card-main">
        <span className="card-top">
          <span className="card-name">
            {agent.kind === 'subagent' && <span className="sub-mark">↳ </span>}
            {agent.name}
          </span>
          <span className={`pill pill-${agent.status}`}>
            <span aria-hidden="true">{STATUS_ICON[agent.status]}</span> {STATUS_LABEL[agent.status]}
          </span>
        </span>
        <span className="card-activity">{agent.activity}</span>
        <span className="card-meta">
          <span className="prov">{agent.app}</span>
          {agent.projectName && <span>· {agent.projectName}</span>}
          <span>
            · {room.icon} {room.short}
          </span>
          <span>· {ago(agent.lastActivityAt)}</span>
        </span>
      </span>
    </button>
  );
}
