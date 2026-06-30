// Harmonic motion.
//
// A common weakness of generated metal riffs is staying glued to the tonic.
// Real thall / modern-metal riffs move the chug root around the scale — sliding
// the whole figure up to the bVI, bII (the dark "phrygian" colour), bVII, iv,
// etc. — which gives the riff harmonic shape. This module produces a per-bar
// sequence of root offsets (in semitones above the tonic) that the riff and
// bass transpose to, so the same rhythmic skeleton gains real chord movement.

import { Rng } from './random';
import { getScaleIntervals } from './theory';
import type { ScaleName } from './types';

export interface ProgressionOptions {
  bars: number;
  scale: ScaleName;
  /** 0..1 — how often the root leaves the tonic. */
  harmonicMotion: number;
  rng: Rng;
}

// Scale-degree weighting toward the roots that sound strong in the genre.
// Keyed by semitone offset; higher weight = picked more often when moving.
const DEGREE_WEIGHTS: Record<number, number> = {
  0: 0, // tonic handled separately (the "home" the others move away from)
  1: 3, // bII — the phrygian half-step, very thall
  2: 1.5,
  3: 2.5, // bIII
  4: 1.5,
  5: 2.5, // iv
  6: 1.2, // tritone — dissonant tension
  7: 2, // v
  8: 3, // bVI — huge in modern metal
  10: 2.5, // bVII
  11: 1,
};

/**
 * Build a per-bar list of root offsets (semitones above the tonic). Bar 0 is
 * always the tonic so the riff has a home base.
 */
export function generateProgression(opts: ProgressionOptions): number[] {
  const { bars, scale, harmonicMotion, rng } = opts;
  const degrees = getScaleIntervals(scale).filter((d) => d !== 0);
  const items = degrees;
  const weights = degrees.map((d) => DEGREE_WEIGHTS[d] ?? 1);

  const offsets: number[] = [0];
  for (let bar = 1; bar < bars; bar++) {
    if (rng.chance(harmonicMotion)) {
      offsets.push(rng.weighted(items, weights));
    } else {
      // Stay put (often returns to / stays on tonic for grounding).
      offsets.push(rng.chance(0.6) ? 0 : offsets[bar - 1]);
    }
  }
  return offsets;
}

/** Human-readable roman-ish label for a root offset, for the song notes. */
export function offsetLabel(offset: number): string {
  const map: Record<number, string> = {
    0: 'i', 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'iv',
    6: 'bV', 7: 'v', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII',
  };
  return map[((offset % 12) + 12) % 12] ?? `+${offset}`;
}
