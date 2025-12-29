# RFC-049: Synaptic Cursor Architecture

**Status**: Draft
**Author**: Engineer/Architect
**Created**: 2025-12-28
**Supersedes**: RFC-047 Phase 9

## 1. Abstract

This RFC defines a complete architectural overhaul of the `Synaptic` layer in the `@symphonyscript/composer` package. It introduces a **zero-allocation, mutable cursor pattern** that unifies the expressiveness of the legacy efficient cursor API with the performance requirements of the real-time audio kernel.

The new architecture replaces the temporary `SynapticNoteCursor` prototype from RFC-047 Phase 9 with a robust hierarchy of cursors (`SynapticCursor`, `SynapticMelodyNoteCursor`, `SynapticChordCursor`, `SynapticDrumHitCursor`) that handle note construction, modification, and direct kernel injection via the `SiliconBridge`.

## 2. Motivation

Building on the lessons from RFC-047 Phase 9, we identified critical requirements for the cursor architecture:
1.  **Zero-Allocation**: Cursors must be reused. A single cursor instance per clip builder should handle all note operations.
2.  **Rich API**: The API must support the full expressiveness of the legacy system (chaining modifiers like `.velocity()`, `.staccato()`, `.detune()`) without object allocation.
3.  **Correctness**: Notes should be fully configured before being inserted into the SharedArrayBuffer (SAB) to avoid race conditions with the audio thread.
4.  **Friendly Chords**: Unification of user-friendly chord parsing (`.chord('Cmaj7')`) and efficient kernel execution (`.harmony()`) into a single zero-alloc pipeline.

## 3. Architecture

### 3.1. The Pending-State Pattern

To satisfying both "Rich API" and "Correctness", we adopt a **Pending-State Pattern**:

1.  **Creation**: Calling `.note('C4')` does NOT immediately insert into the kernel. It configures the cursor's internal state (pitch, velocity, duration) and marks it as `pending`.
2.  **Modification**: Chained modifiers like `.velocity(0.8)` or `.staccato()` mutate the cursor's internal state (primitives). No kernel calls, no allocations.
3.  **Commit**: The pending note is inserted into the kernel (SAB) only when:
    *   A **Relay** method is called (e.g., `.note()`, `.chord()` for the *next* note).
    *   An **Escape** method is called (e.g., `.rest()`, `.tempo()`).
    *   Explicit `.commit()` is called.

This ensures a single automatic `bridge.insertAsync()` call with fully finalized parameters.

### 3.2. Single Mutable Cursor

Each builder (`SynapticMelody`, `SynapticDrums`) maintains **one** instance of its specific cursor type. Relays return `this` (the same cursor instance), rebinding it to the new pending operation.

```typescript
// Conceptual Flow
melody.note('C4')      // Configures cursor for C4, sets pending=true, returns cursor
      .velocity(0.8)   // Mutates cursor velocity, returns cursor
      .note('D4')      // 1. Flush pending C4 to kernel
                       // 2. Configure cursor for D4, sets pending=true
                       // 3. Return cursor
```

## 4. Class Hierarchy

All cursors reside in `packages/composer/src/new/cursors/`.

### 4.1. `SynapticCursor` (Abstract Base)
Base class handling common state, core modifiers, and clip-level escapes.

*   **State**: `clip`, `bridge`, `hasPending`, `baseTick`, `velocity`, `duration`, `muted`.
*   **Base Modifiers** (return `this`): `velocity()`, `staccato()`, `legato()`, `accent()`, `tenuto()`, `marcato()`, `humanize()`, `precise()`.
*   **Clip Escapes** (commit & return `Clip`): `rest()`, `tempo()`, `timeSignature()`, `swing()`, `groove()`, `control()`, `stack()`, `loop()`, `commit()`.
*   **Internal**: `flush()` (abstract), `bind()`.

### 4.2. `SynapticNoteCursor`
Extends `SynapticCursor`. Basic single-note handling.

*   **State**: `pitch` (number).
*   **Relays**: `note(pitch, duration?)` -> Commits previous, starts new note.

### 4.3. `SynapticMelodyBaseCursor`
Extends `SynapticCursor`. Shared base for pitched instruments (single notes and chords). Adds expression and pitch bending support.

*   **State**: `detune`, `timbre`, `pressure`, `glide`, `tie`, `expressionId`.
*   **Modifiers**: `detune()`, `timbre()`, `pressure()`, `expression()`, `glide()`, `tie()`.

### 4.4. `SynapticMelodyNoteCursor`
Extends `SynapticMelodyBaseCursor`. Specialized for single melodic notes.

*   **State**: `pitch` (overrides/uses base).
*   **Pitch Modifiers**: `natural()`, `sharp()`, `flat()`.
*   **Relays**:
    *   `note()`: returns `SynapticMelodyNoteCursor`
    *   `chord()`: returns `SynapticChordCursor`
    *   `degree()`: returns `SynapticMelodyNoteCursor`
*   **Escapes**: `transpose()`, `scale()`, `arpeggio()`, `vibrato()`, etc.

### 4.5. `SynapticChordCursor`
Extends `SynapticMelodyBaseCursor`. Handles multi-voice chords with zero-allocation structure.

*   **Configuration**: `maxVoices` (default 8, configurable).
*   **State**:
    *   `chordMask` (24-bit integer, packed intervals).
    *   `chordRoot` (MIDI pitch).
    *   `sourceIds` (Fixed `number[]` pre-allocated to `maxVoices`).
    *   `pitches` (Fixed `number[]` pre-allocated to `maxVoices`).
*   **Unified Flow**:
    *   `chord(string)` -> Parses to mask -> Sets pending mask.
    *   `harmony(mask)` -> Sets pending mask directly.
*   **Inline Voice Allocation**: `flush()` iterates `chordMask` bits **inline** (no callbacks, no `VoiceAllocator` class) to insert notes into kernel.
*   **Modifiers**: `inversion(steps)` (uses zero-alloc unpacking and bitwise rotation).

### 4.6. `SynapticDrumHitCursor`
Extends `SynapticCursor`. Specialized for unhitched percussive events.

*   **State**: `drumPitch`, `isFlam`, `isDrag`.
*   **Modifiers**: `ghost()`, `flam()`, `drag()`.
*   **Relays**: `hit()`, `kick()`, `snare()`, `hat()`, `clap()`, etc.

## 5. Implementation Directives

### 5.1. Directory Structure (`packages/composer/src/new/`)
Implement the new system in a clean namespace to avoid conflict with legacy code during development.

```
src/new/
├── cursors/
│   ├── SynapticCursor.ts
│   ├── SynapticNoteCursor.ts
│   ├── SynapticMelodyBaseCursor.ts
│   ├── SynapticMelodyNoteCursor.ts
│   ├── SynapticChordCursor.ts
│   └── SynapticDrumHitCursor.ts
├── clips/
│   ├── SynapticClip.ts          (Refreshed base)
│   ├── SynapticMelody.ts        (Refreshed melody builder)
│   └── SynapticDrums.ts         (New drum builder)
├── groove/
│   ├── SynapticGrooveBuilder.ts (Mutable pattern)
│   └── GrooveStepCursor.ts      (Step modifiers)
└── index.ts
```

### 5.2. Zero-Allocation Rules
1.  **No Closures in Hot Paths**: `flush()` methods must use `while` loops and bitwise operations, never `array.forEach` or `unpack(mask, callback)`.
2.  **Class Properties**: Use class properties for temporary state instead of allocating objects/contexts (e.g., for inversion logic).
3.  **Fixed Arrays**: Chord cursors pre-allocate `sourceIds` and `pitches` arrays in constructor.

### 5.3. GrooveBuilder Architecture
A **Mutable Builder** pattern with `.freeze()` for immutability.

*   `GrooveBuilder`: Configures global groove state (`stepsPerBeat`, `swing`).
*   `GrooveStepCursor`: Helper for configuring individual steps (`timing`, `velocity`, `probability`).
*   `.step(timing?)`: Returns `GrooveStepCursor` (starts first step).
*   `GrooveStepCursor` Methods:
    *   **Modifiers** (return `this`): `.timing(offset)`, `.velocity(scale)`, `.duration(scale)`, `.probability(p)`.
    *   **Relay** (return `this`): `.step(timing?)` (commits current, starts next).
    *   **Terminal** (returns `GrooveTemplate`): `.freeze()`.
*   `.freeze()`: Returns the immutable `GrooveTemplate` ready for `clip.use()`.

```typescript
// Usage Example
const mpc = Groove.builder()
    .stepsPerBeat(4)
    .swing(0.55)
    .step(0.1).velocity(0.9)  // Step 1
    .step(-0.05)              // Step 2
    .freeze();
```

### 5.4. Unified Chord/Harmony
The `SynapticMelody.chord()` method must NOT allocate note arrays or iterate manually.
1.  It calls `parseChordCode()` (legacy helper) to get intervals.
2.  It calls `pack()` (legacy helper) to get a 24-bit mask.
3.  It sets `chordMask` on the cursor.
4.  `cursor.flush()` iterates the mask bits inline and calls `bridge.insertAsync`.

## 6. Migration Strategy
1.  Implement new classes in `src/new/`.
2.  Verify behavior with new tests (mirroring legacy cursor tests).
3.  Once stable, replace exports in `packages/composer/src/index.ts`.
4.  Delete old implementations.
