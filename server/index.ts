// AgentOffice local server: loopback only, read-only, streams office snapshots over SSE.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { Office } from './office.ts';

const office = new Office();
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
      lines: a.lines.length,
    }));
    console.log(JSON.stringify({ sources: snap.sources, agents: brief, projects: snap.projects }, null, 2));
    process.exit(0);
  }, 1200);
} else {
  start();
}

function start() {
  let latest = office.snapshot();
  let latestJson = JSON.stringify(latest);
  const clients = new Set<http.ServerResponse>();

  const tick = () => {
    try {
      latest = office.snapshot();
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    const common = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    };

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
