// MIDI export. Converts a generated Song (or single Pattern) into a standard
// MIDI file the user can drag into any DAW (Reaper, Logic, GarageBand...) to
// produce the actual drums/bass tracks for their videos.

import { Midi } from '@tonejs/midi';
import type { Song, Track, TrackRole } from './types';

// Map our roles to MIDI channels. Drums must live on channel 10 (index 9).
function channelForRole(role: TrackRole): number {
  switch (role) {
    case 'kick':
    case 'snare':
    case 'hat':
    case 'ride':
    case 'crash':
    case 'tom':
      return 9; // GM percussion channel
    case 'bass':
      return 1;
    case 'guitar':
      return 0;
    case 'lead':
      return 2;
    default:
      return 0;
  }
}

/**
 * Build a MIDI file from a full song, flattening all section repeats into a
 * continuous timeline.
 */
export function songToMidi(song: Song): Midi {
  const midi = new Midi();
  midi.header.setTempo(song.bpm);

  // Write tempo automation events if a tempoMap is present
  if (song.tempoMap && song.tempoMap.length > 0) {
    // Clear any existing tempos and write the full map
    midi.header.tempos = [];
    for (const evt of song.tempoMap) {
      const timeInSeconds = barToTime(evt.bar, song);
      midi.header.tempos.push({ ticks: midi.header.secondsToTicks(timeInSeconds), bpm: evt.bpm });
    }
  }

  // Group tracks by role so each role becomes one MIDI track.
  const roleTracks = new Map<TrackRole, { name: string; events: { time: number; duration: number; midi: number; velocity: number }[] }>();

  let cursorSteps = 0; // running step offset, normalised to a 16th grid

  for (const section of song.sections) {
    const { pattern } = section;
    const spStep = 60 / song.bpm / pattern.stepsPerBeat;
    for (let rep = 0; rep < section.repeats; rep++) {
      const baseStep = cursorSteps;
      for (const track of pattern.tracks) {
        const entry =
          roleTracks.get(track.role) ??
          { name: track.name, events: [] };
        for (const hit of track.hits) {
          const t = (baseStep + hit.step + (hit.microShift ?? 0)) * spStep;
          // Apply per-repeat velocity scaling for dynamic builds
          const repeatScale = section.repeats > 1
            ? 0.85 + (rep / (section.repeats - 1)) * 0.2
            : 1.0;
          const vel = Math.max(0, Math.min(1, hit.velocity * repeatScale));
          entry.events.push({
            time: Math.max(0, t),
            duration: Math.max(spStep * 0.5, hit.duration * spStep),
            midi: hit.pitch,
            velocity: vel,
          });
          hit.voicing?.forEach((p) =>
            entry.events.push({
              time: Math.max(0, t),
              duration: Math.max(spStep * 0.5, hit.duration * spStep),
              midi: p,
              velocity: vel,
            }),
          );
        }
        roleTracks.set(track.role, entry);
      }
      cursorSteps += pattern.length;
    }
  }

  for (const [role, entry] of roleTracks) {
    const track = midi.addTrack();
    track.name = entry.name;
    track.channel = channelForRole(role);
    for (const ev of entry.events) {
      track.addNote({
        midi: ev.midi,
        time: ev.time,
        duration: ev.duration,
        velocity: Math.max(0, Math.min(1, ev.velocity)),
      });
    }
  }

  return midi;
}

/**
 * Convert a bar number to seconds assuming a constant tempo (base BPM).
 * For tempo-mapped songs this is an approximation used for MIDI header placement.
 */
function barToTime(bar: number, song: Song): number {
  // Walk through sections to figure out beats-per-bar up to the target bar
  let currentBar = 0;
  let currentTime = 0;
  const baseBpm = song.bpm;
  const spBeat = 60 / baseBpm; // seconds per beat at base tempo

  for (const section of song.sections) {
    const sectionBars = section.repeats * Math.ceil(
      section.pattern.length / (section.pattern.beatsPerBar * section.pattern.stepsPerBeat)
    );
    if (currentBar + sectionBars > bar) {
      const remainingBars = bar - currentBar;
      currentTime += remainingBars * section.pattern.beatsPerBar * spBeat;
      return currentTime;
    }
    currentTime += sectionBars * section.pattern.beatsPerBar * spBeat;
    currentBar += sectionBars;
  }
  // Past the end of the song, extrapolate
  return currentTime + (bar - currentBar) * 4 * spBeat;
}

/** Export a single pattern (e.g. just the current riff loop) to MIDI. */
export function patternToMidi(
  tracks: Track[],
  bpm: number,
  stepsPerBeat: number,
): Midi {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const spStep = 60 / bpm / stepsPerBeat;
  for (const t of tracks) {
    const track = midi.addTrack();
    track.name = t.name;
    track.channel = channelForRole(t.role);
    for (const hit of t.hits) {
      const time = Math.max(0, (hit.step + (hit.microShift ?? 0)) * spStep);
      track.addNote({
        midi: hit.pitch,
        time,
        duration: Math.max(spStep * 0.5, hit.duration * spStep),
        velocity: Math.max(0, Math.min(1, hit.velocity)),
      });
      hit.voicing?.forEach((p) =>
        track.addNote({
          midi: p,
          time,
          duration: Math.max(spStep * 0.5, hit.duration * spStep),
          velocity: Math.max(0, Math.min(1, hit.velocity)),
        }),
      );
    }
  }
  return midi;
}

/** Trigger a browser download of a MIDI file. */
export function downloadMidi(midi: Midi, filename: string): void {
  const bytes = midi.toArray();
  // Copy into a standalone ArrayBuffer so the Blob type is unambiguous.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mid') ? filename : `${filename}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
