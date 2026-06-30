// Generates an optional lead / melody line that floats over the riff in higher
// sections (choruses, outros). It phrases in the upper register with longer,
// more singable notes and breathing room, contrasting the percussive low riff.

import { Rng } from './random';
import { buildScale, lowString } from './theory';
import type { Hit, ScaleName, Track, Tuning } from './types';

export interface LeadOptions {
  length: number;
  stepsPerBeat: number;
  tuning: Tuning;
  key: string;
  scale: ScaleName;
  complexity: number;
  rng: Rng;
}

export function generateLead(opts: LeadOptions): Track {
  const { length, stepsPerBeat, tuning, key, scale, complexity, rng } = opts;

  // Lead sits one to two octaves above the riff's low string.
  const low = lowString(tuning) + 12;
  const scalePitches = buildScale(key, scale, low, low + 24);

  const hits: Hit[] = [];
  let step = 0;
  let idx = Math.floor(scalePitches.length / 2); // start mid-range

  while (step < length) {
    // Note lengths favour 8th/quarter values — longer than the riff's 16ths.
    const noteLen = rng.weighted(
      [stepsPerBeat / 2, stepsPerBeat, stepsPerBeat * 2],
      [3, 3, 1.5],
    );

    // Occasionally rest to let the melody breathe.
    if (rng.chance(0.25 - complexity * 0.1)) {
      step += noteLen;
      continue;
    }

    // Stepwise motion with the odd leap; keeps it singable.
    const move = rng.weighted([-2, -1, 0, 1, 2, 3], [2, 4, 1, 4, 2, 1]);
    idx = Math.max(0, Math.min(scalePitches.length - 1, idx + move));

    hits.push({
      step,
      duration: Math.min(noteLen, length - step),
      pitch: scalePitches[idx],
      velocity: 0.8 + rng.next() * 0.15,
      palmMute: false,
      accent: step % (stepsPerBeat * 2) === 0,
    });
    step += noteLen;
  }

  return { name: 'Lead', role: 'lead', hits };
}
