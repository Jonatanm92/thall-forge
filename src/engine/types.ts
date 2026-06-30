// Core shared types for the Thall Forge generation engine.
//
// Everything in the engine works on a discrete step grid. The default
// resolution is the 16th note (4 steps per beat), which is the backbone of
// djent / thall rhythmic writing (syncopated palm-muted 16ths grouped in odd
// numbers over a steady 4/4 pulse).

/** A single musical event on the step grid. */
export interface Hit {
  /** Step index from the start of the pattern (0-based). */
  step: number;
  /** Duration in steps. */
  duration: number;
  /** MIDI pitch (0-127). For drums this is the GM percussion note. */
  pitch: number;
  /** Velocity 0-1. */
  velocity: number;
  /** Optional articulation flag used by the guitar/bass renderers. */
  palmMute?: boolean;
  /** Optional accent flag (ghost note when false-ish, accent when true). */
  accent?: boolean;
  /**
   * Optional additional MIDI pitches sounded together with `pitch` (power
   * chords / dyads). Absolute MIDI numbers, not intervals.
   */
  voicing?: number[];
  /**
   * Optional micro-timing offset in (fractional) steps, applied by the player
   * and MIDI export for swing/humanization. Positive = slightly late.
   */
  microShift?: number;
}

/** A named lane of hits (e.g. "kick", "bass", "guitar"). */
export interface Track {
  name: string;
  /** Instrument role, drives which synth/sampler renders it. */
  role: TrackRole;
  hits: Hit[];
}

export type TrackRole =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'ride'
  | 'crash'
  | 'tom'
  | 'bass'
  | 'guitar'
  | 'lead';

/** A self-contained block of music with a fixed length in steps. */
export interface Pattern {
  /** Total length in steps. */
  length: number;
  /** Steps per beat (4 = 16th-note grid). */
  stepsPerBeat: number;
  /** Beats per bar (time signature numerator). */
  beatsPerBar: number;
  tracks: Track[];
}

/** A labelled section of a song (intro, verse, chorus, ...). */
export interface Section {
  id: string;
  name: string;
  /** Number of times this pattern repeats. */
  repeats: number;
  pattern: Pattern;
}

/** A tempo change point for tempo automation. */
export interface TempoEvent {
  /** Bar number (0-based) where the tempo change occurs. */
  bar: number;
  /** New BPM value at this bar. */
  bpm: number;
}

/** A full generated song. */
export interface Song {
  title: string;
  bpm: number;
  tuning: Tuning;
  key: string;
  scale: ScaleName;
  sections: Section[];
  /** Free-form notes from the generator about the creative choices made. */
  notes: string[];
  /** Optional tempo automation map for tempo drops/ramps. */
  tempoMap?: TempoEvent[];
}

/** Available song form presets for the arranger. */
export type SongFormId = 'standard' | 'progressive' | 'short' | 'extended';

/** A guitar tuning, lowest string first, expressed as MIDI note numbers. */
export interface Tuning {
  id: string;
  name: string;
  /** MIDI note numbers, low to high. */
  strings: number[];
}

export type ScaleName =
  | 'phrygian'
  | 'phrygian-dominant'
  | 'aeolian'
  | 'locrian'
  | 'harmonic-minor'
  | 'dorian'
  | 'chromatic';

/** Sub-styles within the broad thall / modern-metal umbrella. */
export type GrooveStyle =
  | 'thall'
  | 'djent'
  | 'progressive'
  | 'deathcore'
  | 'ambient-djent';

/** Parameters that drive a full generation pass. */
export interface GenerationParams {
  style: GrooveStyle;
  bpm: number;
  tuningId: string;
  key: string;
  scale: ScaleName;
  /** 0..1 — how busy / technical the output is. */
  complexity: number;
  /** 0..1 — how much syncopation / off-grid displacement. */
  syncopation: number;
  /** Length of a single pattern in bars. */
  barsPerPattern: number;
  /** Time signature numerator (beats per bar). 4 = 4/4, 7 = 7/8 feel, etc. */
  beatsPerBar: number;
  /** Allow the arranger to shift some sections into odd meters. */
  allowMeterShifts: boolean;
  /** Rhythmic phrasing mode. */
  phrasing: import('./rhythm').Phrasing;
  /** 0..1 — how often the chord root moves off the tonic. */
  harmonicMotion: number;
  /** 0..1 — random timing/velocity humanization. */
  humanize: number;
  /** 0..1 — swing applied to off-beat 16ths. */
  swing: number;
  /** Deterministic seed so a "generation" can be reproduced. */
  seed: number;
  /** Song form / structure preset for the arranger. */
  songForm: SongFormId;
}
