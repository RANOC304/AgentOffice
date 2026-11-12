// Alerts: a desktop notification and/or a short chime when a worker needs you, finishes, hits an
// error, a mission ends or a plan limit gets close. Settings live in this browser only.

import { useEffect, useRef, useState } from 'react';
import type { OfficeSnapshot } from '../../shared/types.ts';
import { ALERT_AT, WARN_AT } from './dashboard/Usage.tsx';

export interface AlertSettings {
  desktop: boolean;
  sound: boolean;
  needs: boolean;
  finished: boolean;
  errors: boolean;
  missions: boolean;
  limits: boolean;
}

const KEY = 'agentoffice.alerts';
const DEFAULTS: AlertSettings = { desktop: false, sound: true, needs: true, finished: false, errors: true, missions: true, limits: true };

export function readAlertSettings(): AlertSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AlertSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function useAlertSettings(): [AlertSettings, (patch: Partial<AlertSettings>) => void] {
  const [settings, setSettings] = useState(readAlertSettings);
  const update = (patch: Partial<AlertSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // private mode
      }
      window.dispatchEvent(new Event('agentoffice-alerts'));
      return next;
    });
  };
  useEffect(() => {
    const sync = () => setSettings(readAlertSettings());
    window.addEventListener('agentoffice-alerts', sync);
    return () => window.removeEventListener('agentoffice-alerts', sync);
  }, []);
  return [settings, update];
}

let audio: AudioContext | null = null;

/** A short two-note chime (higher for "needs you"). */
export function chime(urgent: boolean) {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const notes = urgent ? [880, 1320] : [660, 880];
    notes.forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.16);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.35);
      o.connect(g).connect(audio!.destination);
      o.start(t + i * 0.16);
      o.stop(t + i * 0.16 + 0.4);
    });
  } catch {
    // audio blocked until the first click
  }
}

export interface AlertItem {
  id: string;
  at: number;
  title: string;
  body: string;
  agentId?: string;
  urgent: boolean;
}

/** Watches snapshots for transitions worth an alert. Returns the recent alerts for the in-app toast. */
export function useAlerts(snapshot: OfficeSnapshot | null, enabled: boolean, onClick: (agentId: string) => void): AlertItem[] {
  const [settings] = useAlertSettings();
  const prev = useRef<{ status: Map<string, string>; errors: Map<string, number>; missions: Map<string, string>; limits: Map<string, number> } | null>(null);
  const [items, setItems] = useState<AlertItem[]>([]);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!snapshot || !enabled) return;
    const now = Date.now();
    const status = new Map(snapshot.agents.map((a) => [a.id, a.status]));
    const errors = new Map(snapshot.agents.map((a) => [a.id, a.counts.errors]));
    const missions = new Map(snapshot.missions.map((m) => [m.id, m.status]));
    const limits = new Map<string, number>([...snapshot.usage.claude, ...snapshot.usage.codex].map((g) => [g.id, g.usedPercent]));
    const before = prev.current;
    prev.current = { status, errors, missions, limits };
    if (!before) return; // first snapshot: nothing is "new"

    const fresh: AlertItem[] = [];
    for (const a of snapshot.agents) {
      const was = before.status.get(a.id);
      const where = a.projectName ? ` · ${a.projectName}` : '';
      if (settings.needs && a.status === 'waiting' && was && was !== 'waiting')
        fresh.push({ id: `${a.id}:wait:${now}`, at: now, title: `${a.persona} needs you`, body: `${a.attention?.reason ?? 'Waiting for you'}${where}`, agentId: a.id, urgent: true });
      if (settings.finished && a.kind === 'session' && was === 'working' && a.status === 'idle')
        fresh.push({ id: `${a.id}:done:${now}`, at: now, title: `${a.persona} finished`, body: `${a.name}${where}`, agentId: a.id, urgent: false });
      const errBefore = before.errors.get(a.id);
      if (settings.errors && errBefore !== undefined && a.counts.errors > errBefore && a.status === 'working')
        fresh.push({ id: `${a.id}:err:${now}`, at: now, title: `${a.persona} hit an error`, body: `${a.activity}${where}`, agentId: a.id, urgent: false });
    }
    if (settings.missions)
      for (const m of snapshot.missions) {
        const was = before.missions.get(m.id);
        if (was === 'running' && m.status !== 'running')
          fresh.push({ id: `${m.id}:${m.status}:${now}`, at: now, title: `Mission ${m.status === 'done' ? 'done' : m.status}: ${m.title}`, body: m.result ?? m.error ?? m.projectName, agentId: m.agentId, urgent: m.status === 'failed' });
      }
    if (settings.limits)
      for (const g of [...snapshot.usage.claude.map((x) => ({ ...x, plan: 'Claude' })), ...snapshot.usage.codex.map((x) => ({ ...x, plan: 'Codex' }))]) {
        const was = before.limits.get(g.id) ?? 0;
        for (const level of [WARN_AT, ALERT_AT])
          if (was < level && g.usedPercent >= level)
            fresh.push({ id: `${g.id}:${level}:${now}`, at: now, title: `${g.plan} ${g.label.toLowerCase()} at ${Math.round(g.usedPercent)}%`, body: level >= ALERT_AT ? 'Almost out: new work may be refused.' : 'Getting close to the limit.', urgent: level >= ALERT_AT });
      }
    if (!fresh.length) return;
    if (settings.sound) chime(fresh.some((f) => f.urgent));
    if (settings.desktop && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus()))
      for (const f of fresh.slice(0, 3)) {
        const n = new Notification(f.title, { body: f.body, tag: f.id, silent: true });
        n.onclick = () => {
          window.focus();
          if (f.agentId) clickRef.current(f.agentId);
          n.close();
        };
      }
    setItems((list) => [...fresh, ...list].filter((i) => now - i.at < 12_000).slice(0, 4));
  }, [snapshot, enabled, settings]);

  // Toasts fade after a few seconds.
  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setItems((list) => list.filter((i) => Date.now() - i.at < 9000)), 3000);
    return () => clearTimeout(t);
  }, [items]);

  return items;
}
