# RFC-039: Hot-Swap Protocol (The "Splice" Protocol)

**Status**: Draft  
**Target**: `packages/core`, `packages/live`  
**Driver**: Zero-Click Live Performance  
**Dependencies**: [RFC-037 Ghost Protocol](037-asynchronous-runtime-architecture.md), [RFC-038 Symphony Bytecode](038-symphony-bytecode-standard.md)

---

## 1. Abstract

The Hot-Swap Protocol defines how a running musical program can be **replaced mid-performance** without audio glitches, orphaned notes, or temporal discontinuities.

This RFC fills the gap between "compile" and "play" for live coding scenarios where the performer edits code while music is playing.

**Goal:**

- **Seamless Transition**: Replace running clip without audible artifacts
- **Musical Continuity**: Respect beat grid, preserve active sustains or gracefully release them
- **State Transfer**: Carry tempo, transposition, and dynamics across the boundary
- **Error Resilience**: If new code fails compilation, old code continues playing

---

## 2. The Problem

Consider a live performance scenario:

```
T=0.0s: Performer starts Clip A (a looping bass line)
T=2.5s: Performer edits code, changes the melody
T=2.6s: Compiler produces Clip B
T=???s: When does Clip B start playing?
```

**Current State**: There is no protocol. `LiveSession` would either:
1. **Hard Cut**: Stop A immediately, start B → Audible click, orphaned notes
2. **Wait for Loop End**: Finish A, then start B → Latency, feels unresponsive
3. **Overlap**: Play both simultaneously → Harmonic chaos

**None of these are acceptable for professional live performance.**

---

## 3. The Solution: Splice Points

We introduce the concept of **Splice Points**—quantized moments in the timeline where a swap can occur cleanly.

### 3.1 Splice Point Types

| Type | Symbol | Description | Use Case |
|------|--------|-------------|----------|
| **Immediate** | `!` | Next audio quantum (~3ms) | Emergency stop, glitch aesthetic |
| **Beat** | `@beat` | Next beat boundary | Rhythmic changes |
| **Bar** | `@bar` | Next bar boundary | Phrase-level changes |
| **Phrase** | `@phrase(n)` | Next n-bar phrase | Section transitions |
| **Loop** | `@loop` | When current loop iteration ends | Seamless loop replacement |
| **Marker** | `@marker(name)` | At a named cue point | Arrangement-driven |

### 3.2 Default Behavior

If no splice point is specified:

```
DEFAULT_SPLICE = @bar
```

This ensures changes align with musical structure by default.

---

## 4. State Management

When swapping from Clip A to Clip B, we must handle **state continuity**.

### 4.1 The State Vector

At any moment, the runtime maintains:

```typescript
interface RuntimeState {
  // Temporal
  tick: number;              // Current position in ticks (PPQ)
  beat: number;              // Current beat (derived)
  bar: number;               // Current bar (derived)
  
  // Musical
  tempo: number;             // Current BPM
  transposition: number;     // Semitones offset
  velocity: number;          // Current velocity multiplier
  
  // Active Notes (Critical for Hot-Swap)
  activeNotes: Map<VoiceKey, ActiveNote>;
}

interface ActiveNote {
  pitch: number;
  velocity: number;
  startTick: number;
  channel: number;
  expressionId: number;
}

type VoiceKey = `${expressionId}:${pitch}`;
```

### 4.2 State Transfer Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Inherit** | Clip B starts with A's state | Continuous performance |
| **Reset** | Clip B starts with default state | Clean break |
| **Merge** | Clip B state overlays A's state | Selective override |

**Default**: `Inherit` for tempo/transposition, special handling for active notes.

---

## 5. Active Note Resolution

The most critical aspect of hot-swap: **what happens to notes that are still sounding?**

### 5.1 The Orphan Problem

```
Clip A: [C4 tie:start ─────────────────> C4 tie:end]
                    ↑
                 SPLICE HERE
                    ↓
Clip B: [         E4 ───> E4]
```

If we splice mid-tie, the C4 never receives its `tie:end`. The note sustains forever (MIDI stuck note).

### 5.2 Resolution Strategies

| Strategy | Description | Result |
|----------|-------------|--------|
| **Release All** | Send note-off for all active notes at splice point | Clean cut, but abrupt |
| **Sustain Through** | Let active notes ring until their natural end | Smooth, but may clash |
| **Crossfade** | Fade out old notes while fading in new | Professional, but complex |
| **Inherit** | Transfer active notes to Clip B's state | Seamless if B expects them |

### 5.3 Default Resolution

```
DEFAULT_NOTE_RESOLUTION = Release All
```

Rationale: It's better to have a clean cut than a stuck note. Performers can opt into `Sustain Through` for legato transitions.

### 5.4 Implementation

```typescript
function resolveActiveNotes(
  state: RuntimeState,
  strategy: NoteResolutionStrategy,
  splicePoint: number
): PendingNoteOff[] {
  const pending: PendingNoteOff[] = [];
  
  switch (strategy) {
    case 'release_all':
      for (const [key, note] of state.activeNotes) {
        pending.push({
          tick: splicePoint,
          pitch: note.pitch,
          channel: note.channel,
          velocity: 0  // Note-off
        });
      }
      state.activeNotes.clear();
      break;
      
    case 'sustain_through':
      // Do nothing - notes continue naturally
      // Clip B's coalesce will NOT see these as its own ties
      break;
      
    case 'crossfade':
      // Schedule velocity ramp-down over N ticks
      const FADE_TICKS = 48; // Half beat at 96 PPQ
      for (const [key, note] of state.activeNotes) {
        pending.push({
          tick: splicePoint,
          type: 'ramp',
          pitch: note.pitch,
          channel: note.channel,
          fromVelocity: note.velocity,
          toVelocity: 0,
          duration: FADE_TICKS
        });
      }
      break;
  }
  
  return pending;
}
```

---

## 6. The Splice Operation

### 6.1 Splice Request

When the performer triggers a code change:

```typescript
interface SpliceRequest {
  // What to splice in
  newBytecode: Int32Array;
  
  // When to splice
  splicePoint: SplicePointType;
  
  // How to handle state
  stateMode: 'inherit' | 'reset' | 'merge';
  noteResolution: NoteResolutionStrategy;
  
  // Error handling
  onError: 'keep_old' | 'stop' | 'fallback';
}
```

### 6.2 Splice Execution (In Audio Thread)

```typescript
// In the AudioWorklet / VM
function executeSplice(request: SpliceRequest): void {
  // 1. Calculate actual splice tick
  const spliceTick = calculateSplicePoint(
    this.state.tick,
    request.splicePoint,
    this.state.beatsPerBar
  );
  
  // 2. Schedule pending note-offs
  const noteOffs = resolveActiveNotes(
    this.state,
    request.noteResolution,
    spliceTick
  );
  this.pendingEvents.push(...noteOffs);
  
  // 3. Prepare state for new clip
  const newState = prepareState(this.state, request.stateMode);
  
  // 4. Schedule the swap
  this.pendingSplice = {
    tick: spliceTick,
    bytecode: request.newBytecode,
    state: newState
  };
}

// In the main tick loop
function tick(): void {
  // Check for pending splice
  if (this.pendingSplice && this.state.tick >= this.pendingSplice.tick) {
    // ATOMIC SWAP
    this.bytecode = this.pendingSplice.bytecode;
    this.state = this.pendingSplice.state;
    this.pc = HEADER_SIZE; // Reset program counter to first instruction
    this.pendingSplice = null;
  }
  
  // Continue normal execution...
}
```

---

## 7. Error Handling

### 7.1 Compilation Failure

If the new code fails to compile:

```typescript
try {
  const bytecode = compileToBytecode(newClip);
  scheduler.requestSplice({ newBytecode: bytecode, ... });
} catch (error) {
  switch (request.onError) {
    case 'keep_old':
      // Do nothing - old clip continues
      console.warn('Compilation failed, keeping current clip');
      break;
    case 'stop':
      scheduler.requestSplice({ newBytecode: EMPTY_PROGRAM, ... });
      break;
    case 'fallback':
      scheduler.requestSplice({ newBytecode: FALLBACK_PROGRAM, ... });
      break;
  }
}
```

**Default**: `keep_old` — The show must go on.

### 7.2 Runtime Error

If the new bytecode causes a runtime error (invalid opcode, stack overflow):

```typescript
// In the VM
function executeInstruction(op: number): void {
  if (op > MAX_OPCODE) {
    this.triggerEmergencyStop();
    this.revertToLastKnownGood();
    return;
  }
  // ...
}
```

The VM maintains a `lastKnownGoodBytecode` that can be restored.

---

## 8. API Surface

### 8.1 LiveSession Extensions

```typescript
// packages/live/src/LiveSession.ts

interface LiveSession {
  // Existing
  play(): void;
  stop(): void;
  
  // New: Hot-Swap API
  splice(
    clip: ClipNode | (() => ClipNode),
    options?: SpliceOptions
  ): Promise<SpliceResult>;
  
  // Convenience methods
  spliceImmediate(clip: ClipNode): Promise<SpliceResult>;
  spliceOnBeat(clip: ClipNode): Promise<SpliceResult>;
  spliceOnBar(clip: ClipNode): Promise<SpliceResult>;
  
  // State inspection
  getState(): RuntimeState;
  getActiveNotes(): ActiveNote[];
}

interface SpliceOptions {
  at?: SplicePointType;
  stateMode?: 'inherit' | 'reset' | 'merge';
  noteResolution?: NoteResolutionStrategy;
  onError?: 'keep_old' | 'stop' | 'fallback';
}

interface SpliceResult {
  success: boolean;
  actualSpliceTick: number;
  releasedNotes: number;
  error?: Error;
}
```

### 8.2 Reactive Integration

For the "Zero-Click" experience, splicing should be automatic:

```typescript
// In a reactive editor context
const clip$ = codeEditor.pipe(
  debounceTime(100),
  map(code => parseAndBuild(code)),
  filter(clip => clip !== null)
);

clip$.subscribe(clip => {
  liveSession.splice(clip, { at: '@bar' });
});
```

---

## 9. Transport Protocol

### 9.1 Ring Buffer Extension

The `SpliceRequest` must be transportable via the Ghost Protocol (RFC-037).

We extend the ring buffer with a **control channel**:

```typescript
// Control message types
const CTRL_SPLICE = 0x01;
const CTRL_STOP = 0x02;
const CTRL_TEMPO = 0x03;

// Control message layout
// [TYPE: 1 byte] [SPLICE_TICK: 4 bytes] [BYTECODE_PTR: 4 bytes] [FLAGS: 1 byte]
```

### 9.2 Bytecode Handoff

The new bytecode is written to a **secondary buffer** (not the event ring):

```typescript
// Main Thread (Compiler Worker)
const bytecode = compileToBytecode(clip);
const bytecodeBuffer = new SharedArrayBuffer(bytecode.byteLength);
new Int32Array(bytecodeBuffer).set(bytecode);

// Send control message with pointer
controlChannel.write({
  type: CTRL_SPLICE,
  spliceTick: calculateSplicePoint(...),
  bytecodeRef: bytecodeBuffer,
  flags: NOTE_RESOLUTION_RELEASE_ALL | STATE_MODE_INHERIT
});
```

---

## 10. Timing Diagram

```
Timeline (ticks):  0    96   192   288   384   480
                   |    |    |     |     |     |
                   ├────┼────┼─────┼─────┼─────┤
Clip A Playing:    [====|====|=====|=====]
                                   ↑
                              Code Edit @ T=250
                              Compile @ T=260
                              Splice Request: @bar
                              Actual Splice: T=288 (next bar)
                                   ↓
                   ├────┼────┼─────┼─────┼─────┤
Clip B Playing:                    [=====|=====|====>
                                   
Note Resolution:            [note-offs]
                                   ↑
                            Released at T=288
```

---

## 11. Edge Cases

### 11.1 Rapid Successive Edits

If the performer types faster than the splice quantization:

```
T=0:   Splice A→B requested @bar (scheduled for T=96)
T=50:  Splice B→C requested @bar (scheduled for T=96)
```

**Resolution**: Latest wins. Splice A→B is cancelled, Splice A→C executes.

### 11.2 Splice During Splice

If a splice is requested while another is pending:

```typescript
if (this.pendingSplice) {
  // Replace pending splice (don't queue)
  this.pendingSplice = newSplice;
}
```

### 11.3 Empty Clip

Splicing to an empty clip:

```typescript
const EMPTY_PROGRAM = new Int32Array([
  MAGIC, VERSION, PPQ, BPM, 0, 0, 0, 0,  // Header (length=0)
  EOF  // Immediate end
]);
```

This is valid—it produces silence.

### 11.4 Infinite Loop Detection

If Clip B contains `loop(Infinity)` or unbounded recursion:

The bytecode compiler (RFC-038) should enforce `maxOperations`. At runtime, the VM has a tick budget per quantum:

```typescript
const MAX_TICKS_PER_QUANTUM = 9600; // 100 beats at 96 PPQ

if (ticksThisQuantum > MAX_TICKS_PER_QUANTUM) {
  this.triggerEmergencyStop();
  this.emit('error', 'Infinite loop detected');
}
```

---

## 12. Implementation Phases

### Phase 1: Core Primitives
- [ ] Define `SpliceRequest` and `SpliceResult` types
- [ ] Implement `resolveActiveNotes()` with `release_all` strategy
- [ ] Add `pendingSplice` handling to VM tick loop

### Phase 2: Transport Integration
- [ ] Extend ring buffer with control channel
- [ ] Implement bytecode handoff via secondary `SharedArrayBuffer`
- [ ] Add splice scheduling to `RingBufferWriter`

### Phase 3: LiveSession API
- [ ] Implement `LiveSession.splice()` method
- [ ] Add convenience methods (`spliceOnBeat`, `spliceOnBar`)
- [ ] Implement state inspection (`getState`, `getActiveNotes`)

### Phase 4: Advanced Features
- [ ] Implement `crossfade` note resolution
- [ ] Implement `sustain_through` note resolution
- [ ] Add `@marker` splice points
- [ ] Add error recovery with `lastKnownGoodBytecode`

### Phase 5: Reactive Integration
- [ ] Create `@symphonyscript/live-editor` package
- [ ] Implement automatic splice on code change
- [ ] Add visual feedback (splice pending, splice complete)

---

## 13. Dependencies

| Dependency | Reason |
|------------|--------|
| RFC-037 | Thread isolation for safe splice transport |
| RFC-038 | Bytecode format for atomic program replacement |
| RFC-035 | Duration analysis for phrase-level splice points |

---

## 14. Success Metrics

| Metric | Target |
|--------|--------|
| Splice latency (code edit → audio change) | < 1 bar at 120 BPM (~2s worst case) |
| Audio glitches during splice | 0 (no clicks, pops, or stuck notes) |
| Compilation failure recovery | 100% (old clip continues) |
| Rapid edit handling | Latest-wins, no queue overflow |

---

## 15. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
