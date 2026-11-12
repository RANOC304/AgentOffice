import { useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { Mission, MissionStatus, OfficeSnapshot } from '../../../shared/types.ts';
import { act } from '../api.ts';
import { ago, duration } from '../format.ts';
import { MissionForm, type MissionPreset } from './MissionForm.tsx';

const COLUMNS: Array<{ id: string; label: string; statuses: MissionStatus[] }> = [
  { id: 'todo', label: 'To do', statuses: ['todo'] },
  { id: 'running', label: 'In progress', statuses: ['running'] },
  { id: 'done', label: 'Done', statuses: ['done', 'failed', 'stopped'] },
];

const STATUS_TEXT: Record<MissionStatus, string> = { todo: 'To do', running: 'Running', done: 'Done', failed: 'Failed', stopped: 'Stopped' };

/** Mission board: a backlog per project, launched as headless runs or given to idle workers. */
export function Missions({
  snapshot,
  onSelect,
  demo,
  preset,
  onPresetUsed,
}: {
  snapshot: OfficeSnapshot;
  onSelect: (id: string | null, focus?: boolean) => void;
  demo: boolean;
  preset: MissionPreset | null;
  onPresetUsed: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState('');
  const open = composing || preset !== null;
  const close = () => {
    setComposing(false);
    onPresetUsed();
  };
  const projects = [...new Set(snapshot.missions.map((m) => m.projectName))].sort();
  const missions = snapshot.missions.filter((m) => !filter || m.projectName === filter);

  return (
    <div className="missions">
      {open ? (
        <section className="card-block">
          <h3>{preset?.from ? `Hand off ${preset.from.persona}'s work` : 'New mission'}</h3>
          <MissionForm key={preset ? `p${preset.from?.id ?? ''}${preset.prompt?.length ?? 0}` : 'new'} snapshot={snapshot} preset={preset ?? undefined} onDone={close} demo={demo} />
        </section>
      ) : (
        <div className="missions-bar">
          <button type="button" className="primary" onClick={() => setComposing(true)} disabled={demo}>
            + New mission
          </button>
          {projects.length > 1 && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Project">
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {!snapshot.launchers['claude-code'] && !snapshot.launchers.codex && !demo && (
        <p className="muted">Neither the Claude Code nor the Codex command-line tool was found, so missions can be planned but not launched.</p>
      )}
      {COLUMNS.map((col) => {
        const list = missions.filter((m) => col.statuses.includes(m.status));
        return (
          <section key={col.id} className={`mission-col col-${col.id}`}>
            <h3>
              {col.label} <span className="tab-count">{list.length}</span>
            </h3>
            {!list.length && <p className="muted small">{col.id === 'todo' ? 'Nothing planned.' : col.id === 'running' ? 'No mission running.' : 'Nothing finished yet.'}</p>}
            <ul className="mission-list">
              {list.map((m) => (
                <MissionCard key={m.id} mission={m} snapshot={snapshot} onSelect={onSelect} demo={demo} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MissionCard({ mission: m, snapshot, onSelect, demo }: { mission: Mission; snapshot: OfficeSnapshot; onSelect: (id: string | null, focus?: boolean) => void; demo: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const worker = m.agentId ? snapshot.agents.find((a) => a.id === m.agentId) : undefined;
  const idle = snapshot.agents.filter((a) => a.controls?.reply === 'resume' && a.provider === m.provider && a.status !== 'working');
  const run = async (fn: () => Promise<string | null>) => setError(await fn());
  const now = Date.now();
  return (
    <li className={`mission m-${m.status}`} style={{ ['--provider' as string]: PROVIDER_META[m.provider].color }}>
      <div className="mission-head">
        <span className="swatch" style={{ background: PROVIDER_META[m.provider].color }} title={PROVIDER_META[m.provider].label} />
        <b className="mission-title">{m.title}</b>
        <span className={`mission-status s-${m.status}`}>{STATUS_TEXT[m.status]}</span>
      </div>
      <p className="mission-meta">
        {m.projectName} · {m.permission}
        {m.from && ` · from ${m.from.persona}`}
        {m.status === 'running' && m.startedAt && ` · ${duration(now - m.startedAt)}`}
        {m.endedAt && m.status !== 'running' && ` · ${ago(m.endedAt)}`}
        {m.costUsd ? ` · $${m.costUsd.toFixed(2)}` : ''}
        {m.runs > 1 && ` · run ${m.runs}`}
      </p>
      {worker && (
        <button type="button" className="mission-worker" onClick={() => onSelect(worker.id, true)}>
          👷 {worker.persona} · {worker.activity}
        </button>
      )}
      {m.result && <p className="quote reply small">{m.result}</p>}
      {m.error && <p className="attn attn-warn">{m.error}</p>}
      <button type="button" className="link" onClick={() => setShowPrompt((s) => !s)}>
        {showPrompt ? 'Hide task' : 'Show task'}
      </button>
      {showPrompt && <p className="quote small">{m.prompt}</p>}
      <div className="mission-actions">
        {m.status === 'running' ? (
          <button
            type="button"
            className="danger"
            disabled={demo}
            onClick={() => window.confirm(`Stop "${m.title}"? The run is interrupted; its conversation is kept.`) && void run(() => act({ type: 'missionStop', id: m.id }))}
          >
            Stop
          </button>
        ) : (
          <>
            {m.status === 'todo' && !m.resume && idle.length > 0 && (
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Who takes it">
                <option value="">New worker</option>
                {idle.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.persona}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="primary"
              disabled={demo || !snapshot.launchers[m.provider]}
              onClick={() => {
                if (m.permission === 'full' && !window.confirm('This mission has full access (no guard rails). Start it?')) return;
                void run(() => act({ type: 'missionStart', id: m.id, assignee: assignee || undefined }));
              }}
            >
              {m.status === 'todo' ? 'Start' : 'Run again'}
            </button>
            <button type="button" className="ghost" disabled={demo} onClick={() => window.confirm(`Delete "${m.title}" from the board?`) && void run(() => act({ type: 'missionRemove', id: m.id }))}>
              Delete
            </button>
          </>
        )}
      </div>
      {error && <p className="attn attn-warn">{error}</p>}
    </li>
  );
}
