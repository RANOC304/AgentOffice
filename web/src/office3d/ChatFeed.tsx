import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { ActivityKind, AgentSnapshot } from '../../../shared/types.ts';
import { KIND_ICON } from '../dashboard/AgentDetail.tsx';
import type { Chatter } from './scene.ts';

const MAX = 10;

interface Item {
  key: string;
  at: number;
  agentId: string;
  persona: string;
  color: string;
  kind: 'action' | 'say' | 'think' | 'ask' | 'idle';
  icon: string;
  text: string;
}

export interface ChatFeedHandle {
  chatter(line: Chatter): void;
}

const SPEECH_ICON: Record<Exclude<Item['kind'], 'action'>, string> = { say: '💬', think: '💭', ask: '❓', idle: '☕' };

/**
 * Live chat of the whole office: every agent's actions merged with what the characters say and
 * think in their bubbles. Newest on top, ten lines at most.
 */
export const ChatFeed = forwardRef<ChatFeedHandle, { agents: AgentSnapshot[] | null; onSelect: (id: string) => void }>(function ChatFeed(
  { agents, onSelect },
  ref,
) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(true);
  const seen = useRef(new Map<string, number>());
  const started = useRef(false);
  const counter = useRef(0);

  const push = (fresh: Item[]) => {
    if (!fresh.length) return;
    fresh.sort((a, b) => b.at - a.at);
    setItems((prev) => {
      // Skip repeats: the same event, or a line the same character already said in the list.
      const keys = new Set(prev.map((i) => i.key));
      const lines = new Set(prev.map((i) => `${i.agentId}|${i.text}`));
      const added = fresh.filter((i) => !keys.has(i.key) && !lines.has(`${i.agentId}|${i.text}`));
      return [...added, ...prev].slice(0, MAX);
    });
  };

  useImperativeHandle(ref, () => ({
    chatter(line) {
      // Action bubbles repeat the agent's activity, which already comes from the event stream.
      if (line.kind === 'action') return;
      const kind = line.kind;
      push([
        {
          key: `c${counter.current++}`,
          at: line.at,
          agentId: line.agentId,
          persona: line.persona,
          color: PROVIDER_META[line.provider].color,
          kind,
          icon: SPEECH_ICON[kind],
          text: line.text,
        },
      ]);
    },
  }));

  // New activity events from every agent.
  useEffect(() => {
    if (!agents) return;
    const now = Date.now();
    const fresh: Item[] = [];
    for (const a of agents) {
      const last = seen.current.get(a.id);
      // On first load show recent history; agents that arrive later only bring their new events.
      const since = last ?? (started.current ? now - 30_000 : 0);
      let max = last ?? 0;
      for (const e of a.recent) {
        max = Math.max(max, e.at);
        if (e.at <= since) continue;
        fresh.push({
          key: `${a.id}:${e.at}:${e.label}`,
          at: e.at,
          agentId: a.id,
          persona: a.persona,
          color: PROVIDER_META[a.provider].color,
          kind: 'action',
          icon: KIND_ICON[e.kind as ActivityKind] ?? '•',
          text: e.label,
        });
      }
      seen.current.set(a.id, max);
    }
    started.current = true;
    push(fresh.sort((x, y) => y.at - x.at).slice(0, MAX));
  }, [agents]);

  return (
    <section className={`chat-feed${open ? '' : ' closed'}`} aria-label="Office chat feed" aria-live="polite">
      <button type="button" className="chat-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="chat-dot" aria-hidden="true" />
        Office chat
        <span className="chat-toggle" aria-hidden="true">
          {open ? '–' : '+'}
        </span>
      </button>
      {open && (
        <ol className="chat-list">
          {items.map((i, k) => (
            <li key={i.key} className={`chat-item chat-${i.kind}`} style={{ ['--c' as string]: i.color, opacity: k >= MAX - 3 ? 1 - (k - (MAX - 4)) * 0.18 : 1 }}>
              <span className="chat-icon" aria-hidden="true">
                {i.icon}
              </span>
              <span className="chat-body">
                <button type="button" className="chat-who" onClick={() => onSelect(i.agentId)}>
                  {i.persona}
                </button>
                <span className="chat-text">{i.kind === 'say' || i.kind === 'ask' ? `“${i.text}”` : i.text}</span>
              </span>
            </li>
          ))}
          {!items.length && <li className="chat-empty">Waiting for the first words…</li>}
        </ol>
      )}
    </section>
  );
});
