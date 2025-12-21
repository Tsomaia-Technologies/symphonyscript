# RFC-027: Music Theory System

**Status**: Draft  
**Priority**: High  
**Estimated Effort**: 5+ days  
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

SymphonyScript lacks foundational music theory constructs:

- **No key signatures** — Can't define "this piece is in G major"
- **No chord progressions** — No `ii-V-I` or `I-IV-V-I` helpers
- **No voice leading** — No automatic smooth transitions between chords

Users must manually calculate every note, missing the "pick up a guitar" philosophy.

---

## 2. Requirements

| ID   | Requirement                                      | Priority  |
| ---- | ------------------------------------------------ | --------- |
| FR-1 | Key signature context with automatic accidentals | Must Have |
| FR-2 | Chord progression builder                        | Must Have |
| FR-3 | Voice leading hints/automation                   | Should    |
| FR-4 | Common progression presets (12-bar blues, etc.)  | Should    |

---

## 3. Proposed Solution

### 3.1 Key Signature Context

```typescript
Clip.melody()
  .key("G", "major") // F# is automatic
  .note("F4") // Compiler knows this is F#4
  .note("C4") // C natural
  .accidental("natural")
  .note("F4"); // Explicit F natural
```

**Implementation:**

- Add `KeyContext` to `MelodyParams`
- Modify note resolution to apply key signature
- Add `.accidental('sharp' | 'flat' | 'natural')` modifier

### 3.2 Chord Progressions

```typescript
Clip.melody()
  .key("C", "major")
  .progression("I", "IV", "V", "I") // Emits: Cmaj, Fmaj, Gmaj, Cmaj
  .progression("ii", "V", "I"); // Emits: Dm, G, C
```

**Implementation:**

- `progression(...numerals)` maps roman numerals to chords in key
- Duration defaults to 1 bar each, configurable
- Supports 7ths, inversions: `'V7'`, `'I/3'`

### 3.3 Voice Leading

```typescript
Clip.melody().key("C", "major").voiceLead(["I", "IV", "V", "I"], {
  voices: 4,
  style: "close", // or 'open', 'drop2'
});
```

**Implementation:**

- Analyze chord tones between adjacent chords
- Minimize voice movement (smallest interval transitions)
- Respect voice ranges (soprano, alto, tenor, bass)

---

## 4. Files to Modify/Create

| Action     | Path                         | Description                           |
| ---------- | ---------------------------- | ------------------------------------- |
| **ADD**    | `src/theory/keys.ts`         | Key signature definitions             |
| **ADD**    | `src/theory/progressions.ts` | Roman numeral → chord mapping         |
| **ADD**    | `src/theory/voiceleading.ts` | Voice leading algorithm               |
| **ADD**    | `src/theory/types.ts`        | KeyContext, ProgressionOptions        |
| **MODIFY** | `src/clip/MelodyBuilder.ts`  | Add key(), progression(), voiceLead() |
| **MODIFY** | `src/clip/types.ts`          | Add KeyContext to MelodyParams        |

---

## 5. Testing Strategy

```typescript
describe("Key Signatures", () => {
  it("applies sharps in G major", () => {
    const clip = Clip.melody().key("G", "major").note("F4").build();
    expect(firstNote(clip)).toBe("F#4");
  });

  it("respects explicit accidentals", () => {
    const clip = Clip.melody()
      .key("G", "major")
      .accidental("natural")
      .note("F4")
      .build();
    expect(firstNote(clip)).toBe("F4");
  });
});

describe("Chord Progressions", () => {
  it("maps roman numerals to chords", () => {
    const clip = Clip.melody()
      .key("C", "major")
      .progression("I", "IV", "V")
      .build();
    expect(chords(clip)).toEqual(["C", "F", "G"]);
  });
});
```

---

## 6. Approval

- [ ] Approved by maintainer
