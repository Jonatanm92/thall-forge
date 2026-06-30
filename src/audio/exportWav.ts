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
        articulation: hit.articulation,
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
            articulation: hit.articulation,
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
  pinchHarmonicSynth: Tone.PolySynth;
  bassSub: Tone.MonoSynth;
  bassGrit: Tone.MonoSynth;
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
  // ---- Master mix bus chain (mirrors ThallPlayer.init()) ----
  const masterGain = new Tone.Gain(0.9).toDestination();
  const masterLimiter = new Tone.Limiter(-0.5).connect(masterGain);
  const masterEq = new Tone.EQ3({ low: 0, mid: 0, high: 2, highFrequency: 8000 }).connect(masterLimiter);
  const masterComp = new Tone.Compressor({
    threshold: -18,
    ratio: 3,
    attack: 0.01,
    release: 0.1,
  }).connect(masterEq);

  // Silent output for muted stems
  const silentGain = new Tone.Gain(0);

  function dest(group: StemGroup): Tone.ToneAudioNode {
    if (filterGroup === null) return masterComp;
    return group === filterGroup ? masterComp : silentGain;
  }

  // ---- Per-instrument bus gains ----
  const guitarBus = new Tone.Gain(1).connect(dest('guitar'));
  const bassBus = new Tone.Gain(1).connect(dest('bass'));
  const leadBus = new Tone.Gain(1).connect(dest('lead'));

  // ---- Drum bus with parallel compression ----
  const drumBusNode = new Tone.Gain(1);
  const drumDry = new Tone.Gain(1).connect(dest('drums'));
  drumBusNode.connect(drumDry);
  const drumCompressor = new Tone.Compressor({
    threshold: -30,
    ratio: 8,
    attack: 0.003,
    release: 0.05,
  });
  const drumWetGain = new Tone.Gain(0.3).connect(dest('drums'));
  drumBusNode.connect(drumCompressor);
  drumCompressor.connect(drumWetGain);

  // Guitar cab IR -- build within the offline context
  let guitarDest: Tone.ToneAudioNode = guitarBus;
  try {
    const sampleRate = Tone.getContext().sampleRate;
    const irBuf = await makeCabIR(sampleRate, 'modern-v30');
    const cabConv = new Tone.Convolver();
    cabConv.buffer = new Tone.ToneAudioBuffer(irBuf);
    cabConv.connect(guitarBus);
    guitarDest = cabConv;
  } catch {
    const fallback = new Tone.Filter(6000, 'lowpass');
    fallback.connect(guitarBus);
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
      detune: 5,
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

  // Pinch harmonic synth
  const pinchDist = new Tone.Distortion(0.9);
  pinchDist.oversample = '4x';
  const pinchHarmonicSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 2, spread: 40 },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 },
  });
  pinchHarmonicSynth.chain(pinchDist, guitarDest);
  pinchHarmonicSynth.volume.value = -6;

  // Bass: dual-layer (sub + grit)
  const subLp = new Tone.Filter(250, 'lowpass');
  const subGain = new Tone.Gain(0.6).connect(bassBus);
  subLp.connect(subGain);
  const bassSub = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filter: { Q: 1, type: 'lowpass', frequency: 300 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2 },
    filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.2, baseFrequency: 80, octaves: 2 },
  });
  bassSub.connect(subLp);
  bassSub.volume.value = -10;

  const gritDist = new Tone.Distortion(0.7);
  const gritBp = new Tone.Filter(800, 'bandpass');
  gritBp.Q.value = 1.5;
  const gritGain = new Tone.Gain(0.4).connect(bassBus);
  gritBp.connect(gritGain);
  gritDist.connect(gritBp);
  const bassGrit = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { Q: 2, type: 'lowpass', frequency: 2000 },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.15 },
    filterEnvelope: { attack: 0.005, decay: 0.08, sustain: 0.3, release: 0.15, baseFrequency: 200, octaves: 3 },
  });
  bassGrit.connect(gritDist);
  bassGrit.volume.value = -8;

  // Drums (all routed to drumBusNode)
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.02 },
  });
  kick.connect(drumBusNode);
  kick.volume.value = -4;

  const kickClick = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.015, sustain: 0 },
  });
  const clickHp = new Tone.Filter(3500, 'highpass');
  kickClick.connect(clickHp);
  clickHp.connect(drumBusNode);
  kickClick.volume.value = -14;

  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
  });
  const snareHp = new Tone.Filter(1800, 'highpass');
  snare.connect(snareHp);
  snareHp.connect(drumBusNode);
  snare.volume.value = -10;

  const snareBody = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
  });
  snareBody.connect(drumBusNode);
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
  hatHp.connect(drumBusNode);
  hat.volume.value = -22;

  const ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
    harmonicity: 4.1,
    modulationIndex: 16,
    resonance: 5000,
    octaves: 2,
  });
  ride.connect(drumBusNode);
  ride.volume.value = -24;

  const crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.2, release: 0.4 },
    harmonicity: 3.1,
    modulationIndex: 20,
    resonance: 4000,
    octaves: 2.5,
  });
  crash.connect(drumBusNode);
  crash.volume.value = -24;

  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
  });
  tom.connect(drumBusNode);
  tom.volume.value = -10;

  // Suppress unused variable for lead bus (used implicitly via dest('lead'))
  void leadBus;

  return {
    guitarOpen,
    guitarMute,
    guitarOpenR,
    guitarMuteR,
    pinchHarmonicSynth,
    bassSub,
    bassGrit,
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
      triggerGuitarNote(chain, note, time, vel, stereoDouble);
      break;
    case 'lead':
      chain.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel * 0.9);
      break;
    case 'bass':
      chain.bassSub.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
      chain.bassGrit.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
      break;
    case 'kick':
      triggerKickNote(chain, time, vel);
      break;
    case 'snare':
      triggerSnareNote(chain, time, vel);
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

function triggerGuitarNote(
  chain: OfflineChain,
  note: ScheduledNote,
  time: number,
  vel: number,
  stereoDouble: boolean,
): void {
  const art = note.articulation;

  if (art === 'pinchHarmonic') {
    const harmonicNote = midiToNote(note.pitch + 24);
    chain.pinchHarmonicSynth.triggerAttackRelease(harmonicNote, 0.08, time, vel);
    chain.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel * 0.5);
    if (stereoDouble && chain.guitarOpenR) {
      chain.guitarOpenR.triggerAttackRelease(midiToNote(note.pitch), note.duration, time + DOUBLE_OFFSET, vel * 0.5);
    }
    return;
  }

  if (art === 'hammerOn') {
    const hammerVel = vel * 0.7;
    chain.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration * 0.8, time, hammerVel);
    if (stereoDouble && chain.guitarOpenR) {
      chain.guitarOpenR.triggerAttackRelease(midiToNote(note.pitch), note.duration * 0.8, time + DOUBLE_OFFSET, hammerVel);
    }
    return;
  }

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
}

function triggerKickNote(chain: OfflineChain, time: number, vel: number): void {
  const pitchDecay = 0.05 - vel * 0.03;
  chain.kick.pitchDecay = pitchDecay;
  chain.kick.triggerAttackRelease('C1', '16n', time, vel);
  chain.kickClick.triggerAttackRelease('32n', time, vel * 0.9);
}

function triggerSnareNote(chain: OfflineChain, time: number, vel: number): void {
  if (vel > 0.9) {
    chain.snare.envelope.decay = 0.09;
    chain.snare.triggerAttackRelease('16n', time, vel);
    chain.snareBody.triggerAttackRelease('E2', '16n', time, vel * 0.9);
  } else {
    chain.snare.envelope.decay = 0.16;
    chain.snare.triggerAttackRelease('16n', time, vel);
    chain.snareBody.triggerAttackRelease('D2', '16n', time, vel * 0.8);
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
