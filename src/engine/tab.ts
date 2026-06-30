// Renders a guitar Track to classic ASCII guitar tab for the given tuning, so
// the channel owner can actually play / screenshot the generated riff.

import { pitchToTab, pitchClass } from './theory';
import type { Track, Tuning } from './types';

export interface TabResult {
  /** One string per line, highest string first (standard tab order). */
  lines: string[];
  /** Per-string label like "F " / "C#". */
  labels: string[];
}

/**
 * Build ASCII tab. Each step is a fixed-width column; bar lines are inserted at
 * every `beatsPerBar * stepsPerBeat` steps.
 */
export function renderTab(
  track: Track,
  tuning: Tuning,
  length: number,
  stepsPerBeat: number,
  beatsPerBar: number,
): TabResult {
  const numStrings = tuning.strings.length;
  // grid[stringIndex][step] = fret string ('--' if empty)
  const grid: string[][] = Array.from({ length: numStrings }, () =>
    Array.from({ length }, () => '--'),
  );

  const place = (pitch: number, step: number) => {
    const pos = pitchToTab(pitch, tuning);
    if (!pos || step < 0 || step >= length) return;
    grid[pos.stringIndex][step] = pos.fret.toString().padStart(2, '-');
  };

  for (const hit of track.hits) {
    place(hit.pitch, hit.step);
    hit.voicing?.forEach((p) => place(p, hit.step));
  }

  const stepsPerBar = stepsPerBeat * beatsPerBar;
  const labels: string[] = [];
  const lines: string[] = [];

  // Render highest string first (reverse of low->high storage order).
  for (let s = numStrings - 1; s >= 0; s--) {
    labels.push(pitchClass(tuning.strings[s]).padEnd(2, ' '));
    let line = '|';
    for (let step = 0; step < length; step++) {
      line += grid[s][step];
      // Bar separator after each full bar.
      if ((step + 1) % stepsPerBar === 0) line += '|';
      else line += '-';
    }
    lines.push(line);
  }

  return { lines, labels };
}

/** Full multi-line tab text (labels + lines), e.g. for copy/paste or export. */
export function tabToText(tab: TabResult): string {
  return tab.lines.map((l, i) => `${tab.labels[i]}${l}`).join('\n');
}
