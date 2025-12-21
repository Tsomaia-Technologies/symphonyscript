# RFC-015: Hierarchical Tempo Inheritance

**Status**: Draft
**Priority**: Medium
**Estimated Effort**: 1 day
**Breaking Change**: Yes (removes `compile(session, bpm)` signature)

---

## 1. Problem Statement

Currently, tempo is set in two disconnected places:

```typescript
// Clip-level tempo changes
Clip.melody().tempo(140).note("C4");

// Compiler-level default tempo
compile(session, 120); // ← Disconnected from musical structure
```

This is problematic:

1. **Tempo is a compile option, not a musical property** — Feels like a technical detail rather than composition
2. **No track-level defaults** — Can't set a default tempo for all clips in a track
3. **No session-level defaults** — Can't set a project-wide tempo
4. **Inconsistent API** — Tempo is both a builder method and a compiler option

---

## 2. Proposed Solution

### 2.1 Hierarchy (Clip → Track → Session → Global Default)

```typescript
// Session-level tempo (new)
const s = session({ tempo: 140 })
  .add(Track.from(clip1, instrument)) // Inherits 140 BPM
  .add(Track.from(clip2, instrument, { tempo: 120 })); // Overrides to 120

// Track-level tempo (new)
Track.from(clip, instrument, { tempo: 160 });

// Clip-level tempo (existing)
Clip.melody().tempo(180).note("C4");

// Compilation (simplified)
compile(s); // No BPM argument needed
```

### 2.2 Resolution Order

1. **Clip tempo operations** (`.tempo()`, `.tempoRamp()`) — highest priority
2. **Track options** (`Track.from(clip, inst, { tempo: 120 })`)
3. **Session options** (`session({ tempo: 140 })`)
4. **Global default** (120 BPM)

---

## 3. API Changes

### 3.1 Session Constructor

```typescript
// Before
session()

// After
session(options?: { tempo?: number })
```

### 3.2 Track Constructor

```typescript
// Before
Track.from(clip: ClipNode, instrument: Instrument)

// After
Track.from(
  clip: ClipNode,
  instrument: Instrument,
  options?: { tempo?: number }
)
```

### 3.3 Compile Function

```typescript
// Before (DEPRECATED)
compile(session: SessionNode, bpm: number)
compile(session: SessionNode, options: { bpm: number, seed?: number })

// After
compile(session: SessionNode, options?: { seed?: number })
```

**Migration**: Support old signature with deprecation warning for 1-2 versions.

---

## 4. Implementation

### 4.1 Type Changes

```typescript
// src/types/session.ts
export interface SessionNode {
  kind: "session";
  tracks: TrackNode[];
  tempo?: number; // NEW
}

// src/types/track.ts
export interface TrackNode {
  kind: "track";
  clip: ClipNode;
  instrument: Instrument;
  tempo?: number; // NEW
}
```

### 4.2 Tempo Resolution Logic

```typescript
// src/compiler/tempo-resolver.ts (NEW)

export function resolveInitialTempo(
  session: SessionNode,
  track: TrackNode,
  clip: ClipNode
): number {
  // Check for clip-level tempo operation at start
  const firstOp = clip.operations[0];
  if (firstOp?.kind === "tempo") {
    return firstOp.bpm;
  }

  // Check track-level tempo
  if (track.tempo !== undefined) {
    return track.tempo;
  }

  // Check session-level tempo
  if (session.tempo !== undefined) {
    return session.tempo;
  }

  // Global default
  return 120;
}
```

### 4.3 Compiler Integration

```typescript
// src/compiler/index.ts

export function compile(
  session: SessionNode,
  optionsOrBpm?: number | { seed?: number }
): CompilerOutput {
  // Handle deprecated signature
  if (typeof optionsOrBpm === "number") {
    console.warn(
      "compile(session, bpm) is deprecated. Use session({ tempo: bpm }) instead."
    );
    // Override session tempo for backward compatibility
    session = { ...session, tempo: optionsOrBpm };
  }

  const options = typeof optionsOrBpm === "object" ? optionsOrBpm : {};

  // ... rest of compilation
}
```

---

## 5. Migration Guide

### Before

```typescript
const s = session().add(Track.from(clip1, synth)).add(Track.from(clip2, bass));

compile(s, 140);
```

### After

```typescript
const s = session({ tempo: 140 })
  .add(Track.from(clip1, synth))
  .add(Track.from(clip2, bass));

compile(s);
```

### Mixed Tempos

```typescript
const s = session({ tempo: 120 })
  .add(Track.from(slowClip, synth)) // 120 BPM
  .add(Track.from(fastClip, bass, { tempo: 160 })); // 160 BPM
```

---

## 6. Edge Cases

### 6.1 Multiple Tracks, Different Tempos

**Allowed** — Each track resolves its own tempo independently. Clips with tempo changes create tempo events in the timeline.

### 6.2 Tempo Ramps Across Tracks

If Track A has a tempo ramp from 120→140, and Track B has no tempo operations, Track B stays at its resolved initial tempo (doesn't follow Track A's ramp).

**Future enhancement**: Global tempo automation that affects all tracks.

### 6.3 Empty Clip

If a clip has no operations and no tempo set, it inherits from track/session/default.

---

## 7. Testing Strategy

```typescript
describe("Hierarchical Tempo", () => {
  it("uses global default (120) when nothing set", () => {
    const s = session().add(Track.from(emptyClip, synth));
    const { output } = compile(s);
    expect(output.manifest.tempo).toBe(120);
  });

  it("uses session tempo", () => {
    const s = session({ tempo: 140 }).add(Track.from(clip, synth));
    const { output } = compile(s);
    expect(output.manifest.tempo).toBe(140);
  });

  it("track tempo overrides session tempo", () => {
    const s = session({ tempo: 140 }).add(
      Track.from(clip, synth, { tempo: 160 })
    );
    // Verify track starts at 160
  });

  it("clip tempo overrides track tempo", () => {
    const clip = Clip.melody().tempo(180).note("C4").build();
    const s = session({ tempo: 140 }).add(
      Track.from(clip, synth, { tempo: 160 })
    );
    // Verify clip uses 180
  });

  it("supports deprecated compile(session, bpm) with warning", () => {
    const spy = jest.spyOn(console, "warn");
    compile(session(), 130);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
  });
});
```

---

## 8. Files to Modify

| Action     | Path                             | Description                                       |
| ---------- | -------------------------------- | ------------------------------------------------- |
| **MODIFY** | `src/types/session.ts`           | Add `tempo?: number` to `SessionNode`             |
| **MODIFY** | `src/types/track.ts`             | Add `tempo?: number` to `TrackNode`               |
| **MODIFY** | `src/session.ts`                 | Update `session()` to accept options              |
| **MODIFY** | `src/track.ts`                   | Update `Track.from()` to accept options           |
| **NEW**    | `src/compiler/tempo-resolver.ts` | Tempo resolution logic                            |
| **MODIFY** | `src/compiler/index.ts`          | Integrate tempo resolver, deprecate old signature |
| **MODIFY** | `src/__tests__/tempo.test.ts`    | Add hierarchy tests                               |

---

## 9. Approval

- [ ] Approved by maintainer
