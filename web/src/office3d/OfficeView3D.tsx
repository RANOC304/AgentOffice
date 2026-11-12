import { useEffect, useRef, useState } from 'react';
import type { AgentSnapshot, NeoPage } from '../../../shared/types.ts';
import { OfficeScene, type TagMode } from './scene.ts';

interface Props {
  /** null until the first snapshot arrives, so current sessions are placed directly at their desks. */
  agents: AgentSnapshot[] | null;
  neoPages: NeoPage[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusRequest: { id: string; at: number } | null;
}

export function OfficeView3D({ agents, neoPages, selectedId, onSelect, focusRequest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [tags, setTags] = useState<TagMode>('auto');
  const [follow, setFollow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scene: OfficeScene | null = null;
    // Wait for the bundled UI font so the giant screen draws with it.
    const ready = Promise.race([document.fonts.load('400 32px "Atkinson Hyperlegible"'), new Promise((r) => setTimeout(r, 1200))]);
    let cancelled = false;
    ready.finally(() => {
      if (cancelled || !ref.current) return;
      try {
        scene = new OfficeScene(ref.current, { onSelect: (id) => onSelectRef.current(id) });
        sceneRef.current = scene;
        if (agentsRef.current) scene.setData(agentsRef.current, pagesRef.current);
      } catch (e) {
        setError((e as Error).message || 'WebGL is not available');
      }
    });
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  const agentsRef = useRef(agents);
  const pagesRef = useRef(neoPages);
  agentsRef.current = agents;
  pagesRef.current = neoPages;

  useEffect(() => {
    if (agents) sceneRef.current?.setData(agents, neoPages);
  }, [agents, neoPages]);
  useEffect(() => sceneRef.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => sceneRef.current?.setTags(tags), [tags]);
  useEffect(() => sceneRef.current?.setFollow(follow), [follow]);
  useEffect(() => {
    if (focusRequest) sceneRef.current?.focus(focusRequest.id);
  }, [focusRequest]);

  return (
    <div className="office" ref={ref}>
      {error && <div className="office-loading">3D view unavailable: {error}</div>}
      <div className="office-controls" role="toolbar" aria-label="Office view controls">
        <button type="button" onClick={() => sceneRef.current?.zoom(0.75)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => sceneRef.current?.zoom(1.33)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button type="button" onClick={() => sceneRef.current?.setHome(false)} aria-label="Reset view" title="Reset the camera (double-click also works)">
          ⤢
        </button>
        <button type="button" className={follow ? 'on' : ''} aria-pressed={follow} onClick={() => setFollow((f) => !f)} title="Camera follows the selected agent">
          Follow
        </button>
        <button type="button" onClick={() => setTags((t) => (t === 'auto' ? 'all' : t === 'all' ? 'none' : 'auto'))} title="Name tags: auto hides them when zoomed far out">
          Names: {tags}
        </button>
      </div>
      <p className="office-hint">Drag to rotate · right-drag to pan · scroll to zoom · click someone</p>
    </div>
  );
}
