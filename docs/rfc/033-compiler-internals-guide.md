# RFC-033: Compiler Internals Guide

**Status**: Draft  
**Priority**: Medium  
**Estimated Effort**: 2 days  
**Breaking Change**: None (documentation only)

---

## 1. Purpose

Create a technical guide explaining _how_ the compiler works, not just _how to use it_. This serves two purposes:

1. **Contributor onboarding** — New contributors understand the pipeline before touching code
2. **Author internalization** — Forces deep understanding of AI-assisted implementations

---

## 2. Target Audience

- Future contributors
- Yourself, 6 months from now
- Interviewers asking "how does this work?"

---

## 3. Proposed Structure

```
docs/internals/
├── README.md              # Overview and reading order
├── pipeline-overview.md   # The 4-phase pipeline
├── timing-math.md         # Tempo integration math
├── tie-coalescing.md      # Polyphonic tie algorithm
├── routing-graph.md       # Effects routing DAG
└── builder-pattern.md     # Cursor/relay pattern
```

---

## 4. Content Specifications

### 4.1 pipeline-overview.md

**Must answer:** "What happens when I call `compileClip(clip)`?"

```
┌─────────┐     ┌────────┐     ┌──────────┐     ┌──────┐
│ Expand  │ ──▶ │ Timing │ ──▶ │ Coalesce │ ──▶ │ Emit │
└─────────┘     └────────┘     └──────────┘     └──────┘
    │               │               │              │
    ▼               ▼               ▼              ▼
 Flatten        Calculate       Merge ties     Generate
 loops/stacks   beat → sec      in voices      events
```

**Content:**

- Input/output of each phase
- Why this order matters (expand before timing, coalesce before emit)
- Memory characteristics (array sizes at each step)

---

### 4.2 timing-math.md

**Must answer:** "How do variable tempos convert beats to seconds?"

**The Core Problem:**

```
At constant 120 BPM: beat 4 = 2.0 seconds (trivial)
At 120→140 BPM ramp: beat 4 = ??? seconds (requires integration)
```

**The Math (simplified):**

```
For linear tempo ramp from T₀ to T₁ over B beats:

  T(b) = T₀ + (T₁ - T₀) * (b / B)     // Tempo at beat b

  Time = ∫₀ᵇ (60 / T(x)) dx           // Integration

  Closed form (no iteration needed):
  Time = (60 * B / (T₁ - T₀)) * ln(T₁ / T₀)  // When T₀ ≠ T₁
```

**Must include:**

- Why iterative "tick-by-tick" fails (floating-point accumulation)
- How `tempo-map.ts` builds segments
- The `beatToSeconds()` function explained line-by-line

---

### 4.3 tie-coalescing.md

**Must answer:** "How do ties turn into single long notes?"

**The Algorithm:**

```
1. Sort by (beat, pitch)
2. For each note:
   - tie='start' → push to activeTies[key]
   - tie='end' → pop from activeTies, skip emit (absorbed)
   - tie=undefined → emit normally
3. Coalesced note has duration = sum of tied durations
```

**The Polyphonic Problem:**

```
Voice 1: C4 (tie)───────C4
Voice 2: C4 ─── C4 ─── C4

If key = pitch only: Voice 2's C4 corrupts Voice 1's tie
Fix: key = expressionId:pitch
```

**Must include:**

- Why BFS-style Map tracking
- Warning generation for orphaned ties
- Edge case: tie across tempo change

---

### 4.4 routing-graph.md

**Must answer:** "How do sends and inserts become a signal flow?"

**The Graph:**

```
Track 1 ──┬──▶ Insert (EQ) ──▶ Master
          │
          └──▶ Send (Reverb) ──▶ Bus 1 ──▶ Master
```

**Concepts:**

- DAG (Directed Acyclic Graph)
- Topological sort for processing order
- Cycle detection (does the current implementation check?)

**Must include:**

- `AudioRoutingGraph` structure
- How `routingResolver` builds the graph
- What happens with invalid routing

---

### 4.5 builder-pattern.md

**Must answer:** "Why the cursor pattern instead of simple array push?"

**The Pattern:**

```typescript
// Every method returns new instance (immutability)
note("C4") // Returns MelodyNoteCursor
  .staccato() // Modifies last note, returns cursor
  .commit(); // Returns back to MelodyBuilder

// Internally: Linked list for O(1) modification
```

**Why not array.push?**

- Immutability enables functional composition
- O(1) access to "last note" for modifiers
- Tree structure for parallel/nested contexts

**Must include:**

- `_withParams()` explained
- How `chain` accumulates operations
- The `commit()` flow

---

## 5. Diagrams Required

Each document should include ASCII or Mermaid diagrams:

| Document          | Diagram                       |
| ----------------- | ----------------------------- |
| pipeline-overview | 4-phase flow                  |
| timing-math       | Tempo curve with area = beats |
| tie-coalescing    | Before/after note timeline    |
| routing-graph     | DAG with tracks/buses/master  |
| builder-pattern   | Cursor state machine          |

---

## 6. Code References

Each concept must link to the actual implementation:

```markdown
See implementation: [tempo-map.ts:45-78](file:../src/compiler/pipeline/tempo-map.ts#L45-L78)
```

---

## 7. Verification

For each document, include a "Test Your Understanding" section:

```markdown
## Test Your Understanding

1. What happens if you process a tempo_change BEFORE a note at the same beat?
2. Why does coalesce come BEFORE emit, not after?
3. What's the time complexity of tie coalescing?

Answers in [answers.md](./answers.md) (hidden by default)
```

---

## 8. Execution Order

1. Create `docs/internals/` structure
2. Write `pipeline-overview.md` (foundation)
3. Write `timing-math.md` (hardest, most valuable)
4. Write `tie-coalescing.md`
5. Write `routing-graph.md`
6. Write `builder-pattern.md`
7. Add cross-links and diagrams

---

## 9. Approval

- [ ] Approved by maintainer
