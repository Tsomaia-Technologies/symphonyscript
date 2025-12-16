# RFC-017: Clip-Level Humanization with Escapes

**Status**: Draft
**Priority**: Medium
**Estimated Effort**: 0.5 days
**Breaking Change**: No (additive API)

---

## 1. Problem Statement

Currently, humanization can only be applied per-note:

```typescript
Clip.melody()
  .note("C4")
  .humanize({ timing: 30 })
  .note("D4")
  .humanize({ timing: 30 })
  .note("E4")
  .humanize({ timing: 30 }); // Repetitive!
```

This is:

1. **Verbose** — Must apply to each note individually
2. **Error-prone** — Easy to forget on some notes
3. **Inconsistent** — Other modifiers (transpose, defaultDuration) work at clip level

---

## 2. Proposed Solution

### 2.1 Clip-Level Humanize

Set humanization for all subsequent notes:

```typescript
Clip.melody()
  .humanize({ timing: 30, velocity: 0.1 })
  .note("C4") // Humanized
  .note("D4") // Humanized
  .note("E4"); // Humanized
```

### 2.2 Note-Level Escape: `.precise()`

Override humanization for specific notes:

```typescript
Clip.melody()
  .humanize({ timing: 30 })
  .note("C4") // Humanized
  .note("D4")
  .precise() // NOT humanized (exact timing)
  .note("E4"); // Humanized
```

### 2.3 Combined with Chord

Chords also respect clip-level humanize:

```typescript
Clip.melody()
  .humanize({ timing: 20 })
  .chord("Cmaj", 4, "4n") // Humanized
  .chord("Am", 4, "4n")
  .precise(); // NOT humanized
```

---

## 3. API Design

### 3.1 ClipBuilder.humanize()

```typescript
interface HumanizeSettings {
  timing?: number; // Max timing variance in ms (±)
  velocity?: number; // Max velocity variance (0-1 range, ±)
  seed?: number; // Random seed for deterministic output
}

class ClipBuilder {
  /**
   * Set humanization context for subsequent notes.
   * Notes will have natural timing and velocity variations.
   */
  humanize(settings: HumanizeSettings): this {
    return this._withParams({ humanize: settings });
  }
}
```

### 3.2 MelodyNoteCursor.precise()

```typescript
class MelodyNoteCursor {
  /**
   * Disable humanization for this note.
   * Use for notes that must be exactly on-beat.
   */
  precise(): this {
    this.applyModifier({ humanize: null }); // Explicitly null = no humanize
    return this;
  }
}
```

### 3.3 MelodyChordCursor.precise()

```typescript
class MelodyChordCursor {
  /**
   * Disable humanization for this chord.
   */
  precise(): this {
    // Apply to all notes in stack
    for (const noteOp of this.pendingOp.operations) {
      if (noteOp.kind === "note") {
        noteOp.humanize = null;
      }
    }
    return this;
  }
}
```

---

## 4. Resolution Logic

### 4.1 Hierarchy

```
Note.humanize  →  Clip._params.humanize  →  undefined
     ↓                    ↓                      ↓
  Use this          Use this               No humanization
```

### 4.2 Resolution in note() Method

```typescript
// src/clip/MelodyBuilder.ts

note(pitch: NoteName, duration?: NoteDuration): MelodyNoteCursor {
  const op = Actions.note(pitch, resolvedDuration, 1)

  // Apply clip-level humanize if set and not explicitly disabled
  if (op.humanize === undefined && this._params.humanize) {
    op.humanize = this._params.humanize
  }

  return new MelodyNoteCursor(this, op)
}
```

### 4.3 The `.precise()` Escape

When `.precise()` is called, it sets `humanize: null` on the note operation. During compilation, `null` means "explicitly no humanization", distinct from `undefined` which means "inherit from context".

---

## 5. Usage Examples

### 5.1 Basic Humanization

```typescript
const melody = Clip.melody()
  .humanize({ timing: 30, velocity: 0.1 })
  .note("C4", "8n")
  .note("E4", "8n")
  .note("G4", "8n");

// All notes get ±30ms timing and ±0.1 velocity variance
```

### 5.2 Downbeats Precise

```typescript
const groove = Clip.melody()
  .humanize({ timing: 25 })
  .note("C4", "4n")
  .precise() // Downbeat: exact
  .note("E4", "8n") // Offbeat: humanized
  .note("G4", "8n") // Offbeat: humanized
  .note("C5", "4n")
  .precise(); // Downbeat: exact
```

### 5.3 Changing Humanization Mid-Clip

```typescript
const dynamics = Clip.melody()
  .humanize({ timing: 50 }) // Loose intro
  .note("C4")
  .note("D4")
  .humanize({ timing: 10 }) // Tight verse
  .note("E4")
  .note("F4")
  .humanize({ timing: 0 }) // Disable (equivalent to no humanize)
  .note("G4"); // Exact
```

### 5.4 Deterministic Output with Seed

```typescript
const consistent = Clip.melody()
  .humanize({ timing: 30, seed: 12345 })
  .note("C4")
  .note("D4")
  .note("E4");

// Same seed = same variance pattern every compilation
```

---

## 6. Implementation

### 6.1 Type Changes

```typescript
// src/clip/types.ts - Already exists, but ensure:
export interface HumanizeSettings {
  timing?: number;
  velocity?: number;
  seed?: number;
}

// src/clip/builder-types.ts
export interface ClipParams {
  // ... existing
  humanize?: HumanizeSettings;
}

export interface MelodyParams extends ClipParams {
  // Inherits humanize
}

// src/clip/types.ts - NoteOp
export interface NoteOp {
  // ... existing
  humanize?: HumanizeSettings | null; // null = explicitly disabled
}
```

### 6.2 ClipBuilder.humanize()

```typescript
// src/clip/ClipBuilder.ts

humanize(settings: HumanizeSettings): this {
  return this._withParams({ humanize: settings } as unknown as ParamUpdater<P>)
}
```

### 6.3 MelodyBuilder.note() Update

```typescript
// src/clip/MelodyBuilder.ts

note(pitch: NoteName, duration?: NoteDuration): MelodyNoteCursor {
  const resolvedDuration = duration ?? this._params.defaultDuration ?? '4n'
  const op = Actions.note(validatedPitch, resolvedDuration, 1)

  // Apply clip-level humanize if not already set
  if (this._params.humanize) {
    op.humanize = this._params.humanize
  }

  return new MelodyNoteCursor(this, op)
}
```

### 6.4 MelodyNoteCursor.precise()

```typescript
// src/clip/cursors/MelodyNoteCursor.ts

/**
 * Disable humanization for this note.
 * Note will have exact timing and velocity.
 */
precise(): this {
  this.applyModifier({ humanize: null })
  return this
}
```

### 6.5 MelodyChordCursor.precise()

```typescript
// src/clip/cursors/MelodyChordCursor.ts

/**
 * Disable humanization for all notes in this chord.
 */
precise(): this {
  const op = this.pendingOp
  if (op.kind === 'stack') {
    for (const noteOp of op.operations) {
      if (noteOp.kind === 'note') {
        (noteOp as NoteOp).humanize = null
      }
    }
  }
  return this
}
```

### 6.6 Compiler Update

Compiler already handles `NoteOp.humanize`. Ensure it respects `null` as "explicitly no humanization":

```typescript
// src/compiler/pipeline/emit.ts

if (original.humanize !== null && original.humanize !== undefined) {
  // Apply humanization
}
// If humanize === null, skip (explicit disable)
// If humanize === undefined, skip (no humanization set)
```

---

## 7. Files to Modify

| Action     | Path                                    | Description                            |
| ---------- | --------------------------------------- | -------------------------------------- |
| **MODIFY** | `src/clip/types.ts`                     | Ensure `NoteOp.humanize` can be `null` |
| **MODIFY** | `src/clip/ClipBuilder.ts`               | Add `humanize()` method                |
| **MODIFY** | `src/clip/MelodyBuilder.ts`             | Apply clip-level humanize in `note()`  |
| **MODIFY** | `src/clip/cursors/MelodyNoteCursor.ts`  | Add `precise()` method                 |
| **MODIFY** | `src/clip/cursors/MelodyChordCursor.ts` | Add `precise()` method                 |
| **MODIFY** | `src/compiler/pipeline/emit.ts`         | Respect `humanize: null`               |
| **MODIFY** | `src/__tests__/modifiers.test.ts`       | Add tests                              |

---

## 8. Testing Strategy

```typescript
describe("Clip-Level Humanization", () => {
  it("applies humanize to all subsequent notes", () => {
    const clip = Clip.melody()
      .humanize({ timing: 30 })
      .note("C4")
      .note("D4")
      .build();

    expect(clip.operations[0].humanize?.timing).toBe(30);
    expect(clip.operations[1].humanize?.timing).toBe(30);
  });

  it("precise() disables humanization for a note", () => {
    const clip = Clip.melody()
      .humanize({ timing: 30 })
      .note("C4")
      .note("D4")
      .precise()
      .build();

    expect(clip.operations[0].humanize?.timing).toBe(30);
    expect(clip.operations[1].humanize).toBeNull();
  });

  it("chord respects clip-level humanize", () => {
    const clip = Clip.melody()
      .humanize({ timing: 20 })
      .chord(["C4", "E4", "G4"])
      .build();

    const stack = clip.operations[0] as StackOp;
    expect(stack.operations[0].humanize?.timing).toBe(20);
  });

  it("chord.precise() disables humanization", () => {
    const clip = Clip.melody()
      .humanize({ timing: 20 })
      .chord(["C4", "E4", "G4"])
      .precise()
      .build();

    const stack = clip.operations[0] as StackOp;
    expect(stack.operations[0].humanize).toBeNull();
  });

  it("changing humanize mid-clip works", () => {
    const clip = Clip.melody()
      .humanize({ timing: 50 })
      .note("C4")
      .humanize({ timing: 10 })
      .note("D4")
      .build();

    expect(clip.operations[0].humanize?.timing).toBe(50);
    expect(clip.operations[1].humanize?.timing).toBe(10);
  });

  it("compiler respects null humanize", () => {
    const clip = Clip.melody()
      .humanize({ timing: 100, seed: 1 })
      .note("C4")
      .note("D4")
      .precise();

    const s = session().add(
      Track.from(clip.commit(), Instrument.synth("Test"))
    );
    const { output } = compile(s);

    const notes = output.timeline.filter((e) => e.kind === "note_on");
    // First note should have timing variance
    // Second note should be exactly on beat (no variance)
    expect(notes[1].time).toBe(0.5); // Exact half-second at 120 BPM
  });
});
```

---

## 9. Migration

Fully backward compatible:

- Existing per-note `.humanize()` still works
- Clip-level humanize is additive
- Notes without clip-level humanize behave as before

---

## 10. Approval

- [ ] Approved by maintainer
