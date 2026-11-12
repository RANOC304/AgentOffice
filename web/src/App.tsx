import { useCallback, useEffect, useState } from 'react';
import type { NeoPage } from '../../shared/types.ts';
import { Dashboard } from './dashboard/Dashboard.tsx';
import { OfficeView3D } from './office3d/OfficeView3D.tsx';
import { useOffice } from './useOffice.ts';

const NO_PAGES: NeoPage[] = [];

export function App() {
  const { snapshot, connection } = useOffice();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const select = useCallback((id: string | null, focusCamera = false) => {
    setSelectedId(id);
    if (id && focusCamera) setFocus({ id, at: Date.now() });
  }, []);

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

  const waiting = snapshot?.agents.filter((a) => a.status === 'waiting').length ?? 0;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) AgentOffice · needs you` : 'AgentOffice';
  }, [waiting]);

  return (
    <div className={`app${panelOpen ? '' : ' panel-closed'}`}>
      <main className="stage">
        <OfficeView3D agents={snapshot ? snapshot.agents : null} neoPages={snapshot?.neoPages ?? NO_PAGES} selectedId={selectedId} onSelect={(id) => select(id)} focusRequest={focus} />
        <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          {panelOpen ? 'Hide dashboard ›' : '‹ Dashboard'}
        </button>
      </main>
      {panelOpen && <Dashboard snapshot={snapshot} connection={connection} selectedId={selectedId} onSelect={select} />}
    </div>
  );
}
