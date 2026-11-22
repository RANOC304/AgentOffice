// Keeps this Linux computer's agents visible in your main AgentOffice, for good: sets up the peer
// service and Syncthing as systemd *user* services that start at boot, restart whenever they stop,
// and survive Node upgrades. No root is needed except to install Syncthing the first time.
// Nothing here opens a network connection itself; Syncthing carries the shared folder.
//
//   npm run peer:setup -- --dir "$HOME/AgentOffice-sync" --main-id <device ID of the main computer>
//   npm run peer:status
//   npm run peer:uninstall
//
// Options for setup:
//   --dir        folder shared with the main computer (created if missing)
//   --main-id    Syncthing device ID of the main computer; pairs and shares the folder automatically
//   --main-name  name to give the main computer in Syncthing (default Main-PC)
//   --name       name shown for this computer in the office (default: its hostname)
//   --dry-run    print what would be written, change nothing
// `npm run peer:install` sets up only the peer service (no Syncthing).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PEER_UNIT = 'agentoffice-peer.service';
const SYNC_UNIT = 'syncthing.service';
const FOLDER_ID = 'agentoffice';
const DEVICE_ID = /^[A-Z0-9]{7}(?:-[A-Z0-9]{7}){7}$/;

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'setup';
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag('--dry-run');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const run = (cmd, cmdArgs, options = {}) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...options });
const ctl = (...parts) => run('systemctl', ['--user', ...parts]);
const have = (cmd) => run('sh', ['-c', `command -v ${cmd}`]).status === 0;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const must = (result, what) => {
  if (result.error || result.status !== 0) fail(`${what} failed: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
  return result.stdout;
};

/** One systemd command word: quoted, with the characters systemd treats specially escaped. */
const quote = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;

const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const unitDir = path.join(configHome, 'systemd', 'user');
const peerUnitFile = path.join(unitDir, PEER_UNIT);
const syncDropInDir = path.join(unitDir, `${SYNC_UNIT}.d`);
const syncDropInFile = path.join(syncDropInDir, 'agentoffice.conf');

function peerUnitText(dir, name) {
  const exec = ['/bin/sh', path.join(root, 'scripts', 'peer-run.sh'), '--dir', dir];
  if (name) exec.push('--name', name);
  return [
    '[Unit]',
    "Description=AgentOffice peer: shares this computer's agents through a synced folder",
    'StartLimitIntervalSec=0',
    '',
    '[Service]',
    `WorkingDirectory=${root.replace(/[\\/]$/, '').replace(/%/g, '%%')}`,
    `ExecStart=${exec.map(quote).join(' ')}`,
    'Restart=always',
    'RestartSec=10',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

// Never give up restarting Syncthing (the packaged unit stops retrying after a few quick failures).
const syncDropInText = ['[Unit]', 'StartLimitIntervalSec=0', '', '[Service]', 'Restart=always', 'RestartSec=10', ''].join('\n');

/** Reads and validates --dir and --name. */
function target() {
  let dir = option('--dir');
  if (!dir) fail('Usage: npm run peer:setup -- --dir "$HOME/AgentOffice-sync" [--main-id <ID>] [--name "Laptop"]\n(--dir is a folder shared with your main computer; it is created if missing)');
  if (dir.startsWith('~')) dir = path.join(os.homedir(), dir.slice(1));
  if (!path.isAbsolute(dir)) fail('--dir must be a full folder path.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) fail(`Node 22.18 or newer is required (this is ${process.versions.node}).`);
  return { dir: path.resolve(dir), name: option('--name') };
}

function enableLinger() {
  const user = os.userInfo().username;
  run('loginctl', ['enable-linger']);
  const state = run('loginctl', ['show-user', user, '-p', 'Linger']).stdout?.trim();
  if (state === 'Linger=yes') console.log('  starts at boot, before you log in: yes');
  else console.warn(`  could not enable start at boot. Run once: sudo loginctl enable-linger ${user}`);
}

function installPeer(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(peerUnitFile, peerUnitText(dir, name), 'utf8');
  must(ctl('daemon-reload'), 'systemctl daemon-reload');
  must(ctl('enable', PEER_UNIT), 'Enabling the peer service');
  must(ctl('restart', PEER_UNIT), 'Starting the peer service');
  console.log(`  peer service: installed and running (shares into ${dir})`);
}

function installSyncthing() {
  if (!have('syncthing')) {
    if (!have('apt-get')) fail('Syncthing is not installed. Install it with your package manager, then run this again.');
    console.log('  installing Syncthing (sudo asks for your password)...');
    if (spawnSync('sudo', ['apt-get', 'install', '-y', 'syncthing'], { stdio: 'inherit' }).status !== 0) fail('Could not install Syncthing.');
  }
  if (ctl('cat', SYNC_UNIT).status !== 0) fail(`This Syncthing package has no systemd user service named ${SYNC_UNIT}. Start it at login your own way, then run this again.`);
  fs.mkdirSync(syncDropInDir, { recursive: true });
  fs.writeFileSync(syncDropInFile, syncDropInText, 'utf8');
  must(ctl('daemon-reload'), 'systemctl daemon-reload');
  must(ctl('enable', '--now', SYNC_UNIT), 'Starting Syncthing');
  console.log('  syncthing: running, starts at boot, restarts if it stops');
}

/** Waits for the local Syncthing API; returns the device list, or null if it never answers. */
function waitForSyncthing() {
  for (let i = 0; i < 40; i++) {
    const r = run('syncthing', ['cli', 'config', 'devices', 'list']);
    if (r.status === 0) return r.stdout;
    sleep(1000);
  }
  return null;
}

function ownDeviceId() {
  const r = run('syncthing', ['cli', 'show', 'system']);
  try {
    return JSON.parse(r.stdout).myID;
  } catch {
    return run('syncthing', ['--device-id']).stdout?.trim() || undefined;
  }
}

function pair(mainId, dir) {
  const devices = waitForSyncthing();
  if (devices === null) {
    console.warn('  syncthing did not answer in time: pairing skipped. Run this again in a minute.');
    return;
  }
  const cli = (...a) => run('syncthing', ['cli', ...a]);
  // Adding something that already exists is fine: the commands below only add what is missing.
  const addIfMissing = (listed, id, addArgs, what) => {
    if (listed.includes(id)) return;
    const r = cli(...addArgs);
    if (r.status !== 0 && !/already|exists/i.test(`${r.stderr}${r.stdout}`)) fail(`${what} failed: ${(r.stderr || r.stdout).trim()}`);
  };
  addIfMissing(devices, mainId, ['config', 'devices', 'add', '--device-id', mainId, '--name', option('--main-name') || 'Main-PC'], 'Adding the main computer');
  const folders = cli('config', 'folders', 'list').stdout ?? '';
  addIfMissing(folders.split(/\s+/), FOLDER_ID, ['config', 'folders', 'add', '--id', FOLDER_ID, '--label', 'AgentOffice', '--path', dir], 'Adding the shared folder');
  const shared = cli('config', 'folders', FOLDER_ID, 'devices', 'list').stdout ?? '';
  addIfMissing(shared, mainId, ['config', 'folders', FOLDER_ID, 'devices', 'add', '--device-id', mainId], 'Sharing the folder with the main computer');
  console.log('  syncthing: main computer added and the folder shared with it');
}

/**
 * The peer rewrites its file every minute. If Syncthing needs a few seconds to notice a rewrite, the other
 * computer asks for the old copy, gets "no such file" and waits minutes before retrying, so the computer
 * flickers offline. Noticing changes after 1 second shrinks that window to almost nothing. Best effort.
 */
function tuneFolder() {
  if (waitForSyncthing() === null) return;
  const r = run('syncthing', ['cli', 'config', 'folders', FOLDER_ID, 'fs-watcher-delay-s', 'set', '1']);
  if (r.status === 0) console.log('  syncthing: changes in the shared folder are noticed after 1 second');
  else if (!/no such folder|not found/i.test(`${r.stderr}${r.stdout}`)) console.warn(`  could not shorten the change-detection delay: ${(r.stderr || r.stdout).trim()}`);
}

function setup() {
  const { dir, name } = target();
  const mainId = option('--main-id');
  if (mainId && !DEVICE_ID.test(mainId)) fail('--main-id must be a Syncthing device ID: 8 groups of 7 letters and digits separated by dashes.');
  if (dryRun) {
    console.log(`# ${peerUnitFile}\n${peerUnitText(dir, name)}\n# ${syncDropInFile}\n${syncDropInText}`);
    console.log(`# also: loginctl enable-linger; enable --now ${SYNC_UNIT}${mainId ? `; pair with ${mainId} and share ${dir} as "${FOLDER_ID}"` : ''}`);
    return;
  }
  console.log('Setting up AgentOffice sync on this computer:');
  installPeer(dir, name);
  enableLinger();
  installSyncthing();
  if (mainId) pair(mainId, dir);
  tuneFolder();
  const id = ownDeviceId();
  console.log('\nDone. Both services now start at boot and restart by themselves.');
  if (id) console.log(`This computer's Syncthing ID: ${id}`);
  if (mainId) console.log('On the main computer, accept this computer if Syncthing (http://127.0.0.1:8384) asks to add it. The folder then syncs by itself.');
  else console.log('Not paired yet: run this again with --main-id <the main computer\'s Syncthing ID>.');
  console.log('Check any time with: npm run peer:status');
}

function install() {
  const { dir, name } = target();
  if (dryRun) {
    console.log(`# ${peerUnitFile}\n${peerUnitText(dir, name)}`);
    return;
  }
  installPeer(dir, name);
  enableLinger();
}

function unitState(unit) {
  const active = ctl('is-active', unit).stdout?.trim() || 'unknown';
  const enabled = ctl('is-enabled', unit).stdout?.trim() || 'unknown';
  return `${active}, ${enabled}`;
}

function status() {
  const row = (label, value) => console.log(`${label.padEnd(34)}${value}`);
  row('Peer service (running, boot):', unitState(PEER_UNIT));
  row('Syncthing (running, boot):', unitState(SYNC_UNIT));
  row('Starts before login (linger):', run('loginctl', ['show-user', os.userInfo().username, '-p', 'Linger']).stdout?.trim().replace('Linger=', '') || 'unknown');
  let text = '';
  try {
    text = fs.readFileSync(peerUnitFile, 'utf8');
  } catch {
    row('Shared file:', 'peer service not installed. Run: npm run peer:setup -- --dir "$HOME/AgentOffice-sync"');
    return;
  }
  const unquote = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/%%/g, '%');
  const dir = unquote(/"--dir" "((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? '');
  const host = unquote(/"--name" "((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? os.hostname()).replace(/[^\w.-]/g, '');
  const file = path.join(dir, `${host.replace(/[^A-Za-z0-9._-]/g, '_')}.agentoffice.json`);
  try {
    const age = Math.round((Date.now() - fs.statSync(file).mtimeMs) / 1000);
    row('Shared file:', age < 120 ? `fresh (${age}s old) in ${dir}` : `STALE (${Math.round(age / 60)} min old): the peer is not writing. See: journalctl --user -u ${PEER_UNIT} -n 30`);
  } catch {
    row('Shared file:', `missing in ${dir}`);
  }
}

function uninstall() {
  if (!fs.existsSync(peerUnitFile) && !fs.existsSync(syncDropInFile)) {
    console.log('Nothing to remove: the AgentOffice services are not installed.');
    return;
  }
  ctl('disable', '--now', PEER_UNIT);
  fs.rmSync(peerUnitFile, { force: true });
  fs.rmSync(syncDropInFile, { force: true });
  try {
    fs.rmdirSync(syncDropInDir);
  } catch {
    // not empty or already gone
  }
  ctl('daemon-reload');
  console.log('Removed the AgentOffice peer service and the Syncthing restart setting. Syncthing itself and start-at-boot are left as they were.');
}

if (!dryRun && process.platform !== 'linux') fail('This sets up Linux systemd user services. On other systems run `npm run peer` yourself.');

const commands = { setup, install, uninstall, status };
if (!commands[command]) fail(`Unknown command "${command}". Use setup, install, status or uninstall.`);
commands[command]();
