# ⛧ Thall Forge

An AI-assisted songwriting & tone lab for **thall / modern metal** guitar
channels. Runs entirely in the browser — no installs, easy to demo on stream.

Three tools in one:

| Tab | What it does |
|-----|--------------|
| 🎼 **Song Forge** | Generates a full structured song (intro → verse → chorus → breakdown → outro) with riffs, bass, drums and lead lines. Optional **"describe → settings"** box turns plain English into generation parameters. Audition it in-browser, export every part as MIDI. |
| 🥁 **Riff & Groove** | Generates a single locked guitar + bass + full-kit loop, shown on a live step grid **and as playable ASCII guitar tab**. The kick follows the riff, the bass doubles it an octave down, the snare holds the backbeat. Export the loop as MIDI. |
| 🎸 **Tone Rig** | Describe a tone (or upload a reference track) → the engine designs a full amp/cab/FX rig. Audition it latency-free, tweak the knobs, export a preset + signal-chain spec. |

### Richer musical output
- **Harmonic motion** — the chug root follows a per-bar progression through scale degrees (bVI, bII, iv, bVII...), so riffs move through chords instead of camping on the tonic.
- **Phrasing modes** — *motif* (a bar-length idea repeated with variation), *polymeter* (one odd-length motif tiled so it phases against the 4/4 bar lines — the Meshuggah trick), or *free*.
- **Power chords & sustains** — accented hits become root+5th(+octave) voicings; melodic accents ring out or fire short scale runs.
- **Lead lines** — choruses/outros get an upper-register, singable melody over the riff.
- **Odd meters** — optional per-section time-signature shifts (e.g. a breakdown in 7/4).
- **Playable tab** — the generated riff is rendered to standard ASCII tab for your tuning.

### Drums that play like a metal drummer
- Kick **locks to the riff**, with sustained **double-bass** and alternating **blast beats** in high-intensity sections.
- **Ghost-note** snares, **china / ride-bell** accents, and varied phrase-ending **fills** (tom roll / snare roll / mixed, with a crescendo into the downbeat).

### Groove & feel
- **Humanize** — subtle random timing + velocity variation (tighter on kick/snare, looser on fills) baked deterministically into the notes.
- **Swing** — pushes the off-beat 16ths late for a shuffled feel.
- Both are honored identically by in-browser playback **and** the exported MIDI.

### Higher-fidelity sound
- **Convolution cabs** — guitar (in both the song player and the live rig) runs through procedurally-rendered speaker-cab impulse responses, not just a low-pass.
- **Fat, doubled guitars** — stacked detuned saws for a thick rhythm tone.
- **Layered drums** — kick = body + beater click, snare = noise + tonal body, velocity-aware.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

Audio starts on your first click (browser autoplay policy).

## How the generation works

The drum/bass/song generation is **procedural and music-theory driven** (it is
not a neural audio model). That makes it instant, free, offline, and fully
controllable — and it produces editable MIDI rather than a baked WAV.

- **Rhythm engine** (`src/engine/rhythm.ts`) — the core of the thall feel. Riffs
  are built from chains of short rhythmic "cells" (groups of 2/3/5/7 sixteenths)
  stacked against a steady 4/4 pulse, which creates the genre's lurching
  polymeter and bounce. Cell weighting changes per style (thall / djent /
  progressive / deathcore / ambient).
- **Riff / bass / drums** lock to one shared rhythmic skeleton so every part is
  glued together. Kick = riff onsets, bass = riff an octave down, snare =
  backbeat.
- **Arranger** (`src/engine/arranger.ts`) reuses a few core riff skeletons
  across repeated sections so songs feel composed, not random.
- Everything is **seeded** — the same seed + settings always regenerates the
  exact same song, so you can save a seed and come back to it.

## Tone crafting & the latency decision

Real-time guitar input *through the browser* on Windows (without ASIO) typically
adds **80–150 ms** of round-trip latency — fine for tweaking, unplayable for
tracking. So the Tone Rig is built primarily as a **tone designer**:

1. **Preview** runs a built-in clean DI riff through the amp chain so you can
   judge the tone with **zero input-latency dependence**.
2. **Live input** is opt-in and clearly flagged (best on Mac / an audio
   interface with ASIO/low-latency monitoring). The UI estimates round-trip
   latency and warns you.
3. **Export** the designed tone as a preset + a readable signal-chain spec to
   recreate in your real, low-latency rig or DAW — where you actually record.

## AI backends & upgrade seams

The "AI" layers are isolated behind clean interfaces so they can be upgraded
without touching the UI:

- **Optional LLM** (`src/ai/`) — open the ⚙ settings to add any OpenAI-compatible
  endpoint + key (OpenAI, Groq, OpenRouter, Together, or a local LM Studio /
  Ollama server). When enabled:
  - `LLMToneEngine` designs rigs from a prompt/reference via the LLM.
  - `parseSongPrompt` turns a song description into generation parameters.
  - Both **fall back automatically** to the offline rule-based engines on any
    error, and the key is stored only in your browser.
- **`ToneEngine`** (`src/audio/tonePresets.ts`) — the rule-based prompt→rig
  mapper + reference-audio feature analysis used when no LLM is configured.

### Neural-audio roadmap (Suno-style)

Full neural *audio* generation isn't wired in (it needs a hosted audio model and
can't run client-side). The architecture is ready for it as a future phase:
the arranger already produces a structured, sectioned arrangement, so a hosted
audio model could render that arrangement to a stem/mix while users keep the
editable MIDI today. The same `src/ai/llm.ts` config pattern would hold the
audio-gen endpoint/key.

```
src/
  engine/      pure generation logic (no DOM/audio)
    theory, rhythm, harmony, riff, lead, bass, drums, humanize, arranger, midi, tab, random, types
  audio/       Tone.js playback + guitar rig + tone engine + cab IRs
    playback, rig, tonePresets, ir
  ai/          optional LLM integration (config + tone + prompt parsing)
    llm, llmTone, promptToParams
  ui/          React components
    App, SongForge, RiffLab, ToneRig, StepGrid, TabView, GenControls, Controls, AISettings
```

## Tech

Vite · React · TypeScript · [Tone.js](https://tonejs.github.io/) ·
[@tonejs/midi](https://github.com/Tonejs/Midi). Fully client-side.
