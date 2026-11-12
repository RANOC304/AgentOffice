import type { UsageGauge, UsageInfo } from '../../../shared/types.ts';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import { ago, compact } from '../format.ts';

export const WARN_AT = 80;
export const ALERT_AT = 95;

function resetIn(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.round(h / 24)} days`;
}

function Gauge({ g, color }: { g: UsageGauge; color: string }) {
  const now = Date.now();
  const tone = g.usedPercent >= ALERT_AT ? 'alert' : g.usedPercent >= WARN_AT ? 'warn' : 'ok';
  const pct = Math.max(0, Math.min(100, g.usedPercent));
  return (
    <div className={`gauge gauge-${tone}`}>
      <div className="gauge-head">
        <span>{g.label}</span>
        <b>{Math.round(g.usedPercent)}%</b>
      </div>
      <div className="gauge-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={g.label}>
        <div className="gauge-fill" style={{ width: `${pct}%`, background: tone === 'ok' ? color : undefined }} />
      </div>
      <div className="gauge-foot">
        {g.resetsAt && g.resetsAt > now ? `Resets in ${resetIn(g.resetsAt - now)}` : 'Reset time unknown'} · measured {ago(g.at)}
      </div>
    </div>
  );
}

/** Plan limits for Claude and Codex, with a warning before they run out. */
export function UsagePanel({ usage }: { usage: UsageInfo }) {
  const groups: Array<{ id: 'claude' | 'codex'; title: string; color: string; gauges: UsageGauge[]; empty: string }> = [
    { id: 'claude', title: 'Claude plan', color: PROVIDER_META['claude-code'].color, gauges: usage.claude, empty: 'No usage data from the Claude app yet.' },
    { id: 'codex', title: 'Codex / ChatGPT plan', color: PROVIDER_META.codex.color, gauges: usage.codex, empty: 'No rate-limit data from Codex yet.' },
  ];
  const tokens = Object.entries(usage.tokensToday).filter(([, n]) => n);
  return (
    <section className="usage">
      <h3>Usage and limits</h3>
      <div className="usage-grid">
        {groups.map((grp) => (
          <div key={grp.id} className="usage-group">
            <h4>{grp.title}</h4>
            {grp.gauges.length ? grp.gauges.map((g) => <Gauge key={g.id} g={g} color={grp.color} />) : <p className="muted small">{grp.empty}</p>}
          </div>
        ))}
      </div>
      <p className="muted small">
        {tokens.length > 0 && <>Tokens today (cache included): {tokens.map(([p, n]) => `${PROVIDER_META[p as keyof typeof PROVIDER_META].label} ${compact(n)}`).join(' · ')}. </>}
        {usage.missionCostUsd > 0 && <>Missions today: ${usage.missionCostUsd.toFixed(2)}.</>}
      </p>
    </section>
  );
}

/** The highest gauge, for the warning chip in the header. */
export function worstGauge(usage: UsageInfo | undefined): (UsageGauge & { plan: string }) | null {
  if (!usage) return null;
  const all = [...usage.claude.map((g) => ({ ...g, plan: 'Claude' })), ...usage.codex.map((g) => ({ ...g, plan: 'Codex' }))];
  const worst = all.sort((a, b) => b.usedPercent - a.usedPercent)[0];
  return worst && worst.usedPercent >= WARN_AT ? worst : null;
}
