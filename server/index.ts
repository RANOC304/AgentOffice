// AgentOffice local server: loopback only, streams office snapshots over SSE. Collectors only read
// local files; the only things the office starts are missions and replies you launch yourself.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_BY_ID, type RoomId } from '../shared/rooms.ts';
import type { MissionPermission, MissionProvider, OpenTarget } from '../shared/types.ts';
import { config } from './config.ts';
import { dayKey, History } from './history.ts';
import { tools } from './launchers.ts';
import { cleanNames, NAMES_FILE } from './names.ts';
import { applyAction, Office, type OfficeAction } from './office.ts';

const office = new Office();
const history = new History();
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

if (process.argv.includes('--once')) {
  // Prime collectors, then print one snapshot summary (handy for debugging).
  office.snapshot();
  setTimeout(() => {
    const snap = office.snapshot();
    const brief = snap.agents.map((a) => ({
      id: a.id,
      provider: a.provider,
      kind: a.kind,
      name: a.name,
      app: a.app,
      status: a.status,
      room: a.room,
      domain: a.domain,
      activity: a.activity,
      project: a.projectName,
      tokens: a.tokens.total,
      tools: a.counts.tools,
      persona: a.persona,
      neo: a.neo?.title,
    }));
    console.log(JSON.stringify({ sources: snap.sources, agents: brief, neoPages: snap.neoPages, projects: snap.projects.map((p) => p.name) }, null, 2));
    process.exit(0);
  }, 1200);
} else {
  start();
}

function start() {
  let latest = office.snapshot();
  let latestJson = JSON.stringify(latest);
  const clients = new Set<http.ServerResponse>();
  // Look up the Claude Code and Codex CLIs once the server is up (it can take a second).
  setTimeout(() => tools(), 1500);

  const tick = () => {
    try {
      latest = office.snapshot();
      history.record(latest);
      const json = JSON.stringify(latest);
      const changed = json.replace(/"generatedAt":\d+/, '') !== latestJson.replace(/"generatedAt":\d+/, '');
      latestJson = json;
      if (changed) for (const res of clients) res.write(`event: snapshot\ndata: ${json}\n\n`);
    } catch (error) {
      console.error('[office] snapshot failed', error);
    }
  };
  setInterval(tick, config.pollMs);
  // Keep-alive comment so proxies and browsers keep the stream open.
  setInterval(() => {
    for (const res of clients) res.write(`: ping ${Date.now()}\n\n`);
  }, 20_000);

  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, '127.0.0.1:5173', 'localhost:5173']);

  const server = http.createServer((req, res) => {
    // Block DNS-rebinding and cross-site reads: only our own loopback origins are served.
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    const common = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    };
    // Writes only change AgentOffice's own state (names list, names, fired workers, hidden projects),
    // and only from our own page.
    if (req.method === 'POST' && url.pathname === '/api/names') {
      readJson(req, res, common, allowedHosts, 'names', (body) => {
        const names = cleanNames((body as { names?: unknown }).names);
        if (!names.length) return { status: 400, body: { error: 'The list needs at least one valid name.' } };
        return { status: 200, body: { names: office.names.saveList(names) } };
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      readJson(req, res, common, allowedHosts, 'action', (body) => {
        const action = parseAction(body);
        if (!action) return { status: 400, body: { error: 'Invalid action.' } };
        const error = applyAction(office, action, latest, Date.now());
        if (error) return { status: 409, body: { error } };
        setTimeout(tick, 50);
        return { status: 200, body: { ok: true } };
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }

    if (url.pathname === '/api/names') {
      res.writeHead(200, { ...common, 'content-type': 'application/json; charset=utf-8' }).end(
        JSON.stringify({ names: office.names.names, file: NAMES_FILE, inUse: latest.agents.map((a) => a.persona) }),
      );
      return;
    }
    const shot = url.pathname.match(/^\/api\/neo\/shot\/([0-9a-f-]{36})\/([\w]+\.(?:jpe?g|png|webp))$/i);
    if (shot) {
      const file = office.neo.shotPath(shot[1], shot[2]);
      if (!file) {
        res.writeHead(404, common).end();
        return;
      }
      const type = /png$/i.test(file) ? 'image/png' : /webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { ...common, 'content-type': type, 'cache-control': 'private, max-age=3600' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (url.pathname === '/api/standup') {
      const day = url.searchParams.get('day') ?? dayKey(Date.now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        res.writeHead(400, common).end();
        return;
      }
      history.standup(day, office.missions?.list ?? []).then(
        (report) => res.writeHead(200, { ...common, 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(report)),
        () => res.writeHead(500, common).end(),
      );
      return;
    }
    if (url.pathname === '/api/replay/days') {
      res.writeHead(200, { ...common, 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ days: history.days() }));
      return;
    }
    if (url.pathname === '/api/replay') {
      const day = url.searchParams.get('day') ?? dayKey(Date.now());
      res.writeHead(200, { ...common, 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(history.replay(day)));
      return;
    }
    if (url.pathname === '/api/snapshot') {
      res.writeHead(200, { ...common, 'content-type': 'application/json; charset=utf-8' }).end(latestJson);
      return;
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, {
        ...common,
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`retry: 2000\nevent: snapshot\ndata: ${latestJson}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, common).end();
      return;
    }
    serveStatic(url.pathname, res, common);
  });

  server.listen(config.port, config.host, () => {
    console.log(`AgentOffice API listening on http://${config.host}:${config.port}`);
    if (fs.existsSync(path.join(distDir, 'index.html'))) console.log(`Open http://127.0.0.1:${config.port}`);
  });
}

type JsonResult = { status: number; body: unknown };

/** Reads a small same-origin JSON POST. Another site's page cannot set the custom header without CORS approval. */
function readJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  common: Record<string, string>,
  allowedHosts: Set<string>,
  marker: string,
  handle: (body: unknown) => JsonResult,
) {
  const origin = (req.headers.origin ?? '').replace(/^http:\/\//, '');
  if (!allowedHosts.has(origin) || req.headers['x-agentoffice'] !== marker || !/^application\/json/.test(req.headers['content-type'] ?? '')) {
    res.writeHead(403, common).end();
    return;
  }
  let body = '';
  let tooBig = false;
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
    if (body.length > 32_000) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooBig) return;
    let result: JsonResult;
    try {
      result = handle(JSON.parse(body));
    } catch {
      result = { status: 400, body: { error: 'Invalid request.' } };
    }
    res.writeHead(result.status, { ...common, 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(result.body));
  });
}

const PERMISSIONS: MissionPermission[] = ['read-only', 'edit', 'full'];
const PROVIDERS: MissionProvider[] = ['claude-code', 'codex'];
const TARGETS: OpenTarget[] = ['claude-app', 'codex-app', 'terminal', 'folder'];

function parseAction(body: unknown): OfficeAction | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
  const opt = (v: unknown, max: number) => (v === undefined || v === null || v === '' ? undefined : (str(v, max) ?? false));
  const id = str(b.id, 200);
  const permission = PERMISSIONS.includes(b.permission as MissionPermission) ? (b.permission as MissionPermission) : null;
  switch (b.type) {
    case 'missionCreate': {
      const prompt = str(b.prompt, 8000);
      const projectPath = str(b.projectPath, 500);
      const provider = PROVIDERS.includes(b.provider as MissionProvider) ? (b.provider as MissionProvider) : null;
      const title = opt(b.title, 120);
      const model = opt(b.model, 80);
      const from = opt(b.from, 200);
      const assignee = opt(b.assignee, 200);
      if (!prompt || !projectPath || !provider || !permission || title === false || model === false || from === false || assignee === false) return null;
      if (model && !/^[\w.:\-[\]]+$/.test(model)) return null;
      return { type: 'missionCreate', prompt, projectPath, provider, permission, title, model, from, assignee, start: b.start === true };
    }
    case 'missionStart': {
      const assignee = opt(b.assignee, 200);
      return id && assignee !== false ? { type: 'missionStart', id, assignee } : null;
    }
    case 'missionStop':
    case 'missionRemove':
    case 'stop':
      return id ? { type: b.type, id } : null;
    case 'reply': {
      const text = str(b.text, 8000);
      return id && text && permission ? { type: 'reply', id, text, permission } : null;
    }
    case 'open':
      return id && TARGETS.includes(b.target as OpenTarget) ? { type: 'open', id, target: b.target as OpenTarget } : null;
    case 'pin': {
      const p = str(b.path, 500);
      const room = b.room === null ? null : typeof b.room === 'string' && b.room in ROOM_BY_ID ? (b.room as RoomId) : undefined;
      return p && room !== undefined ? { type: 'pin', path: p, room } : null;
    }
    case 'peersDir': {
      const dir = b.dir === null ? null : str(b.dir, 500);
      return dir === null && b.dir !== null ? null : { type: 'peersDir', dir };
    }
    case 'rename': {
      const name = str(b.name, 60);
      return id && name ? { type: 'rename', id, name } : null;
    }
    case 'fire':
    case 'rehire':
      return id ? { type: b.type, id } : null;
    case 'removeProject':
    case 'restoreProject': {
      const p = str(b.path, 500);
      return p ? { type: b.type, path: p } : null;
    }
    default:
      return null;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serveStatic(pathname: string, res: http.ServerResponse, common: Record<string, string>) {
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) {
    res
      .writeHead(200, { ...common, 'content-type': 'text/plain; charset=utf-8' })
      .end('AgentOffice API is running. Build the UI with `npm run build`, or use `npm run dev` and open http://localhost:5173');
    return;
  }
  let file = path.normalize(path.join(distDir, decodeURIComponent(pathname)));
  if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = index;
  const ext = path.extname(file);
  const headers: Record<string, string> = { ...common, 'content-type': MIME[ext] ?? 'application/octet-stream' };
  if (ext === '.html') {
    headers['content-security-policy'] =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  } else if (file.includes(`${path.sep}assets${path.sep}`)) {
    headers['cache-control'] = 'public, max-age=31536000, immutable';
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}
