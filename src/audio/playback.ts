// In-browser playback engine built on Tone.js (v15).
//
// Renders generated patterns / songs to audio entirely client-side: a distorted
// dual-voice guitar (separate palm-mute and open chains), a dual-layer bass,
// and a fully synthesized metal kit with parallel-compressed drum bus. The
// master bus applies glue compression, presence EQ, and limiting for a
// "produced" sound. No samples required, so it runs anywhere.

import * as Tone from 'tone';
import { midiToNote } from '../engine/theory';
import type { Articulation, MixSettings, Pattern, Song, TrackRole } from '../engine/types';
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
  articulation?: Articulation;
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
  private bassSub!: Tone.MonoSynth;
  private bassGrit!: Tone.MonoSynth;
  private kick!: Tone.MembraneSynth;
  private kickClick!: Tone.NoiseSynth;
  private snare!: Tone.NoiseSynth;
  private snareBody!: Tone.MembraneSynth;
  private hat!: Tone.MetalSynth;
  private ride!: Tone.MetalSynth;
  private crash!: Tone.MetalSynth;
  private tom!: Tone.MembraneSynth;

  // Stereo doubling (Right channel, panned hard R with +5 cent detune)
  private guitarOpenR: Tone.PolySynth | null = null;
  private guitarMuteR: Tone.PolySynth | null = null;
  private guitarPanL!: Tone.Panner;
  private guitarMutePanL!: Tone.Panner;
  private _stereoDouble = false;

  // Pinch harmonic synth (high harmonic burst)
  private pinchHarmonicSynth!: Tone.PolySynth;

  // Bus gains for per-instrument volume control
  private guitarBus!: Tone.Gain;
  private bassBus!: Tone.Gain;
  private drumBus!: Tone.Gain;
  private leadBus!: Tone.Gain;
  private masterGain!: Tone.Gain;

  private onStep: StepCallback | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    // ---- Master mix bus chain ----
    // All instruments -> bus gains -> master compressor -> presence EQ -> limiter -> masterGain -> destination
    this.masterGain = new Tone.Gain(0.9).toDestination();
    const masterLimiter = new Tone.Limiter(-0.5).connect(this.masterGain);
    const masterEq = new Tone.EQ3({ low: 0, mid: 0, high: 2, highFrequency: 8000 }).connect(masterLimiter);
    const masterComp = new Tone.Compressor({
      threshold: -18,
      ratio: 3,
      attack: 0.01,
      release: 0.1,
    }).connect(masterEq);

    // ---- Per-instrument bus gains (for mix level control) ----
    this.guitarBus = new Tone.Gain(1).connect(masterComp);
    this.bassBus = new Tone.Gain(1).connect(masterComp);
    this.leadBus = new Tone.Gain(1).connect(masterComp);

    // ---- Drum bus with parallel compression ----
    // Dry path: drumBus -> masterComp
    // Wet path: drumBus -> drumCompressor -> drumWetGain -> masterComp
    // The dry goes at full volume, the wet is mixed in at ~30%
    this.drumBus = new Tone.Gain(1);
    const drumDry = new Tone.Gain(1).connect(masterComp);
    this.drumBus.connect(drumDry);
    const drumCompressor = new Tone.Compressor({
      threshold: -30,
      ratio: 8,
      attack: 0.003,
      release: 0.05,
    });
    const drumWetGain = new Tone.Gain(0.3).connect(masterComp);
    this.drumBus.connect(drumCompressor);
    drumCompressor.connect(drumWetGain);

    // Shared convolution guitar cab (real speaker coloration). Falls back to a
    // plain low-pass if IR rendering is unavailable.
    let cabOut: Tone.ToneAudioNode = this.guitarBus;
    try {
      const irs = await makeAllCabIRs();
      this.guitarCab = new Tone.Convolver();
      this.guitarCab.buffer = irs['modern-v30'];
      this.guitarCab.connect(this.guitarBus);
      cabOut = this.guitarCab;
    } catch {
      cabOut = new Tone.Filter(6000, 'lowpass').connect(this.guitarBus);
    }

    // --- Guitar: two voices for palm-muted chugs vs. open/ringing notes. ---
    const openHp = new Tone.Filter(80, 'highpass');
    const openDist = new Tone.Distortion(0.85);
    openDist.oversample = '4x';
    const openEq = new Tone.EQ3({ low: 3, mid: -2, high: 2 });
    this.guitarPanL = new Tone.Panner(0);
    this.guitarOpen = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0.6, release: 0.25 },
    });
    this.guitarOpen.chain(openHp, openDist, openEq, this.guitarPanL, cabOut);
    this.guitarOpen.volume.value = -12;

    // Mute chain: tighter pre-gain HP + scooped EQ -> percussive djent chug.
    const muteHp = new Tone.Filter(90, 'highpass');
    const muteDist = new Tone.Distortion(0.95);
    muteDist.oversample = '4x';
    const muteEq = new Tone.EQ3({ low: 4, mid: -4, high: 1 });
    this.guitarMutePanL = new Tone.Panner(0);
    this.guitarMute = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.05 },
    });
    this.guitarMute.chain(muteHp, muteDist, muteEq, this.guitarMutePanL, cabOut);
    this.guitarMute.volume.value = -9;

    // --- Stereo doubling: R-channel duplicates with +5 cent detune ---
    const openHpR = new Tone.Filter(80, 'highpass');
    const openDistR = new Tone.Distortion(0.85);
    openDistR.oversample = '4x';
    const openEqR = new Tone.EQ3({ low: 3, mid: -2, high: 2 });
    const panR = new Tone.Panner(1);
    this.guitarOpenR = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 28 },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0.6, release: 0.25 },
      detune: 5,
    });
    this.guitarOpenR.chain(openHpR, openDistR, openEqR, panR, cabOut);
    this.guitarOpenR.volume.value = -12;

    const muteHpR = new Tone.Filter(90, 'highpass');
    const muteDistR = new Tone.Distortion(0.95);
    muteDistR.oversample = '4x';
    const muteEqR = new Tone.EQ3({ low: 4, mid: -4, high: 1 });
    const panR2 = new Tone.Panner(1);
    this.guitarMuteR = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0.0, release: 0.05 },
      detune: 5,
    });
    this.guitarMuteR.chain(muteHpR, muteDistR, muteEqR, panR2, cabOut);
    this.guitarMuteR.volume.value = -9;

    // --- Pinch harmonic synth: high-harmonic burst blended at low volume ---
    const pinchDist = new Tone.Distortion(0.9);
    pinchDist.oversample = '4x';
    this.pinchHarmonicSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 40 },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.03 },
    });
    this.pinchHarmonicSynth.chain(pinchDist, cabOut);
    this.pinchHarmonicSynth.volume.value = -6;

    // --- Bass: dual-layer approach (sub + grit) ---
    // Layer 1 (sub): sine/triangle with low-pass at 250Hz for clean sub
    const subLp = new Tone.Filter(250, 'lowpass');
    const subGain = new Tone.Gain(0.6).connect(this.bassBus);
    subLp.connect(subGain);
    this.bassSub = new Tone.MonoSynth({
      oscillator: { type: 'triangle' },
      filter: { Q: 1, type: 'lowpass', frequency: 300 },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2 },
      filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.2, baseFrequency: 80, octaves: 2 },
    });
    this.bassSub.connect(subLp);
    this.bassSub.volume.value = -10;

    // Layer 2 (grit): sawtooth -> aggressive distortion -> band-pass ~800Hz
    const gritDist = new Tone.Distortion(0.7);
    const gritBp = new Tone.Filter(800, 'bandpass');
    gritBp.Q.value = 1.5;
    const gritGain = new Tone.Gain(0.4).connect(this.bassBus);
    gritBp.connect(gritGain);
    gritDist.connect(gritBp);
    this.bassGrit = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { Q: 2, type: 'lowpass', frequency: 2000 },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.15 },
      filterEnvelope: { attack: 0.005, decay: 0.08, sustain: 0.3, release: 0.15, baseFrequency: 200, octaves: 3 },
    });
    this.bassGrit.connect(gritDist);
    this.bassGrit.volume.value = -8;

    // --- Drum kit (layered synthesis, all routed to drumBus). ---
    // Kick = membrane body + a short noise "click" for attack/beater snap.
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.02 },
    });
    this.kick.connect(this.drumBus);
    this.kick.volume.value = -4;
    this.kickClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.015, sustain: 0 },
    });
    const clickHp = new Tone.Filter(3500, 'highpass');
    this.kickClick.connect(clickHp);
    clickHp.connect(this.drumBus);
    this.kickClick.volume.value = -14;

    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    });
    const snareHp = new Tone.Filter(1800, 'highpass');
    this.snare.connect(snareHp);
    snareHp.connect(this.drumBus);
    this.snare.volume.value = -10;

    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    });
    this.snareBody.connect(this.drumBus);
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
    hatHp.connect(this.drumBus);
    this.hat.volume.value = -22;

    this.ride = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.3, release: 0.1 },
      harmonicity: 4.1,
      modulationIndex: 16,
      resonance: 5000,
      octaves: 2,
    });
    this.ride.connect(this.drumBus);
    this.ride.volume.value = -24;

    this.crash = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 1.2, release: 0.4 },
      harmonicity: 3.1,
      modulationIndex: 20,
      resonance: 4000,
      octaves: 2.5,
    });
    this.crash.connect(this.drumBus);
    this.crash.volume.value = -24;

    this.tom = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
    });
    this.tom.connect(this.drumBus);
    this.tom.volume.value = -10;

    this.initialized = true;
  }

  setMasterVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.rampTo(v, 0.05);
  }

  /** Set per-instrument mix levels (all values 0-1). */
  setMixLevels(mix: MixSettings): void {
    if (!this.initialized) return;
    this.guitarBus.gain.rampTo(mix.guitar, 0.05);
    this.bassBus.gain.rampTo(mix.bass, 0.05);
    this.drumBus.gain.rampTo(mix.drums, 0.05);
    this.leadBus.gain.rampTo(mix.lead, 0.05);
    this.masterGain.gain.rampTo(mix.master, 0.05);
  }

  /** Enable/disable stereo guitar doubling (L/R with detune + timing offset). */
  get stereoDouble(): boolean {
    return this._stereoDouble;
  }

  set stereoDouble(enabled: boolean) {
    this._stereoDouble = enabled;
    if (this.initialized) {
      // Pan L channel hard left when doubling, center when not
      const panVal = enabled ? -1 : 0;
      this.guitarPanL.pan.rampTo(panVal, 0.05);
      this.guitarMutePanL.pan.rampTo(panVal, 0.05);
    }
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
          articulation: hit.articulation,
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
              articulation: hit.articulation,
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
        this.triggerGuitar(note, time, vel);
        break;
      case 'lead':
        this.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel * 0.9);
        break;
      case 'bass':
        this.bassSub.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
        this.bassGrit.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
        break;
      case 'kick':
        this.triggerKick(time, vel);
        break;
      case 'snare':
        this.triggerSnare(time, vel);
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

  private triggerGuitar(note: ScheduledNote, time: number, vel: number): void {
    const art = note.articulation;

    if (art === 'pinchHarmonic') {
      // Play the note 2 octaves up with a very short envelope burst
      const harmonicNote = midiToNote(note.pitch + 24);
      this.pinchHarmonicSynth.triggerAttackRelease(harmonicNote, 0.08, time, vel);
      // Also play the normal note at lower volume
      this.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel * 0.5);
      if (this._stereoDouble && this.guitarOpenR) {
        this.guitarOpenR.triggerAttackRelease(midiToNote(note.pitch), note.duration, time + 0.010, vel * 0.5);
      }
      return;
    }

    if (art === 'hammerOn') {
      // Play with lower velocity and slightly shorter attack (quicker onset)
      const hammerVel = vel * 0.7;
      this.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration * 0.8, time, hammerVel);
      if (this._stereoDouble && this.guitarOpenR) {
        this.guitarOpenR.triggerAttackRelease(midiToNote(note.pitch), note.duration * 0.8, time + 0.010, hammerVel);
      }
      return;
    }

    // For slides, we trigger normally (pitch ramp is handled by the scheduler
    // in offline mode; in real-time we just play the note -- the effect is
    // subtle enough that the rapid consecutive notes simulate the slide)
    if (note.palmMute) {
      this.guitarMute.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
      if (this._stereoDouble && this.guitarMuteR) {
        this.guitarMuteR.triggerAttackRelease(midiToNote(note.pitch), note.duration, time + 0.010, vel);
      }
    } else {
      this.guitarOpen.triggerAttackRelease(midiToNote(note.pitch), note.duration, time, vel);
      note.voicing?.forEach((p) =>
        this.guitarOpen.triggerAttackRelease(midiToNote(p), note.duration, time, vel),
      );
      if (this._stereoDouble && this.guitarOpenR) {
        this.guitarOpenR.triggerAttackRelease(midiToNote(note.pitch), note.duration, time + 0.010, vel);
        note.voicing?.forEach((p) =>
          this.guitarOpenR!.triggerAttackRelease(midiToNote(p), note.duration, time + 0.010, vel),
        );
      }
    }
  }

  /** Velocity-sensitive kick: harder hits = faster pitch sweep = more attack. */
  private triggerKick(time: number, vel: number): void {
    // Adjust pitchDecay based on velocity (harder = faster sweep = punchier)
    const pitchDecay = 0.05 - vel * 0.03; // range: 0.02 (hard) to 0.05 (soft)
    this.kick.pitchDecay = pitchDecay;
    this.kick.triggerAttackRelease('C1', '16n', time, vel);
    this.kickClick.triggerAttackRelease('32n', time, vel * 0.9);
  }

  /** Velocity-sensitive snare: high velocity (>0.9) triggers rimshot behavior. */
  private triggerSnare(time: number, vel: number): void {
    if (vel > 0.9) {
      // Rimshot: shorter decay + brighter noise filter for a cracking sound
      this.snare.envelope.decay = 0.09;
      this.snare.triggerAttackRelease('16n', time, vel);
      this.snareBody.triggerAttackRelease('E2', '16n', time, vel * 0.9);
    } else {
      this.snare.envelope.decay = 0.16;
      this.snare.triggerAttackRelease('16n', time, vel);
      this.snareBody.triggerAttackRelease('D2', '16n', time, vel * 0.8);
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
