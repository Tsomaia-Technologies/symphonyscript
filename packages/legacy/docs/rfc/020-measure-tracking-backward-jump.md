# RFC-020: Measure Tracking on Backward Time Jumps

**Status**: Draft  
**Priority**: Critical  
**Estimated Effort**: 1 day  
**Breaking Change**: None (fixes incorrect metadata)

---

## 1. Problem Statement

When processing `StackOp` (parallel branches), the timing phase jumps time backward to the stack start for each branch. The current implementation does not update `measure` and `beatInMeasure`:

```typescript
// src/compiler/pipeline/timing.ts:197-206
if (newBeat < state.beat) {
  const delta = newBeat - state.beat;
  state.beat = newBeat;
  // ⚠️ measure/beatInMeasure NOT updated
  return;
}
```

**Result**: Notes in parallel branches after the first branch have incorrect `measure` metadata. This affects:

1. Metronome/display consumers
2. Debugging/logging
3. Any future feature relying on measure positions

---

## 2. Requirements

| ID   | Requirement                                                   | Priority  |
| ---- | ------------------------------------------------------------- | --------- |
| FR-1 | Backward time jumps MUST correctly calculate measure position | Must Have |
| FR-2 | Solution MUST handle variable time signatures                 | Must Have |
| FR-3 | Performance impact MUST be minimal                            | Should    |

---

## 3. Proposed Solution

### 3.1 Absolute Measure Calculation

Compute measure from absolute beat position using a precomputed time signature map:

```typescript
interface TimeSignatureSegment {
  startBeat: number;
  beatsPerMeasure: number;
}

function beatToMeasure(
  beat: number,
  sigMap: TimeSignatureSegment[]
): {
  measure: number;
  beatInMeasure: number;
} {
  let measure = 1;
  let remaining = beat;

  for (const seg of sigMap) {
    const segEnd = sigMap[sigMap.indexOf(seg) + 1]?.startBeat ?? Infinity;
    const segBeats = Math.min(remaining, segEnd - seg.startBeat);

    if (remaining <= segBeats) {
      const measuresInSeg = Math.floor(remaining / seg.beatsPerMeasure);
      return {
        measure: measure + measuresInSeg,
        beatInMeasure: remaining % seg.beatsPerMeasure,
      };
    }

    measure += Math.floor(segBeats / seg.beatsPerMeasure);
    remaining -= segBeats;
  }

  return { measure, beatInMeasure: 0 };
}
```

### 3.2 Integration

1. Build `TimeSignatureSegment[]` during first pass (collect time_signature ops)
2. Replace `updateTime()` with absolute calculation for backward jumps
3. Cache results for forward-only sections (optimization)

---

## 4. Files to Modify

| Action     | Path                               | Description                               |
| ---------- | ---------------------------------- | ----------------------------------------- |
| **MODIFY** | `src/compiler/pipeline/timing.ts`  | Add absolute measure calculation          |
| **ADD**    | `src/compiler/pipeline/sig-map.ts` | Time signature segment builder (optional) |

---

## 5. Testing Strategy

```typescript
describe("Measure Tracking", () => {
  it("correctly tracks measure in parallel branches", () => {
    const clip = Clip.melody()
      .stack(
        (b) => b.note("C4", "1n") // 4 beats, measure 1
      )
      .stack(
        (b) =>
          b
            .note("E4", "2n") // 2 beats, should be measure 1
            .note("G4", "2n") // 2 beats, should be measure 1
      )
      .build();

    const timed = computeTiming(expanded, "4/4");
    const notes = timed.operations.filter((o) => o.kind === "op");

    expect(notes[0].measure).toBe(1); // C4
    expect(notes[1].measure).toBe(1); // E4 (branch 2, beat 0)
    expect(notes[2].measure).toBe(1); // G4 (branch 2, beat 2)
  });

  it("handles time signature changes across branches", () => {
    const clip = Clip.melody()
      .timeSignature("3/4")
      .stack((b) => b.note("C4", "2n.")) // 3 beats = 1 measure
      .note("D4", "4n") // beat 3 = measure 2
      .build();

    // After stack, D4 should be in measure 2
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
