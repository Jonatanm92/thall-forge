// Music theory helpers: tunings, scales, note-name <-> MIDI conversions.

import type { ScaleName, Tuning } from './types';

const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

/** MIDI note number for a scientific-pitch name like "C2" or "F#1". */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])(#|b)?(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3], 10);
  let semis = NOTE_NAMES.indexOf(letter);
  if (accidental === '#') semis += 1;
  if (accidental === 'b') semis -= 1;
  return semis + (octave + 1) * 12;
}

/** Scientific-pitch name for a MIDI note number. */
export function midiToNote(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/** The pitch class letter (no octave) for a MIDI note. */
export function pitchClass(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

// Common low tunings used in thall / modern metal. Strings listed low -> high.
// These cover the staples: drop tunings and extended-range 7/8 string setups.
export const TUNINGS: Tuning[] = [
  {
    id: 'drop-c',
    name: 'Drop C (6) — CGCFAD',
    strings: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'].map(noteToMidi),
  },
  {
    id: 'drop-b',
    name: 'Drop B (6) — BF#BEG#C#',
    strings: ['B1', 'F#2', 'B2', 'E3', 'G#3', 'C#4'].map(noteToMidi),
  },
  {
    id: 'drop-a-sharp',
    name: 'Drop A# (7) — A#FA#D#GA#D#',
    strings: ['A#1', 'F2', 'A#2', 'D#3', 'G3', 'A#3', 'D#4'].map(noteToMidi),
  },
  {
    id: 'drop-g-7',
    name: 'Drop G (7) — GDGCFAD',
    strings: ['G1', 'D2', 'G2', 'C3', 'F3', 'A3', 'D4'].map(noteToMidi),
  },
  {
    id: 'drop-e-8',
    name: 'Drop E (8) — EBEADGBE',
    strings: ['E1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(noteToMidi),
  },
  {
    id: 'drop-f-8',
    name: 'Drop F (8) — FCFA#D#G#CF (thall favourite)',
    strings: ['F1', 'C2', 'F2', 'A#2', 'D#3', 'G#3', 'C4', 'F4'].map(noteToMidi),
  },
];

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

/** The lowest string of a tuning — the "chug" string thall lives on. */
export function lowString(tuning: Tuning): number {
  return tuning.strings[0];
}

// Scale interval sets (semitones from root). Dark/exotic modes dominate the genre.
const SCALE_INTERVALS: Record<ScaleName, number[]> = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  'phrygian-dominant': [0, 1, 4, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_NAMES: ScaleName[] = [
  'phrygian',
  'phrygian-dominant',
  'aeolian',
  'locrian',
  'harmonic-minor',
  'dorian',
  'chromatic',
];

/**
 * Build a list of scale pitches across a range, given a root pitch class and
 * a low/high MIDI bound.
 */
export function buildScale(
  rootPitchClass: string,
  scale: ScaleName,
  low: number,
  high: number,
): number[] {
  const rootClass = NOTE_NAMES.indexOf(normalizePitchClass(rootPitchClass));
  const intervals = SCALE_INTERVALS[scale];
  const out: number[] = [];
  for (let midi = low; midi <= high; midi++) {
    const rel = (((midi - rootClass) % 12) + 12) % 12;
    if (intervals.includes(rel)) out.push(midi);
  }
  return out;
}

function normalizePitchClass(pc: string): string {
  const map: Record<string, string> = {
    Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#',
  };
  const cleaned = pc.trim();
  const upper = cleaned[0].toUpperCase() + cleaned.slice(1);
  return map[upper] ?? upper;
}

/** Snap any MIDI note to the nearest pitch in the given scale set. */
export function snapToScale(midi: number, scalePitches: number[]): number {
  let best = scalePitches[0];
  let bestDist = Infinity;
  for (const p of scalePitches) {
    const d = Math.abs(p - midi);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A fretboard position: which string (0 = lowest) and which fret. */
export interface TabPosition {
  stringIndex: number;
  fret: number;
}

/**
 * Map a MIDI pitch to a comfortable fretboard position for a tuning.
 * Minimises fret number (prefers low positions), tie-breaking toward the
 * lowest string so root chugs land as open/low notes on the bottom string.
 */
export function pitchToTab(
  pitch: number,
  tuning: Tuning,
  maxFret = 22,
): TabPosition | null {
  let best: TabPosition | null = null;
  for (let s = 0; s < tuning.strings.length; s++) {
    const fret = pitch - tuning.strings[s];
    if (fret < 0 || fret > maxFret) continue;
    if (
      !best ||
      fret < best.fret ||
      (fret === best.fret && s < best.stringIndex)
    ) {
      best = { stringIndex: s, fret };
    }
  }
  return best;
}

