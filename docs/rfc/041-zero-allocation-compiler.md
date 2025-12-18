# RFC-041: Zero-Allocation Bytecode Compiler

**Status**: Draft  
**Target**: `packages/core/src/builder/compiler.ts`  
**Driver**: Live Performance GC Elimination  
**Dependencies**: [RFC-040 Zero-Allocation Bytecode Builder](./040-zero-allocation-bytecode-builder.md)

---

## 1. Problem Statement

RFC-040 achieved zero allocations during fluent chain construction (`Clip.melody().note().note()...`). However, the current `build()` implementation creates a **tree of JavaScript objects** during compilation:

```typescript
// Current implementation creates:
// - EventNode objects
// - LoopNode objects  
// - StackNode objects
// - BranchNode objects
// - ExtractedEvent objects with nested HumanizeContext, QuantizeContext, etc.
```

For a clip with 10,000 notes, `build()` allocates 10,000+ objects, triggering GC.

**In live performance scenarios where `build()` is called frequently, this GC pressure is CRITICAL.**

---

## 2. Goals

1. **Zero heap allocations** during `build()` — no `new` objects, no object literals
2. **Full functionality preservation**:
   - Humanize, Quantize, Groove transforms
   - Block-scoped transforms (HUMANIZE_PUSH/POP, etc.)
   - Atomic modifiers (NOTE_MOD_*)
   - Transform pipeline: Quantize → Groove → Humanize
   - Structural opcodes: LOOP_START/END, STACK_START/END, BRANCH_START/END
   - `unroll: true` mode with per-iteration humanization
3. **Pre-allocated, reusable buffers** — allocated once, reused across `build()` calls
4. **Deterministic performance** — no GC pauses during live playback

---

## 3. Architecture Overview

### 3.1 Pre-Allocated Memory Pools

All working memory is allocated **once** at module load or compiler instantiation:

```typescript
class ZeroAllocCompiler {
  // === Event Buffer ===
  // Fixed-stride storage: [finalTick, opcode, arg0, arg1, arg2, scopeId]
  private static readonly EVENT_STRIDE = 6
  private static readonly MAX_EVENTS = 65536
  private eventBuf = new Int32Array(ZeroAllocCompiler.MAX_EVENTS * ZeroAllocCompiler.EVENT_STRIDE)
  private eventCount = 0

  // === Context Stacks (flat arrays) ===
  // Humanize: pairs of [timingPpt, velocityPpt]
  private humanizeStack = new Int32Array(64)
  private humanizeTop = 0  // points to next free slot (0 = empty)

  // Quantize: pairs of [gridTicks, strengthPct]
  private quantizeStack = new Int32Array(64)
  private quantizeTop = 0

  // Groove: indices into registered groove templates
  private grooveStack = new Int32Array(32)
  private grooveTop = 0

  // === Scope Management ===
  // Tracks current scope for event grouping
  private scopeStack = new Int32Array(64)  // [scopeId, scopeId, ...]
  private scopeTop = 0
  private nextScopeId = 0

  // === Sort Workspace ===
  // Indices for in-place sorting
  private sortIndices = new Int32Array(ZeroAllocCompiler.MAX_EVENTS)

  // === Output Buffer ===
  private vmBuf = new Int32Array(ZeroAllocCompiler.MAX_EVENTS * 5)
  private vmBufLen = 0

  // === Reusable scratch space ===
  private scratchBuf = new Int32Array(1024)
}
```

### 3.2 Event Buffer Layout

Each event occupies `EVENT_STRIDE = 6` consecutive Int32 slots:

| Offset | Field | Description |
|--------|-------|-------------|
| 0 | `finalTick` | Tick after all transforms applied |
| 1 | `opcode` | Event type (NOTE=0x01, REST=0x02, etc.) |
| 2 | `arg0` | First argument (pitch for NOTE, duration for REST) |
| 3 | `arg1` | Second argument (velocity for NOTE, 0 for others) |
| 4 | `arg2` | Third argument (duration for NOTE, 0 for others) |
| 5 | `scopeId` | Scope this event belongs to (for sorting) |

**Opcode argument mapping:**

| Opcode | arg0 | arg1 | arg2 |
|--------|------|------|------|
| NOTE (0x01) | pitch | velocity | duration |
| REST (0x02) | duration | 0 | 0 |
| TEMPO (0x20) | bpm | 0 | 0 |
| CC (0x21) | controller | value | 0 |
| BEND (0x22) | value | 0 | 0 |

### 3.3 Context Stack Layout

**Humanize Stack:** Pairs of `[timingPpt, velocityPpt]`

```
Index:    0    1    2    3    4    5    ...
Value: [t0] [v0] [t1] [v1] [t2] [v2]  ...
        ↑ entry 0   ↑ entry 1   ↑ entry 2
```

- Push: `stack[top++] = timingPpt; stack[top++] = velocityPpt;`
- Pop: `top -= 2`
- Peek: `stack[top - 2]` (timing), `stack[top - 1]` (velocity)
- Empty: `top === 0`

**Quantize Stack:** Pairs of `[gridTicks, strengthPct]` — same layout as humanize.

**Groove Stack:** Indices into registered groove templates.

```
Index:    0    1    2    ...
Value: [i0] [i1] [i2]  ...
```

- Push: `stack[top++] = grooveTemplateIndex`
- Pop: `top--`
- Peek: `stack[top - 1]`

---

## 4. Compilation Phases

### 4.1 Phase Overview

```
Builder Bytecode (number[])
         │
         ▼
    ┌─────────────────────────────────────┐
    │  Phase 1: Parse & Transform         │
    │  - Single pass through buffer       │
    │  - Apply transforms inline          │
    │  - Store events in eventBuf         │
    │  - Track scope boundaries           │
    └─────────────────────────────────────┘
         │
         ▼
    ┌─────────────────────────────────────┐
    │  Phase 2: Sort Within Scopes        │
    │  - Group events by scopeId          │
    │  - In-place sort by finalTick       │
    │  - Stable sort (originalIndex)      │
    └─────────────────────────────────────┘
         │
         ▼
    ┌─────────────────────────────────────┐
    │  Phase 3: Emit VM Bytecode          │
    │  - Emit structural opcodes          │
    │  - Emit sorted events with REST     │
    │  - Calculate gaps, skip negative    │
    └─────────────────────────────────────┘
         │
         ▼
    SharedArrayBuffer (RFC-038 format)
```

### 4.2 Phase 1: Parse & Transform

Single-pass parsing with inline transform application:

```typescript
private parseAndTransform(
  buf: number[],
  start: number,
  end: number,
  currentScopeId: number,
  seed: number,
  ppq: number,
  grooveTemplates: readonly number[][]
): void {
  let pos = start
  let eventIdx = 0

  while (pos < end) {
    const opcode = buf[pos]

    switch (opcode) {
      // === Transform Context Management ===
      case BUILDER_OP.HUMANIZE_PUSH:
        this.humanizeStack[this.humanizeTop++] = buf[pos + 1]  // timingPpt
        this.humanizeStack[this.humanizeTop++] = buf[pos + 2]  // velocityPpt
        pos += 3
        break

      case BUILDER_OP.HUMANIZE_POP:
        this.humanizeTop -= 2
        pos += 1
        break

      case BUILDER_OP.QUANTIZE_PUSH:
        this.quantizeStack[this.quantizeTop++] = buf[pos + 1]  // gridTicks
        this.quantizeStack[this.quantizeTop++] = buf[pos + 2]  // strengthPct
        pos += 3
        break

      case BUILDER_OP.QUANTIZE_POP:
        this.quantizeTop -= 2
        pos += 1
        break

      case BUILDER_OP.GROOVE_PUSH: {
        const len = buf[pos + 1]
        // Store groove index (we'll need to register these)
        const grooveIdx = this.registerGrooveInline(buf, pos + 2, len)
        this.grooveStack[this.grooveTop++] = grooveIdx
        pos += 2 + len
        break
      }

      case BUILDER_OP.GROOVE_POP:
        this.grooveTop--
        pos += 1
        break

      // === Event Opcodes ===
      case OP.NOTE: {
        let tick = buf[pos + 1]
        const pitch = buf[pos + 2]
        let velocity = buf[pos + 3]
        const duration = buf[pos + 4]
        pos += 5

        // Check for atomic modifiers (NOTE_MOD_*)
        let atomicHumTiming = -1, atomicHumVel = -1
        let atomicQuantGrid = -1, atomicQuantStr = -1
        let atomicGrooveIdx = -1

        while (pos < end) {
          if (buf[pos] === BUILDER_OP.NOTE_MOD_HUMANIZE) {
            atomicHumTiming = buf[pos + 1]
            atomicHumVel = buf[pos + 2]
            pos += 3
          } else if (buf[pos] === BUILDER_OP.NOTE_MOD_QUANTIZE) {
            atomicQuantGrid = buf[pos + 1]
            atomicQuantStr = buf[pos + 2]
            pos += 3
          } else if (buf[pos] === BUILDER_OP.NOTE_MOD_GROOVE) {
            atomicGrooveIdx = buf[pos + 1]
            pos += 2
          } else {
            break
          }
        }

        // Resolve transform contexts (atomic overrides block)
        const humTiming = atomicHumTiming >= 0 ? atomicHumTiming :
                          this.humanizeTop > 0 ? this.humanizeStack[this.humanizeTop - 2] : 0
        const humVel = atomicHumVel >= 0 ? atomicHumVel :
                       this.humanizeTop > 0 ? this.humanizeStack[this.humanizeTop - 1] : 0
        const quantGrid = atomicQuantGrid >= 0 ? atomicQuantGrid :
                          this.quantizeTop > 0 ? this.quantizeStack[this.quantizeTop - 2] : 0
        const quantStr = atomicQuantStr >= 0 ? atomicQuantStr :
                         this.quantizeTop > 0 ? this.quantizeStack[this.quantizeTop - 1] : 100
        const grooveIdx = atomicGrooveIdx >= 0 ? atomicGrooveIdx :
                          this.grooveTop > 0 ? this.grooveStack[this.grooveTop - 1] : -1

        // Apply transforms: Quantize → Groove → Humanize
        let finalTick = tick

        // 1. Quantize
        if (quantGrid > 0) {
          const quantized = Math.round(finalTick / quantGrid) * quantGrid
          finalTick = finalTick + ((quantized - finalTick) * quantStr / 100) | 0
        }

        // 2. Groove
        if (grooveIdx >= 0 && grooveIdx < grooveTemplates.length) {
          const offsets = grooveTemplates[grooveIdx]
          const beatIdx = ((finalTick / ppq) | 0) % offsets.length
          finalTick += offsets[beatIdx]
        }

        // 3. Humanize
        if (humTiming > 0 || humVel > 0) {
          const rand = this.mulberry32(seed + eventIdx)

          if (humTiming > 0) {
            const maxOffset = (humTiming / 1000) * ppq
            finalTick += ((rand() - 0.5) * 2 * maxOffset) | 0
          }

          if (humVel > 0) {
            const maxVelOffset = (humVel / 1000) * 127
            velocity = Math.max(1, Math.min(127,
              (velocity + (rand() - 0.5) * 2 * maxVelOffset) | 0
            ))
          }
        }

        finalTick = Math.max(0, finalTick)

        // Store in event buffer
        const base = this.eventCount * ZeroAllocCompiler.EVENT_STRIDE
        this.eventBuf[base + 0] = finalTick
        this.eventBuf[base + 1] = OP.NOTE
        this.eventBuf[base + 2] = pitch
        this.eventBuf[base + 3] = velocity
        this.eventBuf[base + 4] = duration
        this.eventBuf[base + 5] = currentScopeId
        this.eventCount++
        eventIdx++
        break
      }

      case OP.REST: {
        const tick = buf[pos + 1]
        const duration = buf[pos + 2]
        pos += 3

        // REST events don't get transforms, store directly
        const base = this.eventCount * ZeroAllocCompiler.EVENT_STRIDE
        this.eventBuf[base + 0] = tick
        this.eventBuf[base + 1] = OP.REST
        this.eventBuf[base + 2] = duration
        this.eventBuf[base + 3] = 0
        this.eventBuf[base + 4] = 0
        this.eventBuf[base + 5] = currentScopeId
        this.eventCount++
        break
      }

      // Similar for TEMPO, CC, BEND...

      // === Structural Opcodes ===
      case OP.LOOP_START: {
        // Handled in parseStructural
        break
      }

      // ... other cases
    }
  }
}
```

### 4.3 Structural Opcode Handling

Structural opcodes require special handling because events must be sorted WITHIN each structural scope.

#### 4.3.1 Non-Unroll Mode (Structural Preserved)

```typescript
private parseStructuralLoop(
  buf: number[],
  pos: number,
  seed: number,
  ppq: number,
  grooveTemplates: readonly number[][]
): number {
  const startTick = buf[pos + 1]
  const count = buf[pos + 2]
  pos += 3

  // Find matching LOOP_END
  const bodyEnd = this.findMatchingEnd(buf, pos, OP.LOOP_END)

  // Create new scope for loop body
  const loopScopeId = this.nextScopeId++
  this.scopeStack[this.scopeTop++] = loopScopeId

  // Record scope boundary (start event index)
  const scopeStartEventIdx = this.eventCount

  // Parse loop body (events will be stored with loopScopeId)
  this.parseAndTransform(buf, pos, bodyEnd, loopScopeId, seed, ppq, grooveTemplates)

  // Record scope boundary (end event index)
  const scopeEndEventIdx = this.eventCount

  // Store scope info for later emission
  this.recordScope(loopScopeId, OP.LOOP_START, count, startTick, scopeStartEventIdx, scopeEndEventIdx)

  // Pop scope
  this.scopeTop--

  return bodyEnd + 1  // Skip LOOP_END
}
```

#### 4.3.2 Unroll Mode (Loops Expanded)

```typescript
private parseUnrolledLoop(
  buf: number[],
  pos: number,
  baseSeed: number,
  ppq: number,
  grooveTemplates: readonly number[][]
): number {
  const startTick = buf[pos + 1]
  const count = buf[pos + 2]
  pos += 3

  // Find matching LOOP_END
  const bodyEnd = this.findMatchingEnd(buf, pos, OP.LOOP_END)

  // Calculate body duration (scan for max tick + duration)
  const bodyDuration = this.calculateBodyDuration(buf, pos, bodyEnd, ppq)

  // Save context stack positions (restore for each iteration)
  const savedHumanizeTop = this.humanizeTop
  const savedQuantizeTop = this.quantizeTop
  const savedGrooveTop = this.grooveTop

  // All unrolled events go into current scope (will be sorted together)
  const currentScopeId = this.scopeTop > 0 ? this.scopeStack[this.scopeTop - 1] : 0

  for (let i = 0; i < count; i++) {
    // Restore context stacks to loop entry state
    this.humanizeTop = savedHumanizeTop
    this.quantizeTop = savedQuantizeTop
    this.grooveTop = savedGrooveTop

    // Parse body with iteration-specific seed
    const iterSeed = baseSeed + i * 1000
    const iterEventStart = this.eventCount

    this.parseAndTransform(buf, pos, bodyEnd, currentScopeId, iterSeed, ppq, grooveTemplates)

    // Offset all events from this iteration by bodyDuration * i
    const iterOffset = bodyDuration * i
    for (let e = iterEventStart; e < this.eventCount; e++) {
      const base = e * ZeroAllocCompiler.EVENT_STRIDE
      this.eventBuf[base + 0] += iterOffset  // Offset finalTick
    }
  }

  // Restore context stacks
  this.humanizeTop = savedHumanizeTop
  this.quantizeTop = savedQuantizeTop
  this.grooveTop = savedGrooveTop

  return bodyEnd + 1  // Skip LOOP_END
}
```

### 4.4 Phase 2: Sort Within Scopes

In-place sorting using pre-allocated index array:

```typescript
private sortEventsInScope(startIdx: number, endIdx: number): void {
  const count = endIdx - startIdx
  if (count <= 1) return

  // Initialize sort indices
  for (let i = 0; i < count; i++) {
    this.sortIndices[i] = startIdx + i
  }

  // Sort indices by finalTick (stable sort with originalIndex tiebreaker)
  // Using insertion sort for small arrays, merge sort for large
  if (count <= 32) {
    this.insertionSortIndices(count)
  } else {
    this.mergeSortIndices(count)
  }

  // Permute eventBuf according to sorted indices (cycle sort - in place)
  this.permuteEvents(startIdx, count)
}

private insertionSortIndices(count: number): void {
  for (let i = 1; i < count; i++) {
    const key = this.sortIndices[i]
    const keyTick = this.eventBuf[key * ZeroAllocCompiler.EVENT_STRIDE]
    let j = i - 1
    while (j >= 0) {
      const jTick = this.eventBuf[this.sortIndices[j] * ZeroAllocCompiler.EVENT_STRIDE]
      if (jTick <= keyTick) break  // Stable: equal elements stay in order
      this.sortIndices[j + 1] = this.sortIndices[j]
      j--
    }
    this.sortIndices[j + 1] = key
  }
}

private permuteEvents(startIdx: number, count: number): void {
  // Cycle sort permutation using scratch buffer
  for (let i = 0; i < count; i++) {
    const targetIdx = this.sortIndices[i]
    if (targetIdx === startIdx + i) continue  // Already in place

    // Copy current element to scratch
    const srcBase = (startIdx + i) * ZeroAllocCompiler.EVENT_STRIDE
    for (let k = 0; k < ZeroAllocCompiler.EVENT_STRIDE; k++) {
      this.scratchBuf[k] = this.eventBuf[srcBase + k]
    }

    // Copy target to current position
    const tgtBase = targetIdx * ZeroAllocCompiler.EVENT_STRIDE
    for (let k = 0; k < ZeroAllocCompiler.EVENT_STRIDE; k++) {
      this.eventBuf[srcBase + k] = this.eventBuf[tgtBase + k]
    }

    // Copy scratch to target position
    for (let k = 0; k < ZeroAllocCompiler.EVENT_STRIDE; k++) {
      this.eventBuf[tgtBase + k] = this.scratchBuf[k]
    }

    // Update sort indices to reflect the swap
    // ... (bookkeeping for cycle sort)
  }
}
```

### 4.5 Phase 3: Emit VM Bytecode

Emit structural opcodes and sorted events with REST gaps:

```typescript
private emitScope(scopeId: number): void {
  const scope = this.getScope(scopeId)
  
  // Emit structural start opcode (if any)
  if (scope.structuralOp === OP.LOOP_START) {
    this.vmBuf[this.vmBufLen++] = OP.LOOP_START
    this.vmBuf[this.vmBufLen++] = scope.count
  } else if (scope.structuralOp === OP.STACK_START) {
    this.vmBuf[this.vmBufLen++] = OP.STACK_START
    this.vmBuf[this.vmBufLen++] = scope.branchCount
  }

  // Emit sorted events with REST gaps
  let currentTick = 0
  for (let i = scope.eventStartIdx; i < scope.eventEndIdx; i++) {
    const base = i * ZeroAllocCompiler.EVENT_STRIDE
    const finalTick = this.eventBuf[base + 0]
    const opcode = this.eventBuf[base + 1]

    // Insert REST gap if needed
    if (finalTick > currentTick) {
      this.vmBuf[this.vmBufLen++] = OP.REST
      this.vmBuf[this.vmBufLen++] = finalTick - currentTick
      currentTick = finalTick
    }

    // Emit event
    switch (opcode) {
      case OP.NOTE:
        this.vmBuf[this.vmBufLen++] = OP.NOTE
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 2]  // pitch
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 3]  // velocity
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 4]  // duration
        currentTick += this.eventBuf[base + 4]  // Advance by duration
        break

      case OP.REST:
        this.vmBuf[this.vmBufLen++] = OP.REST
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 2]  // duration
        currentTick += this.eventBuf[base + 2]
        break

      case OP.TEMPO:
        this.vmBuf[this.vmBufLen++] = OP.TEMPO
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 2]  // bpm
        break

      case OP.CC:
        this.vmBuf[this.vmBufLen++] = OP.CC
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 2]  // controller
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 3]  // value
        break

      case OP.BEND:
        this.vmBuf[this.vmBufLen++] = OP.BEND
        this.vmBuf[this.vmBufLen++] = this.eventBuf[base + 2]  // value
        break
    }
  }

  // Emit child scopes (for nested structures)
  // ... recurse for child scopes in order

  // Emit structural end opcode (if any)
  if (scope.structuralOp === OP.LOOP_START) {
    this.vmBuf[this.vmBufLen++] = OP.LOOP_END
  } else if (scope.structuralOp === OP.STACK_START) {
    this.vmBuf[this.vmBufLen++] = OP.STACK_END
  }
}
```

---

## 5. Scope Management

### 5.1 Scope Table (Pre-allocated)

```typescript
private static readonly MAX_SCOPES = 256
private static readonly SCOPE_STRIDE = 8

// Scope table: [structuralOp, count, startTick, eventStartIdx, eventEndIdx, parentScopeId, firstChildIdx, nextSiblingIdx]
private scopeTable = new Int32Array(ZeroAllocCompiler.MAX_SCOPES * ZeroAllocCompiler.SCOPE_STRIDE)
private scopeCount = 0
```

| Offset | Field | Description |
|--------|-------|-------------|
| 0 | structuralOp | LOOP_START, STACK_START, or 0 for root |
| 1 | count | Loop iteration count or branch count |
| 2 | startTick | Tick when scope begins |
| 3 | eventStartIdx | First event index in this scope |
| 4 | eventEndIdx | One past last event index |
| 5 | parentScopeId | Parent scope ID (-1 for root) |
| 6 | firstChildIdx | First child scope index (-1 if none) |
| 7 | nextSiblingIdx | Next sibling scope index (-1 if none) |

### 5.2 Scope Tree Traversal

Scopes form a tree for nested structures. Traversal uses the linked structure (firstChild/nextSibling) without recursion:

```typescript
private emitAllScopes(): void {
  // Start with root scope (id=0)
  this.emitScopeIterative(0)
}

private emitScopeIterative(rootScopeId: number): void {
  // Use scope stack for iterative traversal
  let stackTop = 0
  this.scratchBuf[stackTop++] = rootScopeId
  this.scratchBuf[stackTop++] = 0  // phase: 0=enter, 1=exit

  while (stackTop > 0) {
    const phase = this.scratchBuf[--stackTop]
    const scopeId = this.scratchBuf[--stackTop]
    const base = scopeId * ZeroAllocCompiler.SCOPE_STRIDE

    if (phase === 0) {
      // Enter phase: emit start opcode and events
      this.emitScopeStart(scopeId)
      this.emitScopeEvents(scopeId)

      // Push exit phase
      this.scratchBuf[stackTop++] = scopeId
      this.scratchBuf[stackTop++] = 1

      // Push children (in reverse order for correct traversal)
      let childIdx = this.scopeTable[base + 6]  // firstChildIdx
      // ... push children
    } else {
      // Exit phase: emit end opcode
      this.emitScopeEnd(scopeId)
    }
  }
}
```

---

## 6. Random Number Generator

Pre-seeded PRNG (Mulberry32) with no allocations:

```typescript
private mulberry32(seed: number): () => number {
  // Returns a function that generates random numbers
  // But wait - returning a function IS an allocation!
  
  // Solution: inline the PRNG state
  return // NO! This allocates a closure
}

// CORRECT: Use instance variable for PRNG state
private prngState = 0

private prngSeed(seed: number): void {
  this.prngState = seed
}

private prngNext(): number {
  let t = this.prngState + 0x6d2b79f5
  this.prngState = t
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
```

---

## 7. Helper Functions

### 7.1 Find Matching End Opcode

```typescript
private findMatchingEnd(buf: number[], start: number, endOp: number): number {
  const startOp = endOp === OP.LOOP_END ? OP.LOOP_START :
                  endOp === OP.STACK_END ? OP.STACK_START :
                  OP.BRANCH_START
  let depth = 1
  let pos = start

  while (pos < buf.length && depth > 0) {
    const op = buf[pos]
    if (op === startOp) depth++
    else if (op === endOp) depth--

    if (depth > 0) {
      pos += this.getOpcodeLength(buf, pos)
    }
  }

  return pos
}

private getOpcodeLength(buf: number[], pos: number): number {
  switch (buf[pos]) {
    case OP.NOTE: return 5
    case OP.REST: return 3
    case OP.TEMPO: return 3
    case OP.CC: return 4
    case OP.BEND: return 3
    case OP.LOOP_START: return 3
    case OP.LOOP_END: return 1
    case OP.STACK_START: return 3
    case OP.STACK_END: return 1
    case OP.BRANCH_START: return 1
    case OP.BRANCH_END: return 1
    case BUILDER_OP.HUMANIZE_PUSH: return 3
    case BUILDER_OP.HUMANIZE_POP: return 1
    case BUILDER_OP.QUANTIZE_PUSH: return 3
    case BUILDER_OP.QUANTIZE_POP: return 1
    case BUILDER_OP.GROOVE_PUSH: return 2 + buf[pos + 1]
    case BUILDER_OP.GROOVE_POP: return 1
    case BUILDER_OP.NOTE_MOD_HUMANIZE: return 3
    case BUILDER_OP.NOTE_MOD_QUANTIZE: return 3
    case BUILDER_OP.NOTE_MOD_GROOVE: return 2
    default: return 1
  }
}
```

### 7.2 Calculate Body Duration

```typescript
private calculateBodyDuration(buf: number[], start: number, end: number, ppq: number): number {
  let maxEndTick = 0
  let pos = start

  while (pos < end) {
    const op = buf[pos]
    if (op === OP.NOTE) {
      const tick = buf[pos + 1]
      const duration = buf[pos + 4]
      const endTick = tick + duration
      if (endTick > maxEndTick) maxEndTick = endTick
    } else if (op === OP.REST) {
      const tick = buf[pos + 1]
      const duration = buf[pos + 2]
      const endTick = tick + duration
      if (endTick > maxEndTick) maxEndTick = endTick
    }
    pos += this.getOpcodeLength(buf, pos)
  }

  return maxEndTick
}
```

---

## 8. Public API

```typescript
export class ZeroAllocCompiler {
  /**
   * Compile Builder Bytecode to VM Bytecode with ZERO heap allocations.
   * 
   * All working memory is pre-allocated. This method can be called
   * frequently in live performance without GC pressure.
   */
  compile(
    builderBuf: number[],
    ppq: number,
    seed: number,
    grooveTemplates: readonly number[][],
    unroll: boolean
  ): CompileResult {
    // Reset state (no allocations)
    this.reset()

    // Phase 1: Parse and transform
    this.parseAndTransform(builderBuf, 0, builderBuf.length, 0, seed, ppq, grooveTemplates)

    // Phase 2: Sort within scopes
    for (let s = 0; s < this.scopeCount; s++) {
      const base = s * ZeroAllocCompiler.SCOPE_STRIDE
      const startIdx = this.scopeTable[base + 3]
      const endIdx = this.scopeTable[base + 4]
      this.sortEventsInScope(startIdx, endIdx)
    }

    // Phase 3: Emit VM bytecode
    this.emitAllScopes()
    this.vmBuf[this.vmBufLen++] = OP.EOF

    // Calculate total ticks
    const totalTicks = this.calculateTotalTicks()

    return {
      vmBuf: this.vmBuf.subarray(0, this.vmBufLen),
      totalTicks
    }
  }

  private reset(): void {
    this.eventCount = 0
    this.humanizeTop = 0
    this.quantizeTop = 0
    this.grooveTop = 0
    this.scopeTop = 0
    this.scopeCount = 0
    this.nextScopeId = 0
    this.vmBufLen = 0
  }
}
```

---

## 9. Integration with ClipBuilder

```typescript
// In ClipBuilder.ts

// Singleton compiler instance (pre-allocated once)
const compiler = new ZeroAllocCompiler()

build(options?: BuildOptions): SharedArrayBuffer {
  const { bpm, ppq, eventCapacity, tempoCapacity, seed, unroll } = options ?? {}
  
  // Compile with zero allocations
  const result = compiler.compile(
    this.buf,
    ppq ?? 96,
    seed ?? Date.now(),
    this._grooveTemplates,
    unroll ?? false
  )

  // Copy to SharedArrayBuffer (this allocation is necessary for output)
  // ... existing SAB creation code
}
```

---

## 10. Limitations and Edge Cases

### 10.1 Capacity Limits

| Resource | Default Limit | Configurable |
|----------|--------------|--------------|
| Max events | 65,536 | Yes |
| Max scopes | 256 | Yes |
| Max humanize stack depth | 32 | No |
| Max quantize stack depth | 32 | No |
| Max groove stack depth | 16 | No |

**Overflow handling:** Throw error if limits exceeded (compile-time, not runtime).

### 10.2 Nested Unroll

Nested loops with `unroll: true`:
```typescript
.loop(2, b => b.loop(3, b2 => b2.note('C4').humanize(...)))
```

When parsing inner loop during unroll, it also unrolls (recursively). Each inner iteration gets:
- Seed offset from outer iteration × 1000
- Seed offset from inner iteration × 1

Total: `baseSeed + outerIter * 1000 + innerIter`

### 10.3 STACK/BRANCH Handling

Branches are handled similarly to loops:
- Each branch becomes a scope
- Events in each branch are sorted independently
- Branches share the stack's startTick

For unroll mode, stacks are NOT unrolled (they represent parallel execution, not repetition).

---

## 11. Performance Characteristics

| Operation | Time Complexity | Space Complexity | Allocations |
|-----------|-----------------|------------------|-------------|
| Parse | O(n) | O(1) | 0 |
| Transform | O(n) | O(1) | 0 |
| Sort | O(n log n) | O(n) indices | 0 (pre-allocated) |
| Emit | O(n) | O(1) | 0 |
| Total | O(n log n) | O(n) | 0 |

Where n = number of events in the clip.

---

## 12. Success Criteria

- [ ] Zero `new` object allocations during `compile()`
- [ ] Zero object literals created during `compile()`
- [ ] All transform types work: Humanize, Quantize, Groove
- [ ] Block-scoped transforms (PUSH/POP) work correctly
- [ ] Atomic modifiers (NOTE_MOD_*) override block context
- [ ] Transform pipeline order: Quantize → Groove → Humanize
- [ ] Structural opcodes: LOOP, STACK, BRANCH work correctly
- [ ] Nested structures work correctly
- [ ] `unroll: true` produces varied humanization per iteration
- [ ] Events sorted correctly within each scope
- [ ] REST gaps calculated correctly (no negative REST)
- [ ] Output compatible with RFC-038 BytecodeVM
- [ ] All existing RFC-040 tests pass
- [ ] Performance: `build()` completes in < 1ms for 10,000 events
- [ ] `npx tsc --noEmit` passes

---

## 13. Test Cases

### 13.1 Basic Functionality

```typescript
it('compiles simple note sequence with zero allocations', () => {
  const before = performance.now()
  for (let i = 0; i < 1000; i++) {
    Clip.melody()
      .note('C4', '4n')
      .note('D4', '4n')
      .note('E4', '4n')
      .build()
  }
  const after = performance.now()
  // Should be fast and consistent (no GC pauses)
  expect(after - before).toBeLessThan(100)  // 0.1ms per build
})
```

### 13.2 Transform Application

```typescript
it('applies all transforms correctly', () => {
  const sab = Clip.melody()
    .quantize('4n', { strength: 1.0 }, b => {
      b.groove(swingTemplate, b2 => {
        b2.humanize({ timing: 0.1 }, b3 => {
          b3.note('C4', '4n')
        })
      })
    })
    .build({ seed: 12345 })

  const vm = new BytecodeVM(sab)
  vm.runToEnd()
  expect(vm.getTotalEventsWritten()).toBe(1)
})
```

### 13.3 Structural Opcodes

```typescript
it('loop produces correct events', () => {
  const sab = Clip.melody()
    .loop(4, b => b.note('C4', '4n'))
    .build()

  const vm = new BytecodeVM(sab)
  vm.runToEnd()
  expect(vm.getTotalEventsWritten()).toBe(4)
})

it('nested loops produce correct event count', () => {
  const sab = Clip.melody()
    .loop(2, b => b.loop(3, b2 => b2.note('C4', '4n')))
    .build()

  const vm = new BytecodeVM(sab)
  vm.runToEnd()
  expect(vm.getTotalEventsWritten()).toBe(6)
})
```

### 13.4 Unroll Mode

```typescript
it('unroll produces varied humanization', () => {
  const sab = Clip.melody()
    .loop(4, b => b.note('C4', '4n').humanize({ timing: 0.3 }))
    .build({ unroll: true, seed: 12345 })

  // Verify no LOOP_START in bytecode
  const mem = new Int32Array(sab)
  const start = mem[REG.BYTECODE_START]
  const end = mem[REG.BYTECODE_END]
  for (let i = start; i < end; i++) {
    expect(mem[i]).not.toBe(OP.LOOP_START)
  }

  const vm = new BytecodeVM(sab)
  vm.runToEnd()
  expect(vm.getTotalEventsWritten()).toBe(4)
})
```

### 13.5 GC Verification

```typescript
it('build() causes no GC pressure', () => {
  // Force GC before test
  if (global.gc) global.gc()

  const heapBefore = process.memoryUsage().heapUsed

  // Build many clips
  for (let i = 0; i < 100; i++) {
    Clip.melody()
      .loop(10, b => b.note('C4', '4n').humanize({ timing: 0.1 }))
      .build()
  }

  const heapAfter = process.memoryUsage().heapUsed

  // Heap growth should be minimal (only SAB outputs)
  const heapGrowth = heapAfter - heapBefore
  expect(heapGrowth).toBeLessThan(1024 * 1024)  // Less than 1MB growth
})
```

---

## 14. Migration Path

1. **Phase 1:** Implement `ZeroAllocCompiler` alongside existing tree-based compiler
2. **Phase 2:** Add feature flag to switch between compilers
3. **Phase 3:** Extensive testing and benchmarking
4. **Phase 4:** Make zero-alloc compiler the default
5. **Phase 5:** Deprecate and remove tree-based compiler

---

## 15. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
