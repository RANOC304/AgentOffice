import { useState } from 'react';
import type { AgentSnapshot, OfficeSnapshot } from '../../../shared/types.ts';
import { type AlertSettings, chime, useAlertSettings } from '../alerts.ts';
import { act } from '../api.ts';
import { ago } from '../format.ts';
import { Names } from './Names.tsx';

const ALERT_ROWS: Array<[keyof AlertSettings, string]> = [
  ['needs', 'Someone needs you'],
  ['finished', 'A session finishes its task'],
  ['errors', 'A worker hits an error'],
  ['missions', 'A mission ends'],
  ['limits', 'A plan limit passes 80% / 95%'],
];

/** Office settings: alerts, other computers, character names. */
export function Settings({ snapshot, agents, demo }: { snapshot: OfficeSnapshot | null; agents: AgentSnapshot[]; demo: boolean }) {
  const [alerts, setAlerts] = useAlertSettings();
  const [dir, setDir] = useState(snapshot?.peers.dir ?? '');
  const [note, setNote] = useState<string | null>(null);
  const permission = 'Notification' in window ? Notification.permission : 'denied';

  const desktop = async (on: boolean) => {
    if (on && 'Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') return setAlerts({ desktop: false });
    }
    setAlerts({ desktop: on });
  };
  const saveDir = async (value: string | null) => {
    const err = await act({ type: 'peersDir', dir: value });
    setNote(err ?? (value ? 'Saved. Peers in that folder appear within a few seconds.' : 'Remote computers turned off.'));
  };
  const peers = snapshot?.peers.list ?? [];

  return (
    <div className="settings">
      <section className="card-block">
        <h3>Alerts</h3>
        <div className="toggles">
          <label className="toggle">
            <input type="checkbox" checked={alerts.sound} onChange={(e) => setAlerts({ sound: e.target.checked })} />
            Sound
          </label>
          <label className="toggle">
            <input type="checkbox" checked={alerts.desktop && permission === 'granted'} disabled={permission === 'denied'} onChange={(e) => void desktop(e.target.checked)} />
            Desktop notifications {permission === 'denied' && <span className="muted small">(blocked by the browser)</span>}
          </label>
          <button type="button" className="ghost small" onClick={() => chime(true)}>
            Test sound
          </button>
        </div>
        <p className="muted small">Alert me when…</p>
        <div className="toggles col">
          {ALERT_ROWS.map(([key, label]) => (
            <label key={key} className="toggle">
              <input type="checkbox" checked={alerts[key]} onChange={(e) => setAlerts({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="card-block">
        <h3>Other computers</h3>
        <p className="muted small">
          See agents running on your other computers. Pick a folder that both computers sync (OneDrive, Google Drive, Dropbox, Syncthing or a network share). On the other computer, get this
          project and run:
        </p>
        <pre className="cmd">npm install{'\n'}npm run peer -- --dir "&lt;that same synced folder on the other computer&gt;"</pre>
        <p className="muted small">
          It writes a small redacted summary of its sessions (no transcripts) into the folder every few seconds. Nothing goes over the network from this app. On Linux, use{' '}
          <code>npm run peer:setup -- --dir "&lt;folder&gt;" --main-id &lt;Syncthing ID&gt;</code> instead to keep everything running at every boot. The sync tool (for example Syncthing) must also run on this computer, or the other
          computer shows as offline here.
        </p>
        <form
          className="peers-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDir(dir.trim() || null);
          }}
        >
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\\Users\\you\\OneDrive\\AgentOffice" spellCheck={false} aria-label="Shared folder" disabled={demo} />
          <button type="submit" className="primary" disabled={demo}>
            Save
          </button>
          {snapshot?.peers.dir && (
            <button
              type="button"
              className="ghost"
              disabled={demo}
              onClick={() => {
                setDir('');
                void saveDir(null);
              }}
            >
              Turn off
            </button>
          )}
        </form>
        {note && <p className="muted small">{note}</p>}
        {snapshot?.peers.dir && (
          <ul className="peer-list">
            {peers.length === 0 && <li className="muted small">No other computer has written to this folder yet.</li>}
            {peers.map((p) => (
              <li key={p.host}>
                <span className={`conn ${p.online ? 'conn-live' : 'conn-offline'}`} aria-hidden="true" /> <b>{p.host}</b> · {p.online ? `${p.agents} agent${p.agents === 1 ? '' : 's'}` : 'offline'} · updated{' '}
                {ago(p.updatedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-block">
        <h3>Character names</h3>
        <Names agents={agents} demo={demo} />
      </section>
    </div>
  );
}
