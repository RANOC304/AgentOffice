// Draws the office: sky, floating island, floors, walls, furniture, characters and overlays.

import { PROVIDER_META, ROOM_BY_ID, ROOMS, type RoomId } from '../../../shared/rooms.ts';
import { characterSprite, FOOT_X, FOOT_Y, SPRITE_W } from './character.ts';
import { furnitureSprite, type Sprite } from './furniture.ts';
import { box, ctx2d, dot, faceX, faceY, fillPoly, iso, makeCanvas, mix, type Painter, quad, rgba, rng, shade } from './iso.ts';
import { CH, CW, GH, H, idx, type Item, outdoorItems, W } from './map.ts';
import type { Character, World } from './world.ts';

export const UI_FONT = '"Pixelify Sans", "Segoe UI", sans-serif';

interface StaticDrawable {
  key: number;
  sprite: Sprite;
  x: number; // world px of the tile's top vertex
  y: number;
  item?: Item;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

export interface RenderOptions {
  labels: 'auto' | 'all' | 'none';
  now: number;
}

const WALL_H = 46;
const PART_H = 12;
const GLASS_H = 10;
const CLIFF = 44;

export class OfficeRenderer {
  readonly world: World;
  private staticLayer: { canvas: HTMLCanvasElement; ox: number; oy: number };
  private drawables: StaticDrawable[] = [];
  private clouds: Array<{ sprite: HTMLCanvasElement; x: number; y: number; speed: number }> = [];
  hits: Hit[] = [];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(world: World) {
    this.world = world;
    this.staticLayer = this.buildStatic();
    this.buildDrawables();
    this.buildClouds();
    const s = this.staticLayer;
    this.bounds = { minX: -s.ox, minY: -s.oy, maxX: s.canvas.width - s.ox, maxY: s.canvas.height - s.oy };
  }

  // ---------------------------------------------------------------- static layer

  private buildStatic() {
    const minTile = { x: -3, y: -3 };
    const maxTile = { x: W + 3, y: GH + 1 };
    const left = iso(minTile.x, maxTile.y).x - 4;
    const right = iso(maxTile.x, minTile.y).x + 4;
    const top = iso(minTile.x, minTile.y).y - 80;
    const bottom = iso(maxTile.x, maxTile.y).y + CLIFF + 40;
    const canvas = makeCanvas(right - left, bottom - top);
    const ctx = ctx2d(canvas);
    const ox = -left;
    const oy = -top;
    const p: Painter = { ctx, ox, oy };
    const map = this.world.map;
    const r = rng(42);

    // Floating island: grass top, layered dirt sides, rocky underside.
    const islandW = maxTile.x - minTile.x;
    const islandD = maxTile.y - minTile.y;
    const L = iso(minTile.x, maxTile.y, -CLIFF);
    const F = iso(maxTile.x, maxTile.y, -CLIFF);
    const R = iso(maxTile.x, minTile.y, -CLIFF);
    for (let i = 0; i < 5; i++) {
      const k = 0.98 - i * 0.17;
      const sink = i * 9;
      const tipX = F.x + (r() - 0.5) * 60;
      fillPoly(
        ctx,
        [
          { x: ox + F.x + (L.x - F.x) * k, y: oy + F.y + (L.y - F.y) * k + sink - 2 },
          { x: ox + F.x, y: oy + F.y + sink - 2 },
          { x: ox + F.x + (R.x - F.x) * k, y: oy + F.y + (R.y - F.y) * k + sink - 2 },
          { x: ox + tipX + (R.x - F.x) * k * 0.35, y: oy + F.y + 26 + sink * 1.6 },
          { x: ox + tipX, y: oy + F.y + 44 + sink * 1.8 },
          { x: ox + tipX + (L.x - F.x) * k * 0.35, y: oy + F.y + 26 + sink * 1.6 },
        ],
        shade('#8a5d40', -0.12 - i * 0.07),
      );
    }
    box(p, minTile.x, minTile.y, -CLIFF, islandW, islandD, CLIFF, { top: '#8ccf72', left: '#a87452', right: '#8a5d40' });
    for (const [z, color] of [
      [-12, '#9a6a4a'],
      [-24, '#93613f'],
      [-34, '#7f5236'],
    ] as Array<[number, string]>) {
      faceY(p, minTile.x, maxTile.y, z - 3, islandW, 3, color);
      faceX(p, maxTile.x, minTile.y, z - 3, islandD, 3, shade(color, -0.15));
    }
    faceY(p, minTile.x, maxTile.y, -5, islandW, 5, '#79b862');
    faceX(p, maxTile.x, minTile.y, -5, islandD, 5, '#6aa555');
    for (let i = 0; i < 26; i++) {
      faceY(p, minTile.x + r() * islandW, maxTile.y, -5 - r() * 4, 0.15, 3, '#79b862');
      faceX(p, maxTile.x, minTile.y + r() * islandD, -5 - r() * 4, 0.15, 3, '#6aa555');
    }
    // Grass texture and flowers.
    for (let i = 0; i < 900; i++) {
      const x = minTile.x + r() * islandW;
      const y = minTile.y + r() * islandD;
      if (x > -0.3 && x < W + 0.3 && y > -0.3 && y < H + 0.3) continue;
      const roll = r();
      dot(p, x, y, 0, roll < 0.04 ? ['#f08cae', '#fff3b0', '#ffffff'][Math.floor(r() * 3)] : roll < 0.5 ? '#7cc163' : '#9ad97e');
    }
    // Stone path from the island edge to the entrance.
    for (let y = H; y <= GH; y++) {
      for (let x = map.door.x - 1; x <= map.door.x + 1; x++) quad(p, x + 0.08, y + 0.08, 0, 0.84, 0.84, (x + y) % 2 ? '#d8d2c4' : '#cfc8b8');
    }

    // Floors.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const room = map.roomOf[idx(x, y)];
        let color: string;
        if (room) {
          const def = ROOM_BY_ID[room];
          color = (x + y) % 2 ? def.floor : def.floorAlt;
        } else {
          const near = neighbourRoom(map.roomOf, x, y);
          color = near ? shade(ROOM_BY_ID[near].floorAlt, -0.06) : '#ddd6c8';
        }
        quad(p, x, y, 0, 1, 1, color);
      }
    }
    // Rugs.
    const rug = (room: RoomId, x: number, y: number, w: number, d: number, color: string, border: string) => {
      const a = map.rooms.get(room)!;
      quad(p, a.x0 + x, a.y0 + y, 0, w, d, border);
      quad(p, a.x0 + x + 0.15, a.y0 + y + 0.15, 0, w - 0.3, d - 0.3, color);
    };
    rug('lounge', 1.6, 1.6, 3.8, 2.8, '#e8b77a', '#c98b5b');
    rug('design', 1.7, 1.7, 3.6, 2.6, '#f7c6e0', '#d77fb8');
    rug('browser', 1.8, 1.6, 3.4, 2.8, '#a8e6dc', '#2bb5a0');
    rug('research', 1.8, 1.8, 3.4, 2.4, '#e9d59b', '#c9a85a');
    rug('lobby', 2.6, 4.1, 2.8, 1.9, '#b9cfb2', '#5e8455');
    rug('gamedev', 1.8, 1.8, 3.4, 2.4, '#f3b6c8', '#c4527a');

    // Trees behind the building.
    for (const item of outdoorItems().filter((i) => i.x < 0 || i.y < 0).sort((a, b) => a.x + a.y - (b.x + b.y))) {
      const s = furnitureSprite(item);
      const at = iso(item.x, item.y);
      ctx.drawImage(s.canvas, Math.round(ox + at.x - s.ax), Math.round(oy + at.y - s.ay));
    }

    // Tall back walls with windows.
    const backTiles: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.wall[idx(x, y)] === 2) backTiles.push({ x, y });
    backTiles.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
    for (const t of backTiles) {
      const near = neighbourRoom(map.roomOf, t.x + 1, t.y + 1) ?? neighbourRoom(map.roomOf, t.x, t.y);
      const def = near ? ROOM_BY_ID[near] : ROOMS[0];
      const face = mix(def.wall, '#ffffff', 0.72);
      box(p, t.x, t.y, 0, 1, 1, WALL_H, { top: '#efe6d6', left: shade(face, -0.06), right: face });
      if (t.x === 0 && t.y > 0) {
        faceX(p, 1, t.y, 0, 1, 4, def.wall);
        if (t.y % CH !== 0) {
          faceX(p, 1.001, t.y + 0.18, 16, 0.64, 22, '#ffffff');
          faceX(p, 1.002, t.y + 0.24, 18, 0.52, 18, '#bfe3f2');
          faceX(p, 1.003, t.y + 0.24, 27, 0.52, 1, '#ffffff');
          faceX(p, 1.003, t.y + 0.49, 18, 0.03, 18, '#ffffff');
        } else faceX(p, 1.001, t.y + 0.3, 4, 0.4, WALL_H - 4, shade(face, -0.08));
      }
      if (t.y === 0 && t.x > 0) {
        faceY(p, t.x, 1, 0, 1, 4, def.wall);
        if (t.x % CW !== 0) {
          faceY(p, t.x + 0.18, 1.001, 16, 0.64, 22, '#ffffff');
          faceY(p, t.x + 0.24, 1.002, 18, 0.52, 18, '#bfe3f2');
          faceY(p, t.x + 0.24, 1.003, 27, 0.52, 1, '#ffffff');
          faceY(p, t.x + 0.49, 1.003, 18, 0.03, 18, '#ffffff');
        } else faceY(p, t.x + 0.3, 1.001, 4, 0.4, WALL_H - 4, shade(face, -0.08));
      }
    }
    return { canvas, ox, oy };
  }

  // ---------------------------------------------------------------- dynamic drawables

  private buildDrawables() {
    const map = this.world.map;
    const list: StaticDrawable[] = [];
    for (const item of map.items) {
      const sprite = furnitureSprite(item);
      const at = iso(item.x, item.y);
      let key = item.x + item.y + 1;
      if (item.type === 'chair' || item.type === 'sofa' || item.type === 'stool') key += item.facing === 1 ? -0.02 : 0.02;
      list.push({ key, sprite, x: at.x, y: at.y, item });
    }
    for (const item of outdoorItems().filter((i) => i.x >= 0 && i.y >= 0)) {
      const at = iso(item.x, item.y);
      list.push({ key: item.x + item.y + 1, sprite: furnitureSprite(item), x: at.x, y: at.y, item });
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const type = map.wall[idx(x, y)];
        if (type !== 1 && type !== 3) continue;
        const isWall = (wx: number, wy: number) => wx >= 0 && wy >= 0 && wx < W && wy < H && map.wall[idx(wx, wy)] > 0;
        const mask = (isWall(x - 1, y) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) | (isWall(x, y - 1) ? 4 : 0) | (isWall(x, y + 1) ? 8 : 0);
        const room = map.roomOf[idx(x + 1, y)] ?? map.roomOf[idx(x, y + 1)] ?? neighbourRoom(map.roomOf, x, y);
        const color = room ? ROOM_BY_ID[room].wall : '#8fae86';
        const at = iso(x, y);
        list.push({ key: x + y + 1.01, sprite: wallSprite(type, mask, color), x: at.x, y: at.y });
      }
    }
    this.drawables = list;
  }

  private buildClouds() {
    const r = rng(7);
    for (let i = 0; i < 7; i++) {
      const w = 40 + Math.floor(r() * 50);
      const h = 12 + Math.floor(r() * 10);
      const c = makeCanvas(w, h + 4);
      const ctx = ctx2d(c);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(4, h - 2, w - 8, 4);
      ctx.fillStyle = '#ffffff';
      for (let k = 0; k < 5; k++) {
        const bw = Math.floor(w * (0.25 + r() * 0.3));
        const bx = Math.floor(r() * (w - bw));
        const bh = Math.floor(h * (0.4 + r() * 0.6));
        ctx.fillRect(bx, h - bh, bw, bh);
      }
      ctx.fillRect(2, h - 4, w - 4, 4);
      this.clouds.push({ sprite: c, x: r() * 2000, y: r(), speed: 4 + r() * 8 });
    }
  }

  // ---------------------------------------------------------------- frame

  draw(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, dpr: number, cam: Camera, opts: RenderOptions) {
    const now = opts.now;
    const hour = new Date(now).getHours() + new Date(now).getMinutes() / 60;
    const sky = skyFor(hour);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(1, sky.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssW, cssH);
    if (sky.night) {
      const r = rng(99);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 90; i++) {
        const twinkle = (Math.sin(now / 700 + i) + 1) / 2;
        if (twinkle < 0.25) continue;
        ctx.fillRect(Math.floor(r() * cssW), Math.floor(r() * cssH * 0.8), 1 + (i % 7 === 0 ? 1 : 0), 1 + (i % 7 === 0 ? 1 : 0));
      }
    }
    for (const cloud of this.clouds) {
      const span = cssW + 300;
      const x = ((cloud.x + (now / 1000) * cloud.speed - cam.x * 0.15) % span + span) % span - 150;
      const y = cloud.y * cssH * 0.9 - cam.y * 0.1 * cam.zoom;
      ctx.globalAlpha = sky.night ? 0.25 : 0.85;
      ctx.drawImage(cloud.sprite, Math.round(x), Math.round(y), cloud.sprite.width * 2, cloud.sprite.height * 2);
      ctx.globalAlpha = 1;
    }

    // World space.
    const z = cam.zoom * dpr;
    const tx = (cssW / 2 - cam.x * cam.zoom) * dpr;
    const ty = (cssH / 2 - cam.y * cam.zoom) * dpr;
    ctx.setTransform(z, 0, 0, z, tx, ty);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.staticLayer.canvas, -this.staticLayer.ox, -this.staticLayer.oy);

    const world = this.world;
    type Entry = { key: number; draw: () => void };
    const entries: Entry[] = [];
    for (const d of this.drawables) {
      entries.push({
        key: d.key,
        draw: () => {
          ctx.drawImage(d.sprite.canvas, Math.round(d.x - d.sprite.ax), Math.round(d.y - d.sprite.ay));
          if (d.item?.type === 'globe') drawHolo(ctx, d.x, d.y, now);
        },
      });
    }
    const screenOf = (wx: number, wy: number) => ({ x: (wx - cam.x) * cam.zoom + cssW / 2, y: (wy - cam.y) * cam.zoom + cssH / 2 });
    const heads = new Map<string, { x: number; y: number; c: Character }>();
    this.hits = [];
    for (const c of world.chars.values()) {
      const foot = iso(c.x + 0.5, c.y + 0.5);
      const sitting = c.mode === 'sit';
      const lift = sitting ? 8 : 0;
      const pose = world.pose(c, now);
      const sprite = characterSprite(c.look, c.view, pose);
      const sx = Math.round(foot.x - FOOT_X);
      const sy = Math.round(foot.y - FOOT_Y - lift);
      const key = c.x + c.y + 1 + (sitting ? 0 : 0.005);
      const selected = c.id === world.selectedId;
      const hovered = c.id === world.hoverId;
      entries.push({
        key,
        draw: () => {
          ctx.globalAlpha = c.alpha;
          if (selected || hovered) {
            const color = PROVIDER_META[c.agent.provider].color;
            const p: Painter = { ctx, ox: foot.x, oy: foot.y };
            fillPoly(ctx, diamond(p, 0.42), rgba(color, selected ? 0.55 : 0.3));
          } else {
            ctx.fillStyle = 'rgba(40,30,60,0.18)';
            ctx.fillRect(Math.round(foot.x - 5), Math.round(foot.y - 1), 10, 2);
          }
          if (c.flip) {
            ctx.save();
            ctx.translate(sx + SPRITE_W, sy);
            ctx.scale(-1, 1);
            ctx.drawImage(sprite, 0, 0);
            ctx.restore();
          } else ctx.drawImage(sprite, sx, sy);
          ctx.globalAlpha = 1;
          if (c.mode === 'sit' && c.agent.status === 'working' && c.seat?.desk?.screenFront) drawTyping(ctx, c.seat.desk, now, c.phase);
        },
      });
      const head = screenOf(foot.x, sy);
      heads.set(c.id, { x: head.x, y: head.y, c });
      const tl = screenOf(sx, sy);
      this.hits.push({ id: c.id, x: tl.x, y: tl.y, w: SPRITE_W * cam.zoom, h: (FOOT_Y + 1) * cam.zoom, depth: key });
    }
    entries.sort((a, b) => a.key - b.key);
    for (const e of entries) e.draw();

    if (sky.tint) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = sky.tint;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // Screen-space overlays.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawRoomLabels(ctx, cam, cssW, cssH);
    this.drawLinks(ctx, heads);
    const ordered = [...heads.values()].sort((a, b) => a.y - b.y);
    for (const h of ordered) this.drawTag(ctx, h.c, h.x, h.y, cam, opts);
    for (const h of ordered) if (h.c.bubble && h.c.alpha > 0.5) drawBubble(ctx, h.c, h.x, h.y - this.tagOffset(h.c, cam, opts), now);
  }

  private tagOffset(c: Character, cam: Camera, opts: RenderOptions): number {
    return this.showTag(c, cam, opts) ? 22 : 8;
  }

  private showTag(c: Character, cam: Camera, opts: RenderOptions): boolean {
    if (c.id === this.world.selectedId || c.id === this.world.hoverId) return true;
    if (opts.labels === 'none') return false;
    if (opts.labels === 'all') return true;
    return cam.zoom >= 0.95 && (c.agent.status === 'working' || c.agent.status === 'waiting');
  }

  private drawTag(ctx: CanvasRenderingContext2D, c: Character, x: number, y: number, cam: Camera, opts: RenderOptions) {
    const now = opts.now;
    ctx.globalAlpha = c.alpha;
    if (c.agent.status === 'waiting' && !c.leaving) {
      const bounce = Math.round(Math.abs(Math.sin(now / 220)) * 4);
      pixelBox(ctx, x - 6, y - 34 - bounce, 12, 14, '#ffcf4a', '#3a2a10');
      ctx.fillStyle = '#3a2a10';
      ctx.font = `bold 11px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - 23 - bounce);
    }
    if (this.showTag(c, cam, opts)) {
      ctx.font = `11px ${UI_FONT}`;
      const prefix = c.agent.kind === 'subagent' ? '↳ ' : '';
      const name = truncate(prefix + c.agent.name, 24);
      const w = Math.ceil(ctx.measureText(name).width) + 16;
      const tx = Math.round(x - w / 2);
      const ty = Math.round(y - 18);
      pixelBox(ctx, tx, ty, w, 14, 'rgba(255,255,255,0.94)', '#2a2230');
      ctx.fillStyle = PROVIDER_META[c.agent.provider].color;
      ctx.fillRect(tx + 3, ty + 4, 6, 6);
      if (c.agent.status === 'working') {
        ctx.fillStyle = Math.floor(now / 400) % 2 ? '#3fbf6a' : '#8ee0a8';
        ctx.fillRect(tx + 5, ty + 6, 2, 2);
      }
      ctx.fillStyle = '#2a2230';
      ctx.textAlign = 'left';
      ctx.fillText(name, tx + 12, ty + 11);
    }
    ctx.globalAlpha = 1;
  }

  private drawLinks(ctx: CanvasRenderingContext2D, heads: Map<string, { x: number; y: number; c: Character }>) {
    const selected = this.world.selectedId;
    if (!selected) return;
    const me = heads.get(selected);
    if (!me) return;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    for (const other of heads.values()) {
      const linked = other.c.agent.parentId === selected || me.c.agent.parentId === other.c.id;
      if (!linked) continue;
      ctx.strokeStyle = rgba(PROVIDER_META[me.c.agent.provider].color, 0.85);
      ctx.beginPath();
      ctx.moveTo(me.x, me.y + 6);
      ctx.lineTo(other.x, other.y + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRoomLabels(ctx: CanvasRenderingContext2D, cam: Camera, cssW: number, cssH: number) {
    if (cam.zoom < 0.5) return;
    const occupancy = this.world.occupancy();
    ctx.font = `12px ${UI_FONT}`;
    ctx.textAlign = 'left';
    for (const area of this.world.map.rooms.values()) {
      const def = area.def;
      const at = iso(area.x0 + 0.6, area.y0 + 0.6, 34);
      const sx = Math.round((at.x - cam.x) * cam.zoom + cssW / 2);
      const sy = Math.round((at.y - cam.y) * cam.zoom + cssH / 2);
      const count = occupancy.get(def.id) ?? 0;
      const label = cam.zoom < 0.8 ? def.short : def.label;
      const textW = Math.ceil(ctx.measureText(label).width);
      const countText = count ? String(count) : '';
      const countW = count ? Math.ceil(ctx.measureText(countText).width) + 8 : 0;
      const w = 22 + textW + 8 + countW;
      const x = sx - Math.round(w / 2);
      const y = sy - 10;
      pixelBox(ctx, x, y, w, 20, 'rgba(255,255,255,0.95)', shade(def.wall, -0.35));
      ctx.fillStyle = def.wall;
      ctx.fillRect(x + 3, y + 3, 14, 14);
      ctx.font = `10px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(def.icon, x + 10, y + 14);
      ctx.font = `12px ${UI_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#2a2230';
      ctx.fillText(label, x + 21, y + 14);
      if (count) {
        pixelBox(ctx, x + w - countW - 3, y + 3, countW, 14, def.wall, def.wall);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(countText, x + w - countW + 1, y + 14);
      }
    }
  }

  /** Topmost character under a CSS-pixel point. */
  pick(x: number, y: number): string | null {
    let best: Hit | null = null;
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h && (!best || h.depth > best.depth)) best = h;
    }
    return best?.id ?? null;
  }

  /** World position of a character's head, for camera follow. */
  focusOf(id: string): { x: number; y: number } | null {
    const c = this.world.chars.get(id);
    if (!c) return null;
    const p = iso(c.x + 0.5, c.y + 0.5);
    return { x: p.x, y: p.y - 14 };
  }
}

// ---------------------------------------------------------------- helpers

function neighbourRoom(roomOf: (RoomId | null)[], x: number, y: number): RoomId | null {
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const r = roomOf[idx(nx, ny)];
    if (r) return r;
  }
  return null;
}

const wallCache = new Map<string, Sprite>();
function wallSprite(type: number, mask: number, color: string): Sprite {
  const key = `${type}:${mask}:${color}`;
  const hit = wallCache.get(key);
  if (hit) return hit;
  const height = type === 3 ? GLASS_H : PART_H;
  const canvas = makeCanvas(40, height + 20);
  const ctx = ctx2d(canvas);
  const p: Painter = { ctx, ox: 20, oy: height + 2 };
  const t = 0.3;
  const a = (1 - t) / 2;
  const colors =
    type === 3
      ? { top: '#e9f6fb', left: 'rgba(190,230,245,0.55)', right: 'rgba(160,210,230,0.55)' }
      : { top: shade(color, 0.35), left: color, right: shade(color, -0.2) };
  if (mask & 1) box(p, 0, a, 0, a, t, height, colors);
  if (mask & 4) box(p, a, 0, 0, t, a, height, colors);
  box(p, a, a, 0, t, t, height, colors);
  if (mask & 2) box(p, a + t, a, 0, a, t, height, colors);
  if (mask & 8) box(p, a, a + t, 0, t, a, height, colors);
  const sprite = { canvas, ax: 20, ay: height + 2 };
  wallCache.set(key, sprite);
  return sprite;
}

function diamond(p: Painter, r: number) {
  const c = (x: number, y: number) => {
    const s = iso(x, y);
    return { x: p.ox + s.x, y: p.oy + s.y };
  };
  return [c(-r, -r), c(r, -r), c(r, r), c(-r, r)];
}

function drawHolo(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  const cx = Math.round(x);
  const cy = Math.round(y + 8 - 22 + Math.sin(now / 600) * 1.5);
  const R = 7;
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    ctx.fillStyle = `rgba(80, 230, 205, ${0.35 + 0.1 * Math.sin(now / 300 + dy)})`;
    ctx.fillRect(cx - half, cy + dy, half * 2, 1);
  }
  ctx.fillStyle = 'rgba(220,255,250,0.9)';
  const shift = Math.floor(now / 160) % (R * 2);
  for (let dy = -R + 1; dy < R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    const mx = cx - half + ((shift + dy * 0) % (half * 2 || 1));
    ctx.fillRect(mx, cy + dy, 1, 1);
  }
  ctx.fillRect(cx - R, cy, R * 2, 1);
  ctx.fillStyle = 'rgba(80,230,205,0.25)';
  ctx.fillRect(cx - 9, cy + R + 2, 18, 6);
}

function drawTyping(ctx: CanvasRenderingContext2D, desk: Item, now: number, phase: number) {
  const at = iso(desk.x, desk.y);
  const p: Painter = { ctx, ox: at.x, oy: at.y };
  const tick = Math.floor(now / 140 + phase * 10);
  const r = rng(tick + desk.seed * 31);
  const row = tick % 5;
  faceY(p, 0.27 + r() * 0.1, 0.32, 18 + row * 2, 0.1 + r() * 0.25, 1, '#e8f6ff');
  if (tick % 7 === 0) faceY(p, 0.27, 0.32, 26, 0.04, 1, '#ffffff');
}

export function pixelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, border: string) {
  ctx.fillStyle = border;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines.map((l) => (ctx.measureText(l).width > maxWidth ? truncate(l, 28) : l));
}

const BUBBLE_STYLE: Record<string, { fill: string; border: string; text: string; icon?: string }> = {
  say: { fill: '#ffffff', border: '#2a2230', text: '#2a2230' },
  think: { fill: '#f4f0ff', border: '#7b6cc9', text: '#3d3470', icon: '💭' },
  action: { fill: '#eaf7ff', border: '#3f7fbd', text: '#1f3f60', icon: '⚡' },
  ask: { fill: '#fff4cc', border: '#c98a12', text: '#4a3200', icon: '❓' },
  idle: { fill: '#fdf1e4', border: '#c98b5b', text: '#5a3a1f' },
};

function drawBubble(ctx: CanvasRenderingContext2D, c: Character, x: number, y: number, now: number) {
  const b = c.bubble!;
  const style = BUBBLE_STYLE[b.kind] ?? BUBBLE_STYLE.say;
  const appear = Math.min(1, (now - b.start) / 180);
  const vanish = Math.min(1, (b.end - now) / 250);
  const alpha = Math.max(0, Math.min(appear, vanish)) * c.alpha;
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.font = `12px ${UI_FONT}`;
  const text = style.icon ? `${style.icon} ${b.text}` : b.text;
  const lines = wrap(ctx, text, 176, 3);
  const width = Math.min(192, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14);
  const height = lines.length * 14 + 8;
  const bx = Math.round(x - width / 2);
  const by = Math.round(y - height - 8 - (1 - appear) * 4);
  pixelBox(ctx, bx, by, Math.round(width), height, style.fill, style.border);
  if (b.kind === 'think') {
    pixelBox(ctx, Math.round(x - 3), by + height + 1, 6, 5, style.fill, style.border);
    pixelBox(ctx, Math.round(x + 1), by + height + 6, 4, 3, style.fill, style.border);
  } else {
    ctx.fillStyle = style.border;
    ctx.fillRect(Math.round(x - 3), by + height - 1, 7, 2);
    ctx.fillRect(Math.round(x - 2), by + height + 1, 5, 2);
    ctx.fillRect(Math.round(x - 1), by + height + 3, 3, 2);
    ctx.fillStyle = style.fill;
    ctx.fillRect(Math.round(x - 2), by + height - 1, 5, 2);
    ctx.fillRect(Math.round(x - 1), by + height + 1, 3, 2);
  }
  ctx.fillStyle = style.text;
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 15 + i * 14));
  ctx.globalAlpha = 1;
}

interface Sky {
  top: string;
  bottom: string;
  night: boolean;
  tint?: string;
}

function skyFor(hour: number): Sky {
  if (hour >= 21 || hour < 5.5) return { top: '#141a3d', bottom: '#3d3270', night: true, tint: 'rgba(16,18,58,0.30)' };
  if (hour < 8) return { top: '#f4a9a0', bottom: '#ffe0b8', night: false, tint: 'rgba(255,170,120,0.06)' };
  if (hour < 17.5) return { top: '#b4a4ea', bottom: '#f6cde0', night: false };
  return { top: '#6f5fc4', bottom: '#f7a48c', night: false, tint: 'rgba(120,60,120,0.10)' };
}
