// Bass generator.
//
// In modern metal the bass mostly doubles the guitar's low rhythm an octave
// down to thicken the chugs. It locks to the same rhythmic skeleton and follows
// the same per-bar harmonic progression as the riff, so the low end moves with
// the chords. It mostly holds each bar's root, with occasional contour moves.

import { Rng } from './random';
import { buildScale, lowString, snapToScale } from './theory';
import type { Hit, ScaleName, Track, Tuning } from './types';

export interface BassOptions {
  guitar: Track;
  tuning: Tuning;
  key: string;
  scale: ScaleName;
  complexity: number;
  /** Per-bar root offsets in semitones above the tonic (shared with the riff). */
  rootOffsets: number[];
  stepsPerBar: number;
  rng: Rng;
}

export function generateBass(opts: BassOptions): Track {
  const { guitar, tuning, key, scale, complexity, rootOffsets, stepsPerBar, rng } = opts;

  // Bass sits an octave below the guitar's low string.
  const tonic = lowString(tuning) - 12;
  const scalePitches = buildScale(key, scale, tonic, tonic + 19);

  const offsetFor = (step: number) =>
    rootOffsets.length ? rootOffsets[Math.floor(step / stepsPerBar) % rootOffsets.length] : 0;

  const hits: Hit[] = [];
  for (const g of guitar.hits) {
    const barRoot = tonic + offsetFor(g.step);
    let pitch = barRoot; // lock the bar's root by default

    // When the guitar plays a melodic note, sometimes follow its contour.
    const guitarIsMelodic = !g.palmMute && g.pitch > lowString(tuning) + 2;
    if (guitarIsMelodic && rng.chance(0.35 + complexity * 0.3)) {
      pitch = snapToScale(g.pitch - 12, scalePitches);
    }

    hits.push({
      step: g.step,
      duration: g.duration,
      pitch,
      velocity: Math.min(1, g.velocity + 0.05),
      palmMute: g.palmMute,
      accent: g.accent,
    });
  }

  // Higher complexity: add a few passing notes in the gaps between guitar hits.
  if (complexity > 0.6) {
    const sorted = [...hits].sort((a, b) => a.step - b.step);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].step - (sorted[i].step + sorted[i].duration);
      if (gap >= 2 && rng.chance(0.25)) {
        const passing = snapToScale(sorted[i].pitch + rng.pick([2, 3, -2]), scalePitches);
        hits.push({
          step: sorted[i].step + sorted[i].duration,
          duration: 1,
          pitch: passing,
          velocity: 0.6,
        });
      }
    }
  }

  return {
    name: 'Bass',
    role: 'bass',
    hits: hits.sort((a, b) => a.step - b.step),
  };
}
