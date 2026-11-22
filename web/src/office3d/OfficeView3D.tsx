import { useEffect, useRef, useState } from 'react';
import type { AgentSnapshot, Mission, NeoPage } from '../../../shared/types.ts';
import { ChatFeed, type ChatFeedHandle } from './ChatFeed.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import type { BossView } from './player.ts';
import { type BossState, type CameraMode, OfficeScene, type TagMode } from './scene.ts';

interface Props {
  /** null until the first snapshot arrives, so current sessions are placed directly at their desks. */
  agents: AgentSnapshot[] | null;
  neoPages: NeoPage[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onScreen: (sessionId: string | null) => void;
  focusRequest: { id: string; at: number } | null;
  /** Changing it clears the office at once (replay start/stop, big jumps in time). */
  resetKey: number;
  /** Live missions, for the hand-off walk-overs. */
  missions?: Mission[];
  /** Projects pinned to rooms, shown on the room signs. */
  pins: Array<{ room: string; name: string }>;
  replaying: boolean;
  /** Replay time (ms) when replaying. */
  replayTime?: number;
  onReplay: () => void;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // private mode
  }
}

function readAutoIdle(): boolean {
  try {
    return localStorage.getItem('agentoffice.autoIdle') !== 'off';
  } catch {
    return true;
  }
}

export function OfficeView3D({ agents, neoPages, selectedId, onSelect, onScreen, focusRequest, resetKey, missions, pins, replaying, replayTime, onReplay }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const chatRef = useRef<ChatFeedHandle>(null);
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
  const [invertDrag, setInvertDrag] = useState(() => readFlag('agentoffice.invertDrag', true));
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [error, setError] = useState<string | null>(null);
  const [boss, setBoss] = useState<BossState | null>(null);
  const [bossView, setBossView] = useState<BossView>(() => {
    try {
      return localStorage.getItem('agentoffice.bossView') === 'fpv' ? 'fpv' : 'tpv';
    } catch {
      return 'tpv';
    }
  });
  const rememberView = (v: BossView) => {
    setBossView(v);
    try {
      localStorage.setItem('agentoffice.bossView', v);
    } catch {
      // private mode
    }
  };

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
          onChatter: (line) => chatRef.current?.chatter(line),
          onBoss: (state) => {
            setBoss(state);
            if (state) rememberView(state.view);
          },
        });
        sceneRef.current = scene;
        scene.setAutoIdle(readAutoIdle());
        scene.setInvertDrag(readFlag('agentoffice.invertDrag', true));
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

  const lastReset = useRef(resetKey);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setTimeOffset(replayTime ? replayTime - Date.now() : 0);
    if (resetKey !== lastReset.current) {
      lastReset.current = resetKey;
      scene.reset();
    }
    if (agents) scene.setData(agents, neoPages);
  }, [agents, neoPages, resetKey, replayTime]);
  useEffect(() => sceneRef.current?.setPins(pins), [pins]);
  // Hand-offs: the giver walks over to the worker who takes the mission.
  const handed = useRef(new Set<string>());
  useEffect(() => {
    for (const m of missions ?? []) {
      if (!m.from || !m.agentId || m.status !== 'running') continue;
      const key = `${m.id}:${m.runs}`;
      if (handed.current.has(key)) continue;
      handed.current.add(key);
      sceneRef.current?.handoff(m.from.agentId, m.agentId, m.projectName);
    }
  }, [missions]);
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
    sceneRef.current?.setInvertDrag(invertDrag);
    writeFlag('agentoffice.invertDrag', invertDrag);
  }, [invertDrag]);
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

  // Keyboard shortcuts: C free camera, F full screen, I starts the idle tour.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      // Boss mode uses the keyboard for everything (F is the kick there).
      if (modeRef.current === 'boss') return;
      // The idle tour only stops from its button, so shortcuts leave it alone.
      if (modeRef.current === 'tour') {
        if (key === 'f') toggleFullscreen();
        return;
      }
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
      <ChatFeed ref={chatRef} agents={agents} resetKey={resetKey} onSelect={(id) => onSelectRef.current(id)} />
      {mode === 'free' && (
        <div className="freecam-hud">
          Free camera · <kbd>Z</kbd>
          <kbd>Q</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>A</kbd>/<kbd>E</kbd> down/up · <kbd>Shift</kbd> faster · right click: mouse look on/off (or drag) · <kbd>Esc</kbd> exit
        </div>
      )}
      {mode === 'tour' && <div className="freecam-hud">Idle tour · click Idle tour again to stop it</div>}
      {mode === 'boss' && (
        <div className="freecam-hud boss-hud">
          {!boss?.arrived ? (
            'The elevator is bringing you up to the office…'
          ) : (
            <>
              👔 Boss · <kbd>Z</kbd>
              <kbd>Q</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> walk ·  <kbd>Shift</kbd>/double <kbd>Z</kbd> sprint · <kbd>Space</kbd> jump · <kbd>E</kbd> talk + his page · <kbd>R</kbd> slap · <kbd>F</kbd> kick · <kbd>C</kbd> {boss.sitting ? 'stand up' : 'sit'} · <kbd>V</kbd>{' '}
              {bossView === 'fpv' ? 'third person' : 'first person'} · right click: {boss.locked ? 'show the cursor' : 'mouse look'} · <kbd>T</kbd> dashboard · <kbd>M</kbd> sound · <kbd>L</kbd> leave
            </>
          )}
        </div>
      )}
      {mode === 'boss' && bossView === 'fpv' && boss?.arrived && <div className="crosshair" aria-hidden="true" />}
      {mode === 'boss' && (
        <div className="office-controls" role="toolbar" aria-label="Boss controls">
          <button type="button" disabled={!boss?.arrived} onClick={() => sceneRef.current?.resetBoss()} title="Back in front of the elevator, if you are lost or stuck">
            ↺ Back to the elevator
          </button>
        </div>
      )}
      {mode !== 'boss' && (
      <div className="office-controls" role="toolbar" aria-label="Office view controls">
        {mode === 'orbit' && (
          <>
            <button type="button" onClick={() => sceneRef.current?.zoom('in')} aria-label="Zoom in" title="Zoom in">
              +
            </button>
            <button type="button" onClick={() => sceneRef.current?.zoom('out')} aria-label="Zoom out" title="Zoom out">
              −
            </button>
            <button type="button" onClick={() => sceneRef.current?.setHome(false)} aria-label="Reset view" title="Reset the camera (double-click also works)">
              ⤢
            </button>
            <button type="button" className={follow ? 'on' : ''} aria-pressed={follow} onClick={() => setFollow((f) => !f)} title="Camera follows the selected agent">
              Follow
            </button>
            <button
              type="button"
              className="soft"
              onClick={() => setInvertDrag((v) => !v)}
              title="Drag direction: 'camera' moves the camera the way you drag, 'office' drags the office like a map"
            >
              Drag: {invertDrag ? 'camera' : 'office'}
            </button>
          </>
        )}
        <button
          type="button"
          className="boss-btn"
          onClick={() => sceneRef.current?.spawnBoss(bossView)}
          title="Become the boss: ride the elevator up and walk around the office (everything is on the keyboard; L leaves)"
        >
          👔 Be the boss
        </button>
        <button type="button" className={mode === 'free' ? 'on' : ''} aria-pressed={mode === 'free'} onClick={toggleFree} title="Fly freely with Z Q S D and the mouse (C)">
          Free cam
        </button>
        <button type="button" className={mode === 'tour' ? 'on' : ''} aria-pressed={mode === 'tour'} onClick={startTour} title="Idle tour: the camera visits the rooms and the workers. Click again to stop.">
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
        <button type="button" className={replaying ? 'on' : ''} aria-pressed={replaying} onClick={onReplay} title="Replay the day: scrub back through the office and its chat">
          {replaying ? 'Live' : 'Replay'}
        </button>
        <SoundPanel />
        <button type="button" className={fullscreen ? 'on' : ''} aria-pressed={fullscreen} onClick={toggleFullscreen} title="Full screen (F)">
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      )}
      {mode === 'orbit' && <p className="office-hint">Drag to rotate · right-drag to pan · scroll zooms where the cursor points · click someone or the Neo screen</p>}
    </div>
  );
}
