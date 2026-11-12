import { useMemo, useState } from 'react';
import type { OfficeSnapshot } from '../../../shared/types.ts';
import type { Connection } from '../useOffice.ts';
import { compact } from '../format.ts';
import { AgentDetail } from './AgentDetail.tsx';
import { AgentList } from './AgentList.tsx';
import { Analytics } from './Analytics.tsx';
import { Feed } from './Feed.tsx';
import { Names } from './Names.tsx';
import { Projects } from './Projects.tsx';

type Tab = 'agents' | 'projects' | 'analytics' | 'feed' | 'names';

interface Props {
  snapshot: OfficeSnapshot | null;
  connection: Connection;
  selectedId: string | null;
  onSelect: (id: string | null, focus?: boolean) => void;
}

export function Dashboard({ snapshot, connection, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('agents');
  const agents = snapshot?.agents ?? [];
  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const kpis = useMemo(() => {
    const live = agents.filter((a) => a.status !== 'done');
    return [
      { label: 'Working', value: live.filter((a) => a.status === 'working').length, tone: 'working' },
      { label: 'Need you', value: live.filter((a) => a.status === 'waiting').length, tone: 'waiting' },
      { label: 'Idle', value: live.filter((a) => a.status === 'idle').length, tone: 'idle' },
      { label: 'Helpers', value: live.filter((a) => a.kind === 'subagent').length, tone: 'sub' },
      { label: 'In Neo', value: live.filter((a) => a.usingBrowser).length, tone: 'neo' },
      { label: 'Tokens', value: compact(agents.reduce((s, a) => s + a.tokens.total, 0)), tone: 'tokens' },
    ];
  }, [agents]);

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'agents', label: 'Agents', count: agents.length },
    { id: 'projects', label: 'Projects', count: snapshot?.projects.length },
    { id: 'analytics', label: 'Analytics' },
    { id: 'feed', label: 'Feed' },
    { id: 'names', label: 'Names' },
  ];

  return (
    <aside className="dash" aria-label="Agent dashboard">
      <header className="dash-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ▦
          </span>
          <div>
            <h1>AgentOffice</h1>
            <p className="sub">
              <span className={`conn conn-${connection}`} aria-hidden="true" />
              {connection === 'live' && `Live · ${snapshot?.host ?? 'this PC'} · read-only`}
              {connection === 'connecting' && 'Connecting to the local server…'}
              {connection === 'offline' && 'Server offline · retrying'}
              {connection === 'demo' && 'Demo data · not your sessions'}
            </p>
          </div>
        </div>
      </header>

      <section className="kpis" aria-label="Office summary">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi kpi-${k.tone}`}>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-label">{k.label}</span>
          </div>
        ))}
      </section>

      <nav className="tabs" role="tablist" aria-label="Dashboard sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab on' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </nav>

      <div className="dash-body" role="tabpanel">
        {tab === 'agents' &&
          (selected ? (
            <AgentDetail agent={selected} agents={agents} onSelect={onSelect} />
          ) : (
            <AgentList agents={agents} selectedId={selectedId} onSelect={onSelect} sources={snapshot?.sources ?? []} />
          ))}
        {tab === 'projects' && <Projects projects={snapshot?.projects ?? []} agents={agents} onSelect={onSelect} />}
        {tab === 'analytics' && snapshot && <Analytics snapshot={snapshot} />}
        {tab === 'feed' && <Feed agents={agents} onSelect={onSelect} />}
        {tab === 'names' && <Names agents={agents} demo={connection === 'demo'} />}
      </div>
    </aside>
  );
}
