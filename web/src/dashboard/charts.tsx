// Small SVG charts for the dashboard. Thin marks, 2px surface gaps, recessive axes, hover tooltips.

import { useState } from 'react';
import { PROVIDER_META } from '../../../shared/rooms.ts';
import type { Provider } from '../../../shared/types.ts';
import { clock } from '../format.ts';

export const PROVIDER_ORDER: Provider[] = ['claude', 'codex', 'chatgpt'];

export interface Bucket {
  start: number;
  end: number;
  values: Record<Provider, number>;
}

export function bucketize(pulsesByProvider: Array<{ provider: Provider; pulses: number[] }>, now: number, windowMs: number, count: number): Bucket[] {
  const size = windowMs / count;
  const start = now - windowMs;
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    start: start + i * size,
    end: start + (i + 1) * size,
    values: { claude: 0, codex: 0, chatgpt: 0 },
  }));
  for (const { provider, pulses } of pulsesByProvider) {
    for (const t of pulses) {
      const i = Math.floor((t - start) / size);
      if (i >= 0 && i < count) buckets[i].values[provider] += 1;
    }
  }
  return buckets;
}

export function StackedTimeline({ buckets, height = 132 }: { buckets: Bucket[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360;
  const top = 8;
  const bottom = 18;
  const plotH = height - top - bottom;
  const totals = buckets.map((b) => PROVIDER_ORDER.reduce((s, p) => s + b.values[p], 0));
  const max = Math.max(4, ...totals);
  const gap = 2;
  const barW = (W - gap * (buckets.length - 1)) / buckets.length;
  const y = (v: number) => (v / max) * plotH;
  const hovered = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Tool calls and messages over time, stacked by provider">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={top + plotH - plotH * f} y2={top + plotH - plotH * f} className="grid" />
        ))}
        <text x={W} y={top + 8} className="axis" textAnchor="end">
          {max}
        </text>
        {buckets.map((b, i) => {
          const x = i * (barW + gap);
          let base = top + plotH;
          const stack = PROVIDER_ORDER.filter((p) => b.values[p] > 0);
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={top} width={barW + gap} height={plotH} fill="transparent" />
              {stack.map((p, k) => {
                const h = Math.max(1, y(b.values[p]) - (k > 0 ? gap : 0));
                base -= h + (k > 0 ? gap : 0);
                const isTop = k === stack.length - 1;
                return (
                  <path
                    key={p}
                    d={isTop ? roundedTop(x, base, barW, h, Math.min(3, h / 2, barW / 2)) : `M${x},${base}h${barW}v${h}h${-barW}z`}
                    fill={PROVIDER_META[p].color}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                );
              })}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={top + plotH + 0.5} y2={top + plotH + 0.5} className="baseline" />
        {[0, Math.floor(buckets.length / 2), buckets.length - 1].map((i) => (
          <text key={i} x={i === 0 ? 0 : i === buckets.length - 1 ? W : i * (barW + gap) + barW / 2} y={height - 4} className="axis" textAnchor={i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}>
            {i === buckets.length - 1 ? 'now' : clock(buckets[i].start)}
          </text>
        ))}
      </svg>
      {hovered && (
        <div className="tooltip" style={{ left: `${((hover! + 0.5) / buckets.length) * 100}%` }}>
          <strong>
            {clock(hovered.start)}–{clock(hovered.end)}
          </strong>
          {PROVIDER_ORDER.map((p) => (
            <span key={p} className="tt-row">
              <span className="swatch" style={{ background: PROVIDER_META[p].color }} />
              {PROVIDER_META[p].label}
              <b>{hovered.values[p]}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface BarRow {
  key: string;
  label: string;
  icon?: string;
  value: number;
  display?: string;
  color?: string;
}

export function HBars({ rows, color = 'var(--accent)', label }: { rows: BarRow[]; color?: string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.display ?? r.value}`}>
          <span className="hb-label">
            {r.icon && <span aria-hidden="true">{r.icon} </span>}
            {r.label}
          </span>
          <span className="hb-track">
            <span className="hb-bar" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? color }} />
          </span>
          <span className="hb-value">{r.display ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Sparkline({ pulses, now, windowMs, color }: { pulses: number[]; now: number; windowMs: number; color: string }) {
  const n = 24;
  const counts = new Array(n).fill(0);
  for (const t of pulses) {
    const i = Math.floor((t - (now - windowMs)) / (windowMs / n));
    if (i >= 0 && i < n) counts[i] += 1;
  }
  const max = Math.max(1, ...counts);
  const W = 240;
  const H = 36;
  const pts = counts.map((c, i) => [(i / (n - 1)) * W, H - 3 - (c / max) * (H - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label={`Activity over the last ${Math.round(windowMs / 3600000)} hours`}>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={color} opacity={0.16} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
