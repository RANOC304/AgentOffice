import { useEffect, useRef } from 'react';
import type { AgentSnapshot } from '../../../shared/types.ts';
import { drawAvatar, lookFor } from '../office/character.ts';

export function Avatar({ agent, scale = 2 }: { agent: AgentSnapshot; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawAvatar(ref.current, lookFor(agent.id, agent.provider, agent.kind), scale);
  }, [agent.id, agent.provider, agent.kind, scale]);
  return <canvas ref={ref} className="avatar" width={16 * scale} height={15 * scale} aria-hidden="true" />;
}
