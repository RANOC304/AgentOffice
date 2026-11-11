import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { clock } from '../format.ts';
import { KIND_ICON } from './AgentDetail.tsx';

export function Feed({ agents, onSelect }: { agents: AgentSnapshot[]; onSelect: (id: string | null, focus?: boolean) => void }) {
  const events = agents
    .flatMap((a) => a.recent.map((e) => ({ ...e, agent: a })))
    .sort((x, y) => y.at - x.at)
    .slice(0, 150);
  if (!events.length) return <div className="empty">Nothing has happened yet.</div>;
  return (
    <ol className="feed">
      {events.map((e, i) => (
        <li key={`${e.agent.id}-${e.at}-${i}`} className={`ev ev-${e.kind}`}>
          <span className="ev-time">{clock(e.at)}</span>
          <span className="ev-icon" aria-hidden="true">
            {KIND_ICON[e.kind]}
          </span>
          <span className="ev-label">
            <button type="button" className="feed-who" onClick={() => onSelect(e.agent.id, true)} style={{ color: PROVIDER_META[e.agent.provider].light }}>
              {e.agent.name}
            </button>
            {e.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
