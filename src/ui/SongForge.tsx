// "Song Forge" tab — generate a full, structured song (the "Suno for metal"
// arrangement layer): intro/verse/chorus/breakdown/outro with riffs, bass and
// drums, played back in-browser and exportable as a multi-track MIDI.

import { useEffect, useRef, useState } from 'react';
import { GenControls, DEFAULT_PARAMS } from './GenControls';
import { randomSeed } from '../engine/random';
import { generateSong } from '../engine/arranger';
import { songToMidi, downloadMidi } from '../engine/midi';
import { player } from '../audio/playback';
import { parseSongPrompt } from '../ai/promptToParams';
import { renderSongToWav, renderSongStems } from '../audio/exportWav';
import { audioBufferToWav, downloadWav } from '../audio/wavEncoder';
import JSZip from 'jszip';
import type { GenerationParams, Song } from '../engine/types';

export function SongForge() {
  const [params, setParams] = useState<GenerationParams>({ ...DEFAULT_PARAMS });
  const [song, setSong] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [desc, setDesc] = useState('Heavy thall in drop F, dissonant, slow and bouncy, odd time');
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [stereoDouble, setStereoDouble] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null);
  const seedRef = useRef(params.seed);

  const onDescribe = async () => {
    setParsing(true);
    setParseNote(null);
    const { params: parsed, notes, source } = await parseSongPrompt(desc);
    setParams((p) => ({ ...p, ...parsed }));
    const applied = Object.keys(parsed);
    setParseNote(
      `${source === 'llm' ? '🤖 LLM' : '⚙ Offline'}: ${notes[0]} ` +
        (applied.length ? `Set ${applied.join(', ')}.` : 'No confident changes.'),
    );
    setParsing(false);
  };

  useEffect(() => {
    player.setOnStep(({ globalStep, totalSteps }) => {
      if (globalStep < 0 || totalSteps <= 0) {
        setProgress(0);
        setPlaying(false);
      } else {
        setProgress(globalStep / totalSteps);
      }
    });
    return () => {
      player.setOnStep(null);
      player.stop();
    };
  }, []);

  const build = (seed: number) => {
    seedRef.current = seed;
    const s = generateSong({ ...params, seed });
    setSong(s);
    return s;
  };

  const onGenerate = () => {
    player.stop();
    setPlaying(false);
    build(seedRef.current);
  };
  const onReroll = () => {
    player.stop();
    setPlaying(false);
    const s = randomSeed();
    setParams((p) => ({ ...p, seed: s }));
    build(s);
  };

  const onPlay = async () => {
    const s = song ?? build(seedRef.current);
    await player.playSong(s);
    setPlaying(true);
  };
  const onStop = () => {
    player.stop();
    setPlaying(false);
    setProgress(0);
  };

  const onExport = () => {
    if (!song) return;
    const midi = songToMidi(song);
    downloadMidi(midi, `${song.title.replace(/\s+/g, '-').toLowerCase()}`);
  };

  const onExportWav = async () => {
    if (!song) return;
    setRendering('Rendering WAV mix...');
    try {
      const buffer = await renderSongToWav(song, { stereoDouble });
      const blob = audioBufferToWav(buffer);
      downloadWav(blob, `${song.title.replace(/\s+/g, '-').toLowerCase()}.wav`);
    } finally {
      setRendering(null);
    }
  };

  const onExportStems = async () => {
    if (!song) return;
    setRendering('Rendering stems...');
    try {
      const stems = await renderSongStems(song, { stereoDouble });
      const zip = new JSZip();
      for (const [name, buffer] of stems) {
        const blob = audioBufferToWav(buffer);
        zip.file(`${name}.wav`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${song.title.replace(/\s+/g, '-').toLowerCase()}-stems.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setRendering(null);
    }
  };

  const onToggleStereoDouble = (enabled: boolean) => {
    setStereoDouble(enabled);
    player.stereoDouble = enabled;
  };

  return (
    <div className="tab">
      <div className="panel">
        <h2>Song Forge</h2>
        <p className="muted">
          Generate a full song structure — riffs, bass and drums across
          intro / verse / chorus / breakdown / outro. Audition it instantly,
          then export every part as MIDI to build the real track for your video.
        </p>
        <div className="describe-box">
          <textarea
            className="prompt"
            rows={2}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Describe the song — e.g. 'fast technical djent in drop G, 7-string, 180 bpm, odd time'"
          />
          <button className="primary" onClick={onDescribe} disabled={parsing}>
            {parsing ? 'Parsing…' : '✨ Describe → settings'}
          </button>
        </div>
        {parseNote && <p className="muted small">{parseNote}</p>}
        <GenControls params={params} onChange={setParams} />
        <div className="button-row">
          <button className="primary" onClick={onGenerate}>Generate song</button>
          <button onClick={onReroll}>🎲 Reroll</button>
          {!playing ? (
            <button className="go" onClick={onPlay}>▶ Play song</button>
          ) : (
            <button className="stop" onClick={onStop}>■ Stop</button>
          )}
          <button onClick={onExport} disabled={!song}>⬇ Export MIDI</button>
          <button onClick={onExportWav} disabled={!song || rendering !== null}>
            {rendering === 'Rendering WAV mix...' ? '⏳ Rendering...' : '⬇ Export WAV'}
          </button>
          <button onClick={onExportStems} disabled={!song || rendering !== null}>
            {rendering === 'Rendering stems...' ? '⏳ Rendering...' : '⬇ Export Stems (ZIP)'}
          </button>
        </div>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={stereoDouble}
            onChange={(e) => onToggleStereoDouble(e.target.checked)}
          />
          Stereo Double (L/R guitars)
        </label>
        {rendering && <p className="muted rendering-status">{rendering}</p>}
      </div>

      {song && (
        <div className="panel">
          <div className="song-head">
            <h3>“{song.title}”</h3>
            <span className="badge">{song.key} {song.scale} · {song.bpm} BPM</span>
          </div>

          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="sections">
            {song.sections.map((sec) => {
              const active =
                playing &&
                isSectionActive(song, sec.id, progress);
              return (
                <div className={`section-chip ${active ? 'active' : ''}`} key={sec.id}>
                  <strong>{sec.name}</strong>
                  <span>×{sec.repeats}</span>
                </div>
              );
            })}
          </div>

          <ul className="notes">
            {song.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Rough helper to highlight the currently-playing section from progress (0..1).
function isSectionActive(song: Song, id: string, progress: number): boolean {
  const totals = song.sections.map((s) => s.repeats * s.pattern.length);
  const grand = totals.reduce((a, b) => a + b, 0);
  if (grand === 0) return false;
  const target = progress * grand;
  let acc = 0;
  for (let i = 0; i < song.sections.length; i++) {
    const next = acc + totals[i];
    if (target >= acc && target < next) return song.sections[i].id === id;
    acc = next;
  }
  return false;
}
