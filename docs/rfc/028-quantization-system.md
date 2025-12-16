# RFC-028: Quantization System

**Status**: Draft  
**Priority**: Medium  
**Estimated Effort**: 2 days  
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

SymphonyScript has `.humanize()` for adding imperfection, but no inverse operation:

- **No snap-to-grid** — Can't quantize loose timing to a grid
- **No strength control** — Can't partially quantize (50% strength)
- **No groove quantize** — Can't quantize to a swing/groove template

This matters when importing MIDI or generating algorithmic patterns that need cleanup.

---

## 2. Requirements

| ID   | Requirement                                    | Priority  |
| ---- | ---------------------------------------------- | --------- |
| FR-1 | Quantize note timing to grid                   | Must Have |
| FR-2 | Quantize strength (0-100%)                     | Must Have |
| FR-3 | Quantize to groove template                    | Should    |
| FR-4 | Quantize note durations (not just start times) | Should    |

---

## 3. Proposed Solution

### 3.1 Basic Quantization

```typescript
Clip.melody()
  .quantize("8n") // Snap all notes to 8th note grid
  .note("C4", 0.48); // Slightly early → snaps to 0.5 beats
```

**Implementation:**

- Add `quantize` to `ClipParams`
- In emit phase, round `beatStart` to nearest grid division

### 3.2 Quantize Strength

```typescript
Clip.melody().quantize("16n", { strength: 0.5 }); // 50% toward grid
```

**Formula:**

```typescript
quantizedBeat = originalBeat + (gridBeat - originalBeat) * strength;
```

### 3.3 Groove Quantize

```typescript
Clip.melody().quantize("8n", { groove: swingGroove }); // Quantize to swing grid
```

**Implementation:**

- Use existing `GrooveTemplate` for timing offsets
- Apply groove offsets after grid quantization

### 3.4 Duration Quantization

```typescript
Clip.melody().quantize("8n", { duration: true }); // Also quantize note lengths
```

---

## 4. Files to Modify

| Action     | Path                            | Description                 |
| ---------- | ------------------------------- | --------------------------- |
| **MODIFY** | `src/clip/types.ts`             | Add `QuantizeSettings` type |
| **MODIFY** | `src/clip/ClipBuilder.ts`       | Add `quantize()` method     |
| **MODIFY** | `src/compiler/pipeline/emit.ts` | Apply quantization in emit  |

---

## 5. API Design

```typescript
interface QuantizeSettings {
  grid: NoteDuration          // '4n', '8n', '16n', etc.
  strength?: number           // 0-1, default 1.0
  groove?: GrooveTemplate     // Optional groove template
  duration?: boolean          // Also quantize durations
}

// ClipBuilder
quantize(grid: NoteDuration, options?: Partial<QuantizeSettings>): this
```

---

## 6. Testing Strategy

```typescript
describe("Quantization", () => {
  it("snaps notes to 8th note grid", () => {
    const clip = Clip.melody()
      .quantize("8n")
      .note("C4", 0.48 as any) // Raw beat position
      .build();
    const result = compileClip(clip, { bpm: 120 });
    expect(result.events[0].startSeconds).toBeCloseTo(0.25); // 0.5 beats at 120bpm
  });

  it("applies partial quantization strength", () => {
    // 0.48 beats, grid 0.5, strength 0.5
    // Result: 0.48 + (0.5 - 0.48) * 0.5 = 0.49
  });
});
```

---

## 7. Approval

- [ ] Approved by maintainer
