import { useEffect, useState } from 'react';
import { audio, type SoundSettings, subscribeSound, type VoiceMode } from '../audio/engine.ts';
import { speechAvailable } from '../audio/voice.ts';

const SLIDERS: Array<[keyof SoundSettings, string]> = [
  ['master', 'Volume'],
  ['music', 'Music'],
  ['effects', 'Sounds'],
  ['voices', 'Voices'],
];

/** Toolbar button with a small panel: sound on/off, volumes and how characters speak. */
export function SoundPanel() {
  const [settings, setSettings] = useState<SoundSettings>(audio.settings);
  const [open, setOpen] = useState(false);
  const [speech, setSpeech] = useState(speechAvailable());
  useEffect(() => subscribeSound(() => setSettings({ ...audio.settings })), []);
  useEffect(() => {
    // Voices load a moment after the page.
    const timer = setTimeout(() => setSpeech(speechAvailable()), 1500);
    return () => clearTimeout(timer);
  }, [open]);
  const set = (patch: Partial<SoundSettings>) => audio.update(patch);

  return (
    <div className="sound-wrap">
      <button
        type="button"
        className={open ? 'on' : ''}
        aria-expanded={open}
        aria-label="Sound settings"
        title="Music, sounds and voices"
        onClick={() => {
          audio.start();
          setOpen((o) => !o);
        }}
      >
        {settings.enabled ? '🔊' : '🔇'}
      </button>
      {open && (
        <div className="sound-panel" role="dialog" aria-label="Sound">
          <label className="toggle">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Sound on
          </label>
          {SLIDERS.map(([key, label]) => (
            <label key={key} className="sound-row">
              <span>{label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings[key] as number}
                disabled={!settings.enabled}
                onChange={(e) => set({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="sound-row">
            <span>Characters</span>
            <select value={settings.voiceMode} disabled={!settings.enabled} onChange={(e) => set({ voiceMode: e.target.value as VoiceMode })}>
              <option value="speech">Speak nearby, babble far</option>
              <option value="babble">Babble only</option>
              <option value="off">Silent</option>
            </select>
          </label>
          <p className="sound-note">
            {settings.voiceMode === 'speech' && !speech
              ? 'No local voice found on this computer: everyone babbles.'
              : 'Speech uses this computer’s own voices only; nothing is sent online. All music and sounds are generated here.'}
          </p>
        </div>
      )}
    </div>
  );
}
