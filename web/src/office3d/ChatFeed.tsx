import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { ActivityKind, AgentSnapshot } from '../../../shared/types.ts';
import { KIND_ICON } from '../dashboard/AgentDetail.tsx';
import type { Chatter } from './scene.ts';

const MAX = 10;

type Kind = 'action' | 'say' | 'think' | 'ask' | 'idle' | 'chat';
type Filter = 'all' | 'work' | 'talk';

interface Item {
  key: string;
  at: number;
  agentId: string;
  persona: string;
  color: string;
  kind: Kind;
  icon: string;
  text: string;
}

export interface ChatFeedHandle {
  chatter(line: Chatter): void;
}

const SPEECH_ICON: Record<Exclude<Kind, 'action'>, string> = { say: '💬', think: '💭', ask: '❓', idle: '☕', chat: '🗨️' };
/** Work = what the real sessions do and say; talk = the office small talk between characters. */
const IS_TALK = (k: Kind) => k === 'chat' || k === 'idle';

function readFilter(): Filter {
  try {
    const v = localStorage.getItem('agentoffice.chatFilter');
    return v === 'work' || v === 'talk' ? v : 'all';
  } catch {
    return 'all';
  }
}

/**
 * Live chat of the whole office: every agent's actions merged with what the characters say and
 * think in their bubbles. Newest on top, ten lines at most.
 */
export const ChatFeed = forwardRef<ChatFeedHandle, { agents: AgentSnapshot[] | null; resetKey: number; onSelect: (id: string) => void }>(function ChatFeed(
  { agents, resetKey, onSelect },
  ref,
) {
  // Keep more than we show, so switching the filter has something to display right away.
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<Filter>(readFilter);
  const seen = useRef(new Map<string, number>());
  /** Newest event time seen, so agents that show up later only bring their newest events (also in a replay). */
  const latest = useRef(0);
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
      return [...added, ...prev].slice(0, MAX * 4);
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

  // A new office (replay start, stop or jump): start the feed over.
  useEffect(() => {
    seen.current.clear();
    latest.current = 0;
    started.current = false;
    setItems([]);
  }, [resetKey]);

  // New activity events from every agent.
  useEffect(() => {
    if (!agents) return;
    const fresh: Item[] = [];
    for (const a of agents) {
      const last = seen.current.get(a.id);
      // On first load show recent history; agents that arrive later only bring their new events.
      const since = last ?? (started.current ? latest.current - 30_000 : 0);
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
      latest.current = Math.max(latest.current, max);
    }
    started.current = true;
    push(fresh.sort((x, y) => y.at - x.at).slice(0, MAX));
  }, [agents]);

  const choose = (f: Filter) => {
    setFilter(f);
    try {
      localStorage.setItem('agentoffice.chatFilter', f);
    } catch {
      // private mode
    }
  };
  const shown = items.filter((i) => filter === 'all' || (filter === 'talk') === IS_TALK(i.kind)).slice(0, MAX);

  return (
    <section className={`chat-feed${open ? '' : ' closed'}`} aria-label="Office chat feed" aria-live="polite">
      <div className="chat-bar">
        <button type="button" className="chat-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="chat-dot" aria-hidden="true" />
          Office chat
          <span className="chat-toggle" aria-hidden="true">
            {open ? '–' : '+'}
          </span>
        </button>
        {open && (
          <div className="chat-filter" role="group" aria-label="Show">
            {(['all', 'work', 'talk'] as const).map((f) => (
              <button key={f} type="button" className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => choose(f)}>
                {f === 'all' ? 'All' : f === 'work' ? 'Work' : 'Talk'}
              </button>
            ))}
          </div>
        )}
      </div>
      {open && (
        <ol className="chat-list">
          {shown.map((i, k) => (
            <li key={i.key} className={`chat-item chat-${i.kind}`} style={{ ['--c' as string]: i.color, opacity: k >= MAX - 3 ? 1 - (k - (MAX - 4)) * 0.18 : 1 }}>
              <span className="chat-icon" aria-hidden="true">
                {i.icon}
              </span>
              <span className="chat-body">
                <button type="button" className="chat-who" onClick={() => onSelect(i.agentId)}>
                  {i.persona}
                </button>
                <span className="chat-text">{i.kind === 'say' || i.kind === 'ask' || i.kind === 'chat' ? `“${i.text}”` : i.text}</span>
              </span>
            </li>
          ))}
          {!shown.length && <li className="chat-empty">Waiting for the first words…</li>}
        </ol>
      )}
    </section>
  );
});
