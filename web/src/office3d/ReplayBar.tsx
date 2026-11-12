import { clock } from '../format.ts';

const SPEEDS = [1, 10, 60, 300];

export interface ReplayState {
  day: string;
  days: string[];
  start: number;
  end: number;
  t: number;
  playing: boolean;
  speed: number;
}

/** Bottom bar of the replay: day, play/pause, speed and a time scrubber. */
export function ReplayBar({
  state,
  onSeek,
  onPlay,
  onSpeed,
  onDay,
  onExit,
}: {
  state: ReplayState;
  onSeek: (t: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  onDay: (day: string) => void;
  onExit: () => void;
}) {
  const span = Math.max(1, state.end - state.start);
  return (
    <div className="replay-bar" role="region" aria-label="Replay">
      <span className="replay-badge">⏪ Replay</span>
      <select value={state.day} onChange={(e) => onDay(e.target.value)} aria-label="Day">
        {state.days.map((d) => (
          <option key={d}>{d}</option>
        ))}
      </select>
      <button type="button" className="replay-play" onClick={() => onPlay(!state.playing)} aria-label={state.playing ? 'Pause' : 'Play'}>
        {state.playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(((state.t - state.start) / span) * 1000)}
        onChange={(e) => onSeek(state.start + (Number(e.target.value) / 1000) * span)}
        aria-label="Time"
        aria-valuetext={clock(state.t)}
      />
      <span className="replay-time">{clock(state.t)}</span>
      <div className="replay-speeds" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" className={state.speed === s ? 'on' : ''} aria-pressed={state.speed === s} onClick={() => onSpeed(s)}>
            ×{s}
          </button>
        ))}
      </div>
      <button type="button" className="replay-exit" onClick={onExit}>
        Back to live
      </button>
    </div>
  );
}
