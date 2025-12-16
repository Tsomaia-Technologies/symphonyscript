# RFC-025: Polyphonic Voice Identification

**Status**: Draft  
**Priority**: High (Scaling Blocker)  
**Estimated Effort**: 5+ days  
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

SymphonyScript's tie coalescing uses pitch as the sole key:

```typescript
// src/compiler/pipeline/coalesce.ts:30
const activeTies = new Map<string, { ... }>()  // Key: pitch
```

**Failure Case**: Two voices on the same pitch with different tie patterns corrupt each other:

```
Voice 1:  C4 ─────────────── (tied whole note)
Voice 2:  C4 ─ C4 ─ C4 ─ C4  (four quarter notes)
```

The coalescer cannot distinguish these. The second voice's notes incorrectly extend voice 1's tie.

**Scope**: This is a fundamental structural limitation, not a bug.

---

## 2. Requirements

| ID   | Requirement                                                 | Priority  |
| ---- | ----------------------------------------------------------- | --------- |
| FR-1 | Voices on same pitch MUST maintain independent tie chains   | Must Have |
| FR-2 | API MUST remain simple for monophonic use cases             | Must Have |
| FR-3 | Solution MUST integrate with MPE output (per-note channels) | Should    |

---

## 3. Proposed Solution

### 3.1 Voice Builder Method

Add `.voice(id, builder)` method that assigns an `expressionId` to all notes within:

```typescript
// Simple case (unchanged)
Clip.melody().note("C4").tie("start").note("C4").tie("end");

// Polyphonic case
Clip.melody()
  .voice(1, (v) => v.note("C4", "1n").tie("start").note("C4", "1n").tie("end"))
  .voice(2, (v) => v.note("C4", "4n").note("C4", "4n"));
```

### 3.2 Expression ID in NoteOp

Each note carries an optional `expressionId`:

```typescript
interface NoteOp {
  kind: "note";
  note: NoteName;
  duration: NoteDuration;
  expressionId?: number; // NEW: Voice identifier
  // ...
}
```

### 3.3 Tie Coalescing Key

Update coalescing to key on `${expressionId}:${pitch}`:

```typescript
// Before
const activeTies = new Map<string, TieState>(); // pitch only

// After
function tieKey(op: NoteOp): string {
  return `${op.expressionId ?? 0}:${op.note}`;
}
```

### 3.4 MPE Channel Mapping

In emit phase, `expressionId` maps to MIDI channel for MPE output:

```typescript
const mpeChannel = (expressionId % 15) + 1; // Channels 1-15 (0 reserved)
```

---

## 4. Files to Modify

| Action     | Path                                | Description                  |
| ---------- | ----------------------------------- | ---------------------------- |
| **MODIFY** | `src/clip/types.ts`                 | Add `expressionId` to NoteOp |
| **MODIFY** | `src/clip/MelodyBuilder.ts`         | Add `voice()` method         |
| **MODIFY** | `src/compiler/pipeline/coalesce.ts` | Key on expressionId:pitch    |
| **MODIFY** | `src/compiler/pipeline/emit.ts`     | Map expressionId to channel  |

---

## 5. Testing Strategy

```typescript
describe("Polyphonic Voices", () => {
  it("maintains independent tie chains per voice", () => {
    const clip = Clip.melody()
      .voice(1, (v) =>
        v.note("C4", "2n").tie("start").note("C4", "2n").tie("end")
      )
      .voice(2, (v) =>
        v.note("C4", "4n").note("C4", "4n").note("C4", "4n").note("C4", "4n")
      )
      .build();

    const { events } = compile(clip, { bpm: 120 });

    // Voice 1: 1 note, 4 beats duration (coalesced)
    // Voice 2: 4 notes, 1 beat each
    expect(events.filter((e) => e.kind === "note")).toHaveLength(5);
  });

  it("defaults to voice 0 when not specified", () => {
    const clip = Clip.melody().note("C4").note("D4").build();
    const ops = clip.operations.filter((o) => o.kind === "note");
    expect(ops.every((o) => o.expressionId === undefined)).toBe(true);
  });

  it("assigns correct expressionId within voice scope", () => {
    const clip = Clip.melody()
      .voice(3, (v) => v.note("C4"))
      .build();
    const note = clip.operations.find((o) => o.kind === "note");
    expect(note.expressionId).toBe(3);
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
