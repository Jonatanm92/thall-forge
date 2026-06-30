// Drum generator for thall / modern metal.
//
// The defining trait of the genre's drumming is that the KICK locks to the
// guitar's chug pattern (kick == riff onsets), while the snare keeps the
// backbeat to stop the polymeter from collapsing into chaos. Cymbals ride on
// top, crashes mark accents, and fills punctuate phrase ends.

import { Rng } from './random';
import type { GrooveStyle, Hit, Track } from './types';
import type { RhythmOnset } from './rhythm';

// General MIDI percussion note numbers.
export const DRUM = {
  kick: 36,
  snare: 38,
  sideStick: 37,
  closedHat: 42,
  openHat: 46,
  ride: 51,
  crash: 49,
  tomHigh: 50,
  tomMid: 47,
  tomLow: 45,
} as const;

export interface DrumOptions {
  onsets: RhythmOnset[];
  length: number;
  stepsPerBeat: number;
  beatsPerBar: number;
  style: GrooveStyle;
  complexity: number;
  /** Whether this section should ride hats (verse) or crash/ride (chorus). */
  intensity: 'low' | 'mid' | 'high';
  rng: Rng;
}

export function generateDrums(opts: DrumOptions): Track[] {
  const {
    onsets,
    length,
    stepsPerBeat,
    beatsPerBar,
    style,
    complexity,
    intensity,
    rng,
  } = opts;

  const kick: Hit[] = [];
  const snare: Hit[] = [];
  const cymbal: Hit[] = [];
  const toms: Hit[] = [];

  const stepsPerBar = stepsPerBeat * beatsPerBar;
  const onsetSteps = new Set(onsets.map((o) => o.step));

  // 1) Kick follows the riff onsets — the genre's signature lock.
  for (const o of onsets) {
    kick.push({
      step: o.step,
      duration: 1,
      pitch: DRUM.kick,
      velocity: o.accent ? 1.0 : 0.85,
    });
  }

  // Deathcore & busy sections add a steady low kick pulse under the chugs.
  if (style === 'deathcore' || complexity > 0.75) {
    for (let s = 0; s < length; s += 2) {
      if (!onsetSteps.has(s) && rng.chance(0.35)) {
        kick.push({ step: s, duration: 1, pitch: DRUM.kick, velocity: 0.7 });
      }
    }
  }

  // 2) Snare backbeat on beats 2 and 4 of every bar.
  for (let bar = 0; bar * stepsPerBar < length; bar++) {
    const barStart = bar * stepsPerBar;
    for (let beat = 1; beat < beatsPerBar; beat += 2) {
      const step = barStart + beat * stepsPerBeat;
      if (step < length) {
        snare.push({ step, duration: 1, pitch: DRUM.snare, velocity: 0.95 });
      }
    }
    // Ghost snares for groove at higher complexity.
    if (complexity > 0.5) {
      for (let s = barStart; s < barStart + stepsPerBar; s++) {
        if (s % stepsPerBeat !== 0 && !onsetSteps.has(s) && rng.chance(complexity * 0.12)) {
          snare.push({ step: s, duration: 1, pitch: DRUM.snare, velocity: 0.4 });
        }
      }
    }
  }

  // 3) Cymbals. Verses ride closed hats on 8ths; choruses ride the ride/crash.
  const rideNote = intensity === 'high' ? DRUM.ride : DRUM.closedHat;
  const cymStep = intensity === 'low' ? stepsPerBeat : stepsPerBeat / 2;
  for (let s = 0; s < length; s += cymStep) {
    cymbal.push({
      step: s,
      duration: 1,
      pitch: rideNote,
      velocity: s % stepsPerBeat === 0 ? 0.8 : 0.55,
    });
  }
  // Crash on the downbeat of bar 1 (and big accents).
  cymbal.push({ step: 0, duration: 1, pitch: DRUM.crash, velocity: 1.0 });
  for (const o of onsets) {
    if (o.accent && o.step % stepsPerBar === 0 && o.step !== 0 && rng.chance(0.6)) {
      cymbal.push({ step: o.step, duration: 1, pitch: DRUM.crash, velocity: 0.9 });
    }
  }

  // 4) Tom fill in the last beat of the final bar.
  const fillStart = length - stepsPerBeat;
  if (intensity !== 'low' && rng.chance(0.7)) {
    const tomNotes = [DRUM.tomHigh, DRUM.tomHigh, DRUM.tomMid, DRUM.tomLow];
    for (let i = 0; i < stepsPerBeat; i++) {
      toms.push({
        step: fillStart + i,
        duration: 1,
        pitch: tomNotes[i % tomNotes.length],
        velocity: 0.85,
      });
    }
    // Remove cymbals during the fill so it reads cleanly.
    for (let i = cymbal.length - 1; i >= 0; i--) {
      if (cymbal[i].step >= fillStart) cymbal.splice(i, 1);
    }
  }

  return [
    { name: 'Kick', role: 'kick', hits: dedupe(kick) },
    { name: 'Snare', role: 'snare', hits: snare },
    { name: 'Cymbals', role: 'hat', hits: cymbal },
    { name: 'Toms', role: 'tom', hits: toms },
  ];
}

// Two kicks on the same step would double-trigger; keep the loudest.
function dedupe(hits: Hit[]): Hit[] {
  const byStep = new Map<number, Hit>();
  for (const h of hits) {
    const existing = byStep.get(h.step);
    if (!existing || h.velocity > existing.velocity) byStep.set(h.step, h);
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}
