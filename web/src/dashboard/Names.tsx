import { useEffect, useState } from 'react';
import type { AgentSnapshot } from '../../../shared/types.ts';

interface NamesResponse {
  names: string[];
  file: string;
  inUse: string[];
}

/** Editable list of male first names the office gives to new characters. */
export function Names({ agents, demo }: { agents: AgentSnapshot[]; demo: boolean }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');

  useEffect(() => {
    if (demo) {
      setState('ready');
      return;
    }
    fetch('/api/names')
      .then((r) => r.json() as Promise<NamesResponse>)
      .then((d) => {
        setText(d.names.join('\n'));
        setFile(d.file);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [demo]);

  const names = text
    .split(/\r?\n/)
    .map((n) => n.trim())
    .filter(Boolean);
  const inUse = new Set(agents.map((a) => a.persona.toLowerCase()));
  const invented = agents.filter((a) => !names.some((n) => n.toLowerCase() === a.persona.toLowerCase()));

  const save = async () => {
    setState('saving');
    try {
      const res = await fetch('/api/names', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agentoffice': 'names' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { names: string[] };
      setText(d.names.join('\n'));
      setState('saved');
      setTimeout(() => setState('ready'), 1800);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="names">
      <p className="names-intro">
        Every character is a man with a first name from this list. A new session or agent gets a name nobody in the office is using; when they are all taken, the office
        invents a new one. Names are freed 30 minutes after their agent leaves.
      </p>
      <label className="names-label" htmlFor="names-list">
        One name per line · {names.length} names · {inUse.size} in use
      </label>
      <textarea id="names-list" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={14} disabled={demo || state === 'loading'} />
      <div className="names-actions">
        <button type="button" className="primary" onClick={save} disabled={demo || state === 'saving' || !names.length}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save names'}
        </button>
        {state === 'error' && <span className="attn attn-warn">Could not reach the local server.</span>}
        {demo && <span className="muted">Not editable in demo mode.</span>}
      </div>
      {file && <p className="muted names-file">Stored in {file}</p>}
      {invented.length > 0 && (
        <section>
          <h3>Invented names in use</h3>
          <p className="muted">{invented.map((a) => a.persona).join(', ')}</p>
        </section>
      )}
    </div>
  );
}
