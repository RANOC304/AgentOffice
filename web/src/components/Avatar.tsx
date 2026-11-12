import { useEffect, useRef } from 'react';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { lookFor } from '../office3d/look.ts';
import { drawPortrait } from '../office3d/portrait.ts';

export function Avatar({ agent, size = 44 }: { agent: AgentSnapshot; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPortrait(ref.current, lookFor(agent.id, agent.provider, agent.kind), size);
  }, [agent.id, agent.provider, agent.kind, size]);
  return <canvas ref={ref} className="avatar" width={size} height={size} style={{ width: size, height: size }} aria-hidden="true" />;
}
