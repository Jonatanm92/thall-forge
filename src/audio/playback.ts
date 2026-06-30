// In-browser playback engine built on Tone.js (v15).
//
// Renders generated patterns / songs to audio entirely client-side: a distorted
// dual-voice guitar (separate palm-mute and open chains), a gritty bass, and a
// fully synthesized metal kit. No samples required, so it runs anywhere.

import * as Tone from 'tone';
import { midiToNote } from '../engine/theory';
import type { Pattern, Song, TrackRole } from '../engine/types';
import { DRUM } from '../engine/drums';
import { makeAllCabIRs } from './ir';

export interface ScheduledNote {
  time: number; // seconds from start
  role: TrackRole;
  pitch: number;
  duration: number; // seconds
  velocity: number;
  palmMute: boolean;
  voicing?: number[];
}

export type StepCallback = (info: {
  section: number;
  globalStep: number;
  totalSteps: number;
}) => void;

export class ThallPlayer {
  private initialized = false;
  private part: Tone.Part | null = null;
  private meterId: number | null = null;

  // Instruments
  private guitarOpen!: Tone.PolySynth;
  private guitarMute!: Tone.PolySynth;
  private guitarCab!: Tone.Convolver;
  private bass!: Tone.MonoSynth;
  private kick!: Tone.MembraneSynth;
  private kickClick!: Tone.NoiseSynth;
  private snare!: Tone.NoiseSynth;
  private snareBody!: Tone.MembraneSynth;
  private hat!: Tone.MetalSynth;
  private ride!: Tone.MetalSynth;
  private crash!: Tone.MetalSynth;
  private tom!: Tone.MembraneSynth;

  private masterGain!: Tone.Gain;
  private onStep: StepCallback | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    this.masterGain = new Tone.Gain(0.9).toDestination();
    const limiter = new Tone.Limiter(-1).connect(this.masterGain);

    // Shared convolution guitar cab (real speaker coloration). Falls back to a
    // plain low-pass if IR rendering is unavailable.
    let cabOut: Tone.ToneAudioNode = limiter;
    try {
      const irs = await makeAllCabIRs();
      this.guitarCab = new Tone.Convolver();
      this.guitarCab.buffer = irs['modern-v30'];
      this.guitarCab.connect(limiter);
      cabOut = this.guitarCab;
    } catch {
      cabOut = new Tone.Filter(6000, 'lowpass').connect(limiter);
    }

    // --- Guitar: two voices for palm-muted chugs vs. open/ringing notes. ---
    // 'fatsawtooth' = stacked detuned saws -> thick, doubled-guitar feel.
    const openHp = new Tone.Filter(80, 'highpass');
    const openDist = new Tone.Distortion(0.85);
    openDist.oversample = '4x';
    const openEq = new Tone.EQ3({ low: 3, mid: -2, high: 2 });
    this.guitarOpen = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0.6, release: 0.25 },
    });
    this.guitarOpen.chain(openHp, openDist, openEq, cabOut);
    this.guitarOpen.volume.value = -12;

    // Mute chain: tighter pre-gain HP + scooped EQ -> percussive djent chug.
    const muteHp = new Tone.Filter(90, 'highpass');
    const muteDist = new Tone.Distortion(0.95);
    muteDist.oversample = '4x';
    const muteEq = new Tone.EQ3({ low: 4, mid: -4, high: 1 });
    this.guitarMute = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.05 },
    });
    this.guitarMute.chain(muteHp, muteDist, muteEq, cabOut);
    this.guitarMute.volume.value = -9;

    // --- Bass: gritty, sits under the guitar. ---
    const bassDist = new Tone.Distortion(0.4);
    const bassEq = new Tone.EQ3({ low: 6, mid: 1, high: -4 });
    this.bass = new Tone.MonoSynth({
      oscillator: { type: 'square' },
      filter: { Q: 1, type: 'lowpass' },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.2 },
      filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.4, release: 0.2, baseFrequency: 120, octaves: 3 },
    });
    this.bass.connect(bassDist);
    bassDist.connect(bassEq);
    bassEq.connect(limiter);
    this.bass.volume.value = -12;

    // --- Drum kit (layered synthesis). ---
    // Kick = membrane body + a short noise "click" for attack/beater snap.
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.02 },
    });
    this.kick.connect(limiter);
    this.kick.volume.value = -4;
    this.kickClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.015, sustain: 0 },
    });
    const clickHp = new Tone.Filter(3500, 'highpass');
    this.kickClick.connect(clickHp);
    clickHp.connect(limiter);
    this.kickClick.volume.value = -14;

    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    });
    const snareHp = new Tone.Filter(1800, 'highpass');
    this.snare.connect(snareHp);
    snareHp.connect(limiter);
    this.snare.volume.value = -10;

    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    });
    this.snareBody.connect(limiter);
    this.snareBody.volume.value = -16;

    this.hat = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 6000,
      octaves: 1.5,
    });
    const hatHp = new Tone.Filter(8000, 'highpass');
    this.hat.connect(hatHp);
    hatHp.connect(limiter);
    this.hat.volume.value = -22;

    this.ride = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
      harmonicity: 4.1,
      modulationIndex: 16,
      resonance: 5000,
      octaves: 2,
    });
    this.ride.connect(limiter);
    this.ride.volume.value = -24;

    this.crash = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 1.2, release: 0.4 },
      harmonicity: 3.1,
      modulationIndex: 20,
      resonance: 4000,
      octaves: 2.5,
    });
    this.crash.connect(limiter);
    this.crash.volume.value = -24;

    this.tom = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
    });
    this.tom.connect(limiter);
    this.tom.volume.value = -10;

    this.initialized = true;
  }

  setMasterVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.rampTo(v, 0.05);
  }

  setOnStep(cb: StepCallback | null): void {
    this.onStep = cb;
  }

  /** Build a flat schedule of notes from a single looping pattern. */
  private patternToSchedule(pattern: Pattern, bpm: number): {
    notes: ScheduledNote[];
    duration: number;
    stepDur: number;
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
    return { notes, duration: pattern.length * stepDur, stepDur };
  }

  /** Build a flat schedule for a full song (sections flattened with repeats). */
  private songToSchedule(song: Song): {
    notes: ScheduledNote[];
    duration: number;
    stepDur: number;
    totalSteps: number;
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
    return {
      notes,
      duration: cursorSteps * stepDur,
      stepDur,
      totalSteps: cursorSteps,
    };
  }

  async playPattern(pattern: Pattern, bpm: number): Promise<void> {
    await this.init();
    this.stop();
    const { notes, duration, stepDur } = this.patternToSchedule(pattern, bpm);
    this.schedule(notes, duration, stepDur, true);
  }

  async playSong(song: Song): Promise<void> {
    await this.init();
    this.stop();
    const { notes, duration, stepDur } = this.songToSchedule(song);
    this.schedule(notes, duration, stepDur, false);
  }

  private schedule(
    notes: ScheduledNote[],
    duration: number,
    stepDur: number,
    loop: boolean,
  ): void {
    const transport = Tone.getTransport();
    transport.bpm.value = 120; // we schedule in absolute seconds, so bpm is nominal

    this.part = new Tone.Part((time, note: ScheduledNote) => {
      this.trigger(note, time);
    }, notes.map((n) => [n.time, n] as [number, ScheduledNote]));

    this.part.loop = loop;
    this.part.loopEnd = duration;
    this.part.start(0);

    transport.loop = loop;
    transport.loopStart = 0;
    transport.loopEnd = duration;

    // Playhead callback (one tick per 16th step).
    const totalSteps = Math.round(duration / stepDur);
    this.meterId = transport.scheduleRepeat((time) => {
      const pos = transport.seconds % duration;
      const globalStep = Math.floor(pos / stepDur);
      if (this.onStep) {
        Tone.getDraw().schedule(() => {
          this.onStep?.({ section: 0, globalStep, totalSteps });
        }, time);
      }
    }, stepDur);

    if (!loop) {
      transport.scheduleOnce(() => this.stop(), duration + 0.1);
    }

    transport.start();
  }

  private trigger(note: ScheduledNote, time: number): void {
    const vel = Math.max(0.05, Math.min(1, note.velocity));
    switch (note.role) {
      case 'guitar':
        if (note.palmMute) {
          this.guitarMute.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
        } else {
          this.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
          note.voicing?.forEach((p) =>
            this.guitarOpen.triggerAttackRelease(midiToNote(p), note.duration, time, vel),
          );
        }
        break;
      case 'lead':
        this.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel * 0.9);
        break;
      case 'bass':
        this.bass.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
        break;
      case 'kick':
        this.kick.triggerAttackRelease('C1', '16n', time, vel);
        this.kickClick.triggerAttackRelease('32n', time, vel * 0.9);
        break;
      case 'snare':
        this.snare.triggerAttackRelease('16n', time, vel);
        this.snareBody.triggerAttackRelease('D2', '16n', time, vel * 0.8);
        break;
      case 'tom':
        this.tom.triggerAttackRelease(midiToNote(note.pitch - 12), '8n', time, vel);
        break;
      case 'hat':
      case 'ride':
      case 'crash':
        this.triggerCymbal(note.pitch, time, vel);
        break;
    }
  }

  private triggerCymbal(pitch: number, time: number, vel: number): void {
    if (pitch === DRUM.crash) {
      this.crash.triggerAttackRelease('C5', '2n', time, vel * 0.9);
    } else if (pitch === DRUM.ride) {
      this.ride.triggerAttackRelease('C5', '8n', time, vel * 0.8);
    } else if (pitch === DRUM.openHat) {
      this.hat.triggerAttackRelease('C5', '8n', time, vel);
    } else {
      this.hat.triggerAttackRelease('C5', '32n', time, vel);
    }
  }

  stop(): void {
    const transport = Tone.getTransport();
    if (this.part) {
      this.part.stop();
      this.part.dispose();
      this.part = null;
    }
    if (this.meterId != null) {
      transport.clear(this.meterId);
      this.meterId = null;
    }
    transport.stop();
    transport.cancel();
    if (this.onStep) this.onStep({ section: 0, globalStep: -1, totalSteps: 0 });
  }

  get isReady(): boolean {
    return this.initialized;
  }
}

// A single shared player instance for the whole app.
export const player = new ThallPlayer();
