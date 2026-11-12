// Three.js scene: renderer, camera, time-of-day lighting, labels, picking and the frame loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { AgentSnapshot, NeoPage } from '../../../shared/types.ts';
import { FreeFly, Tour } from './cameraModes.ts';
import { Elevator } from './elevator.ts';
import { buildEnvironment, type Environment, ISLAND_TOP } from './environment.ts';
import { Batch, buildFurniture } from './furniture.ts';
import { buildLayout, D, ELEVATOR, itemBox, type Layout, W } from './layout.ts';
import { softDot } from './materials.ts';
import { Nav } from './nav.ts';
import { type BossView, PlayerControl } from './player.ts';
import { DeskScreens, NeoScreen } from './screens.ts';
import { BOSS_ID, type Char, Sim } from './sim.ts';

export type TagMode = 'auto' | 'all' | 'none';
export type CameraMode = 'orbit' | 'free' | 'tour' | 'boss';

/** Boss mode status for the toolbar and HUD. */
export interface BossState {
  view: BossView;
  /** Out of the elevator and walking. */
  arrived: boolean;
  /** The mouse is captured for looking around. */
  locked: boolean;
}

/** Idle tour starts by itself after this long without any input. */
const AUTO_IDLE_MS = 3 * 60_000;

interface Callbacks {
  onSelect(id: string | null): void;
  onModeChange(mode: CameraMode): void;
  onScreen(sessionId: string | null): void;
  onChatter(line: Chatter): void;
  onBoss(state: BossState | null): void;
}

/** Something a character said or thought in a bubble, for the chat feed. */
export interface Chatter {
  agentId: string;
  persona: string;
  provider: AgentSnapshot['provider'];
  kind: 'say' | 'think' | 'action' | 'ask' | 'idle' | 'chat';
  text: string;
  at: number;
}

interface LabelParts {
  obj: CSS2DObject;
  root: HTMLDivElement;
  bubble: HTMLDivElement;
  tag: HTMLDivElement;
  name: HTMLSpanElement;
  sub: HTMLSpanElement;
  alert: HTMLDivElement;
  lastBubble: string;
  lastSub: string;
}

const HOME = { target: new THREE.Vector3(W / 2, -7, D / 2 + 2), radius: 92, polar: 1.0, azimuth: 0.6 };

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private layout: Layout;
  private sim: Sim;
  private elevator: Elevator;
  private env: Environment;
  private neoScreen: NeoScreen;
  private desks: DeskScreens;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private nightLights: THREE.PointLight[] = [];
  private labelsById = new Map<string, LabelParts>();
  private roomLabels: Array<{ id: string; el: HTMLDivElement; count: HTMLSpanElement; pin: HTMLSpanElement }> = [];
  private steam: THREE.Sprite[] = [];
  private ball: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;
  private callbacks: Callbacks;
  private tagMode: TagMode = 'auto';
  private follow = false;
  private camAnim: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number } | null = null;
  private mode: CameraMode = 'orbit';
  private freeFly: FreeFly;
  private tour: Tour;
  private player: PlayerControl;
  private autoIdle = true;
  private lastInput = performance.now();
  private ticker: Worker | null = null;
  private rafId = 0;
  private lastTick = performance.now();
  private frameCount = 0;
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  private frameTimes: number[] = [];
  private lastQualityChange = 0;
  private cleanup: Array<() => void> = [];
  /** Cheap invisible boxes for everything solid, used to stop the camera just before it touches something. */
  private colliders: THREE.Mesh[] = [];
  private lastLight = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: Callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows are refreshed every other frame (see render), which halves their cost.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'ao-labels';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.08, 900);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 170;
    this.controls.maxPolarAngle = Math.PI * 0.64;
    this.controls.minPolarAngle = 0.12;
    this.controls.screenSpacePanning = true;
    // The wheel is handled by dolly(): it zooms exactly toward the cursor and stops before solid things.
    this.controls.enableZoom = false;
    this.controls.addEventListener('start', () => (this.camAnim = null));
    this.setHome(true);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    this.scene.fog = new THREE.Fog('#e9d8e6', 120, 340);

    this.hemi = new THREE.HemisphereLight('#dfe9ff', '#8c7a66', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    this.sun.position.set(W / 2 + 26, 46, D / 2 + 30);
    this.sun.target.position.set(W / 2, 0, D / 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 10;
    sc.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    for (const [x, z] of [
      [7, 6.5],
      [28, 6.5],
      [7, 19.5],
      [28, 19.5],
      [17.5, 22.5],
    ]) {
      const l = new THREE.PointLight('#ffd9a3', 0, 16, 2);
      l.position.set(x, 3.1, z);
      this.nightLights.push(l);
      this.scene.add(l);
    }

    // World.
    this.layout = buildLayout();
    this.env = buildEnvironment(this.layout);
    this.scene.add(this.env.group);
    const batch = new Batch();
    for (const f of this.layout.furniture) buildFurniture(batch, f);
    const furniture = new THREE.Group();
    batch.build(furniture);
    this.scene.add(furniture);
    this.desks = new DeskScreens(this.layout.seats);
    this.scene.add(this.desks.group);

    // Giant BrowserOS neo screen on the back wall of the hub.
    const neo = this.layout.zones.get('browser')!;
    this.neoScreen = new NeoScreen(6.0, 2.55);
    this.neoScreen.mesh.position.set((neo.x0 + neo.x1) / 2, 1.95, 0.08);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(6.25, 2.8, 0.1), new THREE.MeshStandardMaterial({ color: '#111418', roughness: 0.35, metalness: 0.4 }));
    bezel.position.set((neo.x0 + neo.x1) / 2, 1.95, 0.02);
    bezel.castShadow = true;
    const glow = new THREE.PointLight('#5fe0cf', 3, 9, 2);
    glow.position.set((neo.x0 + neo.x1) / 2, 2, 1.6);
    this.scene.add(bezel, this.neoScreen.mesh, glow);

    this.elevator = new Elevator();
    this.scene.add(this.elevator.group);
    const nav = new Nav(this.layout.blocked);
    this.player = new PlayerControl(this.camera, nav, (o, d) => this.wallHit(o, d));
    this.sim = new Sim(
      this.layout,
      nav,
      this.elevator,
      (c) => this.addChar(c),
      (c) => this.removeChar(c),
    );

    // Café steam and a ping-pong ball.
    const steamMat = new THREE.SpriteMaterial({ map: softDot(), transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(steamMat);
      s.scale.setScalar(0.25);
      s.visible = false;
      this.steam.push(s);
      this.scene.add(s);
    }
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3 }));
    this.ball.visible = false;
    this.scene.add(this.ball);

    this.buildRoomLabels();
    this.applyTimeOfDay(Date.now());

    this.buildColliders();
    this.sim.onChatter = (c, kind, text) =>
      this.callbacks.onChatter({ agentId: c.id, persona: c.agent.persona, provider: c.agent.provider, kind, text, at: this.sim.clock() });
    this.freeFly = new FreeFly(this.camera);
    this.sim.onBossArrived = (c) => {
      this.player.yaw = c.heading;
      this.player.pitch = -0.08;
      this.emitBoss();
    };
    this.tour = new Tour(this.camera, this.sim, this.layout, this.elevator);

    // Input.
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    let last: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      if (this.mode === 'free') el.setPointerCapture(e.pointerId);
      if (this.mode === 'boss' && document.pointerLockElement !== el) {
        // Capture the mouse so it turns your head like in a game (Esc gives it back).
        try {
          void (el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined);
        } catch {
          el.setPointerCapture(e.pointerId);
        }
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (this.mode === 'boss') {
        // A click while the mouse is captured talks to the worker in front of you.
        if (document.pointerLockElement === el && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.interact();
        down = null;
        last = null;
        return;
      }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.click(e);
      down = null;
      last = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (this.mode === 'boss') {
        if (document.pointerLockElement === el) this.player.look(e.movementX, e.movementY);
        else if (e.buttons && last) {
          this.player.look(e.clientX - last.x, e.clientY - last.y);
          last = { x: e.clientX, y: e.clientY };
        }
        el.style.cursor = document.pointerLockElement === el ? 'none' : 'crosshair';
        return;
      }
      if (this.mode === 'free' && e.buttons && last) {
        this.freeFly.look(e.clientX - last.x, e.clientY - last.y);
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.buttons) return;
      const id = this.pick(e);
      if (this.mode !== 'tour') this.sim.hoverId = id;
      el.style.cursor = id || this.overScreen(e) ? 'pointer' : this.mode === 'free' ? 'crosshair' : 'grab';
    });
    el.addEventListener('dblclick', () => {
      if (this.mode === 'orbit') this.setHome(false);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'orbit') return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        // One mouse-wheel notch is about 100 px; trackpads send many small deltas.
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
        this.dolly(ndcX, ndcY, THREE.MathUtils.clamp(px, -300, 300) / 100, false);
      },
      { passive: false },
    );
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'boss') return;
        e.preventDefault();
        this.player.zoom(e.deltaY);
      },
      { passive: false },
    );
    const onLock = () => this.emitBoss();
    document.addEventListener('pointerlockchange', onLock);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', onLock));
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'free') return;
        e.preventDefault();
        this.freeFly.dolly(-e.deltaY * 0.02);
      },
      { passive: false },
    );
    // The idle tour only ends from its button, so the mouse can be moved freely while it runs.
    const onInput = () => (this.lastInput = performance.now());
    const onKeyDown = (e: KeyboardEvent) => {
      onInput();
      if (isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (this.mode === 'boss') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (key === 'v' && !e.repeat) this.setBossView(this.player.view === 'fpv' ? 'tpv' : 'fpv');
        else if (key === 'e' && !e.repeat) this.interact();
        else this.player.keys.add(key);
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
        return;
      }
      if (this.mode !== 'free') return;
      this.freeFly.keys.add(key);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.freeFly.keys.delete(e.key.toLowerCase());
      this.player.keys.delete(e.key.toLowerCase());
    };
    const onBlur = () => {
      this.freeFly.keys.clear();
      this.player.keys.clear();
    };
    window.addEventListener('pointermove', onInput);
    window.addEventListener('pointerdown', onInput);
    window.addEventListener('wheel', onInput, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanup.push(() => {
      window.removeEventListener('pointermove', onInput);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('wheel', onInput);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.startLoop();
    // Dev-only debugging handle (window.__office); never present in the production build.
    if (import.meta.env.DEV) (window as unknown as { __office?: OfficeScene }).__office = this;
  }

  // ------------------------------------------------------------------ public API

  setData(agents: AgentSnapshot[], pages: NeoPage[]) {
    this.sim.sync(agents, this.sim.clock());
    this.neoScreen.set(pages, agents);
  }

  /** Runs the office on another time (a replay): offset from the real clock in ms. */
  setTimeOffset(offset: number) {
    if (Math.abs(offset - this.sim.offset) < 1000) return;
    this.sim.offset = offset;
    this.lastLight = 0;
  }

  /** Clears the office instantly (entering or leaving a replay, or a big jump in time). */
  reset() {
    this.sim.reset();
  }

  /** A mission hand-off: the giver walks over to the receiver. */
  handoff(from: string, to: string, project?: string) {
    this.sim.handoff(from, to, project);
  }

  /** Projects pinned to rooms, shown on the room signs. */
  setPins(pins: Array<{ room: string; name: string }>) {
    for (const r of this.roomLabels) {
      const names = pins.filter((p) => p.room === r.id).map((p) => p.name);
      const text = names.length ? `📌 ${names.join(', ')}` : '';
      if (r.pin.textContent !== text) {
        r.pin.textContent = text;
        r.pin.style.display = text ? '' : 'none';
      }
    }
  }

  setSelected(id: string | null) {
    this.sim.selectedId = id;
  }

  setTags(mode: TagMode) {
    this.tagMode = mode;
  }

  setFollow(on: boolean) {
    this.follow = on;
  }

  /** Orbit (default), free-flying camera, or the idle tour. */
  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.camAnim = null;
    this.controls.enabled = mode === 'orbit';
    if (prev === 'tour') this.sim.hoverId = null;
    if (prev === 'boss') {
      // You walk back to the elevator and ride down; the camera is yours again.
      this.sim.boss?.person.setHeadVisible(true);
      this.sim.leaveBoss();
      if (document.pointerLockElement) document.exitPointerLock();
      this.player.keys.clear();
      this.renderer.domElement.style.cursor = '';
      this.callbacks.onBoss(null);
    }
    if (mode === 'boss') this.player.begin();
    if (mode === 'free') this.freeFly.begin();
    if (mode === 'tour') this.tour.begin(this.controls.target);
    if (mode === 'orbit') {
      // Hand the view back to the orbit controls without a jump.
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      let dist = prev === 'tour' ? this.camera.position.distanceTo(this.tour.target) : 18;
      if (prev === 'free' && dir.y < -0.05) dist = THREE.MathUtils.clamp(-this.camera.position.y / dir.y, 4, 120);
      if (prev === 'boss') dist = 6;
      this.controls.target.copy(this.camera.position).addScaledVector(dir, dist);
      this.controls.update();
    }
    this.lastInput = performance.now();
    this.callbacks.onModeChange(mode);
  }

  /** Boss mode: you arrive by the elevator and walk around (first or third person). */
  spawnBoss(view: BossView) {
    this.player.setView(view);
    this.sim.spawnBoss();
    this.setMode('boss');
    this.emitBoss();
  }

  setBossView(view: BossView) {
    this.player.setView(view);
    this.emitBoss();
  }

  private emitBoss() {
    if (this.mode !== 'boss') return;
    this.callbacks.onBoss({
      view: this.player.view,
      arrived: this.sim.boss?.mode === 'player',
      locked: document.pointerLockElement === this.renderer.domElement,
    });
  }

  /** Talks to the worker you are looking at (or the nearest one) and opens his details. */
  private interact() {
    const boss = this.sim.boss;
    if (!boss || boss.mode !== 'player') return;
    this.camera.updateMatrixWorld();
    this.pointer.set(0, 0);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const people = [...this.sim.chars.values()].filter((c) => c.id !== BOSS_ID && c.person.root.visible);
    for (const c of people) c.person.hit.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObjects(
      people.map((c) => c.person.hit),
      false,
    )[0];
    const aimed = hit ? people.find((c) => c.person.hit === hit.object && Math.hypot(c.x - boss.x, c.z - boss.z) < 6) : undefined;
    const id = this.sim.greetBoss(aimed?.id);
    if (id) this.callbacks.onSelect(id);
  }

  setAutoIdle(on: boolean) {
    this.autoIdle = on;
    this.lastInput = performance.now();
  }

  focus(id: string) {
    const c = this.sim.chars.get(id);
    if (!c || this.mode === 'boss') return;
    if (this.mode === 'free') {
      const head = new THREE.Vector3(c.x, c.y + 1.4, c.z);
      this.camera.position.copy(head).add(new THREE.Vector3(Math.sin(c.heading) * 5, 2.5, Math.cos(c.heading) * 5));
      this.freeFly.lookAt(head);
      return;
    }
    if (this.mode === 'tour') {
      // The tour keeps running and swings over to this worker next.
      this.tour.visit(id);
      return;
    }
    const target = new THREE.Vector3(c.x, c.y + 1, c.z);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.animateTo(target, target.clone().add(dir.multiplyScalar(17)));
  }

  setHome(instant: boolean) {
    const { target, radius, polar, azimuth } = HOME;
    const pos = new THREE.Vector3(
      target.x + radius * Math.sin(polar) * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(azimuth),
    );
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
    } else this.animateTo(target.clone(), pos);
  }

  /** The + and − buttons: zoom toward or away from the centre of the view. */
  zoom(direction: 'in' | 'out') {
    if (this.mode === 'orbit') this.dolly(0, 0, direction === 'in' ? -1.6 : 1.6, true);
  }

  /**
   * Mouse drag direction. Inverted (the default) moves the camera the way you drag; natural drags
   * the office itself, like a map.
   */
  setInvertDrag(on: boolean) {
    this.controls.rotateSpeed = on ? -0.9 : 0.9;
    this.controls.panSpeed = on ? -1 : 1;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.ticker?.terminate();
    for (const fn of this.cleanup) fn();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ------------------------------------------------------------------ internals

  private animateTo(toT: THREE.Vector3, toP: THREE.Vector3) {
    this.camAnim = { fromT: this.controls.target.clone(), toT, fromP: this.camera.position.clone(), toP, t: 0 };
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private pick(e: PointerEvent): string | null {
    this.camera.updateMatrixWorld();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = [...this.sim.chars.values()].filter((c) => c.person.root.visible && c.id !== BOSS_ID).map((c) => c.person.hit);
    const hit = this.raycaster.intersectObjects(hits, false)[0];
    if (!hit) return null;
    for (const c of this.sim.chars.values()) if (c.person.hit === hit.object) return c.id;
    return null;
  }

  /** First wall, floor or piece of furniture along a ray (people ignored). */
  private wallHit(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Intersection | undefined {
    this.raycaster.set(origin, dir);
    return this.raycaster.intersectObjects(this.colliders, false)[0];
  }

  /** First solid thing (furniture, wall, floor, island, character) along a ray. */
  private solidHit(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Intersection | undefined {
    this.raycaster.set(origin, dir);
    const people = [...this.sim.chars.values()].filter((c) => c.person.root.visible).map((c) => c.person.hit);
    for (const p of people) p.updateWorldMatrix(true, false);
    return this.raycaster.intersectObjects([...this.colliders, ...people], false)[0];
  }

  /**
   * Zooms toward (negative notches) or away from (positive) the point under a screen position. The
   * camera slides along the ray through that point without turning, so the point stays exactly under
   * the cursor. Zooming in stops 0.5 m before anything solid; zooming out never backs into a wall.
   * The orbit pivot is then put back on whatever the camera faces, so rotating feels natural.
   */
  private dolly(ndcX: number, ndcY: number, notches: number, animate: boolean) {
    if (!notches) return;
    this.camera.updateMatrixWorld();
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const dir = this.raycaster.ray.direction.clone();
    const origin = this.camera.position.clone();
    const ahead = this.solidHit(origin, dir);
    const reach = ahead ? ahead.distance : Math.max(4, origin.distanceTo(this.controls.target));
    const k = 1 - Math.pow(0.8, Math.abs(notches));
    let step: number;
    if (notches < 0) {
      step = reach * k;
      if (ahead) step = Math.min(step, ahead.distance - 0.5);
      if (step <= 0.01) return;
    } else {
      step = -reach * (1 / (1 - k) - 1);
      const behind = this.solidHit(origin, dir.clone().negate());
      if (behind) step = Math.max(step, -(behind.distance - 0.5));
      const centre = new THREE.Vector3(W / 2, 0, D / 2);
      const next = origin.clone().addScaledVector(dir, step);
      if (next.distanceTo(centre) > this.controls.maxDistance) {
        // Stop at the outer limit instead of refusing to move.
        const far = origin.distanceTo(centre);
        if (far >= this.controls.maxDistance) return;
        step *= (this.controls.maxDistance - far) / Math.max(0.01, next.distanceTo(centre) - far);
      }
      if (step >= -0.01) return;
    }
    const pos = origin.addScaledVector(dir, step);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const facing = this.solidHit(pos, forward);
    const pivot = THREE.MathUtils.clamp(facing ? facing.distance : this.camera.position.distanceTo(this.controls.target), 0.5, 150);
    const target = pos.clone().addScaledVector(forward, pivot);
    if (animate) {
      this.animateTo(target, pos);
      return;
    }
    this.camAnim = null;
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  private buildColliders() {
    const material = new THREE.MeshBasicMaterial();
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      m.updateMatrixWorld(true);
      this.colliders.push(m);
    };
    for (const f of this.layout.furniture) {
      const b = itemBox(f);
      if (b) add(b.w, b.h, b.d, b.x, b.h / 2, b.z);
    }
    for (const w of this.layout.walls) {
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
      const h = w.kind === 'back' ? 3.45 : w.kind === 'partition' ? 2.4 : 1.1;
      const t = w.kind === 'back' ? 0.25 : 0.14;
      const cx = (w.x1 + w.x2) / 2;
      const cz = (w.z1 + w.z2) / 2;
      if (w.x1 === w.x2) add(t, h, len, w.kind === 'back' ? -t / 2 : cx, h / 2, cz);
      else add(len, h, t, cx, h / 2, w.kind === 'back' ? -t / 2 : cz);
    }
    // Floor, lawn, the elevator shaft, the Neo wall screen and the rock under the island.
    add(W + 1, 0.04, D + 1, W / 2, 0, D / 2);
    const lawn = new THREE.Mesh(new THREE.CylinderGeometry(31, 31, 0.04, 40), material);
    lawn.scale.set(1, 1, 0.82);
    lawn.position.set(W / 2, ISLAND_TOP, D / 2);
    lawn.updateMatrixWorld(true);
    this.colliders.push(lawn);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(26, 22, 24), material);
    rock.rotation.x = Math.PI;
    rock.scale.set(1, 1, 0.82);
    rock.position.set(W / 2, ISLAND_TOP - 11.4, D / 2);
    rock.updateMatrixWorld(true);
    this.colliders.push(rock);
    add(ELEVATOR.size, 66, ELEVATOR.size, ELEVATOR.x, 3.7 - 33, ELEVATOR.z);
    const neo = this.layout.zones.get('browser')!;
    add(6.3, 2.85, 0.12, (neo.x0 + neo.x1) / 2, 1.95, 0.02);
  }

  private click(e: PointerEvent) {
    const id = this.pick(e);
    if (id) {
      this.callbacks.onSelect(id);
      return;
    }
    if (this.overScreen(e)) {
      const hit = this.raycaster.intersectObject(this.neoScreen.mesh, false)[0];
      this.callbacks.onScreen(hit?.uv ? this.neoScreen.hit(hit.uv) : null);
      return;
    }
    this.callbacks.onSelect(null);
  }

  private overScreen(e: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.neoScreen.mesh, false).length > 0;
  }

  private addChar(c: Char) {
    this.scene.add(c.person.root);
    const root = document.createElement('div');
    root.className = 'ao-label';
    const bubble = document.createElement('div');
    bubble.className = 'ao-bubble';
    const alert = document.createElement('div');
    alert.className = 'ao-alert';
    alert.textContent = '!';
    const tag = document.createElement('div');
    tag.className = 'ao-tag';
    const dot = document.createElement('span');
    dot.className = 'ao-dot';
    dot.style.background = PROVIDER_META[c.agent.provider].color;
    const name = document.createElement('span');
    name.className = 'ao-name';
    const sub = document.createElement('span');
    sub.className = 'ao-sub';
    tag.append(dot, name, sub);
    if (c.agent.host) {
      // Works on another computer.
      const host = document.createElement('span');
      host.className = 'ao-host';
      host.textContent = `🖥 ${c.agent.host}`;
      tag.append(host);
    }
    if (c.id === BOSS_ID) root.classList.add('boss');
    else tag.addEventListener('click', () => this.callbacks.onSelect(c.id));
    root.append(bubble, alert, tag);
    const obj = new CSS2DObject(root);
    obj.center.set(0.5, 1);
    this.scene.add(obj);
    this.labelsById.set(c.id, { obj, root, bubble, tag, name, sub, alert, lastBubble: '', lastSub: '' });
  }

  private removeChar(c: Char) {
    this.scene.remove(c.person.root);
    const l = this.labelsById.get(c.id);
    if (l) {
      this.scene.remove(l.obj);
      l.root.remove();
      this.labelsById.delete(c.id);
    }
  }

  private buildRoomLabels() {
    for (const zone of this.layout.zones.values()) {
      const def = zone.def;
      const el = document.createElement('div');
      el.className = 'ao-room';
      el.style.setProperty('--accent', def.accent);
      const icon = document.createElement('span');
      icon.className = 'ao-room-icon';
      icon.textContent = def.icon;
      const label = document.createElement('span');
      label.textContent = def.label;
      const count = document.createElement('span');
      count.className = 'ao-room-count';
      const pin = document.createElement('span');
      pin.className = 'ao-room-pin';
      pin.style.display = 'none';
      el.append(icon, label, count, pin);
      const obj = new CSS2DObject(el);
      obj.position.set(zone.x0 + 1.6, 2.9, zone.z0 + 0.6);
      if (def.id === 'atrium') obj.position.set(ELEVATOR.x - 2.4, 3.2, zone.z0 + 1.0);
      if (def.id === 'browser') obj.position.set(zone.x0 + 1.4, 3.7, zone.z0 + 0.7);
      this.scene.add(obj);
      this.roomLabels.push({ id: def.id, el, count, pin });
    }
  }

  private applyTimeOfDay(now: number) {
    const d = new Date(now);
    const h = d.getHours() + d.getMinutes() / 60;
    const night = h >= 20.5 || h < 6;
    const dusk = !night && (h >= 17.5 || h < 8);
    if (night) {
      this.env.setSky('#0f1533', '#3b2f62', '#1d1838');
      this.sun.color.set('#a9b8ff');
      this.sun.intensity = 0.55;
      this.hemi.intensity = 0.55;
      this.hemi.color.set('#8fa0d8');
      this.renderer.toneMappingExposure = 1.05;
      (this.scene.fog as THREE.Fog).color.set('#2a2550');
    } else if (dusk) {
      this.env.setSky('#6f6ac4', '#f7b39a', '#9b8ac9');
      this.sun.color.set('#ffc59a');
      this.sun.intensity = 1.9;
      this.hemi.intensity = 0.95;
      this.hemi.color.set('#f2d6e6');
      this.renderer.toneMappingExposure = 1.0;
      (this.scene.fog as THREE.Fog).color.set('#e8bfc4');
    } else {
      this.env.setSky('#8fb2ec', '#f4dbe7', '#c8bdec');
      this.sun.color.set('#fff3e2');
      this.sun.intensity = 2.7;
      this.hemi.intensity = 1.1;
      this.hemi.color.set('#e2ecff');
      this.renderer.toneMappingExposure = 1.0;
      (this.scene.fog as THREE.Fog).color.set('#ead9e8');
    }
    for (const l of this.nightLights) l.intensity = night ? 18 : dusk ? 5 : 0;
    for (const lamp of this.env.lamps) (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 2.2 : dusk ? 0.8 : 0.1;
  }

  /**
   * Frames run on requestAnimationFrame plus a worker clock as a fallback: browsers slow down or
   * pause animation frames when the window is not in front, and the worker keeps the office moving
   * (and drawing whenever the window is visible). After a long pause the simulation catches up.
   */
  private startLoop() {
    const raf = () => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(raf);
      this.tick(true);
    };
    this.rafId = requestAnimationFrame(raf);
    try {
      this.ticker = new Worker(new URL('./ticker.ts', import.meta.url), { type: 'module' });
      this.ticker.onmessage = () => {
        if (!this.disposed && performance.now() - this.lastTick > 70) this.tick(false);
      };
    } catch {
      this.ticker = null;
    }
  }

  private tick(fromRaf: boolean) {
    const nowP = performance.now();
    const gap = (nowP - this.lastTick) / 1000;
    this.lastTick = nowP;
    if (gap > 0.25) {
      // Catch up after the page was paused, so nothing looks frozen when you come back.
      let left = Math.min(gap, 180);
      while (left > 0) {
        const step = Math.min(0.1, left);
        this.simulate(step);
        left -= step;
      }
    } else this.simulate(gap);
    if (document.hidden) return;
    if (fromRaf) this.adaptQuality(gap);
    this.render(Math.min(gap, 0.1));
  }

  /** Lowers the resolution when frames get slow, raises it again when there is headroom. */
  private adaptQuality(gap: number) {
    this.frameTimes.push(gap);
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    const now = performance.now();
    if (now - this.lastQualityChange < 2500) return;
    let next = this.pixelRatio;
    if (avg > 1 / 38 && this.pixelRatio > 0.6) next = Math.max(0.6, this.pixelRatio - 0.2);
    else if (avg < 1 / 56 && this.pixelRatio < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.lastQualityChange = now;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  private simulate(dt: number) {
    const now = this.sim.clock();
    this.elevator.update(dt, this.sim.hooks);
    this.sim.update(dt, now);
    if (this.mode === 'orbit' && this.autoIdle && !document.hidden && performance.now() - this.lastInput > AUTO_IDLE_MS) this.setMode('tour');
  }

  private render(dt: number) {
    const now = this.sim.clock();
    const t = performance.now() / 1000;

    if (now - this.lastLight > 60_000) {
      this.lastLight = now;
      this.applyTimeOfDay(now);
    }
    this.env.update(t);
    this.desks.set(this.sim.activeScreens());
    this.desks.update(t);
    this.neoScreen.update(now);
    this.updateEffects(t);

    if (this.mode === 'boss') {
      const c = this.sim.boss;
      if (!c) this.setMode('orbit');
      else {
        const wasArrived = c.mode === 'player';
        this.player.update(dt, c, c.mode === 'player', c.mode === 'hidden' ? this.elevator.y + 0.02 : c.y);
        c.person.setHeadVisible(this.player.view !== 'fpv' || c.mode !== 'player');
        if (!wasArrived && c.mode === 'player') this.emitBoss();
      }
    } else if (this.mode === 'free') this.freeFly.update(dt);
    else if (this.mode === 'tour') {
      this.tour.update(dt);
      this.sim.hoverId = this.tour.focusId;
    } else if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt * 1.4);
      const e = 1 - Math.pow(1 - a.t, 3);
      this.controls.target.lerpVectors(a.fromT, a.toT, e);
      this.camera.position.lerpVectors(a.fromP, a.toP, e);
      if (a.t >= 1) this.camAnim = null;
    } else if (this.follow && this.sim.selectedId) {
      const c = this.sim.chars.get(this.sim.selectedId);
      if (c) {
        const target = new THREE.Vector3(c.x, c.y + 1, c.z);
        const delta = target.sub(this.controls.target).multiplyScalar(Math.min(1, dt * 3));
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      }
    }
    if (this.mode === 'orbit') this.controls.update();
    this.updateLabels();
    this.renderer.shadowMap.needsUpdate = this.frameCount++ % 2 === 0;
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private updateEffects(t: number) {
    const brewing = this.sim.brewing();
    this.steam.forEach((s, i) => {
      const spot = brewing[i % Math.max(1, brewing.length)];
      s.visible = Boolean(spot) && i < brewing.length * 3;
      if (!spot) return;
      const k = (t * 0.6 + i * 0.33) % 1;
      s.position.set(spot.x - 0.9 + Math.sin(t + i) * 0.04, 1.5 + k * 0.6, spot.z + 0.15);
      (s.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - k);
      s.scale.setScalar(0.15 + k * 0.25);
    });
    const chill = this.layout.zones.get('chill')!;
    this.ball.visible = this.sim.playing();
    if (this.ball.visible) {
      const k = (Math.sin(t * 3.4) + 1) / 2;
      this.ball.position.set(chill.x0 + 3.5 - 1.3 + k * 2.6, 0.8 + Math.abs(Math.sin(t * 6.8)) * 0.35, chill.z0 + 3.0 + Math.sin(t * 1.7) * 0.3);
    }
  }

  private updateLabels() {
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const counts = new Map<string, number>();
    for (const c of this.sim.chars.values()) {
      const l = this.labelsById.get(c.id);
      if (!l) continue;
      const p = this.sim.labelPos(c);
      l.obj.position.set(p.x, p.y, p.z);
      const visible = c.person.root.visible && c.mode !== 'hidden' && !(c.id === BOSS_ID && this.mode === 'boss' && this.player.view === 'fpv');
      l.obj.visible = visible;
      if (!visible) continue;
      if (c.mode === 'acting' || c.mode === 'walking') counts.set(c.act?.seat?.room ?? c.agent.room, (counts.get(c.act?.seat?.room ?? c.agent.room) ?? 0) + 1);
      const selected = c.id === this.sim.selectedId;
      const hovered = c.id === this.sim.hoverId;
      const showTag = selected || hovered || this.tagMode === 'all' || (this.tagMode === 'auto' && camDist < 95);
      l.tag.style.display = showTag ? '' : 'none';
      l.root.classList.toggle('selected', selected);
      l.root.classList.toggle('waiting', c.agent.status === 'waiting');
      l.name.textContent = c.id === BOSS_ID ? '👔 You (boss)' : c.agent.persona || 'Agent';
      const sub = selected || hovered ? `${c.agent.kind === 'subagent' ? '↳ ' : ''}${c.agent.name}` : '';
      if (sub !== l.lastSub) {
        l.sub.textContent = sub;
        l.sub.style.display = sub ? '' : 'none';
        l.lastSub = sub;
      }
      const b = c.bubble;
      const key = b ? `${b.kind}:${b.text}` : '';
      if (key !== l.lastBubble) {
        l.bubble.textContent = b?.text ?? '';
        l.bubble.className = `ao-bubble${b ? ` show ${b.kind}` : ''}`;
        l.lastBubble = key;
      }
    }
    for (const r of this.roomLabels) {
      const n = counts.get(r.id) ?? 0;
      r.count.textContent = n ? String(n) : '';
      r.el.classList.toggle('far', camDist > 150);
      r.el.classList.toggle('compact', camDist > 70);
    }
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
