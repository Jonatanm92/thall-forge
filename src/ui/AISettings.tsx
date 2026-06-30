// Modal for configuring the optional LLM backend. Everything works without it;
// this just upgrades tone design and song-prompt parsing to LLM reasoning.

import { useState } from 'react';
import { loadLLMConfig, saveLLMConfig, type LLMConfig } from '../ai/llm';

interface Props {
  onClose: () => void;
}

export function AISettings({ onClose }: Props) {
  const [cfg, setCfg] = useState<LLMConfig>(() => loadLLMConfig());
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof LLMConfig>(k: K, v: LLMConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
  };

  const onSave = () => {
    saveLLMConfig(cfg);
    setSaved(true);
    setTimeout(onClose, 600);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>AI backend (optional)</h2>
        <p className="muted">
          Thall Forge works fully offline with built-in engines. Add an
          OpenAI-compatible endpoint + key to upgrade <strong>tone design</strong> and
          <strong> song-prompt parsing</strong> to live LLM reasoning. Your key is stored
          only in this browser and sent only to the endpoint you choose
          (OpenAI, Groq, OpenRouter, Together, or a local server).
        </p>

        <label className="control checkbox-control">
          <span className="control-label">Enable LLM features</span>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        </label>

        <label className="control">
          <span className="control-label">Endpoint</span>
          <input className="name-input" value={cfg.endpoint} onChange={(e) => set('endpoint', e.target.value)} />
        </label>
        <label className="control">
          <span className="control-label">Model</span>
          <input className="name-input" value={cfg.model} onChange={(e) => set('model', e.target.value)} />
        </label>
        <label className="control">
          <span className="control-label">API key</span>
          <input
            className="name-input"
            type="password"
            value={cfg.apiKey}
            placeholder="sk-..."
            onChange={(e) => set('apiKey', e.target.value)}
          />
        </label>

        <div className="button-row">
          <button className="primary" onClick={onSave}>{saved ? 'Saved!' : 'Save'}</button>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted small">
          Note: full neural <em>audio</em> generation (Suno-style) needs a hosted audio model
          and is not wired here — this LLM seam covers tone &amp; arrangement reasoning. See
          the README for the neural-audio roadmap.
        </p>
      </div>
    </div>
  );
}
