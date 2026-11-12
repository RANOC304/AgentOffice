import { DOMAIN_ROOMS, PROVIDER_META, ROOM_BY_ID, type RoomId } from '../../../shared/rooms.ts';
import type { AgentSnapshot, ProjectSummary } from '../../../shared/types.ts';
import { Avatar } from '../components/Avatar.tsx';
import { act } from '../api.ts';
import { ago } from '../format.ts';

export function Projects({
  projects,
  removed,
  pins,
  agents,
  onSelect,
  demo,
}: {
  projects: ProjectSummary[];
  removed: Array<{ path: string; name: string; removedAt: number }>;
  pins: Array<{ path: string; room: RoomId }>;
  agents: AgentSnapshot[];
  onSelect: (id: string | null, focus?: boolean) => void;
  demo: boolean;
}) {
  const remove = async (p: ProjectSummary) => {
    const ok = window.confirm(
      `Remove ${p.name} from the office?

Only AgentOffice forgets it: nothing on disk changes. It comes back automatically when a worker starts new work there.`,
    );
    if (!ok) return;
    const err = await act({ type: 'removeProject', path: p.path });
    if (err) window.alert(err);
  };
  const removedList = removed.length > 0 && (
    <details className="fired">
      <summary>Removed projects ({removed.length})</summary>
      <p className="muted">Hidden from the office only. Each comes back by itself when a worker starts new work there.</p>
      <ul>
        {removed.map((r) => (
          <li key={r.path}>
            <span className="fired-name" title={r.path}>
              <b>{r.name}</b>
            </span>
            <span className="muted">{ago(r.removedAt)}</span>
            <button type="button" className="ghost" onClick={() => void act({ type: 'restoreProject', path: r.path })}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
  if (!projects.length)
    return (
      <>
        <div className="empty">No project has an active session right now.</div>
        {removedList}
      </>
    );
  return (
    <>
    <ul className="projects">
      {projects.map((p) => {
        const mine = agents.filter((a) => p.agents.includes(a.id));
        const alert = p.waiting > 0 || p.attention.some((a) => a.level === 'alert');
        const warn = !alert && p.attention.some((a) => a.level === 'warn');
        return (
          <li key={p.path} className={`project${alert ? ' alert' : warn ? ' warn' : ''}`}>
            <div className="project-head">
              <h3 title={p.path}>{p.name}</h3>
              <button type="button" className="icon-btn remove" title={demo ? 'Not available in demo mode' : 'Remove from the office (nothing on disk changes)'} onClick={() => void remove(p)} disabled={demo}>
                🗑
              </button>
              <span className="project-providers">
                {p.providers.map((prov) => (
                  <span key={prov} className="swatch" title={PROVIDER_META[prov].label} style={{ background: PROVIDER_META[prov].color }} />
                ))}
              </span>
            </div>
            <label className="pin">
              <span aria-hidden="true">📌</span>
              <select
                value={pins.find((x) => x.path.toLowerCase() === p.path.toLowerCase())?.room ?? ''}
                disabled={demo}
                aria-label={`Room for ${p.name}`}
                title="Pin this project to a room: its workers sit there"
                onChange={(e) => void act({ type: 'pin', path: p.path, room: (e.target.value || null) as RoomId | null }).then((err) => err && window.alert(err))}
              >
                <option value="">Room: automatic</option>
                {DOMAIN_ROOMS.map((r) => (
                  <option key={r} value={r}>
                    {ROOM_BY_ID[r].icon} {ROOM_BY_ID[r].label}
                  </option>
                ))}
              </select>
            </label>
            <p className="project-meta">
              {p.working} working · {p.waiting} need you · active {ago(p.lastActivityAt)}
              {p.git?.branch && ` · ⎇ ${p.git.branch}`}
              {p.git && ` · ${p.git.dirty} uncommitted`}
            </p>
            {p.attention.length > 0 && (
              <ul className="project-attn">
                {p.attention.slice(0, 4).map((a, i) => (
                  <li key={i} className={`attn attn-${a.level}`}>
                    {a.level === 'alert' ? '⚠ ' : a.level === 'warn' ? '● ' : '· '}
                    {a.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="project-agents">
              {mine.map((a) => (
                <button key={a.id} type="button" className="mini-agent" title={`${a.persona} · ${a.name} · ${a.activity}`} onClick={() => onSelect(a.id, true)}>
                  <Avatar agent={a} size={34} />
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
    {removedList}
    </>
  );
}
