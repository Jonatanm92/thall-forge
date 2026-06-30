// Playable guitar rig: a Web Audio amp / cab / effects chain (via Tone.js).
//
// IMPORTANT design decision (driven by real-world latency):
//   In-browser live input on Windows without ASIO routinely adds 80-150ms of
//   round-trip latency, which is unplayable for tracking. So this rig is built
//   primarily as a *tone designer / auditioner*:
//     - PREVIEW mode runs a built-in clean "DI" lick through the chain so you
//       hear the tone instantly, with zero dependence on input latency.
//     - LIVE mode (plug your guitar in) is opt-in and clearly flagged as only
//       suitable for low-latency setups (Mac / external interface / ASIO).
//   The real payoff is exporting the designed tone (see tonePresets.ts) to
//   recreate in your actual low-latency rig or DAW.

import * as Tone from 'tone';
import { makeAllCabIRs } from './ir';

export type CabType = 'modern-v30' | 'tight-4x12' | 'fat-2x12' | 'fizz-1x12';

export interface RigSettings {
  /** Noise gate threshold in dB (more negative = lets more through). */
  gateThreshold: number;
  /** Pre-gain tightness — high-pass before the drive (Hz). Tames flub. */
  tightness: number;
  /** Amount of distortion / gain, 0..1. */
  drive: number;
  /** Tone stack, dB. */
  bass: number;
  mid: number;
  treble: number;
  /** Mid sweep frequency (Hz) — the "djent scoop/honk" control. */
  midFreq: number;
  /** Presence / top-end air, dB. */
  presence: number;
  cab: CabType;
  /** Reverb wet 0..1. */
  reverb: number;
  /** Delay wet 0..1 and time in seconds. */
  delay: number;
  delayTime: number;
  /** Output level 0..1. */
  level: number;
}

export const DEFAULT_RIG: RigSettings = {
  gateThreshold: -40,
  tightness: 90,
  drive: 0.8,
  bass: 4,
  mid: -3,
  treble: 3,
  midFreq: 800,
  presence: 4,
  cab: 'modern-v30',
  reverb: 0.12,
  delay: 0,
  delayTime: 0.3,
  level: 0.8,
};

// Cab "voicing" — modelled with a low-pass roll-off + a presence notch since a
// full convolution IR library is out of scope. Tuned to feel like each cab.
const CAB_VOICING: Record<CabType, { lowpass: number; notch: number; notchQ: number }> = {
  'modern-v30': { lowpass: 5200, notch: 3200, notchQ: 1.2 },
  'tight-4x12': { lowpass: 6000, notch: 4000, notchQ: 1.6 },
  'fat-2x12': { lowpass: 4200, notch: 2500, notchQ: 0.9 },
  'fizz-1x12': { lowpass: 7500, notch: 5000, notchQ: 0.8 },
};

export class GuitarRig {
  private initialized = false;
  private settings: RigSettings = { ...DEFAULT_RIG };

  private inputGain!: Tone.Gain;
  private gate!: Tone.Gate;
  private tightHp!: Tone.Filter;
  private dist!: Tone.Distortion;
  private toneStack!: Tone.EQ3;
  private midPeak!: Tone.Filter;
  private presenceShelf!: Tone.Filter;
  private cabNode!: Tone.ToneAudioNode;
  private cabConv?: Tone.Convolver;
  private cabFallback?: Tone.Filter;
  private cabIRs?: Record<CabType, Tone.ToneAudioBuffer>;
  private delayFx!: Tone.FeedbackDelay;
  private reverbFx!: Tone.Reverb;
  private outGain!: Tone.Gain;

  private userMedia: Tone.UserMedia | null = null;
  private diSynth: Tone.PluckSynth | null = null;
  private diPart: Tone.Part | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    await Tone.start();

    this.inputGain = new Tone.Gain(1);
    this.gate = new Tone.Gate(this.settings.gateThreshold, 0.05);
    this.tightHp = new Tone.Filter(this.settings.tightness, 'highpass');
    this.dist = new Tone.Distortion(this.settings.drive);
    this.dist.oversample = '4x';
    this.toneStack = new Tone.EQ3({
      low: this.settings.bass,
      mid: this.settings.mid,
      high: this.settings.treble,
    });
    this.midPeak = new Tone.Filter({ type: 'peaking', frequency: this.settings.midFreq, Q: 1.4, gain: this.settings.mid });
    this.presenceShelf = new Tone.Filter({ type: 'highshelf', frequency: 3500, gain: this.settings.presence });

    // Convolution cab (real speaker coloration); fall back to a low-pass if IR
    // rendering isn't available.
    try {
      this.cabIRs = await makeAllCabIRs();
      this.cabConv = new Tone.Convolver();
      this.cabConv.buffer = this.cabIRs[this.settings.cab];
      this.cabNode = this.cabConv;
    } catch {
      this.cabFallback = new Tone.Filter(CAB_VOICING[this.settings.cab].lowpass, 'lowpass');
      this.cabNode = this.cabFallback;
    }

    this.delayFx = new Tone.FeedbackDelay({ delayTime: this.settings.delayTime, feedback: 0.3, wet: this.settings.delay });
    this.reverbFx = new Tone.Reverb({ decay: 2.2, wet: this.settings.reverb });
    this.outGain = new Tone.Gain(this.settings.level).toDestination();

    // Wire the chain.
    this.inputGain.chain(
      this.gate,
      this.tightHp,
      this.dist,
      this.toneStack,
      this.midPeak,
      this.presenceShelf,
      this.cabNode,
      this.delayFx,
      this.reverbFx,
      this.outGain,
    );

    this.initialized = true;
  }

  getSettings(): RigSettings {
    return { ...this.settings };
  }

  /** Apply a (possibly partial) settings update to the live chain. */
  async applySettings(next: Partial<RigSettings>): Promise<void> {
    await this.init();
    this.settings = { ...this.settings, ...next };
    const s = this.settings;
    this.gate.threshold = s.gateThreshold;
    this.tightHp.frequency.rampTo(s.tightness, 0.05);
    this.dist.distortion = s.drive;
    this.toneStack.low.rampTo(s.bass, 0.05);
    this.toneStack.high.rampTo(s.treble, 0.05);
    this.midPeak.frequency.rampTo(s.midFreq, 0.05);
    this.midPeak.gain.rampTo(s.mid, 0.05);
    this.presenceShelf.gain.rampTo(s.presence, 0.05);
    // Swap the cab IR (or move the fallback low-pass) when the cab changes.
    if (this.cabConv && this.cabIRs) {
      this.cabConv.buffer = this.cabIRs[s.cab];
    } else if (this.cabFallback) {
      this.cabFallback.frequency.rampTo(CAB_VOICING[s.cab].lowpass, 0.05);
    }
    this.delayFx.wet.rampTo(s.delay, 0.05);
    this.delayFx.delayTime.rampTo(s.delayTime, 0.05);
    this.reverbFx.wet.rampTo(s.reverb, 0.05);
    this.outGain.gain.rampTo(s.level, 0.05);
  }

  // --- PREVIEW: a built-in clean DI lick run through the rig (latency-free) ---

  /** Play a short DI riff through the current rig so the tone can be judged. */
  async previewRiff(bpm = 140): Promise<void> {
    await this.init();
    this.stopPreview();

    // PluckSynth ~ a clean DI guitar (Karplus-Strong). Route INTO the rig.
    this.diSynth = new Tone.PluckSynth({
      attackNoise: 1,
      dampening: 4000,
      resonance: 0.9,
    });
    this.diSynth.connect(this.inputGain);

    // A simple low chug-and-lift lick in a drop tuning feel.
    const step = 60 / bpm / 4; // 16th
    const lick: Array<[number, string]> = [
      [0, 'E1'], [1, 'E1'], [2, 'E1'], [4, 'E1'], [5, 'E1'],
      [7, 'G1'], [8, 'E1'], [9, 'E1'], [11, 'A1'], [12, 'E1'],
      [13, 'E1'], [14, 'C2'], [15, 'E1'],
    ];
    const events = lick.map(([s, n]) => [s * step, n] as [number, string]);

    this.diPart = new Tone.Part((time, note: string) => {
      this.diSynth?.triggerAttackRelease(note, '16n', time, 0.9);
    }, events);
    this.diPart.loop = true;
    this.diPart.loopEnd = 16 * step;
    this.diPart.start(0);

    const transport = Tone.getTransport();
    transport.start();
  }

  stopPreview(): void {
    if (this.diPart) {
      this.diPart.stop();
      this.diPart.dispose();
      this.diPart = null;
    }
    if (this.diSynth) {
      this.diSynth.dispose();
      this.diSynth = null;
    }
  }

  // --- LIVE INPUT: opt-in, latency-warned (Mac / ASIO / interface only) ---

  /**
   * Connect the browser audio input (guitar interface / mic) into the rig.
   * Returns an estimated round-trip latency in ms so the UI can warn the user.
   */
  async startLiveInput(): Promise<{ latencyMs: number }> {
    await this.init();
    this.stopPreview();
    if (!this.userMedia) {
      this.userMedia = new Tone.UserMedia();
    }
    await this.userMedia.open();
    this.userMedia.connect(this.inputGain);

    const ctx = Tone.getContext().rawContext as AudioContext;
    const base = (ctx.baseLatency ?? 0) * 1000;
    const out = ((ctx as unknown as { outputLatency?: number }).outputLatency ?? 0) * 1000;
    // Hardware input buffering is not exposed; add a realistic estimate.
    const estimate = Math.round(base + out + 25);
    return { latencyMs: estimate };
  }

  stopLiveInput(): void {
    if (this.userMedia) {
      this.userMedia.disconnect();
      this.userMedia.close();
      this.userMedia.dispose();
      this.userMedia = null;
    }
  }

  stopAll(): void {
    this.stopPreview();
    this.stopLiveInput();
    Tone.getTransport().stop();
  }

  get isReady(): boolean {
    return this.initialized;
  }
}

export const guitarRig = new GuitarRig();
