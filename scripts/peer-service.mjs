// Runs peer mode in the background on a Linux computer, started automatically at login, using a
// systemd *user* service (no root needed). Nothing here opens a network connection.
//
//   npm run peer:install -- --dir "/home/you/Sync/AgentOffice" [--name "Laptop"] [--boot]
//   npm run peer:status
//   npm run peer:uninstall
//
// --boot     also start it when the computer boots, before you log in (loginctl enable-linger).
// --dry-run  print the service file without writing or running anything.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE = 'agentoffice-peer.service';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'install';
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** One systemd command word: quoted, with the characters systemd treats specially escaped. */
const quote = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;

const unitDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user');
const unitFile = path.join(unitDir, SERVICE);

function ctl(...parts) {
  return execFileSync('systemctl', ['--user', ...parts], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function unitText(dir, name) {
  const exec = [process.execPath, '--disable-warning=ExperimentalWarning', path.join(root, 'server', 'peer.ts'), '--dir', dir];
  if (name) exec.push('--name', name);
  return [
    '[Unit]',
    'Description=AgentOffice peer: shares this computer\'s agents through a synced folder',
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

function install() {
  let dir = option('--dir');
  if (!dir) fail('Usage: npm run peer:install -- --dir "/home/you/Sync/AgentOffice" [--name "Laptop"] [--boot]\n(--dir is a folder synced with your main computer)');
  if (dir.startsWith('~')) dir = path.join(os.homedir(), dir.slice(1));
  if (!path.isAbsolute(dir)) fail('--dir must be a full folder path.');
  dir = path.resolve(dir);
  const name = option('--name');

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) fail(`Node 22.18 or newer is required (this is ${process.versions.node}).`);

  const text = unitText(dir, name);
  if (flag('--dry-run')) {
    console.log(`# ${unitFile}\n${text}`);
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(unitFile, text, 'utf8');
  ctl('daemon-reload');
  ctl('enable', '--now', SERVICE);
  console.log(`Installed ${unitFile}`);
  console.log(`Sharing this computer's agents in ${dir} now, and again at every login.`);
  if (flag('--boot')) {
    try {
      execFileSync('loginctl', ['enable-linger'], { stdio: 'ignore' });
      console.log('Also starting at boot, before you log in.');
    } catch {
      console.warn('Could not enable start at boot. Run `loginctl enable-linger` yourself (it may need sudo).');
    }
  }
  console.log('Check it with: npm run peer:status');
}

function uninstall() {
  if (!fs.existsSync(unitFile)) {
    console.log('Nothing to remove: the service is not installed.');
    return;
  }
  try {
    ctl('disable', '--now', SERVICE);
  } catch (error) {
    console.warn(`Could not stop the service cleanly: ${error.stderr || error.message}`);
  }
  fs.rmSync(unitFile);
  try {
    ctl('daemon-reload');
  } catch {
    // the service file is already gone
  }
  console.log('Removed the AgentOffice peer service. This computer no longer shares its agents.');
}

function status() {
  try {
    console.log(ctl('status', '--no-pager', SERVICE));
  } catch (error) {
    // `systemctl status` exits non-zero when the service is stopped or missing; its output is still useful.
    console.log(error.stdout || error.stderr || 'The service is not installed. Run: npm run peer:install -- --dir "<synced folder>"');
  }
}

if (!flag('--dry-run') && process.platform !== 'linux') fail('This installer sets up a Linux systemd user service. On other systems run `npm run peer` yourself.');

const commands = { install, uninstall, status };
if (!commands[command]) fail(`Unknown command "${command}". Use install, uninstall or status.`);
commands[command]();
