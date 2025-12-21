# RFC-019: MPE Field Type Safety

**Status**: Draft  
**Priority**: Critical  
**Estimated Effort**: 0.5 days  
**Breaking Change**: Potentially (payload values change from float to int)

---

## 1. Problem Statement

The `NotePayload` interface defines `timbre` and `pressure` as `MidiValue` (0-127 integer):

```typescript
// src/compiler/pipeline/types.ts
export interface NotePayload {
  timbre?: MidiValue; // 0-1 ← Comment is WRONG
  pressure?: MidiValue; // 0-1 ← Comment is WRONG
}
```

However, `emit.ts` stores the original float values with `as any` casts:

```typescript
// src/compiler/pipeline/emit.ts:299-300
timbre: original.timbre as any,    // Keep as original 0-1 float
pressure: original.pressure as any, // Keep as original 0-1 float
```

This is a **type lie**. Consumers expecting `MidiValue` receive floats.

---

## 2. Requirements

| ID   | Requirement                                    | Priority  |
| ---- | ---------------------------------------------- | --------- |
| FR-1 | Emitted values MUST match declared types       | Must Have |
| FR-2 | Choose ONE representation (float OR MidiValue) | Must Have |
| FR-3 | Document the chosen format clearly             | Must Have |

---

## 3. Proposed Solution

**Normalize to MidiValue**

Convert to 0-127 at emit time, matching the declared type:

```typescript
// emit.ts
timbre: original.timbre !== undefined
  ? midiValue(Math.round(original.timbre * 127))
  : undefined,
pressure: original.pressure !== undefined
  ? midiValue(Math.round(original.pressure * 127))
  : undefined,
```

**Conclusion**: MIDI-centric output is more universally compatible.

---

## 4. Files to Modify

| Action     | Path                             | Description                  |
| ---------- | -------------------------------- | ---------------------------- |
| **MODIFY** | `src/compiler/pipeline/emit.ts`  | Convert float to MidiValue   |
| **MODIFY** | `src/compiler/pipeline/types.ts` | Fix comment (0-127, not 0-1) |

---

## 5. Testing Strategy

```typescript
describe("MPE Field Emission", () => {
  it("emits timbre as MidiValue (0-127)", () => {
    const clip = Clip.melody().note("C4").timbre(0.5).build();
    const { events } = compile(clip, { bpm: 120 });
    const note = events.find((e) => e.kind === "note");
    expect(note.payload.timbre).toBe(64); // 0.5 * 127 ≈ 64
  });

  it("emits pressure as MidiValue (0-127)", () => {
    const clip = Clip.melody().note("C4").pressure(1.0).build();
    const { events } = compile(clip, { bpm: 120 });
    const note = events.find((e) => e.kind === "note");
    expect(note.payload.pressure).toBe(127);
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
