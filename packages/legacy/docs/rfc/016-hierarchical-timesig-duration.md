# RFC-016: Hierarchical Time Signature & Default Duration

**Status**: Draft
**Priority**: Medium
**Estimated Effort**: 1 day
**Breaking Change**: No (additive API)

---

## 1. Problem Statement

### 1.1 Time Signature

Currently, time signature can only be set at compilation or via `.timeSignature()` operations in clips:

```typescript
Clip.melody().timeSignature("3/4").note("C4"); // Works

compile(session, { timeSignature: "4/4" }); // Compiler option
```

**Issues:**

1. No track-level or session-level defaults
2. Inconsistent with tempo hierarchy (RFC-015)
3. Can't easily set project-wide time signature

### 1.2 Default Duration

Currently, every note/chord requires an explicit duration:

```typescript
.note('C4', '8n')
.note('E4', '8n')
.note('G4', '8n')  // Repetitive!
```

**Issues:**

1. Verbose for consistent rhythms
2. No way to set a context default
3. Other music DSLs (e.g., Sonic Pi) support implicit durations

---

## 2. Proposed Solution

### 2.1 Hierarchical Time Signature

**Hierarchy**: Clip → Track → Session → Default (4/4)

```typescript
// Session-level
const s = session({
  tempo: 140,
  timeSignature: "3/4",
});

// Track-level override
Track.from(clip, inst, {
  tempo: 120,
  timeSignature: "6/8",
});

// Clip-level override (existing)
Clip.melody().timeSignature("5/4").note("C4");
```

### 2.2 Default Duration Context

```typescript
// Set default duration for all subsequent notes
Clip.melody()
  .defaultDuration("8n")
  .note("C4") // Uses '8n'
  .note("E4") // Uses '8n'
  .note("G4", "4n") // Explicit override
  .note("B4"); // Back to '8n'
```

**Hierarchy**: Explicit arg → Builder context → Global default ('4n')

---

## 3. API Design

### 3.1 Session Constructor

```typescript
session(options?: {
  tempo?: number,
  timeSignature?: TimeSignatureString
})
```

### 3.2 Track Constructor

```typescript
Track.from(
  clip: ClipNode,
  instrument: Instrument,
  options?: {
    tempo?: number,
    timeSignature?: TimeSignatureString
  }
)
```

### 3.3 MelodyBuilder.defaultDuration()

```typescript
class MelodyBuilder {
  /**
   * Set default duration for subsequent notes/chords.
   * Notes without explicit duration will use this value.
   */
  defaultDuration(duration: NoteDuration): this {
    return this._withParams({
      defaultDuration: duration,
    });
  }
}
```

### 3.4 Note/Chord Methods (Updated)

```typescript
// Duration parameter becomes optional
note(pitch: NoteName, duration?: NoteDuration): MelodyNoteCursor

chord(pitches: NoteName[], duration?: NoteDuration): MelodyChordCursor
chord(code: ChordCode, octave: number, duration?: NoteDuration): MelodyChordCursor
```

---

## 4. Implementation

### 4.1 Type Changes

```typescript
// src/session/types.ts
export interface SessionNode {
  // ... existing fields
  tempo?: number;
  timeSignature?: TimeSignatureString; // NEW
}

export interface TrackNode {
  // ... existing fields
  tempo?: number;
  timeSignature?: TimeSignatureString; // NEW
}

// src/clip/builder-types.ts
export interface MelodyParams extends BaseBuilderParams {
  // ... existing fields
  defaultDuration?: NoteDuration; // NEW
}
```

### 4.2 Time Signature Resolver

```typescript
// src/compiler/timesig-resolver.ts

export function resolveInitialTimeSignature(
  session: SessionNode,
  track: TrackNode,
  clip: ClipNode
): TimeSignatureString {
  // 1. Check clip-level time signature op (before first content)
  const timeSigOp = findInitialOp(clip, "time_signature");
  if (timeSigOp) return timeSigOp.signature;

  // 2. Check track-level override
  if (track.timeSignature) return track.timeSignature;

  // 3. Check session-level default
  if (session.timeSignature) return session.timeSignature;

  // 4. Global default
  return "4/4";
}
```

### 4.3 Duration Resolution in MelodyBuilder

```typescript
// src/clip/MelodyBuilder.ts

note(pitch: NoteName, duration?: NoteDuration): MelodyNoteCursor {
  const resolvedDuration = duration ?? this._params.defaultDuration ?? '4n'
  validate.pitch('note', pitch)
  const op = Actions.note(pitch, resolvedDuration, 1)
  return new MelodyNoteCursor(this, op)
}

chord(
  arg1: NoteName[] | ChordCode,
  arg2?: NoteDuration | number,
  arg3?: NoteDuration
): MelodyChordCursor {
  if (Array.isArray(arg1)) {
    const pitches = arg1
    const duration = arg2 ?? this._params.defaultDuration ?? '4n'
    // ... rest of chord logic
  } else {
    const octave = typeof arg2 === 'number' ? arg2 : 4
    const duration = arg3 ?? this._params.defaultDuration ?? '4n'
    // ... rest of chord code logic
  }
}
```

---

## 5. Usage Examples

### 5.1 Session-Level Time Signature

```typescript
const waltz = session({
  tempo: 180,
  timeSignature: "3/4",
})
  .add(Track.from(melody, piano))
  .add(Track.from(bass, bassist));
```

### 5.2 Mixed Time Signatures

```typescript
const prog = session({ timeSignature: "4/4" })
  .add(
    Track.from(
      drums,
      drumKit,
      { timeSignature: "7/8" } // Polymetric!
    )
  )
  .add(Track.from(melody, synth)); // Uses 4/4
```

### 5.3 Default Duration

```typescript
const melody = Clip.melody("Fast")
  .defaultDuration("16n")
  .note("C4") // 16th note
  .note("D4") // 16th note
  .note("E4") // 16th note
  .note("F4", "8n") // Explicit 8th note
  .note("G4"); // Back to 16th note
```

### 5.4 Changing Default Duration Mid-Clip

```typescript
Clip.melody("Rhythm")
  .defaultDuration("8n")
  .note("C4")
  .note("E4")
  .note("G4") // All 8th notes
  .defaultDuration("4n")
  .note("C5")
  .note("E5"); // All quarter notes
```

---

## 6. Edge Cases

### 6.1 Empty Duration Falls Back to Default

```typescript
.note('C4')  // No explicit duration
// Resolution: defaultDuration context → '4n' global default
```

### 6.2 Rest Duration

Should `rest()` also use `defaultDuration`?

**Decision**: Yes, for consistency.

```typescript
.defaultDuration('8n')
.note('C4')   // 8n
.rest()       // 8n (uses default)
.rest('4n')   // 4n (explicit)
```

### 6.3 Polymetric Sessions

Tracks with different time signatures compile independently. Beat alignment is based on tempo, not measure boundaries.

---

## 7. Testing Strategy

```typescript
describe("Hierarchical Time Signature", () => {
  it("uses global default (4/4)", () => {
    const s = session().add(Track.from(emptyClip, synth));
    const { output } = compile(s);
    expect(output.meta.timeSignature).toBe("4/4");
  });

  it("uses session timeSignature", () => {
    const s = session({ timeSignature: "3/4" }).add(Track.from(clip, synth));
    // Verify 3/4
  });

  it("track overrides session", () => {
    const s = session({ timeSignature: "4/4" }).add(
      Track.from(clip, synth, { timeSignature: "7/8" })
    );
    // Verify 7/8
  });

  it("clip overrides track", () => {
    const clip = Clip.melody().timeSignature("5/4").note("C4").build();
    const s = session({ timeSignature: "4/4" }).add(
      Track.from(clip, synth, { timeSignature: "3/4" })
    );
    // Verify 5/4 is used
  });
});

describe("Default Duration", () => {
  it("uses global default (4n) when no context set", () => {
    const clip = Clip.melody().note("C4").build();
    expect(clip.operations[0].duration).toBe("4n");
  });

  it("uses defaultDuration context", () => {
    const clip = Clip.melody().defaultDuration("8n").note("C4").build();
    expect(clip.operations[0].duration).toBe("8n");
  });

  it("explicit duration overrides context", () => {
    const clip = Clip.melody().defaultDuration("8n").note("C4", "2n").build();
    expect(clip.operations[0].duration).toBe("2n");
  });

  it("rest() uses defaultDuration", () => {
    const clip = Clip.melody().defaultDuration("16n").rest().build();
    expect(clip.operations[0].duration).toBe("16n");
  });

  it("chord() uses defaultDuration", () => {
    const clip = Clip.melody()
      .defaultDuration("2n")
      .chord(["C4", "E4"])
      .build();
    const stack = clip.operations[0];
    expect(stack.operations[0].duration).toBe("2n");
  });
});
```

---

## 8. Files to Modify

| Action     | Path                               | Description                                       |
| ---------- | ---------------------------------- | ------------------------------------------------- |
| **MODIFY** | `src/session/types.ts`             | Add `timeSignature` to Session/TrackNode          |
| **MODIFY** | `src/session/Session.ts`           | Update `session()` factory                        |
| **MODIFY** | `src/session/Track.ts`             | Update `Track.from()`                             |
| **NEW**    | `src/compiler/timesig-resolver.ts` | Time sig resolution logic                         |
| **MODIFY** | `src/compiler/index.ts`            | Integrate timesig resolver                        |
| **MODIFY** | `src/clip/builder-types.ts`        | Add `defaultDuration` to params                   |
| **MODIFY** | `src/clip/MelodyBuilder.ts`        | Add `defaultDuration()` method, update note/chord |
| **MODIFY** | `src/clip/DrumBuilder.ts`          | Update kick/snare/hat to use default duration     |
| **MODIFY** | `src/__tests__/timesig.test.ts`    | Add hierarchy tests                               |
| **MODIFY** | `src/__tests__/builders.test.ts`   | Add default duration tests                        |

---

## 9. Migration

Fully backward compatible. All existing code continues to work:

- Default time signature remains 4/4
- All note/chord calls with explicit durations unchanged
- Notes without durations default to '4n' (current implicit behavior)

---

## 10. Approval

- [ ] Approved by maintainer
