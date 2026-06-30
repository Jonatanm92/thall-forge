// Drum generator for thall / modern metal.
//
// The defining trait of the genre's drumming is that the KICK locks to the
// guitar's chug pattern (kick == riff onsets), while the snare keeps the
// backbeat. On top of that this generator adds the tools a real metal drummer
// reaches for: sustained double-bass, blast beats, ghost-note snares, china /
// ride-bell accents, and varied phrase-ending fills.

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
  rideBell: 53,
  crash: 49,
  china: 52,
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
  intensity: 'low' | 'mid' | 'high';
  rng: Rng;
}

export function generateDrums(opts: DrumOptions): Track[] {
  const { onsets, length, stepsPerBeat, beatsPerBar, style, complexity, intensity, rng } = opts;

  const kick: Hit[] = [];
  const snare: Hit[] = [];
  const cymbal: Hit[] = [];
  const toms: Hit[] = [];

  const stepsPerBar = stepsPerBeat * beatsPerBar;
  const onsetSteps = new Set(onsets.map((o) => o.step));

  // Decide on heavy patterns up front.
  const blast = intensity === 'high' && complexity > 0.7 && (style === 'deathcore' || style === 'djent') && rng.chance(0.5);
  const doubleBass = !blast && intensity === 'high' && (style === 'deathcore' || complexity > 0.7);

  // Reserve the last beat for a fill in busier sections.
  const fillStart = length - stepsPerBeat;
  const wantFill = intensity !== 'low' && rng.chance(0.7);
  const fillZone = (s: number) => wantFill && s >= fillStart;

  if (blast) {
    buildBlast(kick, snare, cymbal, length, stepsPerBar, fillZone, rng);
  } else {
    // 1) Kick follows the riff onsets — the genre's signature lock.
    for (const o of onsets) {
      if (fillZone(o.step)) continue;
      kick.push({ step: o.step, duration: 1, pitch: DRUM.kick, velocity: o.accent ? 1.0 : 0.85 });
    }
    // Double bass: sustained kick fill between onsets for intensity.
    if (doubleBass) {
      for (let s = 0; s < length; s += 1) {
        if (fillZone(s)) continue;
        if (!onsetSteps.has(s) && rng.chance(0.5)) {
          kick.push({ step: s, duration: 1, pitch: DRUM.kick, velocity: 0.7 });
        }
      }
    } else if (complexity > 0.75) {
      for (let s = 0; s < length; s += 2) {
        if (!onsetSteps.has(s) && !fillZone(s) && rng.chance(0.35)) {
          kick.push({ step: s, duration: 1, pitch: DRUM.kick, velocity: 0.7 });
        }
      }
    }

    // 2) Snare backbeat on the even beats of every bar (2, 4, ...).
    for (let bar = 0; bar * stepsPerBar < length; bar++) {
      const barStart = bar * stepsPerBar;
      for (let beat = 1; beat < beatsPerBar; beat += 2) {
        const step = barStart + beat * stepsPerBeat;
        if (step < length && !fillZone(step)) {
          snare.push({ step, duration: 1, pitch: DRUM.snare, velocity: 0.95 });
        }
      }
      // Ghost snares for groove at higher complexity.
      if (complexity > 0.45) {
        for (let s = barStart; s < barStart + stepsPerBar; s++) {
          if (s % stepsPerBeat !== 0 && !onsetSteps.has(s) && !fillZone(s) && rng.chance(complexity * 0.14)) {
            snare.push({ step: s, duration: 1, pitch: DRUM.snare, velocity: 0.32 });
          }
        }
      }
    }

    // 3) Cymbals. Verses ride closed hats on 8ths; choruses ride the ride/china.
    const rideNote = intensity === 'high' ? (rng.chance(0.4) ? DRUM.china : DRUM.ride) : DRUM.closedHat;
    const cymStep = intensity === 'low' ? stepsPerBeat : stepsPerBeat / 2;
    for (let s = 0; s < length; s += cymStep) {
      if (fillZone(s)) continue;
      const onBeat = s % stepsPerBeat === 0;
      // Ride-bell accent on the beat when riding the ride.
      const note = rideNote === DRUM.ride && onBeat && rng.chance(0.4) ? DRUM.rideBell : rideNote;
      cymbal.push({ step: s, duration: 1, pitch: note, velocity: onBeat ? 0.8 : 0.5 });
    }
    // Crash on the downbeat + on accented bar-starts.
    cymbal.push({ step: 0, duration: 1, pitch: DRUM.crash, velocity: 1.0 });
    for (const o of onsets) {
      if (o.accent && o.step % stepsPerBar === 0 && o.step !== 0 && !fillZone(o.step) && rng.chance(0.6)) {
        cymbal.push({ step: o.step, duration: 1, pitch: DRUM.crash, velocity: 0.9 });
      }
    }
  }

  // 4) Phrase-ending fill.
  if (wantFill) {
    buildFill(toms, snare, cymbal, fillStart, stepsPerBeat, length, style, rng);
  }

  return [
    { name: 'Kick', role: 'kick', hits: dedupe(kick) },
    { name: 'Snare', role: 'snare', hits: dedupe(snare) },
    { name: 'Cymbals', role: 'hat', hits: cymbal },
    { name: 'Toms', role: 'tom', hits: toms },
  ];
}

/** Alternating kick/snare 16th-note blast with crash washing over the top. */
function buildBlast(
  kick: Hit[], snare: Hit[], cymbal: Hit[],
  length: number, stepsPerBar: number,
  fillZone: (s: number) => boolean, rng: Rng,
): void {
  for (let s = 0; s < length; s++) {
    if (fillZone(s)) continue;
    if (s % 2 === 0) kick.push({ step: s, duration: 1, pitch: DRUM.kick, velocity: 0.9 });
    else snare.push({ step: s, duration: 1, pitch: DRUM.snare, velocity: 0.85 });
  }
  for (let s = 0; s < length; s += 2) {
    if (!fillZone(s)) cymbal.push({ step: s, duration: 1, pitch: DRUM.crash, velocity: 0.6 });
  }
  void stepsPerBar;
  void rng;
}

/** A varied phrase-ending fill (tom roll / snare roll / mixed). */
function buildFill(
  toms: Hit[], snare: Hit[], cymbal: Hit[],
  fillStart: number, stepsPerBeat: number, length: number,
  style: GrooveStyle, rng: Rng,
): void {
  // Clear cymbals during the fill so it reads cleanly.
  for (let i = cymbal.length - 1; i >= 0; i--) {
    if (cymbal[i].step >= fillStart && cymbal[i].step < length) cymbal.splice(i, 1);
  }

  const kind = rng.pick(['tom', 'snare', 'mixed'] as const);
  const tomNotes = [DRUM.tomHigh, DRUM.tomHigh, DRUM.tomMid, DRUM.tomLow];
  for (let i = 0; i < stepsPerBeat; i++) {
    const step = fillStart + i;
    if (step >= length) break;
    const vel = 0.7 + (i / stepsPerBeat) * 0.3; // crescendo into the downbeat
    if (kind === 'snare') {
      snare.push({ step, duration: 1, pitch: DRUM.snare, velocity: vel });
    } else if (kind === 'tom') {
      toms.push({ step, duration: 1, pitch: tomNotes[i % tomNotes.length], velocity: vel });
    } else {
      if (i % 2 === 0) snare.push({ step, duration: 1, pitch: DRUM.snare, velocity: vel });
      else toms.push({ step, duration: 1, pitch: tomNotes[i % tomNotes.length], velocity: vel });
    }
  }
  void style;
}

// Two hits on the same step would double-trigger; keep the loudest.
function dedupe(hits: Hit[]): Hit[] {
  const byStep = new Map<number, Hit>();
  for (const h of hits) {
    const existing = byStep.get(h.step);
    if (!existing || h.velocity > existing.velocity) byStep.set(h.step, h);
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}
