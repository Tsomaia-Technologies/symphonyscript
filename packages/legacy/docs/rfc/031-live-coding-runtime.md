# RFC-034: Live Coding Runtime

**Status**: Draft  
**Priority**: Medium (Future)  
**Estimated Effort**: 10+ days  
**Breaking Change**: None (new package)  
**Dependencies**: RFC-026 (Event Sourcing Compiler)

---

## 1. Problem Statement

SymphonyScript compiles to static timelines, but modern music tools expect:

- **Live coding** — Edit code, hear changes immediately
- **Hot reload** — No restart, seamless transition
- **Beat-synced updates** — New patterns start on bar boundaries
- **REPL-style workflow** — Evaluate expressions, hear result

Currently impossible because:

1. Compilation is batch (all-or-nothing)
2. No streaming output
3. No runtime audio engine integration

---

## 2. Vision

```typescript
import { LiveSession } from "symphonyscript/live";

const live = new LiveSession({ bpm: 120 });

// Start playback
live.play();

// Evaluate code blocks in real-time
live.eval(`
  track('drums', t => t
    .clip(Drums.euclidean(16, 5))
  )
`);

// Changes take effect on next bar
live.eval(`
  track('bass', t => t
    .clip(Clip.melody().note('E2', '8n').loop(8))
  )
`);

// Stop specific track
live.stop("drums");

// Full stop
live.stop();
```

---

## 3. Requirements

| ID   | Requirement                                | Priority  |
| ---- | ------------------------------------------ | --------- |
| FR-1 | Streaming event consumption from generator | Must Have |
| FR-2 | Incremental recompilation on source change | Must Have |
| FR-3 | Beat-grid synchronization for updates      | Must Have |
| FR-4 | Seamless splice (no audio glitches)        | Must Have |
| FR-5 | Web Audio API backend                      | Must Have |
| FR-6 | MIDI output backend                        | Should    |
| FR-7 | File watcher for .ts files                 | Should    |
| FR-8 | REPL interface                             | Should    |

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     LiveSession                          │
├──────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Watcher   │───▶│  Compiler   │───▶│  Scheduler  │  │
│  │  (chokidar) │    │ (RFC-026)   │    │  (events)   │  │
│  └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                                │         │
│                      ┌─────────────────────────┼───────┐ │
│                      │         Backend         ▼       │ │
│                      │  ┌─────────┐  ┌─────────────┐   │ │
│                      │  │WebAudio │  │ MIDI Output │   │ │
│                      │  └─────────┘  └─────────────┘   │ │
│                      └─────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Core Components

### 5.1 LiveSession

Main controller managing the live coding session.

```typescript
interface LiveSessionOptions {
  bpm: number;
  backend: "webaudio" | "midi" | "both";
  lookahead: number; // Seconds of events to buffer (default: 0.1)
  quantize: "bar" | "beat" | "off"; // When changes take effect
}

class LiveSession {
  constructor(options: LiveSessionOptions);

  // Playback control
  play(): void;
  pause(): void;
  stop(trackName?: string): void;

  // Live evaluation
  eval(code: string): EvalResult;
  evalFile(path: string): EvalResult;

  // Session management
  getSession(): Session;
  getTempo(): number;
  setTempo(bpm: number): void;

  // Events
  on(event: "beat" | "bar" | "error", handler: Function): void;
}
```

### 5.2 StreamingScheduler

Consumes generator output, schedules events.

```typescript
class StreamingScheduler {
  constructor(backend: AudioBackend);

  // Feed events from compiler generator
  consume(generator: Generator<CompiledEvent>): void;

  // Splice in new events (incremental update)
  splice(
    generator: Generator<CompiledEvent>,
    startBeat: number,
    trackId?: string
  ): void;

  // Timing
  getCurrentBeat(): number;
  getNextBarBeat(): number;
}
```

### 5.3 WebAudioBackend

Renders events to Web Audio API.

```typescript
interface AudioBackend {
  schedule(event: CompiledEvent): void;
  cancelAfter(beat: number): void;
  getCurrentTime(): number;
}

class WebAudioBackend implements AudioBackend {
  constructor(audioContext: AudioContext);

  // Instrument mapping
  setInstrument(trackId: string, sampler: Sampler): void;

  // Effects
  connectEffect(trackId: string, effect: AudioNode): void;
}
```

### 5.4 MIDIBackend

Sends events to MIDI output.

```typescript
class MIDIBackend implements AudioBackend {
  constructor(output: MIDIOutput);

  // Channel mapping
  setChannel(trackId: string, channel: number): void;
}
```

---

## 6. Incremental Update Flow

```
1. User edits code
                    │
                    ▼
2. Watcher detects change
                    │
                    ▼
3. Diff: which tracks changed?
                    │
                    ▼
4. Wait for quantize boundary (bar/beat)
                    │
                    ▼
5. Cancel scheduled events for changed tracks
                    │
                    ▼
6. Incremental compile (RFC-026) changed tracks
                    │
                    ▼
7. Splice new events into scheduler
                    │
                    ▼
8. Resume seamlessly
```

---

## 7. Beat-Grid Synchronization

Changes take effect at quantize boundaries:

```typescript
live.setQuantize("bar"); // Changes on next bar
live.setQuantize("beat"); // Changes on next beat
live.setQuantize("off"); // Immediate (may glitch)
```

Implementation:

```typescript
function scheduleUpdate(update: () => void, quantize: string) {
  const currentBeat = scheduler.getCurrentBeat();

  switch (quantize) {
    case "bar":
      const nextBar =
        Math.ceil(currentBeat / beatsPerMeasure) * beatsPerMeasure;
      scheduleAt(nextBar, update);
      break;
    case "beat":
      const nextBeat = Math.ceil(currentBeat);
      scheduleAt(nextBeat, update);
      break;
    case "off":
      update();
      break;
  }
}
```

---

## 8. Error Handling

Live coding must be resilient:

```typescript
live.on("error", (err) => {
  console.error("Compilation error:", err.message);
  // Keep previous state running
  // Don't crash the audio
});

// EvalResult includes success/failure
const result = live.eval(code);
if (!result.success) {
  console.error(result.error);
  console.log("Keeping previous state");
}
```

---

## 9. File Watching

Optional automatic recompilation:

```typescript
const live = new LiveSession({ bpm: 120 });

// Watch a file
live.watch("./song.ts");

// Changes trigger recompilation
// Errors logged, previous state preserved
```

Implementation uses `chokidar`:

```typescript
import chokidar from "chokidar";

function watchFile(path: string, onChange: () => void) {
  const watcher = chokidar.watch(path);
  watcher.on("change", debounce(onChange, 100));
  return () => watcher.close();
}
```

---

## 10. Package Structure

```
packages/
├── symphonyscript/           # Core (existing)
└── symphonyscript-live/      # New package
    ├── src/
    │   ├── LiveSession.ts
    │   ├── StreamingScheduler.ts
    │   ├── backends/
    │   │   ├── WebAudioBackend.ts
    │   │   └── MIDIBackend.ts
    │   ├── watcher.ts
    │   └── index.ts
    └── package.json
```

---

## 11. Example: Minimal Live Setup

```typescript
import { LiveSession } from "symphonyscript-live";
import { Clip, Session } from "symphonyscript";

// Create session
const live = new LiveSession({
  bpm: 120,
  backend: "webaudio",
  quantize: "bar",
});

// Initial pattern
live.eval(`
  Session.create()
    .track('lead', t => t.clip(
      Clip.melody()
        .note('C4', '8n')
        .note('E4', '8n')
        .note('G4', '8n')
        .loop(4)
    ))
`);

// Start
live.play();

// Later: modify (takes effect on next bar)
live.eval(`
  Session.create()
    .track('lead', t => t.clip(
      Clip.melody()
        .note('D4', '8n')
        .note('F4', '8n')
        .note('A4', '8n')
        .loop(4)
    ))
`);
```

---

## 12. Prerequisites

Before implementing RFC-034:

- [ ] RFC-026 complete (streaming/incremental compiler)
- [ ] Web Audio expertise (or external library)
- [ ] Sampler/instrument solution decided

---

## 13. Risks

| Risk                            | Mitigation                                   |
| ------------------------------- | -------------------------------------------- |
| Audio dropouts during recompile | Lookahead buffer, background compilation     |
| Timing drift                    | Use AudioContext.currentTime, not Date.now() |
| Memory leaks                    | Proper cleanup of scheduled events           |
| Complex state management        | Immutable session state, clear ownership     |

---

## 14. Approval

- [ ] Approved by maintainer
