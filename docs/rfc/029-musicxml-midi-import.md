# RFC-030: MusicXML & MIDI Import

**Status**: Draft  
**Priority**: High  
**Estimated Effort**: 5+ days  
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

SymphonyScript cannot load existing compositions:

- **No MIDI import** — Can't bring in existing MIDI files
- **No MusicXML import** — Can't import from notation software (Finale, Sibelius, MuseScore)

Users must recreate everything from scratch in code.

---

## 2. Design Philosophy

> **Import produces EDITABLE AST, not compiled output.**

```
MIDI/MusicXML → ClipNode / Session (AST) → Editable
                            ↓
                        Compile → Play
                            ↓
                        Export → MIDI/MusicXML
```

The value of import is:

1. **Reverse engineer** — See how a MIDI file translates to builder code
2. **Edit** — Modify operations, add humanization, change tempo
3. **Combine** — Merge imported clips with hand-coded ones
4. **Learn** — Analyze existing compositions as AST
5. **Round-trip** — Import → tweak → export back

---

## 3. Requirements

| ID   | Requirement                                      | Priority  |
| ---- | ------------------------------------------------ | --------- |
| FR-1 | Import Standard MIDI File (.mid) to `ClipNode`   | Must Have |
| FR-2 | Import MusicXML (.xml, .musicxml) to `ClipNode`  | Must Have |
| FR-3 | Preserve tempo/time signature changes            | Must Have |
| FR-4 | Import multi-track files to `Session`            | Should    |
| FR-5 | Round-trip: import → export → import = identical | Should    |
| FR-6 | Generate TypeScript builder code (`.toCode()`)   | Should    |

---

## 4. Proposed API

### 4.1 MIDI Import

```typescript
import { importMidi, importMidiFile } from "symphonyscript/import";

// From file path (Node.js)
const session = await importMidiFile("./song.mid");

// From ArrayBuffer (Browser)
const buffer = await fetch("./song.mid").then((r) => r.arrayBuffer());
const session = importMidi(buffer);

// Import options
const session = importMidi(buffer, {
  quantize: "16n", // Optional quantization
  velocityThreshold: 10, // Ignore notes below this
  mergeTracksByChannel: true, // Group by MIDI channel
});

// Result is EDITABLE AST
session.tracks[0].clip.operations; // Access operations
session.tracks[0].clip = modifiedClip; // Replace clip
```

### 4.2 MusicXML Import

```typescript
import { importMusicXML, importMusicXMLFile } from "symphonyscript/import";

// From file path (Node.js)
const session = await importMusicXMLFile("./score.musicxml");

// From string (Browser)
const xml = await fetch("./score.xml").then((r) => r.text());
const session = importMusicXML(xml);

// Import options
const session = importMusicXML(xml, {
  parts: ["P1", "P2"], // Only import specific parts
  measures: [1, 32], // Only import measure range
});
```

### 4.3 Code Generation (Killer Feature)

```typescript
import { importMidiFile } from "symphonyscript/import";
import { toCode } from "symphonyscript/codegen";

const session = await importMidiFile("./song.mid");

// Generate TypeScript builder code
const code = toCode(session);

console.log(code);
// Output:
// import { Clip, Session } from 'symphonyscript'
//
// const melody = Clip.melody('melody')
//   .tempo(120)
//   .timeSignature('4/4')
//   .note('C4', '4n').velocity(0.8)
//   .note('E4', '4n').staccato()
//   .note('G4', '2n')
//   .build()
//
// export const session = Session.create()
//   .track('Track 1', t => t.clip(melody))
//   .build()

// Write to file
await writeFile("./generated-song.ts", code);
```

---

## 5. MIDI Import Mapping

| MIDI Concept          | SymphonyScript Mapping             |
| --------------------- | ---------------------------------- |
| Note On/Off           | `NoteOp` with duration             |
| Velocity              | `NoteOp.velocity` (normalized 0-1) |
| Tempo (meta)          | `TempoOp`                          |
| Time Signature (meta) | `TimeSignatureOp`                  |
| Control Change        | `ControlOp`                        |
| Pitch Bend            | `PitchBendOp`                      |
| Channel Aftertouch    | `AftertouchOp`                     |
| Track                 | `Track` in Session                 |

---

## 6. MusicXML Import Mapping

| MusicXML Element               | SymphonyScript Mapping            |
| ------------------------------ | --------------------------------- |
| `<note>`                       | `NoteOp`                          |
| `<rest>`                       | `RestOp`                          |
| `<chord>`                      | `StackOp` with NoteOps            |
| `<forward>/<backup>`           | Time position adjustment          |
| `<direction type="dynamics">`  | `DynamicsOp`                      |
| `<direction type="metronome">` | `TempoOp`                         |
| `<attributes><time>`           | `TimeSignatureOp`                 |
| `<attributes><key>`            | `KeyContext` (RFC-027)            |
| `<part>`                       | `Track` in Session                |
| `<tied>`                       | `NoteOp.tie`                      |
| `<slur>`                       | `NoteOp.articulation: 'legato'`   |
| `<staccato>`                   | `NoteOp.articulation: 'staccato'` |

---

## 7. Files to Create

| Path                     | Description                 |
| ------------------------ | --------------------------- |
| `src/import/midi.ts`     | MIDI file parser → ClipNode |
| `src/import/musicxml.ts` | MusicXML parser → ClipNode  |
| `src/import/types.ts`    | Import options types        |
| `src/import/index.ts`    | Public exports              |
| `src/codegen/toCode.ts`  | ClipNode → TypeScript code  |
| `src/codegen/index.ts`   | Codegen exports             |

---

## 8. Dependencies

### MIDI Parsing

- Use `midi-file` npm package (lightweight, well-tested)
- Or implement minimal SMF parser (no deps)

### MusicXML Parsing

- Use built-in `DOMParser` (browser) / `fast-xml-parser` (Node)
- No heavy dependencies

---

## 9. Testing Strategy

```typescript
describe("MIDI Import", () => {
  it("imports notes as ClipNode operations", async () => {
    const session = await importMidiFile("./fixtures/simple.mid");
    const clip = session.tracks[0].clip;
    expect(clip.operations).toHaveLength(4);
    expect(clip.operations[0].kind).toBe("note");
  });

  it("produces editable AST", async () => {
    const session = await importMidiFile("./fixtures/simple.mid");
    const clip = session.tracks[0].clip;

    // Modify the imported clip
    clip.operations.push({ kind: "rest", duration: "4n" });

    // Compile and verify
    const result = compileClip(clip, { bpm: 120 });
    expect(result.events.length).toBeGreaterThan(4);
  });
});

describe("Code Generation", () => {
  it("generates valid TypeScript", async () => {
    const session = await importMidiFile("./fixtures/simple.mid");
    const code = toCode(session);

    expect(code).toContain("Clip.melody");
    expect(code).toContain(".note('C4'");
    expect(code).toContain(".build()");
  });
});
```

---

## 10. Approval

- [ ] Approved by maintainer
