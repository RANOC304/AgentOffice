import { useEffect, useMemo, useState } from 'react';
import type { OfficeSnapshot } from '../../../shared/types.ts';
import type { Connection } from '../useOffice.ts';
import { compact } from '../format.ts';
import { AgentDetail } from './AgentDetail.tsx';
import { AgentList } from './AgentList.tsx';
import { Analytics } from './Analytics.tsx';
import { Feed } from './Feed.tsx';
import type { MissionPreset } from './MissionForm.tsx';
import { Missions } from './Missions.tsx';
import { Projects } from './Projects.tsx';
import { Settings } from './Settings.tsx';
import { Standup } from './Standup.tsx';
import { UsagePanel, worstGauge } from './Usage.tsx';

type Tab = 'agents' | 'missions' | 'projects' | 'analytics' | 'standup' | 'feed' | 'settings';

interface Props {
  snapshot: OfficeSnapshot | null;
  connection: Connection;
  selectedId: string | null;
  onSelect: (id: string | null, focus?: boolean) => void;
  onOpenNeo: () => void;
  /** Bumped when an agent is clicked in the office: show the Agents tab with his details. */
  detailRequest: number;
}

export function Dashboard({ snapshot, connection, selectedId, onSelect, onOpenNeo, detailRequest }: Props) {
  const [tab, setTab] = useState<Tab>('agents');
  const [preset, setPreset] = useState<MissionPreset | null>(null);
  useEffect(() => {
    if (detailRequest) setTab('agents');
  }, [detailRequest]);
  const demo = connection === 'demo';
  const handoff = (p: MissionPreset) => {
    setPreset(p);
    setTab('missions');
  };
  const limit = worstGauge(snapshot?.usage);
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

  const running = snapshot?.missions.filter((m) => m.status === 'running' || m.status === 'todo').length ?? 0;
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'agents', label: 'Agents', count: agents.length },
    { id: 'missions', label: 'Missions', count: running || undefined },
    { id: 'projects', label: 'Projects', count: snapshot?.projects.length },
    { id: 'analytics', label: 'Usage' },
    { id: 'standup', label: 'Standup' },
    { id: 'feed', label: 'Feed' },
    { id: 'settings', label: 'Settings' },
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
              {connection === 'live' && `Live · ${snapshot?.host ?? 'this PC'}${snapshot?.peers.list.some((p) => p.online) ? ` + ${snapshot.peers.list.filter((p) => p.online).map((p) => p.host).join(', ')}` : ''}`}
              {connection === 'connecting' && 'Connecting to the local server…'}
              {connection === 'offline' && 'Server offline · retrying'}
              {connection === 'demo' && 'Demo data · not your sessions'}
            </p>
          </div>
        </div>
        {limit && (
          <button type="button" className={`limit-chip ${limit.usedPercent >= 95 ? 'alert' : 'warn'}`} onClick={() => setTab('analytics')} title="Plan usage">
            ⚠ {limit.plan} {limit.label.toLowerCase()} {Math.round(limit.usedPercent)}%
          </button>
        )}
      </header>

      <section className="kpis" aria-label="Office summary">
        {kpis.map((k) =>
          k.tone === 'neo' ? (
            <button key={k.label} type="button" className={`kpi kpi-${k.tone} kpi-button`} onClick={onOpenNeo} title="See every BrowserOS neo tab">
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-label">{k.label} · tabs ›</span>
            </button>
          ) : (
            <div key={k.label} className={`kpi kpi-${k.tone}`}>
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-label">{k.label}</span>
            </div>
          ),
        )}
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
            <AgentDetail agent={selected} agents={agents} snapshot={snapshot} onSelect={onSelect} demo={demo} onHandoff={handoff} />
          ) : (
            <AgentList agents={agents} selectedId={selectedId} onSelect={onSelect} sources={snapshot?.sources ?? []} fired={snapshot?.fired ?? []} />
          ))}
        {tab === 'missions' && snapshot && <Missions snapshot={snapshot} onSelect={onSelect} demo={demo} preset={preset} onPresetUsed={() => setPreset(null)} />}
        {tab === 'projects' && (
          <Projects projects={snapshot?.projects ?? []} removed={snapshot?.removedProjects ?? []} pins={snapshot?.pins ?? []} agents={agents} onSelect={onSelect} demo={demo} />
        )}
        {tab === 'analytics' && snapshot && (
          <>
            <UsagePanel usage={snapshot.usage} />
            <Analytics snapshot={snapshot} />
          </>
        )}
        {tab === 'standup' && <Standup demo={demo} />}
        {tab === 'feed' && <Feed agents={agents} onSelect={onSelect} />}
        {tab === 'settings' && <Settings snapshot={snapshot} agents={agents} demo={demo} />}
      </div>
    </aside>
  );
}
