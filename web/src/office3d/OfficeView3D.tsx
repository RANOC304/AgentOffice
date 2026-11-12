import { useEffect, useRef, useState } from 'react';
import type { AgentSnapshot, NeoPage } from '../../../shared/types.ts';
import { type CameraMode, OfficeScene, type TagMode } from './scene.ts';

interface Props {
  /** null until the first snapshot arrives, so current sessions are placed directly at their desks. */
  agents: AgentSnapshot[] | null;
  neoPages: NeoPage[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onScreen: (sessionId: string | null) => void;
  focusRequest: { id: string; at: number } | null;
}

function readAutoIdle(): boolean {
  try {
    return localStorage.getItem('agentoffice.autoIdle') !== 'off';
  } catch {
    return true;
  }
}

export function OfficeView3D({ agents, neoPages, selectedId, onSelect, onScreen, focusRequest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const agentsRef = useRef(agents);
  const pagesRef = useRef(neoPages);
  const onSelectRef = useRef(onSelect);
  const onScreenRef = useRef(onScreen);
  agentsRef.current = agents;
  pagesRef.current = neoPages;
  onSelectRef.current = onSelect;
  onScreenRef.current = onScreen;
  const [tags, setTags] = useState<TagMode>('auto');
  const [follow, setFollow] = useState(false);
  const [mode, setMode] = useState<CameraMode>('orbit');
  const [autoIdle, setAutoIdle] = useState(readAutoIdle);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scene: OfficeScene | null = null;
    // Wait for the bundled UI font so the giant screen draws with it.
    const ready = Promise.race([document.fonts.load('400 32px "Atkinson Hyperlegible"'), new Promise((r) => setTimeout(r, 1200))]);
    let cancelled = false;
    ready.finally(() => {
      if (cancelled || !ref.current) return;
      try {
        scene = new OfficeScene(ref.current, {
          onSelect: (id) => onSelectRef.current(id),
          onModeChange: (m) => setMode(m),
          onScreen: (id) => onScreenRef.current(id),
        });
        sceneRef.current = scene;
        scene.setAutoIdle(readAutoIdle());
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

  useEffect(() => {
    if (agents) sceneRef.current?.setData(agents, neoPages);
  }, [agents, neoPages]);
  useEffect(() => sceneRef.current?.setSelected(selectedId), [selectedId]);
  useEffect(() => sceneRef.current?.setTags(tags), [tags]);
  useEffect(() => sceneRef.current?.setFollow(follow), [follow]);
  useEffect(() => {
    sceneRef.current?.setAutoIdle(autoIdle);
    try {
      localStorage.setItem('agentoffice.autoIdle', autoIdle ? 'on' : 'off');
    } catch {
      // private mode
    }
  }, [autoIdle]);
  useEffect(() => {
    if (focusRequest) sceneRef.current?.focus(focusRequest.id);
  }, [focusRequest]);

  // Full screen follows the browser state (Esc also leaves it).
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  const toggleFree = () => sceneRef.current?.setMode(mode === 'free' ? 'orbit' : 'free');
  const startTour = () => sceneRef.current?.setMode(mode === 'tour' ? 'orbit' : 'tour');

  // Keyboard shortcuts: C free camera, F full screen, I idle tour.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'c') sceneRef.current?.setMode(modeRef.current === 'free' ? 'orbit' : 'free');
      else if (key === 'f') toggleFullscreen();
      else if (key === 'i') sceneRef.current?.setMode('tour');
      else if (key === 'escape' && modeRef.current === 'free') sceneRef.current?.setMode('orbit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`office mode-${mode}`} ref={ref}>
      {error && <div className="office-loading">3D view unavailable: {error}</div>}
      {mode === 'free' && (
        <div className="freecam-hud">
          Free camera · <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>Q</kbd>/<kbd>E</kbd> down/up · <kbd>Shift</kbd> faster · drag to look · <kbd>Esc</kbd> exit
        </div>
      )}
      {mode === 'tour' && <div className="freecam-hud">Idle tour · move the mouse over the office to take back control</div>}
      <div className="office-controls" role="toolbar" aria-label="Office view controls">
        {mode === 'orbit' && (
          <>
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
          </>
        )}
        <button type="button" className={mode === 'free' ? 'on' : ''} aria-pressed={mode === 'free'} onClick={toggleFree} title="Fly freely with W A S D and the mouse (C)">
          Free cam
        </button>
        <button type="button" className={mode === 'tour' ? 'on' : ''} aria-pressed={mode === 'tour'} onClick={startTour} title="Idle tour: the camera visits the rooms and the workers (I)">
          Idle tour
        </button>
        <button
          type="button"
          className={autoIdle ? 'on soft' : 'soft'}
          aria-pressed={autoIdle}
          onClick={() => setAutoIdle((a) => !a)}
          title="Start the idle tour by itself after 3 minutes without input"
        >
          Auto idle {autoIdle ? 'on' : 'off'}
        </button>
        <button type="button" onClick={() => setTags((t) => (t === 'auto' ? 'all' : t === 'all' ? 'none' : 'auto'))} title="Name tags: auto hides them when zoomed far out">
          Names: {tags}
        </button>
        <button type="button" className={fullscreen ? 'on' : ''} aria-pressed={fullscreen} onClick={toggleFullscreen} title="Full screen (F)">
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      {mode === 'orbit' && <p className="office-hint">Drag to rotate · right-drag to pan · scroll to zoom · click someone or the Neo screen</p>}
    </div>
  );
}
