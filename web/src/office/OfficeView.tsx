import { useEffect, useRef, useState } from 'react';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { type Camera, OfficeRenderer, UI_FONT } from './render.ts';
import { World } from './world.ts';

interface Props {
  agents: AgentSnapshot[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusRequest: { id: string; at: number } | null;
}

type Labels = 'auto' | 'all' | 'none';

export function OfficeView({ agents, selectedId, onSelect, focusRequest }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const rendererRef = useRef<OfficeRenderer | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const fitRef = useRef(1);
  const followRef = useRef(false);
  const userMovedRef = useRef(false);
  const labelsRef = useRef<Labels>('auto');
  const [labels, setLabels] = useState<Labels>('auto');
  const [follow, setFollow] = useState(false);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create world + renderer once fonts are ready (canvas text needs the pixel font loaded).
  useEffect(() => {
    let cancelled = false;
    Promise.race([document.fonts.load(`12px ${UI_FONT}`), new Promise((r) => setTimeout(r, 1500))]).finally(() => {
      if (cancelled) return;
      const world = new World();
      worldRef.current = world;
      rendererRef.current = new OfficeRenderer(world);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.sync(agents, Date.now());
  }, [agents, ready]);

  useEffect(() => {
    if (worldRef.current) worldRef.current.selectedId = selectedId;
  }, [selectedId, ready]);

  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  // Focus camera on a character when the dashboard asks for it.
  useEffect(() => {
    if (!focusRequest || !rendererRef.current) return;
    const target = rendererRef.current.focusOf(focusRequest.id);
    if (!target) return;
    userMovedRef.current = true;
    animateCamera(camRef.current, { x: target.x, y: target.y, zoom: Math.max(camRef.current.zoom, fitRef.current * 2.2) });
  }, [focusRequest]);

  // Render loop, resize, input.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const renderer = rendererRef.current!;
    const world = worldRef.current!;
    const ctx = canvas.getContext('2d')!;
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let fitted = false;

    const fit = () => {
      const b = renderer.bounds;
      const zoom = Math.min(cssW / (b.maxX - b.minX), cssH / (b.maxY - b.minY)) * 1.02;
      fitRef.current = zoom;
      Object.assign(camRef.current, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + 10, zoom });
    };
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      // Keep the whole office in view until the user pans or zooms.
      if (!fitted || !userMovedRef.current) {
        fit();
        fitted = true;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const now = Date.now();
      world.update(dt, now);
      stepCamera(camRef.current, dt);
      if (followRef.current && world.selectedId) {
        const target = renderer.focusOf(world.selectedId);
        if (target) {
          camRef.current.x += (target.x - camRef.current.x) * Math.min(1, dt * 4);
          camRef.current.y += (target.y - camRef.current.y) * Math.min(1, dt * 4);
        }
      }
      renderer.draw(ctx, cssW, cssH, dpr, camRef.current, { labels: labelsRef.current, now });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Pan with drag, zoom with wheel, click to select.
    let drag: { x: number; y: number; camX: number; camY: number; moved: boolean } | null = null;
    const local = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      drag = { x: p.x, y: p.y, camX: camRef.current.x, camY: camRef.current.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (drag) {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          userMovedRef.current = true;
          cancelCameraAnimation();
          camRef.current.x = drag.camX - dx / camRef.current.zoom;
          camRef.current.y = drag.camY - dy / camRef.current.zoom;
        }
      }
      const hover = renderer.pick(p.x, p.y);
      world.hoverId = hover;
      canvas.style.cursor = drag?.moved ? 'grabbing' : hover ? 'pointer' : 'grab';
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (drag && !drag.moved) onSelectRef.current(renderer.pick(p.x, p.y));
      drag = null;
      canvas.releasePointerCapture(e.pointerId);
    };
    const onLeave = () => {
      world.hoverId = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMovedRef.current = true;
      cancelCameraAnimation();
      const p = local(e);
      const cam = camRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const zoom = clamp(cam.zoom * factor, fitRef.current * 0.7, 6);
      const wx = (p.x - cssW / 2) / cam.zoom + cam.x;
      const wy = (p.y - cssH / 2) / cam.zoom + cam.y;
      cam.zoom = zoom;
      cam.x = wx - (p.x - cssW / 2) / zoom;
      cam.y = wy - (p.y - cssH / 2) / zoom;
    };
    const onDouble = () => {
      const b = renderer.bounds;
      animateCamera(camRef.current, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + 10, zoom: fitRef.current });
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDouble);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDouble);
    };
  }, [ready]);

  const zoomBy = (factor: number) => {
    userMovedRef.current = true;
    const cam = camRef.current;
    animateCamera(cam, { x: cam.x, y: cam.y, zoom: clamp(cam.zoom * factor, fitRef.current * 0.7, 6) });
  };
  const reset = () => {
    const r = rendererRef.current;
    if (!r) return;
    userMovedRef.current = false;
    const b = r.bounds;
    animateCamera(camRef.current, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + 10, zoom: fitRef.current });
  };

  return (
    <div className="office" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="Pixel-art office showing each agent session as a character" role="img" />
      <div className="office-controls" role="toolbar" aria-label="Office view controls">
        <button type="button" onClick={() => zoomBy(1.35)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.35)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={reset} title="Fit the whole office (double-click also works)" aria-label="Fit office">
          ⤢
        </button>
        <button
          type="button"
          className={follow ? 'on' : ''}
          onClick={() => setFollow((f) => !f)}
          title="Camera follows the selected agent"
          aria-pressed={follow}
        >
          Follow
        </button>
        <button
          type="button"
          onClick={() => setLabels((l) => (l === 'auto' ? 'all' : l === 'all' ? 'none' : 'auto'))}
          title="Name tags: auto shows working agents, all shows everyone"
        >
          Tags: {labels}
        </button>
      </div>
      {!ready && <div className="office-loading">Unlocking the office…</div>}
    </div>
  );
}

// ---------- camera easing ----------

let anim: { from: Camera; to: Camera; t: number } | null = null;
let animTarget: Camera | null = null;

function animateCamera(cam: Camera, to: Camera) {
  anim = { from: { ...cam }, to, t: 0 };
  animTarget = cam;
}
function cancelCameraAnimation() {
  anim = null;
}
function stepCamera(cam: Camera, dt: number) {
  if (!anim || animTarget !== cam) return;
  anim.t = Math.min(1, anim.t + dt * 2.2);
  const e = 1 - Math.pow(1 - anim.t, 3);
  cam.x = anim.from.x + (anim.to.x - anim.from.x) * e;
  cam.y = anim.from.y + (anim.to.y - anim.from.y) * e;
  cam.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * e;
  if (anim.t >= 1) anim = null;
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
