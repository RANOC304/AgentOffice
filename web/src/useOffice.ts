import { useEffect, useState } from 'react';
import type { OfficeSnapshot } from '../../shared/types.ts';
import { demoSnapshot } from './demo.ts';

export type Connection = 'connecting' | 'live' | 'offline' | 'demo';

/** Subscribes to the local server's snapshot stream (or demo data with ?demo). */
export function useOffice(): { snapshot: OfficeSnapshot | null; connection: Connection } {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');

  useEffect(() => {
    const demo = new URLSearchParams(location.search).has('demo');
    if (demo) {
      setConnection('demo');
      const start = Date.now();
      const tick = () => setSnapshot(demoSnapshot(start, Date.now()));
      tick();
      const timer = setInterval(tick, 2000);
      return () => clearInterval(timer);
    }

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      source = new EventSource('/api/stream');
      source.addEventListener('snapshot', (event) => {
        try {
          setSnapshot(JSON.parse((event as MessageEvent).data));
          setConnection('live');
        } catch {
          // ignore malformed frame
        }
      });
      source.onerror = () => {
        setConnection('offline');
        source?.close();
        if (!closed) retry = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, []);

  return { snapshot, connection };
}
