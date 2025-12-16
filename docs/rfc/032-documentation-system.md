# RFC-029: Documentation System

**Status**: Draft  
**Priority**: High  
**Estimated Effort**: 3 days  
**Breaking Change**: None

---

## 1. Problem Statement

SymphonyScript has:

- ✅ Good README with examples
- ❌ No API reference documentation
- ❌ No searchable docs site
- ❌ No guides for common patterns

Users can't discover available methods without reading source code.

---

## 2. Requirements

| ID   | Requirement                                  | Priority  |
| ---- | -------------------------------------------- | --------- |
| FR-1 | API reference for all public classes/methods | Must Have |
| FR-2 | Guides for common patterns                   | Must Have |
| FR-3 | Searchable documentation site                | Should    |
| FR-4 | Auto-generated from TSDoc comments           | Should    |

---

## 3. Proposed Structure

```
docs/
├── README.md              # Points to sections
├── getting-started.md     # Quick start guide
├── api/
│   ├── clip-builder.md    # ClipBuilder API
│   ├── melody-builder.md  # MelodyBuilder API
│   ├── drum-builder.md    # DrumBuilder API
│   ├── session.md         # Session & Track API
│   ├── compiler.md        # Compiler options & output
│   └── types.md           # Core types reference
├── guides/
│   ├── modifiers.md       # Note modifiers (.staccato, .accent, etc.)
│   ├── loops-stacks.md    # Repetition & parallelism
│   ├── tempo-dynamics.md  # Tempo changes, crescendo, etc.
│   ├── chords-scales.md   # Chord/scale helpers
│   ├── humanize.md        # Humanization & groove
│   └── incremental.md     # Freeze & incremental compilation
└── examples/
    ├── simple-melody.md   # Hello world
    ├── drum-pattern.md    # Euclidean drums
    ├── chord-progression.md
    └── full-song.md       # Multi-track session
```

---

## 4. Documentation Style

### API Reference Format

```markdown
## MelodyBuilder.note()

Play a single note. Returns a cursor for applying modifiers.

### Signature

\`\`\`typescript
note(pitch: NoteName | string, duration?: NoteDuration): MelodyNoteCursor
\`\`\`

### Parameters

| Parameter | Type                 | Default | Description                    |
| --------- | -------------------- | ------- | ------------------------------ |
| pitch     | `NoteName \| string` | —       | Note pitch (e.g., 'C4', 'F#3') |
| duration  | `NoteDuration`       | `'4n'`  | Note duration                  |

### Returns

`MelodyNoteCursor` — Cursor for applying modifiers

### Example

\`\`\`typescript
Clip.melody()
.note('C4', '4n')
.note('E4').staccato()
.note('G4', '2n')
\`\`\`

### See Also

- [Modifiers Guide](../guides/modifiers.md)
- [MelodyNoteCursor](./melody-note-cursor.md)
```

---

## 5. Generation Strategy

Write docs manually with consistent format.

**Benefits:**

- Better narrative flow
- Custom examples per method
- No tooling setup
- Full control over organization

**Maintenance:**

- Update relevant `docs/api/*.md` after each RFC that changes public API
- Run periodic docs audit agent to catch drift
- Keep examples compilable (tested in CI)

---

## 6. Files to Create

| Path                      | Description                    |
| ------------------------- | ------------------------------ |
| `docs/README.md`          | Documentation index            |
| `docs/getting-started.md` | Quick start                    |
| `docs/api/*.md`           | API reference (6 files)        |
| `docs/guides/*.md`        | Pattern guides (6 files)       |
| `docs/examples/*.md`      | Example walkthroughs (4 files) |

---

## 7. Content Outline

### getting-started.md

1. Installation
2. Your First Clip
3. Compiling to Timeline
4. Playing (runtime links)

### api/melody-builder.md

1. Constructor
2. Note Operations (note, chord, arpeggio)
3. Modifiers (accessed via cursors)
4. Scale/Degree Methods
5. Dynamics (crescendo, decrescendo)
6. Transposition (transpose, octave)
7. Control (tempo, timeSignature)

### guides/modifiers.md

1. The Cursor Pattern
2. Articulations (staccato, accent, legato)
3. Expression (velocity, humanize)
4. Ties & Glides
5. Commit Rules

---

## 8. Approval

- [ ] Approved by maintainer
