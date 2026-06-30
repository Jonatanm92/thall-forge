// Turns a free-text song description into generation parameters. Uses the
// configured LLM when available, otherwise a keyword/number heuristic. Either
// way it returns a partial GenerationParams the UI merges over its defaults.

import { TUNINGS, SCALE_NAMES, KEYS } from '../engine/theory';
import type { GenerationParams, GrooveStyle, ScaleName } from '../engine/types';
import { chatJSON, isLLMConfigured, type ChatMessage } from './llm';

export interface ParsedParams {
  params: Partial<GenerationParams>;
  notes: string[];
  source: 'llm' | 'heuristic';
}

const STYLES: GrooveStyle[] = ['thall', 'djent', 'progressive', 'deathcore', 'ambient-djent'];
const TUNING_IDS = TUNINGS.map((t) => t.id);

const SYSTEM_PROMPT = `You translate a metal song description into generation parameters for a thall/djent tool.
Return ONLY strict JSON of this shape (omit fields you are unsure about):
{
  "style": one of ${STYLES.map((s) => `"${s}"`).join(' | ')},
  "bpm": number (60..260),
  "key": one of ${KEYS.map((k) => `"${k}"`).join(' | ')},
  "scale": one of ${SCALE_NAMES.map((s) => `"${s}"`).join(' | ')},
  "tuningId": one of ${TUNING_IDS.map((t) => `"${t}"`).join(' | ')},
  "complexity": number (0..1),
  "syncopation": number (0..1),
  "beatsPerBar": integer (3..7),
  "allowMeterShifts": boolean
}`;

export async function parseSongPrompt(prompt: string): Promise<ParsedParams> {
  if (isLLMConfigured()) {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ];
      const raw = await chatJSON<Record<string, unknown>>(messages);
      return { params: sanitize(raw), notes: ['Parsed by your configured LLM.'], source: 'llm' };
    } catch (e) {
      console.warn('LLM prompt parse failed, using heuristic:', e);
    }
  }
  return { ...heuristicParse(prompt), source: 'heuristic' };
}

/** Keep only valid, in-range fields from an arbitrary object. */
function sanitize(raw: Record<string, unknown>): Partial<GenerationParams> {
  const out: Partial<GenerationParams> = {};
  if (typeof raw.style === 'string' && STYLES.includes(raw.style as GrooveStyle)) out.style = raw.style as GrooveStyle;
  if (typeof raw.bpm === 'number') out.bpm = clamp(Math.round(raw.bpm), 60, 260);
  if (typeof raw.key === 'string' && KEYS.includes(raw.key)) out.key = raw.key;
  if (typeof raw.scale === 'string' && SCALE_NAMES.includes(raw.scale as ScaleName)) out.scale = raw.scale as ScaleName;
  if (typeof raw.tuningId === 'string' && TUNING_IDS.includes(raw.tuningId)) out.tuningId = raw.tuningId;
  if (typeof raw.complexity === 'number') out.complexity = clamp(raw.complexity, 0, 1);
  if (typeof raw.syncopation === 'number') out.syncopation = clamp(raw.syncopation, 0, 1);
  if (typeof raw.beatsPerBar === 'number') out.beatsPerBar = clamp(Math.round(raw.beatsPerBar), 3, 7);
  if (typeof raw.allowMeterShifts === 'boolean') out.allowMeterShifts = raw.allowMeterShifts;
  return out;
}

function heuristicParse(prompt: string): { params: Partial<GenerationParams>; notes: string[] } {
  const p = prompt.toLowerCase();
  const params: Partial<GenerationParams> = {};
  const notes: string[] = ['Parsed offline (no LLM configured).'];

  // Style
  if (p.includes('deathcore') || p.includes('breakdown') || p.includes('brutal')) params.style = 'deathcore';
  else if (p.includes('ambient') || p.includes('atmospher')) params.style = 'ambient-djent';
  else if (p.includes('prog')) params.style = 'progressive';
  else if (p.includes('djent') || p.includes('meshuggah') || p.includes('periphery')) params.style = 'djent';
  else if (p.includes('thall') || p.includes('vildhjarta')) params.style = 'thall';

  // Tempo: explicit "NNN bpm" or fast/slow words.
  const bpmMatch = p.match(/(\d{2,3})\s*bpm/);
  if (bpmMatch) params.bpm = clamp(parseInt(bpmMatch[1], 10), 60, 260);
  else if (p.includes('fast') || p.includes('frantic')) params.bpm = 180;
  else if (p.includes('slow') || p.includes('doom') || p.includes('sludgy')) params.bpm = 95;

  // Tuning hints.
  if (p.includes('8 string') || p.includes('8-string') || p.includes('eight string')) params.tuningId = 'drop-f-8';
  else if (p.includes('7 string') || p.includes('7-string') || p.includes('seven string')) params.tuningId = 'drop-g-7';
  if (p.includes('drop f')) params.tuningId = 'drop-f-8';
  else if (p.includes('drop g')) params.tuningId = 'drop-g-7';
  else if (p.includes('drop b')) params.tuningId = 'drop-b';
  else if (p.includes('drop c')) params.tuningId = 'drop-c';

  // Scale hints.
  if (p.includes('phrygian dominant')) params.scale = 'phrygian-dominant';
  else if (p.includes('phrygian')) params.scale = 'phrygian';
  else if (p.includes('locrian')) params.scale = 'locrian';
  else if (p.includes('harmonic minor')) params.scale = 'harmonic-minor';
  else if (p.includes('dorian')) params.scale = 'dorian';
  else if (p.includes('chromatic') || p.includes('atonal') || p.includes('dissonant')) params.scale = 'chromatic';

  // Key: "in F#", "key of A".
  const keyMatch = p.match(/\b(?:in|key of)\s+([a-g](?:#|b)?)\b/);
  if (keyMatch) {
    const k = keyMatch[1][0].toUpperCase() + keyMatch[1].slice(1);
    if (KEYS.includes(k)) params.key = k;
  }

  // Complexity / feel.
  if (p.includes('technical') || p.includes('complex') || p.includes('insane')) params.complexity = 0.85;
  else if (p.includes('simple') || p.includes('minimal') || p.includes('groovy')) params.complexity = 0.35;
  if (p.includes('syncopat') || p.includes('off') || p.includes('bounce')) params.syncopation = 0.75;

  // Odd meter.
  if (p.match(/\bodd\s*(?:time|meter)\b/) || p.includes('7/8') || p.includes('5/4') || p.includes('polymet')) {
    params.allowMeterShifts = true;
  }

  return { params, notes };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
