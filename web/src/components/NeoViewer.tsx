import { useEffect, useMemo, useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { AgentSnapshot, NeoPage, NeoTab } from '../../../shared/types.ts';
import { ago } from '../format.ts';
import { Avatar } from './Avatar.tsx';

function host(url?: string) {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface Props {
  pages: NeoPage[];
  agents: AgentSnapshot[];
  initialSession: string | null;
  onClose: () => void;
  onSelectAgent: (id: string) => void;
}

/** Browser-like view of every BrowserOS neo tab the agents have open, opened from the wall screen. */
export function NeoViewer({ pages, agents, initialSession, onClose, onSelectAgent }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(initialSession ?? pages[0]?.sessionId ?? null);
  const [tabId, setTabId] = useState<string | null>(null);
  const page = pages.find((p) => p.sessionId === sessionId) ?? pages[0];
  const tabs = page?.tabs ?? [];
  const tab: NeoTab | undefined = tabs.find((t) => t.id === tabId) ?? tabs.find((t) => !t.closed) ?? tabs[0];
  const agent = page?.agentId ? agents.find((a) => a.id === page.agentId) : undefined;
  const color = agent ? PROVIDER_META[agent.provider].color : '#1f9e8f';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => setTabId(null), [sessionId]);

  const shot = tab?.shot ?? (tab?.url === page?.url ? page?.shot : undefined);
  const openTabs = useMemo(() => tabs.filter((t) => !t.closed).length, [tabs]);

  return (
    <div className="neo-viewer" role="dialog" aria-modal="true" aria-label="BrowserOS neo tabs" onClick={onClose}>
      <div className="neo-window" onClick={(e) => e.stopPropagation()}>
        <header className="neo-head">
          <span className="neo-title">BrowserOS neo · live tabs</span>
          <div className="neo-sessions" role="tablist" aria-label="Agents browsing">
            {pages.map((p) => {
              const a = p.agentId ? agents.find((x) => x.id === p.agentId) : undefined;
              const live = Date.now() - p.at < 120_000;
              return (
                <button
                  key={p.sessionId}
                  type="button"
                  role="tab"
                  aria-selected={p.sessionId === page?.sessionId}
                  className={p.sessionId === page?.sessionId ? 'neo-session on' : 'neo-session'}
                  onClick={() => setSessionId(p.sessionId)}
                  style={{ ['--c' as string]: a ? PROVIDER_META[a.provider].color : '#1f9e8f' }}
                >
                  {a && <Avatar agent={a} size={24} />}
                  <span>
                    <b>{p.persona ?? p.client}</b>
                    <small>
                      {live ? '● live' : ago(p.at)} · {p.tabs.filter((t) => !t.closed).length || p.tabs.length} tabs
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" className="neo-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {!page ? (
          <div className="neo-empty">No agent has used BrowserOS neo in the last 30 minutes.</div>
        ) : (
          <>
            <div className="neo-tabs" role="tablist" aria-label="Tabs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === tab?.id}
                  className={`neo-tab${t.id === tab?.id ? ' on' : ''}${t.closed ? ' closed' : ''}`}
                  onClick={() => setTabId(t.id)}
                  title={t.url}
                >
                  <span className="neo-fav" style={{ background: color }} />
                  <span className="neo-tab-title">{t.title || host(t.url) || 'Tab'}</span>
                  {t.closed && (
                    <span className="neo-closed" title="Tab closed">
                      ⊘
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="neo-bar">
              <span className="neo-url" title={tab?.url}>
                {tab?.url ?? page.url}
              </span>
              {tab?.url && (
                <a className="neo-open" href={tab.url} target="_blank" rel="noopener noreferrer">
                  Open ↗
                </a>
              )}
            </div>
            <div className="neo-page">
              {shot ? (
                <img src={shot} alt={`Screenshot of ${tab?.title ?? 'the page'}`} />
              ) : (
                <div className="neo-noshot">
                  <b>{host(tab?.url) || 'No screenshot'}</b>
                  <span>Neo has not saved a screenshot of this tab yet. It saves one each time the agent looks at the page.</span>
                </div>
              )}
            </div>
            <footer className="neo-foot">
              <span>
                {agent ? (
                  <button type="button" className="link" onClick={() => onSelectAgent(agent.id)}>
                    {agent.persona}
                  </button>
                ) : (
                  page.client
                )}
                {agent && ` · ${PROVIDER_META[agent.provider].label} · ${agent.name}`}
                {page.task && ` · task “${page.task}”`}
              </span>
              <span>
                {openTabs} open · {tabs.length - openTabs} closed · {page.actions} actions · {tab ? `last used ${ago(tab.at)}` : ''}
              </span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
