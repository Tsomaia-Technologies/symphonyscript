# RFC-026: Event Sourcing Compiler Architecture

**Status**: Draft (Exploratory)  
**Priority**: Low (Future Architecture)  
**Estimated Effort**: 10+ days (Major Refactor)  
**Breaking Change**: Internal only (same output)

---

## 1. Problem Statement

The current four-phase pipeline has structural inefficiencies:

```
Expand → Timing → Coalesce → Emit
```

**Issues**:

| Phase    | Problem                                                              |
| -------- | -------------------------------------------------------------------- |
| Expand   | Creates full intermediate representation even for unchanged sections |
| Timing   | Traverses entire sequence to compute beat positions                  |
| Coalesce | Requires re-sorting after tie merging (line 150)                     |
| Emit     | Third full traversal to generate events                              |

**Total**: 3-4 full traversals of the operation list.

For incremental compilation (hot-reload, live coding), unchanged sections are wastefully reprocessed.

---

## 2. Goals

| ID  | Goal                                                              | Priority  |
| --- | ----------------------------------------------------------------- | --------- |
| G-1 | Single-pass materialization                                       | Must Have |
| G-2 | Support incremental compilation of changed sections only          | Should    |
| G-3 | Maintain identical output for identical input                     | Must Have |
| G-4 | Enable future projections (effects, MPE) without pipeline changes | Should    |

---

## 3. Event Sourcing Model

### 3.1 Core Concept

Treat `ClipOperation[]` as an **event log**. Instead of eager transformation, apply **projections** lazily:

```
ClipOperation[] (Source of Truth)
       │
       ▼
┌─────────────────────────────────────────┐
│           Projection Pipeline           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ Time    │  │ Tempo   │  │ Tie     │  │
│  │ Project │─▶│ Project │─▶│ Project │  │
│  └─────────┘  └─────────┘  └─────────┘  │
└─────────────────────────────────────────┘
       │
       ▼
   CompiledEvent[] (Materialized View)
```

### 3.2 Projection Interface

```typescript
// src/compiler/projections/types.ts

interface ProjectionContext<S> {
  state: S;
  beat: number;
  bpm: number;
  // ... other contextual data
}

interface Projection<S, I, O> {
  name: string;
  initialState: S;

  /**
   * Process one input, produce zero or more outputs.
   * Pure function. No side effects.
   */
  project(
    input: I,
    ctx: ProjectionContext<S>
  ): {
    outputs: O[];
    nextState: S;
    advanceBeats: number;
  };
}
```

### 3.3 Built-in Projections

| Projection         | Input           | Output          | State                   |
| ------------------ | --------------- | --------------- | ----------------------- |
| `ExpandProjection` | `ClipOperation` | `FlatOp[]`      | Loop counters, depth    |
| `TimeProjection`   | `FlatOp`        | `TimedOp`       | Current beat, measure   |
| `TempoProjection`  | `TimedOp`       | `TimedOp`       | BPM, tempo map          |
| `TieProjection`    | `TimedOp`       | `TimedOp`       | Active ties map         |
| `EmitProjection`   | `TimedOp`       | `CompiledEvent` | Transposition, dynamics |

---

## 4. Pipeline Composition

### 4.1 Lazy Composition

```typescript
// src/compiler/pipeline.ts

function createPipeline<I, O>(
  ...projections: Projection<any, any, any>[]
): (source: Iterator<I>) => Iterator<O> {
  return function* (source) {
    let pipeline = source

    for (const proj of projections) {
      pipeline = applyProjection(pipeline, proj)
    }

    yield* pipeline
  }
}

function* applyProjection<S, I, O>(
  source: Iterator<I>,
  projection: Projection<S, I, O>
): Iterator<O> {
  let state = projection.initialState
  let beat = 0

  for (const input of source) {
    const result = projection.project(input, { state, beat, ... })
    state = result.nextState
    beat += result.advanceBeats
    yield* result.outputs
  }
}
```

### 4.2 Single-Pass Compilation

```typescript
export function compile(clip: ClipNode, options: Options): CompiledClip {
  const pipeline = createPipeline(
    expandProjection(options.limits),
    timeProjection(options.timeSignature),
    tempoProjection(options.bpm),
    tieProjection(),
    emitProjection(options)
  )

  // Single iteration through the source
  const events = [...pipeline(clip.operations[Symbol.iterator]())]

  return { events, ... }
}
```

---

## 5. Incremental Compilation Strategy

### 5.1 Change Detection

Track content hashes per clip section:

```typescript
interface ClipSection {
  hash: string;
  startBeat: number;
  endBeat: number;
  cachedEvents: CompiledEvent[];
}
```

### 5.2 Selective Recompilation

When a section changes:

1. Invalidate only affected section's cache
2. Re-project from section start with upstream state snapshot
3. Merge with unchanged section caches

```typescript
function incrementalCompile(
  clip: ClipNode,
  changedRange: { start: number; end: number },
  previousState: CompilationCache
): CompiledClip {
  const beforeSection = previousState.sectionsBeforeChange;
  const afterSection = previousState.sectionsAfterChange;

  // Only recompile the changed range
  const recompiled = compile(changedRange.operations, {
    initialState: beforeSection.endState,
  });

  return merge(beforeSection, recompiled, afterSection);
}
```

---

## 6. Migration Path

### Phase 1: Projection Abstraction (Non-Breaking)

1. Wrap existing phases as Projections
2. Keep current pipeline semantics
3. Add Generator-based iteration

### Phase 2: Lazy Evaluation

1. Replace array accumulation with Generator yields
2. Eliminate intermediate `result[]` arrays
3. Remove re-sorting in coalesce (streaming order guaranteed)

### Phase 3: Incremental Support

1. Add content hashing to ClipNode
2. Implement state snapshotting
3. Add section-level caching

---

## 7. Files to Modify

| Action     | Path                                 | Description                  |
| ---------- | ------------------------------------ | ---------------------------- |
| **ADD**    | `src/compiler/projections/types.ts`  | Projection interface         |
| **ADD**    | `src/compiler/projections/expand.ts` | Expand as projection         |
| **ADD**    | `src/compiler/projections/time.ts`   | Time as projection           |
| **ADD**    | `src/compiler/projections/tempo.ts`  | Tempo as projection          |
| **ADD**    | `src/compiler/projections/tie.ts`    | Tie coalescing as projection |
| **ADD**    | `src/compiler/projections/emit.ts`   | Emit as projection           |
| **ADD**    | `src/compiler/compose.ts`            | Pipeline composition         |
| **MODIFY** | `src/compiler/pipeline/index.ts`     | Use new composition          |

---

## 8. Performance Expectations

| Metric                  | Current        | Event Sourcing |
| ----------------------- | -------------- | -------------- |
| Traversals              | 3-4            | 1              |
| Intermediate Arrays     | 3              | 0              |
| Memory (5K notes)       | ~2MB peak      | ~0.5MB peak    |
| Incremental (1% change) | 100% recompile | ~5% recompile  |

---

## 9. Testing Strategy

```typescript
describe("Event Sourcing Pipeline", () => {
  it("produces identical output to current pipeline", () => {
    const clip = createComplexClip(); // Loops, stacks, ties, tempo

    const legacyResult = legacyCompile(clip, options);
    const esResult = eventSourcingCompile(clip, options);

    expect(esResult.events).toEqual(legacyResult.events);
  });

  it("supports incremental compilation", () => {
    const clip1 = Clip.melody().note("C4").note("D4").note("E4").build();
    const cache = compile(clip1, options);

    const clip2 = Clip.melody().note("C4").note("F4").note("E4").build();
    const incremental = incrementalCompile(clip2, { start: 1, end: 2 }, cache);

    // Only middle note recompiled
    expect(incremental.recompiledSections).toEqual([1]);
  });
});
```

---

## 10. Trade-offs

| Pro                           | Con                             |
| ----------------------------- | ------------------------------- |
| Single-pass efficiency        | Higher abstraction complexity   |
| Incremental compilation ready | Generator debugging harder      |
| Easy to add new projections   | Requires state serialization    |
| Reduced memory pressure       | Learning curve for contributors |

---

## 12. Approval

- [ ] Approved for future exploration
- [ ] Prioritized for implementation
