# RFC-014: Octave Control Methods

**Status**: Draft
**Priority**: Medium
**Estimated Effort**: 0.5 days
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

Currently, to shift notes by octaves, users must calculate semitones manually:

```typescript
.transpose(12)   // Up one octave
.transpose(-24)  // Down two octaves
```

This is:

1. **Error-prone** — Easy to miscalculate (12 vs 11)
2. **Less readable** — Intent not immediately clear
3. **No absolute control** — Can't simply say "play in octave 5"

### Desired API

```typescript
// Relative shifts
.octaveUp(1)     // Up one octave
.octaveDown(2)   // Down two octaves

// Absolute setting
.octave(5)       // Play in octave 5 (C4 → C5)
.octave(3)       // Play in octave 3 (C4 → C3)
```

---

## 2. Requirements

### 2.1 Functional Requirements

| ID   | Requirement                                                 | Priority  |
| ---- | ----------------------------------------------------------- | --------- |
| FR-1 | `octaveUp(n)` MUST shift by `+n * 12` semitones             | Must Have |
| FR-2 | `octaveDown(n)` MUST shift by `-n * 12` semitones           | Must Have |
| FR-3 | `octave(n)` MUST set absolute octave (relative to octave 4) | Must Have |
| FR-4 | All methods MUST be cumulative in transposition context     | Must Have |
| FR-5 | All methods MUST validate range                             | Must Have |
| FR-6 | All methods MUST be chainable                               | Must Have |

---

## 3. Proposed Solution

### 3.1 Implementation

```typescript
// src/clip/MelodyBuilder.ts

/**
 * Set absolute octave register.
 * Octave 4 is neutral (no transposition).
 * @param n Target octave (0-9)
 */
octave(n: number): this {
  validate.inRange('octave', 'octave', n, 0, 9)
  const semitones = (n - 4) * 12
  return this._withParams({
    transposition: semitones
  } as unknown as ParamUpdater<P>)
}

/**
 * Shift up by n octaves.
 */
octaveUp(n: number = 1): this {
  validate.inRange('octaveUp', 'octaves', n, 0, 10)
  return this.transpose(n * 12)
}

/**
 * Shift down by n octaves.
 */
octaveDown(n: number = 1): this {
  validate.inRange('octaveDown', 'octaves', n, 0, 10)
  return this.transpose(-n * 12)
}
```

### 3.2 Behavior Examples

| Method                              | Written Note | Result | Transposition Applied |
| ----------------------------------- | ------------ | ------ | --------------------- |
| `.octave(5).note('C4')`             | C4           | C5     | +12                   |
| `.octave(3).note('C4')`             | C4           | C3     | -12                   |
| `.octave(4).note('C4')`             | C4           | C4     | 0                     |
| `.octaveUp(1).note('C4')`           | C4           | C5     | +12                   |
| `.octaveDown(2).note('C4')`         | C4           | C2     | -24                   |
| `.octave(5).octaveUp(1).note('C4')` | C4           | C6     | +24                   |

---

## 4. Files to Modify

| Action     | Path                                   | Description                                  |
| ---------- | -------------------------------------- | -------------------------------------------- |
| **MODIFY** | `src/clip/MelodyBuilder.ts`            | Add `octave()`, `octaveUp()`, `octaveDown()` |
| **MODIFY** | `src/clip/capabilities.ts`             | Add to `HasTransposition` interface          |
| **MODIFY** | `src/clip/cursors/MelodyNoteCursor.ts` | Add cursor escapes                           |
| **MODIFY** | `src/__tests__/modifiers.test.ts`      | Add tests                                    |

---

## 5. Testing Strategy

```typescript
describe("Octave Control", () => {
  it("octave(5) shifts C4 to C5", () => {
    const clip = Clip.melody().octave(5).note("C4", "4n").build();
    expect(notes[0]).toBe("C5");
  });

  it("octave(3) shifts C4 to C3", () => {
    const clip = Clip.melody().octave(3).note("C4", "4n").build();
    expect(notes[0]).toBe("C3");
  });

  it("octaveUp(1) shifts by +12 semitones", () => {
    const clip = Clip.melody().octaveUp(1).note("C4", "4n").build();
    expect(notes[0]).toBe("C5");
  });

  it("octaveDown(2) shifts by -24 semitones", () => {
    const clip = Clip.melody().octaveDown(2).note("C4", "4n").build();
    expect(notes[0]).toBe("C2");
  });

  it("octave + octaveUp are cumulative", () => {
    const clip = Clip.melody().octave(5).octaveUp(1).note("C4", "4n").build();
    expect(notes[0]).toBe("C6");
  });

  it("validates octave range", () => {
    expect(() => Clip.melody().octave(-1)).toThrow();
    expect(() => Clip.melody().octave(10)).toThrow();
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
