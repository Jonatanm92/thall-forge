// Bass generator.
//
// In modern metal the bass mostly doubles the guitar's low rhythm an octave
// down to thicken the chugs, but it also fills the gaps the guitar leaves and
// occasionally walks under sustained/melodic guitar notes. We derive it from
// the same rhythmic skeleton so it stays glued to the riff and kick.

import { Rng } from './random';
import { buildScale, lowString, snapToScale } from './theory';
import type { Hit, ScaleName, Track, Tuning } from './types';

export interface BassOptions {
  guitar: Track;
  tuning: Tuning;
  key: string;
  scale: ScaleName;
  complexity: number;
  rng: Rng;
}

export function generateBass(opts: BassOptions): Track {
  const { guitar, tuning, key, scale, complexity, rng } = opts;

  // Bass sits an octave below the guitar's low string.
  const bassRoot = lowString(tuning) - 12;
  const scalePitches = buildScale(key, scale, bassRoot, bassRoot + 19);

  const hits: Hit[] = [];
  for (const g of guitar.hits) {
    // Follow the guitar's root chugs directly an octave down.
    let pitch = bassRoot;

    // When the guitar plays a melodic note, the bass usually stays on the root
    // (locking the low end) but sometimes follows the contour for movement.
    const guitarIsMelodic = !g.palmMute && g.pitch > lowString(tuning);
    if (guitarIsMelodic && rng.chance(0.35 + complexity * 0.3)) {
      const target = g.pitch - 12;
      pitch = snapToScale(target, scalePitches);
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
        const passing = snapToScale(
          sorted[i].pitch + rng.pick([2, 3, -2]),
          scalePitches,
        );
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
