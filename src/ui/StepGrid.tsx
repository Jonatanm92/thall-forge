// Visualises a Pattern as a step sequencer grid with a moving playhead.
// Gives the channel owner an instant read on the generated groove (and looks
// great on stream).

import { useMemo } from 'react';
import type { Pattern, Track } from '../engine/types';

interface StepGridProps {
  pattern: Pattern;
  playStep: number; // -1 when stopped
}

// Display order + colour per lane.
const LANE_ORDER: { role: Track['role']; color: string }[] = [
  { role: 'crash', color: '#f5d76e' },
  { role: 'hat', color: '#f5d76e' },
  { role: 'tom', color: '#e08a3c' },
  { role: 'snare', color: '#e74c3c' },
  { role: 'kick', color: '#c0392b' },
  { role: 'lead', color: '#42d6c8' },
  { role: 'guitar', color: '#7b6cf6' },
  { role: 'bass', color: '#27ae60' },
];

export function StepGrid({ pattern, playStep }: StepGridProps) {
  const { length, stepsPerBeat } = pattern;

  // Merge cymbal-family tracks into a single "Cymbals" lane for readability.
  const lanes = useMemo(() => {
    const out: { name: string; color: string; steps: Set<number> }[] = [];
    const cymbalSteps = new Set<number>();
    for (const t of pattern.tracks) {
      if (t.role === 'hat' || t.role === 'ride' || t.role === 'crash') {
        t.hits.forEach((h) => cymbalSteps.add(h.step));
      }
    }
    out.push({ name: 'Cymbals', color: '#f5d76e', steps: cymbalSteps });

    for (const { role, color } of LANE_ORDER) {
      if (role === 'hat' || role === 'crash') continue;
      const track = pattern.tracks.find((t) => t.role === role);
      if (!track) continue;
      out.push({
        name: track.name,
        color,
        steps: new Set(track.hits.map((h) => h.step)),
      });
    }
    return out;
  }, [pattern]);

  return (
    <div className="step-grid">
      {lanes.map((lane) => (
        <div className="grid-row" key={lane.name}>
          <span className="grid-label">{lane.name}</span>
          <div className="grid-cells">
            {Array.from({ length }, (_, i) => {
              const active = lane.steps.has(i);
              const beat = Math.floor(i / stepsPerBeat);
              const isBeatStart = i % stepsPerBeat === 0;
              return (
                <span
                  key={i}
                  className={[
                    'cell',
                    active ? 'on' : '',
                    isBeatStart ? 'beat' : '',
                    beat % 2 === 0 ? 'even-beat' : 'odd-beat',
                    i === playStep ? 'playhead' : '',
                  ].join(' ')}
                  style={active ? { background: lane.color } : undefined}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
