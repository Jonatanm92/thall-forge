// The rhythmic heart of the engine.
//
// Thall / djent rhythm is built from chains of short rhythmic "cells" — small
// groupings of 16th notes (often 2, 3, 5 or 7 long) whose first step lands a
// palm-muted chug. Stacking odd-length cells against a steady 4/4 pulse is what
// creates the lurching polymeter and "bounce" the genre is known for.
//
// generateRhythm() returns the onset skeleton that the guitar, bass and kick
// drum all lock to, so everything in a generated riff is rhythmically unified.

import { Rng } from './random';
import type { GrooveStyle } from './types';

export interface RhythmOnset {
  step: number;
  /** Length of the cell this onset opens, in steps. */
  cell: number;
  accent: boolean;
}

interface StyleProfile {
  /** Candidate cell lengths and their relative weights. */
  cells: number[];
  cellWeights: number[];
  /** Probability an onset becomes an accent (open note / crash hit). */
  accentRate: number;
  /** Probability of inserting a rest (silence) instead of a chug. */
  restRate: number;
}

const STYLE_PROFILES: Record<GrooveStyle, StyleProfile> = {
  // Classic thall: heavy use of 3s and 5s, lots of bounce, sparse accents.
  thall: {
    cells: [2, 3, 3, 5, 7],
    cellWeights: [2, 4, 4, 3, 1],
    accentRate: 0.18,
    restRate: 0.12,
  },
  // Djent: tighter, more 4/2 driven with the odd 3 thrown in (Meshuggah-ish).
  djent: {
    cells: [2, 2, 3, 4, 6],
    cellWeights: [4, 4, 3, 2, 1],
    accentRate: 0.22,
    restRate: 0.08,
  },
  // Progressive: widest variety, most likely to use 7s and longer phrases.
  progressive: {
    cells: [2, 3, 4, 5, 7],
    cellWeights: [2, 3, 2, 3, 2],
    accentRate: 0.25,
    restRate: 0.1,
  },
  // Deathcore: blunt, low, lots of straight chugs and breakdown space.
  deathcore: {
    cells: [1, 2, 2, 4],
    cellWeights: [2, 5, 5, 2],
    accentRate: 0.3,
    restRate: 0.05,
  },
  // Ambient djent: sparser, more rests, lets notes ring.
  'ambient-djent': {
    cells: [3, 4, 5, 6, 8],
    cellWeights: [3, 3, 2, 2, 1],
    accentRate: 0.15,
    restRate: 0.2,
  },
};

export interface RhythmOptions {
  /** Total length in steps (16ths). */
  length: number;
  style: GrooveStyle;
  /** 0..1 busier output (shorter cells, fewer rests). */
  complexity: number;
  /** 0..1 more displacement / accent shuffling. */
  syncopation: number;
  rng: Rng;
}

export function generateRhythm(opts: RhythmOptions): RhythmOnset[] {
  const { length, style, complexity, syncopation, rng } = opts;
  const profile = STYLE_PROFILES[style];

  // Complexity biases the weights toward shorter cells (busier playing).
  const weights = profile.cells.map((cell, i) => {
    const base = profile.cellWeights[i];
    const shortBias = cell <= 3 ? 1 + complexity : 1 - complexity * 0.5;
    return Math.max(0.05, base * shortBias);
  });

  const restRate = profile.restRate * (1 - complexity * 0.5);
  const accentRate = profile.accentRate + syncopation * 0.15;

  const onsets: RhythmOnset[] = [];
  let step = 0;
  while (step < length) {
    let cell = rng.weighted(profile.cells, weights);
    // Don't overshoot the bar boundary too badly.
    if (step + cell > length) cell = length - step;
    if (cell <= 0) break;

    const isRest = rng.chance(restRate);
    if (!isRest) {
      // Syncopation can nudge the onset slightly later inside its cell.
      const offset =
        cell >= 3 && rng.chance(syncopation * 0.5) ? 1 : 0;
      onsets.push({
        step: step + offset,
        cell,
        accent: rng.chance(accentRate),
      });
    }
    step += cell;
  }

  // Guarantee a downbeat hit so the riff has an anchor.
  if (!onsets.some((o) => o.step === 0)) {
    onsets.unshift({ step: 0, cell: 2, accent: true });
  }

  return onsets.sort((a, b) => a.step - b.step);
}

/**
 * Convenience: total steps for a number of bars given a time signature.
 */
export function barsToSteps(
  bars: number,
  beatsPerBar: number,
  stepsPerBeat: number,
): number {
  return bars * beatsPerBar * stepsPerBeat;
}
