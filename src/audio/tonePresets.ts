// Prompt-to-tone engine + tone matching from an uploaded reference track.
//
// This is the "AI" seam for the tone-crafting feature. Right now it ships a
// fast, fully-offline RULE-BASED engine (keyword scoring + reference-audio
// feature extraction). The ToneEngine interface is the upgrade point: drop in
// an LLM (prompt -> rig JSON) or a neural amp matcher (NAM/audio -> profile)
// later without touching the UI.

import { DEFAULT_RIG, type CabType, type RigSettings } from './rig';

export interface ToneSuggestion {
  settings: RigSettings;
  /** Name of the closest archetype that anchored the suggestion. */
  archetype: string;
  /** Human-readable reasoning for the choices. */
  rationale: string[];
  /** 0..1 confidence (low for rule-based, room to grow with real ML). */
  confidence: number;
}

/** The pluggable seam. Implement this with an LLM/NAM backend later. */
export interface ToneEngine {
  fromPrompt(prompt: string): Promise<ToneSuggestion>;
  fromReference(features: AudioFeatures, prompt?: string): Promise<ToneSuggestion>;
}

// --- Named archetypes: hand-tuned starting points the engine blends toward. ---
interface Archetype {
  name: string;
  keywords: string[];
  settings: RigSettings;
}

const ARCHETYPES: Archetype[] = [
  {
    name: 'Thall Bounce',
    keywords: ['thall', 'bounce', 'vildhjarta', 'humanity', 'lurking', 'dissonant', 'ambient'],
    settings: { ...DEFAULT_RIG, drive: 0.78, tightness: 95, bass: 3, mid: -2, midFreq: 750, treble: 2, presence: 3, cab: 'modern-v30', reverb: 0.22, delay: 0.12, delayTime: 0.38, level: 0.8 },
  },
  {
    name: 'Modern Djent',
    keywords: ['djent', 'periphery', 'meshuggah', 'tight', 'modern', 'polyphia', 'progressive', 'clean high gain'],
    settings: { ...DEFAULT_RIG, drive: 0.82, tightness: 110, bass: 2, mid: -4, midFreq: 850, treble: 4, presence: 5, cab: 'tight-4x12', reverb: 0.08, delay: 0, level: 0.82 },
  },
  {
    name: 'Deathcore Wall',
    keywords: ['deathcore', 'breakdown', 'brutal', 'heavy', 'low', 'slam', 'wall', 'crushing'],
    settings: { ...DEFAULT_RIG, drive: 0.9, tightness: 75, bass: 6, mid: -2, midFreq: 600, treble: 2, presence: 2, cab: 'fat-2x12', reverb: 0.05, delay: 0, level: 0.85 },
  },
  {
    name: 'Lead / Solo Sing',
    keywords: ['lead', 'solo', 'singing', 'melodic', 'smooth', 'liquid', 'fusion', 'sustain'],
    settings: { ...DEFAULT_RIG, drive: 0.7, tightness: 80, bass: 3, mid: 2, midFreq: 1000, treble: 4, presence: 5, cab: 'modern-v30', reverb: 0.3, delay: 0.28, delayTime: 0.42, level: 0.8 },
  },
  {
    name: 'Vintage Thrash',
    keywords: ['thrash', 'vintage', 'old school', 'raw', 'gritty', 'crunch'],
    settings: { ...DEFAULT_RIG, drive: 0.75, tightness: 120, bass: 2, mid: 3, midFreq: 1200, treble: 5, presence: 4, cab: 'fizz-1x12', reverb: 0.06, delay: 0, level: 0.8 },
  },
];

// Modifier keywords that nudge specific parameters regardless of archetype.
interface Modifier {
  match: string[];
  apply: (s: RigSettings, rationale: string[]) => void;
}

const MODIFIERS: Modifier[] = [
  { match: ['tight', 'tighter', 'percussive', 'staccato'], apply: (s, r) => { s.tightness = Math.min(160, s.tightness + 25); s.bass -= 1; r.push('Tighter low end (raised pre-gain high-pass) for percussive chugs.'); } },
  { match: ['loose', 'fat', 'thick', 'chunky'], apply: (s, r) => { s.tightness = Math.max(50, s.tightness - 25); s.bass += 2; r.push('Looser, fatter low end for weight.'); } },
  { match: ['bright', 'cutting', 'sharp', 'fizz'], apply: (s, r) => { s.treble += 2; s.presence += 2; r.push('Brighter top end / more presence to cut through a mix.'); } },
  { match: ['dark', 'warm', 'mellow', 'smooth'], apply: (s, r) => { s.treble -= 2; s.presence -= 2; s.cab = 'fat-2x12'; r.push('Darker, warmer voicing.'); } },
  { match: ['scooped', 'scoop'], apply: (s, r) => { s.mid -= 4; r.push('Scooped mids for that modern recto flavour.'); } },
  { match: ['mid', 'honk', 'nasal', 'forward'], apply: (s, r) => { s.mid += 4; r.push('Pushed mids so it stays forward in the mix.'); } },
  { match: ['high gain', 'saturated', 'gainy', 'more gain'], apply: (s, r) => { s.drive = Math.min(1, s.drive + 0.1); r.push('More saturation.'); } },
  { match: ['low gain', 'less gain', 'cleaner', 'clarity'], apply: (s, r) => { s.drive = Math.max(0.3, s.drive - 0.15); r.push('Backed off the gain for note clarity.'); } },
  { match: ['ambient', 'atmospheric', 'spacey', 'reverb', 'wash'], apply: (s, r) => { s.reverb = Math.min(0.6, s.reverb + 0.25); s.delay = Math.min(0.5, s.delay + 0.15); r.push('Added ambient reverb/delay wash.'); } },
  { match: ['dry', 'no reverb', 'tight mix'], apply: (s, r) => { s.reverb = 0.03; s.delay = 0; r.push('Dry signal for a tight, in-your-face mix.'); } },
];

function scoreArchetype(prompt: string, a: Archetype): number {
  const p = prompt.toLowerCase();
  return a.keywords.reduce((score, kw) => (p.includes(kw) ? score + 1 : score), 0);
}

/** The default, offline rule-based engine. */
export class RuleBasedToneEngine implements ToneEngine {
  async fromPrompt(prompt: string): Promise<ToneSuggestion> {
    const p = prompt.toLowerCase().trim();
    // Pick the best-matching archetype (default to Modern Djent).
    let best = ARCHETYPES[1];
    let bestScore = 0;
    for (const a of ARCHETYPES) {
      const s = scoreArchetype(p, a);
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }

    const settings: RigSettings = { ...best.settings };
    const rationale: string[] = [
      `Anchored on the "${best.name}" voicing${bestScore === 0 ? ' (default — no strong genre keyword found)' : ''}.`,
    ];

    for (const mod of MODIFIERS) {
      if (mod.match.some((m) => p.includes(m))) mod.apply(settings, rationale);
    }
    clampSettings(settings);

    return {
      settings,
      archetype: best.name,
      rationale,
      confidence: bestScore > 0 ? 0.7 : 0.45,
    };
  }

  async fromReference(features: AudioFeatures, prompt = ''): Promise<ToneSuggestion> {
    // Start from the prompt (if any) then bend toward the measured features.
    const base = await this.fromPrompt(prompt || 'modern djent');
    const s = base.settings;
    const rationale = [...base.rationale];

    // Brightness (zero-crossing proxy) -> treble/presence + cab brightness.
    if (features.brightness > 0.6) {
      s.treble += 2; s.presence += 2; s.cab = 'tight-4x12';
      rationale.push(`Reference is bright (ZCR ${features.brightness.toFixed(2)}) — added top end.`);
    } else if (features.brightness < 0.35) {
      s.treble -= 2; s.cab = 'fat-2x12';
      rationale.push(`Reference is dark (ZCR ${features.brightness.toFixed(2)}) — warmer cab.`);
    }

    // Energy / compression (RMS) -> drive amount.
    if (features.energy > 0.5) {
      s.drive = Math.min(1, s.drive + 0.08);
      rationale.push(`High average energy (RMS ${features.energy.toFixed(2)}) — pushed gain/saturation.`);
    }

    // Low-end dominance -> bass + tightness.
    if (features.lowRatio > 0.55) {
      s.bass += 2; s.tightness = Math.max(60, s.tightness - 15);
      rationale.push('Strong low-frequency content — fattened and loosened the low end to match.');
    } else if (features.lowRatio < 0.35) {
      s.tightness += 15;
      rationale.push('Light on lows — tightened the pre-gain high-pass.');
    }

    clampSettings(s);
    return {
      settings: s,
      archetype: base.archetype,
      rationale,
      confidence: 0.55,
    };
  }
}

export const toneEngine: ToneEngine = new RuleBasedToneEngine();

// --- Reference-audio feature extraction (real, lightweight, offline). ---

export interface AudioFeatures {
  /** 0..1 brightness from zero-crossing rate. */
  brightness: number;
  /** 0..1 average RMS energy. */
  energy: number;
  /** 0..1 share of energy below ~250 Hz vs. total. */
  lowRatio: number;
  durationSec: number;
}

/** Decode + analyse an uploaded audio file to drive tone matching. */
export async function analyzeAudioFile(file: File): Promise<AudioFeatures> {
  const arrayBuf = await file.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const buffer = await ctx.decodeAudioData(arrayBuf);
  const data = buffer.getChannelData(0);
  const n = data.length;

  // Zero-crossing rate -> brightness.
  let crossings = 0;
  let sumSq = 0;
  for (let i = 1; i < n; i++) {
    if ((data[i - 1] < 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] < 0)) crossings++;
    sumSq += data[i] * data[i];
  }
  const zcr = crossings / n; // ~0..0.5 typically
  const brightness = Math.min(1, zcr * 6);
  const rms = Math.sqrt(sumSq / n);
  const energy = Math.min(1, rms * 4);

  // Crude low/high split via a one-pole low-pass to estimate low-frequency share.
  const cutoff = 250;
  const dt = 1 / buffer.sampleRate;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);
  let lp = 0;
  let lowSq = 0;
  for (let i = 0; i < n; i++) {
    lp = lp + alpha * (data[i] - lp);
    lowSq += lp * lp;
  }
  const lowRms = Math.sqrt(lowSq / n);
  const lowRatio = rms > 0 ? Math.min(1, lowRms / rms) : 0.5;

  await ctx.close();
  return { brightness, energy, lowRatio, durationSec: buffer.duration };
}

// --- Export: preset JSON + human-readable signal-chain spec. ---

const CAB_LABEL: Record<CabType, string> = {
  'modern-v30': 'Modern 4x12 (V30-style)',
  'tight-4x12': 'Tight 4x12',
  'fat-2x12': 'Fat 2x12',
  'fizz-1x12': 'Bright 1x12',
};

export interface RigPreset {
  app: 'thall-forge';
  version: 1;
  name: string;
  settings: RigSettings;
}

export function buildPreset(name: string, settings: RigSettings): RigPreset {
  return { app: 'thall-forge', version: 1, name, settings };
}

/** A readable, gear-style description users can recreate in their own rig/DAW. */
export function describeSignalChain(settings: RigSettings): string[] {
  const s = settings;
  return [
    `Guitar → Noise Gate (threshold ${s.gateThreshold} dB)`,
    `→ Tightness High-Pass @ ${Math.round(s.tightness)} Hz (pre-gain)`,
    `→ High-Gain Amp (drive ${(s.drive * 10).toFixed(1)}/10)`,
    `→ Tone Stack: Bass ${fmtDb(s.bass)}, Mid ${fmtDb(s.mid)} @ ${Math.round(s.midFreq)} Hz, Treble ${fmtDb(s.treble)}`,
    `→ Presence ${fmtDb(s.presence)}`,
    `→ Cab: ${CAB_LABEL[s.cab]}`,
    `→ Delay ${(s.delay * 100).toFixed(0)}% wet @ ${(s.delayTime * 1000).toFixed(0)} ms`,
    `→ Reverb ${(s.reverb * 100).toFixed(0)}% wet`,
    `→ Output ${(s.level * 100).toFixed(0)}%`,
  ];
}

function fmtDb(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
}

export function clampSettings(s: RigSettings): void {
  s.drive = clamp(s.drive, 0.2, 1);
  s.tightness = clamp(s.tightness, 40, 180);
  s.bass = clamp(s.bass, -8, 8);
  s.mid = clamp(s.mid, -8, 8);
  s.treble = clamp(s.treble, -8, 8);
  s.presence = clamp(s.presence, -8, 8);
  s.midFreq = clamp(s.midFreq, 300, 2000);
  s.reverb = clamp(s.reverb, 0, 0.7);
  s.delay = clamp(s.delay, 0, 0.6);
  s.delayTime = clamp(s.delayTime, 0.05, 0.8);
  s.level = clamp(s.level, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function downloadPreset(preset: RigPreset): void {
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${preset.name.replace(/\s+/g, '-').toLowerCase()}.thallforge.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
