# RFC-024: TempoTransition Curve Type Cleanup

**Status**: Draft  
**Priority**: Moderate  
**Estimated Effort**: 0.5 days  
**Breaking Change**: Minor (type narrowing)

---

## 1. Problem Statement

`TempoTransition.curve` uses a messy union with an inline import:

```typescript
// src/clip/types.ts:179
curve?: TempoCurve | import('../types/primitives').TempoEnvelope
```

**Issues**:

1. Inline `import()` types are a code smell
2. Dual semantics (string enum vs object) require runtime checks
3. Poor IntelliSense/autocomplete experience

---

## 2. Requirements

| ID   | Requirement                                    | Priority  |
| ---- | ---------------------------------------------- | --------- |
| FR-1 | `curve` type MUST be clearly defined           | Must Have |
| FR-2 | Complex envelopes MUST use a separate property | Should    |
| FR-3 | Backward compatibility MUST be maintained      | Must Have |

---

## 3. Proposed Solution

### Separate Properties

```typescript
export interface TempoTransition {
  duration: NoteDuration;
  curve?: TempoCurve; // Simple curve: 'linear' | 'ease-in' | etc.
  envelope?: TempoEnvelope; // Complex multi-keyframe envelope
  precise?: boolean;
}
```

---

## 4. Files to Modify

| Action     | Path                                 | Description                 |
| ---------- | ------------------------------------ | --------------------------- |
| **MODIFY** | `src/clip/types.ts`                  | Split curve/envelope        |
| **MODIFY** | `src/compiler/pipeline/tempo-map.ts` | Update envelope detection   |
| **MODIFY** | `src/clip/MelodyBuilder.ts`          | Update tempoEnvelope method |

---

## 5. Testing Strategy

```typescript
describe("Tempo Transitions", () => {
  it("handles simple curve", () => {
    const clip = Clip.melody()
      .tempo(140, { duration: "2n", curve: "ease-out" })
      .build();
    // Verify playback
  });

  it("handles complex envelope", () => {
    const clip = Clip.melody()
      .tempo(140, {
        duration: "4n",
        envelope: {
          keyframes: [
            { beat: 0, bpm: 120, curve: "linear" },
            { beat: 2, bpm: 140, curve: "ease-out" },
          ],
        },
      })
      .build();
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
