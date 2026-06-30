// LLM-backed implementation of the ToneEngine seam. When an LLM is configured
// it reasons about the prompt/reference and returns full rig settings; on any
// error it transparently falls back to the offline rule-based engine.

import {
  RuleBasedToneEngine,
  clampSettings,
  type AudioFeatures,
  type ToneEngine,
  type ToneSuggestion,
} from '../audio/tonePresets';
import { DEFAULT_RIG, type RigSettings } from '../audio/rig';
import { chatJSON, isLLMConfigured, type ChatMessage } from './llm';

interface LLMToneReply {
  settings: Partial<RigSettings>;
  archetype?: string;
  rationale?: string[];
}

const SYSTEM_PROMPT = `You are a metal guitar tone engineer for a thall/djent tool.
Given a description (and optional measured reference-audio features), output a guitar rig as STRICT JSON.
Return ONLY a JSON object of this shape:
{
  "settings": {
    "gateThreshold": number (dB, -60..-20),
    "tightness": number (Hz high-pass before gain, 40..180),
    "drive": number (0.2..1),
    "bass": number (dB, -8..8),
    "mid": number (dB, -8..8),
    "treble": number (dB, -8..8),
    "midFreq": number (Hz, 300..2000),
    "presence": number (dB, -8..8),
    "cab": one of "modern-v30" | "tight-4x12" | "fat-2x12" | "fizz-1x12",
    "reverb": number (0..0.7),
    "delay": number (0..0.6),
    "delayTime": number (seconds, 0.05..0.8),
    "level": number (0..1)
  },
  "archetype": short label string,
  "rationale": array of short strings explaining the choices
}
Modern thall/djent tends to use tight low end, scooped-to-flat mids, and a focused high end. Be musical.`;

export class LLMToneEngine implements ToneEngine {
  private fallback = new RuleBasedToneEngine();

  async fromPrompt(prompt: string): Promise<ToneSuggestion> {
    if (!isLLMConfigured()) return this.fallback.fromPrompt(prompt);
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Tone description: ${prompt}` },
      ];
      const reply = await chatJSON<LLMToneReply>(messages);
      return this.toSuggestion(reply);
    } catch (e) {
      console.warn('LLM tone failed, using rule-based fallback:', e);
      return this.fallback.fromPrompt(prompt);
    }
  }

  async fromReference(features: AudioFeatures, prompt = ''): Promise<ToneSuggestion> {
    if (!isLLMConfigured()) return this.fallback.fromReference(features, prompt);
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `Tone description: ${prompt || '(none)'}\n` +
            `Reference audio features (0..1): brightness=${features.brightness.toFixed(2)}, ` +
            `energy=${features.energy.toFixed(2)}, lowRatio=${features.lowRatio.toFixed(2)}. ` +
            `Match this reference's character.`,
        },
      ];
      const reply = await chatJSON<LLMToneReply>(messages);
      return this.toSuggestion(reply);
    } catch (e) {
      console.warn('LLM reference match failed, using rule-based fallback:', e);
      return this.fallback.fromReference(features, prompt);
    }
  }

  private toSuggestion(reply: LLMToneReply): ToneSuggestion {
    const settings: RigSettings = { ...DEFAULT_RIG, ...reply.settings };
    clampSettings(settings);
    return {
      settings,
      archetype: reply.archetype ?? 'LLM custom',
      rationale: [
        'Designed by your configured LLM.',
        ...(reply.rationale ?? []).slice(0, 6),
      ],
      confidence: 0.85,
    };
  }
}

// Single shared engine. It auto-detects whether an LLM is configured and falls
// back to the rule-based engine otherwise, so callers don't need to branch.
export const smartToneEngine = new LLMToneEngine();
