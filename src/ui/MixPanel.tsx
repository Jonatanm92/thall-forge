// Per-instrument volume mixer panel.
// Provides sliders for guitar, bass, drums, lead, and master levels.

import { useState } from 'react';
import { player } from '../audio/playback';
import type { MixSettings } from '../engine/types';

const DEFAULT_MIX: MixSettings = {
  guitar: 1,
  bass: 1,
  drums: 1,
  lead: 1,
  master: 0.9,
};

export function MixPanel() {
  const [mix, setMix] = useState<MixSettings>({ ...DEFAULT_MIX });

  const update = (key: keyof MixSettings, value: number) => {
    const next = { ...mix, [key]: value };
    setMix(next);
    player.setMixLevels(next);
  };

  return (
    <div className="mix-panel">
      <h4>Mix</h4>
      <div className="mix-sliders">
        <MixSlider label="Guitar" value={mix.guitar} onChange={(v) => update('guitar', v)} />
        <MixSlider label="Bass" value={mix.bass} onChange={(v) => update('bass', v)} />
        <MixSlider label="Drums" value={mix.drums} onChange={(v) => update('drums', v)} />
        <MixSlider label="Lead" value={mix.lead} onChange={(v) => update('lead', v)} />
        <MixSlider label="Master" value={mix.master} onChange={(v) => update('master', v)} />
      </div>
    </div>
  );
}

function MixSlider(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mix-slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
      <span className="mix-value">{Math.round(props.value * 100)}%</span>
    </label>
  );
}
