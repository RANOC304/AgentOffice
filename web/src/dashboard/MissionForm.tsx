import { useMemo, useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { AgentSnapshot, MissionPermission, MissionProvider, OfficeSnapshot } from '../../../shared/types.ts';
import { act, PERMISSION_LABEL } from '../api.ts';

export interface MissionPreset {
  title?: string;
  prompt?: string;
  projectPath?: string;
  provider?: MissionProvider;
  /** Hand-off: the worker whose result the mission builds on. */
  from?: AgentSnapshot;
  /** Give it to this idle worker. */
  assignee?: string;
}

const OTHER = '__other__';

/** New mission: a project, a provider, a permission level and the task. */
export function MissionForm({ snapshot, preset, onDone, demo }: { snapshot: OfficeSnapshot; preset?: MissionPreset; onDone: () => void; demo: boolean }) {
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of snapshot.projects) seen.set(p.path.toLowerCase(), p.path);
    for (const m of snapshot.missions) seen.set(m.projectPath.toLowerCase(), m.projectPath);
    for (const a of snapshot.agents) if (a.projectPath && !a.host) seen.set(a.projectPath.toLowerCase(), a.projectPath);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [snapshot]);
  const firstProject = preset?.projectPath ?? projects[0] ?? '';
  const [project, setProject] = useState(projects.some((p) => p.toLowerCase() === firstProject.toLowerCase()) ? firstProject : firstProject ? OTHER : projects[0] ?? OTHER);
  const [custom, setCustom] = useState(projects.some((p) => p.toLowerCase() === firstProject.toLowerCase()) ? '' : firstProject);
  const [provider, setProvider] = useState<MissionProvider>(preset?.provider ?? (snapshot.launchers['claude-code'] ? 'claude-code' : 'codex'));
  const [permission, setPermission] = useState<MissionPermission>('read-only');
  const [title, setTitle] = useState(preset?.title ?? '');
  const [prompt, setPrompt] = useState(preset?.prompt ?? '');
  const [model, setModel] = useState('');
  const [assignee, setAssignee] = useState(preset?.assignee ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idle = snapshot.agents.filter((a) => a.controls?.reply === 'resume' && a.provider === provider && a.status !== 'working' && a.id !== preset?.from?.id);
  const projectPath = project === OTHER ? custom.trim() : project;
  const available = snapshot.launchers[provider];

  const submit = async (start: boolean) => {
    if (!prompt.trim()) return setError('Describe the task first.');
    if (!projectPath) return setError('Choose a project folder.');
    if (start && permission === 'full' && !window.confirm('Full access lets the agent run any command and change any file without asking. Launch anyway?')) return;
    setBusy(true);
    const err = await act({
      type: 'missionCreate',
      title: title.trim() || undefined,
      prompt: prompt.trim(),
      projectPath,
      provider,
      permission,
      model: model.trim() || undefined,
      start,
      from: preset?.from?.id,
      assignee: assignee || undefined,
    });
    setBusy(false);
    setError(err);
    if (!err) onDone();
  };

  return (
    <form
      className="mission-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      {preset?.from && (
        <p className="handoff-note">
          Hand-off from <b>{preset.from.persona}</b> ({PROVIDER_META[preset.from.provider].label})
        </p>
      )}
      <label>
        <span>Project</span>
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p.split(/[\\/]/).pop()} — {p}
            </option>
          ))}
          <option value={OTHER}>Another folder…</option>
        </select>
      </label>
      {project === OTHER && (
        <label>
          <span>Folder</span>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="C:\\path\\to\\project" spellCheck={false} />
        </label>
      )}
      <div className="form-row">
        <label>
          <span>Worker</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as MissionProvider)}>
            <option value="claude-code" disabled={!snapshot.launchers['claude-code']}>
              Claude Code{snapshot.launchers['claude-code'] ? '' : ' (not found)'}
            </option>
            <option value="codex" disabled={!snapshot.launchers.codex}>
              Codex{snapshot.launchers.codex ? '' : ' (not found)'}
            </option>
          </select>
        </label>
        <label>
          <span>Who</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">A new worker (elevator)</option>
            {idle.map((a) => (
              <option key={a.id} value={a.id}>
                {a.persona} — continues “{a.name.slice(0, 40)}”
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>Permissions</span>
        <select value={permission} onChange={(e) => setPermission(e.target.value as MissionPermission)}>
          {(Object.keys(PERMISSION_LABEL) as MissionPermission[]).map((p) => (
            <option key={p} value={p}>
              {PERMISSION_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      {permission === 'full' && <p className="attn attn-warn">Full access: the agent can run any command and change any file without asking.</p>}
      <label>
        <span>Title (optional)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Short name for the board" />
      </label>
      <label>
        <span>Task</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={8000} placeholder="What should the worker do?" />
      </label>
      <details className="form-more">
        <summary>More options</summary>
        <label>
          <span>Model (optional)</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} placeholder={provider === 'codex' ? 'e.g. gpt-5-codex' : 'e.g. sonnet, opus'} spellCheck={false} />
        </label>
      </details>
      {error && <p className="attn attn-warn">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy || demo || !available} title={available ? 'Start now' : 'This CLI was not found on this computer'}>
          {assignee ? 'Give it to him now' : 'Launch now'}
        </button>
        <button type="button" className="ghost" disabled={busy || demo} onClick={() => void submit(false)}>
          Add to the board
        </button>
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
