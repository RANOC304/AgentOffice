import { useCallback, useEffect, useRef, useState } from 'react';
import type { NeoPage } from '../../shared/types.ts';
import { NeoViewer } from './components/NeoViewer.tsx';
import { Dashboard } from './dashboard/Dashboard.tsx';
import { OfficeView3D } from './office3d/OfficeView3D.tsx';
import { useOffice } from './useOffice.ts';

const NO_PAGES: NeoPage[] = [];

export function App() {
  const { snapshot, connection } = useOffice();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [neoView, setNeoView] = useState<{ session: string | null } | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);

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

  // Drop the selection once its agent has left the office.
  useEffect(() => {
    if (selectedId && snapshot && !snapshot.agents.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [snapshot, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
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

  return (
    <div className={`app${panelOpen ? '' : ' panel-closed'}`}>
      <main className="stage">
        <OfficeView3D
          agents={snapshot ? snapshot.agents : null}
          neoPages={snapshot?.neoPages ?? NO_PAGES}
          selectedId={selectedId}
          onSelect={(id) => openAgent(id)}
          onScreen={(session) => setNeoView({ session })}
          focusRequest={focus}
        />
        <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          {panelOpen ? 'Hide dashboard ›' : '‹ Dashboard'}
        </button>
      </main>
      {panelOpen && <Dashboard snapshot={snapshot} connection={connection} selectedId={selectedId} onSelect={select} onOpenNeo={() => setNeoView({ session: null })} detailRequest={detailRequest} />}
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
