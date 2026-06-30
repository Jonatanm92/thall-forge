import { useState } from 'react';
import './App.css';
import { SongForge } from './ui/SongForge';
import { RiffLab } from './ui/RiffLab';
import { ToneRig } from './ui/ToneRig';
import { AISettings } from './ui/AISettings';

type TabId = 'song' | 'riff' | 'tone';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'song', label: 'Song Forge', icon: '🎼' },
  { id: 'riff', label: 'Riff & Groove', icon: '🥁' },
  { id: 'tone', label: 'Tone Rig', icon: '🎸' },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('song');
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">⛧</span>
          <div>
            <h1>THALL FORGE</h1>
            <p>AI songwriting &amp; tone lab for thall / modern metal</p>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
          <button className="tab-btn settings-btn" onClick={() => setShowSettings(true)} title="AI settings">
            <span className="tab-icon">⚙</span>
          </button>
        </nav>
      </header>

      <main className="app-main">
        {tab === 'song' && <SongForge />}
        {tab === 'riff' && <RiffLab />}
        {tab === 'tone' && <ToneRig />}
      </main>

      {showSettings && <AISettings onClose={() => setShowSettings(false)} />}

      <footer className="app-footer">
        <span>
          Built client-side · drums/bass/song generation is procedural (music-theory driven) ·
          tone &amp; arrangement engines have clean seams for optional LLM / future neural audio upgrades.
        </span>
      </footer>
    </div>
  );
}
