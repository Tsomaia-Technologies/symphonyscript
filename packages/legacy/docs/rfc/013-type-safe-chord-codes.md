# RFC-013: Type-Safe Chord Codes

**Status**: Draft
**Priority**: High
**Estimated Effort**: 1-2 days
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

Currently, chords are defined using explicit note arrays:

```typescript
.chord(['C4', 'E4', 'G4'], '8n')  // C major
.chord(['A4', 'C5', 'E5'], '4n')  // A minor
```

This approach has limitations:

1. **Verbose** – Users must know and type each note manually.
2. **Error-prone** – Easy to get intervals wrong (e.g., `['C4', 'E#4', 'G4']` instead of `['C4', 'E4', 'G4']`).
3. **No abstraction** – Common chord qualities (major, minor, diminished, etc.) aren't reusable.
4. **Octave ambiguity** – Mixing octaves (`['A4', 'G', 'F']`) is allowed but risky.

### Desired API

```typescript
// New signature (additive)
.chord('Cmaj', 4, '8n')   // C major in octave 4
.chord('Am7', 3, '4n')    // A minor 7th in octave 3
.chord('Gdim7', 5, '2n')  // G diminished 7th in octave 5

// Existing signature (preserved)
.chord(['C4', 'E4', 'G4'], '8n')
```

---

## 2. Requirements

### 2.1 Functional Requirements

| ID   | Requirement                                                     | Priority     |
| ---- | --------------------------------------------------------------- | ------------ |
| FR-1 | `.chord()` MUST support chord symbol syntax (e.g., `'Cmaj7'`)   | Must Have    |
| FR-2 | Chord symbols MUST be type-safe (union of valid codes)          | Must Have    |
| FR-3 | All chords from provided CSV MUST be supported                  | Must Have    |
| FR-4 | Alternative codes (`CM7`, `CΔ7`) MUST resolve to same intervals | Must Have    |
| FR-5 | Octave parameter MUST control bass note octave                  | Must Have    |
| FR-6 | Existing `chord(NoteName[], duration)` signature MUST remain    | Must Have    |
| FR-7 | Invalid chord codes MUST produce compile-time errors            | Should Have  |
| FR-8 | Support inversions via options (e.g., `{ inversion: 1 }`)       | Nice to Have |

### 2.2 Non-Functional Requirements

| ID    | Requirement                                       |
| ----- | ------------------------------------------------- |
| NFR-1 | Minimal runtime overhead (intervals pre-computed) |
| NFR-2 | Tree-shakeable (unused chords not bundled)        |
| NFR-3 | IDE autocomplete for chord codes                  |

---

## 3. Chord Definitions (from CSV)

| Category   | Quality Name        | Primary Code | Alternative Codes | Interval Formula        | Notes (C Root)        |
| ---------- | ------------------- | ------------ | ----------------- | ----------------------- | --------------------- |
| Major      | Major Triad         | C            | Cmaj; CM          | 1-3-5                   | C-E-G                 |
| Major      | Major Seventh       | Cmaj7        | CM7; CΔ; CΔ7      | 1-3-5-7                 | C-E-G-B               |
| Major      | Major Sixth         | C6           | CM6               | 1-3-5-6                 | C-E-G-A               |
| Major      | Six-Nine            | C6/9         | C69; C6add9       | 1-3-5-6-9               | C-E-G-A-D             |
| Major      | Major Ninth         | Cmaj9        | CM9; CΔ9          | 1-3-5-7-9               | C-E-G-B-D             |
| Major      | Major Eleventh      | Cmaj11       | CM11; CΔ11        | 1-3-5-7-9-11            | C-E-G-B-D-F           |
| Major      | Major Thirteenth    | Cmaj13       | CM13; CΔ13        | 1-3-5-7-9-11-13         | C-E-G-B-D-F-A         |
| Major      | Add Nine            | Cadd9        | Cadd2             | 1-3-5-9                 | C-E-G-D               |
| Minor      | Minor Triad         | Cm           | C-; Cmin          | 1-b3-5                  | C-Eb-G                |
| Minor      | Minor Seventh       | Cm7          | C-7; Cmin7        | 1-b3-5-b7               | C-Eb-G-Bb             |
| Minor      | Minor Sixth         | Cm6          | C-6; Cmin6        | 1-b3-5-6                | C-Eb-G-A              |
| Minor      | Minor Ninth         | Cm9          | C-9; Cmin9        | 1-b3-5-b7-9             | C-Eb-G-Bb-D           |
| Minor      | Minor Eleventh      | Cm11         | C-11; Cmin11      | 1-b3-5-b7-9-11          | C-Eb-G-Bb-D-F         |
| Minor      | Minor Thirteenth    | Cm13         | C-13; Cmin13      | 1-b3-5-b7-9-11-13       | C-Eb-G-Bb-D-F-A       |
| Minor      | Minor Major Seventh | Cm(maj7)     | C-Δ7; Cmin(maj7)  | 1-b3-5-7                | C-Eb-G-B              |
| Dominant   | Dominant Seventh    | C7           | Cdom7             | 1-3-5-b7                | C-E-G-Bb              |
| Dominant   | Dominant Ninth      | C9           | Cdom9             | 1-3-5-b7-9              | C-E-G-Bb-D            |
| Dominant   | Dominant Eleventh   | C11          | Cdom11            | 1-3-5-b7-9-11           | C-E-G-Bb-D-F          |
| Dominant   | Dominant Thirteenth | C13          | Cdom13            | 1-3-5-b7-9-13           | C-E-G-Bb-D-A          |
| Dominant   | Seven Sus Four      | C7sus4       | C7sus             | 1-4-5-b7                | C-F-G-Bb              |
| Dominant   | Nine Sus Four       | C9sus4       | C9sus             | 1-4-5-b7-9              | C-F-G-Bb-D            |
| Suspended  | Suspended Fourth    | Csus4        | Csus              | 1-4-5                   | C-F-G                 |
| Suspended  | Suspended Second    | Csus2        | C2                | 1-2-5                   | C-D-G                 |
| Power      | Power Chord         | C5           | C(no3)            | 1-5                     | C-G                   |
| Diminished | Diminished Triad    | Cdim         | C°                | 1-b3-b5                 | C-Eb-Gb               |
| Diminished | Diminished Seventh  | Cdim7        | C°7               | 1-b3-b5-bb7             | C-Eb-Gb-A             |
| Diminished | Half-Diminished 7th | Cm7b5        | Cø; Cø7           | 1-b3-b5-b7              | C-Eb-Gb-Bb            |
| Augmented  | Augmented Triad     | Caug         | C+                | 1-3-#5                  | C-E-G#                |
| Augmented  | Augmented Seventh   | Caug7        | C+7; C7#5         | 1-3-#5-b7               | C-E-G#-Bb             |
| Augmented  | Augmented Major 7th | Cmaj7#5      | CΔ+; CΔ#5         | 1-3-#5-7                | C-E-G#-B              |
| Altered    | Seven Flat Nine     | C7b9         | C7-9              | 1-3-5-b7-b9             | C-E-G-Bb-Db           |
| Altered    | Seven Sharp Nine    | C7#9         | C7+9              | 1-3-5-b7-#9             | C-E-G-Bb-D#           |
| Altered    | Seven Flat Five     | C7b5         | C7-5              | 1-3-b5-b7               | C-E-Gb-Bb             |
| Altered    | Altered Dominant    | C7alt        | C7alt             | 1-3-b5-b7-b9-#9-#11-b13 | C-E-Gb-Bb-Db-D#-F#-Ab |

---

## 4. Proposed Solution

### 4.1 Architecture

```
src/
├── chords/
│   ├── index.ts          # Exports
│   ├── types.ts          # ChordQuality, ChordCode types
│   ├── definitions.ts    # CHORD_DEFINITIONS constant
│   ├── parser.ts         # parseChordCode() function
│   └── resolver.ts       # chordToNotes() function
```

### 4.2 Type Definitions

```typescript
// src/chords/types.ts

/** Chord quality identifier */
export type ChordQuality =
  | "maj"
  | "maj7"
  | "6"
  | "6/9"
  | "maj9"
  | "maj11"
  | "maj13"
  | "add9"
  | "m"
  | "m7"
  | "m6"
  | "m9"
  | "m11"
  | "m13"
  | "m(maj7)"
  | "7"
  | "9"
  | "11"
  | "13"
  | "7sus4"
  | "9sus4"
  | "sus4"
  | "sus2"
  | "5"
  | "dim"
  | "dim7"
  | "m7b5"
  | "aug"
  | "aug7"
  | "maj7#5"
  | "7b9"
  | "7#9"
  | "7b5"
  | "7alt";

/** Root note (no octave) */
export type ChordRoot =
  | "C"
  | "C#"
  | "Db"
  | "D"
  | "D#"
  | "Eb"
  | "E"
  | "F"
  | "F#"
  | "Gb"
  | "G"
  | "G#"
  | "Ab"
  | "A"
  | "A#"
  | "Bb"
  | "B";

/** Chord definition with intervals */
export interface ChordDefinition {
  quality: ChordQuality;
  name: string;
  primaryCode: string;
  altCodes: string[];
  intervals: number[]; // Semitones from root
}
```

### 4.3 Interval Mapping

Intervals are pre-computed as semitones from root:

| Interval | Semitones |
| -------- | --------- |
| 1 (root) | 0         |
| 2        | 2         |
| b3       | 3         |
| 3        | 4         |
| 4        | 5         |
| b5       | 6         |
| 5        | 7         |
| #5       | 8         |
| 6        | 9         |
| bb7      | 9         |
| b7       | 10        |
| 7        | 11        |
| b9       | 13        |
| 9        | 14        |
| #9       | 15        |
| 11       | 17        |
| #11      | 18        |
| b13      | 20        |
| 13       | 21        |

### 4.4 Updated MelodyBuilder

```typescript
// Method overloads
chord(pitches: NoteName[], duration?: NoteDuration): MelodyNoteCursor;
chord(code: ChordCode, octave: number, duration?: NoteDuration, options?: ChordOptions): MelodyNoteCursor;
```

---

## 5. Files to Create/Modify

| Action     | Path                        | Description               |
| ---------- | --------------------------- | ------------------------- |
| **NEW**    | `src/chords/types.ts`       | Type definitions          |
| **NEW**    | `src/chords/definitions.ts` | Chord interval data       |
| **NEW**    | `src/chords/parser.ts`      | Parse chord codes         |
| **NEW**    | `src/chords/resolver.ts`    | Resolve to notes          |
| **NEW**    | `src/chords/index.ts`       | Public exports            |
| **MODIFY** | `src/clip/MelodyBuilder.ts` | Add overload to `chord()` |
| **MODIFY** | `src/clip/capabilities.ts`  | Update `HasPitch.chord`   |
| **MODIFY** | `src/index.ts`              | Export chord utilities    |

---

## 6. Testing Strategy

```typescript
describe("Chord Parser", () => {
  it("parses major triad", () => {
    expect(parseChordCode("C")).toEqual({
      root: "C",
      quality: "maj",
      intervals: [0, 4, 7],
    });
  });
  it("parses alternative codes", () => {
    expect(parseChordCode("AM7")).toEqual({
      root: "A",
      quality: "maj7",
      intervals: [0, 4, 7, 11],
    });
  });
});

describe("Chord Resolver", () => {
  it("resolves C major in octave 4", () => {
    expect(chordToNotes("C", 4)).toEqual(["C4", "E4", "G4"]);
  });
  it("applies inversion", () => {
    expect(chordToNotes("C", 4, { inversion: 1 })).toEqual(["E4", "G4", "C5"]);
  });
});
```

---

## 7. Migration

**No breaking changes.** Existing `chord(NoteName[], duration)` continues to work.

---

## 8. Risks & Mitigations

| Risk                      | Mitigation                                     |
| ------------------------- | ---------------------------------------------- |
| Large type union          | Generate minimal union; benchmark compile time |
| Unicode symbols (Δ, °, ø) | Support as alt codes; primary codes ASCII-only |

---

## Approval

- [ ] Approved by maintainer
