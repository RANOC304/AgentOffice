// The giant BrowserOS neo wall screen (live pages and screenshots) and the desk monitors.

import * as THREE from 'three';
import { PROVIDER_META, ROOM_BY_ID, type RoomId } from '../../../shared/rooms.ts';
import type { AgentSnapshot, NeoPage } from '../../../shared/types.ts';
import type { Seat } from './layout.ts';

const FONT = '"Atkinson Hyperlegible", "Segoe UI", sans-serif';

function host(url?: string) {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

export class NeoScreen {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private pages: NeoPage[] = [];
  private agents = new Map<string, AgentSnapshot>();
  private images = new Map<string, HTMLImageElement>();
  private dirty = true;
  private lastDraw = 0;

  constructor(width: number, height: number) {
    this.canvas.width = 2048;
    this.canvas.height = Math.round((2048 * height) / width);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
  }

  set(pages: NeoPage[], agents: AgentSnapshot[]) {
    const key = JSON.stringify(pages.map((p) => [p.sessionId, p.url, p.title, p.shot, p.persona, p.at]));
    const prev = JSON.stringify(this.pages.map((p) => [p.sessionId, p.url, p.title, p.shot, p.persona, p.at]));
    this.agents = new Map(agents.map((a) => [a.id, a]));
    if (key === prev) return;
    this.pages = pages.slice(0, 6);
    for (const p of this.pages) {
      if (p.shot && !this.images.has(p.shot)) {
        const img = new Image();
        img.onload = () => (this.dirty = true);
        img.src = p.shot;
        this.images.set(p.shot, img);
      }
    }
    if (this.images.size > 40) for (const k of [...this.images.keys()].slice(0, 20)) this.images.delete(k);
    this.dirty = true;
  }

  update(now: number) {
    if (!this.dirty && now - this.lastDraw < 5000) return;
    this.dirty = false;
    this.lastDraw = now;
    this.draw(now);
    this.texture.needsUpdate = true;
  }

  private draw(now: number) {
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d1a22');
    bg.addColorStop(1, '#10262a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Header.
    ctx.fillStyle = '#1f9e8f';
    ctx.fillRect(0, 0, W, 6);
    ctx.font = `700 46px ${FONT}`;
    ctx.fillStyle = '#e8fffb';
    ctx.textBaseline = 'middle';
    ctx.fillText('BrowserOS neo · live pages', 48, 58);
    ctx.font = `400 32px ${FONT}`;
    ctx.fillStyle = '#8fd6cc';
    const live = this.pages.filter((p) => now - p.at < 120_000).length;
    const status = this.pages.length ? `${live} browsing now · ${this.pages.length} recent` : 'No agent is browsing right now';
    ctx.textAlign = 'right';
    ctx.fillText(`${status}   ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, W - 48, 58);
    ctx.textAlign = 'left';

    const top = 110;
    const pages = this.pages;
    if (!pages.length) {
      ctx.font = `400 40px ${FONT}`;
      ctx.fillStyle = '#5f8f88';
      ctx.textAlign = 'center';
      ctx.fillText('When an agent opens a page in BrowserOS neo, it appears here.', W / 2, H / 2 + 20);
      ctx.textAlign = 'left';
      return;
    }
    const n = pages.length;
    const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const gap = 28;
    const tw = (W - 48 * 2 - gap * (cols - 1)) / cols;
    const th = (H - top - 36 - gap * (rows - 1)) / rows;
    pages.forEach((p, i) => {
      const x = 48 + (i % cols) * (tw + gap);
      const y = top + Math.floor(i / cols) * (th + gap);
      const agent = p.agentId ? this.agents.get(p.agentId) : undefined;
      const color = agent ? PROVIDER_META[agent.provider].color : '#1f9e8f';
      const active = now - p.at < 120_000;
      // Window chrome.
      ctx.save();
      roundRect(ctx, x, y, tw, th, 18);
      ctx.fillStyle = '#f3f5f7';
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = '#dfe4ea';
      ctx.fillRect(x, y, tw, 64);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 34, y + 32, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 28px ${FONT}`;
      ctx.fillStyle = '#1d2530';
      ctx.fillText(fit(ctx, p.title || host(p.url) || 'Page', tw - 120), x + 58, y + 33);
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, x + 16, y + 74, tw - 32, 40, 20);
      ctx.fill();
      ctx.font = `400 24px ${FONT}`;
      ctx.fillStyle = '#4b5563';
      ctx.fillText(fit(ctx, p.url ?? '', tw - 70), x + 36, y + 95);
      // Page body: screenshot when Neo saved one.
      const bodyY = y + 124;
      const bodyH = th - 124 - 70;
      const img = p.shot ? this.images.get(p.shot) : undefined;
      if (img && img.complete && img.naturalWidth) {
        const scale = Math.max(tw / img.naturalWidth, bodyH / img.naturalHeight);
        const iw = img.naturalWidth * scale;
        ctx.drawImage(img, x + (tw - iw) / 2, bodyY, iw, img.naturalHeight * scale);
      } else {
        ctx.fillStyle = '#e9edf1';
        ctx.fillRect(x, bodyY, tw, bodyH);
        ctx.fillStyle = '#c7cfd8';
        for (let k = 0; k < 6; k++) ctx.fillRect(x + 40, bodyY + 40 + k * 46, (tw - 80) * (0.4 + ((k * 37) % 50) / 100), 22);
        ctx.font = `700 52px ${FONT}`;
        ctx.fillStyle = '#9aa6b2';
        ctx.textAlign = 'center';
        ctx.fillText(fit(ctx, host(p.url) || 'Browsing', tw - 60), x + tw / 2, bodyY + bodyH - 60);
        ctx.textAlign = 'left';
      }
      // Footer: who is browsing.
      ctx.fillStyle = 'rgba(16,22,30,0.92)';
      ctx.fillRect(x, y + th - 70, tw, 70);
      ctx.fillStyle = color;
      ctx.fillRect(x, y + th - 70, 8, 70);
      ctx.font = `700 30px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      const who = p.persona ? `${p.persona}${agent ? ` · ${PROVIDER_META[agent.provider].short}` : ''}` : p.client;
      ctx.fillText(fit(ctx, who, tw * 0.6), x + 26, y + th - 35);
      ctx.font = `400 26px ${FONT}`;
      ctx.fillStyle = active ? '#7ff0c2' : '#9aa6b2';
      ctx.textAlign = 'right';
      ctx.fillText(`${active ? '● live' : ago(p.at)} · ${p.actions} actions`, x + tw - 22, y + th - 35);
      ctx.textAlign = 'left';
      ctx.restore();
    });
  }
}

/** Shared monitor materials: a dark "off" screen, and per-room code screens that scroll. */
export class DeskScreens {
  private off = new THREE.MeshStandardMaterial({ color: '#0e1116', roughness: 0.2, metalness: 0.3 });
  private on = new Map<RoomId, THREE.MeshBasicMaterial>();
  private meshes = new Map<string, THREE.Mesh>();
  readonly group = new THREE.Group();

  constructor(seats: Seat[]) {
    const geo = new THREE.PlaneGeometry(0.58, 0.33);
    for (const s of seats) {
      if (!s.screen) continue;
      const m = new THREE.Mesh(geo, this.off);
      m.position.set(s.screen.x, 1.06, s.screen.z);
      m.rotation.y = s.screen.rot;
      this.group.add(m);
      this.meshes.set(s.id, m);
    }
  }

  private material(room: RoomId): THREE.MeshBasicMaterial {
    let m = this.on.get(room);
    if (!m) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const ctx = c.getContext('2d')!;
      const accent = ROOM_BY_ID[room]?.accent ?? '#4f9cc4';
      if (room === 'browser') {
        ctx.fillStyle = '#eef3f6';
        ctx.fillRect(0, 0, 128, 256);
        for (let y = 0; y < 256; y += 64) {
          ctx.fillStyle = '#1f9e8f';
          ctx.fillRect(0, y, 128, 8);
          ctx.fillStyle = '#c9d3dc';
          for (let k = 0; k < 4; k++) ctx.fillRect(10, y + 16 + k * 10, 40 + ((k * 23) % 60), 5);
          ctx.fillStyle = '#9fd8cf';
          ctx.fillRect(70, y + 16, 48, 36);
        }
      } else {
        ctx.fillStyle = '#121821';
        ctx.fillRect(0, 0, 128, 256);
        const palette = [accent, '#9ad0ff', '#f2c96b', '#8fd18f', '#e2e8f0'];
        for (let y = 4; y < 256; y += 9) {
          const indent = ((y * 7) % 4) * 8;
          ctx.fillStyle = palette[(y * 13) % palette.length];
          ctx.fillRect(6 + indent, y, 20 + ((y * 31) % 70), 4);
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1, 0.5);
      m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.on.set(room, m);
    }
    return m;
  }

  /** Lights the monitors of the seats where someone is working. */
  set(active: Map<string, RoomId>) {
    for (const [id, mesh] of this.meshes) {
      const room = active.get(id);
      mesh.material = room ? this.material(room) : this.off;
    }
  }

  update(t: number) {
    for (const m of this.on.values()) if (m.map) m.map.offset.y = (t * 0.05) % 1;
  }
}
