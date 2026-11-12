import { useMemo } from 'react';
import { PROVIDER_META, ROOM_BY_ID, ROOMS } from '../../../shared/rooms.ts';
import type { OfficeSnapshot } from '../../../shared/types.ts';
import { clock, compact } from '../format.ts';
import { bucketize, HBars, PROVIDER_ORDER, StackedTimeline } from './charts.tsx';

export function Analytics({ snapshot }: { snapshot: OfficeSnapshot }) {
  const { agents, windowMs, generatedAt } = snapshot;

  const buckets = useMemo(
    () => bucketize(agents.map((a) => ({ provider: a.provider, pulses: a.pulses })), generatedAt, windowMs, 18),
    [agents, generatedAt, windowMs],
  );
  const totals = PROVIDER_ORDER.map((p) => ({ p, n: buckets.reduce((s, b) => s + b.values[p], 0) }));

  const roomRows = ROOMS.filter((r) => r.kind === 'desks')
    .map((r) => ({ key: r.id, label: r.short, icon: r.icon, value: agents.filter((a) => a.domain === r.id && a.status !== 'done').length }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const sum = (f: (a: (typeof agents)[number]) => number) => agents.reduce((s, a) => s + f(a), 0);
  const toolRows = [
    { key: 'edits', label: 'File edits', icon: '✏️', value: sum((a) => a.counts.edits) },
    { key: 'commands', label: 'Commands', icon: '⌨️', value: sum((a) => a.counts.commands) },
    { key: 'reads', label: 'File reads', icon: '📖', value: sum((a) => a.counts.reads) },
    { key: 'searches', label: 'Searches', icon: '🔎', value: sum((a) => a.counts.searches) },
    { key: 'browser', label: 'Neo actions', icon: '🛰️', value: sum((a) => a.counts.browser) },
    { key: 'subagents', label: 'Helpers spawned', icon: '🤝', value: sum((a) => a.counts.subagents) },
    { key: 'errors', label: 'Errors', icon: '⚠️', value: sum((a) => a.counts.errors) },
  ].sort((a, b) => b.value - a.value);

  const tokenRows = PROVIDER_ORDER.map((p) => {
    const value = agents.filter((a) => a.provider === p).reduce((s, a) => s + a.tokens.total, 0);
    return { key: p, label: PROVIDER_META[p].label, value, display: compact(value), color: PROVIDER_META[p].color };
  });

  const busiest = [...agents]
    .map((a) => ({ a, n: a.pulses.filter((t) => t > generatedAt - 3600_000).length }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, 5);

  return (
    <div className="analytics">
      <section className="panel">
        <header className="panel-head">
          <h3>Activity, last {Math.round(windowMs / 3600_000)} h</h3>
          <ul className="legend">
            {totals.map(({ p, n }) => (
              <li key={p}>
                <span className="swatch" style={{ background: PROVIDER_META[p].color }} />
                {PROVIDER_META[p].label} <b>{n}</b>
              </li>
            ))}
          </ul>
        </header>
        <StackedTimeline buckets={buckets} />
        <details className="table-view">
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr>
                <th>From</th>
                {PROVIDER_ORDER.map((p) => (
                  <th key={p}>{PROVIDER_META[p].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.start}>
                  <td>{clock(b.start)}</td>
                  {PROVIDER_ORDER.map((p) => (
                    <td key={p}>{b.values[p]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="panel">
        <h3>Where the work is</h3>
        {roomRows.length ? <HBars rows={roomRows} label="Agents per domain" /> : <p className="muted">Nobody is assigned to a domain yet.</p>}
      </section>

      <section className="panel">
        <h3>What they did (current sessions)</h3>
        <HBars rows={toolRows} label="Actions by type" />
      </section>

      <section className="panel">
        <h3>Tokens by provider</h3>
        <HBars rows={tokenRows} label="Tokens by provider" />
      </section>

      {busiest.length > 0 && (
        <section className="panel">
          <h3>Busiest in the last hour</h3>
          <HBars
            rows={busiest.map(({ a, n }) => ({ key: a.id, label: a.name, icon: ROOM_BY_ID[a.domain].icon, value: n, color: PROVIDER_META[a.provider].color }))}
            label="Busiest agents"
          />
        </section>
      )}
    </div>
  );
}
