# RFC-040: Zero-Allocation Direct Bytecode Builder

**Status**: Draft  
**Target**: `packages/core`  
**Driver**: Zero-Allocation Fluent API, Direct Bytecode Emission  
**Dependencies**: [RFC-038 Symphony Bytecode Standard](./038-symphony-bytecode-standard.md)

---

## 1. Abstract

This RFC refactors `ClipBuilder` to emit bytecode directly during fluent chain construction, eliminating the intermediate AST representation. The builder uses a mutable `number[]` buffer and a recycled cursor pattern, achieving **zero allocations per musical operation**.

**Goals:**
- **Zero Allocation**: No objects created during `.note().velocity().note()` chains
- **Direct Bytecode**: Write raw opcodes to `number[]`, single copy to `SharedArrayBuffer`
- **API Preservation**: Fluent surface syntax unchanged
- **RFC-038 Integration**: Output directly compatible with unified memory VM

---

## 2. Current Architecture (To Be Replaced)

```
User: .note('C4').velocity(0.8).note('D4')

Internally:
  → new ClipBuilder (allocation)
  → new OpChain node (allocation)  
  → new Cursor (allocation)
  → new ClipBuilder (allocation)
  → new OpChain node (allocation)
  → ... repeat for every method call

Result: ClipNode { operations: ClipOperation[] }

Then: assembleToBytecode(clipNode) → SharedArrayBuffer
```

**Problems:**
- 3+ allocations per note
- Intermediate AST representation
- Two-phase: build AST, then convert to bytecode
- GC pressure during live performance

---

## 3. New Architecture

```
User: .note('C4').velocity(0.8).note('D4')

Internally:
  buf.push(0x01, 60, 100, 96)  // NOTE opcode + args
  buf[2] = 102                  // Modify velocity in place
  buf.push(0x01, 62, 102, 96)  // NOTE opcode + args
  
  (zero allocations - reuse cursor, push to existing array)

Result: number[] containing raw bytecode

Then: build() → single memcpy to SharedArrayBuffer
```

**Benefits:**
- 0 allocations per note
- No intermediate AST
- Single-phase: build IS bytecode generation
- Direct integration with RFC-038 unified memory

---

## 4. Core Components

### 4.1 ClipBuilder (Mutable)

```typescript
export class ClipBuilder {
  // Raw bytecode buffer - just integers
  protected buf: number[] = []
  
  // Current state (not opcodes, just builder state)
  protected vel: number = 100        // 0-127
  protected trans: number = 0        // Semitones offset
  protected tick: number = 0         // Current position in ticks
  
  // Recycled cursor instance
  protected cursor: NoteCursor
  
  constructor() {
    this.cursor = new NoteCursor(this)
  }
  
  // ... methods
}
```

### 4.2 NoteCursor (Recycled, Index-Based)

```typescript
export class NoteCursor {
  // Index into builder.buf where the current NOTE opcode starts
  opIndex: number = -1
  
  constructor(private builder: ClipBuilder) {}
  
  velocity(v: number): this {
    // NOTE layout: [OPCODE, pitch, velocity, duration]
    // velocity is at offset +2 from opcode
    this.builder.buf[this.opIndex + 2] = Math.round(v * 127)
    return this
  }
  
  // Chain back to builder for next note
  note(pitch: NoteName, duration: NoteDuration): NoteCursor {
    return this.builder.note(pitch, duration)
  }
  
  rest(duration: NoteDuration): this {
    this.builder.rest(duration)
    return this
  }
  
  // ... other chainable methods
}
```

### 4.3 Method Implementations

#### note()

```typescript
note(pitch: NoteName, duration: NoteDuration): NoteCursor {
  const opIndex = this.buf.length
  const midi = noteToMidi(pitch) + this.trans
  const ticks = durationToTicks(duration)
  
  this.buf.push(OP.NOTE, midi, this.vel, ticks)
  this.tick += ticks
  
  this.cursor.opIndex = opIndex
  return this.cursor
}
```

#### rest()

```typescript
rest(duration: NoteDuration): this {
  const ticks = durationToTicks(duration)
  this.buf.push(OP.REST, ticks)
  this.tick += ticks
  return this
}
```

#### velocity() (State Change)

```typescript
velocity(v: number): this {
  this.vel = Math.round(v * 127)
  return this  // No opcode, just state change
}
```

#### transpose() (Scoped)

```typescript
transpose(semitones: number, body: (b: this) => void): this {
  const prevTrans = this.trans
  this.trans += semitones
  body(this)  // Execute immediately
  this.trans = prevTrans
  return this
}
```

#### loop()

```typescript
loop(count: number, body: (b: this) => void): this {
  if (count <= 0) return this  // Skip empty loops
  
  this.buf.push(OP.LOOP_START, count)
  body(this)  // Execute immediately, writes to same buf
  this.buf.push(OP.LOOP_END)
  
  return this
}
```

#### stack()

```typescript
stack(...branches: Array<(b: ClipBuilder) => void>): this {
  if (branches.length === 0) return this
  
  this.buf.push(OP.STACK_START, branches.length)
  
  for (const branch of branches) {
    this.buf.push(OP.BRANCH_START)
    
    // Create child builder that shares state
    const child = new ClipBuilder()
    child.vel = this.vel
    child.trans = this.trans
    branch(child)
    
    // Inline child's bytecode
    this.buf.push(...child.buf)
    this.buf.push(OP.BRANCH_END)
  }
  
  this.buf.push(OP.STACK_END)
  return this
}
```

#### clone()

```typescript
clone(): ClipBuilder {
  const copy = new ClipBuilder()
  copy.buf = [...this.buf]
  copy.vel = this.vel
  copy.trans = this.trans
  copy.tick = this.tick
  return copy
}
```

#### build()

```typescript
build(options?: BuildOptions): SharedArrayBuffer {
  this.buf.push(OP.EOF)
  
  const {
    eventCapacity = 10000,
    tempoCapacity = 100,
    ppq = 96,
    bpm = 120
  } = options ?? {}
  
  // Calculate total size
  const bytecodeSize = this.buf.length
  const eventRegionSize = eventCapacity * EVENT_SIZE
  const tempoRegionSize = tempoCapacity * TEMPO_ENTRY_SIZE
  const totalSize = REGION.BYTECODE + bytecodeSize + eventRegionSize + tempoRegionSize
  
  // Allocate unified memory
  const sab = new SharedArrayBuffer(totalSize * 4)
  const mem = new Int32Array(sab)
  
  // Write header registers
  mem[REG.MAGIC] = SBC_MAGIC
  mem[REG.VERSION] = SBC_VERSION
  mem[REG.PPQ] = ppq
  mem[REG.BPM] = bpm
  mem[REG.TOTAL_LENGTH] = this.tick
  mem[REG.PC] = REGION.BYTECODE
  mem[REG.TICK] = 0
  Atomics.store(mem, REG.STATE, STATE.IDLE)
  mem[REG.STACK_SP] = 0
  mem[REG.LOOP_SP] = 0
  mem[REG.TRANS_SP] = 0
  mem[REG.TRANSPOSITION] = 0
  Atomics.store(mem, REG.EVENT_WRITE, 0)
  Atomics.store(mem, REG.EVENT_READ, 0)
  mem[REG.TEMPO_COUNT] = 0
  mem[REG.BYTECODE_START] = REGION.BYTECODE
  mem[REG.BYTECODE_END] = REGION.BYTECODE + bytecodeSize
  mem[REG.EVENT_START] = REGION.BYTECODE + bytecodeSize
  mem[REG.EVENT_CAPACITY] = eventCapacity
  mem[REG.TEMPO_START] = REGION.BYTECODE + bytecodeSize + eventRegionSize
  mem[REG.TEMPO_CAPACITY] = tempoCapacity
  
  // Copy bytecode (single memcpy)
  for (let i = 0; i < this.buf.length; i++) {
    mem[REGION.BYTECODE + i] = this.buf[i]
  }
  
  return sab
}
```

---

## 5. Branching Behavior

**Important:** The builder is mutable. Branching requires explicit `.clone()`.

### Without Clone (Shared Mutation)

```typescript
const base = Clip.create().note('C4', '4n')
const var1 = base.note('E4', '4n')  // Mutates base!
const var2 = base.note('G4', '4n')  // base now has C, E, G
```

### With Clone (Safe Branching)

```typescript
const base = Clip.create().note('C4', '4n')
const var1 = base.clone().note('E4', '4n')  // Clone first
const var2 = base.clone().note('G4', '4n')  // Clone first
// base still has only C4
```

This tradeoff is acceptable for the performance benefits.

---

## 6. Memory Layout Compatibility

The bytecode emitted by the builder is directly compatible with RFC-038 unified memory:

```
buf contents:          [0x01, 60, 100, 96, 0x01, 62, 100, 96, 0xFF]
                        NOTE  C4  vel  dur NOTE  D4  vel  dur EOF

Copied to SAB at:      memory[256..264]  (REGION.BYTECODE)
```

The `build()` method writes all RFC-038 headers and region pointers, producing a complete unified memory buffer ready for `BytecodeVM`.

---

## 7. Opcode Emission Reference

| Method | Opcodes Emitted | Tick Advance |
|--------|-----------------|--------------|
| `note(p, d)` | `[NOTE, pitch+trans, vel, dur]` | +dur |
| `rest(d)` | `[REST, dur]` | +dur |
| `tempo(bpm)` | `[TEMPO, bpm]` | No |
| `cc(ctrl, val)` | `[CC, ctrl, val]` | No |
| `bend(val)` | `[BEND, val]` | No |
| `velocity(v)` | None (state only) | No |
| `transpose(s, body)` | None (state only) | Per body |
| `loop(n, body)` | `[LOOP_START, n, ...body, LOOP_END]` | Per body×n |
| `stack(branches)` | `[STACK_START, n, ...branches, STACK_END]` | MAX(branches) |
| `chord(notes)` | `[CHORDn, root, intervals..., vel, dur]` | +dur |

---

## 8. Static Factory Methods

```typescript
export const Clip = {
  create(): ClipBuilder {
    return new ClipBuilder()
  },
  
  melody(pattern: string): ClipBuilder {
    const builder = new ClipBuilder()
    // Parse pattern and emit notes
    for (const note of parsePattern(pattern)) {
      builder.note(note.pitch, note.duration)
    }
    return builder
  },
  
  // ... other factories
}
```

---

## 9. Integration with Existing Code

### Backward Compatibility

The old `ClipNode` type and `compileClip()` function remain available for existing code. Migration path:

```typescript
// Old way (still works)
const clipNode = oldBuilder.build()  // Returns ClipNode
const sab = assembleToBytecode(clipNode)

// New way (direct)
const sab = newBuilder.build()  // Returns SharedArrayBuffer directly
```

### Type Exports

```typescript
// New exports from packages/core
export { ClipBuilder, NoteCursor, Clip } from './builder'
export type { BuildOptions } from './builder'
```

---

## 10. Success Criteria

- [ ] Zero allocations during fluent chain (verified via memory profiler)
- [ ] `build()` returns `SharedArrayBuffer` directly
- [ ] Bytecode layout matches RFC-038 specification exactly
- [ ] All opcodes emit correct byte sequences
- [ ] Recycled cursor modifies buffer in place
- [ ] `.clone()` creates independent copy
- [ ] Loop/stack callbacks execute immediately (no stored closures)
- [ ] Transposition applied at emit time (state-based)
- [ ] Velocity state persists across notes
- [ ] All existing tests pass (with migration)
- [ ] New builder tests pass
- [ ] `npx tsc --noEmit` passes

---

## 11. Approval

- [ ] Approved for implementation
- [ ] Requires revision (see comments)
