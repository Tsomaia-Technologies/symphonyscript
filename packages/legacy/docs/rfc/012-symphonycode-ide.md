# RFC-010: SymphonyCode IDE (Revision 1)

## 1. Vision

SymphonyCode is a VS Code extension that transforms the editor into a complete Music IDE. It integrates ALL capabilities defined in SymphonyScript RFCs:

- **RFC-006**: Language Server Protocol (music-aware intellisense)
- **RFC-007**: Timeline Visualizers (piano roll, automation)
- **RFC-008**: Waveform Visualization (amplitude, mix density)
- **RFC-009**: Monorepo packages (modular architecture)

**Philosophy**: Code is the Source of Truth. Visual panels are reactive projections that can also emit edits back to code.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension Host                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               Language Server (RFC-006)                          │   │
│  │  • Music-aware diagnostics                                       │   │
│  │  • Rich hover (MIDI#, Hz, beats)                                 │   │
│  │  • Contextual autocomplete (scales, instruments)                 │   │
│  │  • Inline gutter decorations                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               Sync Engine                                        │   │
│  │  • AST Parsing (ts-morph)                                        │   │
│  │  • Code ↔ Visual bidirectional sync                              │   │
│  │  • Debounced compilation                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               Audio Engine (Native Node)                         │   │
│  │  • @symphonyscript/runtime                                       │   │
│  │  • Real-time playback (clips)                                    │   │
│  │  • Offline render (export)                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────┐
            │  Webview  │   │  Webview  │   │  Webview  │
            │  Panels   │   │  Panels   │   │  Panels   │
            └───────────┘   └───────────┘   └───────────┘
```

## 3. Panel Inventory

### 3.1 Core Panels (v1)

| Panel | Source RFC | Description | Bidirectional |
|-------|------------|-------------|---------------|
| **Piano Roll** | RFC-007 | Notes as bars on pitch×time grid | Yes |
| **Timeline** | RFC-007 | Arrangement view, clips as blocks | Yes |
| **Automation** | RFC-007 | Draw parameter curves | Yes |
| **Waveform** | RFC-008 | Amplitude envelope visualization | Read-only |
| **Mixer** | RFC-008 | Track faders, VU meters, pan | Yes |
| **Transport** | — | Play, pause, loop, BPM, position | Controls |
| **Instrument Browser** | — | Tree of instruments/samples | Drag-to-code |
| **Step Sequencer** | — | Grid-based drum pattern editor | Yes |
| **Tempo Map** | — | Visual tempo/time sig editor | Yes |
| **Markers** | — | Named regions (Intro, Verse) | Yes |
| **Sheet Music** | — | Traditional notation view | Read-only |
| **Effects Chain** | — | Per-track FX routing | Yes |

### 3.2 Editor Integrations (RFC-006)

| Feature | Description |
|---------|-------------|
| **Music Diagnostics** | "Measure 4 has 5 beats in 4/4" in Problems panel |
| **Rich Hover** | `C4` → "MIDI: 60, Freq: 261.63Hz" |
| **Autocomplete** | Suggest scales, instruments, valid durations |
| **Gutter Icons** | Mini waveform/note preview per line |
| **Code Lens** | "▶️ Play" button above each clip definition |

### 3.3 Drag-and-Drop Support

| Action | Result |
|--------|--------|
| **Drop `.wav`/`.mp3` into editor** | Generates `.sample('./path/to/file.wav')` at cursor |
| **Drop `.wav` into Timeline** | Creates new audio track with sample clip |
| **Drop instrument from Browser** | Generates `Instrument.piano('name')` at cursor |
| **Drop clip from Browser onto Track** | Generates `.at(dropBeat).play(clipName)` |

### 3.4 Status Bar Integrations

| Item | Location | Description |
|------|----------|-------------|
| **Audio Device Selector** | Right side | Click to choose output device (speakers, headphones, interface) |
| **Sample Rate** | Right side | Display current sample rate (44.1kHz, 48kHz) |
| **Buffer Size** | Right side | Display/adjust latency (128, 256, 512 samples) |
| **CPU Meter** | Right side | Audio engine CPU usage |
| **MIDI Device** | Right side | Select MIDI input device (future) |

**Device Settings Popover**:
```
┌─────────────────────────────┐
│ Audio Output: [Speakers ▼]  │
│ Sample Rate:  [48000 ▼]     │
│ Buffer Size:  [256 ▼]       │
│ ─────────────────────────── │
│ Latency: ~5.3ms             │
└─────────────────────────────┘
```

## 4. Panel Specifications

### 4.1 Piano Roll (RFC-007)
- **View**: Pitch (Y) × Time (X) grid, notes as horizontal bars
- **Edit**: Click to add, drag to move/resize, velocity via color
- **Sync**: Generates `.note('C4', '4n')` calls
- **Features**: Snap to grid, quantize, velocity editor

### 4.2 Timeline / Arrangement (RFC-007)
- **View**: Tracks as lanes, clips as colored blocks
- **Edit**: Drag clips, resize to loop, copy/paste
- **Sync**: Generates `.at(beat).play(clip)` calls
- **Features**: Track headers, zoom, horizontal scroll

### 4.3 Automation (RFC-007)
- **View**: Parameter curves below tracks
- **Edit**: Click to add points, drag curves
- **Sync**: Generates `.automate('volume', [...points])`
- **Features**: Multiple params per track, curve types (linear, ease)

### 4.4 Waveform (RFC-008)
- **View**: Amplitude over time from ApproximatedSynthesizer
- **Edit**: Read-only in v1 (future: draw envelopes)
- **Sync**: Reacts to code changes
- **Features**: Zoom, peak markers, RMS display

### 4.5 Mixer (RFC-008)
- **View**: Vertical faders, pan knobs, VU meters per track
- **Edit**: Drag faders, toggle mute/solo
- **Sync**: Generates `.volume(0.8)`, `.pan(-0.3)`, `.mute()`
- **Features**: Master bus, send levels (future)

### 4.6 Transport
- **View**: Play, Pause, Stop, Record, Loop, BPM, Time display
- **Edit**: Click buttons, scrub timeline, tap tempo
- **Sync**: Position stored in `.symphony.json`
- **Features**: Keyboard shortcuts, MIDI transport (future)

### 4.7 Step Sequencer
- **View**: 16-step grid per drum sound
- **Edit**: Click cells to toggle, velocity via row height
- **Sync**: Generates `Clip.drums().pattern('kick hat snare hat')`
- **Features**: Pattern length, swing, per-step velocity

### 4.8 Tempo Map
- **View**: Tempo curve over time, time signature markers
- **Edit**: Add tempo points, drag curves
- **Sync**: Generates `.tempo(120).tempoRamp(140, '4n')`
- **Features**: Tap tempo, BPM calculator

### 4.9 Markers / Regions
- **View**: Colored bars above timeline with labels
- **Edit**: Double-click to rename, drag to move
- **Sync**: Generates `.marker('Verse', beat)` or comment annotations
- **Features**: Navigation shortcuts, loop-to-region

### 4.10 Sheet Music
- **View**: Traditional staff notation (treble/bass clef)
- **Edit**: Read-only in v1 (future: notation input)
- **Render**: Uses VexFlow or similar library
- **Features**: Part extraction, transposition display

### 4.11 Effects Chain
- **View**: FX slots per track (Reverb → EQ → Compressor)
- **Edit**: Add/remove/reorder effects, tweak parameters
- **Sync**: Generates `.effect('reverb', { room: 0.5 })`
- **Features**: Preset browser, bypass toggle

### 4.12 Instrument Browser
- **View**: Tree: Instruments → Categories → Presets
- **Edit**: Drag onto track or code editor
- **Sync**: Generates `Instrument.piano('steinway')`
- **Features**: Preview sound, search, favorites

## 5. Bidirectional Sync Protocol

### 5.1 Code → Visual
```
User types → Debounce 100ms → AST Parse → Extract Session/Clips → 
Broadcast to Panels → Panels re-render
```

### 5.2 Visual → Code
```
User edits panel → Panel emits action → Sync Engine receives →
CodeGenerator patches AST → Text document updated → 
Visual update (should be no-op)
```

### 5.3 Edit Actions (Examples)

| Panel | Action | Generated Code |
|-------|--------|----------------|
| Piano Roll | Add note at C4, beat 2 | `.note('C4', '4n')` inserted |
| Mixer | Set volume to 0.7 | `.volume(0.7)` added to track |
| Timeline | Move clip to beat 8 | `.at(8)` updated from `.at(0)` |
| Automation | Add point at beat 4, value 0.5 | `.automate('volume', [{beat:4, value:0.5}])` |
| Step Sequencer | Toggle kick on step 3 | Pattern string updated |
| Drag-and-Drop | Drop `kick.wav` into editor | `.sample('./kick.wav')` at cursor |
| Drag-and-Drop | Drop instrument onto track | `Instrument.synth('lead')` generated |

## 6. File Format

### 6.1 Source Files (`.ts`)
Standard SymphonyScript TypeScript. **Source of truth.**

### 6.2 Project Metadata (`.symphony.json`)
```json
{
  "version": "1.0.0",
  "entryPoint": "song.ts",
  "layout": {
    "panels": ["piano-roll", "timeline", "mixer"],
    "arrangement": "horizontal"
  },
  "playback": { "position": 4.5, "loop": [0, 16] },
  "markers": [
    { "name": "Intro", "beat": 0 },
    { "name": "Verse", "beat": 16 }
  ]
}
```

## 7. Implementation Roadmap

### Phase 0: Prerequisites
- [ ] RFC-009: Monorepo migration complete
- [ ] RFC-006: LSP implemented
- [ ] RFC-008: Waveform synthesis implemented

### Phase 1: Extension Skeleton (2 weeks)
- [ ] VS Code extension scaffold
- [ ] Webview panel registration
- [ ] Project file loading

### Phase 2: LSP Integration (2 weeks)
- [ ] Connect to @symphonyscript/lsp
- [ ] Music diagnostics in Problems panel
- [ ] Rich hover, autocomplete

### Phase 3: Piano Roll + Transport (3 weeks)
- [ ] Piano Roll panel (view only)
- [ ] Transport controls
- [ ] Basic playback (compile-then-play)

### Phase 4: Bidirectional Sync (3 weeks)
- [ ] Code → Visual reactive updates
- [ ] Visual → Code generation (Piano Roll)
- [ ] Conflict resolution

### Phase 5: Timeline + Mixer (3 weeks)
- [ ] Timeline panel with clips
- [ ] Mixer with faders
- [ ] Track-level sync

### Phase 6: Advanced Panels (4 weeks)
- [ ] Automation lanes
- [ ] Step Sequencer
- [ ] Tempo Map
- [ ] Markers

### Phase 7: Visualization (2 weeks)
- [ ] Waveform panel (RFC-008)
- [ ] VU meters
- [ ] Gutter decorations

### Phase 8: Polish (2 weeks)
- [ ] Sheet Music view
- [ ] Effects Chain
- [ ] Instrument Browser
- [ ] Keyboard shortcuts
- [ ] Performance optimization

### Phase 9: Workflow Enhancements (1 week)
- [ ] Drag-and-drop sample files into editor
- [ ] Drag-and-drop samples into Timeline
- [ ] Status bar: Audio device selector
- [ ] Status bar: Sample rate / buffer size controls
- [ ] Status bar: CPU meter

## 8. Package Structure (RFC-009)

```
packages/
├── core/                    # DSL, Compiler
├── runtime/                 # Web Audio playback
├── synthesis/               # Waveform generation (RFC-008)
├── lsp/                     # Language Server (RFC-006)
├── renderer-canvas/         # Canvas visualizers (RFC-007)
├── vscode-extension/        # SymphonyCode IDE
│   ├── src/
│   │   ├── extension.ts
│   │   ├── lsp-client/
│   │   ├── sync/
│   │   ├── panels/
│   │   └── audio/
│   └── webview-ui/
│       ├── piano-roll/
│       ├── timeline/
│       ├── mixer/
│       └── ...
└── cli/
```

## 9. Dependencies

| Dependency | Purpose |
|------------|---------|
| RFC-006 | LSP for music intellisense |
| RFC-007 | Visualizer architecture |
| RFC-008 | Waveform synthesis |
| RFC-009 | Package structure |
| ts-morph | AST manipulation |
| VexFlow | Sheet music rendering |
| node-speaker | Native audio |

## 10. Future Scope (v2+)

- [ ] MIDI input recording
- [ ] Audio recording
- [ ] VST/AU plugin hosting
- [ ] AI assistance ("make this beat more syncopated")
- [ ] Collaboration / multiplayer
- [ ] Mobile companion app

## 11. Success Metrics

| Metric | Target |
|--------|--------|
| Keypress to visual update | < 100ms |
| Playback latency | < 50ms |
| Cold start time | < 3s |
| Panel count supported | 6+ simultaneous |
