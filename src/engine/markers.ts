// DAW marker / section export. Produces section markers in formats that can be
// imported into Reaper, Ableton, or other DAWs for quick navigation.

import type { Song } from './types';

/** A section marker with timing information. */
export interface SectionMarker {
  name: string;
  startBar: number;
  startTime: number;
  endTime: number;
  bpm: number;
}

/**
 * Compute section markers from a song, including timing info derived from BPM
 * and per-section bar counts.
 */
export function getSectionMarkers(song: Song): SectionMarker[] {
  const markers: SectionMarker[] = [];
  let currentBar = 0;
  let currentTime = 0;

  for (const section of song.sections) {
    const beatsPerBar = section.pattern.beatsPerBar;
    const barsPerSection = section.repeats * Math.ceil(
      section.pattern.length / (beatsPerBar * section.pattern.stepsPerBeat),
    );

    // Determine the effective BPM at this bar (check tempoMap)
    let effectiveBpm = song.bpm;
    if (song.tempoMap) {
      // Find the last tempo event at or before this bar
      for (const evt of song.tempoMap) {
        if (evt.bar <= currentBar) {
          effectiveBpm = evt.bpm;
        }
      }
    }

    const secondsPerBeat = 60 / effectiveBpm;
    const sectionDuration = barsPerSection * beatsPerBar * secondsPerBeat;

    markers.push({
      name: section.name,
      startBar: currentBar,
      startTime: currentTime,
      endTime: currentTime + sectionDuration,
      bpm: effectiveBpm,
    });

    currentBar += barsPerSection;
    currentTime += sectionDuration;
  }

  return markers;
}

/** Export markers as Reaper-compatible CSV (Name, Start, End in seconds). */
export function markersToReaperCSV(song: Song): string {
  const markers = getSectionMarkers(song);
  const lines = ['Name,Start (seconds),End (seconds)'];
  for (const m of markers) {
    lines.push(`${m.name},${m.startTime.toFixed(3)},${m.endTime.toFixed(3)}`);
  }
  return lines.join('\n');
}

/** Export markers as JSON array. */
export function markersToJSON(song: Song): string {
  const markers = getSectionMarkers(song);
  return JSON.stringify(markers, null, 2);
}

export type MarkerFormat = 'reaper-csv' | 'json';

/** Trigger a browser download of markers in the chosen format. */
export function downloadMarkers(song: Song, format: MarkerFormat): void {
  let content: string;
  let filename: string;
  let mimeType: string;
  const baseName = song.title.replace(/\s+/g, '-').toLowerCase();

  if (format === 'reaper-csv') {
    content = markersToReaperCSV(song);
    filename = `${baseName}-markers.csv`;
    mimeType = 'text/csv';
  } else {
    content = markersToJSON(song);
    filename = `${baseName}-markers.json`;
    mimeType = 'application/json';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
