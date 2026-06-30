// Generates a guitar riff track from a rhythmic skeleton.
//
// The thall idiom: the bulk of the riff is palm-muted chugs on the lowest
// (dropped) string sitting on the root, with melodic "lifts" up the scale on
// accents. This version adds power-chord voicings, sustained ringing notes and
// short melodic runs so riffs read as actual playable parts, not just chugs.

import { Rng } from './random';
import { buildScale, lowString, snapToScale } from './theory';
import type { Hit, ScaleName, Track, Tuning } from './types';
import type { RhythmOnset } from './rhythm';

export interface RiffOptions {
  onsets: RhythmOnset[];
  tuning: Tuning;
  key: string;
  scale: ScaleName;
  complexity: number;
  rng: Rng;
}

export function generateRiff(opts: RiffOptions): Track {
  const { onsets, tuning, key, scale, complexity, rng } = opts;

  const root = lowString(tuning); // open low string == the riff's tonic
  const scalePitches = buildScale(key, scale, root, root + 24);

  const hits: Hit[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const onset = onsets[i];
    const nextStep = onsets[i + 1]?.step ?? onset.step + onset.cell;
    const span = Math.max(1, nextStep - onset.step);

    const melodic = onset.accent && rng.chance(0.4 + complexity * 0.4);

    if (melodic) {
      // Pick a scale tone above the root, weighted toward closer tones.
      const idx = Math.min(
        scalePitches.length - 1,
        Math.floor(Math.abs(rng.next() - rng.next()) * scalePitches.length),
      );
      const target = snapToScale(scalePitches[idx], scalePitches);

      // High complexity + room => a short ascending/descending run; else a
      // single sustained note ringing into the gap.
      if (span >= 3 && complexity > 0.55 && rng.chance(0.5)) {
        emitRun(hits, target, scalePitches, onset, span, rng);
      } else {
        hits.push({
          step: onset.step,
          duration: Math.min(span, rng.int(2, 4)),
          pitch: target,
          velocity: 0.95,
          palmMute: false,
          accent: true,
        });
      }
    } else if (onset.accent) {
      // Accented open chug -> power chord (root + 5th, sometimes + octave).
      const voicing = [root + 7];
      if (rng.chance(0.4)) voicing.push(root + 12);
      hits.push({
        step: onset.step,
        duration: Math.min(span, 2),
        pitch: root,
        velocity: 1.0,
        palmMute: false,
        accent: true,
        voicing,
      });
    } else {
      // Bread-and-butter palm-muted root chug.
      hits.push({
        step: onset.step,
        duration: 1,
        pitch: root,
        velocity: 0.78 + rng.next() * 0.08,
        palmMute: true,
        accent: false,
      });
    }
  }

  return { name: 'Guitar', role: 'guitar', hits };
}

/** Emit a short stepwise run of scale tones across the available span. */
function emitRun(
  hits: Hit[],
  start: number,
  scalePitches: number[],
  onset: RhythmOnset,
  span: number,
  rng: Rng,
): void {
  const startIdx = nearestIndex(scalePitches, start);
  const dir = rng.chance(0.5) ? 1 : -1;
  const noteCount = Math.min(span, rng.int(2, 3));
  for (let n = 0; n < noteCount; n++) {
    const idx = clampIndex(startIdx + dir * n, scalePitches.length);
    hits.push({
      step: onset.step + n,
      duration: 1,
      pitch: scalePitches[idx],
      velocity: n === 0 ? 0.95 : 0.85,
      palmMute: false,
      accent: n === 0,
    });
  }
}

function nearestIndex(scalePitches: number[], pitch: number): number {
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < scalePitches.length; i++) {
    const d = Math.abs(scalePitches[i] - pitch);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

function clampIndex(i: number, len: number): number {
  return Math.max(0, Math.min(len - 1, i));
}
