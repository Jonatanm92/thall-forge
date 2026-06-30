// Groove humanization.
//
// Quantized programming sounds robotic. This pass bakes two musician-like
// imperfections into the hits, deterministically (driven by the seed):
//   - swing : pushes the off-beat 16ths slightly late for a shuffled feel
//   - humanize : small random timing + velocity variation, lighter on drums
//                (a real drummer's kick/snare stay tighter than their fills)
//
// Offsets are written to each hit's `microShift` (in fractional steps), which
// the playback engine and MIDI export both honor — so what you hear matches
// what you export.

import { Rng } from './random';
import type { Track, TrackRole } from './types';

export interface GrooveOptions {
  /** 0..1 random timing + velocity variation. */
  humanize: number;
  /** 0..1 swing amount applied to off-beat 16ths. */
  swing: number;
  stepsPerBeat: number;
  rng: Rng;
}

// Percussive anchors stay tighter than melodic/fill voices.
const TIGHT_ROLES: ReadonlySet<TrackRole> = new Set(['kick', 'snare']);

export function applyGroove(tracks: Track[], opts: GrooveOptions): void {
  const { humanize, swing, stepsPerBeat, rng } = opts;
  if (humanize <= 0 && swing <= 0) return;

  const stepsPerHalfBeat = stepsPerBeat / 2;

  for (const track of tracks) {
    const tight = TIGHT_ROLES.has(track.role);
    const timingScale = tight ? 0.5 : 1;
    for (const hit of track.hits) {
      let shift = 0;

      // Swing: delay the "and" / off-beat subdivisions.
      if (swing > 0 && stepsPerHalfBeat >= 1) {
        const posInBeat = hit.step % stepsPerBeat;
        const isOffbeat = posInBeat % (stepsPerHalfBeat * 2) >= stepsPerHalfBeat;
        if (isOffbeat) shift += swing * 0.3;
      }

      // Humanize timing.
      if (humanize > 0) {
        shift += (rng.next() * 2 - 1) * humanize * 0.12 * timingScale;
        // Humanize velocity.
        const v = hit.velocity * (1 + (rng.next() * 2 - 1) * humanize * 0.18);
        hit.velocity = Math.max(0.05, Math.min(1, v));
      }

      if (shift !== 0) hit.microShift = (hit.microShift ?? 0) + shift;
    }
  }
}
