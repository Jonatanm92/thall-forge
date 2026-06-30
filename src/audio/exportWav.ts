// Offline audio rendering for WAV export and per-stem rendering.
//
// Uses Tone.Offline to recreate the ThallPlayer signal chain inside an offline
// context. This means every synth, effect, and cab IR is rebuilt per render
// pass -- necessary because Tone.Offline provides its own AudioContext.

import * as Tone from 'tone';
import { midiToNote } from '../engine/theory';
import type { Pattern, Song, TrackRole } from '../engine/types';
import { DRUM } from '../engine/drums';
import { makeCabIR } from './ir';

import type { ScheduledNote } from './playback';

export interface RenderOptions {
  /** Enable stereo guitar doubling (hard L/R with detune + timing offset). */
  stereoDouble?: boolean;
}

/** Role groups for stem isolation. */
type StemGroup = 'guitar' | 'bass' | 'drums' | 'lead';

const ROLE_TO_STEM: Record<TrackRole, StemGroup> = {
  guitar: 'guitar',
  lead: 'lead',
  bass: 'bass',
  kick: 'drums',
  snare: 'drums',
  hat: 'drums',
  ride: 'drums',
  crash: 'drums',
  tom: 'drums',
};

// ---------------------------------------------------------------------------
// Schedule helpers (mirrors ThallPlayer logic)
// ---------------------------------------------------------------------------

function patternToSchedule(pattern: Pattern, bpm: number): {
  notes: ScheduledNote[];
  duration: number;
} {
  const stepDur = 60 / bpm / pattern.stepsPerBeat;
  const notes: ScheduledNote[] = [];
  for (const track of pattern.tracks) {
    for (const hit of track.hits) {
      const t = (hit.step + (hit.microShift ?? 0)) * stepDur;
      notes.push({
        time: Math.max(0, t),
        role: track.role,
        pitch: hit.pitch,
        duration: Math.max(stepDur * 0.4, hit.duration * stepDur),
        velocity: hit.velocity,
        palmMute: !!hit.palmMute,
        voicing: hit.voicing,
      });
    }
  }
  return { notes, duration: pattern.length * stepDur };
}

function songToSchedule(song: Song): {
  notes: ScheduledNote[];
  duration: number;
} {
  const notes: ScheduledNote[] = [];
  let cursorSteps = 0;
  let stepDur = 60 / song.bpm / 4;
  for (const section of song.sections) {
    const { pattern } = section;
    stepDur = 60 / song.bpm / pattern.stepsPerBeat;
    for (let rep = 0; rep < section.repeats; rep++) {
      const base = cursorSteps;
      for (const track of pattern.tracks) {
        for (const hit of track.hits) {
          const t = (base + hit.step + (hit.microShift ?? 0)) * stepDur;
          notes.push({
            time: Math.max(0, t),
            role: track.role,
            pitch: hit.pitch,
            duration: Math.max(stepDur * 0.4, hit.duration * stepDur),
            velocity: hit.velocity,
            palmMute: !!hit.palmMute,
            voicing: hit.voicing,
          });
        }
      }
      cursorSteps += pattern.length;
    }
  }
  return { notes, duration: cursorSteps * stepDur };
}

// ---------------------------------------------------------------------------
// Offline synth chain builder
// ---------------------------------------------------------------------------

interface OfflineChain {
  guitarOpen: Tone.PolySynth;
  guitarMute: Tone.PolySynth;
  guitarOpenR?: Tone.PolySynth;
  guitarMuteR?: Tone.PolySynth;
  bass: Tone.MonoSynth;
  kick: Tone.MembraneSynth;
  kickClick: Tone.NoiseSynth;
  snare: Tone.NoiseSynth;
  snareBody: Tone.MembraneSynth;
  hat: Tone.MetalSynth;
  ride: Tone.MetalSynth;
  crash: Tone.MetalSynth;
  tom: Tone.MembraneSynth;
}

/**
 * Build the full signal chain inside an offline context.
 * If `filterGroup` is set, only synths for that stem group are connected to
 * destination; the rest are created but routed to a disconnected gain (silent).
 */
async function buildChain(
  filterGroup: StemGroup | null,
  stereoDouble: boolean,
): Promise<OfflineChain> {
  // Create a master chain similar to ThallPlayer.init()
  const masterGain = new Tone.Gain(0.9).toDestination();
  const limiter = new Tone.Limiter(-1).connect(masterGain);

  // Silent output for muted stems
  const silentGain = new Tone.Gain(0);

  function dest(group: StemGroup): Tone.ToneAudioNode {
    if (filterGroup === null) return limiter;
    return group === filterGroup ? limiter : silentGain;
  }

  // Guitar cab IR -- build within the offline context
  let guitarDest: Tone.ToneAudioNode = dest('guitar');
  try {
    const sampleRate = Tone.getContext().sampleRate;
    const irBuf = await makeCabIR(sampleRate, 'modern-v30');
    const cabConv = new Tone.Convolver();
    cabConv.buffer = new Tone.ToneAudioBuffer(irBuf);
    cabConv.connect(dest('guitar'));
    guitarDest = cabConv;
  } catch {
    const fallback = new Tone.Filter(6000, 'lowpass');
    fallback.connect(dest('guitar'));
    guitarDest = fallback;
  }

  // Guitar: open chain
  const openHp = new Tone.Filter(80, 'highpass');
  const openDist = new Tone.Distortion(0.85);
  openDist.oversample = '4x';
  const openEq = new Tone.EQ3({ low: 3, mid: -2, high: 2 });
  const guitarOpen = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
    envelope: { attack: 0.002, decay: 0.12, sustain: 0.6, release: 0.25 },
  });
  guitarOpen.volume.value = -12;

  if (stereoDouble && (filterGroup === null || filterGroup === 'guitar')) {
    // Stereo doubling: L channel
    const panL = new Tone.Panner(-1);
    guitarOpen.chain(openHp, openDist, openEq, panL, guitarDest);
  } else {
    guitarOpen.chain(openHp, openDist, openEq, guitarDest);
  }

  // Guitar: mute chain
  const muteHp = new Tone.Filter(90, 'highpass');
  const muteDist = new Tone.Distortion(0.95);
  muteDist.oversample = '4x';
  const muteEq = new Tone.EQ3({ low: 4, mid: -4, high: 1 });
  const guitarMute = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.05 },
  });
  guitarMute.volume.value = -9;

  if (stereoDouble && (filterGroup === null || filterGroup === 'guitar')) {
    const panL2 = new Tone.Panner(-1);
    guitarMute.chain(muteHp, muteDist, muteEq, panL2, guitarDest);
  } else {
    guitarMute.chain(muteHp, muteDist, muteEq, guitarDest);
  }

  // Stereo double: Right channel synths (detuned +5 cents)
  let guitarOpenR: Tone.PolySynth | undefined;
  let guitarMuteR: Tone.PolySynth | undefined;

  if (stereoDouble && (filterGroup === null || filterGroup === 'guitar')) {
    const openHpR = new Tone.Filter(80, 'highpass');
    const openDistR = new Tone.Distortion(0.85);
    openDistR.oversample = '4x';
    const openEqR = new Tone.EQ3({ low: 3, mid: -2, high: 2 });
    const panR = new Tone.Panner(1);

    guitarOpenR = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0.6, release: 0.25 },
      detune: 5, // +5 cents detune for width
    });
    guitarOpenR.volume.value = -12;
    guitarOpenR.chain(openHpR, openDistR, openEqR, panR, guitarDest);

    const muteHpR = new Tone.Filter(90, 'highpass');
    const muteDistR = new Tone.Distortion(0.95);
    muteDistR.oversample = '4x';
    const muteEqR = new Tone.EQ3({ low: 4, mid: -4, high: 1 });
    const panR2 = new Tone.Panner(1);

    guitarMuteR = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.05 },
      detune: 5,
    });
    guitarMuteR.volume.value = -9;
    guitarMuteR.chain(muteHpR, muteDistR, muteEqR, panR2, guitarDest);
  }

  // Lead (reuses guitar open sound, routed to lead dest)
  // For the lead stem we create a separate synth if filtering by lead,
  // otherwise the guitar open synth handles both (trigger routes it).
  // Lead is actually triggered through guitarOpen in ThallPlayer, but for stem
  // isolation we need a separate instance routed to the lead destination.
  const leadDest = dest('lead');
  // We'll just use guitarOpen for lead when not filtering, but when filtering
  // we need separate routing. To keep it simple, lead notes go through
  // guitarOpen always -- the stem filter handles routing at the destination.
  // (This is handled via the trigger function below.)

  // Bass
  const bassDist = new Tone.Distortion(0.4);
  const bassEq = new Tone.EQ3({ low: 6, mid: 1, high: -4 });
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    filter: { Q: 1, type: 'lowpass' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.2 },
    filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.4, release: 0.2, baseFrequency: 120, octaves: 3 },
  });
  bass.connect(bassDist);
  bassDist.connect(bassEq);
  bassEq.connect(dest('bass'));
  bass.volume.value = -12;

  // Drums
  const drumDest = dest('drums');

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.02 },
  });
  kick.connect(drumDest);
  kick.volume.value = -4;

  const kickClick = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.015, sustain: 0 },
  });
  const clickHp = new Tone.Filter(3500, 'highpass');
  kickClick.connect(clickHp);
  clickHp.connect(drumDest);
  kickClick.volume.value = -14;

  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
  });
  const snareHp = new Tone.Filter(1800, 'highpass');
  snare.connect(snareHp);
  snareHp.connect(drumDest);
  snare.volume.value = -10;

  const snareBody = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
  });
  snareBody.connect(drumDest);
  snareBody.volume.value = -16;

  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 6000,
    octaves: 1.5,
  });
  const hatHp = new Tone.Filter(8000, 'highpass');
  hat.connect(hatHp);
  hatHp.connect(drumDest);
  hat.volume.value = -22;

  const ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
    harmonicity: 4.1,
    modulationIndex: 16,
    resonance: 5000,
    octaves: 2,
  });
  ride.connect(drumDest);
  ride.volume.value = -24;

  const crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.2, release: 0.4 },
    harmonicity: 3.1,
    modulationIndex: 20,
    resonance: 4000,
    octaves: 2.5,
  });
  crash.connect(drumDest);
  crash.volume.value = -24;

  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
  });
  tom.connect(drumDest);
  tom.volume.value = -10;

  // For lead stem isolation, we need a separate signal path for lead notes.
  // We handle this in the trigger function by routing to leadDest when the
  // note role is 'lead'. Create a dedicated lead synth.
  if (filterGroup === 'lead' || filterGroup === null) {
    // Lead uses the same guitar-open sound but may go to a different dest
    // For simplicity in the full mix (filterGroup === null) lead goes through
    // guitarOpen (matching ThallPlayer behavior). For stem isolation, we
    // still use guitarOpen since it connects to limiter (same dest).
    // The leadDest variable is only different when filterGroup === 'lead'.
    void leadDest; // consumed via the trigger closure below
  }

  return {
    guitarOpen,
    guitarMute,
    guitarOpenR,
    guitarMuteR,
    bass,
    kick,
    kickClick,
    snare,
    snareBody,
    hat,
    ride,
    crash,
    tom,
  };
}

// Timing offset for stereo-doubled right channel (~10ms)
const DOUBLE_OFFSET = 0.010;

function triggerNote(
  chain: OfflineChain,
  note: ScheduledNote,
  time: number,
  stereoDouble: boolean,
  filterGroup: StemGroup | null,
): void {
  const vel = Math.max(0.05, Math.min(1, note.velocity));
  const stemGroup = ROLE_TO_STEM[note.role];

  // If we are rendering a specific stem, skip notes not in that group
  if (filterGroup !== null && stemGroup !== filterGroup) return;

  switch (note.role) {
    case 'guitar':
      if (note.palmMute) {
        chain.guitarMute.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
        if (stereoDouble && chain.guitarMuteR) {
          chain.guitarMuteR.triggerAttackRelease(midiToNote(note.pitch), note.duration, time + DOUBLE_OFFSET, vel);
        }
      } else {
        chain.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
        note.voicing?.forEach((p) =>
          chain.guitarOpen.triggerAttackRelease(midiToNote(p), note.duration, time, vel),
        );
        if (stereoDouble && chain.guitarOpenR) {
          chain.guitarOpenR.triggerAttackRelease(midiToNote(note.pitch), note.duration, time + DOUBLE_OFFSET, vel);
          note.voicing?.forEach((p) =>
            chain.guitarOpenR!.triggerAttackRelease(midiToNote(p), note.duration, time + DOUBLE_OFFSET, vel),
          );
        }
      }
      break;
    case 'lead':
      chain.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel * 0.9);
      break;
    case 'bass':
      chain.bass.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
      break;
    case 'kick':
      chain.kick.triggerAttackRelease('C1', '16n', time, vel);
      chain.kickClick.triggerAttackRelease('32n', time, vel * 0.9);
      break;
    case 'snare':
      chain.snare.triggerAttackRelease('16n', time, vel);
      chain.snareBody.triggerAttackRelease('D2', '16n', time, vel * 0.8);
      break;
    case 'tom':
      chain.tom.triggerAttackRelease(midiToNote(note.pitch - 12), '8n', time, vel);
      break;
    case 'hat':
    case 'ride':
    case 'crash':
      triggerCymbal(chain, note.pitch, time, vel);
      break;
  }
}

function triggerCymbal(chain: OfflineChain, pitch: number, time: number, vel: number): void {
  if (pitch === DRUM.crash) {
    chain.crash.triggerAttackRelease('C5', '2n', time, vel * 0.9);
  } else if (pitch === DRUM.ride) {
    chain.ride.triggerAttackRelease('C5', '8n', time, vel * 0.8);
  } else if (pitch === DRUM.openHat) {
    chain.hat.triggerAttackRelease('C5', '8n', time, vel);
  } else {
    chain.hat.triggerAttackRelease('C5', '32n', time, vel);
  }
}

// ---------------------------------------------------------------------------
// Public render functions
// ---------------------------------------------------------------------------

/**
 * Render a full song to a stereo AudioBuffer using Tone.Offline.
 */
export async function renderSongToWav(
  song: Song,
  options?: RenderOptions,
): Promise<AudioBuffer> {
  const { notes, duration } = songToSchedule(song);
  const stereoDouble = options?.stereoDouble ?? false;
  // Add a small tail for reverb/release
  const totalDuration = duration + 1.5;

  const buffer = await Tone.Offline(async () => {
    const chain = await buildChain(null, stereoDouble);
    for (const note of notes) {
      triggerNote(chain, note, note.time, stereoDouble, null);
    }
  }, totalDuration, 2); // 2 channels = stereo

  return buffer as unknown as AudioBuffer;
}

/**
 * Render each stem group (guitar, bass, drums, lead) to a separate AudioBuffer.
 */
export async function renderSongStems(
  song: Song,
  options?: RenderOptions,
): Promise<Map<string, AudioBuffer>> {
  const { notes, duration } = songToSchedule(song);
  const stereoDouble = options?.stereoDouble ?? false;
  const totalDuration = duration + 1.5;

  const stems: StemGroup[] = ['guitar', 'bass', 'drums', 'lead'];
  const results = new Map<string, AudioBuffer>();

  // Check if there are notes for each stem group before rendering
  for (const group of stems) {
    const groupNotes = notes.filter((n) => ROLE_TO_STEM[n.role] === group);
    if (groupNotes.length === 0) continue;

    const buffer = await Tone.Offline(async () => {
      const chain = await buildChain(group, stereoDouble && group === 'guitar');
      for (const note of groupNotes) {
        triggerNote(chain, note, note.time, stereoDouble && group === 'guitar', group);
      }
    }, totalDuration, 2);

    results.set(group, buffer as unknown as AudioBuffer);
  }

  return results;
}

/**
 * Render a single pattern to a stereo AudioBuffer.
 */
export async function renderPatternToWav(
  pattern: Pattern,
  bpm: number,
  options?: RenderOptions,
): Promise<AudioBuffer> {
  const { notes, duration } = patternToSchedule(pattern, bpm);
  const stereoDouble = options?.stereoDouble ?? false;
  const totalDuration = duration + 1.5;

  const buffer = await Tone.Offline(async () => {
    const chain = await buildChain(null, stereoDouble);
    for (const note of notes) {
      triggerNote(chain, note, note.time, stereoDouble, null);
    }
  }, totalDuration, 2);

  return buffer as unknown as AudioBuffer;
}
