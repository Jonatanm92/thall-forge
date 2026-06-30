// "Riff & Groove" tab — generate a single loopable pattern (guitar + bass +
// full kit), audition it on loop, see it on the step grid, and export MIDI.

import { useEffect, useRef, useState } from 'react';
import { GenControls, DEFAULT_PARAMS } from './GenControls';
import { StepGrid } from './StepGrid';
import { TabView } from './TabView';
import { MixPanel } from './MixPanel';
import { Rng, randomSeed } from '../engine/random';
import { generatePattern } from '../engine/arranger';
import { patternToMidi, downloadMidi } from '../engine/midi';
import { player } from '../audio/playback';
import { renderPatternToWav } from '../audio/exportWav';
import { audioBufferToWav, downloadWav } from '../audio/wavEncoder';
import type { GenerationParams, Pattern } from '../engine/types';

export function RiffLab() {
  const [params, setParams] = useState<GenerationParams>({ ...DEFAULT_PARAMS });
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playStep, setPlayStep] = useState(-1);
  const [rendering, setRendering] = useState(false);
  const seedRef = useRef(params.seed);

  const build = (seed: number) => {
    const p = { ...params, seed };
    seedRef.current = seed;
    const pat = generatePattern(p, { rng: new Rng(seed), intensity: 'mid' });
    setPattern(pat);
    return pat;
  };

  // Generate an initial pattern on mount.
  useEffect(() => {
    build(params.seed);
    return () => player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    player.setOnStep(({ globalStep }) => setPlayStep(globalStep));
    return () => player.setOnStep(null);
  }, []);

  const onGenerate = () => build(seedRef.current);
  const onReroll = () => {
    const s = randomSeed();
    setParams((p) => ({ ...p, seed: s }));
    const pat = build(s);
    if (playing) player.playPattern(pat, params.bpm);
  };

  const onPlay = async () => {
    const pat = pattern ?? build(seedRef.current);
    await player.playPattern(pat, params.bpm);
    setPlaying(true);
  };
  const onStop = () => {
    player.stop();
    setPlaying(false);
    setPlayStep(-1);
  };

  const onExport = () => {
    if (!pattern) return;
    const midi = patternToMidi(pattern.tracks, params.bpm, pattern.stepsPerBeat);
    downloadMidi(midi, `thall-forge-loop-${seedRef.current}`);
  };

  const onExportWav = async () => {
    if (!pattern) return;
    setRendering(true);
    try {
      const buffer = await renderPatternToWav(pattern, params.bpm, { stereoDouble: player.stereoDouble });
      const blob = audioBufferToWav(buffer);
      downloadWav(blob, `thall-forge-loop-${seedRef.current}.wav`);
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="tab">
      <div className="panel">
        <h2>Riff &amp; Groove Lab</h2>
        <p className="muted">
          Generate a locked guitar + bass + drum loop. The kick follows the riff,
          the bass doubles it an octave down, and the snare holds the backbeat —
          the rhythmic DNA of thall/djent. Drop the MIDI into any DAW.
        </p>
        <GenControls
          params={params}
          onChange={(p) => {
            setParams(p);
          }}
        />
        <div className="button-row">
          <button className="primary" onClick={onGenerate}>Generate loop</button>
          <button onClick={onReroll}>🎲 Reroll seed</button>
          {!playing ? (
            <button className="go" onClick={onPlay}>▶ Play loop</button>
          ) : (
            <button className="stop" onClick={onStop}>■ Stop</button>
          )}
          <button onClick={onExport} disabled={!pattern}>⬇ Export MIDI</button>
          <button onClick={onExportWav} disabled={!pattern || rendering}>
            {rendering ? '⏳ Rendering...' : '⬇ Export WAV'}
          </button>
        </div>
        <p className="seed-line">seed <code>{seedRef.current}</code> · same seed + settings = same loop</p>
        <MixPanel />
      </div>

      {pattern && (
        <div className="panel">
          <h3>Step grid</h3>
          <StepGrid pattern={pattern} playStep={playStep} />
        </div>
      )}

      {pattern && (
        <div className="panel">
          <h3>Tab</h3>
          <TabView pattern={pattern} tuningId={params.tuningId} />
        </div>
      )}
    </div>
  );
}
