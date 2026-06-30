// The rhythmic heart of the engine.
//
// Thall / djent rhythm is built from chains of short rhythmic "cells" — small
// groupings of 16th notes (often 2, 3, 5 or 7 long) whose first step lands a
// palm-muted chug. Stacking odd-length cells against a steady 4/4 pulse is what
// creates the lurching polymeter and "bounce" the genre is known for.
//
// Three phrasing modes:
//   - free       : cells chained freely across the whole pattern (most varied)
//   - motif      : one bar-length motif repeated with slight variation (catchy)
//   - polymeter  : one odd-length motif tiled so it phases against the 4/4 bar
//                  lines until it resolves — the signature Meshuggah technique
//
// generateRhythm() returns the onset skeleton that the guitar, bass and kick
// all lock to, so everything in a generated riff is rhythmically unified.

import { Rng } from './random';
import type { GrooveStyle } from './types';

export type Phrasing = 'free' | 'motif' | 'polymeter';

export interface RhythmOnset {
  step: number;
  /** Length of the cell this onset opens, in steps. */
  cell: number;
  accent: boolean;
}

interface StyleProfile {
  cells: number[];
  cellWeights: number[];
  accentRate: number;
  restRate: number;
  /** Candidate motif lengths (in steps) for polymeter phrasing. */
  polyLengths: number[];
}

const STYLE_PROFILES: Record<GrooveStyle, StyleProfile> = {
  thall: { cells: [2, 3, 3, 5, 7], cellWeights: [2, 4, 4, 3, 1], accentRate: 0.18, restRate: 0.12, polyLengths: [6, 7, 9, 10, 11] },
  djent: { cells: [2, 2, 3, 4, 6], cellWeights: [4, 4, 3, 2, 1], accentRate: 0.22, restRate: 0.08, polyLengths: [6, 7, 10, 14] },
  progressive: { cells: [2, 3, 4, 5, 7], cellWeights: [2, 3, 2, 3, 2], accentRate: 0.25, restRate: 0.1, polyLengths: [7, 9, 11, 13] },
  deathcore: { cells: [1, 2, 2, 4], cellWeights: [2, 5, 5, 2], accentRate: 0.3, restRate: 0.05, polyLengths: [6, 8, 10, 12] },
  'ambient-djent': { cells: [3, 4, 5, 6, 8], cellWeights: [3, 3, 2, 2, 1], accentRate: 0.15, restRate: 0.2, polyLengths: [9, 10, 12, 14] },
};

export interface RhythmOptions {
  /** Total length in steps (16ths). */
  length: number;
  style: GrooveStyle;
  complexity: number;
  syncopation: number;
  phrasing?: Phrasing;
  /** Steps per bar — needed for motif phrasing. */
  stepsPerBar?: number;
  rng: Rng;
}

export function generateRhythm(opts: RhythmOptions): RhythmOnset[] {
  const { length, style, complexity, syncopation, rng } = opts;
  const phrasing = opts.phrasing ?? 'free';
  const stepsPerBar = opts.stepsPerBar ?? 16;
  const profile = STYLE_PROFILES[style];
  const weights = weightCells(profile, complexity);
  const restRate = profile.restRate * (1 - complexity * 0.5);
  const accentRate = profile.accentRate + syncopation * 0.15;

  let onsets: RhythmOnset[];
  if (phrasing === 'polymeter') {
    onsets = buildPolymeter(length, profile, weights, restRate, accentRate, syncopation, rng);
  } else if (phrasing === 'motif') {
    onsets = buildMotif(length, stepsPerBar, profile, weights, restRate, accentRate, syncopation, rng);
  } else {
    onsets = buildFree(length, profile, weights, restRate, accentRate, syncopation, rng);
  }

  // Guarantee a downbeat hit so the riff has an anchor.
  if (!onsets.some((o) => o.step === 0)) {
    onsets.unshift({ step: 0, cell: 2, accent: true });
  }
  return dedupeSort(onsets, length);
}

function weightCells(profile: StyleProfile, complexity: number): number[] {
  return profile.cells.map((cell, i) => {
    const base = profile.cellWeights[i];
    const shortBias = cell <= 3 ? 1 + complexity : 1 - complexity * 0.5;
    return Math.max(0.05, base * shortBias);
  });
}

/** A chain of cells filling exactly `target` steps; returns onsets within it. */
function buildChain(
  target: number,
  profile: StyleProfile,
  weights: number[],
  restRate: number,
  accentRate: number,
  syncopation: number,
  rng: Rng,
): RhythmOnset[] {
  const onsets: RhythmOnset[] = [];
  let step = 0;
  while (step < target) {
    let cell = rng.weighted(profile.cells, weights);
    if (step + cell > target) cell = target - step;
    if (cell <= 0) break;
    if (!rng.chance(restRate)) {
      const offset = cell >= 3 && rng.chance(syncopation * 0.5) ? 1 : 0;
      onsets.push({ step: step + offset, cell, accent: rng.chance(accentRate) });
    }
    step += cell;
  }
  return onsets;
}

function buildFree(
  length: number, profile: StyleProfile, weights: number[],
  restRate: number, accentRate: number, syncopation: number, rng: Rng,
): RhythmOnset[] {
  return buildChain(length, profile, weights, restRate, accentRate, syncopation, rng);
}

/** One bar-length motif, repeated each bar with light variation. */
function buildMotif(
  length: number, stepsPerBar: number, profile: StyleProfile, weights: number[],
  restRate: number, accentRate: number, syncopation: number, rng: Rng,
): RhythmOnset[] {
  const motif = buildChain(stepsPerBar, profile, weights, restRate, accentRate, syncopation, rng);
  const out: RhythmOnset[] = [];
  const bars = Math.ceil(length / stepsPerBar);
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * stepsPerBar;
    for (const o of motif) {
      const step = base + o.step;
      if (step >= length) continue;
      // Vary repeats: occasionally flip an accent or drop a note (not bar 0).
      if (bar > 0 && rng.chance(0.12)) continue;
      const accent = bar > 0 && rng.chance(0.15) ? !o.accent : o.accent;
      out.push({ step, cell: o.cell, accent });
    }
  }
  return out;
}

/** One odd-length motif tiled across the pattern so it phases over the bars. */
function buildPolymeter(
  length: number, profile: StyleProfile, weights: number[],
  restRate: number, accentRate: number, syncopation: number, rng: Rng,
): RhythmOnset[] {
  const motifLen = rng.pick(profile.polyLengths);
  // Lower rest rate inside a polymetric motif so the cycle reads clearly.
  const motif = buildChain(motifLen, profile, weights, restRate * 0.4, accentRate, syncopation, rng);
  // Make the first step of the motif a strong accent so the cycle is audible.
  if (motif.length) motif[0] = { ...motif[0], step: 0, accent: true };
  else motif.push({ step: 0, cell: motifLen, accent: true });

  const out: RhythmOnset[] = [];
  for (let base = 0; base < length; base += motifLen) {
    for (const o of motif) {
      const step = base + o.step;
      if (step < length) out.push({ step, cell: o.cell, accent: o.accent });
    }
  }
  return out;
}

function dedupeSort(onsets: RhythmOnset[], length: number): RhythmOnset[] {
  const byStep = new Map<number, RhythmOnset>();
  for (const o of onsets) {
    if (o.step < 0 || o.step >= length) continue;
    const existing = byStep.get(o.step);
    if (!existing || (o.accent && !existing.accent)) byStep.set(o.step, o);
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

/** Convenience: total steps for a number of bars given a time signature. */
export function barsToSteps(bars: number, beatsPerBar: number, stepsPerBeat: number): number {
  return bars * beatsPerBar * stepsPerBeat;
}
