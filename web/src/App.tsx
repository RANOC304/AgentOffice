import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NeoPage } from '../../shared/types.ts';
import { useAlerts } from './alerts.ts';
import { getJson } from './api.ts';
import { NeoViewer } from './components/NeoViewer.tsx';
import { Dashboard } from './dashboard/Dashboard.tsx';
import { OfficeView3D } from './office3d/OfficeView3D.tsx';
import { ReplayBar, type ReplayState } from './office3d/ReplayBar.tsx';
import { agentsAt, indexReplay, type ReplayData, type ReplayIndex } from './replay.ts';
import { useOffice } from './useOffice.ts';

const NO_PAGES: NeoPage[] = [];
/** A jump in the replay longer than this rebuilds the office instead of walking everyone over. */
const JUMP_MS = 2 * 60_000;

export function App() {
  const { snapshot, connection } = useOffice();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [neoView, setNeoView] = useState<{ session: string | null } | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);
  const [replay, setReplay] = useState<{ state: ReplayState; index: ReplayIndex } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const select = useCallback((id: string | null, focusCamera = false) => {
    setSelectedId(id);
    if (id && focusCamera) setFocus({ id, at: Date.now() });
  }, []);

  /** Clicking someone in the office shows his details, reopening the dashboard if it was hidden. */
  const openAgent = useCallback(
    (id: string | null, focusCamera = false) => {
      select(id, focusCamera);
      if (!id) return;
      setPanelOpen(true);
      setDetailRequest((n) => n + 1);
    },
    [select],
  );

  const alerts = useAlerts(snapshot, connection === 'live', (id) => openAgent(id, true));

  // Drop the selection once its agent has left the office.
  useEffect(() => {
    if (!replay && selectedId && snapshot && !snapshot.agents.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [snapshot, selectedId, replay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
      // T opens and closes the dashboard (except while typing in a field).
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
        setPanelOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Full screen shows the office alone; the dashboard comes back afterwards.
  const panelBefore = useRef(true);
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) {
        setPanelOpen((open) => {
          panelBefore.current = open;
          return false;
        });
      } else setPanelOpen(panelBefore.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const waiting = snapshot?.agents.filter((a) => a.status === 'waiting').length ?? 0;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) AgentOffice · needs you` : 'AgentOffice';
  }, [waiting]);

  // ------------------------------------------------------------------ replay

  const loadReplay = async (day?: string) => {
    const days = (await getJson<{ days: string[] }>('/api/replay/days'))?.days ?? [];
    const d = day ?? days[0];
    const data = d ? await getJson<ReplayData>(`/api/replay?day=${d}`) : null;
    const index = data ? indexReplay(data) : null;
    if (!d || !index) {
      setNotice('Nothing recorded yet: the office records the day while it runs.');
      setTimeout(() => setNotice(null), 5000);
      return;
    }
    const t = Math.max(index.start, index.end - 30 * 60_000);
    setReplay({ index, state: { day: d, days: days.length ? days : [d], start: index.start, end: index.end, t, playing: true, speed: 10 } });
    setSelectedId(null);
    setResetKey((k) => k + 1);
  };
  const exitReplay = () => {
    setReplay(null);
    setSelectedId(null);
    setResetKey((k) => k + 1);
  };
  const playing = replay?.state.playing ?? false;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setReplay((r) => {
        if (!r) return r;
        const t = Math.min(r.state.end, r.state.t + 250 * r.state.speed);
        return { ...r, state: { ...r.state, t, playing: t < r.state.end } };
      });
    }, 250);
    return () => clearInterval(timer);
  }, [playing]);
  const seek = (t: number) => {
    if (!replay) return;
    if (Math.abs(t - replay.state.t) > JUMP_MS) setResetKey((k) => k + 1);
    setReplay({ ...replay, state: { ...replay.state, t } });
  };
  const replayAgents = useMemo(() => (replay ? agentsAt(replay.index, replay.state.t) : null), [replay]);

  const officeAgents = replay ? replayAgents : snapshot ? snapshot.agents : null;
  const pins = useMemo(() => (snapshot?.pins ?? []).map((p) => ({ room: p.room, name: p.path.split(/[\\/]/).pop() ?? p.path })), [snapshot?.pins]);

  return (
    <div className={`app${panelOpen ? '' : ' panel-closed'}`}>
      <main className="stage">
        <OfficeView3D
          agents={officeAgents}
          neoPages={replay ? NO_PAGES : (snapshot?.neoPages ?? NO_PAGES)}
          selectedId={selectedId}
          onSelect={(id) => (replay ? select(id) : openAgent(id))}
          onScreen={(session) => setNeoView({ session })}
          focusRequest={focus}
          resetKey={resetKey}
          missions={replay ? undefined : snapshot?.missions}
          pins={pins}
          replaying={Boolean(replay)}
          replayTime={replay?.state.t}
          onReplay={() => (replay ? exitReplay() : void loadReplay())}
        />
        {replay && (
          <ReplayBar
            state={replay.state}
            onSeek={seek}
            onPlay={(p) => setReplay({ ...replay, state: { ...replay.state, playing: p && replay.state.t < replay.state.end } })}
            onSpeed={(s) => setReplay({ ...replay, state: { ...replay.state, speed: s } })}
            onDay={(d) => void loadReplay(d)}
            onExit={exitReplay}
          />
        )}
        {(alerts.length > 0 || notice) && (
          <div className="toasts" role="status" aria-live="polite">
            {notice && <div className="toast">{notice}</div>}
            {alerts.map((a) => (
              <button key={a.id} type="button" className={`toast${a.urgent ? ' urgent' : ''}`} onClick={() => a.agentId && openAgent(a.agentId, true)}>
                <b>{a.title}</b>
                <span>{a.body}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} title="Open or close the dashboard (T)">
          {panelOpen ? 'Hide dashboard ›' : '‹ Dashboard'}
        </button>
      </main>
      {panelOpen && <Dashboard snapshot={snapshot} connection={connection} selectedId={replay ? null : selectedId} onSelect={select} onOpenNeo={() => setNeoView({ session: null })} detailRequest={detailRequest} />}
      {neoView && (
        <NeoViewer
          pages={snapshot?.neoPages ?? NO_PAGES}
          agents={snapshot?.agents ?? []}
          initialSession={neoView.session}
          onClose={() => setNeoView(null)}
          onSelectAgent={(id) => {
            setNeoView(null);
            openAgent(id, true);
          }}
        />
      )}
    </div>
  );
}
