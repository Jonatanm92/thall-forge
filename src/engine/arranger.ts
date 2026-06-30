// The arranger ties the rhythm, riff, bass, drum and lead generators together
// into either a single loopable pattern or a full multi-section song — the
// "Suno for metal" arrangement layer (structure + parts, rendered locally).

import { Rng } from './random';
import { generateRhythm, barsToSteps, type RhythmOnset } from './rhythm';
import { generateRiff } from './riff';
import { generateBass } from './bass';
import { generateDrums } from './drums';
import { generateLead } from './lead';
import { getTuning } from './theory';
import type {
  GenerationParams,
  Pattern,
  Section,
  Song,
  Track,
} from './types';

const STEPS_PER_BEAT = 4; // 16th-note grid

type Intensity = 'low' | 'mid' | 'high';

interface PatternOptions {
  rng: Rng;
  intensity?: Intensity;
  complexityBoost?: number;
  onsets?: RhythmOnset[];
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
    beatsPerBar = params.beatsPerBar,
    withLead = false,
  } = opts;
  const tuning = getTuning(params.tuningId);
  const length = barsToSteps(params.barsPerPattern, beatsPerBar, STEPS_PER_BEAT);
  const complexity = clamp01(params.complexity + complexityBoost);

  const onsets =
    presetOnsets ??
    generateRhythm({
      length,
      style: params.style,
      complexity,
      syncopation: params.syncopation,
      rng,
    });

  const guitar = generateRiff({
    onsets,
    tuning,
    key: params.key,
    scale: params.scale,
    complexity,
    rng,
  });

  const bass = generateBass({
    guitar,
    tuning,
    key: params.key,
    scale: params.scale,
    complexity,
    rng,
  });

  const drums = generateDrums({
    onsets,
    length,
    stepsPerBeat: STEPS_PER_BEAT,
    beatsPerBar,
    style: params.style,
    complexity,
    intensity,
    rng,
  });

  const tracks: Track[] = [guitar, bass, ...drums];

  if (withLead) {
    tracks.push(
      generateLead({
        length,
        stepsPerBeat: STEPS_PER_BEAT,
        tuning,
        key: params.key,
        scale: params.scale,
        complexity,
        rng,
      }),
    );
  }

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

const SONG_FORM: SectionBlueprint[] = [
  { name: 'Intro', repeats: 1, intensity: 'low', complexityBoost: -0.2, riffKey: 'A' },
  { name: 'Verse', repeats: 2, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Pre-Chorus', repeats: 1, intensity: 'mid', complexityBoost: 0.1, riffKey: 'B' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Verse', repeats: 1, intensity: 'mid', complexityBoost: 0, riffKey: 'A' },
  { name: 'Chorus', repeats: 2, intensity: 'high', complexityBoost: 0.05, riffKey: 'C', lead: true },
  { name: 'Breakdown', repeats: 2, intensity: 'high', complexityBoost: -0.1, riffKey: 'D' },
  { name: 'Outro', repeats: 1, intensity: 'low', complexityBoost: -0.25, riffKey: 'A', lead: true },
];

/** Decide the meter for each riff key (deterministic from the song rng). */
function assignMeters(params: GenerationParams, rng: Rng): Map<string, number> {
  const meters = new Map<string, number>();
  const keys = ['A', 'B', 'C', 'D'];
  for (const k of keys) {
    if (!params.allowMeterShifts) {
      meters.set(k, params.beatsPerBar);
      continue;
    }
    // Breakdown (D) and pre-chorus (B) are the usual spots for an odd meter.
    if (k === 'D') meters.set(k, rng.pick([7, 5, 6]));
    else if (k === 'B') meters.set(k, rng.pick([params.beatsPerBar, 6, 5]));
    else meters.set(k, params.beatsPerBar);
  }
  return meters;
}

/** Generate a full, structured song. */
export function generateSong(params: GenerationParams): Song {
  const rng = new Rng(params.seed);
  const tuning = getTuning(params.tuningId);

  const meterByKey = assignMeters(params, rng);

  // Pre-generate one rhythmic skeleton per distinct riffKey so repeats line up.
  const skeletons = new Map<string, RhythmOnset[]>();
  for (const bp of SONG_FORM) {
    if (bp.riffKey && !skeletons.has(bp.riffKey)) {
      const meter = meterByKey.get(bp.riffKey) ?? params.beatsPerBar;
      const length = barsToSteps(params.barsPerPattern, meter, STEPS_PER_BEAT);
      const isBreakdown = bp.name === 'Breakdown';
      skeletons.set(
        bp.riffKey,
        generateRhythm({
          length,
          style: params.style,
          complexity: clamp01(
            params.complexity + (isBreakdown ? -0.3 : bp.complexityBoost),
          ),
          syncopation: isBreakdown ? params.syncopation * 0.4 : params.syncopation,
          rng,
        }),
      );
    }
  }

  const sections: Section[] = SONG_FORM.map((bp, i) => {
    const onsets = bp.riffKey ? skeletons.get(bp.riffKey) : undefined;
    const beatsPerBar = bp.riffKey ? meterByKey.get(bp.riffKey) : params.beatsPerBar;
    const pattern = generatePattern(params, {
      rng,
      intensity: bp.intensity,
      complexityBoost: bp.complexityBoost,
      onsets,
      beatsPerBar,
      withLead: bp.lead,
    });
    return {
      id: `${bp.name}-${i}`,
      name: bp.name,
      repeats: bp.repeats,
      pattern,
    };
  });

  const totalBars = sections.reduce(
    (n, s) => n + s.repeats * params.barsPerPattern,
    0,
  );

  const meterList = [...new Set([...meterByKey.values()])]
    .map((m) => `${m}/4`)
    .join(', ');

  return {
    title: generateTitle(rng),
    bpm: params.bpm,
    tuning,
    key: params.key,
    scale: params.scale,
    sections,
    notes: [
      `${params.style} feel in ${params.key} ${params.scale}, ${tuning.name}.`,
      `${totalBars} bars @ ${params.bpm} BPM across ${sections.length} sections.`,
      `Meters used: ${meterList}${params.allowMeterShifts ? ' (odd-meter shifts on)' : ''}.`,
      `Core riff skeletons: A=intro/verse, B=pre-chorus, C=chorus (with lead), D=breakdown.`,
      `Seed ${params.seed} — same seed + settings always regenerates this exact song.`,
    ],
  };
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
