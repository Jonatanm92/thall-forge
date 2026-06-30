// The shared generation-parameter panel used by both the Song and Riff tabs.

import { Slider, Select } from './Controls';
import { TUNINGS, KEYS, SCALE_NAMES } from '../engine/theory';
import type { GenerationParams, GrooveStyle, ScaleName } from '../engine/types';

export const DEFAULT_PARAMS: GenerationParams = {
  style: 'thall',
  bpm: 140,
  tuningId: 'drop-f-8',
  key: 'F',
  scale: 'phrygian',
  complexity: 0.55,
  syncopation: 0.5,
  barsPerPattern: 2,
  beatsPerBar: 4,
  allowMeterShifts: false,
  phrasing: 'motif',
  harmonicMotion: 0.4,
  humanize: 0.3,
  swing: 0,
  seed: 1337,
};

const STYLES: { value: GrooveStyle; label: string }[] = [
  { value: 'thall', label: 'Thall (bounce / dissonant)' },
  { value: 'djent', label: 'Djent (tight / poly)' },
  { value: 'progressive', label: 'Progressive metal' },
  { value: 'deathcore', label: 'Deathcore (breakdown)' },
  { value: 'ambient-djent', label: 'Ambient djent' },
];

const SCALE_LABELS: Record<ScaleName, string> = {
  phrygian: 'Phrygian',
  'phrygian-dominant': 'Phrygian Dominant',
  aeolian: 'Aeolian (natural minor)',
  locrian: 'Locrian',
  'harmonic-minor': 'Harmonic Minor',
  dorian: 'Dorian',
  chromatic: 'Chromatic',
};

interface Props {
  params: GenerationParams;
  onChange: (p: GenerationParams) => void;
}

export function GenControls({ params, onChange }: Props) {
  const set = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="gen-controls">
      <Select label="Style" value={params.style} options={STYLES} onChange={(v) => set('style', v)} />
      <Select
        label="Tuning"
        value={params.tuningId}
        options={TUNINGS.map((t) => ({ value: t.id, label: t.name }))}
        onChange={(v) => set('tuningId', v)}
      />
      <Select
        label="Key (root)"
        value={params.key}
        options={KEYS.map((k) => ({ value: k, label: k }))}
        onChange={(v) => set('key', v)}
      />
      <Select
        label="Scale"
        value={params.scale}
        options={SCALE_NAMES.map((s) => ({ value: s, label: SCALE_LABELS[s] }))}
        onChange={(v) => set('scale', v as ScaleName)}
      />
      <Slider label="Tempo" value={params.bpm} min={60} max={260} unit=" BPM" onChange={(v) => set('bpm', v)} />
      <Slider
        label="Complexity"
        value={params.complexity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('complexity', v)}
      />
      <Slider
        label="Syncopation"
        value={params.syncopation}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('syncopation', v)}
      />
      <Slider
        label="Pattern length"
        value={params.barsPerPattern}
        min={1}
        max={8}
        format={(v) => `${v} bar${v > 1 ? 's' : ''}`}
        onChange={(v) => set('barsPerPattern', v)}
      />
      <Select
        label="Time signature"
        value={String(params.beatsPerBar)}
        options={[
          { value: '3', label: '3/4' },
          { value: '4', label: '4/4' },
          { value: '5', label: '5/4' },
          { value: '6', label: '6/4' },
          { value: '7', label: '7/4' },
        ]}
        onChange={(v) => set('beatsPerBar', parseInt(v, 10))}
      />
      <label className="control checkbox-control">
        <span className="control-label">Odd-meter shifts (songs)</span>
        <input
          type="checkbox"
          checked={params.allowMeterShifts}
          onChange={(e) => set('allowMeterShifts', e.target.checked)}
        />
      </label>
      <Select
        label="Phrasing"
        value={params.phrasing}
        options={[
          { value: 'motif', label: 'Motif (repeat + vary)' },
          { value: 'polymeter', label: 'Polymeter (phasing loop)' },
          { value: 'free', label: 'Free (most varied)' },
        ]}
        onChange={(v) => set('phrasing', v as GenerationParams['phrasing'])}
      />
      <Slider
        label="Harmonic motion"
        value={params.harmonicMotion}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('harmonicMotion', v)}
      />
      <Slider
        label="Humanize"
        value={params.humanize}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('humanize', v)}
      />
      <Slider
        label="Swing"
        value={params.swing}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('swing', v)}
      />
    </div>
  );
}
