// "Tone Rig" tab — describe a tone (or upload a reference track), the engine
// designs a full amp/cab/FX rig, you audition it latency-free, tweak the knobs,
// and export it as a preset + signal-chain spec to recreate in your real rig.

import { useEffect, useState } from 'react';
import { Slider, Select } from './Controls';
import { guitarRig, DEFAULT_RIG, type CabType, type RigSettings } from '../audio/rig';
import {
  analyzeAudioFile,
  buildPreset,
  describeSignalChain,
  downloadPreset,
  type ToneSuggestion,
  type AudioFeatures,
} from '../audio/tonePresets';
import { smartToneEngine } from '../ai/llmTone';

const CAB_OPTIONS: { value: CabType; label: string }[] = [
  { value: 'modern-v30', label: 'Modern 4x12 (V30)' },
  { value: 'tight-4x12', label: 'Tight 4x12' },
  { value: 'fat-2x12', label: 'Fat 2x12' },
  { value: 'fizz-1x12', label: 'Bright 1x12' },
];

export function ToneRig() {
  const [prompt, setPrompt] = useState('Tight modern thall tone, scooped mids, ambient verbs');
  const [settings, setSettings] = useState<RigSettings>({ ...DEFAULT_RIG });
  const [suggestion, setSuggestion] = useState<ToneSuggestion | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [live, setLive] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [features, setFeatures] = useState<AudioFeatures | null>(null);
  const [presetName, setPresetName] = useState('My Thall Tone');

  useEffect(() => () => guitarRig.stopAll(), []);

  // Push every settings change into the live audio chain.
  useEffect(() => {
    guitarRig.applySettings(settings);
  }, [settings]);

  const apply = <K extends keyof RigSettings>(key: K, value: RigSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const onGenerateFromPrompt = async () => {
    setBusy(true);
    const sug = await smartToneEngine.fromPrompt(prompt);
    setSuggestion(sug);
    setSettings(sug.settings);
    setBusy(false);
  };

  const onUpload = async (file: File) => {
    setBusy(true);
    try {
      const feats = await analyzeAudioFile(file);
      setFeatures(feats);
      const sug = await smartToneEngine.fromReference(feats, prompt);
      setSuggestion(sug);
      setSettings(sug.settings);
    } catch (e) {
      alert('Could not analyse that file. Try a WAV/MP3 under ~30s.');
      console.error(e);
    }
    setBusy(false);
  };

  const onPreview = async () => {
    if (previewing) {
      guitarRig.stopPreview();
      setPreviewing(false);
    } else {
      if (live) onToggleLive();
      await guitarRig.previewRiff(140);
      setPreviewing(true);
    }
  };

  const onToggleLive = async () => {
    if (live) {
      guitarRig.stopLiveInput();
      setLive(false);
      setLatencyMs(null);
    } else {
      if (previewing) {
        guitarRig.stopPreview();
        setPreviewing(false);
      }
      try {
        const { latencyMs } = await guitarRig.startLiveInput();
        setLatencyMs(latencyMs);
        setLive(true);
      } catch {
        alert('Microphone/instrument input was blocked. Allow audio input to use live mode.');
      }
    }
  };

  const onExport = () => {
    downloadPreset(buildPreset(presetName, settings));
  };

  const chain = describeSignalChain(settings);

  return (
    <div className="tab">
      <div className="panel">
        <h2>Tone Rig Designer</h2>
        <p className="muted">
          Describe the tone you want (or drop in a reference track) and the engine
          designs a full rig. Audition it instantly on a built-in DI riff — then
          export the preset to your real, low-latency rig/DAW for tracking.
        </p>

        <textarea
          className="prompt"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. brutal deathcore breakdown wall, dark and loose…"
        />
        <div className="button-row">
          <button className="primary" onClick={onGenerateFromPrompt} disabled={busy}>
            {busy ? 'Designing…' : '✨ Design tone from prompt'}
          </button>
          <label className="upload-btn">
            🎵 Match a reference track
            <input
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
          </label>
        </div>

        {features && (
          <p className="muted small">
            Reference analysed — brightness {Math.round(features.brightness * 100)}%,
            energy {Math.round(features.energy * 100)}%,
            low-end {Math.round(features.lowRatio * 100)}% ({features.durationSec.toFixed(1)}s).
          </p>
        )}

        {suggestion && (
          <div className="rationale">
            <strong>{suggestion.archetype}</strong>
            <span className="badge">confidence {Math.round(suggestion.confidence * 100)}%</span>
            <ul>
              {suggestion.rationale.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Audition</h3>
        <div className="button-row">
          <button className={previewing ? 'stop' : 'go'} onClick={onPreview}>
            {previewing ? '■ Stop preview' : '▶ Preview tone (DI riff)'}
          </button>
          <button className={live ? 'stop' : ''} onClick={onToggleLive}>
            {live ? '■ Stop live input' : '🎸 Use live input'}
          </button>
        </div>
        <div className="latency-note">
          <strong>Latency note:</strong> Live input runs through the browser, which on
          Windows (no ASIO) typically adds <em>80–150&nbsp;ms</em> — fine for tweaking,
          not for tight tracking. Use <strong>Preview</strong> to judge the tone with zero
          input latency, then export the preset to your real rig to play/record.
          {latencyMs != null && (
            <div className={`latency-meter ${latencyMs > 30 ? 'warn' : 'ok'}`}>
              Estimated round-trip latency: <strong>~{latencyMs} ms</strong>
              {latencyMs > 30 ? ' — too high for tracking on this setup.' : ' — playable.'}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Rig</h3>
        <div className="gen-controls">
          <Slider label="Gain / Drive" value={settings.drive} min={0.2} max={1} step={0.01}
            format={(v) => `${(v * 10).toFixed(1)}/10`} onChange={(v) => apply('drive', v)} />
          <Slider label="Tightness (HPF)" value={settings.tightness} min={40} max={180} unit=" Hz"
            onChange={(v) => apply('tightness', v)} />
          <Slider label="Bass" value={settings.bass} min={-8} max={8} step={0.5} unit=" dB"
            onChange={(v) => apply('bass', v)} />
          <Slider label="Mid" value={settings.mid} min={-8} max={8} step={0.5} unit=" dB"
            onChange={(v) => apply('mid', v)} />
          <Slider label="Mid Freq" value={settings.midFreq} min={300} max={2000} unit=" Hz"
            onChange={(v) => apply('midFreq', v)} />
          <Slider label="Treble" value={settings.treble} min={-8} max={8} step={0.5} unit=" dB"
            onChange={(v) => apply('treble', v)} />
          <Slider label="Presence" value={settings.presence} min={-8} max={8} step={0.5} unit=" dB"
            onChange={(v) => apply('presence', v)} />
          <Select label="Cab" value={settings.cab} options={CAB_OPTIONS} onChange={(v) => apply('cab', v)} />
          <Slider label="Reverb" value={settings.reverb} min={0} max={0.7} step={0.01}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply('reverb', v)} />
          <Slider label="Delay" value={settings.delay} min={0} max={0.6} step={0.01}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply('delay', v)} />
          <Slider label="Output" value={settings.level} min={0} max={1} step={0.01}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => apply('level', v)} />
        </div>
      </div>

      <div className="panel">
        <h3>Signal chain &amp; export</h3>
        <ol className="chain">
          {chain.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <div className="button-row">
          <input
            className="name-input"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button className="primary" onClick={onExport}>⬇ Export preset (.json)</button>
        </div>
      </div>
    </div>
  );
}
