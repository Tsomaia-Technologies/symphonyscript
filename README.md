# SymphonyScript 🎵

**The TypeScript Music Compiler.**

SymphonyScript is a reactive Audio Computation Engine. It compiles TypeScript to precise musical events in real-time. You write the melody; it drives the instruments.

## Why SymphonyScript?

### 🚀 The "Zero-Latency" Guarantee
JavaScript is single-threaded and prone to Garbage Collection pauses. Realtime scheduling in JS is fragile.
**We fixed this by eliminating JavaScript from the playback equation.**

SymphonyScript works like a compiler (think **LaTeX** or **C++**):
1.  **Author Time:** You write expressive, high-level code.
2.  **Compile Time:** We perform heavy mathematical verification, tempo curve integration, and quantization **offline**.
3.  **Play Time:** The result is a flat, optimized `timeline.json` that any audio engine (Web Audio, Rust, C++) can play without thinking.

### 🎼 Music Notation as Code
No MIDI hex values. No audio buffer math. Just expressive, readable TypeScript designed for the "Flow State."

```typescript
const melody = Clip.melody()
  .note('C4', '4n').staccato()       // Describes the C4
  .note('E4', '4n').accent()         // Describes the E4
  .note('G4', '2n').crescendo('2n')  // Describes the G4
  .build()
```

**Separation of concerns.** The library has three distinct layers:

| Layer | Purpose | You Write | Library Outputs |
|-------|---------|-----------|-----------------|
| **Description** | Define music | Builders, clips, sessions | `ClipNode` (pure data) |
| **Compilation** | Process music | `compile(session)` | `Timeline` (flat events) |
| **Playback** | Render audio | Choose a runtime | Sound |

---

## The Primary Rule

SymphonyScript prioritizes **expressiveness** and **speed**. It uses a **Linear Cursor** pattern to avoid nested parentheses hell.

> **Rule:** Modifiers (`.staccato()`, `.accent()`, `.volume()`) always apply to the **immediately preceding note**.

```typescript
// ✅ CORRECT
Clip.melody()
  .note('A4').staccato()  // .staccato applies to A4
  .note('B4')             // New note starts here

// ❌ WRONG
Clip.melody()
  .staccato()             // Error: No note to modify!
  .note('A4')
```

Think of it like writing sheet music: you write the note head, then you draw the articulation mark above it.

---

## Quick Start

```typescript
import { Clip, session, Track, Instrument, compile } from 'symphonyscript'

// 1. Describe
const piano = Clip.melody('Intro')
  .note('C4', '4n')
  .note('E4', '4n').staccato() // Modifies E4
  .note('G4', '2n')

// 2. Assemble  
const song = session()
  .add(Track.from(piano, Instrument.synth('Piano')))

// 3. Compile
const { output } = compile(song, { bpm: 120 })

// 4. Play (with any runtime)
engine.play(output.timeline)
```

---

## Core Concepts

### Clips & The Fluent Chain
Clips are built using a fluent chain. You don't need to import complex builders or manage indentation. Just flow from one note to the next.

```typescript
Clip.melody()
  .note('C4').staccato()
  .note('D4').accent()
  .rest('4n')
  .note('E4').volume(0.8)
```

### Polymorphic Composition (`.play`)
The `.play()` method is the backbone of composition. It is **polymorphic**, meaning it can accept simple notes, complex objects, or entire clips to build fractal structures.

```typescript
const motif = Clip.melody().note('C4').note('E4');

Clip.melody()
  .play('G4')                  // 1. String Shorthand (Implicit quarter note)
  .play(note('A4').staccato()) // 2. Complex Note Object
  .play(motif)                 // 3. Nesting an entire Clip
```

### Chords & Arpeggios
```typescript
.chord(['C4', 'E4', 'G4'], '2n').accent()
.arpeggio(['C4', 'E4', 'G4'], '8n', { pattern: 'upDown' })
```

### Dynamics & Automations
Dynamics can span across time, independent of individual notes.

```typescript
.crescendo('1n', { from: 0.3, to: 1.0 })
.decrescendo('2n', { to: 0.2 })
```

### Tempo & Time
```typescript
.tempo(140)
.tempo(80, { duration: '2n', curve: 'ease-out' })  // Ritardando
.timeSignature('3/4')
.swing(0.3)
```

### Timing Pipeline: Quantize → Groove → Humanize

SymphonyScript applies three independent, composable timing transformations in a specific order:

1. **Quantize** – Correction ("Fix my bad timing")
2. **Groove** – Style ("Make it swing")
3. **Humanize** – Randomization ("Make it feel real")

```typescript
// The "Pro" chain: clean up, style, then humanize
Clip.melody()
  .quantize('16n')                    // 1. Snap to 16th note grid
  .groove(hipHopGroove)               // 2. Apply hip-hop feel
  .defaultHumanize({ timing: 10 })    // 3. Add subtle variance
  .note('C4', '8n')
  .note('D4', '8n')
```

#### Quantization
Snap notes to a grid. Perfect for cleaning up sloppy input or MIDI recordings.

```typescript
// Basic: snap everything to 8th notes
.quantize('8n')

// Partial: 50% strength (gentle correction)
.quantize('16n', { strength: 0.5 })

// With duration: also snap note lengths
.quantize('8n', { duration: true })
```

#### Precise Notes
Use `.precise()` to exempt specific notes from quantization and humanization:

```typescript
.quantize('8n')
.note('C4')              // Quantized
.note('D4').precise()    // Exact timing preserved
```

#### Genre-Swapping Workflow
The layered pipeline enables powerful workflows like genre conversion:

```typescript
// Import a "straight" rock beat, convert to hip-hop
const rockBeat = importMidi('rock-drums.mid')

Clip.melody()
  .quantize('16n')        // Clean up drummer's timing errors
  .groove(hipHopTemplate) // Apply hip-hop swing
  .play(rockBeat)
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         AUTHOR TIME                              │
│   Builders → ClipNode → compile() → Timeline                    │
│   (Fluent API)  (Pure data)  (Pipeline)   (Flat events)         │
└──────────────────────────────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         PLAY TIME                                │
│   Timeline → Runtime → Audio Output                              │
│   (Pre-computed)  (Web Audio, Tone.js, MIDI, etc.)              │
└──────────────────────────────────────────────────────────────────┘
```

### Compiler Pipeline
The compiler transforms your clips through four phases:

1. **Expand** – Flatten loops, stacks, and nested clips
2. **Timing** – Compute beat positions and measure boundaries
3. **Coalesce** – Merge tied notes into single events
4. **Emit** – Generate final timeline events

### Performance Design

The builder pattern creates many small objects (Linked List Nodes) to track state. This is intentional:

- **Builders run at author-time** (when you write/edit code)
- **Compilation runs once** before playback
- **Timeline is flat** (simple array of events)

Benchmarks show **1-2 million operations/second**.
Even a full symphony compiles in milliseconds—and that happens *before* you press play.

---

## Incremental Compilation

For large compositions, freeze reusable sections:

```typescript
const verse = Clip.melody('Verse')
  .note('C4', '4n')
  // ... many operations
  .freeze()  // Compile once, reuse everywhere

const song = Clip.melody('Song')
  .play(verse)
  .play(verse)  // Cached—no recompilation
  .play(chorus)
```

---

## Schema Versioning

All serialized data includes a `_version` field for forward compatibility. When loading compositions created with older library versions, SymphonyScript automatically migrates them.

```typescript
// Saved data includes version
{ "_version": "1.0.0", "kind": "clip", ... }

// Load with auto-migration
const clip = deserializeClip(json, { migrate: true })
```
See [docs/VERSIONING.md](docs/VERSIONING.md) for details on version compatibility and migration.

---

## Routing & Effects (Inserts vs Sends)

SymphonyScript supports professional audio routing.

1. Inserts (Series Processing) Modify the sound of a specific track.
```typescript
Track.from(clip, synth)
  .insert('distortion', { drive: 0.5 })
  .insert('delay', { time: '8n', feedback: 0.4 }) // Tempo-synced delay
```

2. Sends (Parallel Processing) Share effects (like reverb) across multiple tracks.
```typescript
const song = session()
  .bus('hall', 'reverb', { decay: 2.0 }) // Define the bus
  .add(Track.from(drums).send('hall', 0.1)) // Send 10%
  .add(Track.from(vocals).send('hall', 0.4)) // Send 40%
```

---

## Instruments

```typescript
Instrument.synth('Lead', { oscillator: 'sawtooth' })
Instrument.sampler('Piano', { samples: { C4: 'piano-c4.wav' } })
```

### Routing & Effects
```typescript
Track.from(clip, instrument)
  .sendTo('reverb', 0.3)
  .sendTo('delay', 0.2)
```

---

## Sessions & Tracks

Sessions hold multiple tracks for full compositions:

```typescript
const song = session()
  .add(Track.from(pianoClip, piano).name('Piano'))
  .add(Track.from(drumClip, drums).name('Drums'))
  .bus('reverb', { type: 'reverb', wet: 0.4 })
```

---

## Output Format

The output is **Runtime Agnostic**. You can feed this JSON to Web Audio, Tone.js, or even send it to a Rust/C++ backend for native playback.
```typescript
const { output } = compile(session, { bpm: 120 })

output.timeline  // Array of events
output.manifest  // Instrument & Routing graph
output.meta      // BPM, duration, time signature
```

Events are simple, flat objects:
```typescript
{ kind: 'note_on', time: 0.5, note: 'C4', velocity: 100, duration: 0.25 }
{ kind: 'control', time: 1.0, controller: 64, value: 127 }
{ kind: 'pitch_bend', time: 1.5, value: 64 }
```

---

## 📐 Mathematical Verification

SymphonyScript uses closed-form analytical processing for tempo curves to ensure sub-sample accuracy.
The implementation is backed by formal edge-case analysis and independent derivations of the integral controls.

- [Tempo Integration Proofs](./docs/proofs/)
- [Stability Analysis](./docs/verification/tempo_stability_report.md)

---

## When to Use SymphonyScript

Compared to other music libraries, SymphonyScript is a complete music authoring toolkit: notation, compilation, and runtime in one package.

**You want to compose music as code.** Define melodies, rhythms, and dynamics in TypeScript using a linear, expressive syntax.

```typescript
// Declarative: describe the music, compile, then play
Clip.melody().note('C4', '8n')  // Describe → Compile → Play
```

**You want separation of notation and playback.** The compiled timeline is a simple event list—route it to Web Audio, export to MIDI, or build your own renderer.

**You want programmable music.** Generate patterns algorithmically:

```typescript
scales.forEach(scale => 
  clip.arpeggio(scale.notes, '16n', { pattern: 'random' })
)
```

---

### ⚡ Benchmarks
SymphonyScript is designed for the "Live Loop."
On a standard machine, it builds and compiles complex musical structures in microseconds.

| Scale | Build Time | Compile Time | **Total Latency** |
|-------|------------|--------------|-------------------|
| **100 Notes** (Motif) | 0.24ms | 0.41ms | **0.65ms** |
| **1,000 Notes** (Song) | 0.80ms | 2.06ms | **2.86ms** |
| **5,000 Notes** (Symphony) | 3.97ms | 68.45ms | **72.41ms** |

*Methodology: `ClipFactory.melody().note(...)` chain. Node.js runtime.*

---

## Status

**Architecture:** Stable  
**API:** Evolving (pre-1.0)  
**Runtimes:** Web Audio (basic), Tone.js (planned)

---

## License

MIT