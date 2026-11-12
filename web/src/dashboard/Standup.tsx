import { useEffect, useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import { copy, getJson } from '../api.ts';
import { clock, compact } from '../format.ts';

interface StandupProject {
  name: string;
  path?: string;
  workers: Array<{ persona: string; provider: keyof typeof PROVIDER_META; name: string; host?: string; from: number; to: number }>;
  tokens: number;
  edits: number;
  commands: number;
  errors: number;
  prs: number;
  files: string[];
  commits: Array<{ hash: string; subject: string; at: number }>;
  missions: Array<{ title: string; status: string }>;
}

interface Report {
  day: string;
  generatedAt: number;
  projects: StandupProject[];
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function markdown(r: Report): string {
  const out = [`# Standup — ${r.day}`, ''];
  if (!r.projects.length) out.push('No agent activity recorded.');
  for (const p of r.projects) {
    out.push(`## ${p.name}`);
    const who = p.workers.map((w) => `${w.persona} (${PROVIDER_META[w.provider]?.label ?? w.provider}${w.host ? ` @${w.host}` : ''})`).join(', ');
    if (who) out.push(`- Workers: ${who}`);
    out.push(`- ${p.commits.length} commit${p.commits.length === 1 ? '' : 's'}, ${p.edits} edits, ${p.commands} commands, ${p.prs} PR action${p.prs === 1 ? '' : 's'}, ${p.errors} errors, ${compact(p.tokens)} tokens`);
    for (const c of p.commits.slice(0, 12)) out.push(`  - \`${c.hash}\` ${c.subject}`);
    if (p.missions.length) out.push(`- Missions: ${p.missions.map((m) => `${m.title} (${m.status})`).join('; ')}`);
    if (p.files.length) out.push(`- Files: ${p.files.slice(0, 12).join(', ')}${p.files.length > 12 ? '…' : ''}`);
    if (p.errors) out.push(`- Needs a look: ${p.errors} error${p.errors > 1 ? 's' : ''} during the day`);
    out.push('');
  }
  return out.join('\n');
}

/** Daily standup per project: files, commits, PRs, errors and missions, exportable as Markdown. */
export function Standup({ demo }: { demo: boolean }) {
  const [days, setDays] = useState<string[]>([today()]);
  const [day, setDay] = useState(today());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (demo) return;
    void getJson<{ days: string[] }>('/api/replay/days').then((r) => {
      if (r?.days.length) setDays([...new Set([today(), ...r.days])]);
    });
  }, [demo]);
  useEffect(() => {
    if (demo) return;
    setLoading(true);
    void getJson<Report>(`/api/standup?day=${day}`).then((r) => {
      setReport(r);
      setLoading(false);
    });
  }, [day, demo]);

  if (demo) return <div className="empty">The standup is built from your real sessions, so it is not available in demo mode.</div>;
  const md = report ? markdown(report) : '';
  const download = () => {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `standup-${day}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="standup">
      <div className="missions-bar">
        <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
          {days.map((d) => (
            <option key={d} value={d}>
              {d === today() ? `Today (${d})` : d}
            </option>
          ))}
        </select>
        <button type="button" className="ghost" disabled={!report} onClick={() => void copy(md).then((ok) => setNote(ok ? 'Copied as Markdown.' : 'Copy failed.'))}>
          Copy
        </button>
        <button type="button" className="ghost" disabled={!report} onClick={download}>
          Download .md
        </button>
        {note && <span className="note-ok">{note}</span>}
      </div>
      {loading && <p className="muted">Building the report…</p>}
      {report && !report.projects.length && <div className="empty">Nothing recorded for this day yet. The office records activity while it runs.</div>}
      {report?.projects.map((p) => (
        <section key={p.path ?? p.name} className="standup-project">
          <h3 title={p.path}>{p.name}</h3>
          <p className="standup-stats">
            <span>
              <b>{p.commits.length}</b> commits
            </span>
            <span>
              <b>{p.edits}</b> edits
            </span>
            <span>
              <b>{p.commands}</b> commands
            </span>
            <span>
              <b>{p.prs}</b> PR actions
            </span>
            <span className={p.errors ? 'bad' : ''}>
              <b>{p.errors}</b> errors
            </span>
            <span>
              <b>{compact(p.tokens)}</b> tokens
            </span>
          </p>
          {p.workers.length > 0 && (
            <p className="standup-workers">
              {p.workers.map((w) => (
                <span key={w.persona + w.from} className="who-chip" style={{ ['--c' as string]: PROVIDER_META[w.provider]?.color ?? '#888' }} title={w.name}>
                  {w.persona}
                  {w.host ? ` @${w.host}` : ''} · {clock(w.from)}–{clock(w.to)}
                </span>
              ))}
            </p>
          )}
          {p.commits.length > 0 && (
            <ul className="commits">
              {p.commits.slice(0, 12).map((c) => (
                <li key={c.hash}>
                  <code>{c.hash}</code> {c.subject}
                </li>
              ))}
            </ul>
          )}
          {p.missions.length > 0 && <p className="muted small">Missions: {p.missions.map((m) => `${m.title} (${m.status})`).join(' · ')}</p>}
          {p.files.length > 0 && (
            <p className="muted small">
              Files: {p.files.slice(0, 14).join(', ')}
              {p.files.length > 14 ? '…' : ''}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
