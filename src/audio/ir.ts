// Procedurally generates guitar-cab impulse responses for convolution, so the
// rendered tone gets real speaker-cab coloration (resonances + roll-off)
// instead of a plain low-pass. IRs are rendered offline once at init.

import * as Tone from 'tone';
import type { CabType } from './rig';

interface CabVoicing {
  lowpass: number;
  /** Presence peak (Hz, gain dB). */
  peakFreq: number;
  peakGain: number;
  /** Low-mid body resonance. */
  bodyFreq: number;
  bodyGain: number;
  /** Decay length in seconds (cab "size"). */
  decay: number;
}

const VOICINGS: Record<CabType, CabVoicing> = {
  'modern-v30': { lowpass: 5200, peakFreq: 2400, peakGain: 5, bodyFreq: 180, bodyGain: 3, decay: 0.05 },
  'tight-4x12': { lowpass: 6000, peakFreq: 3200, peakGain: 6, bodyFreq: 220, bodyGain: 2, decay: 0.045 },
  'fat-2x12': { lowpass: 4200, peakFreq: 1800, peakGain: 4, bodyFreq: 140, bodyGain: 5, decay: 0.06 },
  'fizz-1x12': { lowpass: 7500, peakFreq: 4200, peakGain: 7, bodyFreq: 260, bodyGain: 1, decay: 0.04 },
};

/** Render a single cab IR into an AudioBuffer using an offline graph. */
export async function makeCabIR(sampleRate: number, cab: CabType): Promise<AudioBuffer> {
  const v = VOICINGS[cab];
  const len = Math.max(256, Math.floor(sampleRate * v.decay));
  const offline = new OfflineAudioContext(1, len, sampleRate);

  // Source: exponentially-decaying white noise (the raw "impulse" energy).
  const noiseBuf = offline.createBuffer(1, len, sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2.5);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = offline.createBufferSource();
  src.buffer = noiseBuf;

  // Speaker voicing: high-pass (no sub rumble) -> body resonance -> presence
  // peak -> low-pass roll-off.
  const hp = offline.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 95;

  const body = offline.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = v.bodyFreq;
  body.Q.value = 1;
  body.gain.value = v.bodyGain;

  const peak = offline.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = v.peakFreq;
  peak.Q.value = 1.4;
  peak.gain.value = v.peakGain;

  const lp = offline.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = v.lowpass;
  lp.Q.value = 0.7;

  src.connect(hp);
  hp.connect(body);
  body.connect(peak);
  peak.connect(lp);
  lp.connect(offline.destination);
  src.start(0);

  return offline.startRendering();
}

/** Make all cab IRs as Tone buffers, keyed by cab type. */
export async function makeAllCabIRs(): Promise<Record<CabType, Tone.ToneAudioBuffer>> {
  const sampleRate = Tone.getContext().sampleRate;
  const cabs: CabType[] = ['modern-v30', 'tight-4x12', 'fat-2x12', 'fizz-1x12'];
  const entries = await Promise.all(
    cabs.map(async (cab) => {
      const buf = await makeCabIR(sampleRate, cab);
      return [cab, new Tone.ToneAudioBuffer(buf)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CabType, Tone.ToneAudioBuffer>;
}
