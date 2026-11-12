// Peer mode, for your other computers: `npm run peer -- --dir "<shared folder>"`.
// Reads this computer's Claude Code, Codex and Neo sessions (same collectors, same redaction) and
// writes a compact snapshot into the shared folder every few seconds. The main office reads it.
// No server is started and nothing is sent anywhere: your sync tool carries the file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Office } from './office.ts';
import { type PeerFile, peerFileName, readSettings } from './peers.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const dir = arg('--dir') ?? process.env.AGENTOFFICE_PEERS_DIR ?? readSettings().peersDir;
if (!dir || !path.isAbsolute(dir)) {
  console.error('Usage: npm run peer -- --dir "C:\\Users\\you\\OneDrive\\AgentOffice"   (a folder synced with your main computer)');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const host = (arg('--name') ?? os.hostname()).replace(/[^\w.-]/g, '').slice(0, 60) || 'computer';
const file = path.join(dir, peerFileName(host));
const office = new Office({ peers: false, missions: false, persist: false });
const INTERVAL = 10_000;
const HEARTBEAT = 60_000;
let lastBody = '';
let lastWrite = 0;

function write() {
  const now = Date.now();
  const snap = office.snapshot(now);
  const agents = snap.agents.map((a) => ({ ...a, controls: undefined, neo: a.neo ? { ...a.neo, shot: undefined, tabs: a.neo.tabs.map((t) => ({ ...t, shot: undefined })) } : undefined }));
  const neoPages = snap.neoPages.map((p) => ({ ...p, shot: undefined, tabs: p.tabs.map((t) => ({ ...t, shot: undefined })) }));
  const body = JSON.stringify({ agents, neoPages });
  if (body === lastBody && now - lastWrite < HEARTBEAT) return;
  const data: PeerFile = { version: 1, host, generatedAt: now, agents, neoPages };
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
    lastBody = body;
    lastWrite = now;
  } catch (error) {
    console.error('[peer] could not write', (error as Error).message);
  }
}

office.snapshot();
setTimeout(write, 1500);
setInterval(write, INTERVAL);
console.log(`AgentOffice peer "${host}" is sharing its agents in ${file}`);
console.log('On the main computer, set the same synced folder in Settings → Other computers. Ctrl+C to stop.');
