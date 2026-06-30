// The arranger ties the rhythm, harmony, riff, bass, drum and lead generators
// together into either a single loopable pattern or a full multi-section song —
// the "Suno for metal" arrangement layer (structure + parts, rendered locally).

import { Rng } from './random';
import { generateRhythm, barsToSteps, type RhythmOnset } from './rhythm';
import { generateProgression, offsetLabel } from './harmony';
import { generateRiff } from './riff';
import { generateBass } from './bass';
import { generateDrums } from './drums';
import { DRUM } from './drums';
import { generateLead } from './lead';
import { applyGroove } from './humanize';
import { getTuning } from './theory';
import type {
  GenerationParams,
  Pattern,
  Section,
  Song,
  SongFormId,
  TempoEvent,
  Track,
} from './types';

const STEPS_PER_BEAT = 4; // 16th-note grid

type Intensity = 'low' | 'mid' | 'high';

interface PatternOptions {
  rng: Rng;
  intensity?: Intensity;
  complexityBoost?: number;
  onsets?: RhythmOnset[];
  /** Per-bar harmonic root offsets (shared across repeats of a section). */
  rootOffsets?: number[];
  /** Override the time signature numerator for this pattern. */
  beatsPerBar?: number;
  /** Add a lead/melody line on top of the riff. */
  withLead?: boolean;
}

/** Build one complete loopable pattern (guitar + bass + full kit [+ lead]). */
export function generatePattern(
  params: GenerationParams,
  opts: PatternOptions,
): Pattern {
  const {
    rng,
    intensity = 'mid',
    complexityBoost = 0,
    onsets: presetOnsets,
    rootOffsets: presetOffsets,
    beatsPerBar = params.beatsPerBar,
    withLead = false,
  } = opts;
  const tuning = getTuning(params.tuningId);
  const stepsPerBar = beatsPerBar * STEPS_PER_BEAT;
  const length = barsToSteps(params.barsPerPattern, beatsPerBar, STEPS_PER_BEAT);
  const complexity = clamp01(params.complexity + complexityBoost);

  const rootOffsets =
    presetOffsets ??
    generateProgression({
      bars: params.barsPerPattern,
      scale: params.scale,
      harmonicMotion: params.harmonicMotion,
      rng,
    });

  const onsets =
    presetOnsets ??
    generateRhythm({
      length,
      style: params.style,
      complexity,
      syncopation: params.syncopation,
      phrasing: params.phrasing,
      stepsPerBar,
      rng,
    });

  const guitar = generateRiff({
    onsets, tuning, key: params.key, scale: params.scale,
    complexity, rootOffsets, stepsPerBar, rng,
  });

  const bass = generateBass({
    guitar, tuning, key: params.key, scale: params.scale,
    complexity, rootOffsets, stepsPerBar, rng,
  });

  const drums = generateDrums({
    onsets, length, stepsPerBeat: STEPS_PER_BEAT, beatsPerBar,
    style: params.style, complexity, intensity, rng,
  });

  const tracks: Track[] = [guitar, bass, ...drums];

  if (withLead) {
    tracks.push(
      generateLead({
        length, stepsPerBeat: STEPS_PER_BEAT, tuning,
        key: params.key, scale: params.scale, complexity, rng,
      }),
    );
  }

  // Final groove pass — swing + humanization baked into the hits.
  applyGroove(tracks, {
    humanize: params.humanize,
    swing: params.swing,
    stepsPerBeat: STEPS_PER_BEAT,
    rng,
  });

  return { length, stepsPerBeat: STEPS_PER_BEAT, beatsPerBar, tracks };
}

interface SectionBlueprint {
  name: string;
  repeats: number;
  intensity: Intensity;
  complexityBoost: number;
  /** Reuse the rhythm skeleton tagged with this key (for repeated sections). */
  riffKey?: string;
  /** Lead line over this section. */
  lead?: boolean;
}

const SONG_FORM_STANDARD: SectionBlueprint[] = [
  { name: 'Intro', repeats: 1, intensity: 'low', complexityBoost: -0.2, riffKey: 'A' },
  { name: 'Verse', repeats: 2, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Pre-Chorus', repeats: 1, intensity: 'mid', complexityBoost: 0.1, riffKey: 'B' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Verse', repeats: 1, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Breakdown', repeats: 2, intensity: 'high', complexityBoost: -0.1, riffKey: 'D' },
  { name: 'Outro', repeats: 1, intensity: 'low', complexityBoost: -0.25, riffKey: 'A', lead: true },
];

const SONG_FORM_PROGRESSIVE: SectionBlueprint[] = [
  { name: 'Intro', repeats: 2, intensity: 'low', complexityBoost: -0.15, riffKey: 'A' },
  { name: 'Verse', repeats: 2, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Pre-Chorus', repeats: 1, intensity: 'mid', complexityBoost: 0.1, riffKey: 'B' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Bridge', repeats: 2, intensity: 'mid', complexityBoost: 0.15, riffKey: 'E', lead: true },
  { name: 'Solo', repeats: 2, intensity: 'high', complexityBoost: 0.2, riffKey: 'F', lead: true },
  { name: 'Breakdown', repeats: 2, intensity: 'high', complexityBoost: -0.1, riffKey: 'D' },
  { name: 'Verse', repeats: 1, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.1, riffKey: 'C', lead: true },
  { name: 'Outro', repeats: 2, intensity: 'low', complexityBoost: -0.2, riffKey: 'A', lead: true },
];

const SONG_FORM_SHORT: SectionBlueprint[] = [
  { name: 'Intro', repeats: 1, intensity: 'low', complexityBoost: -0.1, riffKey: 'A' },
  { name: 'Verse', repeats: 2, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Outro', repeats: 1, intensity: 'low', complexityBoost: -0.2, riffKey: 'A' },
];

const SONG_FORM_EXTENDED: SectionBlueprint[] = [
  { name: 'Intro', repeats: 1, intensity: 'low', complexityBoost: -0.2, riffKey: 'A' },
  { name: 'Verse', repeats: 2, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Pre-Chorus', repeats: 1, intensity: 'mid', complexityBoost: 0.1, riffKey: 'B' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Verse', repeats: 1, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Pre-Chorus', repeats: 1, intensity: 'mid', complexityBoost: 0.1, riffKey: 'B' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Bridge', repeats: 2, intensity: 'mid', complexityBoost: 0.1, riffKey: 'E', lead: true },
  { name: 'Breakdown', repeats: 2, intensity: 'high', complexityBoost: -0.1, riffKey: 'D' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.1, riffKey: 'C', lead: true },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.15, riffKey: 'C', lead: true },
  { name: 'Outro', repeats: 1, intensity: 'low', complexityBoost: -0.25, riffKey: 'A', lead: true },
];

const SONG_FORMS: Record<SongFormId, SectionBlueprint[]> = {
  standard: SONG_FORM_STANDARD,
  progressive: SONG_FORM_PROGRESSIVE,
  short: SONG_FORM_SHORT,
  extended: SONG_FORM_EXTENDED,
};

/** Get the active song form based on params. */
function getSongForm(params: GenerationParams): SectionBlueprint[] {
  return SONG_FORMS[params.songForm] ?? SONG_FORM_STANDARD;
}

/** Decide the meter for each riff key (deterministic from the song rng). */
function assignMeters(params: GenerationParams, rng: Rng, form: SectionBlueprint[]): Map<string, number> {
  const meters = new Map<string, number>();
  const allKeys = [...new Set(form.map((bp) => bp.riffKey).filter(Boolean) as string[])];
  for (const k of allKeys) {
    if (!params.allowMeterShifts) {
      meters.set(k, params.beatsPerBar);
      continue;
    }
    // Give 'D' (breakdowns) and 'E' (bridges) odd meters; rest keeps base meter
    if (k === 'D' || k === 'F') meters.set(k, rng.pick([7, 5, 6]));
    else if (k === 'B' || k === 'E') meters.set(k, rng.pick([params.beatsPerBar, 6, 5]));
    else meters.set(k, params.beatsPerBar);
  }
  return meters;
}

/** Generate a full, structured song. */
export function generateSong(params: GenerationParams): Song {
  const rng = new Rng(params.seed);
  const tuning = getTuning(params.tuningId);
  const form = getSongForm(params);
  const meterByKey = assignMeters(params, rng, form);

  // Pre-generate a rhythm skeleton AND a harmonic progression per riffKey so
  // every occurrence of a section is musically identical.
  const skeletons = new Map<string, RhythmOnset[]>();
  const progressions = new Map<string, number[]>();
  for (const bp of form) {
    if (!bp.riffKey || skeletons.has(bp.riffKey)) continue;
    const meter = meterByKey.get(bp.riffKey) ?? params.beatsPerBar;
    const length = barsToSteps(params.barsPerPattern, meter, STEPS_PER_BEAT);
    const isBreakdown = bp.name === 'Breakdown';
    skeletons.set(
      bp.riffKey,
      generateRhythm({
        length,
        style: params.style,
        complexity: clamp01(params.complexity + (isBreakdown ? -0.3 : bp.complexityBoost)),
        syncopation: isBreakdown ? params.syncopation * 0.4 : params.syncopation,
        phrasing: params.phrasing,
        stepsPerBar: meter * STEPS_PER_BEAT,
        rng,
      }),
    );
    progressions.set(
      bp.riffKey,
      generateProgression({
        bars: params.barsPerPattern,
        scale: params.scale,
        // Breakdowns usually hammer one root; reduce their motion.
        harmonicMotion: isBreakdown ? params.harmonicMotion * 0.3 : params.harmonicMotion,
        rng,
      }),
    );
  }

  const sections: Section[] = form.map((bp, i) => {
    const pattern = generatePattern(params, {
      rng,
      intensity: bp.intensity,
      complexityBoost: bp.complexityBoost,
      onsets: bp.riffKey ? skeletons.get(bp.riffKey) : undefined,
      rootOffsets: bp.riffKey ? progressions.get(bp.riffKey) : undefined,
      beatsPerBar: bp.riffKey ? meterByKey.get(bp.riffKey) : params.beatsPerBar,
      withLead: bp.lead,
    });
    return { id: `${bp.name}-${i}`, name: bp.name, repeats: bp.repeats, pattern };
  });

  // Post-processing: apply per-section velocity scaling (dynamic builds within repeats)
  applyDynamicBuilds(sections);

  // Post-processing: add transition fills between sections
  addTransitionFills(sections, rng);

  // Tempo automation: optionally slow down breakdowns
  const tempoMap = buildTempoMap(sections, params, form);

  const totalBars = sections.reduce((n, s) => n + s.repeats * params.barsPerPattern, 0);
  const meterList = [...new Set([...meterByKey.values()])].map((m) => `${m}/4`).join(', ');
  const progA = (progressions.get('A') ?? [0]).map(offsetLabel).join(' – ');

  const notes = [
    `${params.style} feel in ${params.key} ${params.scale}, ${tuning.name}.`,
    `${totalBars} bars @ ${params.bpm} BPM across ${sections.length} sections (${params.phrasing} phrasing).`,
    `Form: ${params.songForm}. Meters: ${meterList}${params.allowMeterShifts ? ' (odd-meter shifts on)' : ''}.`,
    `Main riff (A) progression: ${progA}.`,
    `Groove: swing ${Math.round(params.swing * 100)}%, humanize ${Math.round(params.humanize * 100)}%.`,
  ];
  if (tempoMap.length > 1) {
    notes.push(`Tempo map: ${tempoMap.map((t) => `bar ${t.bar}: ${t.bpm} BPM`).join(', ')}.`);
  }
  notes.push(`Seed ${params.seed} — same seed + settings always regenerates this exact song.`);

  return {
    title: generateTitle(rng),
    bpm: params.bpm,
    tuning,
    key: params.key,
    scale: params.scale,
    sections,
    notes,
    tempoMap: tempoMap.length > 1 ? tempoMap : undefined,
  };
}

/**
 * Apply per-section velocity scaling so repeated sections build naturally.
 * The base pattern velocity is scaled to a midpoint; the MIDI export applies
 * the per-repeat ramp (first repeat quieter at 0.85x, last at full volume).
 */
function applyDynamicBuilds(sections: Section[]): void {
  for (const section of sections) {
    if (section.repeats <= 1) continue;
    const firstScale = 0.85;
    const lastScale = 1.0 + 0.05 * (section.repeats - 1);
    // Scale base pattern hits to the midpoint between first and last repeat
    const midScale = (firstScale + lastScale) / 2;
    for (const track of section.pattern.tracks) {
      for (const hit of track.hits) {
        hit.velocity = clamp01(hit.velocity * midScale);
      }
    }
  }
}

/**
 * Add transition fills between sections: a crash cymbal at the new section's
 * downbeat, and a drum fill on the last beat of the outgoing section.
 * Also applies a velocity crescendo on the last 2 beats transitioning into
 * higher-intensity sections.
 */
function addTransitionFills(sections: Section[], _rng: Rng): void {
  for (let i = 0; i < sections.length - 1; i++) {
    const outgoing = sections[i];
    const incoming = sections[i + 1];
    const pat = outgoing.pattern;
    const lastBeatStart = pat.length - pat.stepsPerBeat;
    const secondLastBeatStart = pat.length - pat.stepsPerBeat * 2;

    // Add a drum fill on the last beat of the outgoing section
    const fillTrack = pat.tracks.find((t) => t.role === 'snare') ??
      pat.tracks.find((t) => t.role === 'tom');
    if (fillTrack) {
      // Remove existing hits at the fill steps to avoid double-triggers
      const fillSteps = new Set<number>();
      for (let s = 0; s < pat.stepsPerBeat; s++) {
        const step = lastBeatStart + s;
        if (step < pat.length) {
          fillSteps.add(step);
        }
      }
      fillTrack.hits = fillTrack.hits.filter((h) => !fillSteps.has(h.step));

      // Add snare/tom hits on the last beat subdivisions
      const fillPitches = [DRUM.snare, DRUM.tomHigh, DRUM.tomMid, DRUM.snare];
      for (let s = 0; s < pat.stepsPerBeat; s++) {
        const step = lastBeatStart + s;
        if (step < pat.length) {
          fillTrack.hits.push({
            step,
            duration: 1,
            pitch: fillPitches[s % fillPitches.length],
            velocity: 0.7 + s * 0.08,
            accent: true,
          });
        }
      }
    }

    // Velocity crescendo on the last 2 beats for sections transitioning to higher intensity
    const intensityOrder: Record<Intensity, number> = { low: 0, mid: 1, high: 2 };
    const outInt = intensityOrder[getIntensityForSection(outgoing)] ?? 1;
    const inInt = intensityOrder[getIntensityForSection(incoming)] ?? 1;
    if (inInt > outInt) {
      // Crescendo: ramp velocity up on last 2 beats
      for (const track of pat.tracks) {
        for (const hit of track.hits) {
          if (hit.step >= secondLastBeatStart && hit.step < pat.length) {
            const progress = (hit.step - secondLastBeatStart) / (pat.stepsPerBeat * 2);
            hit.velocity = clamp01(hit.velocity * (1.0 + progress * 0.3));
          }
        }
      }
    }

    // Add a crash cymbal hit at the start of the incoming section (step 0 of its pattern)
    const inPat = incoming.pattern;
    const crashTrack = inPat.tracks.find((t) => t.role === 'crash');
    if (crashTrack) {
      crashTrack.hits.push({
        step: 0,
        duration: 4,
        pitch: DRUM.crash,
        velocity: 0.95,
        accent: true,
      });
    } else {
      // Create a crash track if one doesn't exist
      inPat.tracks.push({
        name: 'crash',
        role: 'crash',
        hits: [{
          step: 0,
          duration: 4,
          pitch: DRUM.crash,
          velocity: 0.95,
          accent: true,
        }],
      });
    }
  }
}

/** Infer intensity from section name. */
function getIntensityForSection(section: Section): Intensity {
  const name = section.name.toLowerCase();
  if (name.includes('chorus') || name.includes('breakdown') || name.includes('solo')) return 'high';
  if (name.includes('intro') || name.includes('outro')) return 'low';
  return 'mid';
}

/**
 * Build tempo map with optional tempo drops at breakdowns.
 * Returns array of { bar, bpm } events. Always includes bar 0 at base BPM.
 */
function buildTempoMap(sections: Section[], params: GenerationParams, form: SectionBlueprint[]): TempoEvent[] {
  const tempoMap: TempoEvent[] = [{ bar: 0, bpm: params.bpm }];
  let currentBar = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const bp = form[i];
    const sectionBars = section.repeats * params.barsPerPattern;

    if (bp && bp.name === 'Breakdown') {
      // Drop tempo at breakdowns by 8-15 BPM
      const drop = 8 + Math.floor((bp.complexityBoost + 0.2) * 35); // roughly 8-15
      const breakdownBpm = Math.max(60, params.bpm - clamp(drop, 8, 15));
      tempoMap.push({ bar: currentBar, bpm: breakdownBpm });
      // Restore after breakdown
      tempoMap.push({ bar: currentBar + sectionBars, bpm: params.bpm });
    }

    currentBar += sectionBars;
  }

  return tempoMap;
}

const TITLE_WORDS_A = [
  'Fractured', 'Obsidian', 'Hollow', 'Liminal', 'Severed', 'Gravity',
  'Lurking', 'Dissonant', 'Spectral', 'Tessellate', 'Monolith', 'Vantablack',
];
const TITLE_WORDS_B = [
  'Horizon', 'Pulse', 'Equinox', 'Construct', 'Threshold', 'Apparition',
  'Geometry', 'Paradigm', 'Abyss', 'Cascade', 'Mantra', 'Vertices',
];

function generateTitle(rng: Rng): string {
  return `${rng.pick(TITLE_WORDS_A)} ${rng.pick(TITLE_WORDS_B)}`;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}
