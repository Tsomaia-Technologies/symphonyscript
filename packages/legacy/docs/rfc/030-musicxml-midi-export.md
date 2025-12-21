# RFC-031: MusicXML & MIDI Export

**Status**: Draft  
**Priority**: High  
**Estimated Effort**: 4 days  
**Breaking Change**: None (additive API)

---

## 1. Problem Statement

SymphonyScript compiles to a runtime-agnostic JSON timeline, but:

- **No MIDI export** — Can't send to DAWs (Ableton, Logic, FL Studio)
- **No MusicXML export** — Can't send to notation software

Users are locked into SymphonyScript's ecosystem.

---

## 2. Requirements

| ID   | Requirement                                      | Priority  |
| ---- | ------------------------------------------------ | --------- |
| FR-1 | Export CompiledClip to Standard MIDI File (.mid) | Must Have |
| FR-2 | Export Session to multi-track MIDI               | Must Have |
| FR-3 | Export ClipNode to MusicXML                      | Should    |
| FR-4 | Export Session to MusicXML with parts/staves     | Should    |
| FR-5 | Round-trip: export → import = identical          | Should    |

---

## 3. Proposed API

### 3.1 MIDI Export

```typescript
import { exportMidi, exportMidiFile } from "symphonyscript/export";

// Compile first, then export
const { output } = compile(session, { bpm: 120 });

// To ArrayBuffer (works in browser and Node)
const midiBuffer = exportMidi(output);

// To file (Node.js)
await exportMidiFile(output, "./song.mid");

// Export options
const buffer = exportMidi(output, {
  format: 1, // MIDI format (0 = single track, 1 = multi-track)
  ppq: 480, // Pulses per quarter note
  includeTempoTrack: true, // Separate track for tempo/time sig
});
```

### 3.2 MusicXML Export

```typescript
import { exportMusicXML, exportMusicXMLFile } from "symphonyscript/export";

// From ClipNode (uncompiled)
const xml = exportMusicXML(clip);

// From Session
const xml = exportMusicXML(session);

// To file
await exportMusicXMLFile(session, "./score.musicxml");

// Export options
const xml = exportMusicXML(session, {
  partNames: { track1: "Piano", track2: "Bass" },
  creator: "SymphonyScript",
  title: "My Song",
});
```

---

## 4. MIDI Export Mapping

| SymphonyScript     | MIDI Output               |
| ------------------ | ------------------------- |
| `note` event       | Note On + Note Off        |
| `velocity`         | Note On velocity (0-127)  |
| `tempo` event      | Tempo meta event          |
| `time_signature`   | Time Signature meta event |
| `control` event    | Control Change            |
| `pitch_bend` event | Pitch Bend                |
| `aftertouch` event | Channel/Poly Aftertouch   |
| Track              | MIDI Track                |

---

## 5. MusicXML Export Mapping

| SymphonyScript        | MusicXML Output                       |
| --------------------- | ------------------------------------- |
| `NoteOp`              | `<note>` with `<pitch>`, `<duration>` |
| `RestOp`              | `<note><rest/>`                       |
| `StackOp`             | `<note>` with `<chord/>` markers      |
| `TempoOp`             | `<direction><metronome>`              |
| `TimeSignatureOp`     | `<attributes><time>`                  |
| `NoteOp.tie`          | `<tie>`, `<tied>`                     |
| `NoteOp.articulation` | `<articulations>`                     |
| Session Track         | `<part>` with `<part-name>`           |

---

## 6. Files to Create

| Path                     | Description          |
| ------------------------ | -------------------- |
| `src/export/midi.ts`     | MIDI file writer     |
| `src/export/musicxml.ts` | MusicXML generator   |
| `src/export/types.ts`    | Export options types |
| `src/export/index.ts`    | Public exports       |

---

## 7. MIDI Format Details

### Standard MIDI File Structure

```
Header Chunk (MThd)
├── Format: 0 (single track) or 1 (multi-track)
├── Number of tracks
└── Division (PPQ)

Track Chunks (MTrk)
├── Delta time + Event pairs
├── Meta events (tempo, time sig, track name)
└── End of Track event
```

### Delta Time Calculation

```typescript
function secondsToDeltaTicks(
  seconds: number,
  bpm: number,
  ppq: number
): number {
  const beatsPerSecond = bpm / 60;
  const beats = seconds * beatsPerSecond;
  return Math.round(beats * ppq);
}
```

---

## 8. Testing Strategy

```typescript
describe("MIDI Export", () => {
  it("exports notes with correct timing", () => {
    const clip = Clip.melody().note("C4", "4n").note("E4", "4n").build();
    const { output } = compile(clip, { bpm: 120 });
    const midi = exportMidi(output);

    // Parse back and verify
    const parsed = parseMidi(midi);
    expect(parsed.tracks[0].length).toBe(4); // 2 note on + 2 note off
  });

  it("preserves tempo changes", () => {
    const clip = Clip.melody()
      .tempo(120)
      .note("C4")
      .tempo(140)
      .note("D4")
      .build();
    const { output } = compile(clip, { bpm: 120 });
    const midi = exportMidi(output);

    const parsed = parseMidi(midi);
    const tempoEvents = parsed.tracks[0].filter((e) => e.type === "setTempo");
    expect(tempoEvents).toHaveLength(2);
  });
});

describe("MusicXML Export", () => {
  it("generates valid MusicXML", () => {
    const clip = Clip.melody().note("C4", "4n").build();
    const xml = exportMusicXML(clip);

    // Validate against MusicXML schema
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<pitch><step>C</step><octave>4</octave></pitch>");
  });
});

describe("Round Trip", () => {
  it("import → export → import preserves notes", async () => {
    const original = await importMidiFile("./fixtures/simple.mid");
    const exported = exportMidi(compile(original).output);
    const reimported = importMidi(exported);

    expect(noteCount(reimported)).toBe(noteCount(original));
  });
});
```

---

## 9. Approval

- [ ] Approved by maintainer
